const http = require('http');

function req(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      host: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      }
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  // 1. Login as admin
  const loginRes = await req('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  const loginData = JSON.parse(loginRes.body);
  const token = loginData.token;
  console.log('1. LOGIN admin:', loginRes.status === 200 ? 'OK' : 'FAIL', '| token:', token ? 'present' : 'missing');

  // 2. Dashboard summary (checks DB connected)
  const sumRes = await req('/api/dashboard/summary', 'GET', null, token);
  console.log('2. DASHBOARD SUMMARY:', sumRes.status === 200 ? 'OK' : 'FAIL (' + sumRes.status + ')');

  // 3. Payables (Hutang)
  const hutRes = await req('/api/finance/payables', 'GET', null, token);
  const hutData = JSON.parse(hutRes.body);
  console.log('3. HUTANG PAYABLES:', hutRes.status === 200 ? 'OK' : 'FAIL (' + hutRes.status + ')');
  if (hutData.summary) {
    const s = hutData.summary;
    console.log('   summary keys:', Object.keys(s).join(', '));
    console.log('   total_debt:', s.total_debt || s.totalDebt || 0);
    console.log('   vendors_with_debt:', s.vendors_with_debt || s.vendorsWithDebt || 0);
    console.log('   vendors_lunas:', s.vendors_lunas || s.vendorsLunas || 0);
    console.log('   overdue_count:', s.overdue_count || s.overdueCount || 0);
  }

  // 4. Serve dashboard.html
  const htmlRes = await req('/dashboard.html', 'GET', null, null);
  const html = htmlRes.body;
  console.log('4. DASHBOARD HTML:');
  console.log('   script?v=12:', html.includes('dashboard.js?v=12') ? 'YES' : 'NO');
  console.log('   modal-hutang-payment-history:', html.includes('modal-hutang-payment-history') ? 'YES' : 'NO');
  console.log('   modal-hutang-payment:', html.includes('id="modal-hutang-payment"') ? 'YES' : 'NO');
  console.log('   modal-void-hutang-payment:', html.includes('modal-void-hutang-payment') ? 'YES' : 'NO');
  console.log('   modal-delete-outstanding-hutang:', html.includes('modal-delete-outstanding-hutang') ? 'YES' : 'NO');

  // 5. dashboard.js served
  const jsRes = await req('/dashboard.js', 'GET', null, null);
  console.log('5. DASHBOARD.JS: HTTP', jsRes.status, '| size:', jsRes.body.length, 'bytes');
  const hasSelectedHutangIds = jsRes.body.includes('selectedHutangIds');
  const hasBatchCVars = jsRes.body.includes('BATCH C: State Variables');
  const hasBatchCHistory = jsRes.body.includes('openHutangPaymentHistoryModal');
  const hasWindowBindings = jsRes.body.includes('window.openHutangPaymentHistoryModal');
  console.log('   selectedHutangIds declared:', hasSelectedHutangIds ? 'YES' : 'NO');
  console.log('   BATCH C state vars comment:', hasBatchCVars ? 'YES' : 'NO');
  console.log('   openHutangPaymentHistoryModal fn:', hasBatchCHistory ? 'YES' : 'NO');
  console.log('   window.openHutangPaymentHistoryModal binding:', hasWindowBindings ? 'YES' : 'NO');

  console.log('\nAll smoke checks done!');
}

main().catch(e => console.error('ERROR:', e.message));

