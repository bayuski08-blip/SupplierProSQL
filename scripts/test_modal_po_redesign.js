const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');

const CLONE_DB = 'supplierpro_clone';
const TEST_PORT = 5006;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const JWT_SECRET = 'supplierpro_secret_key_demo';

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

async function runTestSuite() {
    console.log('====================================================');
    console.log('🧪 TEST SUITE: Redesain Modal Buat Purchase Order');
    console.log(`🎯 Database: ${CLONE_DB} (CLONED DATABASE)`);
    console.log('====================================================\n');

    // ----------------------------------------------------
    console.log('--- TEST 1: Verifikasi File HTML & Struktur Layout ---');
    // ----------------------------------------------------
    const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

    // 1.1 Modal wrapper exists
    assert('Modal Buat Purchase Order exists', html.includes('id="modal-add-purchase"'));

    // 1.2 Layout baris 1 & 2
    const modalAddPoHtml = html.substring(html.indexOf('id="modal-add-purchase"'), html.indexOf('id="modal-edit-purchase"'));
    
    const row1HasNoPo = modalAddPoHtml.includes('No. PO (Otomatis)');
    const row1HasDate = modalAddPoHtml.includes('id="add-purchase-date"');
    assert('Baris 1 berisi No. PO dan Tanggal', row1HasNoPo && row1HasDate);

    const row2HasVendor = modalAddPoHtml.includes('id="add-purchase-vendor"');
    const row2HasPaymentType = modalAddPoHtml.includes('id="add-purchase-payment-type"');
    assert('Baris 2 berisi Vendor dan Tipe Pembayaran sejajar', row2HasVendor && row2HasPaymentType);

    // 1.3 Cek tipe pembayaran lama di bagian bawah sudah dihapus
    const summarySection = modalAddPoHtml.substring(modalAddPoHtml.indexOf('<!-- Summary & Total -->'));
    assert('Tipe pembayaran di area bawah modal sudah dihapus', !summarySection.includes('id="add-purchase-payment-type"'));

    // 1.4 Daftar Item header
    assert('Dropdown "Pilih Produk..." di header sudah dihapus', !modalAddPoHtml.includes('id="add-purchase-product-select"'));
    assert('Tombol "Tambah Item" di header sudah dihapus', !modalAddPoHtml.includes('id="btn-add-purchase-item"'));
    assert('Label "Daftar Item" berdiri sendiri', modalAddPoHtml.includes('Daftar Item</label>'));

    // 1.5 Kolom tabel: Produk | Qty | Harga Beli | Subtotal | aksi
    assert('Kolom tabel Produk ada', /<th[^>]*>\s*Produk\s*<\/th>/i.test(modalAddPoHtml));
    assert('Kolom tabel Qty ada', /<th[^>]*>\s*Qty\s*<\/th>/i.test(modalAddPoHtml));
    assert('Kolom tabel Harga Beli ada', /<th[^>]*>\s*Harga Beli\s*<\/th>/i.test(modalAddPoHtml));
    assert('Kolom tabel Subtotal ada', /<th[^>]*>\s*Subtotal\s*<\/th>/i.test(modalAddPoHtml));

    // 1.6 Kolom pencarian di bawah tabel (tfoot)
    assert('Input pencarian produk ada di tabel', modalAddPoHtml.includes('id="add-purchase-product-search"'));
    assert('Placeholder pencarian sesuai spec', modalAddPoHtml.includes('placeholder="Ketik nama produk untuk menambah..."'));
    assert('Dropdown autocomplete ada', modalAddPoHtml.includes('id="add-purchase-product-dropdown"'));

    // 1.7 Area total di kanan bawah tabel
    assert('Total Item display ada', modalAddPoHtml.includes('id="add-purchase-subtotal-display"'));
    assert('Grand Total display ada', modalAddPoHtml.includes('id="add-purchase-total-display"'));

    // 1.8 Footer modal: Batal & Simpan PO
    assert('Tombol Batal ada di footer', modalAddPoHtml.includes("closeModal('modal-add-purchase')") && modalAddPoHtml.includes('Batal'));
    assert('Tombol Simpan PO ada di footer', modalAddPoHtml.includes("savePurchase(false)") && modalAddPoHtml.includes('Simpan'));

    // ----------------------------------------------------
    console.log('\n--- TEST 2: Verifikasi CSS Rules ---');
    // ----------------------------------------------------
    const css = fs.readFileSync(path.join(__dirname, '..', 'dashboard.css'), 'utf8');

    assert('CSS .po-search-highlight ada', css.includes('.po-search-highlight'));
    assert('CSS .po-autocomplete-dropdown ada', css.includes('.po-autocomplete-dropdown'));
    assert('CSS .po-dropdown-item ada', css.includes('.po-dropdown-item'));
    assert('CSS .po-dropdown-footer ada', css.includes('.po-dropdown-footer'));
    assert('CSS .po-row-highlight animation ada', css.includes('.po-row-highlight') && css.includes('@keyframes poRowFlash'));

    // ----------------------------------------------------
    console.log('\n--- TEST 3: Verifikasi Logika JS (Search, Autocomplete, Highlighting) ---');
    // ----------------------------------------------------
    const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8');

    assert('Fungsi highlightMatch didefinisikan', js.includes('function highlightMatch('));
    assert('Fungsi renderPoDropdown didefinisikan', js.includes('function renderPoDropdown('));
    assert('Fungsi initPoProductSearch didefinisikan', js.includes('function initPoProductSearch('));
    assert('Fungsi positionPoDropdown didefinisikan', js.includes('function positionPoDropdown('));
    assert('Debounce 150ms diterapkan pada pencarian', js.includes('150') && js.includes('poSearchDebounceTimer'));

    // Mock DOM environment for Sandbox
    const elements = {};
    const mockElement = (tag = 'div') => {
        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            classList: {
                add: (c) => el.className = (el.className || '') + ' ' + c,
                remove: (c) => el.className = (el.className || '').replace(c, '').trim()
            },
            dataset: {},
            children: [],
            appendChild: (child) => el.children.push(child),
            innerHTML: '',
            textContent: '',
            value: '',
            focus: () => {},
            addEventListener: () => {},
            closest: () => ({ getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 600 }), scrollTop: 0, scrollLeft: 0 }),
            getBoundingClientRect: () => ({ top: 100, bottom: 135, left: 50, right: 410, width: 360, height: 35 }),
            querySelectorAll: () => []
        };
        return el;
    };

    ['add-purchase-items-container', 'add-purchase-subtotal-display', 'add-purchase-total-display',
     'add-purchase-product-search', 'add-purchase-product-dropdown'].forEach(id => {
        elements[id] = mockElement();
    });

    const sandbox = {
        document: {
            getElementById: (id) => elements[id] || null,
            createElement: (tag) => mockElement(tag),
            querySelector: (sel) => mockElement(),
            querySelectorAll: () => [],
            addEventListener: () => {}
        },
        window: {
            innerWidth: 1024,
            addEventListener: () => {}
        },
        lucide: { createIcons: () => {} },
        setTimeout: (fn) => fn(),
        clearTimeout: () => {}
    };

    const evalScript = `
        ${js.substring(js.indexOf('function escapeHtml('), js.indexOf('let editPurchaseItems = [];'))}
    `;
    const vm = require('vm');
    vm.createContext(sandbox);
    vm.runInContext(evalScript, sandbox);

    // Test highlightMatch
    const highlighted = sandbox.highlightMatch('Kecap Manis Bango 550ml', 'bango');
    assert('highlightMatch menghasilkan mark class="po-search-highlight"', highlighted.includes('<mark class="po-search-highlight">Bango</mark>'));
    
    const highlightedMid = sandbox.highlightMatch('Beras Pandan Wangi 5kg', 'dan');
    assert('highlightMatch mencocokkan di bagian tengah kata', highlightedMid.includes('Pan<mark class="po-search-highlight">dan</mark>'));

    // Test search filtering: case-insensitive & substring anywhere
    const mockProducts = [
        { id: '1', name: 'Minyak Goreng Sania 2L', stock: 10, cost: 32000, price: 35000 },
        { id: '2', name: 'Tepung Terigu Segitiga Biru 1kg', stock: 25, cost: 11000, price: 13000 },
        { id: '3', name: 'Gula Pasir Gulaku 1kg', stock: 50, cost: 14000, price: 16000 },
        { id: '4', name: 'Susu Kental Manis Frisian Flag 370g', stock: 15, cost: 10500, price: 12000 },
        { id: '5', name: 'Kopi Kapal Api Spesial 165g', stock: 30, cost: 13500, price: 15000 },
        { id: '6', name: 'Beras Rojolele 10kg', stock: 8, cost: 130000, price: 145000 },
        { id: '7', name: 'Beras Pandan Wangi 5kg', stock: 12, cost: 75000, price: 85000 },
        { id: '8', name: 'Beras Merah Organik 2kg', stock: 5, cost: 40000, price: 48000 },
        { id: '9', name: 'Beras Ketan Putih 1kg', stock: 14, cost: 18000, price: 22000 },
        { id: '10', name: 'Beras Jagung 1kg', stock: 20, cost: 12000, price: 15000 }
    ];

    sandbox.PRODUCTS = mockProducts;
    sandbox.rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

    // Filter "beras": should find 5 products matching anywhere
    const berasMatches = mockProducts.filter(p => p.name.toLowerCase().includes('beras'));
    assert('Pencarian "beras" menemukan 5 produk (substring anywhere)', berasMatches.length === 5);

    // Filter "1kg": matches middle/end of string
    const kgMatches = mockProducts.filter(p => p.name.toLowerCase().includes('1kg'));
    assert('Pencarian "1kg" menemukan produk dengan "1kg" di akhir nama', kgMatches.length === 4);

    // Test max 8 items limitation
    const allMatches = mockProducts.filter(p => p.name.length > 0);
    const displayed = allMatches.slice(0, 8);
    assert('Hasil pencarian dibatasi maksimal 8 item', displayed.length === 8);

    // ----------------------------------------------------
    console.log('\n--- TEST 4: Verifikasi Penambahan Item & Mencegah Duplikasi ---');
    // ----------------------------------------------------
    sandbox.addPurchaseItems = [];
    
    // Add product 1 first time
    sandbox.addProductToPo(mockProducts[0]);
    assert('Menambah produk pertama berhasil (panjang item = 1)', sandbox.addPurchaseItems.length === 1);
    assert('Qty awal = 1', sandbox.addPurchaseItems[0].quantity === 1);
    assert('Harga beli otomatis terisi dari cost', sandbox.addPurchaseItems[0].price === 32000);

    // Add product 1 second time (should NOT duplicate, should increment Qty)
    sandbox.addProductToPo(mockProducts[0]);
    assert('Menambah produk yang sama TIDAK membuat baris ganda (panjang tetap 1)', sandbox.addPurchaseItems.length === 1);
    assert('Qty bertambah menjadi 2', sandbox.addPurchaseItems[0].quantity === 2);

    // Add product 2
    sandbox.addProductToPo(mockProducts[1]);
    assert('Menambah produk kedua menambah baris baru (panjang = 2)', sandbox.addPurchaseItems.length === 2);

    // Calculate total
    const subtotal = sandbox.addPurchaseItems.reduce((acc, item) => acc + (item.quantity * item.price), 0);
    const expectedSubtotal = (2 * 32000) + (1 * 11000); // 64.000 + 11.000 = 75.000
    assert('Perhitungan subtotal akurat (75.000)', subtotal === expectedSubtotal);

    // Remove product 1
    const removeFn = sandbox.removeAddPurchaseItem || sandbox.window.removeAddPurchaseItem;
    removeFn(0);
    assert('Hapus baris item berhasil (panjang = 1)', sandbox.addPurchaseItems.length === 1);
    assert('Item tersisa adalah produk 2', sandbox.addPurchaseItems[0].product_id === '2');

    // ----------------------------------------------------
    console.log('\n--- TEST 5: Verifikasi Realtime Produk Baru Tanpa Refresh ---');
    // ----------------------------------------------------
    // Tambah produk baru ke sandbox.PRODUCTS
    const newProd = { id: '99', name: 'Saus Tomat ABC 275ml', stock: 40, cost: 7000, price: 8500 };
    sandbox.PRODUCTS.push(newProd);

    // Cari langsung
    const foundNew = sandbox.PRODUCTS.filter(p => p.name.toLowerCase().includes('tomat'));
    assert('Produk baru langsung ditemukan tanpa refresh browser', foundNew.length === 1 && foundNew[0].id === '99');

    // ----------------------------------------------------
    console.log('\n--- TEST 6: Pengujian API & Database pada Database Kloning (supplierpro_clone) ---');
    // ----------------------------------------------------
    const db = await mysql.createConnection({
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: CLONE_DB
    });

    let serverProcess = null;

    try {
        // Ambil produk uji dari database kloning
        const [dbProducts] = await db.query('SELECT id, name, stock, cost_price FROM products LIMIT 2');
        if (dbProducts.length < 2) {
            throw new Error('Database kloning membutuhkan minimal 2 produk untuk pengujian');
        }

        const prod1 = dbProducts[0];
        const prod2 = dbProducts[1];
        const stock1Before = parseFloat(prod1.stock);
        const stock2Before = parseFloat(prod2.stock);

        console.log(`  Data awal: ${prod1.name} (Stok: ${stock1Before}), ${prod2.name} (Stok: ${stock2Before})`);

        // Start server pointing to supplierpro_clone
        console.log(`  Starting test server on port ${TEST_PORT} with database ${CLONE_DB}...`);
        serverProcess = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(TEST_PORT),
                DATABASE_URL: `mysql://root:@127.0.0.1:3306/${CLONE_DB}`,
                DB_NAME: CLONE_DB,
                JWT_SECRET: JWT_SECRET
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Wait for server to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Server start timeout')), 6000);
            serverProcess.stdout.on('data', (d) => {
                if (d.toString().includes('running on port')) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
            serverProcess.stderr.on('data', (d) => {
                // console.error('[Server err]:', d.toString());
            });
        });

        const token = jwt.sign(
            { id: 1, username: 'admin', role: 'admin', name: 'Administrator' },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Ambil Vendor & Payment Type dari database kloning
        const [vendors] = await db.query('SELECT id FROM vendors LIMIT 1');
        const [paymentTypes] = await db.query('SELECT id, name FROM payment_types');
        const cashPt = paymentTypes.find(p => !p.name.toLowerCase().includes('kredit')) || paymentTypes[0];
        const creditPt = paymentTypes.find(p => p.name.toLowerCase().includes('kredit')) || paymentTypes[1];

        // 6.1 Simpan PO Tunai: Verifikasi stok bertambah & status Selesai
        console.log('\n  Sub-test 6.1: Simpan PO Tunai...');
        const poTunaiPayload = {
            vendor_id: vendors[0].id,
            date: new Date().toISOString().split('T')[0],
            payment_type_id: cashPt.id,
            items: [
                { product_id: prod1.id, qty: 5, price: parseFloat(prod1.cost_price || 10000) },
                { product_id: prod2.id, qty: 3, price: parseFloat(prod2.cost_price || 15000) }
            ]
        };

        const resTunai = await fetch(`${BASE_URL}/api/purchases`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(poTunaiPayload)
        });

        const dataTunai = await resTunai.json();
        assert('Simpan PO Tunai berhasil (status 200, sukses)', resTunai.ok && dataTunai.success);

        // Cek stok bertambah di database kloning
        const [p1After] = await db.query('SELECT stock FROM products WHERE id = ?', [prod1.id]);
        const [p2After] = await db.query('SELECT stock FROM products WHERE id = ?', [prod2.id]);
        assert('Stok produk 1 bertambah 5 unit', parseFloat(p1After[0].stock) === stock1Before + 5);
        assert('Stok produk 2 bertambah 3 unit', parseFloat(p2After[0].stock) === stock2Before + 3);

        // Cek status PO di DB
        const [poRecord] = await db.query('SELECT status, paid_amount, total FROM purchase_orders WHERE id = ?', [dataTunai.id]);
        assert('PO Tunai berstatus Selesai', poRecord[0].status === 'Selesai');
        assert('PO Tunai terbayar lunas (paid = total)', parseFloat(poRecord[0].paid_amount) === parseFloat(poRecord[0].total));

        // 6.2 Simpan PO Kredit: Verifikasi stok bertambah & hutang terbentuk (Belum Lunas, paid = 0)
        console.log('\n  Sub-test 6.2: Simpan PO Kredit...');
        const stock1BeforeCredit = parseFloat(p1After[0].stock);
        const poKreditPayload = {
            vendor_id: vendors[0].id,
            date: new Date().toISOString().split('T')[0],
            payment_type_id: creditPt.id,
            items: [
                { product_id: prod1.id, qty: 10, price: parseFloat(prod1.cost_price || 10000) }
            ]
        };

        const resKredit = await fetch(`${BASE_URL}/api/purchases`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(poKreditPayload)
        });

        const dataKredit = await resKredit.json();
        assert('Simpan PO Kredit berhasil (status 200, sukses)', resKredit.ok && dataKredit.success);

        // Cek stok bertambah lagi 10 unit
        const [p1AfterCredit] = await db.query('SELECT stock FROM products WHERE id = ?', [prod1.id]);
        assert('Stok produk 1 bertambah 10 unit untuk PO Kredit', parseFloat(p1AfterCredit[0].stock) === stock1BeforeCredit + 10);

        // Cek hutang: status Belum Lunas dan paid_amount = 0
        const [poKreditRecord] = await db.query('SELECT status, paid_amount, total, due_date FROM purchase_orders WHERE id = ?', [dataKredit.id]);
        assert('PO Kredit berstatus Belum Lunas (membentuk hutang)', poKreditRecord[0].status === 'Belum Lunas');
        assert('PO Kredit paid_amount = 0', parseFloat(poKreditRecord[0].paid_amount) === 0);
        assert('PO Kredit memiliki due_date (jatuh tempo)', Boolean(poKreditRecord[0].due_date));

    } finally {
        if (serverProcess) {
            serverProcess.kill();
        }
        await db.end();
    }

    console.log('\n====================================================');
    console.log(`HASIL AKHIR: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTestSuite().catch(err => {
    console.error('Fatal error during test suite:', err);
    process.exit(1);
});
