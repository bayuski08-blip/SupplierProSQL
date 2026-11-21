const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

console.log('Patching server.js with Batch B hooks and endpoints...');

// -------------------------------------------------------------
// 1. Hook into POST /api/products (Stok Awal)
// -------------------------------------------------------------
const postProductsTarget = `    await pool.query(insertQuery, [id || nextId, sku, brandVal, name, category_id, cost_price, sell_price, stock, min_stock, unit_id || 'PU-1']);
    res.json({ success: true, message: 'Produk berhasil ditambahkan' });`;

const postProductsReplacement = `    const targetId = id || nextId;
    await pool.query(insertQuery, [targetId, sku, brandVal, name, category_id, cost_price, sell_price, stock, min_stock, unit_id || 'PU-1']);
    if (parseFloat(stock || 0) > 0) {
      await recordStockMove(pool, {
        product_id: targetId,
        tipe: 'stok_awal',
        ref_type: 'product',
        ref_id: targetId,
        ref_no: sku || targetId,
        qty_masuk: parseFloat(stock),
        qty_keluar: 0,
        qty_sebelum: 0,
        qty_sesudah: parseFloat(stock),
        keterangan: 'Stok Awal Produk Baru',
        created_by: req.user?.id
      });
    }
    res.json({ success: true, message: 'Produk berhasil ditambahkan' });`;

if (code.includes(postProductsTarget)) {
  code = code.replace(postProductsTarget, postProductsReplacement);
  console.log('Hook 1: POST /api/products updated.');
} else {
  console.log('Hook 1: target not found or already patched.');
}

// -------------------------------------------------------------
// 2. Hook into PUT /api/products/:id (Koreksi Edit Produk Manual)
// -------------------------------------------------------------
const putProductsTarget = `app.put('/api/products/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  const { sku, brand, name, category_id, cost_price, sell_price, stock, min_stock, unit_id } = req.body;
  const brandVal = (brand !== undefined && brand !== null && String(brand).trim() !== '') ? String(brand).trim() : null;
  const updateQuery = 'UPDATE products SET sku = $1, brand = $2, name = $3, category_id = $4, cost_price = $5, sell_price = $6, stock = $7, min_stock = $8, unit_id = $9 WHERE id = $10';
  try {
    const result = await pool.query(updateQuery, [sku, brandVal, name, category_id, cost_price, sell_price, stock, min_stock, unit_id, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json({ success: true, message: 'Produk berhasil diperbarui' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});`;

const putProductsReplacement = `app.put('/api/products/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  const { sku, brand, name, category_id, cost_price, sell_price, stock, min_stock, unit_id } = req.body;
  const brandVal = (brand !== undefined && brand !== null && String(brand).trim() !== '') ? String(brand).trim() : null;
  const updateQuery = 'UPDATE products SET sku = $1, brand = $2, name = $3, category_id = $4, cost_price = $5, sell_price = $6, stock = $7, min_stock = $8, unit_id = $9 WHERE id = $10';
  try {
    const curRes = await pool.query('SELECT stock FROM products WHERE id = $1', [id]);
    const oldStock = parseFloat(curRes.rows[0]?.stock || 0);
    const newStock = parseFloat(stock !== undefined ? stock : oldStock);
    const result = await pool.query(updateQuery, [sku, brandVal, name, category_id, cost_price, sell_price, stock, min_stock, unit_id, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    if (newStock !== oldStock) {
      const diff = newStock - oldStock;
      await recordStockMove(pool, {
        product_id: id,
        tipe: 'koreksi_edit',
        ref_type: 'product',
        ref_id: id,
        ref_no: sku || id,
        qty_masuk: diff > 0 ? diff : 0,
        qty_keluar: diff < 0 ? Math.abs(diff) : 0,
        qty_sebelum: oldStock,
        qty_sesudah: newStock,
        keterangan: 'Edit Produk langsung (stok diubah manual)',
        created_by: req.user?.id
      });
    }
    res.json({ success: true, message: 'Produk berhasil diperbarui' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});`;

if (code.includes(putProductsTarget)) {
  code = code.replace(putProductsTarget, putProductsReplacement);
  console.log('Hook 2: PUT /api/products/:id updated.');
} else {
  console.log('Hook 2: target not found or already patched.');
}

// -------------------------------------------------------------
// 3. Hook into POST /api/stock-adjust (Opname)
// -------------------------------------------------------------
const postStockAdjustTarget = `    await client.query(
      'INSERT INTO cash_transactions (id, date, type, category, description, amount, method, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctId, ctDate, txType, 'Penyesuaian Stok', desc, amount, 'Stock Opname', userId]
    );
    await client.query('COMMIT');`;

