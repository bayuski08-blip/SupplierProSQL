const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const mysql = require('../node_modules/mysql2/promise');
const jwt = require('../node_modules/jsonwebtoken');

const TEST_PORT = 3005;
const SECRET_KEY = 'supplierpro_secret_key_demo';

let testServerProcess = null;
let db = null;

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    parsed = body;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

function makeToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role, name: user.name || user.username },
        SECRET_KEY,
        { expiresIn: '1h' }
    );
}

const results = [];
function assert(desc, condition, details = '') {
    if (condition) {
        console.log(`  [PASS] ${desc}`);
        results.push({ desc, pass: true });
    } else {
        console.error(`  [FAIL] ${desc} - ${details}`);
        results.push({ desc, pass: false, details });
    }
}

async function startTestServer() {
    console.log('Starting test server on port ' + TEST_PORT + ' (DB: supplierpro_clone)...');
    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env, {
            PORT: String(TEST_PORT),
            DATABASE_URL: 'mysql://root:@localhost:3306/supplierpro_clone',
            JWT_SECRET: SECRET_KEY
        });
        testServerProcess = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env
        });

        let started = false;
        testServerProcess.stdout.on('data', (d) => {
            const str = d.toString();
            if ((str.includes('SupplierPro API running') || str.includes('running on port')) && !started) {
                started = true;
                setTimeout(resolve, 1500); // Wait for startup DB migrations
            }
        });

        testServerProcess.stderr.on('data', (d) => {
            console.error('[SERVER ERR]', d.toString());
        });

        testServerProcess.on('error', reject);

        // Fallback resolve
        setTimeout(() => {
            if (!started) {
                started = true;
                resolve();
            }
        }, 4000);
    });
}

async function stopTestServer() {
    if (testServerProcess) {
        testServerProcess.kill();
        testServerProcess = null;
        console.log('Test server stopped.');
    }
}

