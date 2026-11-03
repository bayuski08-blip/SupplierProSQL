/**
 * test_item3_item4.js
 * Verification suite for Item 3 (Edit Proforma) and Item 4 (Proforma from Invoice)
 * Uses native fetch for reliability.
 */

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = Object.assign({}, options.headers || {});
    let body = undefined;
    if (options.body) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
    }
    const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body
    });
    let data;
    const text = await res.text();
    try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: res.status, data };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

async function run() {
    console.log('=============================================');
    console.log('TEST SUITE: ITEM 3 & ITEM 4 VERIFICATION');
    console.log('=============================================');

    // 1. Login as admin & kasir
    console.log('\n--- SETUP: Login Tokens ---');
    const adminLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: 'admin123' }
    });
    assert(adminLogin.status === 200, 'Admin login berhasil');
    const adminToken = adminLogin.data.token;
    const adminHeaders = { 'Authorization': `Bearer ${adminToken}` };

    const kasirLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'demo_kasir', password: 'Kasir123' }
    });
    assert(kasirLogin.status === 200, 'Kasir login berhasil');
    const kasirToken = kasirLogin.data.token;
    const kasirHeaders = { 'Authorization': `Bearer ${kasirToken}` };

    // Get a valid customer and product for test data
    const custRes = await request('/api/customers?limit=1', { headers: adminHeaders });
    const customerId = custRes.data.data?.[0]?.id || custRes.data?.[0]?.id || 'CUST-0001';

    const prodRes = await request('/api/products?limit=2', { headers: adminHeaders });
    const products = prodRes.data.data || prodRes.data || [];
    const prod1 = products[0] || { id: 'PROD-001', name: 'Produk A', sell_price: 50000 };
    const prod2 = products[1] || { id: 'PROD-002', name: 'Produk B', sell_price: 75000 };

    // -------------------------------------------------------------
    // ITEM 3: EDIT PROFORMA
    // -------------------------------------------------------------
    console.log('\n--- ITEM 3: Edit Proforma (PUT /api/proformas/:pk) ---');

    // Create a fresh active proforma
    const createPf = await request('/api/proformas', {
        method: 'POST',
        headers: adminHeaders,
        body: {
            customer_id: customerId,
            payment_type_id: 'PT-1',
            order_date: '2026-11-03',
            items: [
                { id: prod1.id, name: prod1.name, quantity: 2, price: 50000, customer_fee: 5000, fee_notes: 'Fee A' }
            ]
        }
    });
    assert(createPf.status === 200 && createPf.data.success, `Buat proforma awal berhasil: ${createPf.data?.proformaNo}`);
    const pfPk = createPf.data.proformaPk;
    const pfNo = createPf.data.proformaNo;

    // Check initial print data has revisi: 0
    const print1 = await request(`/api/proformas/${pfPk}/print-data`, { headers: adminHeaders });
    assert(print1.status === 200 && print1.data.proforma.revisi === 0, 'Revisi awal proforma = 0');
    assert(print1.data.proforma.subtotal === 100000, 'Subtotal awal proforma = 100000');

    // Test Edit: ubah qty 2 -> 3 dan tambah item kedua
    const edit1 = await request(`/api/proformas/${pfPk}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: {
            revisi: 0,
            order_date: '2026-11-03',
            payment_type_id: 'PT-1',
            items: [
                { product_id: prod1.id, name: prod1.name, quantity: 3, price: 50000, customer_fee: 5000, fee_notes: 'Fee A' },
                { product_id: prod2.id, name: prod2.name, quantity: 1, price: 75000, customer_fee: 2000, fee_notes: 'Fee B' }
            ]
        }
    });
    assert(edit1.status === 200 && edit1.data.success, `Edit proforma pertama berhasil: nextRevisi = ${edit1.data?.nextRevisi}`);
    assert(edit1.data.nextRevisi === 1, 'Revisi bertambah menjadi 1');

    // Check print data after edit
    const print2 = await request(`/api/proformas/${pfPk}/print-data`, { headers: adminHeaders });
    assert(print2.data.proforma.revisi === 1, 'Print data menampilkan revisi: 1');
    assert(print2.data.proforma.subtotal === 225000, 'Subtotal terhitung ulang: 3*50.000 + 1*75.000 = 225.000');
    assert(print2.data.items.length === 2, 'Jumlah item tersimpan = 2');

    // Optimistic Concurrency Control: submit dengan revisi = 0 lagi (stale)
    const editConflict = await request(`/api/proformas/${pfPk}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: {
            revisi: 0, // stale revisi!
            order_date: '2026-11-03',
            payment_type_id: 'PT-1',
            items: [{ product_id: prod1.id, quantity: 1, price: 50000 }]
        }
    });
    assert(editConflict.status === 409, 'Optimistic locking: revisi usang (0) ditolak status 409');

    // Non-admin (kasir) edit: edit dengan revisi = 1, tanpa menyertakan fee
    // Fee lama dari prod1 dan prod2 harus tetap dipertahankan di database
    const editKasir = await request(`/api/proformas/${pfPk}`, {
        method: 'PUT',
        headers: kasirHeaders,
        body: {
            revisi: 1,
            order_date: '2026-11-03',
            payment_type_id: 'PT-1',
            items: [
                { product_id: prod1.id, name: prod1.name, quantity: 4, price: 50000 } // tidak ada fee fields
            ]
        }
    });
    assert(editKasir.status === 200 && editKasir.data.success, 'Kasir berhasil mengedit proforma (revisi 1 -> 2)');
    assert(editKasir.data.nextRevisi === 2, 'Revisi bertambah menjadi 2');

    // Cek fee di DB via admin items endpoint: fee prod1 tetap ada (5000)
    const itemsCheck = await request(`/api/proformas/${pfPk}/items`, { headers: adminHeaders });
    const item1 = itemsCheck.data.find(it => it.product_id === prod1.id);
    assert(item1 && parseFloat(item1.customer_fee) === 5000, 'Fee pelanggan tetap dipertahankan meski diedit oleh kasir (preservasi fee)');

    // Cek fee di DB via kasir items endpoint: fee fields stripped
    const kasirItemsCheck = await request(`/api/proformas/${pfPk}/items`, { headers: kasirHeaders });
    assert(kasirItemsCheck.data[0].customer_fee === undefined, 'Kasir tetap tidak dapat melihat field customer_fee di endpoint items');

    // Validation: empty items rejected
    const editEmpty = await request(`/api/proformas/${pfPk}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: { revisi: 2, order_date: '2026-11-03', items: [] }
    });
    assert(editEmpty.status === 400, 'Edit dengan 0 item ditolak status 400');

    // Validation: order_date > 7 days rejected
    const editFarDate = await request(`/api/proformas/${pfPk}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: {
            revisi: 2,
            order_date: '2026-12-31', // far future
            items: [{ product_id: prod1.id, quantity: 1, price: 50000 }]
        }
    });
    assert(editFarDate.status === 400, 'Edit dengan Tanggal Order > 7 hari ke depan ditolak status 400');

    // -------------------------------------------------------------
    // ITEM 4: BUAT PROFORMA DARI INVOICE
    // -------------------------------------------------------------
    console.log('\n--- ITEM 4: Buat Proforma dari Invoice (POST /api/invoices/:id/proforma) ---');

    // 1. Buat invoice baru via POS checkout endpoint
    const createInv = await request('/api/invoices', {
        method: 'POST',
        headers: adminHeaders,
        body: {
            customer_id: customerId,
            date: '2026-11-03',
            total: 100000,
            paid: 100000,
            payment_type_id: 'PT-1',
            items: [
                { id: prod1.id, quantity: 2, price: 50000, customer_fee: 3000, fee_notes: 'Fee Inv' }
            ]
        }
    });
    assert(createInv.status === 200 && createInv.data.invoiceId, `Invoice baru dibuat: ${createInv.data?.invoiceId}`);
    const invoiceId = createInv.data.invoiceId;

    // 2. Buat proforma dari invoice ini
    const pfFromInv = await request(`/api/invoices/${encodeURIComponent(invoiceId)}/proforma`, {
        method: 'POST',
        headers: adminHeaders,
        body: {}
    });
    assert(pfFromInv.status === 200 && pfFromInv.data.success, `Proforma berhasil dibuat dari invoice: ${pfFromInv.data?.proforma?.proforma_no}`);
    assert(pfFromInv.data.sudah_ada === false, 'sudah_ada bernilai false pada pembuatan pertama');
    const createdPfPk = pfFromInv.data.proforma.pk;
    const createdPfNo = pfFromInv.data.proforma.proforma_no;

    // 3. Verifikasi print data proforma dari invoice
    const invPrintPf = await request(`/api/proformas/${createdPfPk}/print-data`, { headers: adminHeaders });
    assert(invPrintPf.status === 200, 'Print data proforma dari invoice berhasil diambil');
    assert(invPrintPf.data.proforma.status === 'dikonversi', 'Status proforma dari invoice = "dikonversi"');
    assert(invPrintPf.data.proforma.sumber === 'dari_invoice', 'Sumber proforma = "dari_invoice"');
    assert(invPrintPf.data.proforma.invoice_id === invoiceId, `invoice_id tertaut dengan benar: ${invoiceId}`);
    const invData = await request(`/api/invoices/${encodeURIComponent(invoiceId)}/print-data`, { headers: adminHeaders });
    const expectedTotal = invData.data.invoice.total;
    assert(invPrintPf.data.proforma.total === expectedTotal, `Total proforma identik dengan total invoice: ${expectedTotal}`);
    assert(invPrintPf.data.items[0].quantity === 2, 'Kuantitas item identik: 2');
    assert(invPrintPf.data.items[0].price === 50000, 'Harga item identik: 50000');

    // 4. Idempotensi / Pencegahan Duplikat: panggil lagi endpoint yang sama untuk invoice yang sama
    const duplicateCall = await request(`/api/invoices/${encodeURIComponent(invoiceId)}/proforma`, {
        method: 'POST',
        headers: adminHeaders,
        body: {}
    });
    assert(duplicateCall.status === 200 && duplicateCall.data.success, 'Panggilan kedua berhasil tanpa error');
    assert(duplicateCall.data.sudah_ada === true, 'Panggilan kedua mengembalikan sudah_ada: true');
    assert(duplicateCall.data.proforma.pk === createdPfPk, 'Proforma PK yang dikembalikan sama persis (tidak ada proforma ganda)');

    // 5. Cek filter sumber di GET /api/proformas
    const filterDariInv = await request('/api/proformas?sumber=dari_invoice', { headers: adminHeaders });
    assert(filterDariInv.status === 200, 'GET /api/proformas?sumber=dari_invoice berhasil');
    const foundPf = filterDariInv.data.rows.find(r => r.pk === createdPfPk);
    assert(foundPf !== undefined, 'Proforma dari invoice ditemukan di filter sumber=dari_invoice');
    assert(foundPf && foundPf.sumber === 'dari_invoice', 'Field sumber di list data bernilai "dari_invoice"');

    // 6. Coba buat proforma dari invoice yang dibatalkan / cancel
    const inv2 = await request('/api/invoices', {
        method: 'POST',
        headers: adminHeaders,
        body: {
            customer_id: customerId,
            date: '2026-11-03',
            total: 50000,
            paid: 50000,
            payment_type_id: 'PT-1',
            items: [{ id: prod1.id, quantity: 1, price: 50000 }]
        }
    });
    const inv2Id = inv2.data.invoiceId;
    await request(`/api/invoices/${encodeURIComponent(inv2Id)}/cancel`, {
        method: 'PUT',
        headers: adminHeaders,
        body: { reason: 'Uji coba pembatalan 2' }
    });

    const pfFromCancelled = await request(`/api/invoices/${encodeURIComponent(inv2Id)}/proforma`, {
        method: 'POST',
        headers: adminHeaders,
        body: {}
    });
    assert(pfFromCancelled.status === 400, 'Tidak dapat membuat proforma dari invoice yang dibatalkan (status 400)');

    // 7. Coba edit proforma yang berstatus dikonversi (tidak boleh!)
    const editConverted = await request(`/api/proformas/${createdPfPk}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: {
            revisi: 0,
            order_date: '2026-11-03',
            items: [{ product_id: prod1.id, quantity: 1, price: 50000 }]
        }
    });
    assert(editConverted.status === 400, 'Proforma berstatus dikonversi tidak dapat diedit (status 400)');

    console.log('\n=============================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('=============================================');

    if (failed > 0) process.exit(1);
}

run().catch(err => {
    console.error('Fatal error during test:', err);
    process.exit(1);
});
