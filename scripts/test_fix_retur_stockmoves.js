/**
 * Test: Fix verifikasi endpoint returns-form dan stock-moves field names
 */
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/supplierpro_clone';
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production';

const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: 'Admin Test' }, JWT_SECRET, { expiresIn: '1h' });
const gudangToken = jwt.sign({ id: 3, username: 'gudang', role: 'gudang', name: 'Gudang Test' }, JWT_SECRET, { expiresIn: '1h' });

let passed = 0, failed = 0;
function assert(label, cond, detail = '') {
    if (cond) { console.log(`  [PASS] ${label}`); passed++; }
    else { console.log(`  [FAIL] ${label}${detail ? ' | ' + detail : ''}`); failed++; }
}

function apiReq(path, method = 'GET', body = null, token = adminToken) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: 'localhost', port: PORT, path, method,
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

async function run() {
    console.log('\n=== TEST: Fix Retur Form & Stock Moves Fields ===\n');

    // --- TEST 1: GET /api/stock-moves returns correct field names ---
    console.log('--- Test 1: Stock Moves API field names ---');
    const smRes = await apiReq('/api/stock-moves?page=1&limit=5');
    assert('stock-moves returns 200', smRes.status === 200, `got: ${smRes.status}`);
    
    const rows = smRes.body.data || [];
    assert('stock-moves has data rows', rows.length > 0, `rows: ${rows.length}`);
    
    if (rows.length > 0) {
        const r = rows[0];
        assert('field tanggal exists (not date)', r.tanggal !== undefined, `fields: ${Object.keys(r).join(', ')}`);
        assert('field tipe exists (not type/move_type)', r.tipe !== undefined);
        assert('field qtyMasuk exists (not qty_in)', r.qtyMasuk !== undefined);
        assert('field qtyKeluar exists (not qty_out)', r.qtyKeluar !== undefined);
        assert('field stokSesudah exists (not stock_after)', r.stokSesudah !== undefined);
        assert('field keterangan exists (not notes)', r.keterangan !== undefined);
        assert('field refId exists (not reference_id)', r.refId !== undefined);
        assert('field productName exists (not product_name)', r.productName !== undefined);
        assert('field sku exists', r.sku !== undefined);
        assert('field user exists (not user_name)', r.user !== undefined);
        
        // Verify no old wrong field names leaked through
        assert('no old field "date" leaked', r.date === undefined);
        assert('no old field "qty_in" leaked', r.qty_in === undefined);
        assert('no old field "stock_after" leaked', r.stock_after === undefined);
    }

    // --- TEST 2: GET /api/invoices/:id/returns-form ---
    console.log('\n--- Test 2: Invoice returns-form endpoint ---');
    // First get an existing invoice
    const invListRes = await apiReq('/api/invoices?page=1&limit=1');
    const firstInv = invListRes.body?.invoices?.[0] || invListRes.body?.[0];
    
    if (!firstInv?.id) {
        console.log('  [SKIP] No invoice found to test returns-form');
    } else {
        const formRes = await apiReq(`/api/invoices/${encodeURIComponent(firstInv.id)}/returns-form`);
        assert('returns-form returns 200', formRes.status === 200, `got: ${formRes.status} ${JSON.stringify(formRes.body).substring(0,100)}`);
        
        if (formRes.status === 200) {
            const d = formRes.body;
            assert('returns-form has invoice object', d.invoice !== undefined);
            assert('returns-form has items array', Array.isArray(d.items));
            assert('returns-form has remainingDebt', d.remainingDebt !== undefined);
            
            if (d.invoice) {
                assert('invoice.id present', !!d.invoice.id);
                assert('invoice.customer_name present', d.invoice.customer_name !== undefined);
                assert('invoice.total present', d.invoice.total !== undefined);
                assert('invoice.subtotal present', d.invoice.subtotal !== undefined);
                assert('invoice.discount present', d.invoice.discount !== undefined);
                assert('invoice.tax present', d.invoice.tax !== undefined);
            }
            
            if (d.items && d.items.length > 0) {
                const it = d.items[0];
                assert('item.maxReturnable present', it.maxReturnable !== undefined);
                assert('item.invoice_qty present', it.invoice_qty !== undefined);
                assert('item.returned_qty present', it.returned_qty !== undefined);
                assert('item.price present', it.price !== undefined);
                assert('item.product_name present', it.product_name !== undefined);
                assert('item.product_sku present', it.product_sku !== undefined);
                assert('item.product_id present', !!it.product_id);
            }
        }
    }

    // --- TEST 3: GET /api/purchases/:id/returns-form ---
    console.log('\n--- Test 3: Purchase returns-form endpoint ---');
    const poListRes = await apiReq('/api/purchases?page=1&limit=1');
    const firstPO = poListRes.body?.purchases?.[0] || poListRes.body?.[0];
    
    if (!firstPO?.id) {
        console.log('  [SKIP] No purchase order found to test returns-form');
    } else {
        const poFormRes = await apiReq(`/api/purchases/${encodeURIComponent(firstPO.id)}/returns-form`);
        assert('purchase returns-form returns 200', poFormRes.status === 200, `got: ${poFormRes.status} ${JSON.stringify(poFormRes.body).substring(0,100)}`);
        
        if (poFormRes.status === 200) {
            const d = poFormRes.body;
            assert('purchase returns-form has purchase object', d.purchase !== undefined);
            assert('purchase returns-form has items array', Array.isArray(d.items));
            assert('purchase returns-form has remainingDebt', d.remainingDebt !== undefined);
            
            if (d.items && d.items.length > 0) {
                const it = d.items[0];
                assert('item.maxReturnable present', it.maxReturnable !== undefined);
                assert('item.purchase_qty present', it.purchase_qty !== undefined);
                assert('item.returned_qty present', it.returned_qty !== undefined);
                assert('item.cost present', it.cost !== undefined);
                assert('item.current_stock present', it.current_stock !== undefined);
            }
        }
    }

    // --- TEST 4: Gudang role can access stock-moves ---
    console.log('\n--- Test 4: Gudang role access ---');
    const gudSmRes = await apiReq('/api/stock-moves?page=1&limit=3', 'GET', null, gudangToken);
    assert('gudang can access /api/stock-moves', gudSmRes.status === 200, `got: ${gudSmRes.status}`);

    console.log(`\n=== RESULT: ${passed} PASS / ${failed} FAIL ===\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test error:', e.message); process.exit(1); });