const postStockAdjustReplacement = `    await client.query(
      'INSERT INTO cash_transactions (id, date, type, category, description, amount, method, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctId, ctDate, txType, 'Penyesuaian Stok', desc, amount, 'Stock Opname', userId]
    );
    await recordStockMove(client, {
      product_id: product_id,
      tanggal: ctDate ? ctDate + ' 12:00:00' : null,
      tipe: 'opname',
      ref_type: 'stock_adjustment',
      ref_id: ctId,
      ref_no: ctId,
      qty_masuk: diff > 0 ? diff : 0,
      qty_keluar: diff < 0 ? Math.abs(diff) : 0,
      qty_sebelum: oldStock,
      qty_sesudah: newStock,
      keterangan: desc,
      created_by: userId
    });
    await client.query('COMMIT');`;

if (code.includes(postStockAdjustTarget)) {
  code = code.replace(postStockAdjustTarget, postStockAdjustReplacement);
  console.log('Hook 3: POST /api/stock-adjust updated.');
} else {
  console.log('Hook 3: target not found or already patched.');
}

// -------------------------------------------------------------
// 4. Hook into POST /api/invoices (Penjualan POS)
// -------------------------------------------------------------
const postInvoicesTarget = `        await client.query(updateStockQuery, [itemQty, prodId]);
        // Also insert to invoice_items — include customer_fee/fee_notes (admin only)
        const itemFee = req.user.role === 'admin' ? (parseFloat(item.customer_fee) || 0) : 0;
        const itemFeeNotes = req.user.role === 'admin' ? (item.fee_notes || null) : null;
        if (itemFee < 0) throw new Error('customer_fee tidak boleh negatif');

        // Snapshot the HPP (cost_price) at time of sale to prevent drift when cost changes later
        const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [prodId]);
        const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || item.cost_price || 0);

        await client.query(
          'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [Date.now().toString() + Math.floor(Math.random() * 1000), id, prodId, itemQty, itemPrice, costSnapshot, itemFee, itemFeeNotes]
        );`;

const postInvoicesReplacement = `        const curProd = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [prodId]);
        const curStock = parseFloat(curProd.rows[0]?.stock || 0);
        const nextStock = curStock - itemQty;

        await client.query(updateStockQuery, [itemQty, prodId]);
        // Also insert to invoice_items — include customer_fee/fee_notes (admin only)
        const itemFee = req.user.role === 'admin' ? (parseFloat(item.customer_fee) || 0) : 0;
        const itemFeeNotes = req.user.role === 'admin' ? (item.fee_notes || null) : null;
        if (itemFee < 0) throw new Error('customer_fee tidak boleh negatif');

        // Snapshot the HPP (cost_price) at time of sale to prevent drift when cost changes later
        const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [prodId]);
        const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || item.cost_price || 0);

        await client.query(
          'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [Date.now().toString() + Math.floor(Math.random() * 1000), id, prodId, itemQty, itemPrice, costSnapshot, itemFee, itemFeeNotes]
        );

        await recordStockMove(client, {
          product_id: prodId,
          tanggal: date ? date + ' 12:00:00' : null,
          tipe: 'penjualan',
          ref_type: 'invoice',
          ref_id: id,
          ref_no: id,
          qty_masuk: 0,
          qty_keluar: itemQty,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: \`Penjualan Invoice \${id}\`,
          created_by: userId
        });`;

if (code.includes(postInvoicesTarget)) {
  code = code.replace(postInvoicesTarget, postInvoicesReplacement);
  console.log('Hook 4: POST /api/invoices updated.');
} else {
  console.log('Hook 4: target not found or already patched.');
}

// -------------------------------------------------------------
// 5. Hook into PATCH /api/finance/cash-flow/:id/cancel
// -------------------------------------------------------------
const patchCashFlowTarget = `        // Reverse the diff: subtract it from the current stock
        if (productId) {
          await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [diff, productId]);
        } else {
          await client.query('UPDATE products SET stock = stock - $1 WHERE name = $2', [diff, productName]);
        }`;

