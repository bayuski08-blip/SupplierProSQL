const http = require('http');

async function testApi() {
  console.log('Testing running server on http://localhost:3000...');

  // 1. Login as admin or kasir to get JWT token
  const loginData = JSON.stringify({ username: 'admin', password: 'password' }); // let's check users in db
  
  // Let's first test getting /api/proformas without token
  const res1 = await makeRequest('/api/proformas', 'GET');
  console.log('GET /api/proformas without auth:', res1.status, res1.body);

  // Let's test with a generated token
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, 'supplierpro_secret_key_demo');
  console.log('\nGenerated JWT Token for Admin');

  const res2 = await makeRequest('/api/proformas', 'GET', token);
  console.log('GET /api/proformas with Admin token:', res2.status, res2.body);

  // Let's test with a generated token for Kasir
  const tokenKasir = jwt.sign({ id: 2, username: 'kasir', role: 'kasir' }, 'supplierpro_secret_key_demo');
  const res3 = await makeRequest('/api/proformas', 'GET', tokenKasir);
  console.log('GET /api/proformas with Kasir token:', res3.status, res3.body);

  // Let's test POST /api/proformas
  const postData = {
    customer_id: 'C000001',
    order_date: '2026-11-02',
    payment_type_id: 'PT-1',
    discount: 0,
    items: [
      { id: 'P000001', quantity: 1, price: 50000 }
    ]
  };
  const res4 = await makeRequest('/api/proformas', 'POST', tokenKasir, postData);
  console.log('POST /api/proformas with Kasir token:', res4.status, res4.body);

  if (res4.body && res4.body.proformaPk) {
    const res5 = await makeRequest(`/api/proformas/${res4.body.proformaPk}/print-data`, 'GET', tokenKasir);
    console.log('GET /api/proformas/:pk/print-data:', res5.status, res5.body);
  }
}

function makeRequest(path, method, token, data) {
  return new Promise((resolve) => {
    const postBody = data ? JSON.stringify(data) : null;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (postBody) headers['Content-Length'] = Buffer.byteLength(postBody);

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ status: 0, body: err.message });
    });

    if (postBody) req.write(postBody);
    req.end();
  });
}

testApi();

