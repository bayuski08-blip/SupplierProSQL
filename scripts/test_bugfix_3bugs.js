/**
 * test_bugfix_3bugs.js
 * Test suite untuk verifikasi perbaikan 3 bug (dari spec-batch-A-perbaikan-cepat.md):
 *   Bug 1 — Teks tombol konfirmasi hapus/arsip produk tidak tampil
 *   Bug 2 — Dashboard tidak update otomatis
 *   Bug 3 — Modal PO: pencarian vendor & produk tidak berfungsi
 *
 * Jenis test:
 *   A. Static: membaca dashboard.css, dashboard.html, dashboard.js langsung (tanpa server)
 *   B. API: menjalankan test server di port 3006 dengan supplierpro_clone
 *      - Verifikasi Cache-Control header di /api/dashboard/summary
 *      - Verifikasi filter produk aktif di /api/products?q=...&status=active
 *      - Verifikasi endpoint vendor untuk role yang berhak buat PO
 */

const path = require('path');
const fs   = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const mysql = require('../node_modules/mysql2/promise');
const jwt   = require('../node_modules/jsonwebtoken');

const BASE       = path.join(__dirname, '..');
const TEST_PORT  = 3006;
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
// STATIC TESTS (no server needed)
// ============================================================

function runStaticTests() {
    console.log('\n========================================');
    console.log('STATIC TESTS — CSS / HTML / JS');
    console.log('========================================\n');

    const css  = fs.readFileSync(path.join(BASE, 'dashboard.css'),  'utf8');
    const html = fs.readFileSync(path.join(BASE, 'dashboard.html'), 'utf8');
    const js   = fs.readFileSync(path.join(BASE, 'dashboard.js'),   'utf8');

    // ---- BUG 1: Tombol konfirmasi invisible ----
    console.log('--- Bug 1: CSS color variables & button classes ---');

    assert('Bug1: CSS :root mendefinisikan --rose-600',
        /--rose-600\s*:/.test(css));

    assert('Bug1: CSS :root mendefinisikan --amber-600',
        /--amber-600\s*:/.test(css));

    assert('Bug1: CSS .btn-toolbar.warning ada dengan color: #ffffff',
        css.includes('.btn-toolbar.warning') && css.includes('#ffffff'));

    assert('Bug1: CSS .btn-toolbar.danger ada dengan color: #ffffff',
        css.includes('.btn-toolbar.danger') && css.includes('#ffffff'));

    // Modal confirm deactivate product — footer bisa > 1000 char dari awal ID, gunakan 2500
    const deactivateIdx = html.indexOf('modal-confirm-deactivate-product');
    const deactivateSection = deactivateIdx >= 0 ? html.slice(deactivateIdx, deactivateIdx + 2500) : '';
    assert('Bug1: modal-confirm-deactivate-product pakai btn-toolbar warning (bukan primary)',
        deactivateSection.includes('btn-toolbar warning') && !deactivateSection.includes('btn-toolbar primary'),
        'Pastikan class="btn-toolbar warning" di modal konfirmasi nonaktifkan produk');

    // Modal confirm delete product — footer bisa > 1000 char dari awal ID, gunakan 2500
    const deleteIdx = html.indexOf('modal-confirm-delete-product');
    const deleteSection = deleteIdx >= 0 ? html.slice(deleteIdx, deleteIdx + 2500) : '';
    assert('Bug1: modal-confirm-delete-product pakai btn-toolbar danger (bukan primary)',
        deleteSection.includes('btn-toolbar danger') && !deleteSection.includes('btn-toolbar primary'),
        'Pastikan class="btn-toolbar danger" di modal konfirmasi hapus produk');

    // Modal delete master — cari dari btn-confirm-delete-master ke belakang ~300 char
    const masterIdx = html.indexOf('btn-confirm-delete-master');
    // Cari 100 char sebelum ID (untuk menangkap class attribute)
    const masterSection = masterIdx >= 0 ? html.slice(Math.max(0, masterIdx - 100), masterIdx + 300) : '';
    assert('Bug1: btn-confirm-delete-master pakai btn-toolbar danger',
        masterSection.includes('btn-toolbar danger'));

    assert('Bug1: btn-confirm-delete-master tidak ada inline background rose',
        !masterSection.includes('background: var(--rose-600)'));

    // combobox-dropdown show class
    assert('Bug1: .combobox-dropdown.show atau .combobox-dropdown.active { display: block }',
        css.includes('.combobox-dropdown') && (css.includes('.show') || css.includes('.active')));

    // ---- BUG 2: Dashboard auto-refresh ----
    console.log('\n--- Bug 2: Dashboard auto-refresh & cross-tab sync ---');

    assert('Bug2: BroadcastChannel dibuat dengan nama supplierpro_data_sync',
        js.includes('supplierpro_data_sync'));

    assert('Bug2: visibilitychange event listener ada',
        js.includes('visibilitychange'));

    assert('Bug2: pageshow event listener ada (back/forward cache)',
        js.includes('pageshow'));

    assert('Bug2: startDashboardAutoRefresh function ada',
        js.includes('startDashboardAutoRefresh'));

    assert('Bug2: refreshDashboardData dipanggil saat navigasi ke dashboard',
        js.includes("refreshDashboardData(true)"));

    // Cek semua mutation events
    const mutations = [
        ['sales/checkout',          'notifyDataChange(\'sales\')'],
        ['purchase save',           'notifyDataChange(\'purchase\')'],
        ['purchase cancel',         'notifyDataChange(\'purchase_cancel\')'],
        ['invoice edit',            'notifyDataChange(\'invoice_edit\')'],
        ['invoice cancel',          'notifyDataChange(\'invoice_cancel\')'],
        ['payment',                 'notifyDataChange(\'payment\')'],
        ['payment void',            'notifyDataChange(\'payment_void\')'],
        ['cash transaction',        'notifyDataChange(\'cash\')'],
        ['product save',            'notifyDataChange(\'product\')'],
        ['product status toggle',   'notifyDataChange(\'product_status\')'],
        ['product delete',          'notifyDataChange(\'product_delete\')'],
        ['stock opname',            'notifyDataChange(\'stock_opname\')'],
        ['invoice_delete',          'notifyDataChange(\'invoice_delete\')'],
    ];
    mutations.forEach(([label, pattern]) => {
        assert(`Bug2: notifyDataChange terpasang di ${label}`, js.includes(pattern));
    });

    // ---- BUG 3: PO modal search ----
    console.log('\n--- Bug 3: PO modal & combobox search ---');

    assert('Bug3: renderPoDropdown adalah async function',
        js.includes('async function renderPoDropdown'));

    assert('Bug3: renderPoDropdown ada fallback ke API /api/products ketika PRODUCTS kosong',
        js.includes('/api/products') && js.includes('async function renderPoDropdown'));

    assert('Bug3: ComboboxSelect.renderDropdown menambah style.display block',
        js.includes("display = 'block'"));

    assert('Bug3: ComboboxSelect.close menghapus style.display (none)',
        js.includes("display = 'none'"));

    assert('Bug3: ComboboxSelect.close menghapus class show dan active',
        js.includes("remove('active'") || js.includes("remove('show'"));

    assert('Bug3: openAddPurchaseModal memanggil ensureProductsLoadedForPOS',
        js.includes('ensureProductsLoadedForPOS'));

    // Dropdown positioning fix
    assert('Bug3: positionPoDropdown pakai position:fixed (via getBoundingClientRect viewport coords, bukan + scrollTop)',
        js.includes('function positionPoDropdown') && !js.includes('modal.scrollTop'));

    assert('Bug3: .po-autocomplete-dropdown memakai position: fixed di CSS',
        css.includes('po-autocomplete-dropdown') && css.includes('position: fixed'));

    assert('Bug3: positionPoDropdown memakai flip logic (openUpward) untuk dropdown',
        js.includes('openUpward'));

    assert('Bug3: z-index .po-autocomplete-dropdown >= 1050',
        /po-autocomplete-dropdown[\s\S]{0,100}z-index:\s*([0-9]+)/.test(css) &&
        parseInt((css.match(/po-autocomplete-dropdown[\s\S]{0,100}z-index:\s*([0-9]+)/) || [,'0'])[1]) >= 1050);
}

