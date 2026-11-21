/**
 * combined_test.js — Start server on port 3999 + test + stop
 */
const { spawn } = require('child_process');
const http = require('http');
const jwt = require('jsonwebtoken');

const PROJECT_DIR = __dirname.replace(/[/\\]scripts$/, '');
const TEST_PORT = 3999;
const SECRET = 'supplierpro_secret_key_demo';
const TOKEN = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: 'Admin' }, SECRET, { expiresIn: '1h' });
const GUD_TOKEN = jwt.sign({ id: 3, username: 'gudang', role: 'gudang', name: 'Gudang' }, SECRET, { expiresIn: '1h' });

let passed = 0, failed = 0;
function assert(label, cond, detail = '') {
    if (cond) { console.log(`  [PASS] ${label}`); passed++; }
    else { console.log(`  [FAIL] ${label}${detail ? ' | ' + detail : ''}`); failed++; }
}

function apiReq(path, method = 'GET', body = null, token = TOKEN) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: '127.0.0.1', port: TEST_PORT, path, method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
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
    console.log('\n=== TEST: Fix Retur Form & Stock Moves ===\n');

    // --- Test 1: Stock Moves field names ---
    console.log('--- Test 1: Stock Moves API field names ---');
    const smRes = await apiReq('/api/stock-moves?page=1&limit=5');
    assert('stock-moves returns 200', smRes.status === 200, `got: ${smRes.status}`);
    
    const rows = smRes.body.data || [];
    assert('stock-moves has data rows', rows.length > 0, `rows: ${rows.length}`);
    
    if (rows.length > 0) {
        const r = rows[0];
        const flds = Object.keys(r).join(', ');
        assert('field tanggal exists', r.tanggal !== undefined, `fields: ${flds}`);
        assert('field tipe exists', r.tipe !== undefined, `fields: ${flds}`);
        assert('field qtyMasuk exists', r.qtyMasuk !== undefined, `fields: ${flds}`);
        assert('field qtyKeluar exists', r.qtyKeluar !== undefined, `fields: ${flds}`);
        assert('field stokSesudah exists', r.stokSesudah !== undefined, `fields: ${flds}`);
        assert('field keterangan exists', r.keterangan !== undefined, `fields: ${flds}`);
        assert('field refId exists', r.refId !== undefined, `fields: ${flds}`);
        assert('field productName exists', r.productName !== undefined, `fields: ${flds}`);
        assert('field sku exists', r.sku !== undefined, `fields: ${flds}`);
        assert('field user exists', r.user !== undefined, `fields: ${flds}`);
    }

    // --- Test 2: Invoice returns-form ---
    console.log('\n--- Test 2: GET /api/invoices/:id/returns-form ---');
    const invListRes = await apiReq('/api/invoices?page=1&limit=1');
    // Try multiple possible response shapes
    const allInvs = invListRes.body?.invoices || invListRes.body?.data || (Array.isArray(invListRes.body) ? invListRes.body : []);
    const firstInv = allInvs[0];
    
    if (!firstInv?.id) {
        console.log('  [SKIP] No invoice found');
        console.log('  [INFO] Inv list keys:', JSON.stringify(invListRes.body).substring(0, 200));
    } else {
        console.log(`  [INFO] Testing with invoice: ${firstInv.id}`);
        const formRes = await apiReq(`/api/invoices/${encodeURIComponent(firstInv.id)}/returns-form`);
        assert('returns-form returns 200', formRes.status === 200, `got: ${formRes.status} ${JSON.stringify(formRes.body).substring(0,150)}`);
        if (formRes.status === 200) {
            const d = formRes.body;
            assert('has invoice object', !!d.invoice, `keys: ${Object.keys(d).join(', ')}`);
            assert('has items array', Array.isArray(d.items));
            assert('has remainingDebt', d.remainingDebt !== undefined);
            if (d.invoice) {
                assert('invoice.id', !!d.invoice.id);
                assert('invoice.customer_name', d.invoice.customer_name !== undefined);
                assert('invoice.subtotal', d.invoice.subtotal !== undefined);
                assert('invoice.discount', d.invoice.discount !== undefined);
                assert('invoice.tax', d.invoice.tax !== undefined);
                assert('invoice.total', d.invoice.total !== undefined);
                assert('invoice.paid_amount', d.invoice.paid_amount !== undefined);
            }
            if (d.items && d.items.length > 0) {
                const it = d.items[0];
                const ikeys = Object.keys(it).join(', ');
                assert('item.maxReturnable', it.maxReturnable !== undefined, `item keys: ${ikeys}`);
                assert('item.invoice_qty', it.invoice_qty !== undefined, `item keys: ${ikeys}`);
                assert('item.returned_qty', it.returned_qty !== undefined, `item keys: ${ikeys}`);
                assert('item.price', it.price !== undefined, `item keys: ${ikeys}`);
                assert('item.product_name', !!it.product_name, `item keys: ${ikeys}`);
            }
        }
    }

    // --- Test 3: Purchase returns-form ---
    console.log('\n--- Test 3: GET /api/purchases/:id/returns-form ---');
    const poListRes = await apiReq('/api/purchases?page=1&limit=1');
    const allPOs = poListRes.body?.purchases || poListRes.body?.data || (Array.isArray(poListRes.body) ? poListRes.body : []);
    const firstPO = allPOs[0];
    
    if (!firstPO?.id) {
        console.log('  [SKIP] No purchase order found');
        console.log('  [INFO] PO list keys:', JSON.stringify(poListRes.body).substring(0, 200));
    } else {
        console.log(`  [INFO] Testing with PO: ${firstPO.id}`);
        const poFormRes = await apiReq(`/api/purchases/${encodeURIComponent(firstPO.id)}/returns-form`);
        assert('purchase returns-form returns 200', poFormRes.status === 200, `got: ${poFormRes.status} ${JSON.stringify(poFormRes.body).substring(0,150)}`);
        if (poFormRes.status === 200) {
            const d = poFormRes.body;
            assert('has purchase object', !!d.purchase, `keys: ${Object.keys(d).join(', ')}`);
            assert('has items array', Array.isArray(d.items));
            assert('has remainingDebt', d.remainingDebt !== undefined);
            if (d.items && d.items.length > 0) {
                const it = d.items[0];
                const ikeys = Object.keys(it).join(', ');
                assert('item.maxReturnable', it.maxReturnable !== undefined, `item keys: ${ikeys}`);
                assert('item.purchase_qty', it.purchase_qty !== undefined, `item keys: ${ikeys}`);
                assert('item.cost', it.cost !== undefined, `item keys: ${ikeys}`);
                assert('item.current_stock', it.current_stock !== undefined, `item keys: ${ikeys}`);
            }
        }
    }

    // --- Test 4: Gudang role ---
    console.log('\n--- Test 4: Gudang role access ---');
    const gudSmRes = await apiReq('/api/stock-moves?page=1&limit=3', 'GET', null, GUD_TOKEN);
    assert('gudang can access /api/stock-moves', gudSmRes.status === 200, `got: ${gudSmRes.status}`);

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