const patchCashFlowReplacement = `        // Reverse the diff: subtract it from the current stock
        const curProd = await client.query('SELECT stock FROM products WHERE ' + (productId ? 'id = ?' : 'name = ?') + ' FOR UPDATE', [productId || productName]);
        const curStock = parseFloat(curProd.rows[0]?.stock || 0);
        const nextStock = curStock - diff;

        if (productId) {
          await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [diff, productId]);
        } else {
          await client.query('UPDATE products SET stock = stock - $1 WHERE name = $2', [diff, productName]);
        }

        if (productId) {
          await recordStockMove(client, {
            product_id: productId,
            tipe: 'opname',
            ref_type: 'cash_transaction',
            ref_id: id,
            ref_no: id,
            qty_masuk: diff < 0 ? Math.abs(diff) : 0,
            qty_keluar: diff > 0 ? diff : 0,
            qty_sebelum: curStock,
            qty_sesudah: nextStock,
            keterangan: \`Pembatalan Opname Kas: \${id}\`,
            created_by: req.user.id
          });
        }`;

if (code.includes(patchCashFlowTarget)) {
  code = code.replace(patchCashFlowTarget, patchCashFlowReplacement);
  console.log('Hook 5: PATCH /api/finance/cash-flow/:id/cancel updated.');
} else {
  console.log('Hook 5: target not found or already patched.');
}

// -------------------------------------------------------------
// 6. Hook into POST /api/purchases (Pembelian PO)
// -------------------------------------------------------------
const postPurchasesTarget = `          const newStock = currentStock + qty;
          await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [newStock, newCost, prodId]);
        }
      }
    }`;

const postPurchasesReplacement = `          const newStock = currentStock + qty;
          await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [newStock, newCost, prodId]);
          await recordStockMove(client, {
            product_id: prodId,
            tanggal: poDate ? poDate + ' 12:00:00' : null,
            tipe: 'pembelian',
            ref_type: 'purchase_order',
            ref_id: poId,
            ref_no: poId,
            qty_masuk: qty,
            qty_keluar: 0,
            qty_sebelum: currentStock,
            qty_sesudah: newStock,
            keterangan: \`Pembelian PO \${poId}\`,
            created_by: userId
          });
        }
      }
    }`;

if (code.includes(postPurchasesTarget)) {
  code = code.replace(postPurchasesTarget, postPurchasesReplacement);
  console.log('Hook 6: POST /api/purchases updated.');
} else {
  console.log('Hook 6: target not found or already patched.');
}

// -------------------------------------------------------------
// 7. Hook into PUT /api/purchases/:id (Edit PO + B3 Soft-Lock)
// -------------------------------------------------------------
const putPurchasesOldItemsTarget = `    const oldItemsRes = await client.query('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    for (const item of oldItemsRes.rows) {
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemId = 'POI-' + Date.now() + Math.floor(Math.random() * 1000);
        const prodId = item.product_id || item.id;
        const qty = parseFloat(item.quantity || item.qty || 0);
        const cost = parseFloat(item.cost || item.cost_price || item.price || 0);

        await client.query('INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, cost) VALUES ($1, $2, $3, $4, $5)', [itemId, poId, prodId, qty, cost]);
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [qty, prodId]);
      }
    }`;

