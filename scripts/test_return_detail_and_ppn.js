/**
 * test_return_detail_and_ppn.js
 * Verifikasi:
 * 1. GET /api/returns/sales/:id format & field detail
 * 2. GET /api/returns/purchases/:id format & field detail
 * 3. Kalkulasi Retur dengan ppn_enabled = false (bebas PPN)
 */
const { spawn } = require('child_process');
const http = require('http');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const PROJECT_DIR = __dirname.replace(/[/\\]scripts$/, '');
const TEST_PORT = 3998;
const SECRET = 'supplierpro_secret_key_demo';
const TOKEN = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: 'Admin Test' }, SECRET, { expiresIn: '1h' });

let passed = 0, failed = 0;
function assert(label, cond, detail = '') {
    if (cond) { console.log(`  [PASS] ${label}`); passed++; }
    else { console.log(`  [FAIL] ${label}${detail ? ' | ' + detail : ''}`); failed++; }
}

function apiReq(path, method = 'GET', body = null) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: '127.0.0.1', port: TEST_PORT, path, method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        };
        const req = http.request(opts, r => {
            let d = ''; r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
                catch (e) { resolve({ status: r.statusCode, body: d }); }
            });
        });
        req.on('error', e => resolve({ status: 'ERR', body: e.message }));
        if (data) req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log('\n=== TEST: Return Detail & PPN Calculation ===\n');

    const db = await mysql.createConnection('mysql://root:@localhost:3306/supplierpro_clone');

    // 1. Check existing returns for testing detail endpoints
    console.log('--- Test 1: GET /api/returns/sales/:id detail ---');
    const [salesReturns] = await db.query('SELECT id FROM sales_returns ORDER BY id DESC LIMIT 1');
    if (salesReturns.length > 0) {
        const sRetId = salesReturns[0].id;
        const res = await apiReq(`/api/returns/sales/${encodeURIComponent(sRetId)}`);
        assert('sales return detail returns 200', res.status === 200, `got: ${res.status}`);
        assert('response has "return" property', !!res.body?.return);
        assert('response has "items" array', Array.isArray(res.body?.items));
        if (res.body?.return) {
            const r = res.body.return;
            assert('return.id matches', r.id === sRetId);
            assert('return.return_date exists', !!r.return_date);
            assert('return.invoice_id exists', !!r.invoice_id);
            assert('return.customer_name exists', r.customer_name !== undefined);
            assert('return.created_by_name exists', r.created_by_name !== undefined);
            assert('return.total_refund exists', r.total_refund !== undefined);
            assert('return.deducted_from_debt exists', r.deducted_from_debt !== undefined);
            assert('return.added_to_deposit exists', r.added_to_deposit !== undefined);
        }
        if (res.body?.items?.length > 0) {
            const it = res.body.items[0];
            assert('item.product_name exists', !!it.product_name);
            assert('item.qty exists', it.qty !== undefined);
            assert('item.condition exists', it.condition !== undefined);
            assert('item.price exists', it.price !== undefined);
            assert('item.subtotal exists', it.subtotal !== undefined);
        }
    } else {
        console.log('  [SKIP] No sales returns in DB');
    }

    console.log('\n--- Test 2: GET /api/returns/purchases/:id detail ---');
    const [purchReturns] = await db.query('SELECT id FROM purchase_returns ORDER BY id DESC LIMIT 1');
    if (purchReturns.length > 0) {
        const pRetId = purchReturns[0].id;
        const res = await apiReq(`/api/returns/purchases/${encodeURIComponent(pRetId)}`);
        assert('purchase return detail returns 200', res.status === 200, `got: ${res.status}`);
        assert('response has "return" property', !!res.body?.return);
        assert('response has "items" array', Array.isArray(res.body?.items));
        if (res.body?.return) {
            const r = res.body.return;
            assert('return.id matches', r.id === pRetId);
            assert('return.return_date exists', !!r.return_date);
            assert('return.purchase_id exists', !!r.purchase_id);
            assert('return.vendor_name exists', r.vendor_name !== undefined);
            assert('return.created_by_name exists', r.created_by_name !== undefined);
            assert('return.total_refund exists', r.total_refund !== undefined);
            assert('return.deducted_from_debt exists', r.deducted_from_debt !== undefined);
            assert('return.added_to_deposit exists', r.added_to_deposit !== undefined);
        }
        if (res.body?.items?.length > 0) {
            const it = res.body.items[0];
            assert('item.product_name exists', !!it.product_name);
            assert('item.qty exists', it.qty !== undefined);
            assert('item.condition exists', it.condition !== undefined);
            assert('item.price exists', it.price !== undefined);
            assert('item.subtotal exists', it.subtotal !== undefined);
        }
    } else {
        console.log('  [SKIP] No purchase returns in DB');
    }

    console.log('\n--- Test 3: PPN Calculation check (ppn_enabled = false) ---');
    // Save current ppn_enabled setting
    const [[origSetting]] = await db.query("SELECT value FROM settings WHERE `key` = 'ppn_enabled'");
    const origVal = origSetting ? origSetting.value : 'true';

    try {
        // Explicitly set ppn_enabled to 'false'
        await db.query("INSERT INTO settings (`key`, value) VALUES ('ppn_enabled', 'false') ON DUPLICATE KEY UPDATE value = 'false'");

        // 3.1 Check returns-form when ppn_enabled = false
        const [invs] = await db.query('SELECT id FROM sales_invoices ORDER BY id DESC LIMIT 1');
        if (invs.length > 0) {
            const testInvId = invs[0].id;
            const formRes = await apiReq(`/api/invoices/${encodeURIComponent(testInvId)}/returns-form`);
            assert('returns-form with ppn disabled returns 200', formRes.status === 200);
            assert('returns-form tax is 0 when PPN disabled', Number(formRes.body?.invoice?.tax) === 0);
            assert('returns-form ppn_enabled is false', formRes.body?.invoice?.ppn_enabled === false);
        }

        // 3.2 Create new test invoice without PPN and test return refund amount
        const prodCode = 'P-PPN-TEST-' + Math.floor(Math.random() * 100000);
        await db.query(`
            INSERT INTO products (id, name, sku, sell_price, cost_price, stock, min_stock, unit_id, category_id)
            VALUES (?, 'Produk Test PPN', ?, 50000, 30000, 20, 2, 'PU-1', 'PC-1')
        `, [prodCode, prodCode]);

        const invCreate = await apiReq('/api/invoices', 'POST', {
            customer_id: 'C000001',
            items: [{ id: prodCode, name: 'Produk Test PPN', qty: 4, price: 50000, cost: 30000 }],
            payment_type_id: 'PT-1',
            paid_amount: 200000
        });
        assert('created test invoice without PPN', invCreate.status === 200);
        const invId = invCreate.body?.invoiceId;

        // Perform return of 2 pcs -> price 50,000 * 2 = 100,000
        // Since ppn_enabled is false, total_refund MUST be exactly 100,000 (NO PPN addition!)
        const retRes = await apiReq(`/api/invoices/${encodeURIComponent(invId)}/returns`, 'POST', {
            return_date: new Date().toISOString().split('T')[0],
            reason: 'Test PPN retur',
            items: [{ product_id: prodCode, qty: 2, condition: 'kembali_ke_stok' }]
        });

        assert('return submission 200', retRes.status === 200);
        const totalRefund = Number(retRes.body?.total_refund || 0);
        assert('total_refund is exactly 100,000 (NO PPN)', totalRefund === 100000, `got: ${totalRefund}`);

    } finally {
        // Restore original setting
        await db.query("UPDATE settings SET value = ? WHERE `key` = 'ppn_enabled'", [origVal]);
        await db.end();
    }

    console.log(`\n=== RESULT: ${passed} PASS / ${failed} FAIL ===\n`);
    return failed;
}

// Start server, test, kill
const srv = spawn('node', ['server.js'], {
    cwd: PROJECT_DIR,
    env: { ...process.env, DATABASE_URL: 'mysql://root:@localhost:3306/supplierpro_clone', PORT: String(TEST_PORT) }
});

let serverReady = false;
let outputBuf = '';

srv.stdout.on('data', d => {
    outputBuf += d.toString();
    if (!serverReady && outputBuf.includes('running on port')) {
        serverReady = true;
        setTimeout(async () => {
            try {
                const fails = await runTests();
                srv.kill();
                process.exit(fails > 0 ? 1 : 0);
            } catch (e) {
                console.error('Test error:', e.message);
                srv.kill();
                process.exit(1);
            }
        }, 500);
    }
});

srv.stderr.on('data', d => {
    const msg = d.toString();
    if (msg.includes('Error') || msg.includes('error')) process.stderr.write(msg.substring(0, 200));
});

setTimeout(() => {
    if (!serverReady) {
        console.error('Server timeout. Output:', outputBuf.substring(0, 500));
        srv.kill(); process.exit(1);
    }
}, 15000);
