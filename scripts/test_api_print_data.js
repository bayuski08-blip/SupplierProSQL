const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, SECRET_KEY);

async function testEndpoints() {
  console.log('Testing /api/invoices/:id/print-data...');

  // 1. Customer with phone (C000002 - Warung Sari Rasa: 085936103383)
  const res1 = await fetch('http://127.0.0.1:3000/api/invoices/INV-2026-10-00005/print-data', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data1 = await res1.json();
  console.log('\n--- Kasus 1: Customer dengan nomor terisi ---');
  console.log('Invoice ID:', data1.invoice?.id);
  console.log('Customer Name:', data1.customer?.name);
  console.log('Customer Address:', data1.customer?.address);
  console.log('Customer Phone:', data1.customer?.phone);

  // 2. Customer without phone (C000001 - Toko Berkah Jaya: null -> '-')
  const res2 = await fetch('http://127.0.0.1:3000/api/invoices/INV-2026-09-00003/print-data', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data2 = await res2.json();
  console.log('\n--- Kasus 2: Customer tanpa nomor ---');
  console.log('Invoice ID:', data2.invoice?.id);
  console.log('Customer Name:', data2.customer?.name);
  console.log('Customer Address:', data2.customer?.address);
  console.log('Customer Phone:', data2.customer?.phone);

  // 3. Multi-item invoice
  const res3 = await fetch('http://127.0.0.1:3000/api/invoices/INV-TEST-35ITEMS/print-data', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data3 = await res3.json();
  console.log('\n--- Kasus 3: Multi-item invoice ---');
  console.log('Invoice ID:', data3.invoice?.id);
  console.log('Item count:', data3.items?.length);
  console.log('Customer Name:', data3.customer?.name);
  console.log('Customer Phone:', data3.customer?.phone);
}

testEndpoints().catch(console.error);