const putPurchasesOldItemsReplacement = `    const oldItemsRes = await client.query('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);

    // B3 Soft-Lock check for PO: check if any item qty decreased or item was removed
    const oldPoQtyMap = {};
    for (const it of oldItemsRes.rows) {
      oldPoQtyMap[it.product_id] = (oldPoQtyMap[it.product_id] || 0) + parseFloat(it.quantity || 0);
    }
    const newPoQtyMap = {};
    if (items && Array.isArray(items)) {
      for (const it of items) {
        const pId = it.product_id || it.id;
        newPoQtyMap[pId] = (newPoQtyMap[pId] || 0) + parseFloat(it.quantity || it.qty || 0);
      }
    }
    let hasPoReduction = false;
    for (const pId of Object.keys(oldPoQtyMap)) {
      const newQ = newPoQtyMap[pId] || 0;
      if (newQ < oldPoQtyMap[pId]) {
        hasPoReduction = true;
        break;
      }
    }
    const correctionReason = req.body.correction_reason || req.body.reason || '';
    if (hasPoReduction) {
      if (req.user.role.toLowerCase() !== 'admin') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Pengurangan jumlah item pada PO yang sudah berjalan harus dicatat melalui Retur Pembelian. Hubungi Admin untuk koreksi salah input.'
        });
      }
      if (!correctionReason.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Koreksi salah input untuk pengurangan item PO wajib menyertakan alasan.'
        });
      }
    }

    for (const item of oldItemsRes.rows) {
      const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
      const nextStock = curStock - parseFloat(item.quantity || 0);
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
      await recordStockMove(client, {
        product_id: item.product_id,
        tanggal: poDate ? poDate + ' 12:00:00' : null,
        tipe: 'koreksi_edit',
        ref_type: 'purchase_order',
        ref_id: poId,
        ref_no: poId,
        qty_masuk: 0,
        qty_keluar: parseFloat(item.quantity || 0),
        qty_sebelum: curStock,
        qty_sesudah: nextStock,
        keterangan: \`Koreksi Edit PO \${poId} (reversal item lama)\${correctionReason ? ' - ' + correctionReason : ''}\`,
        created_by: req.user.id
      });
    }

    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemId = 'POI-' + Date.now() + Math.floor(Math.random() * 1000);
        const prodId = item.product_id || item.id;
        const qty = parseFloat(item.quantity || item.qty || 0);
        const cost = parseFloat(item.cost || item.cost_price || item.price || 0);

        await client.query('INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, cost) VALUES ($1, $2, $3, $4, $5)', [itemId, poId, prodId, qty, cost]);
        const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [prodId]);
        const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
        const nextStock = curStock + qty;
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [qty, prodId]);
        await recordStockMove(client, {
          product_id: prodId,
          tanggal: poDate ? poDate + ' 12:00:00' : null,
          tipe: 'koreksi_edit',
          ref_type: 'purchase_order',
          ref_id: poId,
          ref_no: poId,
          qty_masuk: qty,
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: \`Koreksi Edit PO \${poId} (item baru)\`,
          created_by: req.user.id
        });
      }
    }`;

if (code.includes(putPurchasesOldItemsTarget)) {
  code = code.replace(putPurchasesOldItemsTarget, putPurchasesOldItemsReplacement);
  console.log('Hook 7: PUT /api/purchases/:id updated.');
} else {
  console.log('Hook 7: target not found or already patched.');
}

// -------------------------------------------------------------
// 8. Hook into PUT /api/purchases/:id/cancel
// -------------------------------------------------------------
const cancelPurchasesTarget = `    const itemsRes = await client.query('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    for (const item of itemsRes.rows) {
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
    }`;

const cancelPurchasesReplacement = `    const itemsRes = await client.query('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    for (const item of itemsRes.rows) {
      const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
      const nextStock = curStock - parseFloat(item.quantity || 0);
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
      await recordStockMove(client, {
        product_id: item.product_id,
        tipe: 'koreksi_edit',
        ref_type: 'purchase_order',
        ref_id: poId,
        ref_no: poId,
        qty_masuk: 0,
        qty_keluar: parseFloat(item.quantity || 0),
        qty_sebelum: curStock,
        qty_sesudah: nextStock,
        keterangan: \`Pembatalan PO \${poId}\`,
        created_by: req.user.id
      });
    }`;

if (code.includes(cancelPurchasesTarget)) {
  code = code.replace(cancelPurchasesTarget, cancelPurchasesReplacement);
  console.log('Hook 8: PUT /api/purchases/:id/cancel updated.');
} else {
  console.log('Hook 8: target not found or already patched.');
}

// -------------------------------------------------------------
// 9. Hook into PUT /api/invoices/:id (Edit Invoice + B3 Soft-Lock)
// -------------------------------------------------------------
const putInvoicesDeltaTarget = `      const allProductIds = new Set([...Object.keys(oldQtyMap), ...Object.keys(newQtyMap)]);

      for (const pId of allProductIds) {
        const oldQty = oldQtyMap[pId] || 0;
        const newQty = newQtyMap[pId] || 0;
        const delta = newQty - oldQty;

        if (delta > 0) {
          // Qty bertambah / item baru: kurangi stok dengan validasi kecukupan
          const pRes = await client.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [pId]);
          if (pRes.rows.length === 0) {
            throw new Error(\`Produk dengan ID \${pId} tidak ditemukan\`);
          }
          const currentStock = parseFloat(pRes.rows[0].stock || 0);
          if (currentStock < delta) {
            throw new Error(\`Stok produk "\${pRes.rows[0].name}" tidak mencukupi untuk penambahan (\${delta} dibutuhkan, stok saat ini: \${currentStock})\`);
          }
          await client.query('UPDATE products SET stock = stock - ? WHERE id = ?', [delta, pId]);
        } else if (delta < 0) {
          // Qty berkurang / item dihapus: kembalikan selisih ke stok
          const returnQty = Math.abs(delta);
          await client.query('UPDATE products SET stock = stock + ? WHERE id = ?', [returnQty, pId]);
        }
      }`;

