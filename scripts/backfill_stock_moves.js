const mysql = require('mysql2/promise');

async function runBackfill(dbName = 'supplierpro_clone', dryRun = false) {
  console.log(`Starting stock_moves backfill on database: ${dbName} (dryRun: ${dryRun})...`);
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: dbName
  });

  try {
    // 1. Check if backfill already done
    const [existing] = await conn.query('SELECT COUNT(*) as count FROM stock_moves WHERE is_backfill = 1');
    if (existing[0].count > 0 && !dryRun) {
      console.log(`stock_moves already has ${existing[0].count} backfilled rows. Clearing old backfill rows...`);
      await conn.query('DELETE FROM stock_moves WHERE is_backfill = 1');
    }

    // 2. Fetch all products
    const [products] = await conn.query('SELECT id, name, stock FROM products ORDER BY id ASC');
    console.log(`Found ${products.length} products to process.`);

    // 3. Fetch all PO items
    const [poItems] = await conn.query(`
      SELECT poi.product_id, poi.quantity, po.id as po_id, po.date, po.status, po.user_id
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      ORDER BY po.date ASC, po.id ASC
    `);

    // 4. Fetch all Invoice items (non-outstanding)
    const [invItems] = await conn.query(`
      SELECT ii.product_id, ii.quantity, si.id as invoice_id, si.date, si.status, si.user_id
      FROM invoice_items ii
      JOIN sales_invoices si ON si.id = ii.invoice_id
      WHERE si.is_outstanding_import = 0
      ORDER BY si.date ASC, si.id ASC
    `);

    // 5. Fetch all Stock Adjustments
    const [adjustments] = await conn.query(`
      SELECT id, product_id, type, quantity, reason, adjustment_date, user_id
      FROM stock_adjustments
      ORDER BY adjustment_date ASC, id ASC
    `);

    // Group events per product
    const productEvents = {};
    for (const p of products) {
      productEvents[p.id] = [];
    }

    for (const poi of poItems) {
      if (!productEvents[poi.product_id]) continue;
      const dateStr = poi.date ? new Date(poi.date).toISOString().slice(0, 10) + ' 10:00:00' : '2026-01-01 10:00:00';
      productEvents[poi.product_id].push({
        tanggal: dateStr,
        tipe: 'pembelian',
        ref_type: 'purchase_order',
        ref_id: poi.po_id,
        ref_no: poi.po_id,
        qty_masuk: parseFloat(poi.quantity || 0),
        qty_keluar: 0,
        keterangan: `Pembelian PO ${poi.po_id}`,
        created_by: poi.user_id
      });

      if (poi.status === 'Batal') {
        productEvents[poi.product_id].push({
          tanggal: dateStr,
          tipe: 'koreksi_edit',
          ref_type: 'purchase_order',
          ref_id: poi.po_id,
          ref_no: poi.po_id,
          qty_masuk: 0,
          qty_keluar: parseFloat(poi.quantity || 0),
          keterangan: `Pembatalan PO ${poi.po_id}`,
          created_by: poi.user_id
        });
      }
    }

    for (const inv of invItems) {
      if (!productEvents[inv.product_id]) continue;
      const dateStr = inv.date ? new Date(inv.date).toISOString().slice(0, 10) + ' 14:00:00' : '2026-01-01 14:00:00';
      productEvents[inv.product_id].push({
        tanggal: dateStr,
        tipe: 'penjualan',
        ref_type: 'invoice',
        ref_id: inv.invoice_id,
        ref_no: inv.invoice_id,
        qty_masuk: 0,
        qty_keluar: parseFloat(inv.quantity || 0),
        keterangan: `Penjualan Invoice ${inv.invoice_id}`,
        created_by: inv.user_id
      });

      if (inv.status === 'Cancel' || inv.status === 'Batal') {
        productEvents[inv.product_id].push({
          tanggal: dateStr,
          tipe: 'cancel_invoice',
          ref_type: 'invoice',
          ref_id: inv.invoice_id,
          ref_no: inv.invoice_id,
          qty_masuk: parseFloat(inv.quantity || 0),
          qty_keluar: 0,
          keterangan: `Pembatalan Invoice ${inv.invoice_id}`,
          created_by: inv.user_id
        });
      }
    }

    for (const adj of adjustments) {
      if (!productEvents[adj.product_id]) continue;
      const dateStr = adj.adjustment_date ? new Date(adj.adjustment_date).toISOString().slice(0, 10) + ' 12:00:00' : '2026-01-01 12:00:00';
      const isIN = adj.type === 'IN';
      productEvents[adj.product_id].push({
        tanggal: dateStr,
        tipe: 'opname',
        ref_type: 'stock_adjustment',
        ref_id: adj.id,
        ref_no: adj.id,
        qty_masuk: isIN ? parseFloat(adj.quantity || 0) : 0,
        qty_keluar: isIN ? 0 : parseFloat(adj.quantity || 0),
        keterangan: adj.reason || 'Stock Opname',
        created_by: adj.user_id
      });
    }

    let totalMovesInserted = 0;
    let balancingMovesInserted = 0;
    const unusualDiffs = [];

    for (const p of products) {
      const currentStock = parseFloat(p.stock || 0);
      const events = productEvents[p.id];

      // Sort events chronologically
      events.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

      // Calculate net from historical transactions
      let netHistorical = 0;
      for (const ev of events) {
        netHistorical += (ev.qty_masuk - ev.qty_keluar);
      }

      // Difference between current actual stock and historical net
      const diff = currentStock - netHistorical;
      const movesToInsert = [];

      let runningStock = 0;

      // If diff != 0, insert stok_awal balancing move at the very beginning
      if (diff !== 0) {
        runningStock = diff;
        const firstDate = events.length > 0 ? events[0].tanggal : '2026-01-01 08:00:00';
        movesToInsert.push({
          product_id: p.id,
          tanggal: firstDate,
          tipe: 'stok_awal',
          ref_type: 'stok_awal',
          ref_id: p.id,
          ref_no: p.id,
          qty_masuk: diff > 0 ? diff : 0,
          qty_keluar: diff < 0 ? Math.abs(diff) : 0,
          qty_sebelum: 0,
          qty_sesudah: diff,
          keterangan: 'Stok Awal (Penyeimbang Backfill)',
          created_by: null,
          is_backfill: 1
        });
        balancingMovesInserted++;

        if (diff < 0) {
          unusualDiffs.push({
            id: p.id,
            name: p.name,
            currentStock,
            netHistorical,
            diff,
            reason: 'Stok negatif atau transaksi keluar melebihi stok'
          });
        }
      }

      for (const ev of events) {
        const prev = runningStock;
        runningStock = runningStock + ev.qty_masuk - ev.qty_keluar;
        movesToInsert.push({
          product_id: p.id,
          tanggal: ev.tanggal,
          tipe: ev.tipe,
          ref_type: ev.ref_type,
          ref_id: ev.ref_id,
          ref_no: ev.ref_no,
          qty_masuk: ev.qty_masuk,
          qty_keluar: ev.qty_keluar,
          qty_sebelum: prev,
          qty_sesudah: runningStock,
          keterangan: ev.keterangan,
          created_by: ev.created_by,
          is_backfill: 1
        });
      }

      if (!dryRun && movesToInsert.length > 0) {
        for (const m of movesToInsert) {
          await conn.query(`
            INSERT INTO stock_moves (
              product_id, tanggal, tipe, ref_type, ref_id, ref_no,
              qty_masuk, qty_keluar, qty_sebelum, qty_sesudah,
              keterangan, created_by, is_backfill
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `, [
            m.product_id, m.tanggal, m.tipe, m.ref_type, m.ref_id, m.ref_no,
            m.qty_masuk, m.qty_keluar, m.qty_sebelum, m.qty_sesudah,
            m.keterangan, m.created_by
          ]);
          totalMovesInserted++;
        }
      } else {
        totalMovesInserted += movesToInsert.length;
      }
    }

    console.log(`Backfill finished!`);
    console.log(`Total stock moves: ${totalMovesInserted}`);
    console.log(`Balancing moves created: ${balancingMovesInserted}`);
    console.log(`Unusual differences count: ${unusualDiffs.length}`);
    if (unusualDiffs.length > 0) {
      console.log('Unusual differences:', JSON.stringify(unusualDiffs, null, 2));
    }

    return { totalMovesInserted, balancingMovesInserted, unusualDiffs };
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  const targetDb = process.argv[2] || 'supplierpro_clone';
  const dry = process.argv[3] === '--dry';
  runBackfill(targetDb, dry).catch(err => {
    console.error('Backfill error:', err);
    process.exit(1);
  });
}

module.exports = { runBackfill };

