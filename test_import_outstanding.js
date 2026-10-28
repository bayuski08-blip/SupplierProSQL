require('dotenv').config();
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const BASE_URL = 'http://localhost:3000';

const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: 'Admin Test' }, SECRET_KEY, { expiresIn: '1h' });
const financeToken = jwt.sign({ id: 3, username: 'demo_finance', role: 'finance', name: 'Finance Test' }, SECRET_KEY, { expiresIn: '1h' });
const kasirToken = jwt.sign({ id: 5, username: 'demo_kasir', role: 'kasir', name: 'Kasir Test' }, SECRET_KEY, { expiresIn: '1h' });
const gudangToken = jwt.sign({ id: 4, username: 'demo_gudang', role: 'gudang', name: 'Gudang Test' }, SECRET_KEY, { expiresIn: '1h' });

async function api(path, method = 'GET', body = null, token = adminToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('=== STARTING OUTSTANDING INVOICE IMPORT TESTS ===\n');

  const db = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/supplierpro');

  try {
    // 1. RBAC Tests
    console.log('1. Testing RBAC for /api/invoices/import-outstanding:');
    const resKasir = await api('/api/invoices/import-outstanding', 'POST', { invoices: [] }, kasirToken);
    console.assert(resKasir.status === 403, `Kasir expected 403, got ${resKasir.status}`);
    console.log('   [PASS] Kasir blocked with 403');

    const resGudang = await api('/api/invoices/import-outstanding', 'POST', { invoices: [] }, gudangToken);
    console.assert(resGudang.status === 403, `Gudang expected 403, got ${resGudang.status}`);
    console.log('   [PASS] Gudang blocked with 403');

    // 2. Validation: Empty batch
    console.log('\n2. Testing Validation: Empty batch');
    const resEmpty = await api('/api/invoices/import-outstanding', 'POST', { invoices: [] }, financeToken);
    console.assert(resEmpty.status === 400, `Empty batch expected 400, got ${resEmpty.status}`);
    console.log('   [PASS] Empty batch rejected (400)');

    // 3. Validation: Customer not found
    console.log('\n3. Testing Validation: Non-existent customer');
    const resNoCust = await api('/api/invoices/import-outstanding', 'POST', {
      invoices: [{
        customer_name: 'Customer Khayalan ' + Date.now(),
        total: 1000000,
        total_dibayar: 200000
      }]
    }, financeToken);
    console.assert(resNoCust.status === 400 && resNoCust.data.error.includes('tidak ditemukan'), `Expected customer not found, got: ${JSON.stringify(resNoCust.data)}`);
    console.log('   [PASS] Non-existent customer rejected:', resNoCust.data.error);

    // 4. Validation: Total Dibayar == Total (Bukan outstanding / sudah lunas)
    console.log('\n4. Testing Validation: total_dibayar == total (bukan outstanding)');
    const [custRow] = await db.query('SELECT id, name FROM customers LIMIT 1');
    const customer = custRow[0];

    const resLunas = await api('/api/invoices/import-outstanding', 'POST', {
      invoices: [{
        customer_id: customer.id,
        total: 2500000,
        total_dibayar: 2500000
      }]
    }, financeToken);
    console.assert(resLunas.status === 400 && resLunas.data.error.includes('bukan outstanding'), `Expected bukan outstanding error, got: ${JSON.stringify(resLunas.data)}`);
    console.log('   [PASS] Already paid invoice rejected:', resLunas.data.error);

    // 5. Validation: Overpayment (total_dibayar > total)
    console.log('\n5. Testing Validation: total_dibayar > total (overpayment)');
    const resOver = await api('/api/invoices/import-outstanding', 'POST', {
      invoices: [{
        customer_id: customer.id,
        total: 1000000,
        total_dibayar: 1500000
      }]
    }, financeToken);
    console.assert(resOver.status === 400 && resOver.data.error.includes('melebihi total tagihan'), `Expected overpayment error, got: ${JSON.stringify(resOver.data)}`);
    console.log('   [PASS] Overpayment rejected:', resOver.data.error);

    // 6. Validation: Future payment date
    console.log('\n6. Testing Validation: Future payment date');
    const resFuture = await api('/api/invoices/import-outstanding', 'POST', {
      invoices: [{
        customer_id: customer.id,
        total: 1000000,
        total_dibayar: 500000,
        last_payment_date: '2099-01-01'
      }]
    }, financeToken);
    console.assert(resFuture.status === 400 && resFuture.data.error.includes('di masa depan'), `Expected future date error, got: ${JSON.stringify(resFuture.data)}`);
    console.log('   [PASS] Future payment date rejected:', resFuture.data.error);

    // 7. Transactional Rollback (All-or-Nothing)
    console.log('\n7. Testing Transactional Rollback:');
    const testInvId1 = 'TEST-ROLLBACK-1-' + Date.now();
    const testInvId2 = 'TEST-ROLLBACK-2-' + Date.now();
    const resRollback = await api('/api/invoices/import-outstanding', 'POST', {
      invoices: [
        { id: testInvId1, customer_id: customer.id, total: 2000000, total_dibayar: 500000 },
        { id: testInvId2, customer_id: customer.id, total: 2000000, total_dibayar: 2500000 } // Overpayment triggers error
      ]
    }, financeToken);
    console.assert(resRollback.status === 400, `Expected rollback 400, got ${resRollback.status}`);
    const [chkRow1] = await db.query('SELECT id FROM sales_invoices WHERE id = ?', [testInvId1]);
    console.assert(chkRow1.length === 0, 'Transactional integrity failed! Row 1 was not rolled back!');
    console.log('   [PASS] Transactional rollback verified: Row 1 was not inserted.');

    // 8. Successful Import with Cicilan (total_dibayar > 0) by Finance
    console.log('\n8. Testing Successful Import with Partial Payment (by Finance):');
    const validInvId1 = 'TEST-OUT-001-' + Date.now();
    const validInvId2 = 'TEST-OUT-002-' + Date.now();

    const resSuccess = await api('/api/invoices/import-outstanding', 'POST', {
      invoices: [
        {
          id: validInvId1,
          date: '2026-05-10',
          customer_id: customer.id,
          total: 5000000,
          total_dibayar: 2000000,
          last_payment_date: '2026-05-15',
          payment_type: 'Kredit 30 Hari',
          due_date: '2026-06-09'
        },
        {
          id: validInvId2,
          date: '2026-05-12',
          customer_name: customer.name,
          total: 1500000,
          total_dibayar: 0,
          payment_type: 'Kredit 14 Hari',
          due_date: '2026-05-26'
        }
      ]
    }, financeToken);

    console.assert(resSuccess.status === 200 && resSuccess.data.count === 2, `Expected 200 count 2, got: ${JSON.stringify(resSuccess.data)}`);
    console.log(`   [PASS] Imported ${resSuccess.data.count} invoices successfully.`);

    // Verify in Database: Invoice 1
    const [inv1Rows] = await db.query('SELECT * FROM sales_invoices WHERE id = ?', [validInvId1]);
    console.assert(inv1Rows.length === 1, 'Invoice 1 not found in DB');
    const dbInv1 = inv1Rows[0];
    console.assert(parseFloat(dbInv1.total) === 5000000, `Expected total 5000000, got ${dbInv1.total}`);
    console.assert(parseFloat(dbInv1.paid_amount) === 2000000, `Expected paid 2000000, got ${dbInv1.paid_amount}`);
    console.assert(dbInv1.status === 'Sebagian', `Expected status 'Sebagian', got ${dbInv1.status}`);
    console.log(`   [PASS] Invoice 1 in DB: Total=${dbInv1.total}, Paid=${dbInv1.paid_amount}, Status=${dbInv1.status}`);

    // Verify Payment Record in sales_invoice_payments
    const [pay1Rows] = await db.query('SELECT * FROM sales_invoice_payments WHERE invoice_id = ?', [validInvId1]);
    console.assert(pay1Rows.length === 1, `Expected 1 payment record, found ${pay1Rows.length}`);
    const dbPay1 = pay1Rows[0];
    console.assert(parseFloat(dbPay1.amount) === 2000000, `Expected payment amount 2000000, got ${dbPay1.amount}`);
    console.assert(dbPay1.notes === 'Saldo awal hasil import', `Expected note 'Saldo awal hasil import', got ${dbPay1.notes}`);
    console.assert(dbPay1.payment_method === 'Saldo Awal', `Expected method 'Saldo Awal', got ${dbPay1.payment_method}`);
    console.assert(dbPay1.cash_transaction_id === null, 'cash_transaction_id must be null for imported initial balance');
    console.assert(dbPay1.payment_no.startsWith('PAY-'), `Expected payment_no starting with PAY-, got ${dbPay1.payment_no}`);
    console.log(`   [PASS] Saldo awal payment record: No=${dbPay1.payment_no}, Amount=${dbPay1.amount}, Notes="${dbPay1.notes}", CashTx=${dbPay1.cash_transaction_id}`);

    // Verify Database: Invoice 2 (total_dibayar = 0)
    const [inv2Rows] = await db.query('SELECT * FROM sales_invoices WHERE id = ?', [validInvId2]);
    console.assert(inv2Rows.length === 1, 'Invoice 2 not found in DB');
    const dbInv2 = inv2Rows[0];
    console.assert(parseFloat(dbInv2.total) === 1500000, `Expected total 1500000, got ${dbInv2.total}`);
    console.assert(parseFloat(dbInv2.paid_amount) === 0, `Expected paid 0, got ${dbInv2.paid_amount}`);
    console.assert(dbInv2.status === 'Belum Lunas', `Expected status 'Belum Lunas', got ${dbInv2.status}`);

    const [pay2Rows] = await db.query('SELECT * FROM sales_invoice_payments WHERE invoice_id = ?', [validInvId2]);
    console.assert(pay2Rows.length === 0, `Expected 0 payment records for inv 2, found ${pay2Rows.length}`);
    console.log(`   [PASS] Invoice 2 in DB: Status=${dbInv2.status}, Payments count=${pay2Rows.length} (no payment record created)`);

    // 9. Verify Piutang List & Sisa Tagihan
    console.log('\n9. Testing /api/finance/receivables with imported invoices:');
    const resReceivables = await api('/api/finance/receivables', 'GET', null, financeToken);
    console.assert(resReceivables.status === 200, 'Failed to fetch receivables');
    const rec1 = resReceivables.data.find(r => r.id === validInvId1);
    console.assert(rec1, 'Invoice 1 not in receivables list');
    console.assert(rec1.sisa === 3000000, `Expected sisa 3000000, got ${rec1.sisa}`);
    console.assert(rec1.paid === 2000000, `Expected paid 2000000, got ${rec1.paid}`);
    console.assert(rec1.isOverdue === true, 'Invoice 1 with due date 2026-06-09 should be overdue');
    console.log(`   [PASS] Receivables item: Total=${rec1.total}, Paid=${rec1.paid}, Sisa=${rec1.sisa}, Overdue=${rec1.isOverdue}`);

    // 10. Subsequent Installment Payment on Imported Invoice
    console.log('\n10. Testing Subsequent Cicilan on Imported Invoice:');
    // Try overpaying: Sisa is 3.000.000, try to pay 3.500.000 -> should fail
    const resOverSub = await api(`/api/invoices/${validInvId1}/payments`, 'POST', {
      amount: 3500000,
      method: 'Transfer Bank',
      notes: 'Pelunasan over'
    }, financeToken);
    console.assert(resOverSub.status === 400, `Expected 400 for overpayment on sisa, got ${resOverSub.status}`);
    console.log('   [PASS] Overpayment on remaining sisa rejected (400):', resOverSub.data.error);

    // Pay partial: 1.000.000 -> sisa should be 2.000.000, status stays Sebagian
    const resPay1 = await api(`/api/invoices/${validInvId1}/payments`, 'POST', {
      amount: 1000000,
      method: 'Transfer Bank',
      notes: 'Cicilan berikutnya setelah import'
    }, financeToken);
    console.assert(resPay1.status === 200, `Expected 200, got: ${JSON.stringify(resPay1.data)}`);
    console.assert(resPay1.data.invoice.sisa === 2000000, `Expected sisa 2000000, got ${resPay1.data.invoice.sisa}`);
    console.assert(resPay1.data.invoice.paid_amount === 3000000, `Expected total paid 3000000, got ${resPay1.data.invoice.paid_amount}`);
    console.log(`   [PASS] Subsequent cicilan successful! Total Paid: ${resPay1.data.invoice.paid_amount}, Remaining Sisa: ${resPay1.data.invoice.sisa}`);

    // Clean up test records
    console.log('\nCleaning up test records...');
    await db.query('DELETE FROM cash_transactions WHERE invoice_id IN (?, ?)', [validInvId1, validInvId2]);
    await db.query('DELETE FROM sales_invoice_payments WHERE invoice_id IN (?, ?)', [validInvId1, validInvId2]);
    await db.query('DELETE FROM sales_invoices WHERE id IN (?, ?)', [validInvId1, validInvId2]);
    console.log('   [PASS] Test data cleaned up.');

    console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    await db.end();
  }
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

