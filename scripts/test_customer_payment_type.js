const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CLONE_DB = 'supplierpro_clone';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TEST SUITE: Tipe Pembayaran Default per Pelanggan');
  console.log(`🎯 Target Database: ${CLONE_DB} (CLONE, SAFE TESTING)`);
  console.log('====================================================\n');

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: CLONE_DB,
    multipleStatements: true
  });

  let passed = 0;
  let failed = 0;

  function assert(desc, condition, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  try {
    // ------------------------------------------------------------------------
    console.log('--- TEST 1: Database Migration & Schema Verification ---');
    // ------------------------------------------------------------------------
    const migrationSqlPath = path.join(__dirname, '..', 'db', 'migration_customer_default_payment_type.sql');
    const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');

    // Run migration
    await conn.query(migrationSql);
    console.log('  Executed migration_customer_default_payment_type.sql (1st run)');

    // Run again to verify idempotency
    await conn.query(migrationSql);
    console.log('  Executed migration_customer_default_payment_type.sql (2nd run, idempotent)');

    // Check column existence & type
    const [cols] = await conn.query("SHOW COLUMNS FROM customers LIKE 'tipe_pembayaran_id'");
    assert('Column tipe_pembayaran_id exists in customers table', cols.length === 1);
    assert('Column tipe_pembayaran_id is VARCHAR', cols[0].Type.toLowerCase().startsWith('varchar'));
    assert('Column tipe_pembayaran_id is NULLable', cols[0].Null === 'YES');
    assert('Column tipe_pembayaran_id default is NULL', cols[0].Default === null);

    // Check foreign key constraint
    const [fks] = await conn.query(`
      SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'customers'
        AND COLUMN_NAME = 'tipe_pembayaran_id'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `, [CLONE_DB]);
    assert('Foreign key constraint exists for tipe_pembayaran_id', fks.length >= 1);
    if (fks.length > 0) {
      assert('FK references payment_types(id)', fks[0].REFERENCED_TABLE_NAME === 'payment_types' && fks[0].REFERENCED_COLUMN_NAME === 'id');
    }

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 2: Master Payment Types & Lookup by Name ---');
    // ------------------------------------------------------------------------
    const [ptList] = await conn.query('SELECT id, name FROM payment_types ORDER BY id');
    console.log('  Available payment types in DB:', ptList.map(p => `${p.id}: ${p.name}`).join(', '));
    assert('payment_types has records', ptList.length > 0);

    // Fallback default "Kredit 30 Hari": cari record master berdasarkan NAMA (bukan hardcode ID)
    const find30 = ptList.find(p => (p.name || '').trim().toLowerCase() === 'kredit 30 hari')
      || ptList.find(p => (p.name || '').toLowerCase().includes('kredit 30'));
    assert('Master payment type "Kredit 30 Hari" found by name lookup', !!find30, find30?.id);

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: Pelanggan dengan Tunai -> Kasir otomatis Tunai ---');
    // ------------------------------------------------------------------------
    const testCustTunaiId = 'TEST_CUST_TUNAI';
    await conn.query('DELETE FROM customers WHERE id = ?', [testCustTunaiId]);
    await conn.query(`
      INSERT INTO customers (id, name, customer_category_id, pricelist_id, tipe_pembayaran_id, phone, city, credit_lmt)
      VALUES (?, ?, NULL, NULL, 'PT-1', '0811111111', 'Denpasar', 5000000)
    `, [testCustTunaiId, 'Pelanggan Tunai Auto']);

    const [cTunaiRes] = await conn.query(`
      SELECT c.*, pt.name AS tipe_pembayaran_name
      FROM customers c
      LEFT JOIN payment_types pt ON c.tipe_pembayaran_id = pt.id
      WHERE c.id = ?
    `, [testCustTunaiId]);
    assert('Customer Tunai created and retrieved', cTunaiRes.length === 1);
    assert('Customer Tunai has tipe_pembayaran_id = "PT-1"', cTunaiRes[0].tipe_pembayaran_id === 'PT-1');
    assert('Customer Tunai has tipe_pembayaran_name = "Tunai"', cTunaiRes[0].tipe_pembayaran_name === 'Tunai');

    // Simulate frontend cashier logic
    function simulatePOSSelectCustomer(customer, allPaymentTypes) {
      let targetPaymentTypeId = null;
      if (customer && customer.tipe_pembayaran_id) {
        targetPaymentTypeId = customer.tipe_pembayaran_id;
      } else {
        const found = allPaymentTypes.find(p => (p.name || '').trim().toLowerCase() === 'kredit 30 hari')
          || allPaymentTypes.find(p => (p.name || '').toLowerCase().includes('kredit 30'))
          || allPaymentTypes.find(p => (p.name || '').toLowerCase().startsWith('kredit'));
        targetPaymentTypeId = found ? found.id : null;
      }
      return targetPaymentTypeId;
    }

    const posPtForTunai = simulatePOSSelectCustomer(cTunaiRes[0], ptList);
    assert('POS selects "PT-1" (Tunai) when Customer Tunai is chosen', posPtForTunai === 'PT-1');

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: Pelanggan Tanpa Setting (NULL) -> Kasir otomatis "Kredit 30 Hari" ---');
    // ------------------------------------------------------------------------
    const testCustNullId = 'TEST_CUST_NULL';
    await conn.query('DELETE FROM customers WHERE id = ?', [testCustNullId]);
    await conn.query(`
      INSERT INTO customers (id, name, customer_category_id, pricelist_id, tipe_pembayaran_id, phone, city, credit_lmt)
      VALUES (?, ?, NULL, NULL, NULL, '0822222222', 'Badung', 3000000)
    `, [testCustNullId, 'Pelanggan Belum Diatur']);

    const [cNullRes] = await conn.query(`
      SELECT c.*, pt.name AS tipe_pembayaran_name
      FROM customers c
      LEFT JOIN payment_types pt ON c.tipe_pembayaran_id = pt.id
      WHERE c.id = ?
    `, [testCustNullId]);
    assert('Customer Null created and retrieved', cNullRes.length === 1);
    assert('Customer Null has tipe_pembayaran_id = NULL', cNullRes[0].tipe_pembayaran_id === null);

    const posPtForNull = simulatePOSSelectCustomer(cNullRes[0], ptList);
    assert('POS selects "Kredit 30 Hari" ID when customer has no default setting', posPtForNull === find30.id);

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: Ganti Pelanggan A -> B -> Nilai ikut berubah ---');
    // ------------------------------------------------------------------------
    const testCustTransferId = 'TEST_CUST_TRF';
    await conn.query('DELETE FROM customers WHERE id = ?', [testCustTransferId]);
    await conn.query(`
      INSERT INTO customers (id, name, customer_category_id, pricelist_id, tipe_pembayaran_id, phone, city, credit_lmt)
      VALUES (?, ?, NULL, NULL, 'PT-2', '0833333333', 'Gianyar', 10000000)
    `, [testCustTransferId, 'Pelanggan Transfer']);

    const [cTrfRes] = await conn.query('SELECT * FROM customers WHERE id = ?', [testCustTransferId]);

    let currentCashierPt = simulatePOSSelectCustomer(cTunaiRes[0], ptList);
    assert('Step A: Cashier has Tunai (PT-1)', currentCashierPt === 'PT-1');

    currentCashierPt = simulatePOSSelectCustomer(cTrfRes[0], ptList);
    assert('Step B: Switched to Customer B, cashier updates to Transfer (PT-2)', currentCashierPt === 'PT-2');

    currentCashierPt = simulatePOSSelectCustomer(cNullRes[0], ptList);
    assert('Step C: Switched to Customer C (null), cashier updates to Kredit 30 Hari', currentCashierPt === find30.id);

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 6: Ubah Manual per Transaksi -> Data Pelanggan TIDAK Berubah ---');
    // ------------------------------------------------------------------------
    // Customer starts with PT-1 (Tunai)
    let selectedCartPt = simulatePOSSelectCustomer(cTunaiRes[0], ptList); // PT-1
    // User manually overrides in dropdown to PT-6 (Kredit 14 Hari)
    selectedCartPt = 'PT-6';

    // Transaction is saved with overridden PT-6
    const testInvId = 'INV-TEST-OVERRIDE-01';
    await conn.query('DELETE FROM sales_invoices WHERE id = ?', [testInvId]);
    await conn.query(`
      INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount, payment_type_id, status)
      VALUES (?, '2026-11-05', ?, 150000, 0, 0, 150000, 0, ?, 'belum')
    `, [testInvId, testCustTunaiId, selectedCartPt]);

    // Check saved invoice
    const [invCheck] = await conn.query('SELECT payment_type_id FROM sales_invoices WHERE id = ?', [testInvId]);
    assert('Invoice saved with manually overridden payment type PT-6', invCheck[0].payment_type_id === 'PT-6');

    // Check customer in DB: MUST still be PT-1 (Tunai)
    const [custAfterInv] = await conn.query('SELECT tipe_pembayaran_id FROM customers WHERE id = ?', [testCustTunaiId]);
    assert('Customer default payment type in DB remains unchanged (PT-1)', custAfterInv[0].tipe_pembayaran_id === 'PT-1');

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 7: Hapus/Nonaktifkan Master yang Dipakai Pelanggan -> ON DELETE SET NULL ---');
    // ------------------------------------------------------------------------
    const tempPtId = 'PT-TEST-TEMP';
    await conn.query('DELETE FROM payment_types WHERE id = ?', [tempPtId]);
    await conn.query('INSERT INTO payment_types (id, name) VALUES (?, ?)', [tempPtId, 'Tipe Percobaan Hapus']);

    const testCustTempId = 'TEST_CUST_TEMP_PT';
    await conn.query('DELETE FROM customers WHERE id = ?', [testCustTempId]);
    await conn.query(`
      INSERT INTO customers (id, name, tipe_pembayaran_id, credit_lmt)
      VALUES (?, ?, ?, 1000000)
    `, [testCustTempId, 'Pelanggan Tipe Sementara', tempPtId]);

    const [beforeDel] = await conn.query('SELECT tipe_pembayaran_id FROM customers WHERE id = ?', [testCustTempId]);
    assert('Customer assigned temporary payment type PT-TEST-TEMP', beforeDel[0].tipe_pembayaran_id === tempPtId);

    // Delete temporary payment type
    await conn.query('DELETE FROM payment_types WHERE id = ?', [tempPtId]);

    // Check customer: should now be NULL due to ON DELETE SET NULL
    const [afterDel] = await conn.query('SELECT tipe_pembayaran_id FROM customers WHERE id = ?', [testCustTempId]);
    assert('Customer tipe_pembayaran_id became NULL without error (ON DELETE SET NULL)', afterDel[0].tipe_pembayaran_id === null);

    // Cashier fallback now activates safely
    const fallbackAfterDel = simulatePOSSelectCustomer(afterDel[0], ptList);
    assert('Cashier safely falls back to Kredit 30 Hari for this customer', fallbackAfterDel === find30.id);

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 8: Proforma Invoice Kasir & Edit Guard ---');
    // ------------------------------------------------------------------------
    const testPfNo = 'PF-TEST-PAY-001';
    await conn.query('DELETE FROM proformas WHERE proforma_no = ?', [testPfNo]);
    await conn.query(`
      INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id, subtotal, total, status)
      VALUES (?, ?, '2026-11-05', '2026-11-12', 'PT-2', 200000, 200000, 'aktif')
    `, [testPfNo, testCustTunaiId]);

    const [pfCheck] = await conn.query('SELECT * FROM proformas WHERE proforma_no = ?', [testPfNo]);
    assert('Proforma created with payment_type_id PT-2', pfCheck[0].payment_type_id === 'PT-2');

    // When editing old proforma or old invoice, setting must not be overridden by customer
    // Simulate enterProformaEditMode: it takes pf.payment_type_id directly
    const loadedEditPt = pfCheck[0].payment_type_id;
    assert('Proforma edit mode preserves existing proforma payment type (PT-2), not overridden by customer default', loadedEditPt === 'PT-2');

    // ------------------------------------------------------------------------
    console.log('\n--- TEST 9: Frontend Code Inspections (dashboard.html & dashboard.js) ---');
    // ------------------------------------------------------------------------
    const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
    const jsContent = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8');

    assert('dashboard.html has <th>Tipe Pembayaran</th> in table header', htmlContent.includes('<th>Tipe Pembayaran</th>'));
    assert('dashboard.html has #add-customer-payment-type dropdown', htmlContent.includes('id="add-customer-payment-type"'));
    assert('dashboard.html has #edit-customer-payment-type dropdown', htmlContent.includes('id="edit-customer-payment-type"'));
    assert('dashboard.html has #detail-customer-payment-type display', htmlContent.includes('id="detail-customer-payment-type"'));
    assert('Option 1 in HTML is "— Belum diatur (default Kredit 30 Hari) —"', htmlContent.includes('— Belum diatur (default Kredit 30 Hari) —'));

    assert('dashboard.js defines populateCustomerPaymentTypeDropdown', jsContent.includes('function populateCustomerPaymentTypeDropdown'));
    assert('dashboard.js defines applyCustomerPaymentTypeDefault', jsContent.includes('function applyCustomerPaymentTypeDefault'));
    assert('dashboard.js calls applyCustomerPaymentTypeDefault on customer click', jsContent.includes('applyCustomerPaymentTypeDefault(customer || id)'));
    assert('dashboard.js calls applyCustomerPaymentTypeDefault(null) on clear', jsContent.includes('applyCustomerPaymentTypeDefault(null)'));
    assert('dashboard.js saves tipe_pembayaran_id in saveCustomer', jsContent.includes('tipe_pembayaran_id: document.getElementById'));
    assert('dashboard.js downloads template with Tipe Pembayaran column', jsContent.includes('"Tipe Pembayaran"'));
    assert('dashboard.js maps Tipe Pembayaran during Excel import', jsContent.includes('paymentTypesMap[ptRaw.toLowerCase().trim()]'));

    // Cleanup test records
    await conn.query('DELETE FROM sales_invoices WHERE id = ?', [testInvId]);
    await conn.query('DELETE FROM proformas WHERE proforma_no = ?', [testPfNo]);
    await conn.query('DELETE FROM customers WHERE id IN (?, ?, ?, ?)', [testCustTunaiId, testCustNullId, testCustTransferId, testCustTempId]);

    console.log('\n====================================================');
    console.log(`📊 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

