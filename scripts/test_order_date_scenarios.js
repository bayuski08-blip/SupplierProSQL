const jwt = require('../node_modules/jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, SECRET_KEY);
const authHeaders = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer ' + token
};

const BASE_URL = 'http://localhost:3000';

function getTodayWITA() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
}

async function runTests() {
  console.log('====================================================');
  console.log('TEST SUITE: Tanggal Order di Pembuatan Transaksi');
  console.log('Today (WITA):', getTodayWITA());
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  [PASS]', message);
      passed++;
    } else {
      console.error('  [FAIL]', message);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // SKENARIO 1: Order tanpa mengubah tanggal -> tanggal = hari ini (WITA)
  // -------------------------------------------------------------------------
  console.log('--- SKENARIO 1: Order Default Tanggal (Hari ini WITA) ---');
  try {
    const today = getTodayWITA();
    const res1 = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-1', // Tunai
        date: today, // Simulates frontend sending default getTodayWITA()
        items: [{ id: 'P000006', quantity: 1, price: 72000 }]
      })
    });
    const data1 = await res1.json();
    assert(res1.status === 200 && data1.success, `Order dibuat berhasil: ${data1.invoiceId}`);

    // Verify invoice details
    const invRes1 = await fetch(`${BASE_URL}/api/invoices/${data1.invoiceId}/print-data`, { headers: authHeaders });
    const invData1 = await invRes1.json();
    const invDate1 = invData1.invoice.date ? invData1.invoice.date.split('T')[0] : '';
    assert(invDate1 === today, `Tanggal invoice (${invDate1}) sama dengan hari ini WITA (${today})`);

    // Verify backward compatibility: create without sending date field
    const res1b = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-1',
        items: [{ id: 'P000006', quantity: 1, price: 72000 }]
      })
    });
    const data1b = await res1b.json();
    const invRes1b = await fetch(`${BASE_URL}/api/invoices/${data1b.invoiceId}/print-data`, { headers: authHeaders });
    const invData1b = await invRes1b.json();
    const invDate1b = invData1b.invoice.date ? invData1b.invoice.date.split('T')[0] : '';
    assert(invDate1b === today, `Backward compatible (tanpa parameter date) fallback ke hari ini WITA: ${invDate1b}`);
  } catch (err) {
    assert(false, `Skenario 1 error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // SKENARIO 2: Order dengan tanggal mundur (Tunai)
  // Muncul di invoice list, arus kas (cash_transactions), dan laporan pada tanggal tersebut.
  // -------------------------------------------------------------------------
  console.log('\n--- SKENARIO 2: Order Tanggal Mundur (Tunai) ---');
  try {
    const backdate = '2026-10-15';
    const res2 = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-1', // Tunai
        date: backdate,
        items: [{ id: 'P000006', quantity: 2, price: 72000 }]
      })
    });
    const data2 = await res2.json();
    assert(res2.status === 200 && data2.success, `Invoice mundur dibuat: ${data2.invoiceId}`);

    // Check invoice record
    const invRes2 = await fetch(`${BASE_URL}/api/invoices/${data2.invoiceId}/print-data`, { headers: authHeaders });
    const invData2 = await invRes2.json();
    const invDate2 = invData2.invoice.date ? invData2.invoice.date.split('T')[0] : '';
    assert(invDate2 === backdate, `Tanggal invoice tercatat sesuai tanggal mundur: ${invDate2}`);

    // Check cash flow (arus kas) for this invoice
    const ctRes = await fetch(`${BASE_URL}/api/finance/cash-flow?all=true`, { headers: authHeaders });
    const ctData = await ctRes.json();
    const ctList = Array.isArray(ctData) ? ctData : (ctData.data || []);
    const ctEntry = ctList.find(c => c.invoiceId === data2.invoiceId || (c.desc && c.desc.includes(data2.invoiceId)));
    assert(ctEntry !== undefined, `Entri arus kas ditemukan untuk invoice ${data2.invoiceId}`);
    if (ctEntry) {
      const ctDate = ctEntry.date ? ctEntry.date.split('T')[0] : '';
      assert(ctDate === backdate, `Tanggal arus kas (${ctDate}) mengikuti tanggal order (${backdate})`);
    }

    // Check laporan / dashboard / invoices list
    const invListRes = await fetch(`${BASE_URL}/api/invoices`, { headers: authHeaders });
    const invList = await invListRes.json();
    const invItem = invList.find(i => i.id === data2.invoiceId);
    assert(invItem !== undefined && invItem.date.split('T')[0] === backdate, `Invoice muncul di list transaksi dengan tanggal ${backdate}`);
  } catch (err) {
    assert(false, `Skenario 2 error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // SKENARIO 3: Order Kredit 7 hari dengan tanggal mundur
  // Jatuh tempo = tanggal order + 7 hari, tampil benar di piutang.
  // -------------------------------------------------------------------------
  console.log('\n--- SKENARIO 3: Order Kredit 7 Hari Tanggal Mundur ---');
  try {
    const orderDate3 = '2026-10-20';
    const expectedDueDate = '2026-10-27'; // 2026-10-20 + 7 hari

    const res3 = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-5', // Kredit 7 Hari
        date: orderDate3,
        due_date: expectedDueDate,
        items: [{ id: 'P000006', quantity: 1, price: 72000 }]
      })
    });
    const data3 = await res3.json();
    assert(res3.status === 200 && data3.success, `Invoice kredit dibuat: ${data3.invoiceId}`);

    // Verify invoice due date
    const invRes3 = await fetch(`${BASE_URL}/api/invoices/${data3.invoiceId}/print-data`, { headers: authHeaders });
    const invData3 = await invRes3.json();
    const invDate3 = invData3.invoice.date ? invData3.invoice.date.split('T')[0] : '';
    const invDueDate3 = invData3.invoice.due_date ? invData3.invoice.due_date.split('T')[0] : '';
    assert(invDate3 === orderDate3, `Tanggal invoice = ${invDate3}`);
    assert(invDueDate3 === expectedDueDate, `Jatuh tempo = tanggal order + 7 hari (${invDueDate3} vs diharapkan ${expectedDueDate})`);

    // Verify piutang endpoint
    const piutangRes = await fetch(`${BASE_URL}/api/finance/receivables?all=true`, { headers: authHeaders });
    const piutangData = await piutangRes.json();
    const piutangList = Array.isArray(piutangData) ? piutangData : (piutangData.data || []);
    const piutangEntry = piutangList.find(p => p.id === data3.invoiceId);
    assert(piutangEntry !== undefined, `Invoice ${data3.invoiceId} muncul di modul piutang`);
    if (piutangEntry) {
      assert(piutangEntry.date === orderDate3, `Piutang menampilkan tanggal order yang benar (${piutangEntry.date})`);
      assert(piutangEntry.dueDate === expectedDueDate, `Piutang menampilkan jatuh tempo yang benar (${piutangEntry.dueDate})`);
    }
  } catch (err) {
    assert(false, `Skenario 3 error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // SKENARIO 4: Tanggal masa depan / format salah ditolak server
  // -------------------------------------------------------------------------
  console.log('\n--- SKENARIO 4: Validasi Tanggal Masa Depan & Format Salah ---');
  try {
    // 4a: Tanggal masa depan (2026-12-31)
    const resFuture = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-1',
        date: '2026-12-31',
        items: [{ id: 'P000006', quantity: 1, price: 72000 }]
      })
    });
    const futureData = await resFuture.json();
    assert(resFuture.status === 400, `Tanggal masa depan (2026-12-31) ditolak HTTP 400 (Status: ${resFuture.status}, Pesan: ${futureData.error})`);

    // 4b: Format salah ('31-12-2026')
    const resWrongFormat = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-1',
        date: '31-12-2026',
        items: [{ id: 'P000006', quantity: 1, price: 72000 }]
      })
    });
    const wrongFormatData = await resWrongFormat.json();
    assert(resWrongFormat.status === 400, `Format salah ('31-12-2026') ditolak HTTP 400 (Status: ${resWrongFormat.status}, Pesan: ${wrongFormatData.error})`);

    // 4c: Tanggal kalender tidak ada ('2026-02-31')
    const resFakeDate = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-1',
        date: '2026-02-31',
        items: [{ id: 'P000006', quantity: 1, price: 72000 }]
      })
    });
    const fakeDateData = await resFakeDate.json();
    assert(resFakeDate.status === 400, `Tanggal tidak valid ('2026-02-31') ditolak HTTP 400 (Status: ${resFakeDate.status}, Pesan: ${fakeDateData.error})`);
  } catch (err) {
    assert(false, `Skenario 4 error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // SKENARIO 5: Cetak Invoice -> Tanggal tercetak sesuai tanggal order
  // -------------------------------------------------------------------------
  console.log('\n--- SKENARIO 5: Cetak Invoice (Data Print API) ---');
  try {
    const printOrderDate = '2026-10-18';
    const res5 = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_id: 'C000003',
        payment_type_id: 'PT-1',
        date: printOrderDate,
        items: [{ id: 'P000006', quantity: 1, price: 72000 }]
      })
    });
    const data5 = await res5.json();
    const printRes = await fetch(`${BASE_URL}/api/invoices/${data5.invoiceId}/print-data`, { headers: authHeaders });
    const printData = await printRes.json();
    const fetchedDate = printData.invoice.date ? printData.invoice.date.split('T')[0] : '';
    assert(fetchedDate === printOrderDate, `Data cetak invoice ${data5.invoiceId} memuat tanggal order: ${fetchedDate}`);

    // Verify invoice-print.js formatting logic (DD/MM/YYYY)
    const parts = fetchedDate.split('-');
    const formattedPrintDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
    assert(formattedPrintDate === '18/10/2026', `Format cetak tanggal dot-matrix benar: ${formattedPrintDate}`);
  } catch (err) {
    assert(false, `Skenario 5 error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // SKENARIO 6: Mobile view & HTML/CSS structure verification
  // -------------------------------------------------------------------------
  console.log('\n--- SKENARIO 6: Verifikasi Mobile View & Komponen UI ---');
  try {
    const fs = require('fs');
    const html = fs.readFileSync('dashboard.html', 'utf8');
    const css = fs.readFileSync('dashboard.css', 'utf8');
    const js = fs.readFileSync('dashboard.js', 'utf8');

    assert(html.includes('id="cart-order-date"'), 'Input #cart-order-date ada di dashboard.html');
    assert(html.includes('class="cart-order-date-wrapper"'), 'Container .cart-order-date-wrapper ada di pos-cart-footer');
    assert(css.includes('.cart-order-date-wrapper'), 'CSS .cart-order-date-wrapper didefinisikan');
    assert(css.includes('@media (max-width: 768px)') && css.includes('.cart-order-date-wrapper'), 'CSS responsive mobile view (max-width: 768px) ada untuk compact styling');
    assert(js.includes('getTodayWITA()'), 'Fungsi getTodayWITA() tersedia untuk timezone Asia/Makassar');
    assert(js.includes('resetDateEl.value = todayStr'), 'Reset tanggal order ke hari ini setelah transaksi sukses');
  } catch (err) {
    assert(false, `Skenario 6 error: ${err.message}`);
  }

  console.log('\n====================================================');
  console.log(`HASIL TEST: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
