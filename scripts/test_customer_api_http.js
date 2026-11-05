const http = require('http');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: 'Admin Test' }, SECRET_KEY, { expiresIn: '1h' });

async function api(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('--- Launching test server on port 3099 connected to supplierpro_clone ---');
  const serverProc = spawn('node', ['server.js'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DATABASE_URL: 'mysql://root:@localhost:3306/supplierpro_clone'
    },
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('running') || msg.includes('Server')) {
      // console.log('[Server stdout]', msg.trim());
    }
  });
  serverProc.stderr.on('data', d => {
    // console.error('[Server stderr]', d.toString().trim());
  });

  // Wait for server to start
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await wait(300);
    try {
      const ping = await fetch(`${BASE_URL}/api/master/payment-types`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (ping.ok) {
        ready = true;
        break;
      }
    } catch (_) {}
  }

  if (!ready) {
    serverProc.kill();
    throw new Error('Test server failed to start within timeout.');
  }

  console.log('✅ Test server ready on port 3099!\n');

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

  try {
    // 1. GET /api/master/payment-types
    const ptRes = await api('/api/master/payment-types');
    assert('GET /api/master/payment-types returns 200', ptRes.status === 200);
    assert('Payment types include Tunai and Kredit 30 Hari', Array.isArray(ptRes.data) && ptRes.data.some(p => p.name.includes('Tunai')) && ptRes.data.some(p => p.name.includes('Kredit 30 Hari')));

    // 2. POST /api/customers with valid tipe_pembayaran_id
    const createTunai = await api('/api/customers', 'POST', {
      name: 'HTTP Test Cust Tunai',
      phone: '08123456789',
      city: 'Denpasar',
      tipe_pembayaran_id: 'PT-1'
    });
    assert('POST /api/customers with PT-1 returns 200', createTunai.status === 200);
    const tunaiId = createTunai.data?.id;

    // 3. POST /api/customers with invalid tipe_pembayaran_id -> 400
    const createInvalid = await api('/api/customers', 'POST', {
      name: 'HTTP Test Cust Invalid',
      phone: '08123456789',
      city: 'Denpasar',
      tipe_pembayaran_id: 'PT-INVALID-XYZ'
    });
    assert('POST /api/customers with invalid PT returns 400 Bad Request', createInvalid.status === 400);

    // 4. POST /api/customers with empty / null tipe_pembayaran_id -> 200
    const createNull = await api('/api/customers', 'POST', {
      name: 'HTTP Test Cust Null PT',
      phone: '08123456788',
      city: 'Badung',
      tipe_pembayaran_id: null
    });
    assert('POST /api/customers with null PT returns 200', createNull.status === 200);
    const nullId = createNull.data?.id;

    // 5. GET /api/customers/:id for Tunai customer
    const getTunai = await api(`/api/customers/${tunaiId}`);
    assert('GET /api/customers/:id returns 200', getTunai.status === 200);
    assert('Returned tipe_pembayaran_id is "PT-1"', getTunai.data.tipe_pembayaran_id === 'PT-1');
    assert('Returned payment_type_id alias is "PT-1"', getTunai.data.payment_type_id === 'PT-1');
    assert('Returned tipe_pembayaran_name is "Tunai"', getTunai.data.tipe_pembayaran_name === 'Tunai');
    assert('Returned payment_type_name is "Tunai"', getTunai.data.payment_type_name === 'Tunai');

    // 6. GET /api/customers/:id for Null customer
    const getNull = await api(`/api/customers/${nullId}`);
    assert('GET /api/customers/:id for null PT returns 200', getNull.status === 200);
    assert('Returned tipe_pembayaran_id is null', getNull.data.tipe_pembayaran_id === null);
    assert('Returned tipe_pembayaran_name is null', getNull.data.tipe_pembayaran_name === null);

    // 7. PUT /api/customers/:id update to Transfer (PT-2)
    const updateToTrf = await api(`/api/customers/${tunaiId}`, 'PUT', {
      name: 'HTTP Test Cust Updated to Trf',
      phone: '08123456789',
      city: 'Denpasar',
      tipe_pembayaran_id: 'PT-2'
    });
    assert('PUT /api/customers/:id update to PT-2 returns 200', updateToTrf.status === 200);

    const getUpdated = await api(`/api/customers/${tunaiId}`);
    assert('Updated customer has tipe_pembayaran_id = "PT-2"', getUpdated.data.tipe_pembayaran_id === 'PT-2');
    assert('Updated customer has tipe_pembayaran_name = "Transfer"', getUpdated.data.tipe_pembayaran_name === 'Transfer');

    // 8. PUT /api/customers/:id with invalid PT -> 400
    const updateInvalid = await api(`/api/customers/${tunaiId}`, 'PUT', {
      name: 'HTTP Test Cust Update Invalid',
      tipe_pembayaran_id: 'PT-NON-EXISTENT'
    });
    assert('PUT /api/customers/:id with invalid PT returns 400 Bad Request', updateInvalid.status === 400);

    // 9. GET /api/customers (all & paginated)
    const listAll = await api('/api/customers?all=true');
    assert('GET /api/customers?all=true returns 200', listAll.status === 200 && Array.isArray(listAll.data));
    const foundInAll = listAll.data.find(c => c.id === tunaiId);
    assert('Found updated customer in list with tipe_pembayaran_id "PT-2"', foundInAll && foundInAll.tipe_pembayaran_id === 'PT-2');
    assert('Found updated customer with tipe_pembayaran_name "Transfer"', foundInAll && foundInAll.tipe_pembayaran_name === 'Transfer');

    // 10. GET /api/customers/search
    const searchRes = await api(`/api/customers/search?q=${encodeURIComponent('HTTP Test Cust Updated')}`);
    assert('GET /api/customers/search returns 200', searchRes.status === 200 && Array.isArray(searchRes.data));
    assert('Search result includes customer with tipe_pembayaran_name "Transfer"', searchRes.data.some(c => c.id === tunaiId && c.tipe_pembayaran_name === 'Transfer'));

    // Cleanup
    await api(`/api/customers/${tunaiId}`, 'DELETE');
    await api(`/api/customers/${nullId}`, 'DELETE');
    console.log('  Cleaned up test customers via DELETE API');

    console.log('\n====================================================');
    console.log(`📊 HTTP API RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

  } finally {
    serverProc.kill();
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