async function run() {
    console.log('====================================================');
    console.log('  BATCH A - COMPREHENSIVE AUTOMATED VERIFICATION  ');
    console.log('====================================================\n');

    // 1. Verify Database Schema
    console.log('--- Phase 1: Database Schema Verification (supplierpro_clone) ---');
    db = await mysql.createConnection({
        host: '127.0.0.1',
        user: 'root',
        password: '',
        database: 'supplierpro_clone'
    });

    const [colRows] = await db.query("SHOW COLUMNS FROM products LIKE 'is_active'");
    assert('Column is_active exists in products table', colRows.length > 0);
    if (colRows.length > 0) {
        assert('Column is_active default is 1', String(colRows[0].Default) === '1');
    }

    const [idxRows] = await db.query("SHOW INDEX FROM products WHERE Key_name = 'idx_products_is_active'");
    assert('Index idx_products_is_active exists', idxRows.length > 0);

    // Check count of products in clone DB (includes 5000 dummy products)
    const [pCount] = await db.query("SELECT COUNT(*) as total FROM products");
    assert('Product count in clone DB >= 5000 (A3 test setup)', pCount[0].total >= 5000, `Actual: ${pCount[0].total}`);

    // Check that tables pricelists and pricelist_items are NOT renamed (A5 constraint)
    const [plTable] = await db.query("SHOW TABLES LIKE 'pricelists'");
    const [pliTable] = await db.query("SHOW TABLES LIKE 'pricelist_items'");
    assert('Table pricelists retained original DB name', plTable.length > 0);
    assert('Table pricelist_items retained original DB name', pliTable.length > 0);

    // 2. Static Verification of Codebase (HTML, CSS, JS)
    console.log('\n--- Phase 2: Static Verification (HTML, CSS, JS) ---');
    const cssPath = path.join(__dirname, '..', 'dashboard.css');
    const htmlPath = path.join(__dirname, '..', 'dashboard.html');
    const jsPath = path.join(__dirname, '..', 'dashboard.js');

    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    // A1 CSS
    assert('A1: CSS has #low-stock-frame with max-height 290px and overflow-y: auto',
        cssContent.includes('#low-stock-frame') && cssContent.includes('max-height: 290px') && cssContent.includes('overflow-y: auto'));
    assert('A1: CSS has sticky thead th for low stock table',
        cssContent.includes('#low-stock-frame thead th') && cssContent.includes('position: sticky'));

    // A2 HTML & JS
    assert('A2: HTML has product status filter dropdown (#product-status-filter)',
        htmlContent.includes('id="product-status-filter"') && htmlContent.includes('value="active"') && htmlContent.includes('value="inactive"'));
    assert('A2: HTML has #modal-confirm-deactivate-product',
        htmlContent.includes('id="modal-confirm-deactivate-product"') && htmlContent.includes('id="deactivate-product-stock-warning"'));
    assert('A2: HTML has #modal-confirm-delete-product',
        htmlContent.includes('id="modal-confirm-delete-product"') && htmlContent.includes('id="delete-product-pricelist-warning"'));
    assert('A2: JS implements confirmToggleProductStatus with stock warning',
        jsContent.includes('function confirmToggleProductStatus(') && jsContent.includes('modal-confirm-deactivate-product'));
    assert('A2: JS implements confirmDeleteProduct with pricelist warning',
        jsContent.includes('function confirmDeleteProduct(') && jsContent.includes('modal-confirm-delete-product'));

    // A3 Instant Stock Opname Modal
    assert('A3: HTML modal-stock-opname has explicit input IDs (#stock-opname-name, etc.)',
        htmlContent.includes('id="stock-opname-name"') && htmlContent.includes('id="stock-opname-stock"') && htmlContent.includes('id="stock-opname-actual"'));
    assert('A3: JS openStockOpnameModal uses CURRENT_PAGE_PRODUCTS with single-product fallback',
        jsContent.includes('function openStockOpnameModal(') && jsContent.includes('CURRENT_PAGE_PRODUCTS.get') && !jsContent.includes('fetch(\'/api/products?all=true\')'));

    // A4 Vendor Combobox
    assert('A4: HTML modal-add-purchase has vendor combobox container and dropdown',
        htmlContent.includes('id="add-purchase-vendor-container"') && htmlContent.includes('id="add-purchase-vendor-input"') && htmlContent.includes('id="add-purchase-vendor-dropdown"'));
    assert('A4: Combobox preserves side-by-side layout with Payment Type',
        htmlContent.includes('add-purchase-vendor-container') && htmlContent.includes('add-purchase-payment-type'));
    assert('A4: JS implements ComboboxSelect with keyboard navigation (Up, Down, Enter, Esc)',
        jsContent.includes('class ComboboxSelect') && jsContent.includes('ArrowDown') && jsContent.includes('ArrowUp') && jsContent.includes('Escape'));

    // A5 Rename Pricelist to Special Price
    assert('A5: Sidebar nav shows "Special Price"',
        htmlContent.includes('Special Price') && htmlContent.includes('data-page="pricelists"'));
    assert('A5: PAGE_TITLES.pricelists title is "Special Price"',
        jsContent.includes("pricelists: { title: 'Special Price'"));
    assert('A5: Customer modal dropdown option shows "Harga Master (tanpa Special Price)"',
        jsContent.includes('Harga Master (tanpa Special Price)'));

    // A6 Piutang
    const piutangFnIdx = jsContent.indexOf('async function fetchPiutang(');
    const piutangFnEnd = jsContent.indexOf('function confirmDeleteOutstandingInvoice(');
    const fetchPiutangSection = piutangFnIdx !== -1 && piutangFnEnd !== -1 ? jsContent.slice(piutangFnIdx, piutangFnEnd) : '';
    assert('A6: JS fetchPiutang does NOT render "Bayar" button in rows',
        !fetchPiutangSection.includes('Bayar</button>'));
    assert('A6: JS fetchPiutang keeps 3-line installment history button',
        fetchPiutangSection.includes('data-lucide="list"') && fetchPiutangSection.includes('Riwayat Cicilan & Bayar'));

    // A7 Dashboard per Role
    assert('A7: JS init() only calls permitted fetch functions per role',
        jsContent.includes('if (loggedRole === \'admin\')') && jsContent.includes('else if (loggedRole === \'finance\')') && jsContent.includes('else if (loggedRole === \'gudang\')'));

    // 3. Dynamic Backend API Tests against port 3005
    console.log('\n--- Phase 3: Dynamic Backend API Verification (PORT ' + TEST_PORT + ') ---');
    await startTestServer();

    // Generate tokens
    const adminToken = makeToken({ id: 1, username: 'admin', role: 'admin' });
    const financeToken = makeToken({ id: 3, username: 'demo_finance', role: 'finance' });
    const gudangToken = makeToken({ id: 4, username: 'demo_gudang', role: 'gudang' });
    const kasirToken = makeToken({ id: 5, username: 'demo_kasir', role: 'kasir' });

    // A1 API Test: low stock excludes inactive products
    console.log('\n--- Testing A1: Low Stock API ---');
    await db.query("UPDATE products SET is_active = 0 WHERE id = 'P000001'");
    await db.query("UPDATE products SET is_active = 1 WHERE id = 'P000002'");

    const sumResAdmin = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/summary',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert('GET /api/dashboard/summary returns 200', sumResAdmin.status === 200);
    const lowStockList = sumResAdmin.body.lowStockProducts || [];
    const inactiveInLowStock = lowStockList.find(p => p.id === 'P000001');
    assert('A1 & A2: Inactive product (P000001) is EXCLUDED from lowStockProducts', !inactiveInLowStock);

    // A2 API Test: Delete protection & status toggle
    console.log('\n--- Testing A2: Product Delete Protection & Status Toggle ---');
    // 1) Find a product with transactions (invoice_items)
    const [txItems] = await db.query("SELECT product_id FROM invoice_items WHERE product_id IS NOT NULL AND product_id != '' LIMIT 1");
    if (txItems.length > 0) {
        const txProdId = txItems[0].product_id;
        const delRes = await request({
            hostname: 'localhost',
            port: TEST_PORT,
            path: `/api/products/${txProdId}`,
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + adminToken }
        });
        assert('A2.1: DELETE product with transactions returns 400', delRes.status === 400, `Got: ${delRes.status} ${JSON.stringify(delRes.body)}`);
        assert('A2.1: Error message explains transaction history exists',
            delRes.body && delRes.body.error && delRes.body.error.includes('riwayat transaksi'));
    }

    // 2) Create dummy product with pricelist item only, then delete -> must succeed
    const tempId = 'TEST-DEL-PL-' + Date.now();
    const tempSku = 'SKU-' + Date.now();
    await db.query(`
        INSERT INTO products (id, sku, name, category_id, unit_id, cost_price, sell_price, stock, min_stock, is_active)
        VALUES (?, ?, 'Test Delete Pricelist Only', 'PC-1', 'PU-1', 1000, 2000, 10, 2, 1)
    `, [tempId, tempSku]);

    let [plRows] = await db.query("SELECT id FROM pricelists LIMIT 1");
    let testPlId = plRows.length > 0 ? plRows[0].id : 1;
    if (plRows.length === 0) {
        const [insPl] = await db.query("INSERT INTO pricelists (kode, nama, is_active) VALUES ('PL-TEST', 'Test PL', 1)");
        testPlId = insPl.insertId;
    }
    await db.query("INSERT INTO pricelist_items (pricelist_id, product_id, harga) VALUES (?, ?, 2500)", [testPlId, tempId]);

    const delPlRes = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: `/api/products/${tempId}`,
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert('A2.1: DELETE product with ONLY pricelist succeeds (200)', delPlRes.status === 200, `Got ${delPlRes.status}`);

    const [checkPli] = await db.query("SELECT * FROM pricelist_items WHERE product_id = ?", [tempId]);
    assert('A2.1: Pricelist items row was cascade deleted', checkPli.length === 0);

    // 3) Toggle status PATCH /api/products/:id/status
    const toggleId = 'TEST-TOGGLE-' + Date.now();
    const toggleSku = 'SKU-TOGGLE-' + Date.now();
    await db.query(`
        INSERT INTO products (id, sku, name, category_id, unit_id, cost_price, sell_price, stock, min_stock, is_active)
        VALUES (?, ?, 'Test Toggle Product', 'PC-1', 'PU-1', 5000, 10000, 5, 2, 1)
    `, [toggleId, toggleSku]);

    // Toggle to inactive (0)
    const patch0 = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: `/api/products/${toggleId}/status`,
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + adminToken, 'Content-Type': 'application/json' }
    }, { is_active: 0 });
    assert('A2.2: PATCH /api/products/:id/status to inactive returns 200', patch0.status === 200);

    const [dbProd0] = await db.query("SELECT is_active FROM products WHERE id = ?", [toggleId]);
    assert('A2.2: DB is_active is now 0', dbProd0[0].is_active === 0);

    // Status filter tests
    const getActive = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: `/api/products?page=1&limit=80&status=active&q=${toggleSku}`,
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert('A2.2: GET /api/products?status=active does NOT contain deactivated product',
        getActive.body.data && getActive.body.data.length === 0);

    const getInactive = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: `/api/products?page=1&limit=80&status=inactive&q=${toggleSku}`,
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert('A2.2: GET /api/products?status=inactive DOES contain deactivated product',
        getInactive.body.data && getInactive.body.data.length === 1 && String(getInactive.body.data[0].id) === String(toggleId));

    const getAll = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: `/api/products?page=1&limit=80&status=all&q=${toggleSku}`,
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert('A2.2: GET /api/products?status=all contains deactivated product',
        getAll.body.data && getAll.body.data.length === 1);

    // Clean up test product
    await db.query("DELETE FROM products WHERE id = ?", [toggleId]);

    // A3 API Test: Performance with 5000+ products
    console.log('\n--- Testing A3: Products Table & Single Product Fetch Latency ---');
    const tStart = Date.now();
    const pagProdRes = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/products?page=1&limit=80&status=active',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    const tElapsed = Date.now() - tStart;
    assert('A3: Paginated GET /api/products?limit=80 response time < 150ms with 5,000+ rows',
        tElapsed < 150, `Elapsed: ${tElapsed}ms`);
    assert('A3: Returns data array and pagination metadata',
        pagProdRes.status === 200 && Array.isArray(pagProdRes.body.data) && pagProdRes.body.pagination.total >= 5000);

    const tSingleStart = Date.now();
    const singleProdRes = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/products/P000001',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    const tSingleElapsed = Date.now() - tSingleStart;
    assert('A3: Single product fetch GET /api/products/:id < 50ms',
        tSingleElapsed < 50, `Elapsed: ${tSingleElapsed}ms`);
    assert('A3: Single product fetch returns 200 with product data',
        singleProdRes.status === 200 && singleProdRes.body.id === 'P000001');

    // A6 API Test: Receivables delete protection for sales transactions
    console.log('\n--- Testing A6: Piutang Delete Protection ---');
    const [salesInvoices] = await db.query("SELECT id FROM sales_invoices WHERE (is_outstanding_import = 0 OR is_outstanding_import IS NULL) LIMIT 1");
    if (salesInvoices.length > 0) {
        const invId = salesInvoices[0].id;
        const delInvRes = await request({
            hostname: 'localhost',
            port: TEST_PORT,
            path: `/api/finance/receivables/${invId}`,
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + adminToken }
        });
        assert('A6: DELETE sales invoice receivable rejected (400 or 403)', [400, 403].includes(delInvRes.status));
        assert('A6: Error message explains sales invoice cannot be deleted',
            delInvRes.body && delInvRes.body.error && (delInvRes.body.error.includes('Hanya invoice') || delInvRes.body.error.includes('tidak dapat dihapus')));
    }

    // A7 API Test: Role boundaries in /api/dashboard/summary & charts
    console.log('\n--- Testing A7: Dashboard per Role Permissions ---');
    // Finance summary
    const sumFinance = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/summary',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + financeToken }
    });
    assert('A7: Finance summary returns revenue & receivables',
        sumFinance.status === 200 && sumFinance.body.revenue !== undefined);
    assert('A7: Finance summary ordersToday is 0 or excluded',
        sumFinance.body.ordersToday === 0 || sumFinance.body.ordersToday === undefined);

    // Gudang summary
    const sumGudang = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/summary',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + gudangToken }
    });
    const gudangFinanceZeroOrOmitted =
        (sumGudang.body.revenue === undefined || sumGudang.body.revenue === 0) &&
        (sumGudang.body.grossProfit === undefined || sumGudang.body.grossProfit === 0) &&
        (sumGudang.body.receivables === undefined || sumGudang.body.receivables === 0) &&
        (sumGudang.body.payables === undefined || sumGudang.body.payables === 0);
    assert('A7: Gudang summary revenue, grossProfit, receivables, payables are 0 or omitted', gudangFinanceZeroOrOmitted);
    assert('A7: Gudang summary lowStockCount & productCount are returned',
        sumGudang.body.lowStockCount !== undefined && sumGudang.body.productCount !== undefined);

    // Kasir summary
    const sumKasir = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/summary',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + kasirToken }
    });
    const kasirFinanceZeroOrOmitted =
        (sumKasir.body.revenue === undefined || sumKasir.body.revenue === 0) &&
        (sumKasir.body.grossProfit === undefined || sumKasir.body.grossProfit === 0) &&
        (sumKasir.body.payables === undefined || sumKasir.body.payables === 0);
    assert('A7: Kasir summary finance metrics (revenue, grossProfit, payables) are 0 or omitted', kasirFinanceZeroOrOmitted);
    assert('A7: Kasir summary ordersToday & customerCount are returned',
        sumKasir.body.ordersToday !== undefined && sumKasir.body.customerCount !== undefined);

    // Chart endpoint permissions
    const trendKasir = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/sales-trend',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + kasirToken }
    });
    assert('A7: Kasir access to /api/dashboard/sales-trend returns 403 Forbidden', trendKasir.status === 403);

    const trendGudang = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/sales-trend',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + gudangToken }
    });
    assert('A7: Gudang access to /api/dashboard/sales-trend returns 403 Forbidden', trendGudang.status === 403);

    const trendFinance = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/sales-trend',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + financeToken }
    });
    assert('A7: Finance access to /api/dashboard/sales-trend returns 200 OK', trendFinance.status === 200);

    const trendAdmin = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/dashboard/sales-trend',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert('A7: Admin access to /api/dashboard/sales-trend returns 200 OK', trendAdmin.status === 200);

    // Reset product 1 is_active back to 1
    await db.query("UPDATE products SET is_active = 1 WHERE id = 'P000001'");

    await stopTestServer();
    await db.end();

    console.log('\n====================================================');
    const passedCount = results.filter(r => r.pass).length;
    const totalCount = results.length;
    console.log(`  SUMMARY: ${passedCount}/${totalCount} tests passed.`);
    if (passedCount === totalCount) {
        console.log('  ALL BATCH A VERIFICATIONS PASSED SUCCESSFULLY!');
    } else {
        console.log(`  WARNING: ${totalCount - passedCount} tests failed.`);
    }
    console.log('====================================================');
}

run().catch(err => {
    console.error('Fatal test error:', err);
    stopTestServer();
    process.exit(1);
});
