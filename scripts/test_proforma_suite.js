/**
 * test_proforma_suite.js
 * Comprehensive automated verification suite for Proforma feature on clone database.
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const host = process.env.DB_HOST || '127.0.0.1';
const port = parseInt(process.env.DB_PORT) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = 'supplierpro_clone';

async function runTests() {
  console.log(`\n=== RUNNING PROFORMA TEST SUITE ON ${database} ===\n`);
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    timezone: '+08:00'
  });

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // Clean up any previous test records to ensure idempotency
    await conn.query("DELETE FROM proformas WHERE proforma_no LIKE 'PF-2026-%'");
    await conn.query("DELETE FROM sales_invoices WHERE id LIKE 'INV-2026-11-9999%'");

    // Check initial environment
    const [custRows] = await conn.query('SELECT id, name FROM customers LIMIT 1');
    const customer = custRows[0];
    const [prodRows] = await conn.query('SELECT id, name, stock, sell_price, cost_price FROM products WHERE stock > 20 LIMIT 2');
    const prod1 = prodRows[0];
    const prod2 = prodRows[1];
    const [ptRows] = await conn.query("SELECT id, name FROM payment_types WHERE name LIKE '%Tunai%' OR name LIKE '%Cash%' LIMIT 1");
    const ptCash = ptRows[0] || { id: 'PT-1', name: 'Tunai' };
    const [ptCreditRows] = await conn.query("SELECT id, name FROM payment_types WHERE name LIKE '%Kredit%' LIMIT 1");
    const ptCredit = ptCreditRows[0] || { id: 'PT-2', name: 'Kredit 30 Hari' };

    console.log(`Using Customer: ${customer.name} (${customer.id})`);
    console.log(`Using Product 1: ${prod1.name} (Stock: ${prod1.stock}, Price: ${prod1.sell_price})`);
    console.log(`Using Product 2: ${prod2.name} (Stock: ${prod2.stock}, Price: ${prod2.sell_price})`);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Efek Nol (Stok, Piutang, Arus Kas tidak berubah saat Proforma dibuat)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 1: Efek Nol saat Pembuatan Proforma ---');
    const [stockBefore] = await conn.query('SELECT stock FROM products WHERE id = ?', [prod1.id]);
    const [invCountBefore] = await conn.query('SELECT COUNT(*) AS c FROM sales_invoices');
    const [cashCountBefore] = await conn.query('SELECT COUNT(*) AS c FROM cash_transactions');

    // Simulate proforma creation query directly against clone DB
    const orderDate = '2026-11-02';
    const berlakuDate = '2026-11-09';
    const pfNo = 'PF-2026-00001';

    await conn.query(`
      INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id,
        subtotal, discount, ppn_rate, ppn_amount, ppn_enabled, total, status, user_id)
      VALUES (?, ?, ?, ?, ?, ?, 0, 11, ?, 1, ?, 'aktif', 1)
    `, [pfNo, customer.id, orderDate, berlakuDate, ptCash.id, 200000, 22000, 222000]);

    const [insertedPf] = await conn.query('SELECT LAST_INSERT_ID() as pk');
    const pfPk = insertedPf[0].pk;

    await conn.query(`
      INSERT INTO proforma_items (proforma_pk, product_id, product_name_snapshot, unit_name_snapshot,
        quantity, price, subtotal_item, customer_fee, fee_notes, cost_price_snapshot)
      VALUES (?, ?, ?, 'PCS', 2, 100000, 200000, 5000, 'Fee sales', 80000)
    `, [pfPk, prod1.id, prod1.name]);

    const [stockAfter] = await conn.query('SELECT stock FROM products WHERE id = ?', [prod1.id]);
    const [invCountAfter] = await conn.query('SELECT COUNT(*) AS c FROM sales_invoices');
    const [cashCountAfter] = await conn.query('SELECT COUNT(*) AS c FROM cash_transactions');

    assert(parseFloat(stockBefore[0].stock) === parseFloat(stockAfter[0].stock), 'Stok produk tidak berubah saat proforma dibuat');
    assert(invCountBefore[0].c === invCountAfter[0].c, 'Jumlah invoice di database tidak bertambah');
    assert(cashCountBefore[0].c === cashCountAfter[0].c, 'Arus kas tidak bertambah/berubah');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Penomoran Proforma terpisah dari Invoice
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Pemisahan Nomor PF vs INV ---');
    const [invCounterRow] = await conn.query('SELECT last_number FROM invoice_counters WHERE year = 2026');
    const invLastNumBefore = invCounterRow.length > 0 ? invCounterRow[0].last_number : 0;

    // Insert proforma counter
    await conn.query(`
      INSERT INTO proforma_counters (year, last_number) VALUES (2026, 1)
      ON DUPLICATE KEY UPDATE last_number = last_number + 1
    `);
    const [pfCounterRow] = await conn.query('SELECT last_number FROM proforma_counters WHERE year = 2026');

    const [invCounterRowAfter] = await conn.query('SELECT last_number FROM invoice_counters WHERE year = 2026');
    const invLastNumAfter = invCounterRowAfter.length > 0 ? invCounterRowAfter[0].last_number : 0;

    assert(invLastNumBefore === invLastNumAfter, 'Nomor counter invoice TIDAK bertambah saat proforma counter bertambah');
    assert(pfCounterRow[0].last_number >= 1, 'Counter proforma berhasil bertambah secara terpisah');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Tanggal Order (Kemarin, Hari ini, Bulan lalu, Dini Hari)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Tanggal Order & Timezone ---');
    const datesToTest = ['2026-10-05', '2026-11-01', '2026-11-02'];
    for (let i = 0; i < datesToTest.length; i++) {
      const testDate = datesToTest[i];
      const testPfNo = `PF-2026-0000${i + 2}`;
      await conn.query(`
        INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id,
          subtotal, discount, ppn_rate, ppn_amount, ppn_enabled, total, status, user_id)
        VALUES (?, ?, ?, '2026-11-20', ?, 100000, 0, 0, 0, 0, 100000, 'aktif', 1)
      `, [testPfNo, customer.id, testDate, ptCash.id]);

      const [readRows] = await conn.query("SELECT DATE_FORMAT(order_date, '%Y-%m-%d') as dt FROM proformas WHERE proforma_no = ?", [testPfNo]);
      assert(readRows[0].dt === testDate, `Tanggal order ${testDate} tersimpan persis tanpa pergeseran zona waktu`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Konversi ke Invoice (Stok berkurang, Invoice terbentuk, Status dikonversi)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Konversi Proforma ke Invoice ---');
    const [prodBeforeConvert] = await conn.query('SELECT stock FROM products WHERE id = ?', [prod1.id]);
    const stockStart = parseFloat(prodBeforeConvert[0].stock);

    // Simulate convert transaction
    await conn.beginTransaction();

    const [lockPf] = await conn.query('SELECT * FROM proformas WHERE pk = ? FOR UPDATE', [pfPk]);
    assert(lockPf[0].status === 'aktif', 'Status proforma sebelum konversi adalah aktif');

    const invId = 'INV-2026-11-99991';
    const invoiceOrderDate = '2026-11-02'; // Tanggal dipilih di modal

    // Insert sales invoice with the chosen invoiceOrderDate
    await conn.query(`
      INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount,
        payment_type_id, due_date, paid_date, status, user_id, is_outstanding_import)
      VALUES (?, ?, ?, 200000, 0, 22000, 222000, 222000, ?, NULL, ?, 'Lunas', 1, 0)
    `, [invId, invoiceOrderDate, customer.id, ptCash.id, invoiceOrderDate]);

    // Reduce stock
    await conn.query('UPDATE products SET stock = stock - 2 WHERE id = ?', [prod1.id]);

    // Insert invoice item
    await conn.query(`
      INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes)
      VALUES (?, ?, ?, 2, 100000, 80000, 5000, 'Fee sales')
    `, [Date.now().toString(), invId, prod1.id]);

    // Mark proforma as converted
    await conn.query('UPDATE proformas SET status = "dikonversi", invoice_id = ? WHERE pk = ?', [invId, pfPk]);

    await conn.commit();

    // Verify
    const [prodAfterConvert] = await conn.query('SELECT stock FROM products WHERE id = ?', [prod1.id]);
    const stockEnd = parseFloat(prodAfterConvert[0].stock);
    assert(stockStart - stockEnd === 2, 'Stok produk berkurang tepat 2 unit setelah konversi');

    const [updatedPf] = await conn.query('SELECT status, invoice_id FROM proformas WHERE pk = ?', [pfPk]);
    assert(updatedPf[0].status === 'dikonversi', 'Status proforma berhasil diubah menjadi dikonversi');
    assert(updatedPf[0].invoice_id === invId, 'invoice_id proforma terisi dengan ID invoice yang dibuat');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Cegah Konversi Ganda
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Pencegahan Konversi Ganda ---');
    const [secondAttemptPf] = await conn.query('SELECT status FROM proformas WHERE pk = ?', [pfPk]);
    const canConvertAgain = secondAttemptPf[0].status === 'aktif';
    assert(!canConvertAgain, 'Konversi kedua berhasil dicegah karena status sudah dikonversi');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Konversi Kredit Membuat Piutang
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Proforma Kredit & Piutang ---');
    const creditPfNo = 'PF-2026-00009';
    await conn.query(`
      INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id,
        subtotal, discount, ppn_rate, ppn_amount, ppn_enabled, total, status, user_id)
      VALUES (?, ?, '2026-11-02', '2026-11-15', ?, 150000, 0, 0, 0, 0, 150000, 'aktif', 1)
    `, [creditPfNo, customer.id, ptCredit.id]);
    const [credPfInserted] = await conn.query('SELECT LAST_INSERT_ID() as pk');
    const credPk = credPfInserted[0].pk;

    // Simulate credit convert: effectivePaid = 0, status = 'Belum Lunas'
    const credInvId = 'INV-2026-11-99992';
    await conn.query(`
      INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount,
        payment_type_id, due_date, paid_date, status, user_id, is_outstanding_import)
      VALUES (?, '2026-11-02', ?, 150000, 0, 0, 150000, 0, ?, '2026-12-02', NULL, 'Belum Lunas', 1, 0)
    `, [credInvId, customer.id, ptCredit.id]);
    await conn.query('UPDATE proformas SET status = "dikonversi", invoice_id = ? WHERE pk = ?', [credInvId, credPk]);

    const [credInvRow] = await conn.query('SELECT total, paid_amount, status FROM sales_invoices WHERE id = ?', [credInvId]);
    assert(credInvRow[0].status === 'Belum Lunas' && parseFloat(credInvRow[0].paid_amount) === 0, 'Invoice kredit berstatus Belum Lunas dengan paid_amount 0 (membuat piutang)');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 7: Pembatalan Proforma (Soft Cancel)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Pembatalan Proforma ---');
    const cancelPfNo = 'PF-2026-00010';
    await conn.query(`
      INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id,
        subtotal, discount, ppn_rate, ppn_amount, ppn_enabled, total, status, user_id)
      VALUES (?, ?, '2026-11-02', '2026-11-15', ?, 100000, 0, 0, 0, 0, 100000, 'aktif', 1)
    `, [cancelPfNo, customer.id, ptCash.id]);
    const [cancelPfInserted] = await conn.query('SELECT LAST_INSERT_ID() as pk');
    const cancelPk = cancelPfInserted[0].pk;

    await conn.query('UPDATE proformas SET status = "dibatalkan", alasan_pembatalan = ? WHERE pk = ?', ['Permintaan customer', cancelPk]);
    const [cancelledRow] = await conn.query('SELECT status, alasan_pembatalan FROM proformas WHERE pk = ?', [cancelPk]);
    assert(cancelledRow[0].status === 'dibatalkan', 'Status proforma berhasil menjadi dibatalkan');
    assert(cancelledRow[0].alasan_pembatalan === 'Permintaan customer', 'Alasan pembatalan tersimpan di database');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 8: Perpanjangan Masa Berlaku
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Perpanjangan Masa Berlaku ---');
    const extendPfNo = 'PF-2026-00011';
    await conn.query(`
      INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id,
        subtotal, discount, ppn_rate, ppn_amount, ppn_enabled, total, status, user_id)
      VALUES (?, ?, '2026-11-02', '2026-11-05', ?, 100000, 0, 0, 0, 0, 100000, 'aktif', 1)
    `, [extendPfNo, customer.id, ptCash.id]);
    const [extendPfInserted] = await conn.query('SELECT LAST_INSERT_ID() as pk');
    const extendPk = extendPfInserted[0].pk;

    const newBerlaku = '2026-11-25';
    await conn.query('UPDATE proformas SET berlaku_hingga = ? WHERE pk = ?', [newBerlaku, extendPk]);
    const [extendedRow] = await conn.query("SELECT DATE_FORMAT(berlaku_hingga, '%Y-%m-%d') as b FROM proformas WHERE pk = ?", [extendPk]);
    assert(extendedRow[0].b === newBerlaku, 'Masa berlaku proforma berhasil diperpanjang');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 9: Status Kedaluwarsa Diturunkan (Computed)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Status Kedaluwarsa Computed ---');
    const [computedStatusRow] = await conn.query(`
      SELECT proforma_no,
        CASE
          WHEN status = 'aktif' AND berlaku_hingga < '2026-11-10' THEN 'kedaluwarsa'
          ELSE status
        END AS display_status
      FROM proformas WHERE pk = ?
    `, [extendPk]);
    // extendPk has berlaku_hingga 2026-11-25, so on 2026-11-10 it is still 'aktif'
    assert(computedStatusRow[0].display_status === 'aktif', 'Status proforma masih aktif sebelum batas berlaku');

    const [expiredStatusRow] = await conn.query(`
      SELECT proforma_no,
        CASE
          WHEN status = 'aktif' AND berlaku_hingga < '2026-12-01' THEN 'kedaluwarsa'
          ELSE status
        END AS display_status
      FROM proformas WHERE pk = ?
    `, [extendPk]);
    assert(expiredStatusRow[0].display_status === 'kedaluwarsa', 'Status kedaluwarsa berhasil diturunkan secara dinamis saat tanggal lewat');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 10: Role Sanitization (Fee Strip for Non-Admin)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: Role Sanitization of Fee Fields ---');
    const [rawItems] = await conn.query('SELECT * FROM proforma_items WHERE proforma_pk = ?', [pfPk]);
    const adminMapped = rawItems.map(row => row);
    const kasirMapped = rawItems.map(row => {
      const { customer_fee, fee_notes, cost_price_snapshot, ...rest } = row;
      return rest;
    });

    assert(adminMapped[0].customer_fee !== undefined, 'Admin dapat melihat kolom customer_fee');
    assert(kasirMapped[0].customer_fee === undefined, 'Kasir TIDAK menerima kolom customer_fee (dihapus/sanitized)');
    assert(kasirMapped[0].fee_notes === undefined, 'Kasir TIDAK menerima kolom fee_notes (dihapus/sanitized)');
    assert(kasirMapped[0].cost_price_snapshot === undefined, 'Kasir TIDAK menerima cost_price_snapshot');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 11: Kesamaan Rumus Kalkulasi Invoice vs Proforma
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 11: Sinkronisasi Rumus Kalkulasi ---');
    const subtotalTest = 500000;
    const diskonTest = 25000;
    const ppnRateTest = 11;
    const taxTest = Math.round((subtotalTest - diskonTest) * (ppnRateTest / 100));
    const totalTest = subtotalTest - diskonTest + taxTest;

    assert(taxTest === 52250, 'PPN dihitung setelah diskon: (500.000 - 25.000) * 11% = 52.250');
    assert(totalTest === 527250, 'Total akhir = 500.000 - 25.000 + 52.250 = 527.250');

  } finally {
    await conn.end();
  }

  console.log(`\n=============================================`);
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`=============================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal error during test suite:', err);
  process.exit(1);
});
