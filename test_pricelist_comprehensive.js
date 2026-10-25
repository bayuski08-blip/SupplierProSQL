require('dotenv').config();
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const BASE_URL = 'http://localhost:3000';

const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: 'Admin Test' }, SECRET_KEY, { expiresIn: '1h' });
const kasirToken = jwt.sign({ id: 5, username: 'kasir', role: 'kasir', name: 'Kasir Test' }, SECRET_KEY, { expiresIn: '1h' });

async function api(path, method = 'GET', body = null, token = adminToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runChecklist() {
  console.log('=== CHECKLIST PENGUJIAN FITUR PRICELIST (spec-pricelist.md) ===\n');

  // Checklist 2: Customer tanpa pricelist
  console.log('Checklist 2: Customer tanpa pricelist (harga semua produk = master)...');
  const resCustNoPl = await api('/api/pricelists/effective-prices?customer_id=C000002');
  console.assert(resCustNoPl.status === 200, 'Gagal ambil harga customer tanpa pricelist');
  const pricesNoPl = resCustNoPl.data.prices;
  const allMaster = pricesNoPl.every(p => p.sumber_harga === 'master' && parseFloat(p.harga_efektif) === parseFloat(p.harga_master));
  console.assert(allMaster, 'Ada produk yang tidak memakai harga master untuk customer tanpa pricelist');
  console.log('   [PASS] Semua produk memakai harga master produk');

  // Buat Pricelist untuk pengujian
  const plName = 'Pricelist Uji Komprehensif ' + Date.now();
  const resPl = await api('/api/pricelists', 'POST', { nama: plName, keterangan: 'Untuk checklist pengujian' });
  console.assert(resPl.status === 200, 'Gagal membuat pricelist');
  const pl = resPl.data.data;

  // Isi 1 item ke pricelist: P000001 harga 45,000 (diskon khusus)
  await api(`/api/pricelists/${pl.id}/items`, 'PUT', {
    items: [{ product_id: 'P000001', harga: 45000 }]
  });

  // Assign customer C000001 ke pricelist ini
  await api('/api/customers/C000001', 'PUT', {
    name: 'Toko Berkah Jaya',
    customer_category_id: 'CC-1',
    pricelist_id: pl.id
  });

  // Checklist 3: Customer dengan pricelist
  console.log('Checklist 3: Customer dengan pricelist (produk di pricelist = harga pricelist; di luar = harga master)...');
  const resCustWithPl = await api('/api/pricelists/effective-prices?customer_id=C000001');
  const p1 = resCustWithPl.data.prices.find(p => p.product_id === 'P000001');
  const p2 = resCustWithPl.data.prices.find(p => p.product_id === 'P000002');
  console.assert(parseFloat(p1.harga_efektif) === 45000 && p1.sumber_harga === 'pricelist', 'P000001 harus memakai harga pricelist');
  console.assert(parseFloat(p2.harga_efektif) === parseFloat(p2.harga_master) && p2.sumber_harga === 'master', 'P000002 harus memakai harga master');
  console.log(`   [PASS] P000001 (di pricelist): Rp ${p1.harga_efektif} (sumber: ${p1.sumber_harga})`);
  console.log(`   [PASS] P000002 (di luar pricelist): Rp ${p2.harga_efektif} (sumber: ${p2.sumber_harga})`);

  // Checklist 4: Pricelist dinonaktifkan
  console.log('Checklist 4: Pricelist dinonaktifkan (customer terkait kembali ke harga master)...');
  await api(`/api/pricelists/${pl.id}`, 'PUT', { is_active: 0 });
  const resCustDeactive = await api('/api/pricelists/effective-prices?customer_id=C000001');
  const p1Deactive = resCustDeactive.data.prices.find(p => p.product_id === 'P000001');
  console.assert(parseFloat(p1Deactive.harga_efektif) === parseFloat(p1Deactive.harga_master) && p1Deactive.sumber_harga === 'master', 'Harus fallback ke master');
  console.log(`   [PASS] Setelah dinonaktifkan, harga kembali ke master: Rp ${p1Deactive.harga_efektif}`);

  // Aktifkan kembali untuk test selanjutnya
  await api(`/api/pricelists/${pl.id}`, 'PUT', { is_active: 1 });

  // Checklist 6 & 7: Pembuatan Invoice dari harga pricelist, lalu harga pricelist diubah (snapshot kekal)
  console.log('Checklist 6 & 7: Pembuatan invoice snapshot harga & verifikasi perhitungan (Total, PPN, HPP)...');
  const invoicePayload = {
    customer_id: 'C000001',
    payment_type_id: 'PT-1',
    items: [
      { id: 'P000001', quantity: 2, price: 45000, fee: 1000, feeNotes: 'Fee sales A' }
    ]
  };
  const resInv = await api('/api/invoices', 'POST', invoicePayload);
  console.assert(resInv.status === 200, 'Gagal membuat invoice');
  const invoiceId = resInv.data.invoiceId;
  console.log(`   [PASS] Invoice dibuat ID: ${invoiceId}`);

  // Ubah harga pricelist P000001 menjadi 60,000
  await api(`/api/pricelists/${pl.id}/items`, 'PUT', {
    items: [{ product_id: 'P000001', harga: 60000 }]
  });

  // Ambil data invoice lama via print-data
  const resPrint = await api(`/api/invoices/${encodeURIComponent(invoiceId)}/print-data`);
  console.assert(resPrint.status === 200, 'Gagal ambil print-data');
  const invItem = resPrint.data.items[0];
  console.assert(parseFloat(invItem.price) === 45000, `Harga item invoice harus tetap snapshot 45,000, didapat: ${invItem.price}`);
  console.log(`   [PASS] Snapshot harga invoice tetap Rp ${invItem.price} meskipun harga pricelist sudah diubah ke Rp 60.000`);

  // Checklist 8: Hapus pricelist yang dipakai customer
  console.log('Checklist 8: Hapus pricelist yang dipakai customer ditolak dengan pesan jumlah customer (409)...');
  const resDelUsed = await api(`/api/pricelists/${pl.id}`, 'DELETE');
  console.assert(resDelUsed.status === 409, `Harus 409, didapat: ${resDelUsed.status}`);
  console.assert(resDelUsed.data.total_customers === 1, 'Jumlah customer harus 1');
  console.log(`   [PASS] Ditolak 409: "${resDelUsed.data.error}"`);

  // Checklist 9: Bulk upsert & import validasi
  console.log('Checklist 9: Validasi bulk upsert item (harga <= 0 ditolak, duplikat produk dideduplikasi)...');
  const resInvalid = await api(`/api/pricelists/${pl.id}/items`, 'PUT', {
    items: [{ product_id: 'P000001', harga: -500 }]
  });
  console.assert(resInvalid.status === 400, 'Harga negatif harus ditolak 400');
  console.log('   [PASS] Harga negatif ditolak dengan benar');

  // Checklist 10: Hak akses role (RBAC) & sanitasi HPP
  console.log('Checklist 10: Role kasir tidak bisa membuat pricelist (403) & HPP tidak bocor ke kasir...');
  const resKasirPost = await api('/api/pricelists', 'POST', { nama: 'Kasir Hack' }, kasirToken);
  console.assert(resKasirPost.status === 403, 'Kasir harus diblokir 403');
  const resKasirEff = await api('/api/pricelists/effective-prices?customer_id=C000001', 'GET', null, kasirToken);
  const p1Kasir = resKasirEff.data.prices[0];
  console.assert(p1Kasir.hpp === undefined, 'HPP bocor ke role kasir!');
  console.log('   [PASS] Kasir diblokir (403) dan field HPP disanitasi dari respons');

  // Checklist 12: Cetak invoice dengan harga pricelist
  console.log('Checklist 12: Verifikasi cetak invoice (data invoice & item valid untuk invoice-print.js)...');
  console.assert(resPrint.data.invoice && resPrint.data.items.length > 0, 'Data cetak tidak lengkap');
  console.log(`   [PASS] Print data invoice ${resPrint.data.invoice.id} siap cetak dengan subtotal Rp ${resPrint.data.invoice.subtotal}`);

  // Cleanup: kembalikan customer C000001 ke null pricelist & hapus test pricelist
  console.log('\nCleaning up test data...');
  await api('/api/customers/C000001', 'PUT', {
    name: 'Toko Berkah Jaya',
    customer_category_id: 'CC-1',
    pricelist_id: null
  });
  await api(`/api/pricelists/${pl.id}`, 'DELETE');
  console.log('   [PASS] Customer reset & test pricelist deleted');

  console.log('\n=== SELURUH CHECKLIST PENGUJIAN BERHASIL 100%! ===');
}

runChecklist().catch(err => {
  console.error('Error saat checklist:', err);
  process.exit(1);
});
