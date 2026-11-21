const http = require('http');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production';
const PORT = 3008;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role, name: user.username },
        JWT_SECRET,
        { expiresIn: '2h' }
    );
}

const adminToken = generateToken({ id: 1, username: 'admin', role: 'admin' });
const financeToken = generateToken({ id: 3, username: 'demo_finance', role: 'finance' });
const gudangToken = generateToken({ id: 4, username: 'demo_gudang', role: 'gudang' });
const kasirToken = generateToken({ id: 5, username: 'demo_kasir', role: 'kasir' });

async function apiRequest(path, method = 'GET', body = null, token = adminToken) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const req = http.request(url, { method, headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

let serverProcess = null;

async function startServer() {
    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env, {
            PORT: String(PORT),
            DATABASE_URL: 'mysql://root:@localhost:3306/supplierpro_clone',
            DB_NAME: 'supplierpro_clone',
            DB_USER: 'root',
            DB_PASSWORD: '',
            DB_HOST: 'localhost',
            JWT_SECRET: JWT_SECRET
        });

        serverProcess = spawn('node', ['server.js'], { env, cwd: 'C:/Vibes Coding/SupplierProSQL' });

        serverProcess.stdout.on('data', (d) => {
            const str = d.toString();
            if (str.includes(`running on port ${PORT}`) || str.includes(`${PORT}`)) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (d) => {
            console.error('SERVER ERR:', d.toString());
        });

        serverProcess.on('error', reject);

        setTimeout(() => {
            resolve();
        }, 3500);
    });
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
}

