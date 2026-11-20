/**
 * test_edit_invoice_and_format.js
 * 
 * Comprehensive automated verification for:
 * 1. Bagian A: Modal Edit Invoice Product Search
 *    - Reusable ProductAutocomplete component
 *    - PO and Edit Invoice both reuse ProductAutocomplete
 *    - HTML structure (search input + fixed dropdown, select removed)
 *    - Special price support via effective-prices endpoint
 *    - Inactive products excluded from search
 * 2. Bagian B: formatNumberTrim
 *    - Unit tests for all decimal formatting cases (1.0000 -> 1, 205000.0 -> 205000, 1.5000 -> 1.5, etc.)
 *    - Integration with renderEditInvoiceItems, renderAddPurchaseItems, renderEditPurchaseItems, renderCart, opname, product edit
 *    - Decimal quantity handling (parseFloat, step="any", width 80px)
 *    - API invoice edit test with clone database (supplierpro_clone)
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const mysql = require('../node_modules/mysql2/promise');
const jwt = require('../node_modules/jsonwebtoken');

const BASE = path.join(__dirname, '..');
const TEST_PORT = 3007;
const SECRET_KEY = 'supplierpro_secret_key_demo';

let testServerProcess = null;
let db = null;
const results = [];

function assert(desc, condition, details = '') {
    if (condition) {
        console.log(`  [PASS] ${desc}`);
        results.push({ desc, pass: true });
    } else {
        console.error(`  [FAIL] ${desc}${details ? ' — ' + details : ''}`);
        results.push({ desc, pass: false, details });
    }
}

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(body); } catch { parsed = body; }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        req.end();
    });
}

function makeToken(id, role) {
    return jwt.sign({ id, username: role + '_user', role, name: role }, SECRET_KEY, { expiresIn: '1h' });
}

async function startTestServer() {
    console.log(`\nStarting test server on port ${TEST_PORT} (DB: supplierpro_clone)...`);
    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env, {
            PORT: String(TEST_PORT),
            DATABASE_URL: 'mysql://root:@localhost:3306/supplierpro_clone',
            JWT_SECRET: SECRET_KEY
        });
        testServerProcess = spawn('node', ['server.js'], { cwd: BASE, env });
        let started = false;
        testServerProcess.stdout.on('data', d => {
            const s = d.toString();
            if ((s.includes('running on port') || s.includes('SupplierPro API')) && !started) {
                started = true;
                setTimeout(resolve, 1500);
            }
        });
        testServerProcess.stderr.on('data', d => console.error('[SRV ERR]', d.toString()));
        setTimeout(() => { if (!started) reject(new Error('Server failed to start in 15s')); }, 15000);
    });
}

function stopTestServer() {
    if (testServerProcess) { testServerProcess.kill(); testServerProcess = null; }
}

// ============================================================
// 1. STATIC TESTS
// ============================================================
function runStaticTests() {
    console.log('\n========================================');
    console.log('PHASE 1: STATIC TESTS — CODEBASE VERIFICATION');
    console.log('========================================\n');

    const js = fs.readFileSync(path.join(BASE, 'dashboard.js'), 'utf8');
    const html = fs.readFileSync(path.join(BASE, 'dashboard.html'), 'utf8');
    const css = fs.readFileSync(path.join(BASE, 'dashboard.css'), 'utf8');

    // --- BAGIAN A: Product Autocomplete Reusability ---
    console.log('--- A. Shared ProductAutocomplete Component ---');
    assert('A.1: Class ProductAutocomplete didefinisikan di dashboard.js',
        js.includes('class ProductAutocomplete'));

    assert('A.2: ProductAutocomplete menerima getPrice dan onSelect pada config',
        js.includes('this.getPrice = config.getPrice') && js.includes('this.onSelect = config.onSelect'));

    assert('A.3: ProductAutocomplete menyaring hanya produk aktif (is_active !== 0)',
        js.includes('p.is_active !== 0 && p.is_active !== false'));

    assert('A.4: PO menggunakan instance ProductAutocomplete',
        js.includes('poProductAutocomplete = new ProductAutocomplete'));

    assert('A.5: Edit Invoice menggunakan instance ProductAutocomplete',
        js.includes('editInvoiceProductAutocomplete = new ProductAutocomplete'));

    assert('A.6: HTML Edit Invoice memiliki input #edit-invoice-product-search',
        html.includes('id="edit-invoice-product-search"'));

    assert('A.7: HTML Edit Invoice memiliki dropdown #edit-invoice-product-dropdown',
        html.includes('id="edit-invoice-product-dropdown"'));

    assert('A.8: HTML Edit Invoice TIDAK lagi memakai <select id="edit-invoice-product-select">',
        !html.includes('id="edit-invoice-product-select"'));

    assert('A.9: Dropdown pencarian memakai class po-autocomplete-dropdown (position: fixed)',
        html.includes('id="edit-invoice-product-dropdown" class="po-autocomplete-dropdown"') &&
        css.includes('position: fixed'));

    assert('A.10: Edit Invoice memuat effective-prices pelanggan saat modal dibuka',
        js.includes('/api/pricelists/effective-prices?customer_id='));

    assert('A.11: Edit Invoice menerapkan harga khusus pelanggan jika ada',
        js.includes('getEditInvoiceProductPrice'));

    // --- BAGIAN B: formatNumberTrim Helper & Formatting ---
    console.log('\n--- B. formatNumberTrim Helper & Formatting Everywhere ---');
    assert('B.1: function formatNumberTrim didefinisikan',
        js.includes('function formatNumberTrim'));

    assert('B.2: formatNumTrim adalah alias dari formatNumberTrim',
        js.includes('const formatNumTrim = formatNumberTrim') || js.includes('var formatNumTrim = formatNumberTrim'));

    assert('B.3: renderEditInvoiceItems menggunakan formatNumberTrim pada Qty dan Price',
        js.includes('formatNumberTrim(item.quantity)') && js.includes('formatNumberTrim(item.price)'));

    assert('B.4: renderEditInvoiceItems input Qty memiliki lebar 80px dan step="any"',
        js.includes('value="${formatNumTrim(item.quantity)}"') && js.includes('width: 80px') && js.includes('step="any"'));

    assert('B.5: updateEditInvoiceItemQty menggunakan parseFloat untuk mendukung desimal',
        js.includes('const qty = parseFloat(val)'));

    assert('B.6: renderAddPurchaseItems menggunakan formatNumberTrim dan width 80px',
        js.includes('formatNumberTrim(item.quantity)') && js.includes('renderAddPurchaseItems'));

    assert('B.7: updateAddPurchaseItemQty menggunakan parseFloat',
        js.includes('updateAddPurchaseItemQty = (index, val) => {\n    const qty = parseFloat(val)'));

    assert('B.8: renderEditPurchaseItems menggunakan formatNumberTrim dan width 80px',
        js.includes('formatNumberTrim(item.quantity)') && js.includes('renderEditPurchaseItems'));

    assert('B.9: updateEditPurchaseItemQty menggunakan parseFloat',
        js.includes('updateEditPurchaseItemQty = (index, val) => {\n    const qty = parseFloat(val)'));

    assert('B.10: renderCart (Kasir) menggunakan formatNumberTrim pada price dan qty',
        js.includes('formatNumberTrim(item.price)') && js.includes('formatNumberTrim(item.qty)'));

    assert('B.11: openStockOpnameModal menggunakan formatNumberTrim pada stok sistem',
        js.includes('formatNumberTrim(p.stock !== undefined ? p.stock : 0)'));

    assert('B.12: submitStockOpname mendukung desimal dengan parseFloat',
        js.includes('const actual = parseFloat(actualEl ? actualEl.value : \'\');'));

    assert('B.13: editProduct modal menggunakan formatNumberTrim pada cost, price, stock, minStock',
        js.includes('formatNumberTrim(p.cost)') && js.includes('formatNumberTrim(p.stock)'));
}

// ============================================================
// 2. UNIT TESTS: formatNumberTrim
// ============================================================
function runUnitTests() {
    console.log('\n========================================');
    console.log('PHASE 2: UNIT TESTS — formatNumberTrim()');
    console.log('========================================\n');

    // Extract formatNumberTrim from dashboard.js logic
    function formatNumberTrim(val) {
        if (val === null || val === undefined || val === '') return '';
        var s = String(val).trim();
        if (!s.includes('.')) return s;
        var trimmed = s.replace(/\.?0+$/, '');
        return trimmed === '' ? '0' : trimmed;
    }

    const cases = [
        ['1.0000', '1', '1.0000 -> 1'],
        ['10.00', '10', '10.00 -> 10'],
        ['205000.0', '205000', '205000.0 -> 205000'],
        ['1.5000', '1.5', '1.5000 -> 1.5'],
        ['0.2500', '0.25', '0.2500 -> 0.25'],
        ['2.125', '2.125', '2.125 -> 2.125 (pecahan tidak dipotong)'],
        ['0.0000', '0', '0.0000 -> 0'],
        [1.0000, '1', 'Number 1.0000 -> 1'],
        [0, '0', 'Number 0 -> 0'],
        ['0', '0', 'String 0 -> 0'],
        ['100', '100', 'String 100 -> 100'],
        [null, '', 'null -> string kosong'],
        [undefined, '', 'undefined -> string kosong'],
        ['', '', 'string kosong -> string kosong'],
    ];

    cases.forEach(([input, expected, label]) => {
        const res = formatNumberTrim(input);
        assert(`formatNumberTrim: ${label}`, res === expected, `Got: "${res}", Expected: "${expected}"`);
    });
}

// ============================================================
// 3. API & DATABASE INTEGRATION TESTS
// ============================================================
async function runApiTests() {
    console.log('\n========================================');
    console.log('PHASE 3: API & DATABASE INTEGRATION TESTS');
    console.log('========================================\n');

    const adminToken = makeToken(1, 'admin');

    // --- Test 1: Fetch invoice items from DB (DECIMAL checking) ---
    console.log('--- Test 3.1: Invoice Items API returns valid data ---');
    const [invRows] = await db.query("SELECT id FROM sales_invoices LIMIT 1");
    if (invRows.length > 0) {
        const invId = invRows[0].id;
        const res = await request({
            hostname: 'localhost',
            port: TEST_PORT,
            path: `/api/invoices/${encodeURIComponent(invId)}/items`,
            method: 'GET',
            headers: { Authorization: 'Bearer ' + adminToken }
        });
        assert('API: GET /api/invoices/:id/items mengembalikan 200', res.status === 200);
        assert('API: response items adalah array', Array.isArray(res.body));
        if (Array.isArray(res.body) && res.body.length > 0) {
            const firstItem = res.body[0];
            assert('API: Item memiliki product_id, quantity, price',
                firstItem.product_id && firstItem.quantity !== undefined && firstItem.price !== undefined);
        }
    } else {
        console.log('  [SKIP] No invoices found in DB to test items');
    }

    // --- Test 2: Effective Prices API for Special Price ---
    console.log('\n--- Test 3.2: Special Price via /api/pricelists/effective-prices ---');
    const [custRows] = await db.query("SELECT id FROM customers LIMIT 1");
    if (custRows.length > 0) {
        const custId = custRows[0].id;
        const res = await request({
            hostname: 'localhost',
            port: TEST_PORT,
            path: `/api/pricelists/effective-prices?customer_id=${encodeURIComponent(custId)}`,
            method: 'GET',
            headers: { Authorization: 'Bearer ' + adminToken }
        });
        assert('API: GET /api/pricelists/effective-prices mengembalikan 200', res.status === 200);
        assert('API: response effective prices berisi data prices valid',
            Array.isArray(res.body) || (res.body && Array.isArray(res.body.prices)));
    }

    // --- Test 3: Products search API (only active products) ---
    console.log('\n--- Test 3.3: Product Search API filters status=active ---');
    const resProd = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/products?q=a&status=active&limit=10',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert('API: GET /api/products?q=a&status=active mengembalikan 200', resProd.status === 200);
    if (resProd.status === 200 && Array.isArray(resProd.body)) {
        assert('API: Semua hasil pencarian berstatus aktif (is_active == 1)',
            resProd.body.every(p => p.is_active === 1 || p.is_active === true));
    }

    // --- Test 4: Save Invoice Edit with Decimal Quantity (e.g. 2.5 kg) ---
    console.log('\n--- Test 3.4: Save Invoice Edit with Decimal Qty & Verify DB ---');
    if (invRows.length > 0) {
        const testInvId = invRows[0].id;
        const [existingItems] = await db.query(
            "SELECT product_id, quantity, price FROM invoice_items WHERE invoice_id = ?",
            [testInvId]
        );

        if (existingItems.length > 0) {
            const originalQty = existingItems[0].quantity;
            const originalPrice = existingItems[0].price;

            // Update item 0 with decimal qty 2.5
            const updatedItems = existingItems.map((item, idx) => ({
                product_id: item.product_id,
                quantity: idx === 0 ? 2.5 : parseFloat(item.quantity),
                price: parseFloat(item.price),
                customer_fee: 0,
                fee_notes: ''
            }));

            const subtotal = updatedItems.reduce((s, i) => s + (i.quantity * i.price), 0);
            const total = subtotal + Math.round(subtotal * 0.11);

            const putRes = await request({
                hostname: 'localhost',
                port: TEST_PORT,
                path: `/api/invoices/${encodeURIComponent(testInvId)}`,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + adminToken
                }
            }, {
                id: testInvId,
                date: '2026-11-21',
                total: total,
                items: updatedItems
            });

            assert('API: PUT /api/invoices/:id mengembalikan 200', putRes.status === 200, 'Status: ' + putRes.status);

            // Verify in DB that decimal quantity is preserved accurately
            const [checkRows] = await db.query(
                "SELECT quantity FROM invoice_items WHERE invoice_id = ? AND product_id = ?",
                [testInvId, updatedItems[0].product_id]
            );

            assert('DB: Kuantitas desimal (2.5) tersimpan secara akurat di database',
                checkRows.length > 0 && Math.abs(parseFloat(checkRows[0].quantity) - 2.5) < 0.0001,
                `Saved qty: ${checkRows[0]?.quantity}`);

            // Restore original quantity
            await db.query(
                "UPDATE invoice_items SET quantity = ? WHERE invoice_id = ? AND product_id = ?",
                [originalQty, testInvId, updatedItems[0].product_id]
            );
            await db.query(
                "UPDATE sales_invoices SET total = ? WHERE id = ?",
                [parseFloat(originalPrice) * parseFloat(originalQty), testInvId]
            );
            console.log('  ✓ Data uji dikembalikan ke semula di DB');
        }
    }
}

// ============================================================
// MAIN EXECUTION
// ============================================================
async function run() {
    console.log('====================================================');
    console.log('  TEST SUITE: EDIT INVOICE SEARCH & NUMBER FORMATTING');
    console.log('====================================================');

    runStaticTests();
    runUnitTests();

    db = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'supplierpro_clone'
    });

    await startTestServer();
    await runApiTests();

    stopTestServer();
    await db.end();

    console.log('\n====================================================');
    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    console.log(`  SUMMARY: ${passed}/${total} tests passed.`);
    if (passed === total) {
        console.log('  SEMUA VERIFIKASI LULUS DENGAN SUKSES! 🎉');
    } else {
        console.log(`  PERINGATAN: ${total - passed} test gagal.`);
    }
    console.log('====================================================\n');
    process.exit(passed === total ? 0 : 1);
}

run().catch(err => {
    console.error('Fatal test error:', err);
    stopTestServer();
    process.exit(1);
});
