/**
 * Comprehensive Automated Verification Script for Batch C (Hutang Cicilan Bertahap)
 * Runs against the CLONE database: supplierpro_clone
 */
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const path = require('path');
const jwt = require('jsonwebtoken');

const TEST_PORT = 5006;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const CLONE_DB_URL = 'mysql://root:@127.0.0.1:3306/supplierpro_clone';
const JWT_SECRET = 'supplierpro_secret_key_demo';

// Tokens
const adminToken = jwt.sign(
    { id: 1, username: 'admin', role: 'admin', name: 'Administrator' },
    JWT_SECRET,
    { expiresIn: '1h' }
);
const gudangToken = jwt.sign(
    { id: 4, username: 'demo_gudang', role: 'gudang', name: 'Demo Gudang' },
    JWT_SECRET,
    { expiresIn: '1h' }
);
const financeToken = jwt.sign(
    { id: 3, username: 'demo_finance', role: 'finance', name: 'Demo Finance' },
    JWT_SECRET,
    { expiresIn: '1h' }
);
const kasirToken = jwt.sign(
    { id: 5, username: 'demo_kasir', role: 'kasir', name: 'Demo Kasir' },
    JWT_SECRET,
    { expiresIn: '1h' }
);

let serverProcess = null;
let db = null;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startTestServer() {
    console.log(`Starting test server on port ${TEST_PORT} connected to supplierpro_clone...`);
    const serverJsPath = path.join(__dirname, '..', 'server.js');

    serverProcess = spawn('node', [serverJsPath], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(TEST_PORT),
            DATABASE_URL: CLONE_DB_URL,
            DB_NAME: 'supplierpro_clone',
            JWT_SECRET: JWT_SECRET
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stderr.on('data', (d) => {
        const str = d.toString();
        if (!str.includes('ExperimentalWarning')) {
            console.error('[Server stderr]:', str.trim());
        }
    });

    // Wait until server responds
    let ready = false;
    for (let i = 0; i < 20; i++) {
        await sleep(500);
        try {
            const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
            if (res && res.status < 500) {
                ready = true;
                break;
            }
            // fallback check
            const res2 = await fetch(`${BASE_URL}/login.html`).catch(() => null);
            if (res2 && res2.status === 200) {
                ready = true;
                break;
            }
        } catch (_) {}
    }
    if (!ready) {
        throw new Error('Test server failed to start within 10 seconds');
    }
    console.log('Test server ready!');
}

function stopTestServer() {
    if (serverProcess) {
        serverProcess.kill();
        console.log('Test server stopped.');
    }
}

async function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, testName, detail = '') {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName} ${detail ? '(' + detail + ')' : ''}`);
            failed++;
        }
    }

    try {
        db = await mysql.createConnection(CLONE_DB_URL);
        console.log('Connected to MySQL clone database.');

        // Get a valid vendor ID for tests
        const [vendors] = await db.query('SELECT id, name FROM vendors LIMIT 1');
        if (vendors.length === 0) throw new Error('No vendors found in clone DB');
        const testVendor = vendors[0];
        console.log(`Using vendor: ${testVendor.name} (${testVendor.id})`);

        await startTestServer();

        console.log('\n======================================================');
        console.log('TEST SUITE 1: Role-Based Access Control (C6)');
        console.log('======================================================');
        {
            // Finance should be 403 on Hutang endpoints
            const resFin1 = await fetch(`${BASE_URL}/api/finance/payables`, {
                headers: { Authorization: `Bearer ${financeToken}` }
            });
            assert(resFin1.status === 403, 'Finance access to GET /api/finance/payables is 403 Forbidden');

            const resFin2 = await fetch(`${BASE_URL}/api/purchase-orders/import-outstanding`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${financeToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ purchase_orders: [] })
            });
            assert(resFin2.status === 403, 'Finance access to POST /api/purchase-orders/import-outstanding is 403 Forbidden');

            const resFin3 = await fetch(`${BASE_URL}/api/finance/payables/export-pdf`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${financeToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ['TEST'] })
            });
            assert(resFin3.status === 403, 'Finance access to POST /api/finance/payables/export-pdf is 403 Forbidden');

            // Kasir should be 403 on Hutang endpoints
            const resKas1 = await fetch(`${BASE_URL}/api/finance/payables`, {
                headers: { Authorization: `Bearer ${kasirToken}` }
            });
            assert(resKas1.status === 403, 'Kasir access to GET /api/finance/payables is 403 Forbidden');

            // Gudang should have 200 OK access
            const resGud1 = await fetch(`${BASE_URL}/api/finance/payables`, {
                headers: { Authorization: `Bearer ${gudangToken}` }
            });
            assert(resGud1.status === 200, 'Gudang access to GET /api/finance/payables is 200 OK');

            // Admin should have 200 OK access
            const resAdm1 = await fetch(`${BASE_URL}/api/finance/payables`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            assert(resAdm1.status === 200, 'Admin access to GET /api/finance/payables is 200 OK');
        }

        console.log('\n======================================================');
        console.log('TEST SUITE 2: Import Batch Outstanding Hutang (C4)');
        console.log('======================================================');
        const testPoId1 = `PO-TEST-OUT-01-${Date.now().toString().slice(-5)}`;
        const testPoId2 = `PO-TEST-OUT-02-${Date.now().toString().slice(-5)}`;
        {
            const importPayload = {
                purchase_orders: [
                    {
                        id: testPoId1,
                        date: '2026-11-01',
                        vendor_id: testVendor.id,
                        total: 2000000,
                        total_dibayar: 0,
                        payment_type: 'Tempo 30 Hari',
                        due_date: '2026-12-01'
                    },
                    {
                        id: testPoId2,
                        date: '2026-11-05',
                        vendor_id: testVendor.id,
                        total: 3000000,
                        total_dibayar: 1000000,
                        last_payment_date: '2026-11-10',
                        payment_type: 'Tempo 14 Hari',
                        due_date: '2026-11-19'
                    }
                ]
            };

            const importRes = await fetch(`${BASE_URL}/api/purchase-orders/import-outstanding`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${gudangToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(importPayload)
            });
            const importData = await importRes.json();
            assert(importRes.status === 200 && importData.count === 2, 'Import 2 PO outstanding returned 200 OK and count=2');

            // Verify in DB
            const [checkPo] = await db.query('SELECT id, total, paid_amount, is_outstanding_import FROM purchase_orders WHERE id IN (?, ?)', [testPoId1, testPoId2]);
            assert(checkPo.length === 2, 'Both POs found in DB');
            const po1 = checkPo.find(p => p.id === testPoId1);
            const po2 = checkPo.find(p => p.id === testPoId2);
            assert(po1 && Number(po1.total) === 2000000 && Number(po1.paid_amount) === 0 && Boolean(po1.is_outstanding_import), 'PO 1 has is_outstanding_import=1 and paid_amount=0');
            assert(po2 && Number(po2.total) === 3000000 && Number(po2.paid_amount) === 1000000 && Boolean(po2.is_outstanding_import), 'PO 2 has is_outstanding_import=1 and paid_amount=1000000');

            // Verify PO 2 has initial payment record
            const [initPay] = await db.query('SELECT * FROM purchase_order_payments WHERE purchase_order_id = ?', [testPoId2]);
            assert(initPay.length === 1 && initPay[0].payment_no.startsWith('POP-') && Number(initPay[0].amount) === 1000000 && !initPay[0].is_down_payment, 'PO 2 initial payment recorded with POP- prefix and is_down_payment=0 (saldo awal)');
        }

        console.log('\n======================================================');
        console.log('TEST SUITE 3: Cicilan Hutang & Validasi (C1)');
        console.log('======================================================');
        let payment1Id = null;
        let payment1No = null;
        {
            // Test non-integer rejection
            const resNonInt = await fetch(`${BASE_URL}/api/purchase-orders/${testPoId1}/payments`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: 500000.50, payment_date: '2026-11-15', payment_method: 'Transfer Bank' })
            });
            assert(resNonInt.status === 400, 'Non-integer amount rejected with 400');

            // Test overpayment rejection (> 2.000.000)
            const resOver = await fetch(`${BASE_URL}/api/purchase-orders/${testPoId1}/payments`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: 2500000, payment_date: '2026-11-15', payment_method: 'Transfer Bank' })
            });
            assert(resOver.status === 400, 'Overpayment rejected with 400');

            // Record partial payment: 500.000
            const resPay1 = await fetch(`${BASE_URL}/api/purchase-orders/${testPoId1}/payments`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: 500000, payment_date: '2026-11-15', payment_method: 'Transfer Bank', notes: 'Cicilan 1' })
            });
            const pay1Data = await resPay1.json();
            assert(resPay1.status === 200 && pay1Data.success, 'Cicilan 1 (500.000) recorded successfully');
            assert(pay1Data.payment && pay1Data.payment.payment_no.startsWith('POP-'), `Payment number format is valid: ${pay1Data.payment?.payment_no}`);
            payment1Id = pay1Data.payment.id;
            payment1No = pay1Data.payment.payment_no;

            // Check cash transaction created
            const [cashRows] = await db.query(
                `SELECT * FROM cash_transactions WHERE purchase_order_id = ? AND type = 'OUT' AND category = 'Pelunasan Hutang'`,
                [testPoId1]
            );
            assert(cashRows.length === 1 && Number(cashRows[0].amount) === 500000, 'Cash transaction OUT created with category "Pelunasan Hutang" and amount 500.000');

            // Record second payment (1.500.000) -> should be fully paid (status: Selesai)
            const resPay2 = await fetch(`${BASE_URL}/api/purchase-orders/${testPoId1}/payments`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${gudangToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: 1500000, payment_date: '2026-11-16', payment_method: 'Tunai', notes: 'Pelunasan' })
            });
            const pay2Data = await resPay2.json();
            assert(resPay2.status === 200 && pay2Data.purchase.sisa === 0 && pay2Data.purchase.status === 'Selesai', 'Pelunasan 1.500.000 completes PO (sisa=0, status=Selesai)');
        }

        console.log('\n======================================================');
        console.log('TEST SUITE 4: Riwayat Cicilan Hutang (C1)');
        console.log('======================================================');
        let payment2Id = null;
        {
            const resHist = await fetch(`${BASE_URL}/api/purchase-orders/${testPoId1}/payments`, {
                headers: { Authorization: `Bearer ${gudangToken}` }
            });
            const histData = await resHist.json();
            assert(resHist.status === 200, 'GET /api/purchase-orders/:id/payments returned 200');
            assert(histData.payments && histData.payments.length === 2, 'History returns 2 active payments');
            assert(histData.purchase && Number(histData.purchase.paid) === 2000000 && Number(histData.purchase.sisa) === 0, 'Purchase total paid is 2.000.000 and sisa is 0');
            payment2Id = histData.payments[1].id;
        }

        console.log('\n======================================================');
        console.log('TEST SUITE 5: Void Pembayaran Cicilan Hutang & Reversal (C4)');
        console.log('======================================================');
        {
            // Void the second payment (1.500.000)
            const resVoid = await fetch(`${BASE_URL}/api/purchase-orders/payments/${payment2Id}/void`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ void_reason: 'Salah transfer nominal' })
            });
            const voidData = await resVoid.json();
            assert(resVoid.status === 200 && voidData.success, 'Void payment returned 200 OK');

            // Verify PO paid amount reduced back to 500.000
            const [poCheck] = await db.query('SELECT total, paid_amount, status FROM purchase_orders WHERE id = ?', [testPoId1]);
            assert(Number(poCheck[0].paid_amount) === 500000, `PO paid_amount restored to 500.000 (actual: ${poCheck[0].paid_amount})`);

            // Verify payment record marked void
            const [payCheck] = await db.query('SELECT status, void_reason FROM purchase_order_payments WHERE id = ?', [payment2Id]);
            assert(payCheck[0].status === 'void' && payCheck[0].void_reason === 'Salah transfer nominal', 'Payment marked as void with void_reason');

            // Verify cash transaction cancelled
            const [cancelledCash] = await db.query(
                `SELECT status FROM cash_transactions WHERE purchase_order_id = ? AND amount = 1500000`,
                [testPoId1]
            );
            assert(cancelledCash.length === 1 && cancelledCash[0].status === 'cancelled', 'Original cash transaction marked as cancelled');
        }

        console.log('\n======================================================');
        console.log('TEST SUITE 6: Delete Outstanding Hutang vs Non-Import PO (C3)');
        console.log('======================================================');
        {
            // 1. Try to delete non-import PO (must be 403)
            const [realPos] = await db.query('SELECT id FROM purchase_orders WHERE (is_outstanding_import = 0 OR is_outstanding_import IS NULL) LIMIT 1');
            if (realPos.length > 0) {
                const resDelReal = await fetch(`${BASE_URL}/api/finance/payables/${realPos[0].id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${adminToken}` }
                });
                assert(resDelReal.status === 403, 'Deleting non-import PO rejected with 403 Forbidden');
            }

            // 2. Delete imported PO 2 (testPoId2)
            const resDelOut = await fetch(`${BASE_URL}/api/finance/payables/${testPoId2}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${gudangToken}` }
            });
            assert(resDelOut.status === 200, 'Deleting imported outstanding PO returned 200 OK');

            // Verify in DB that testPoId2 is gone and its payments deleted
            const [checkPo2] = await db.query('SELECT id FROM purchase_orders WHERE id = ?', [testPoId2]);
            const [checkPay2] = await db.query('SELECT id FROM purchase_order_payments WHERE purchase_order_id = ?', [testPoId2]);
            assert(checkPo2.length === 0, 'PO 2 successfully deleted from DB');
            assert(checkPay2.length === 0, 'PO 2 payments successfully deleted from DB');
        }

        console.log('\n======================================================');
        console.log('TEST SUITE 7: Export PDF Hutang Terpilih (C5)');
        console.log('======================================================');
        {
            const resPdf = await fetch(`${BASE_URL}/api/finance/payables/export-pdf`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${gudangToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [testPoId1] })
            });
            assert(resPdf.status === 200, 'POST /api/finance/payables/export-pdf returned 200 OK');
            const contentType = resPdf.headers.get('content-type') || '';
            assert(contentType.includes('application/pdf'), `Content-Type is application/pdf (${contentType})`);
            const pdfBuffer = await resPdf.arrayBuffer();
            const header = Buffer.from(pdfBuffer.slice(0, 4)).toString();
            assert(header === '%PDF', 'Buffer starts with %PDF magic number');
        }

        console.log('\n======================================================');
        console.log('TEST SUITE 8: Soft-Lock Edit PO & Cancel PO (C2)');
        console.log('======================================================');
        {
            // Edit PO 1 to total 300.000 (less than active payment 500.000) -> should be rejected with 400
            const resEditReject = await fetch(`${BASE_URL}/api/purchases/${testPoId1}`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: '2026-11-01',
                    vendor_id: testVendor.id,
                    payment_type_id: 'PT-1',
                    total: 300000,
                    items: []
                })
            });
            assert(resEditReject.status === 400, 'Soft-lock rejected PO edit with total < active payments (400 Bad Request)');

            // Cancel PO 1 -> auto voids remaining payment and cancels cash tx
            const resCancel = await fetch(`${BASE_URL}/api/purchases/${testPoId1}/cancel`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            assert(resCancel.status === 200, 'Cancel PO returned 200 OK');

            const [po1Cancel] = await db.query('SELECT status FROM purchase_orders WHERE id = ?', [testPoId1]);
            const [pay1Cancel] = await db.query('SELECT status FROM purchase_order_payments WHERE id = ?', [payment1Id]);
            assert(po1Cancel[0].status === 'Batal', 'PO 1 status changed to Batal');
            assert(pay1Cancel[0].status === 'void', 'Payment 1 automatically marked as void on PO cancel');
        }

        // Clean up test PO 1
        await db.query('DELETE FROM cash_transactions WHERE purchase_order_id = ?', [testPoId1]);
        await db.query('DELETE FROM purchase_order_payments WHERE purchase_order_id = ?', [testPoId1]);
        await db.query('DELETE FROM purchase_orders WHERE id = ?', [testPoId1]);

        console.log('\n======================================================');
        console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
        console.log('======================================================');

        if (failed > 0) {
            process.exitCode = 1;
        }

    } catch (err) {
        console.error('Fatal Test Error:', err);
        process.exitCode = 1;
    } finally {
        stopTestServer();
        if (db) await db.end();
    }
}

runTests();