async function runTests() {
    console.log('--- STARTING COMPLETE VERIFICATION BATCH B ON supplierpro_clone (PORT ' + PORT + ') ---');
    await startServer();

    let passedCount = 0;
    let failedCount = 0;

    function assert(desc, condition, details = '') {
        if (condition) {
            console.log(`  [PASS] ${desc}`);
            passedCount++;
        } else {
            console.error(`  [FAIL] ${desc} - ${details}`);
            failedCount++;
        }
    }

    const conn = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'supplierpro_clone'
    });

    try {
        // Setup a fresh test product
        const prodCode = 'P-BTCHB-' + Math.floor(Math.random() * 899999 + 100000);
        const prodName = 'Produk Uji Batch B';
        const initialCost = 50000;
        const initialPrice = 75000;
        const initialStock = 50;

        const prodRes = await apiRequest('/api/products', 'POST', {
            id: prodCode,
            sku: prodCode,
            name: prodName,
            cost_price: initialCost,
            sell_price: initialPrice,
            stock: initialStock,
            min_stock: 5,
            category_id: 'PC-1',
            unit_id: 'PU-1'
        });
        assert('Check 0: Create product & initial stock move recorded', prodRes.status === 200);

        // Verify initial stock move
        const [initMoves] = await conn.query('SELECT * FROM stock_moves WHERE product_id = ? ORDER BY id DESC LIMIT 1', [prodCode]);
        assert('Check 0.1: stock_moves has stok_awal', initMoves.length > 0 && initMoves[0].tipe === 'stok_awal' && Number(initMoves[0].qty_masuk) === 50);

        // ==========================================
        // CHECKLIST 1: JUAL PRODUK -> MUNCUL DI STOCK MOVE (KELUAR) DAN STOK BERKURANG
        // ==========================================
        console.log('\n--- Checklist 1: Penjualan & Stock Move ---');
        const saleQty = 5;
        const invPayload = {
            customer_id: 'C000001',
            items: [{ id: prodCode, name: prodName, qty: saleQty, price: initialPrice, cost: initialCost }],
            payment_type_id: 'PT-1',
            paid_amount: saleQty * initialPrice, // Lunas
            notes: 'Test Penjualan Batch B'
        };
        const invRes = await apiRequest('/api/invoices', 'POST', invPayload);
        assert('Check 1.1: Create invoice (penjualan) returns 200', invRes.status === 200);
        const invId = invRes.body.invoiceId || invRes.body.id;

        const [[prodAfterSale]] = await conn.query('SELECT stock FROM products WHERE id = ?', [prodCode]);
        assert('Check 1.2: Product stock reduced from 50 to 45', Number(prodAfterSale.stock) === 45);

        const [saleMoves] = await conn.query('SELECT * FROM stock_moves WHERE product_id = ? AND (ref_id = ? OR ref_no = ?)', [prodCode, invId, invId]);
        assert('Check 1.3: stock_moves recorded penjualan qty_keluar 5, qty_sesudah 45',
            saleMoves.length > 0 &&
            saleMoves[0].tipe === 'penjualan' &&
            Number(saleMoves[0].qty_keluar) === 5 &&
            Number(saleMoves[0].qty_sesudah) === 45
        );

        // ==========================================
        // CHECKLIST 2: BELI (PO) -> MUNCUL DI STOCK MOVE (MASUK) DAN STOK BERTAMBAH
        // ==========================================
        console.log('\n--- Checklist 2: Pembelian PO & Stock Move ---');
        const buyQty = 20;
        const buyCost = 60000;
        const poPayload = {
            vendor_id: 'V000001',
            date: new Date().toISOString().split('T')[0],
            total: buyQty * buyCost,
            paid: buyQty * buyCost, // Lunas
            payment_type_id: 'PT-1',
            items: [{ product_id: prodCode, qty: buyQty, price: buyCost, total: buyQty * buyCost }]
        };
        const poRes = await apiRequest('/api/purchases', 'POST', poPayload);
        assert('Check 2.1: Create PO returns 200', poRes.status === 200);
        const poId = poRes.body.purchaseId || poRes.body.id;

        const [[prodAfterPO]] = await conn.query('SELECT stock FROM products WHERE id = ?', [prodCode]);
        assert('Check 2.2: Product stock increased from 45 to 65', Number(prodAfterPO.stock) === 65);

        const [poMoves] = await conn.query('SELECT * FROM stock_moves WHERE product_id = ? AND (ref_id = ? OR ref_no = ?)', [prodCode, poId, poId]);
        assert('Check 2.3: stock_moves recorded pembelian qty_masuk 20, qty_sesudah 65',
            poMoves.length > 0 &&
            poMoves[0].tipe === 'pembelian' &&
            Number(poMoves[0].qty_masuk) === 20 &&
            Number(poMoves[0].qty_sesudah) === 65
        );

        // ==========================================
        // CHECKLIST 3: OPNAME NAIK DAN TURUN -> MUNCUL DENGAN STOK SEBELUM/SESUDAH BENAR
        // ==========================================
        console.log('\n--- Checklist 3: Opname Naik & Turun ---');
        // Opname Turun: 65 -> 60 (-5)
        const adjDown = await apiRequest(`/api/products/${prodCode}/stock-adjustment`, 'POST', {
            actual_stock: 60,
            reason: 'Opname turun selisih fisik'
        });
        assert('Check 3.1: Opname down adjustment returns 200', adjDown.status === 200);

        const [opnameDownMove] = await conn.query('SELECT * FROM stock_moves WHERE product_id = ? AND tipe = "opname" ORDER BY id DESC LIMIT 1', [prodCode]);
        assert('Check 3.2: Opname down move: qty_keluar 5, qty_sebelum 65, qty_sesudah 60',
            opnameDownMove.length > 0 &&
            Number(opnameDownMove[0].qty_keluar) === 5 &&
            Number(opnameDownMove[0].qty_sebelum) === 65 &&
            Number(opnameDownMove[0].qty_sesudah) === 60
        );

        // Opname Naik: 60 -> 70 (+10)
        const adjUp = await apiRequest(`/api/products/${prodCode}/stock-adjustment`, 'POST', {
            actual_stock: 70,
            reason: 'Opname naik temuan gudang'
        });
        assert('Check 3.3: Opname up adjustment returns 200', adjUp.status === 200);

        const [opnameUpMove] = await conn.query('SELECT * FROM stock_moves WHERE product_id = ? AND tipe = "opname" ORDER BY id DESC LIMIT 1', [prodCode]);
        assert('Check 3.4: Opname up move: qty_masuk 10, qty_sebelum 60, qty_sesudah 70',
            opnameUpMove.length > 0 &&
            Number(opnameUpMove[0].qty_masuk) === 10 &&
            Number(opnameUpMove[0].qty_sebelum) === 60 &&
            Number(opnameUpMove[0].qty_sesudah) === 70
        );

        // ==========================================
        // CHECKLIST 4: RETUR PENJUALAN ("KEMBALI KE STOK" DAN "RUSAK")
        // ==========================================
        console.log('\n--- Checklist 4: Retur Penjualan ---');
        // We sold 5 pcs in invId. Let's return 2 pcs "kembali_ke_stok" and 1 pc "rusak"
        const [[custBefore]] = await conn.query('SELECT deposit FROM customers WHERE id = "C000001"');
        const custDepositBefore = Number(custBefore ? custBefore.deposit : 0);

        const retSalesPayload = {
            return_date: new Date().toISOString().split('T')[0],
            reason: 'Pelanggan minta retur 2 bagus 1 rusak',
            items: [
                { product_id: prodCode, qty: 2, condition: 'kembali_ke_stok' },
                { product_id: prodCode, qty: 1, condition: 'rusak' }
            ]
        };
        const retSalesRes = await apiRequest(`/api/invoices/${encodeURIComponent(invId)}/returns`, 'POST', retSalesPayload);
        assert('Check 4.1: Retur penjualan returns 200', retSalesRes.status === 200);
        const retSalesId = retSalesRes.body.returnId;

        // Stock check: current stock was 70. 2 returned to stock -> new stock = 72. 1 rusak -> not returned to stock.
        const [[prodAfterRetSales]] = await conn.query('SELECT stock FROM products WHERE id = ?', [prodCode]);
        assert('Check 4.2: Stock is 72 (only kembali_ke_stok increments stock)', Number(prodAfterRetSales.stock) === 72);

        // Stock moves check
        const [retSalesMoves] = await conn.query('SELECT * FROM stock_moves WHERE ref_id = ? OR ref_no = ?', [retSalesId, retSalesId]);
        const moveKembali = retSalesMoves.find(m => m.tipe === 'retur_penjualan');
        const moveRusak = retSalesMoves.find(m => m.tipe === 'retur_penjualan_rusak');
        assert('Check 4.3: Stock move retur_penjualan (kembali_ke_stok) has qty_masuk 2, qty_sesudah 72',
            moveKembali && Number(moveKembali.qty_masuk) === 2 && Number(moveKembali.qty_sesudah) === 72
        );
        assert('Check 4.4: Stock move retur_penjualan_rusak has qty_masuk 0, notes logged',
            moveRusak && Number(moveRusak.qty_masuk) === 0 && moveRusak.keterangan.includes('rusak')
        );

        // Financial check: since original invoice was paid in full, return of 3 pcs goes to customer deposit
        const [[custAfter]] = await conn.query('SELECT deposit FROM customers WHERE id = "C000001"');
        const expectedDepositIncrease = Number(retSalesRes.body.customer_deposit_amount || 0);
        assert('Check 4.5: Customer deposit increased by refund amount',
            Math.abs(Number(custAfter.deposit) - (custDepositBefore + expectedDepositIncrease)) < 1
        );

        // ==========================================
        // CHECKLIST 5: RETUR PEMBELIAN
        // ==========================================
        console.log('\n--- Checklist 5: Retur Pembelian ---');
        // We bought 20 pcs in poId. Let's return 4 pcs.
        const [[vendBefore]] = await conn.query('SELECT deposit FROM vendors WHERE id = "V000001"');
        const vendDepositBefore = Number(vendBefore ? vendBefore.deposit : 0);

        const retBuyPayload = {
            return_date: new Date().toISOString().split('T')[0],
            reason: 'Barang tidak sesuai spesifikasi pabrik',
            items: [
                { product_id: prodCode, qty: 4 }
            ]
        };
        const retBuyRes = await apiRequest(`/api/purchases/${encodeURIComponent(poId)}/returns`, 'POST', retBuyPayload);
        assert('Check 5.1: Retur pembelian returns 200', retBuyRes.status === 200);
        const retBuyId = retBuyRes.body.returnId;

        // Stock check: stock was 72. 4 returned to vendor -> new stock = 68.
        const [[prodAfterRetBuy]] = await conn.query('SELECT stock FROM products WHERE id = ?', [prodCode]);
        assert('Check 5.2: Stock decreased to 68', Number(prodAfterRetBuy.stock) === 68);

        // Stock moves check
        const [retBuyMoves] = await conn.query('SELECT * FROM stock_moves WHERE ref_id = ? OR ref_no = ?', [retBuyId, retBuyId]);
        assert('Check 5.3: Stock move retur_pembelian has qty_keluar 4, qty_sesudah 68',
            retBuyMoves.length > 0 &&
            retBuyMoves[0].tipe === 'retur_pembelian' &&
            Number(retBuyMoves[0].qty_keluar) === 4 &&
            Number(retBuyMoves[0].qty_sesudah) === 68
        );

        // Financial check: PO was fully paid, refund goes to vendor deposit
        const [[vendAfter]] = await conn.query('SELECT deposit FROM vendors WHERE id = "V000001"');
        const expectedVendDepositIncrease = Number(retBuyRes.body.vendor_deposit_amount || 0);
        assert('Check 5.4: Vendor deposit increased by PO refund amount',
            Math.abs(Number(vendAfter.deposit) - (vendDepositBefore + expectedVendDepositIncrease)) < 1
        );

        // ==========================================
        // CHECKLIST 6: SOFT-LOCK PADA EDIT INVOICE & EDIT PO
        // ==========================================
        console.log('\n--- Checklist 6: Soft-Lock Koreksi vs Retur ---');
        // Create an active invoice with 10 pcs
        const invLockRes = await apiRequest('/api/invoices', 'POST', {
            customer_id: 'C000001',
            items: [{ id: prodCode, name: prodName, qty: 10, price: initialPrice, cost: initialCost }],
            payment_type_id: 'PT-1',
            paid_amount: 10 * initialPrice
        });
        const lockInvId = invLockRes.body.invoiceId;

        // 6.1 Try to reduce qty to 6 without correction reason -> should be rejected with 400
        const editWithoutReason = await apiRequest(`/api/invoices/${encodeURIComponent(lockInvId)}`, 'PUT', {
            id: lockInvId,
            date: new Date().toISOString().split('T')[0],
            customer_id: 'C000001',
            items: [{ product_id: prodCode, quantity: 6, price: initialPrice }]
        }, adminToken);
        assert('Check 6.1: Edit invoice reducing qty without reason returns 400 soft-lock guard',
            editWithoutReason.status === 400 && editWithoutReason.body.softLock === true
        );

        // 6.2 Try to reduce qty as non-admin (kasir) with reason -> should be rejected with 403
        const editAsKasir = await apiRequest(`/api/invoices/${encodeURIComponent(lockInvId)}`, 'PUT', {
            id: lockInvId,
            date: new Date().toISOString().split('T')[0],
            customer_id: 'C000001',
            items: [{ product_id: prodCode, quantity: 6, price: initialPrice }],
            correction_reason: 'Kasir salah input kuantitas di awal'
        }, kasirToken);
        assert('Check 6.2: Non-admin (kasir) cannot bypass soft-lock with koreksi (returns 403)',
            editAsKasir.status === 403
        );

        // 6.3 Admin with reason >= 10 chars -> returns 200, recorded in stock_moves as koreksi_edit
        const editAsAdminWithReason = await apiRequest(`/api/invoices/${encodeURIComponent(lockInvId)}`, 'PUT', {
            id: lockInvId,
            date: new Date().toISOString().split('T')[0],
            customer_id: 'C000001',
            items: [{ product_id: prodCode, quantity: 6, price: initialPrice }],
            correction_reason: 'Koreksi salah input saat membuat invoice kemarin'
        }, adminToken);
        assert('Check 6.3: Admin with valid reason succeeds (returns 200)',
            editAsAdminWithReason.status === 200
        );

        const [koreksiMoves] = await conn.query('SELECT * FROM stock_moves WHERE (ref_id = ? OR ref_no = ?) AND tipe = "koreksi_edit" ORDER BY id DESC LIMIT 1', [lockInvId, lockInvId]);
        assert('Check 6.4: stock_moves has koreksi_edit with user notes',
            koreksiMoves.length > 0 &&
            koreksiMoves[0].keterangan.includes('Koreksi salah input')
        );

        // ==========================================
        // CHECKLIST 7: LOGIN GUDANG -> STOCK MOVE TERBUKA, TIDAK ADA DATA UANG
        // ==========================================
        console.log('\n--- Checklist 7: Gudang Role Financial Sanitization ---');
        // GET /api/stock-moves as gudang
        const smGudang = await apiRequest('/api/stock-moves?page=1&limit=20', 'GET', null, gudangToken);
        assert('Check 7.1: Gudang can access /api/stock-moves (status 200)', smGudang.status === 200);

        // Check every item in smGudang.body.data for financial fields
        const forbiddenFinancialFields = ['price', 'cost', 'subtotal', 'total', 'hpp', 'amount', 'cash', 'balance', 'nominal'];
        let hasFinancialLeakedInMoves = false;
        smGudang.body.data.forEach(m => {
            forbiddenFinancialFields.forEach(field => {
                if (m[field] !== undefined) hasFinancialLeakedInMoves = true;
            });
        });
        assert('Check 7.2: No financial fields present in Stock Move API response', !hasFinancialLeakedInMoves);

        // GET /api/returns/sales as gudang: total_refund, deducted_from_debt, added_to_deposit must NOT exist
        const retSalesGudang = await apiRequest('/api/returns/sales?page=1&limit=20', 'GET', null, gudangToken);
        assert('Check 7.3: Gudang can access /api/returns/sales (status 200)', retSalesGudang.status === 200);
        let hasFinancialLeakedInReturns = false;
        retSalesGudang.body.data.forEach(r => {
            if (r.total_refund !== undefined || r.deducted_from_debt !== undefined || r.added_to_deposit !== undefined) {
                hasFinancialLeakedInReturns = true;
            }
        });
        assert('Check 7.4: No financial fields in Retur Penjualan list for Gudang', !hasFinancialLeakedInReturns);

        // GET /api/returns/purchases as gudang
        const retPurchasesGudang = await apiRequest('/api/returns/purchases?page=1&limit=20', 'GET', null, gudangToken);
        assert('Check 7.5: Gudang can access /api/returns/purchases (status 200)', retPurchasesGudang.status === 200);
        let hasFinancialLeakedInBuyReturns = false;
        retPurchasesGudang.body.data.forEach(r => {
            if (r.total_refund !== undefined || r.deducted_from_debt !== undefined || r.added_to_deposit !== undefined) {
                hasFinancialLeakedInBuyReturns = true;
            }
        });
        assert('Check 7.6: No financial fields in Retur Pembelian list for Gudang', !hasFinancialLeakedInBuyReturns);

        // ==========================================
        // CHECKLIST 8: FRONTEND FILES & NESTED MODALS VERIFICATION
        // ==========================================
        console.log('\n--- Checklist 8: Frontend Modals, Stack, and UI Integrity ---');
        const html = fs.readFileSync('C:/Vibes Coding/SupplierProSQL/dashboard.html', 'utf8');
        const js = fs.readFileSync('C:/Vibes Coding/SupplierProSQL/dashboard.js', 'utf8');
        const css = fs.readFileSync('C:/Vibes Coding/SupplierProSQL/dashboard.css', 'utf8');

        assert('Check 8.1: modal-sales-return exists in dashboard.html', html.includes('id="modal-sales-return"'));
        assert('Check 8.2: modal-purchase-return exists in dashboard.html', html.includes('id="modal-purchase-return"'));
        assert('Check 8.3: modal-softlock-warning exists in dashboard.html', html.includes('id="modal-softlock-warning"'));
        assert('Check 8.4: modal-return-detail exists in dashboard.html', html.includes('id="modal-return-detail"'));
        assert('Check 8.5: Retur button in modal-edit-invoice exists in dashboard.html', html.includes('btn-edit-invoice-return'));
        assert('Check 8.6: Retur button in modal-edit-purchase exists in dashboard.html', html.includes('btn-edit-purchase-return'));
        assert('Check 8.7: dash-card-recent-stock-moves exists in dashboard.html', html.includes('dash-card-recent-stock-moves'));

        assert('Check 8.8: openModalsStack array defined in dashboard.js', js.includes('const openModalsStack = [];'));
        assert('Check 8.9: body scroll lock with modal-open class in openModal & closeModal', js.includes("document.body.classList.add('modal-open')") && js.includes("document.body.classList.remove('modal-open')"));
        assert('Check 8.10: Esc key listener closes top modal', js.includes("openModalsStack[openModalsStack.length - 1]"));
        assert('Check 8.11: body.modal-open CSS rule exists in dashboard.css', css.includes('body.modal-open'));
        assert('Check 8.12: returns and stock-moves in PAGE_TITLES and ROLE_PERMISSIONS', js.includes("returns: { title: 'Daftar Retur'") && js.includes("'stock-moves'"));

    } catch (err) {
        console.error('TEST ERROR:', err);
        failedCount++;
    } finally {
        await conn.end();
        stopServer();
        console.log(`\n==============================================`);
        console.log(`TOTAL PASSED: ${passedCount}`);
        console.log(`TOTAL FAILED: ${failedCount}`);
        console.log(`==============================================\n`);
        process.exit(failedCount > 0 ? 1 : 0);
    }
}

runTests();