const putInvoicesDeltaReplacement = `      const allProductIds = new Set([...Object.keys(oldQtyMap), ...Object.keys(newQtyMap)]);

      // B3 Soft-Lock check for Invoice: check if any item qty decreased or item removed
      let hasInvReduction = false;
      for (const pId of Object.keys(oldQtyMap)) {
        const newQ = newQtyMap[pId] || 0;
        if (newQ < oldQtyMap[pId]) {
          hasInvReduction = true;
          break;
        }
      }
      const invCorrectionReason = req.body.correction_reason || req.body.reason || '';
      if (hasInvReduction) {
        if (req.user.role.toLowerCase() !== 'admin') {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Pengurangan jumlah item pada invoice yang sudah berjalan harus dicatat melalui Retur Penjualan. Hubungi Admin untuk koreksi salah input.'
          });
        }
        if (!invCorrectionReason.trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Koreksi salah input untuk pengurangan item invoice wajib menyertakan alasan.'
          });
        }
      }

      for (const pId of allProductIds) {
        const oldQty = oldQtyMap[pId] || 0;
        const newQty = newQtyMap[pId] || 0;
        const delta = newQty - oldQty;

        if (delta > 0) {
          // Qty bertambah / item baru: kurangi stok dengan validasi kecukupan
          const pRes = await client.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [pId]);
          if (pRes.rows.length === 0) {
            throw new Error(\`Produk dengan ID \${pId} tidak ditemukan\`);
          }
          const currentStock = parseFloat(pRes.rows[0].stock || 0);
          if (currentStock < delta) {
            throw new Error(\`Stok produk "\${pRes.rows[0].name}" tidak mencukupi untuk penambahan (\${delta} dibutuhkan, stok saat ini: \${currentStock})\`);
          }
          const nextStock = currentStock - delta;
          await client.query('UPDATE products SET stock = stock - ? WHERE id = ?', [delta, pId]);
          await recordStockMove(client, {
            product_id: pId,
            tanggal: invDate ? invDate + ' 12:00:00' : null,
            tipe: 'koreksi_edit',
            ref_type: 'invoice',
            ref_id: invId,
            ref_no: invId,
            qty_masuk: 0,
            qty_keluar: delta,
            qty_sebelum: currentStock,
            qty_sesudah: nextStock,
            keterangan: \`Koreksi Edit Invoice (tambah qty): \${invCorrectionReason || '-'}\`,
            created_by: req.user.id
          });
        } else if (delta < 0) {
          // Qty berkurang / item dihapus: kembalikan selisih ke stok
          const returnQty = Math.abs(delta);
          const pRes = await client.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [pId]);
          const currentStock = parseFloat(pRes.rows[0]?.stock || 0);
          const nextStock = currentStock + returnQty;
          await client.query('UPDATE products SET stock = stock + ? WHERE id = ?', [returnQty, pId]);
          await recordStockMove(client, {
            product_id: pId,
            tanggal: invDate ? invDate + ' 12:00:00' : null,
            tipe: 'koreksi_edit',
            ref_type: 'invoice',
            ref_id: invId,
            ref_no: invId,
            qty_masuk: returnQty,
            qty_keluar: 0,
            qty_sebelum: currentStock,
            qty_sesudah: nextStock,
            keterangan: \`Koreksi Edit Invoice (kurang qty): \${invCorrectionReason}\`,
            created_by: req.user.id
          });
        }
      }`;

if (code.includes(putInvoicesDeltaTarget)) {
  code = code.replace(putInvoicesDeltaTarget, putInvoicesDeltaReplacement);
  console.log('Hook 9: PUT /api/invoices/:id updated.');
} else {
  console.log('Hook 9: target not found or already patched.');
}

// -------------------------------------------------------------
// 10. Hook into PUT /api/invoices/:id/cancel
// -------------------------------------------------------------
const cancelInvoicesTarget = `    // 1. Restore product stock (HANYA untuk invoice non-outstanding import)
    if (!currentInv.is_outstanding_import) {
      const itemsRes = await client.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id = $1', [invId]);
      for (const item of itemsRes.rows) {
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
      }
    }`;