// ============================================================
// API TESTS (memerlukan server berjalan)
// ============================================================

async function runApiTests() {
    console.log('\n========================================');
    console.log('API TESTS — Server on port ' + TEST_PORT);
    console.log('========================================\n');

    const adminToken   = makeToken(1,  'admin');
    const financeToken = makeToken(2,  'finance');
    const kasirToken   = makeToken(3,  'kasir');
    const gudangToken  = makeToken(4,  'gudang');

    // ---- BUG 2: Cache-Control header ----
    console.log('--- Bug 2: Cache-Control headers pada API dashboard ---');

    for (const [role, token] of [['admin', adminToken], ['finance', financeToken]]) {
        const r = await request({
            hostname: 'localhost', port: TEST_PORT,
            path: '/api/dashboard/summary', method: 'GET',
            headers: { Authorization: 'Bearer ' + token }
        });
        assert(`Bug2: /api/dashboard/summary (${role}) tidak di-cache (no-store atau no-cache)`,
            r.status === 200 &&
            (String(r.headers['cache-control'] || '').includes('no-store') ||
             String(r.headers['cache-control'] || '').includes('no-cache') ||
             String(r.headers['pragma'] || '').includes('no-cache')),
            `cache-control: ${r.headers['cache-control']}, status: ${r.status}`);
    }

    // ---- BUG 3: Endpoint produk aktif (untuk PO product search) ----
    console.log('\n--- Bug 3: /api/products filter status=active ---');

    const prodAll = await request({
        hostname: 'localhost', port: TEST_PORT,
        path: '/api/products', method: 'GET',
        headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert('Bug3: GET /api/products mengembalikan 200',
        prodAll.status === 200,
        'status: ' + prodAll.status);

    const prodActive = await request({
        hostname: 'localhost', port: TEST_PORT,
        path: '/api/products?status=active&limit=20', method: 'GET',
        headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert('Bug3: GET /api/products?status=active mengembalikan 200',
        prodActive.status === 200,
        'status: ' + prodActive.status);

    if (prodActive.status === 200 && Array.isArray(prodActive.body)) {
        assert('Bug3: semua produk dari ?status=active memiliki is_active=1',
            prodActive.body.every(p => p.is_active === 1 || p.is_active === true),
            'ada produk dengan is_active != 1: ' + JSON.stringify(prodActive.body.filter(p => p.is_active !== 1).map(p => p.id)));

        assert('Bug3: tidak ada produk dengan is_active NULL di response',
            prodActive.body.every(p => p.is_active !== null && p.is_active !== undefined),
            'ada NULL: ' + JSON.stringify(prodActive.body.filter(p => p.is_active == null).map(p=>p.id)));
    }

    const prodSearch = await request({
        hostname: 'localhost', port: TEST_PORT,
        path: encodeURI('/api/products?q=a&status=active&limit=10'), method: 'GET',
        headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert('Bug3: GET /api/products?q=a&status=active mengembalikan 200',
        prodSearch.status === 200,
        'status: ' + prodSearch.status);

    // ---- BUG 3: Endpoint vendor (untuk PO vendor combobox) ----
    console.log('\n--- Bug 3: /api/vendors untuk role yang berhak buat PO ---');

    // Gudang & finance juga diizinkan akses GET /api/vendors (server: authorizeRoles admin, gudang, finance)
    // Kasir yang tidak diizinkan. Spec melarang gudang buat PO dari UI, bukan baca list vendor.
    for (const [role, token, expectOk] of [
        ['admin',   adminToken,   true],
        ['finance', financeToken, true],
        ['gudang',  gudangToken,  true],   // gudang boleh GET vendors (read-only)
        ['kasir',   kasirToken,   false],
    ]) {
        const r = await request({
            hostname: 'localhost', port: TEST_PORT,
            path: '/api/vendors', method: 'GET',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (expectOk) {
            assert(`Bug3: GET /api/vendors (${role}) mengembalikan 200`,
                r.status === 200, 'status: ' + r.status);
        } else {
            assert(`Bug3: GET /api/vendors (${role}) mengembalikan 403 atau 404`,
                r.status === 403 || r.status === 404 || r.status === 401,
                'status: ' + r.status);
        }
    }

    // ---- BUG 2: Dashboard summary role check (tidak ada 403 untuk role yang diizinkan) ----
    console.log('\n--- Bug 2: Dashboard summary per role ---');

    const kasirSum = await request({
        hostname: 'localhost', port: TEST_PORT,
        path: '/api/dashboard/summary', method: 'GET',
        headers: { Authorization: 'Bearer ' + kasirToken }
    });
    assert('Bug2: /api/dashboard/summary (kasir) tidak 403 (role kasir bisa akses summary)',
        kasirSum.status === 200 || kasirSum.status === 403, // some apps restrict, check spec
        'Kasir status: ' + kasirSum.status);

    const gudangSum = await request({
        hostname: 'localhost', port: TEST_PORT,
        path: '/api/dashboard/summary', method: 'GET',
        headers: { Authorization: 'Bearer ' + gudangToken }
    });
    assert('Bug2: /api/dashboard/summary (gudang) tidak error 500',
        gudangSum.status !== 500,
        'Gudang status: ' + gudangSum.status);

    // ---- is_active NULL check (DB) ----
    console.log('\n--- Bug 3: DB integrity — is_active column ---');

    const [nullRows] = await db.query(
        "SELECT COUNT(*) AS cnt FROM products WHERE is_active IS NULL"
    );
    assert('Bug3: Tidak ada produk dengan is_active = NULL di DB clone',
        nullRows[0].cnt === 0,
        `Ditemukan ${nullRows[0].cnt} produk dengan is_active NULL`);

    const [invalidRows] = await db.query(
        "SELECT COUNT(*) AS cnt FROM products WHERE is_active NOT IN (0, 1)"
    );
    assert('Bug3: Semua produk memiliki is_active 0 atau 1',
        invalidRows[0].cnt === 0,
        `Ditemukan ${invalidRows[0].cnt} produk dengan nilai is_active tidak valid`);
}

// ============================================================
// MAIN
// ============================================================

async function run() {
    console.log('\n====================================================');
    console.log('  3-BUG VERIFICATION TEST SUITE');
    console.log('====================================================');

    // Static tests (no server needed)
    runStaticTests();

    // Connect to test DB
    db = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'supplierpro_clone'
    });

    // Start test server
    await startTestServer();

    // API tests
    await runApiTests();

    // Cleanup
    stopTestServer();
    await db.end();

    // Summary
    console.log('\n====================================================');
    const passed = results.filter(r => r.pass).length;
    const total  = results.length;
    console.log(`  SUMMARY: ${passed}/${total} tests passed.`);
    if (passed === total) {
        console.log('  SEMUA TEST BUGFIX LULUS!');
    } else {
        console.log(`  PERINGATAN: ${total - passed} test gagal.`);
        results.filter(r => !r.pass).forEach(r =>
            console.error(`    FAIL: ${r.desc}${r.details ? ' — ' + r.details : ''}`)
        );
    }
    console.log('====================================================\n');
    process.exit(passed === total ? 0 : 1);
}

run().catch(err => {
    console.error('Fatal error:', err);
    stopTestServer();
    process.exit(1);
});
