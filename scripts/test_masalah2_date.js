/**
 * Test otomatis Masalah 2: validasi Tanggal Order maksimal +7 hari.
 * Endpoint yang diuji:
 *  1. POST /api/invoices
 *  2. POST /api/proformas
 *  3. POST /api/proformas/:pk/convert
 *  4. Verifikasi masa berlaku proforma dihitung dari order_date (+7 hari dari order_date)
 */
const http = require('http');

// ─── Helper: Hitung tanggal WITA + offset hari ───────────────────────────────
function getWITADate(offsetDays = 0) {
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(y, m - 1, d + offsetDays);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  } catch (e) {
    const now = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000);
    return now.toISOString().split('T')[0];
  }
}

// ─── Helper: HTTP request ─────────────────────────────────────────────────────
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Helper: Login & dapatkan token ──────────────────────────────────────────
async function login(username, password) {
  const res = await request({
    hostname: '127.0.0.1', port: 3000, path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username, password });
  if (!res.body.token) throw new Error('Login gagal: ' + JSON.stringify(res.body));
  return res.body.token;
}

// ─── Helper: Ambil customer & payment type pertama ───────────────────────────
async function getFirstCustomerAndPaymentType(token) {
  const [custRes, ptRes] = await Promise.all([
    request({ hostname: '127.0.0.1', port: 3000, path: '/api/customers', method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` } }),
    request({ hostname: '127.0.0.1', port: 3000, path: '/api/master/payment-types', method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` } })
  ]);
  const customer_id = custRes.body[0]?.id || custRes.body.rows?.[0]?.id || custRes.body.data?.[0]?.id;
  const payment_type_id = ptRes.body[0]?.id || ptRes.body.rows?.[0]?.id || ptRes.body.data?.[0]?.id;
  if (!customer_id || !payment_type_id) throw new Error('Tidak dapat ambil customer/payment_type dari DB');
  return { customer_id, payment_type_id };
}

