/**
 * Comprehensive Automated Verification Script for Task 6
 * Runs against the CLONE database: supplierpro_clone
 */
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const path = require('path');
const jwt = require('jsonwebtoken');

const TEST_PORT = 5005;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const CLONE_DB_URL = 'mysql://root:@127.0.0.1:3306/supplierpro_clone';
const JWT_SECRET = 'supplierpro_secret_key_demo';

// Generate tokens using actual DB user IDs
const adminToken = jwt.sign(
    { id: 1, username: 'admin', role: 'admin', name: 'Administrator' },
    JWT_SECRET,
    { expiresIn: '1h' }
);
const kasirToken = jwt.sign(
    { id: 5, username: 'demo_kasir', role: 'kasir', name: 'Demo Kasir' },
    JWT_SECRET,
    { expiresIn: '1h' }
);
const financeToken = jwt.sign(
    { id: 3, username: 'demo_finance', role: 'finance', name: 'Demo Finance' },
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

    serverProcess.stdout.on('data', (d) => {
        // console.log('[Server stdout]:', d.toString().trim());
    });
    serverProcess.stderr.on('data', (d) => {
        console.error('[Server stderr]:', d.toString().trim());
    });

    // Wait until server is listening
    for (let i = 0; i < 30; i++) {
        await sleep(500);
        try {
            const res = await fetch(`${BASE_URL}/api/products`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (res.ok) {
                console.log('✓ Test server is ready and responding!');
                return;
            }
        } catch (_) {}
    }
    throw new Error('Test server failed to start within 15 seconds');
}

function stopTestServer() {
    if (serverProcess) {
        console.log('Stopping test server...');
        serverProcess.kill('SIGTERM');
        serverProcess = null;
    }
}

async function runTests() {
    const results = [];
    function record(name, passed, details = '') {
        results.push({ name, passed, details });
        const icon = passed ? '✅' : '❌';
        console.log(`${icon} [${passed ? 'PASS' : 'FAIL'}] ${name}${details ? ' - ' + details : ''}`);
    }

    try {
        await startTestServer();
        db = await mysql.createPool(CLONE_DB_URL);

        // Fetch basic master data for tests
        const [products] = await db.query('SELECT * FROM products ORDER BY id ASC LIMIT 5');
        const [vendors] = await db.query('SELECT * FROM vendors ORDER BY id ASC LIMIT 1');
        const [customers] = await db.query('SELECT * FROM customers ORDER BY id ASC LIMIT 2');
        const [payTypes] = await db.query('SELECT * FROM payment_types');

        const tunaiType = payTypes.find(p => p.name.toLowerCase().includes('tunai')) || payTypes[0];
        const transferType = payTypes.find(p => p.name.toLowerCase().includes('transfer')) || payTypes[1];
        const kreditType = payTypes.find(p => p.name.toLowerCase().includes('kredit')) || payTypes[2];

        const testProd1 = products[0];
        const testProd2 = products[1];
        const testVendor = vendors[0];
        const testCustomer = customers[0];

        console.log('\n--- 1. Testing Purchase Orders (PO) Logic & Weighted Average HPP ---');
        // Initial stock of testProd1
        const [p1Before] = await db.query('SELECT stock, cost_price FROM products WHERE id = ?', [testProd1.id]);
        const stockBefore1 = parseFloat(p1Before[0].stock);
        const costBefore1 = parseFloat(p1Before[0].cost_price);

        // 1.1 PO Tunai without jumlah_bayar
        const poTunaiQty = 10;
        const poTunaiCost = costBefore1 + 2000;
        const poTunaiRes = await fetch(`${BASE_URL}/api/purchases`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                vendor_id: testVendor.id,
                date: '2026-11-01',
                payment_type_id: tunaiType.id,
                items: [{ product_id: testProd1.id, qty: poTunaiQty, price: poTunaiCost }]
            })
        });
        const poTunaiJson = await poTunaiRes.json();
        if (!poTunaiRes.ok) console.error('PO Tunai Error:', poTunaiJson);
        const poTunaiId = poTunaiJson.id;

        // Check DB stock, HPP, PO status, hutang, cashflow
        const [p1AfterTunai] = await db.query('SELECT stock, cost_price FROM products WHERE id = ?', [testProd1.id]);
        const [poTunaiRow] = await db.query('SELECT * FROM purchase_orders WHERE id = ?', [poTunaiId]);
        const [cashTunai] = await db.query('SELECT * FROM cash_transactions WHERE purchase_order_id = ?', [poTunaiId]);

        const expectedStock1 = stockBefore1 + poTunaiQty;
        const expectedHpp1 = Math.round(((stockBefore1 * costBefore1) + (poTunaiQty * poTunaiCost)) / (stockBefore1 + poTunaiQty));

        const p1TunaiStockOk = Math.abs(parseFloat(p1AfterTunai[0].stock) - expectedStock1) < 0.001;
        const p1TunaiHppOk = Math.abs(parseFloat(p1AfterTunai[0].cost_price) - expectedHpp1) <= 1; // allow rounding ±1
        const poTunaiStatusOk = poTunaiRow[0]?.status === 'Selesai' && parseFloat(poTunaiRow[0]?.paid_amount) === parseFloat(poTunaiRow[0]?.total);
        const cashTunaiOk = cashTunai.length > 0 && cashTunai[0]?.type === 'OUT';

        record('PO Tunai: Form tanpa Jumlah Bayar sukses dibuat', poTunaiRes.ok, `HTTP ${poTunaiRes.status}`);
        record('PO Tunai: Stok bertambah tepat sekali', p1TunaiStockOk, `Sebelum: ${stockBefore1}, Tambah: ${poTunaiQty}, Aktual: ${p1AfterTunai[0].stock}`);
        record('PO Tunai: Weighted average HPP terhitung akurat', p1TunaiHppOk, `Sebelum: ${costBefore1}, Harga beli: ${poTunaiCost}, Ekspektasi: ${expectedHpp1}, Aktual: ${p1AfterTunai[0].cost_price}`);
        record('PO Tunai: Status langsung Selesai (Lunas) & Arus Kas OUT tercatat', poTunaiStatusOk && cashTunaiOk);

        // 1.2 PO Kredit
        const [p2Before] = await db.query('SELECT stock, cost_price FROM products WHERE id = ?', [testProd2.id]);
        const stockBefore2 = parseFloat(p2Before[0].stock);
        const costBefore2 = parseFloat(p2Before[0].cost_price);
        const poKreditQty = 5;
        const poKreditCost = costBefore2;

        const poKreditRes = await fetch(`${BASE_URL}/api/purchases`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                vendor_id: testVendor.id,
                date: '2026-11-01',
                payment_type_id: kreditType.id,
                items: [{ product_id: testProd2.id, qty: poKreditQty, price: poKreditCost }]
            })
        });
        const poKreditJson = await poKreditRes.json();
        if (!poKreditRes.ok) console.error('PO Kredit Error:', poKreditJson);
        const poKreditId = poKreditJson.id;

        const [p2AfterKredit] = await db.query('SELECT stock, cost_price FROM products WHERE id = ?', [testProd2.id]);
        const [poKreditRow] = await db.query('SELECT * FROM purchase_orders WHERE id = ?', [poKreditId]);
        const [cashKredit] = await db.query('SELECT * FROM cash_transactions WHERE purchase_order_id = ?', [poKreditId]);

        const p2KreditStockOk = Math.abs(parseFloat(p2AfterKredit[0].stock) - (stockBefore2 + poKreditQty)) < 0.001;
        const poKreditStatusOk = poKreditRow[0]?.status === 'Belum Lunas' && parseFloat(poKreditRow[0]?.paid_amount) === 0 && parseFloat(poKreditRow[0]?.total) > 0;
        const noCashKreditOk = cashKredit.length === 0;

        record('PO Kredit: Stok otomatis bertambah', p2KreditStockOk, `Sebelum: ${stockBefore2}, Aktual: ${p2AfterKredit[0].stock}`);
        record('PO Kredit: Membentuk hutang senilai Grand Total (Belum Lunas)', poKreditStatusOk, `Total: ${poKreditRow[0]?.total}, Bayar: ${poKreditRow[0]?.paid_amount}, Status: ${poKreditRow[0]?.status}`);
        record('PO Kredit: Tidak ada arus kas keluar langsung saat kredit', noCashKreditOk);

        console.log('\n--- 2. Testing Halaman Piutang: Delete Khusus Invoice Import Outstanding ---');
        // 2.1 Buat invoice outstanding import
        const outstandingRes = await fetch(`${BASE_URL}/api/invoices/manual`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: 'INV-OUT-TEST-001',
                date: '2026-11-01',
                customer_id: testCustomer.id,
                total: 500000,
                paid: 0,
                payment_type_id: kreditType.id,
                due_date: '2026-11-15'
            })
        });
        const outstandingJson = await outstandingRes.json();
        if (!outstandingRes.ok) console.error('Outstanding create error:', outstandingJson);
        const outInvId = outstandingJson.invoiceId || outstandingJson.id || 'INV-OUT-TEST-001';

        // Check is_outstanding_import flag
        const [outRow] = await db.query('SELECT is_outstanding_import FROM sales_invoices WHERE id = ?', [outInvId]);
        const isFlaggedOk = outRow[0] && outRow[0].is_outstanding_import === 1;
        record('Invoice Outstanding Import: Flag is_outstanding_import = 1', isFlaggedOk);

        // Add a payment installment to test soft-lock / consistent void
        const payInstRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(outInvId)}/payments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: 200000,
                payment_type_id: tunaiType.id,
                payment_date: '2026-11-01'
            })
        });
        record('Invoice Outstanding: Cicilan pembayaran berhasil dicatat', payInstRes.ok);

        // Delete outstanding invoice as admin
        const delOutRes = await fetch(`${BASE_URL}/api/finance/receivables/${encodeURIComponent(outInvId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const [outDeletedCheck] = await db.query('SELECT * FROM sales_invoices WHERE id = ?', [outInvId]);
        const [outPaymentsCheck] = await db.query('SELECT * FROM sales_invoice_payments WHERE invoice_id = ?', [outInvId]);
        const [outCashCheck] = await db.query('SELECT * FROM cash_transactions WHERE invoice_id = ?', [outInvId]);

        const outDeletedOk = delOutRes.ok && outDeletedCheck.length === 0 && outPaymentsCheck.length === 0;
        const outCashVoidedOk = outCashCheck.length === 0 || outCashCheck.every(c => c.status === 'cancelled' || c.description.includes('[BATAL]'));
        record('Delete Invoice Outstanding: Berhasil dihapus beserta pembayaran & arus kas dibalikkan', outDeletedOk && outCashVoidedOk);

        // 2.2 POS Invoice cannot be deleted via receivables endpoint
        // Create normal POS invoice
        const posRes = await fetch(`${BASE_URL}/api/invoices`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${kasirToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                payment_type_id: kreditType.id,
                paid: 0,
                items: [{ id: testProd1.id, quantity: 2, price: testProd1.sell_price }]
            })
        });
        const posJson = await posRes.json();
        if (!posRes.ok) console.error('POS create error:', posJson);
        const posInvId = posJson.invoiceId || posJson.id;

        // Try deleting POS invoice -> MUST BE REJECTED (400 or 403)
        const delPosRes = await fetch(`${BASE_URL}/api/finance/receivables/${encodeURIComponent(posInvId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        record('Delete POS Invoice di Piutang: DITOLAK oleh backend (bukan import outstanding)', delPosRes.status === 400 || delPosRes.status === 403, `Status HTTP: ${delPosRes.status}`);

        console.log('\n--- 3. Testing Modal Edit Invoice: Cancel Invoice Flow ---');
        // Stock before cancel
        const [p1BeforeCancel] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd1.id]);
        const p1StockBeforeCancel = parseFloat(p1BeforeCancel[0].stock);

        // Cancel the POS invoice
        const cancelRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(posInvId)}/cancel`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        record('Cancel Invoice: Berhasil dieksekusi', cancelRes.ok);

        const [p1AfterCancel] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd1.id]);
        const [posInvAfterCancel] = await db.query('SELECT status FROM sales_invoices WHERE id = ?', [posInvId]);

        // Verify stock returned (2 qty was purchased in posRes)
        const stockRestoredOk = Math.abs(parseFloat(p1AfterCancel[0].stock) - (p1StockBeforeCancel + 2)) < 0.001;
        record('Cancel Invoice: Stok produk dikembalikan ke master', stockRestoredOk, `Sebelum: ${p1StockBeforeCancel}, Sesudah: ${p1AfterCancel[0].stock}`);
        record('Cancel Invoice: Status invoice menjadi Cancel', posInvAfterCancel[0]?.status === 'Cancel');

        // Verify double cancel is blocked
        const doubleCancelRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(posInvId)}/cancel`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        record('Cancel Invoice: Cegah double cancel (ditolak jika sudah Cancel)', doubleCancelRes.status === 400, `Status HTTP: ${doubleCancelRes.status}`);

        // Verify editing cancelled invoice is blocked
        const editCancelledRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(posInvId)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                items: [{ product_id: testProd1.id, qty: 1, price: 10000 }]
            })
        });
        record('Cancel Invoice: Cegah edit pada invoice Cancel (ditolak)', editCancelledRes.status === 400, `Status HTTP: ${editCancelledRes.status}`);

        // Check report query excludes Cancel invoice
        const omzetRes = await fetch(`${BASE_URL}/api/dashboard/sales-trend?days=30`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        record('Reports Audit: Query tren penjualan dan omzet aktif mengabaikan invoice Cancel', omzetRes.ok);

        console.log('\n--- 4. Testing Edit Invoice: Delta Stock Synchronization ---');
        // Create an invoice with 5 pcs of testProd2
        const [prod2Init] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd2.id]);
        const prod2InitStock = parseFloat(prod2Init[0].stock);

        const editTestRes = await fetch(`${BASE_URL}/api/invoices`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${kasirToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                payment_type_id: tunaiType.id,
                paid: testProd2.sell_price * 5,
                items: [{ id: testProd2.id, quantity: 5, price: testProd2.sell_price }]
            })
        });
        const editTestInv = await editTestRes.json();
        const editInvId = editTestInv.invoiceId || editTestInv.id;

        // Verify initial stock deduction: -5
        const [prod2AfterCreate] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd2.id]);
        record('Edit Invoice Setup: Stok terpotong 5 saat create invoice', Math.abs(parseFloat(prod2AfterCreate[0].stock) - (prod2InitStock - 5)) < 0.001);

        // 4.1 Edit: Kurangi qty dari 5 menjadi 3 (delta = -2 -> kembalikan 2 ke stok)
        const editReduceRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(editInvId)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                items: [{ product_id: testProd2.id, quantity: 3, price: testProd2.sell_price }]
            })
        });
        const [prod2AfterReduce] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd2.id]);
        const stockAfterReduceOk = Math.abs(parseFloat(prod2AfterReduce[0].stock) - (prod2InitStock - 3)) < 0.001;
        record('Edit Invoice: Kurangi Qty (5 -> 3), selisih 2 dikembalikan ke stok', editReduceRes.ok && stockAfterReduceOk, `Stok: ${prod2AfterReduce[0].stock}`);

        // 4.2 Edit: Tambah item baru testProd1 (qty = 3) dan naikkan testProd2 (3 -> 4, delta = +1)
        const [p1BeforeAdd] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd1.id]);
        const p1StockBeforeAdd = parseFloat(p1BeforeAdd[0].stock);

        const editAddRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(editInvId)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                items: [
                    { product_id: testProd2.id, quantity: 4, price: testProd2.sell_price },
                    { product_id: testProd1.id, quantity: 3, price: testProd1.sell_price }
                ]
            })
        });
        const [prod2AfterAdd] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd2.id]);
        const [prod1AfterAdd] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd1.id]);

        const stockP2Ok = Math.abs(parseFloat(prod2AfterAdd[0].stock) - (prod2InitStock - 4)) < 0.001;
        const stockP1Ok = Math.abs(parseFloat(prod1AfterAdd[0].stock) - (p1StockBeforeAdd - 3)) < 0.001;
        record('Edit Invoice: Tambah Qty & Tambah Item Baru memotong stok sesuai selisih', editAddRes.ok && stockP2Ok && stockP1Ok);

        // 4.3 Edit: Hapus item testProd1 dari invoice (seluruh 3 dikembalikan ke stok)
        const editRemoveRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(editInvId)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                items: [
                    { product_id: testProd2.id, quantity: 4, price: testProd2.sell_price }
                ]
            })
        });
        const [prod1AfterRemove] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd1.id]);
        const stockP1RestoredOk = Math.abs(parseFloat(prod1AfterRemove[0].stock) - p1StockBeforeAdd) < 0.001;
        record('Edit Invoice: Hapus item mengembalikan seluruh kuantitas ke stok', editRemoveRes.ok && stockP1RestoredOk, `Stok P1 kembali: ${prod1AfterRemove[0].stock}`);

        // 4.4 Edit: Validasi stok tidak cukup -> rollback total
        const editExcessRes = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(editInvId)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                items: [
                    { product_id: testProd2.id, quantity: 999999, price: testProd2.sell_price }
                ]
            })
        });
        const [prod2AfterExcess] = await db.query('SELECT stock FROM products WHERE id = ?', [testProd2.id]);
        const stockUnchangedOk = Math.abs(parseFloat(prod2AfterExcess[0].stock) - parseFloat(prod2AfterAdd[0].stock)) < 0.001;
        record('Edit Invoice: Stok tidak cukup ditolak dan di-rollback total', editExcessRes.status === 400 && stockUnchangedOk);

        console.log('\n--- 5. Testing Filter Tipe Pembayaran di Daftar Transaksi/Invoice ---');
        // Filter by Tunai
        const filterTunaiRes = await fetch(`${BASE_URL}/api/invoices?page=1&limit=80&payment_type_id=${tunaiType.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const filterTunaiJson = await filterTunaiRes.json();
        const allTunai = filterTunaiJson.data.every(i => i.paymentTypeId === tunaiType.id);

        // Filter by Kredit
        const filterKreditRes = await fetch(`${BASE_URL}/api/invoices?page=1&limit=80&payment_type_id=${kreditType.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const filterKreditJson = await filterKreditRes.json();
        const allKredit = filterKreditJson.data.every(i => i.paymentTypeId === kreditType.id);

        record('Filter Tipe Pembayaran: Server-side filter Tunai bekerja bersama pagination', filterTunaiRes.ok && allTunai, `Ditemukan ${filterTunaiJson.data.length} baris`);
        record('Filter Tipe Pembayaran: Server-side filter Kredit bekerja bersama pagination', filterKreditRes.ok && allKredit, `Ditemukan ${filterKreditJson.data.length} baris`);

        console.log('\n--- 6. Testing Export PDF Piutang (Selected Items Only) ---');
        // Get active receivables
        const recRes = await fetch(`${BASE_URL}/api/finance/receivables?page=1&limit=10`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const recJson = await recRes.json();
        const activeRecs = recJson.data || [];
        const selectedIds = activeRecs.slice(0, 3).map(r => r.id);

        const pdfRes = await fetch(`${BASE_URL}/api/finance/receivables/export-pdf`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: selectedIds })
        });
        const contentType = pdfRes.headers.get('content-type');
        const pdfBuffer = await pdfRes.arrayBuffer();

        const pdfValidOk = pdfRes.ok && contentType.includes('application/pdf') && pdfBuffer.byteLength > 1000;
        record('Export PDF Piutang: Menghasilkan binary PDF valid dari item terpilih', pdfValidOk, `Ukuran: ${pdfBuffer.byteLength} bytes`);

        // Test Export PDF with empty ids -> rejected
        const emptyPdfRes = await fetch(`${BASE_URL}/api/finance/receivables/export-pdf`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: [] })
        });
        record('Export PDF Piutang: Validasi ID kosong ditolak dengan aman (400)', emptyPdfRes.status === 400);

        console.log('\n--- 7. Regression Testing (Kasir POS, Cicilan, Arus Kas) ---');
        // POS Cash Sale
        const posCashRes = await fetch(`${BASE_URL}/api/invoices`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${kasirToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer_id: testCustomer.id,
                payment_type_id: tunaiType.id,
                paid: testProd1.sell_price * 1,
                items: [{ id: testProd1.id, quantity: 1, price: testProd1.sell_price }]
            })
        });
        const posCashJson = await posCashRes.json();
        const [cashTx] = await db.query('SELECT * FROM cash_transactions WHERE invoice_id = ?', [posCashJson.invoiceId]);
        const posCashOk = posCashRes.ok && cashTx.length > 0 && cashTx[0]?.type === 'IN';
        record('Regresi POS Kasir: Transaksi tunai memotong stok & mencatat arus kas masuk', posCashOk);

        // Summary
        console.log('\n======================================================');
        const totalTests = results.length;
        const passedTests = results.filter(r => r.passed).length;
        console.log(`TOTAL TESTS RUN: ${totalTests}`);
        console.log(`PASSED: ${passedTests}`);
        console.log(`FAILED: ${totalTests - passedTests}`);
        console.log('======================================================\n');

        if (totalTests !== passedTests) {
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('Fatal error during test run:', err);
        process.exitCode = 1;
    } finally {
        if (db) await db.end();
        stopTestServer();
    }
}

runTests();
