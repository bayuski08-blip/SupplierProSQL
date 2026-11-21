const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

// 1. Update mapInvoiceRow to include returnAmount and subtract from sisa
const mapInvTarget = `      const total = parseFloat(r.total || 0);
      const paid = parseFloat(r.paid_amount || 0);
      const sisa = Math.max(0, total - paid);`;

const mapInvReplacement = `      const total = parseFloat(r.total || 0);
      const paid = parseFloat(r.paid_amount || 0);
      const returnAmount = parseFloat(r.return_amount || 0);
      const sisa = Math.max(0, total - paid - returnAmount);`;

if (code.includes(mapInvTarget)) {
  code = code.replace(mapInvTarget, mapInvReplacement);
  // Also add returnAmount to return object
  code = code.replace(`        total: total,
        paid: paid,
        sisa: sisa,`, `        total: total,
        paid: paid,
        returnAmount: returnAmount,
        sisa: sisa,`);
  console.log('Updated mapInvoiceRow with returnAmount.');
}

// 2. Update mapPayableRow to include returnAmount and subtract from sisa
const mapPayTarget = `      const total = parseFloat(r.total || 0);
      const paid = parseFloat(r.paid_amount || 0);
      const sisa = Math.max(0, total - paid);`;

const mapPayReplacement = `      const total = parseFloat(r.total || 0);
      const paid = parseFloat(r.paid_amount || 0);
      const returnAmount = parseFloat(r.return_amount || 0);
      const sisa = Math.max(0, total - paid - returnAmount);`;

if (code.includes(mapPayTarget)) {
  code = code.replace(mapPayTarget, mapPayReplacement);
  code = code.replace(`        total: total,
        paid: paid,
        sisa: sisa,`, `        total: total,
        paid: paid,
        returnAmount: returnAmount,
        sisa: sisa,`);
  console.log('Updated mapPayableRow with returnAmount.');
}