const cancelInvoicesReplacement = `    // 1. Restore product stock (HANYA untuk invoice non-outstanding import)
    if (!currentInv.is_outstanding_import) {
      const itemsRes = await client.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id = $1', [invId]);
      for (const item of itemsRes.rows) {
        const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
        const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
        const nextStock = curStock + parseFloat(item.quantity || 0);
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
        await recordStockMove(client, {
          product_id: item.product_id,
          tipe: 'cancel_invoice',
          ref_type: 'invoice',
          ref_id: invId,
          ref_no: invId,
          qty_masuk: parseFloat(item.quantity || 0),
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: \`Pembatalan Invoice \${invId}\`,
          created_by: req.user.id
        });
      }
    }`;

if (code.includes(cancelInvoicesTarget)) {
  code = code.replace(cancelInvoicesTarget, cancelInvoicesReplacement);
  console.log('Hook 10: PUT /api/invoices/:id/cancel updated.');
} else {
  console.log('Hook 10: target not found or already patched.');
}

// -------------------------------------------------------------
// 11. Hook into POST /api/products/:id/stock-adjustment
// -------------------------------------------------------------
const postProductStockAdjTarget = `    await client.query('INSERT INTO stock_adjustments (id, product_id, type, quantity, reason, adjustment_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [adjId, prodId, type, qty, reason, date, userId]);
    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [finalActual, prodId]);

    await client.query('COMMIT');`;

const postProductStockAdjReplacement = `    await client.query('INSERT INTO stock_adjustments (id, product_id, type, quantity, reason, adjustment_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [adjId, prodId, type, qty, reason, date, userId]);
    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [finalActual, prodId]);
    await recordStockMove(client, {
      product_id: prodId,
      tanggal: date ? date + ' 12:00:00' : null,
      tipe: 'opname',
      ref_type: 'stock_adjustment',
      ref_id: adjId,
      ref_no: adjId,
      qty_masuk: diff > 0 ? qty : 0,
      qty_keluar: diff < 0 ? qty : 0,
      qty_sebelum: systemStock,
      qty_sesudah: finalActual,
      keterangan: reason || 'Stock Opname',
      created_by: userId
    });

    await client.query('COMMIT');`;

if (code.includes(postProductStockAdjTarget)) {
  code = code.replace(postProductStockAdjTarget, postProductStockAdjReplacement);
  console.log('Hook 11: POST /api/products/:id/stock-adjustment updated.');
} else {
  console.log('Hook 11: target not found or already patched.');
}

// -------------------------------------------------------------
// 12. Hook into POST /api/proformas/:pk/convert
// -------------------------------------------------------------
const postProformaConvertTarget = `    // Insert invoice items & reduce stock
    for (const item of invoiceItems) {
      if (!item.id) continue;
      await client.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
      const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [item.id]);
      const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || 0);
      await client.query(
        \`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)\`,
        [Date.now().toString() + Math.floor(Math.random() * 1000), invoiceId, item.id,
         item.quantity, item.price, costSnapshot, item.customer_fee || 0, item.fee_notes || null]
      );
    }`;

const postProformaConvertReplacement = `    // Insert invoice items & reduce stock
    for (const item of invoiceItems) {
      if (!item.id) continue;
      const curRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.id]);
      const curStock = parseFloat(curRes.rows[0]?.stock || 0);
      const nextStock = curStock - item.quantity;
      await client.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
      const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [item.id]);
      const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || 0);
      await client.query(
        \`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)\`,
        [Date.now().toString() + Math.floor(Math.random() * 1000), invoiceId, item.id,
         item.quantity, item.price, costSnapshot, item.customer_fee || 0, item.fee_notes || null]
      );
      await recordStockMove(client, {
        product_id: item.id,
        tanggal: invoiceDateStr ? invoiceDateStr + ' 12:00:00' : null,
        tipe: 'penjualan',
        ref_type: 'invoice',
        ref_id: invoiceId,
        ref_no: invoiceId,
        qty_masuk: 0,
        qty_keluar: item.quantity,
        qty_sebelum: curStock,
        qty_sesudah: nextStock,
        keterangan: \`Penjualan Konversi Proforma \${invoiceId}\`,
        created_by: userId
      });
    }`;

if (code.includes(postProformaConvertTarget)) {
  code = code.replace(postProformaConvertTarget, postProformaConvertReplacement);
  console.log('Hook 12: POST /api/proformas/:pk/convert updated.');
} else {
  console.log('Hook 12: target not found or already patched.');
}

// Write intermediate changes
fs.writeFileSync(serverPath, code, 'utf8');
console.log('Saved all 12 hooks to server.js');