// ─── Helper: Ambil produk pertama ─────────────────────────────────────────────
async function getFirstProduct(token) {
  const res = await request({
    hostname: '127.0.0.1', port: 3000, path: '/api/products', method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const prod = res.body[0] || res.body.rows?.[0] || res.body.data?.[0];
  if (!prod) throw new Error('Tidak ada produk di database');
  return prod;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n========================================');
  console.log('  TEST MASALAH 2: Batas Tanggal Order +7 Hari');
  console.log('========================================\n');

  let passed = 0, failed = 0;

  function pass(label) { console.log(`  ✅ PASS: ${label}`); passed++; }
  function fail(label, info) { console.log(`  ❌ FAIL: ${label}\n         ${JSON.stringify(info)}`); failed++; }

  let token, customer_id, payment_type_id, product;
  try {
    token = await login('admin', 'admin123');
    ({ customer_id, payment_type_id } = await getFirstCustomerAndPaymentType(token));
    product = await getFirstProduct(token);
    console.log(`  [Setup] customer_id=${customer_id}, payment_type_id=${payment_type_id}, product=${product.id}`);
  } catch (e) {
    console.error('  [FATAL] Setup gagal:', e.message);
    process.exit(1);
  }

  const itemsPayload = [{ id: product.id, quantity: 1, price: product.sell_price || 1000, customer_fee: 0, fee_notes: '' }];

  // ─── 1. Test INVOICE ──────────────────────────────────────────────────────────
  console.log('\n--- TEST INVOICE POST /api/invoices ---');

  // Invoice: hari ini → harus diterima (200)
  {
    const date = getWITADate(0);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/invoices', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, date, items: itemsPayload, total: 1000, paid: 1000 });
    res.status < 300
      ? pass(`Invoice hari ini (${date}) → status ${res.status} diterima`)
      : fail(`Invoice hari ini (${date}) seharusnya diterima`, { status: res.status, body: res.body });
  }

  // Invoice: hari ini +7 → harus diterima
  {
    const date = getWITADate(7);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/invoices', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, date, items: itemsPayload, total: 1000, paid: 1000 });
    res.status < 300
      ? pass(`Invoice hari ini +7 (${date}) → status ${res.status} diterima`)
      : fail(`Invoice hari ini +7 (${date}) seharusnya diterima`, { status: res.status, body: res.body });
  }

  // Invoice: hari ini +8 → harus ditolak (400)
  {
    const date = getWITADate(8);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/invoices', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, date, items: itemsPayload, total: 1000, paid: 1000 });
    (res.status === 400 && res.body.error && res.body.error.includes('7 hari'))
      ? pass(`Invoice hari ini +8 (${date}) → ditolak 400 dengan pesan yang benar: "${res.body.error}"`)
      : fail(`Invoice hari ini +8 (${date}) seharusnya ditolak 400`, { status: res.status, body: res.body });
  }

  // Invoice: kemarin → harus diterima (tanggal lampau boleh)
  {
    const date = getWITADate(-1);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/invoices', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, date, items: itemsPayload, total: 1000, paid: 1000 });
    res.status < 300
      ? pass(`Invoice kemarin (${date}) → status ${res.status} diterima (tanggal lampau ok)`)
      : fail(`Invoice kemarin (${date}) seharusnya diterima`, { status: res.status, body: res.body });
  }

  // ─── 2. Test PROFORMA ─────────────────────────────────────────────────────────
  console.log('\n--- TEST PROFORMA POST /api/proformas ---');

  const proformaItemsPayload = [{ id: product.id, quantity: 1, price: product.sell_price || 1000, customer_fee: 0, fee_notes: '' }];

  // Proforma: hari ini → diterima
  {
    const order_date = getWITADate(0);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/proformas', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, order_date, items: proformaItemsPayload, discount: 0 });
    res.status < 300
      ? pass(`Proforma hari ini (${order_date}) → status ${res.status} diterima`)
      : fail(`Proforma hari ini (${order_date}) seharusnya diterima`, { status: res.status, body: res.body });
  }

  // Proforma: hari ini +7 → diterima
  {
    const order_date = getWITADate(7);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/proformas', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, order_date, items: proformaItemsPayload, discount: 0 });
    res.status < 300
      ? pass(`Proforma hari ini +7 (${order_date}) → status ${res.status} diterima`)
      : fail(`Proforma hari ini +7 (${order_date}) seharusnya diterima`, { status: res.status, body: res.body });
  }

  // Proforma: hari ini +8 → ditolak
  {
    const order_date = getWITADate(8);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/proformas', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, order_date, items: proformaItemsPayload, discount: 0 });
    (res.status === 400 && res.body.error && res.body.error.includes('7 hari'))
      ? pass(`Proforma hari ini +8 (${order_date}) → ditolak 400 dengan pesan yang benar: "${res.body.error}"`)
      : fail(`Proforma hari ini +8 (${order_date}) seharusnya ditolak 400`, { status: res.status, body: res.body });
  }

  // Proforma: bulan lalu → diterima (tanggal lampau ok)
  {
    const order_date = getWITADate(-30);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/proformas', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, order_date, items: proformaItemsPayload, discount: 0 });
    res.status < 300
      ? pass(`Proforma bulan lalu (${order_date}) → status ${res.status} diterima (tanggal lampau ok)`)
      : fail(`Proforma bulan lalu (${order_date}) seharusnya diterima`, { status: res.status, body: res.body });
  }

  // Proforma: tanggal masa depan +3 hari → periksa bahwa berlaku_hingga = order_date + 7 (bukan today + 7)
  let testPfPk = null;
  {
    const order_date = getWITADate(3);
    const expectedBerlaku = getWITADate(3 + 7);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/proformas', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, order_date, items: proformaItemsPayload, discount: 0 });

    if (res.status < 300 && res.body.proformaPk) {
      testPfPk = res.body.proformaPk;
      // Ambil detail print-data untuk memastikan berlaku_hingga tersimpan benar
      const detailRes = await request({
        hostname: '127.0.0.1', port: 3000, path: `/api/proformas/${testPfPk}/print-data`, method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const actualBerlaku = detailRes.body?.proforma?.berlaku_hingga?.split('T')[0];
      if (actualBerlaku === expectedBerlaku) {
        pass(`Masa berlaku proforma dihitung dari order_date (${order_date} + 7 hari = ${actualBerlaku})`);
      } else {
        fail(`Masa berlaku proforma tidak sesuai`, { expected: expectedBerlaku, actual: actualBerlaku });
      }
    } else {
      fail(`Gagal membuat proforma untuk tes masa berlaku`, { status: res.status, body: res.body });
    }
  }

  // ─── 3. Test KONVERSI PROFORMA POST /api/proformas/:pk/convert ────────────────
  console.log('\n--- TEST KONVERSI PROFORMA POST /api/proformas/:pk/convert ---');

  // Buat proforma khusus untuk dites konversi
  async function createFreshProforma() {
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: '/api/proformas', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { customer_id, payment_type_id, order_date: getWITADate(0), items: proformaItemsPayload, discount: 0 });
    return res.body.proformaPk;
  }

  // Konversi dengan tanggal +8 hari → harus ditolak 400
  {
    const pfPk = await createFreshProforma();
    const badDate = getWITADate(8);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: `/api/proformas/${pfPk}/convert`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { order_date: badDate, force_expired: true });
    (res.status === 400 && res.body.error && res.body.error.includes('7 hari'))
      ? pass(`Konversi dengan order_date +8 hari (${badDate}) ditolak 400: "${res.body.error}"`)
      : fail(`Konversi dengan order_date +8 hari seharusnya ditolak 400`, { status: res.status, body: res.body });
  }

  // Konversi dengan tanggal +7 hari → harus diterima
  {
    const pfPk = await createFreshProforma();
    const goodDate = getWITADate(7);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: `/api/proformas/${pfPk}/convert`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { order_date: goodDate, force_expired: true });
    res.status < 300
      ? pass(`Konversi dengan order_date +7 hari (${goodDate}) diterima: Invoice ID ${res.body.invoice?.id}`)
      : fail(`Konversi dengan order_date +7 hari seharusnya diterima`, { status: res.status, body: res.body });
  }

  // Konversi dengan tanggal hari ini → harus diterima
  {
    const pfPk = await createFreshProforma();
    const todayDate = getWITADate(0);
    const res = await request({
      hostname: '127.0.0.1', port: 3000, path: `/api/proformas/${pfPk}/convert`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { order_date: todayDate, force_expired: true });
    res.status < 300
      ? pass(`Konversi dengan order_date hari ini (${todayDate}) diterima: Invoice ID ${res.body.invoice?.id}`)
      : fail(`Konversi dengan order_date hari ini seharusnya diterima`, { status: res.status, body: res.body });
  }

  console.log('\n========================================');
  console.log(`  TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => { console.error('[FATAL]', e); process.exit(1); });