// 3. Batch B Routes code
const batchBRoutes = `
// =========================================================================
// BATCH B ROUTES: RETUR PENJUALAN, RETUR PEMBELIAN, STOCK MOVE
// =========================================================================

/**
 * POST /api/invoices/:id/returns
 * Membuat Retur Penjualan dalam satu transaksi DB
 */
app.post('/api/invoices/:id/returns', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'owner'), async (req, res) => {
  const invId = req.params.id;
  const { date, reason, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Minimal satu item harus dipilih untuk retur' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Alasan retur wajib diisi' });
  }

  const returnDate = date ? String(date).split('T')[0] : getTodayWITA();
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch & lock invoice
    const invRes = await client.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [invId]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    const inv = invRes.rows[0];
    if (inv.status === 'Cancel' || inv.status === 'Batal') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice yang sudah dibatalkan tidak dapat diretur' });
    }

    // 2. Fetch original invoice items & existing returns for this invoice
    const origItemsRes = await client.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [invId]);
    const origMap = {};
    for (const row of origItemsRes.rows) {
      origMap[row.product_id] = row;
    }

    const prevReturnsRes = await client.query(\`
      SELECT sri.product_id, SUM(sri.quantity) as returned_qty
      FROM sales_return_items sri
      JOIN sales_returns sr ON sr.id = sri.return_id
      WHERE sr.invoice_id = ?
      GROUP BY sri.product_id
    \`, [invId]);
    const prevReturnedMap = {};
    for (const r of prevReturnsRes.rows) {
      prevReturnedMap[r.product_id] = parseFloat(r.returned_qty || 0);
    }

    // Proportional factors from original invoice
    const invSubtotal = parseFloat(inv.subtotal || 0);
    const invDiscount = parseFloat(inv.discount || 0);
    const discountRatio = invSubtotal > 0 ? (invDiscount / invSubtotal) : 0;
    const invDpp = invSubtotal - invDiscount;
    const invTax = parseFloat(inv.tax || 0);
    const taxRatio = invDpp > 0 ? (invTax / invDpp) : 0;

    let totalRefund = 0;
    const itemsToProcess = [];

    for (const it of items) {
      const pId = it.product_id || it.productId || it.id;
      const qty = parseFloat(it.quantity || it.qty || 0);
      const condition = it.condition_type || it.condition || 'kembali_ke_stok';

      if (qty <= 0) continue; // skip 0 qty items

      const orig = origMap[pId];
      if (!orig) {
        throw new Error(\`Produk dengan ID \${pId} bukan bagian dari invoice \${invId}\`);
      }

      const origQty = parseFloat(orig.quantity || 0);
      const alreadyReturned = prevReturnedMap[pId] || 0;
      const maxReturnable = Math.max(0, origQty - alreadyReturned);

      if (qty > maxReturnable) {
        throw new Error(\`Qty retur untuk produk \${pId} melebihi sisa yang bisa diretur (maks: \${maxReturnable}, diminta: \${qty})\`);
      }

      const origPrice = parseFloat(orig.price || 0);
      const snapshotCost = parseFloat(orig.cost_price_snapshot || 0);
      const itemSubtotal = origPrice * qty;

      // Net proportional refund
      const netAfterDiscount = itemSubtotal * (1 - discountRatio);
      const itemRefund = netAfterDiscount * (1 + taxRatio);

      totalRefund += itemRefund;

      itemsToProcess.push({
        product_id: pId,
        quantity: qty,
        condition_type: condition,
        price: origPrice,
        cost_price_snapshot: snapshotCost,
        subtotal: itemSubtotal,
        refund_amount: itemRefund
      });
    }

    if (itemsToProcess.length === 0) {
      throw new Error('Minimal satu item harus memiliki qty retur >= 1');
    }

    // 3. Generate Return ID
    const returnId = await generateSalesReturnId(client, returnDate);

    // 4. Financial allocation (Piutang vs Deposit)
    const invTotal = parseFloat(inv.total || 0);
    const invPaid = parseFloat(inv.paid_amount || 0);
    const currentReturnAmount = parseFloat(inv.return_amount || 0);
    const remainingPiutang = Math.max(0, invTotal - invPaid - currentReturnAmount);

    let piutangDeduction = 0;
    let customerDepositAmount = 0;

    if (totalRefund <= remainingPiutang) {
      piutangDeduction = totalRefund;
      customerDepositAmount = 0;
    } else {
      piutangDeduction = remainingPiutang;
      customerDepositAmount = totalRefund - remainingPiutang;
    }

    // Update customer deposit if excess refund
    if (customerDepositAmount > 0 && inv.customer_id) {
      await client.query('UPDATE customers SET deposit = deposit + ? WHERE id = ?', [customerDepositAmount, inv.customer_id]);
    }

    // Update invoice return_amount & status
    const newTotalReturn = currentReturnAmount + piutangDeduction;
    const isNowFullyPaid = (invPaid + newTotalReturn) >= (invTotal - 0.01);
    const updatedStatus = isNowFullyPaid ? 'Lunas' : inv.status;

    await client.query(
      'UPDATE sales_invoices SET return_amount = ?, status = ? WHERE id = ?',
      [newTotalReturn, updatedStatus, invId]
    );

    // 5. Insert sales_returns header
    await client.query(\`
      INSERT INTO sales_returns (
        id, invoice_id, customer_id, date, total_refund,
        piutang_deduction, customer_deposit_amount, reason, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`, [
      returnId, invId, inv.customer_id, returnDate, totalRefund,
      piutangDeduction, customerDepositAmount, reason.trim(), userId
    ]);

    // 6. Process items (Stock & Stock Move)
    for (const item of itemsToProcess) {
      await client.query(\`
        INSERT INTO sales_return_items (
          return_id, product_id, quantity, condition_type,
          price, cost_price_snapshot, subtotal, refund_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      \`, [
        returnId, item.product_id, item.quantity, item.condition_type,
        item.price, item.cost_price_snapshot, item.subtotal, item.refund_amount
      ]);

      const prodRes = await client.query('SELECT id, name, stock, cost_price FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
      const curCost = parseFloat(prodRes.rows[0]?.cost_price || 0);

      if (item.condition_type === 'kembali_ke_stok') {
        const nextStock = curStock + item.quantity;
        // Weighted average reversal using original cost snapshot
        let newCost = curCost;
        if (curStock > 0 && nextStock > 0) {
          newCost = ((curStock * curCost) + (item.quantity * item.cost_price_snapshot)) / nextStock;
        } else {
          newCost = item.cost_price_snapshot > 0 ? item.cost_price_snapshot : curCost;
        }
        await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [nextStock, newCost, item.product_id]);

        await recordStockMove(client, {
          product_id: item.product_id,
          tanggal: returnDate + ' 12:00:00',
          tipe: 'retur_penjualan',
          ref_type: 'sales_return',
          ref_id: returnId,
          ref_no: invId,
          qty_masuk: item.quantity,
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: \`Retur Penjualan \${returnId} (Invoice \${invId}): \${reason.trim()}\`,
          created_by: userId
        });
      } else {
        // Kondisi rusak: stok tidak bertambah, catat stock_moves tipe retur_penjualan_rusak
        await recordStockMove(client, {
          product_id: item.product_id,
          tanggal: returnDate + ' 12:00:00',
          tipe: 'retur_penjualan_rusak',
          ref_type: 'sales_return',
          ref_id: returnId,
          ref_no: invId,
          qty_masuk: 0,
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: curStock,
          keterangan: \`Retur Penjualan Rusak \${returnId} (Invoice \${invId}) - tidak kembali ke stok: \${reason.trim()}\`,
          created_by: userId
        });
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      return_id: returnId,
      total_refund: totalRefund,
      piutang_deduction: piutangDeduction,
      customer_deposit_amount: customerDepositAmount,
      invoice_status: updatedStatus
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/invoices/:id/returns
 * Mengambil riwayat retur untuk satu invoice tertentu
 */
app.get('/api/invoices/:id/returns', authenticateToken, async (req, res) => {
  const invId = req.params.id;
  const role = (req.user?.role || 'kasir').toLowerCase();
  const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

  try {
    const returnsRes = await pool.query(\`
      SELECT sr.*, u.name as user_name
      FROM sales_returns sr
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE sr.invoice_id = ?
      ORDER BY sr.date DESC, sr.created_at DESC
    \`, [invId]);

    const result = [];
    for (const r of returnsRes.rows) {
      const itemsRes = await pool.query(\`
        SELECT sri.*, p.name as product_name, p.sku
        FROM sales_return_items sri
        LEFT JOIN products p ON p.id = sri.product_id
        WHERE sri.return_id = ?
      \`, [r.id]);

      result.push({
        id: r.id,
        invoice_id: r.invoice_id,
        customer_id: r.customer_id,
        date: formatDateStr(r.date),
        reason: r.reason,
        user_name: r.user_name || '-',
        ...(canSeeFinance ? {
          total_refund: parseFloat(r.total_refund || 0),
          piutang_deduction: parseFloat(r.piutang_deduction || 0),
          customer_deposit_amount: parseFloat(r.customer_deposit_amount || 0),
        } : {}),
        items: itemsRes.rows.map(it => ({
          product_id: it.product_id,
          product_name: it.product_name,
          sku: it.sku,
          quantity: parseFloat(it.quantity || 0),
          condition_type: it.condition_type,
          ...(canSeeFinance ? {
            price: parseFloat(it.price || 0),
            subtotal: parseFloat(it.subtotal || 0),
            refund_amount: parseFloat(it.refund_amount || 0)
          } : {})
        }))
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/purchases/:id/returns
 * Membuat Retur Pembelian dalam satu transaksi DB
 */
app.post('/api/purchases/:id/returns', authenticateToken, authorizeRoles('admin', 'gudang', 'finance', 'owner'), async (req, res) => {
  const poId = req.params.id;
  const { date, reason, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Minimal satu item harus dipilih untuk retur' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Alasan retur wajib diisi' });
  }

  const returnDate = date ? String(date).split('T')[0] : getTodayWITA();
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch & lock PO
    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (poRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase Order tidak ditemukan' });
    }
    const po = poRes.rows[0];
    if (po.status === 'Batal') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Purchase Order yang sudah dibatalkan tidak dapat diretur' });
    }

    // 2. Fetch original items & previous returns
    const origItemsRes = await client.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
    const origMap = {};
    for (const row of origItemsRes.rows) {
      origMap[row.product_id] = row;
    }

    const prevReturnsRes = await client.query(\`
      SELECT pri.product_id, SUM(pri.quantity) as returned_qty
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      WHERE pr.purchase_order_id = ?
      GROUP BY pri.product_id
    \`, [poId]);
    const prevReturnedMap = {};
    for (const r of prevReturnsRes.rows) {
      prevReturnedMap[r.product_id] = parseFloat(r.returned_qty || 0);
    }

    const poSubtotal = parseFloat(po.subtotal || 0);
    const poDiscount = parseFloat(po.discount || 0);
    const discountRatio = poSubtotal > 0 ? (poDiscount / poSubtotal) : 0;
    const poDpp = poSubtotal - poDiscount;
    const poTax = parseFloat(po.tax || 0);
    const taxRatio = poDpp > 0 ? (poTax / poDpp) : 0;

    let totalRefund = 0;
    const itemsToProcess = [];

    for (const it of items) {
      const pId = it.product_id || it.productId || it.id;
      const qty = parseFloat(it.quantity || it.qty || 0);

      if (qty <= 0) continue;

      const orig = origMap[pId];
      if (!orig) {
        throw new Error(\`Produk dengan ID \${pId} bukan bagian dari PO \${poId}\`);
      }

      const origQty = parseFloat(orig.quantity || 0);
      const alreadyReturned = prevReturnedMap[pId] || 0;
      const maxReturnable = Math.max(0, origQty - alreadyReturned);

      if (qty > maxReturnable) {
        throw new Error(\`Qty retur untuk produk \${pId} melebihi sisa yang bisa diretur (maks: \${maxReturnable}, diminta: \${qty})\`);
      }

      // Check current stock sufficiency
      const prodRes = await client.query('SELECT id, name, stock, cost_price FROM products WHERE id = ? FOR UPDATE', [pId]);
      if (prodRes.rows.length === 0) {
        throw new Error(\`Produk \${pId} tidak ditemukan\`);
      }
      const curStock = parseFloat(prodRes.rows[0].stock || 0);
      if (curStock < qty) {
        throw new Error(\`Stok produk "\${prodRes.rows[0].name}" tidak mencukupi untuk retur pembelian (dibutuhkan \${qty}, stok saat ini: \${curStock})\`);
      }

      const origCost = parseFloat(orig.cost || 0);
      const itemSubtotal = origCost * qty;
      const netAfterDiscount = itemSubtotal * (1 - discountRatio);
      const itemRefund = netAfterDiscount * (1 + taxRatio);

      totalRefund += itemRefund;

      itemsToProcess.push({
        product_id: pId,
        quantity: qty,
        cost: origCost,
        subtotal: itemSubtotal,
        refund_amount: itemRefund,
        curStock,
        curCost: parseFloat(prodRes.rows[0].cost_price || 0)
      });
    }

    if (itemsToProcess.length === 0) {
      throw new Error('Minimal satu item harus memiliki qty retur >= 1');
    }

    // 3. Generate Return ID
    const returnId = await generatePurchaseReturnId(client, returnDate);

    // 4. Financial allocation (Hutang vs Deposit Vendor)
    const poTotal = parseFloat(po.total || 0);
    const poPaid = parseFloat(po.paid_amount || 0);
    const currentReturnAmount = parseFloat(po.return_amount || 0);
    const remainingHutang = Math.max(0, poTotal - poPaid - currentReturnAmount);

    let hutangDeduction = 0;
    let vendorDepositAmount = 0;

    if (totalRefund <= remainingHutang) {
      hutangDeduction = totalRefund;
      vendorDepositAmount = 0;
    } else {
      hutangDeduction = remainingHutang;
      vendorDepositAmount = totalRefund - remainingHutang;
    }

    // Update vendor deposit if excess refund
    if (vendorDepositAmount > 0 && po.vendor_id) {
      await client.query('UPDATE vendors SET deposit = deposit + ? WHERE id = ?', [vendorDepositAmount, po.vendor_id]);
    }

    // Update PO return_amount & status
    const newTotalReturn = currentReturnAmount + hutangDeduction;
    const isNowFullySettled = (poPaid + newTotalReturn) >= (poTotal - 0.01);
    const updatedStatus = isNowFullySettled ? 'Selesai' : po.status;

    await client.query(
      'UPDATE purchase_orders SET return_amount = ?, status = ? WHERE id = ?',
      [newTotalReturn, updatedStatus, poId]
    );

    // 5. Insert purchase_returns header
    await client.query(\`
      INSERT INTO purchase_returns (
        id, purchase_order_id, vendor_id, date, total_refund,
        hutang_deduction, vendor_deposit_amount, reason, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`, [
      returnId, poId, po.vendor_id, returnDate, totalRefund,
      hutangDeduction, vendorDepositAmount, reason.trim(), userId
    ]);

    // 6. Process items (Stock deduction, Weighted Average Cost recalculation, Stock Move)
    for (const item of itemsToProcess) {
      await client.query(\`
        INSERT INTO purchase_return_items (
          return_id, product_id, quantity, cost, subtotal, refund_amount
        ) VALUES (?, ?, ?, ?, ?, ?)
      \`, [
        returnId, item.product_id, item.quantity, item.cost, item.subtotal, item.refund_amount
      ]);

      const nextStock = item.curStock - item.quantity;
      let newCost = item.curCost;
      if (nextStock > 0) {
        newCost = ((item.curStock * item.curCost) - (item.quantity * item.cost)) / nextStock;
        if (newCost < 0) newCost = item.curCost;
      }

      await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [nextStock, newCost, item.product_id]);

      await recordStockMove(client, {
        product_id: item.product_id,
        tanggal: returnDate + ' 12:00:00',
        tipe: 'retur_pembelian',
        ref_type: 'purchase_return',
        ref_id: returnId,
        ref_no: poId,
        qty_masuk: 0,
        qty_keluar: item.quantity,
        qty_sebelum: item.curStock,
        qty_sesudah: nextStock,
        keterangan: \`Retur Pembelian \${returnId} (PO \${poId}): \${reason.trim()}\`,
        created_by: userId
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      return_id: returnId,
      total_refund: totalRefund,
      hutang_deduction: hutangDeduction,
      vendor_deposit_amount: vendorDepositAmount,
      po_status: updatedStatus
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/purchases/:id/returns
 * Mengambil riwayat retur untuk satu PO tertentu
 */
app.get('/api/purchases/:id/returns', authenticateToken, async (req, res) => {
  const poId = req.params.id;
  const role = (req.user?.role || 'kasir').toLowerCase();
  const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

  try {
    const returnsRes = await pool.query(\`
      SELECT pr.*, u.name as user_name
      FROM purchase_returns pr
      LEFT JOIN users u ON u.id = pr.user_id
      WHERE pr.purchase_order_id = ?
      ORDER BY pr.date DESC, pr.created_at DESC
    \`, [poId]);

    const result = [];
    for (const r of returnsRes.rows) {
      const itemsRes = await pool.query(\`
        SELECT pri.*, p.name as product_name, p.sku
        FROM purchase_return_items pri
        LEFT JOIN products p ON p.id = pri.product_id
        WHERE pri.return_id = ?
      \`, [r.id]);

      result.push({
        id: r.id,
        purchase_order_id: r.purchase_order_id,
        vendor_id: r.vendor_id,
        date: formatDateStr(r.date),
        reason: r.reason,
        user_name: r.user_name || '-',
        ...(canSeeFinance ? {
          total_refund: parseFloat(r.total_refund || 0),
          hutang_deduction: parseFloat(r.hutang_deduction || 0),
          vendor_deposit_amount: parseFloat(r.vendor_deposit_amount || 0),
        } : {}),
        items: itemsRes.rows.map(it => ({
          product_id: it.product_id,
          product_name: it.product_name,
          sku: it.sku,
          quantity: parseFloat(it.quantity || 0),
          ...(canSeeFinance ? {
            cost: parseFloat(it.cost || 0),
            subtotal: parseFloat(it.subtotal || 0),
            refund_amount: parseFloat(it.refund_amount || 0)
          } : {})
        }))
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/sales
 * Daftar Retur Penjualan (Paginated 80 baris, disanitasi berdasarkan role)
 */
app.get('/api/returns/sales', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'gudang', 'owner'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, date_from, date_to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
    const offset = (pageNum - 1) * limitNum;

    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || '').trim();
    if (searchQuery) {
      whereConditions.push('(sr.id LIKE ? OR sr.invoice_id LIKE ? OR c.name LIKE ?)');
      const pattern = \`%\${searchQuery}%\`;
      params.push(pattern, pattern, pattern);
    }
    if (date_from) {
      whereConditions.push('sr.date >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereConditions.push('sr.date <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countRes = await pool.query(\`
      SELECT COUNT(*) as total
      FROM sales_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      \${whereClause}
    \`, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await pool.query(\`
      SELECT sr.*, c.name as customer_name, u.name as user_name,
        (SELECT COUNT(*) FROM sales_return_items WHERE return_id = sr.id) as item_count,
        (SELECT GROUP_CONCAT(DISTINCT condition_type) FROM sales_return_items WHERE return_id = sr.id) as conditions
      FROM sales_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN users u ON u.id = sr.user_id
      \${whereClause}
      ORDER BY sr.date DESC, sr.created_at DESC
      LIMIT ? OFFSET ?
    \`, [...params, limitNum, offset]);

    const data = dataRes.rows.map(r => {
      const row = {
        id: r.id,
        invoice_id: r.invoice_id,
        date: formatDateStr(r.date),
        customer_name: r.customer_name || 'Tanpa Pelanggan',
        item_count: parseInt(r.item_count || 0),
        reason: r.reason,
        conditions: r.conditions || 'kembali_ke_stok',
        user_name: r.user_name || '-'
      };
      if (canSeeFinance) {
        row.total_refund = parseFloat(r.total_refund || 0);
        row.piutang_deduction = parseFloat(r.piutang_deduction || 0);
        row.customer_deposit_amount = parseFloat(r.customer_deposit_amount || 0);
      }
      return row;
    });

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/sales/:id
 * Detail Retur Penjualan (disanitasi)
 */
app.get('/api/returns/sales/:id', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'gudang', 'owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const srRes = await pool.query(\`
      SELECT sr.*, c.name as customer_name, u.name as user_name
      FROM sales_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE sr.id = ?
    \`, [id]);
    if (srRes.rows.length === 0) {
      return res.status(404).json({ error: 'Retur tidak ditemukan' });
    }
    const sr = srRes.rows[0];

    const itemsRes = await pool.query(\`
      SELECT sri.*, p.name as product_name, p.sku
      FROM sales_return_items sri
      LEFT JOIN products p ON p.id = sri.product_id
      WHERE sri.return_id = ?
    \`, [id]);

    const result = {
      id: sr.id,
      invoice_id: sr.invoice_id,
      date: formatDateStr(sr.date),
      customer_id: sr.customer_id,
      customer_name: sr.customer_name || 'Tanpa Pelanggan',
      reason: sr.reason,
      user_name: sr.user_name || '-',
      items: itemsRes.rows.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        sku: it.sku,
        quantity: parseFloat(it.quantity || 0),
        condition_type: it.condition_type,
        ...(canSeeFinance ? {
          price: parseFloat(it.price || 0),
          subtotal: parseFloat(it.subtotal || 0),
          refund_amount: parseFloat(it.refund_amount || 0)
        } : {})
      }))
    };

    if (canSeeFinance) {
      result.total_refund = parseFloat(sr.total_refund || 0);
      result.piutang_deduction = parseFloat(sr.piutang_deduction || 0);
      result.customer_deposit_amount = parseFloat(sr.customer_deposit_amount || 0);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/purchases
 * Daftar Retur Pembelian (Paginated 80 baris, disanitasi berdasarkan role)
 */
app.get('/api/returns/purchases', authenticateToken, authorizeRoles('admin', 'gudang', 'finance', 'owner'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, date_from, date_to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
    const offset = (pageNum - 1) * limitNum;

    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || '').trim();
    if (searchQuery) {
      whereConditions.push('(pr.id LIKE ? OR pr.purchase_order_id LIKE ? OR v.name LIKE ?)');
      const pattern = \`%\${searchQuery}%\`;
      params.push(pattern, pattern, pattern);
    }
    if (date_from) {
      whereConditions.push('pr.date >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereConditions.push('pr.date <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countRes = await pool.query(\`
      SELECT COUNT(*) as total
      FROM purchase_returns pr
      LEFT JOIN vendors v ON v.id = pr.vendor_id
      \${whereClause}
    \`, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await pool.query(\`
      SELECT pr.*, v.name as vendor_name, u.name as user_name,
        (SELECT COUNT(*) FROM purchase_return_items WHERE return_id = pr.id) as item_count
      FROM purchase_returns pr
      LEFT JOIN vendors v ON v.id = pr.vendor_id
      LEFT JOIN users u ON u.id = pr.user_id
      \${whereClause}
      ORDER BY pr.date DESC, pr.created_at DESC
      LIMIT ? OFFSET ?
    \`, [...params, limitNum, offset]);

    const data = dataRes.rows.map(r => {
      const row = {
        id: r.id,
        purchase_order_id: r.purchase_order_id,
        date: formatDateStr(r.date),
        vendor_name: r.vendor_name || 'Tanpa Vendor',
        item_count: parseInt(r.item_count || 0),
        reason: r.reason,
        user_name: r.user_name || '-'
      };
      if (canSeeFinance) {
        row.total_refund = parseFloat(r.total_refund || 0);
        row.hutang_deduction = parseFloat(r.hutang_deduction || 0);
        row.vendor_deposit_amount = parseFloat(r.vendor_deposit_amount || 0);
      }
      return row;
    });

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/purchases/:id
 * Detail Retur Pembelian (disanitasi)
 */
app.get('/api/returns/purchases/:id', authenticateToken, authorizeRoles('admin', 'gudang', 'finance', 'owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const prRes = await pool.query(\`
      SELECT pr.*, v.name as vendor_name, u.name as user_name
      FROM purchase_returns pr
      LEFT JOIN vendors v ON v.id = pr.vendor_id
      LEFT JOIN users u ON u.id = pr.user_id
      WHERE pr.id = ?
    \`, [id]);
    if (prRes.rows.length === 0) {
      return res.status(404).json({ error: 'Retur tidak ditemukan' });
    }
    const pr = prRes.rows[0];

    const itemsRes = await pool.query(\`
      SELECT pri.*, p.name as product_name, p.sku
      FROM purchase_return_items pri
      LEFT JOIN products p ON p.id = pri.product_id
      WHERE pri.return_id = ?
    \`, [id]);

    const result = {
      id: pr.id,
      purchase_order_id: pr.purchase_order_id,
      date: formatDateStr(pr.date),
      vendor_id: pr.vendor_id,
      vendor_name: pr.vendor_name || 'Tanpa Vendor',
      reason: pr.reason,
      user_name: pr.user_name || '-',
      items: itemsRes.rows.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        sku: it.sku,
        quantity: parseFloat(it.quantity || 0),
        ...(canSeeFinance ? {
          cost: parseFloat(it.cost || 0),
          subtotal: parseFloat(it.subtotal || 0),
          refund_amount: parseFloat(it.refund_amount || 0)
        } : {})
      }))
    };

    if (canSeeFinance) {
      result.total_refund = parseFloat(pr.total_refund || 0);
      result.hutang_deduction = parseFloat(pr.hutang_deduction || 0);
      result.vendor_deposit_amount = parseFloat(pr.vendor_deposit_amount || 0);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock-moves
 * Monitoring qty barang keluar-masuk saja (B4.2).
 * STRICTLY NO FINANCIAL DATA (no prices, HPP, cash, balances).
 */
app.get('/api/stock-moves', authenticateToken, authorizeRoles('admin', 'gudang', 'owner'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, tipe, product_id, date_from, date_to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(p.name LIKE ? OR p.sku LIKE ? OR sm.ref_no LIKE ? OR sm.keterangan LIKE ?)');
      const pattern = \`%\${searchQuery}%\`;
      params.push(pattern, pattern, pattern, pattern);
    }

    if (product_id && product_id !== 'all') {
      whereConditions.push('sm.product_id = ?');
      params.push(product_id);
    }

    if (tipe && tipe !== 'all') {
      whereConditions.push('sm.tipe = ?');
      params.push(tipe.toLowerCase());
    }

    if (date_from) {
      whereConditions.push('DATE(sm.tanggal) >= ?');
      params.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(sm.tanggal) <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countRes = await pool.query(\`
      SELECT COUNT(*) as total
      FROM stock_moves sm
      JOIN products p ON p.id = sm.product_id
      \${whereClause}
    \`, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await pool.query(\`
      SELECT sm.id, sm.tanggal, sm.tipe, sm.ref_type, sm.ref_id, sm.ref_no,
             sm.qty_masuk, sm.qty_keluar, sm.qty_sebelum, sm.qty_sesudah,
             sm.keterangan, sm.created_at, sm.is_backfill,
             p.id as product_id, p.name as product_name, p.sku, pu.name as unit_name,
             u.name as user_name
      FROM stock_moves sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN product_units pu ON pu.id = p.unit_id
      LEFT JOIN users u ON u.id = sm.created_by
      \${whereClause}
      ORDER BY sm.tanggal DESC, sm.id DESC
      LIMIT ? OFFSET ?
    \`, [...params, limitNum, offset]);

    // Format output strictly without any financial fields
    const data = dataRes.rows.map(r => ({
      id: r.id,
      tanggal: r.tanggal ? String(r.tanggal).replace('T', ' ').slice(0, 19) : '',
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku || '-',
      unit: r.unit_name || 'Pcs',
      tipe: r.tipe,
      refType: r.ref_type || '-',
      refId: r.ref_id || '-',
      refNo: r.ref_no || r.ref_id || '-',
      qtyMasuk: parseFloat(r.qty_masuk || 0),
      qtyKeluar: parseFloat(r.qty_keluar || 0),
      qtySebelum: parseFloat(r.qty_sebelum || 0),
      stokSesudah: parseFloat(r.qty_sesudah || 0),
      keterangan: r.keterangan || '-',
      user: r.user_name || 'Sistem',
      isBackfill: Boolean(r.is_backfill)
    }));

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// =========================================================================
`;

const insertMarker = `// Bind ke 0.0.0.0 agar bisa diakses dari luar (wajib di hosting)`;
if (!code.includes("app.post('/api/invoices/:id/returns'")) {
  code = code.replace(insertMarker, batchBRoutes + '\n' + insertMarker);
  console.log('Appended Batch B routes to server.js.');
} else {
  console.log('Batch B routes already present, skipping.');
}

fs.writeFileSync(serverPath, code, 'utf8');
console.log('Finished updating server.js!');

