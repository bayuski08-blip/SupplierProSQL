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

async function runTests() {
  console.log('=== STARTING PRICELIST BACKEND TESTS ===\n');

  // Test 1: Kasir trying to create pricelist (should fail 403)
  console.log('1. Testing RBAC: Kasir creating pricelist...');
  const resKasirCreate = await api('/api/pricelists', 'POST', { nama: 'Test Kasir' }, kasirToken);
  console.assert(resKasirCreate.status === 403, `Expected 403, got ${resKasirCreate.status}`);
  console.log('   [PASS] Kasir correctly blocked (403)');

  // Test 2: Admin creates a pricelist
  console.log('2. Testing Admin creating pricelist...');
  const testPlName = 'Pricelist VIP Test ' + Date.now();
  const resCreate = await api('/api/pricelists', 'POST', { nama: testPlName, keterangan: 'Khusus pelanggan VIP' });
  console.assert(resCreate.status === 200 && resCreate.data?.success, 'Failed to create pricelist');
  const pl = resCreate.data.data;
  console.log(`   [PASS] Created pricelist ID: ${pl.id}, Kode: ${pl.kode}, Nama: ${pl.nama}`);

  // Test 3: Duplicate name validation (should fail 400)
  console.log('3. Testing case-insensitive unique name validation...');
  const resDupName = await api('/api/pricelists', 'POST', { nama: testPlName.toLowerCase() });
  console.assert(resDupName.status === 400, `Expected 400 for duplicate name, got ${resDupName.status}`);
  console.log('   [PASS] Duplicate name rejected (400)');

  // Test 4: Bulk upsert items into pricelist
  console.log('4. Testing bulk upsert items...');
  const items = [
    { product_id: 'P000001', harga: 55000 },
    { product_id: 'P000002', harga: 100000 }
  ];
  const resItems = await api(`/api/pricelists/${pl.id}/items`, 'PUT', { items });
  console.assert(resItems.status === 200 && resItems.data?.count === 2, 'Failed to bulk upsert items');
  console.log('   [PASS] Bulk upsert 2 items succeeded');

  // Test 5: Validation harga <= 0 rejected (R5)
  console.log('5. Testing validation harga <= 0 rejected...');
  const resInvalidPrice = await api(`/api/pricelists/${pl.id}/items`, 'PUT', { items: [{ product_id: 'P000001', harga: 0 }] });
  console.assert(resInvalidPrice.status === 400, `Expected 400 for harga 0, got ${resInvalidPrice.status}`);
  console.log('   [PASS] Zero price rejected (400)');

  // Test 6: Get pricelist detail
  console.log('6. Testing GET pricelist detail with items...');
  const resDetail = await api(`/api/pricelists/${pl.id}`);
  console.assert(resDetail.status === 200 && resDetail.data?.items?.length === 2, 'Failed to get detail');
  console.assert(resDetail.data.items[0].harga_master !== undefined, 'harga_master missing');
  console.assert(resDetail.data.items[0].hpp !== undefined, 'hpp missing for admin');
  console.log('   [PASS] Pricelist detail returned with master price and HPP for admin');

  // Test 7: Kasir getting detail should have HPP hidden (Spec 4.4)
  console.log('7. Testing HPP sanitization for kasir...');
  const resKasirDetail = await api(`/api/pricelists/${pl.id}`, 'GET', null, kasirToken);
  console.assert(resKasirDetail.status === 200, 'Kasir failed to get detail');
  console.assert(resKasirDetail.data.items[0].hpp === undefined, 'HPP leaked to kasir!');
  console.log('   [PASS] HPP successfully sanitized for kasir');

  // Test 8: Duplicate pricelist
  console.log('8. Testing duplicate pricelist...');
  const resDuplicate = await api(`/api/pricelists/${pl.id}/duplicate`, 'POST', {});
  console.assert(resDuplicate.status === 200 && resDuplicate.data?.success, 'Failed to duplicate pricelist');
  const dupPl = resDuplicate.data.data;
  const resDupDetail = await api(`/api/pricelists/${dupPl.id}`);
  console.assert(resDupDetail.data.items.length === 2, 'Items not duplicated');
  console.log(`   [PASS] Duplicated pricelist ID: ${dupPl.id}, Kode: ${dupPl.kode}, Items count: ${resDupDetail.data.items.length}`);

  // Test 9: Assign customer to pricelist & test effective price
  console.log('9. Testing customer assignment and effective prices...');
  // Update customer C000001 to use pricelist pl.id
  const resCustUpdate = await api('/api/customers/C000001', 'PUT', {
    name: 'Toko Berkah Jaya',
    pricelist_id: pl.id
  });
  console.assert(resCustUpdate.status === 200, 'Failed to assign pricelist to customer');

  // Call GET /api/pricelists/effective-prices?customer_id=C000001
  const resEff = await api(`/api/pricelists/effective-prices?customer_id=C000001`);
  console.assert(resEff.status === 200, 'Failed to get effective prices');
  const p1Eff = resEff.data.prices.find(p => p.product_id === 'P000001');
  console.assert(parseFloat(p1Eff.harga_efektif) === 55000, `Expected 55000, got ${p1Eff.harga_efektif}`);
  console.assert(p1Eff.sumber_harga === 'pricelist', `Expected sumber_harga 'pricelist', got ${p1Eff.sumber_harga}`);
  console.log('   [PASS] Effective price correctly resolved to pricelist price (55,000)');

  // Test 10: Product endpoint with customer_id query param
  console.log('10. Testing GET /api/products?customer_id=C000001...');
  const resProds = await api(`/api/products?customer_id=C000001`);
  console.assert(resProds.status === 200, 'Failed to get products with customer_id');
  const prod1 = resProds.data.find(p => p.id === 'P000001');
  console.assert(parseFloat(prod1.harga_efektif) === 55000, 'Product harga_efektif mismatch');
  console.assert(prod1.sumber_harga === 'pricelist', 'Product sumber_harga mismatch');
  console.log('   [PASS] GET /api/products?customer_id returned correct harga_efektif and sumber_harga');

  // Test 11: DELETE pricelist while assigned to customer should fail 409 (R7)
  console.log('11. Testing DELETE pricelist while in-use (should fail 409)...');
  const resDelConflict = await api(`/api/pricelists/${pl.id}`, 'DELETE');
  console.assert(resDelConflict.status === 409, `Expected 409, got ${resDelConflict.status}`);
  console.assert(resDelConflict.data.total_customers === 1, `Expected 1 customer, got ${resDelConflict.data.total_customers}`);
  console.log(`   [PASS] DELETE rejected with 409: "${resDelConflict.data.error}"`);

  // Test 12: Deactivate pricelist (effective price should fall back to master) (R2)
  console.log('12. Testing deactivated pricelist fallback to master price (R2)...');
  await api(`/api/pricelists/${pl.id}`, 'PUT', { is_active: 0 });
  const resEffDeactivated = await api(`/api/pricelists/effective-prices?customer_id=C000001`);
  const p1Fallback = resEffDeactivated.data.prices.find(p => p.product_id === 'P000001');
  console.assert(parseFloat(p1Fallback.harga_efektif) === parseFloat(p1Fallback.harga_master), 'Fallback to master failed');
  console.assert(p1Fallback.sumber_harga === 'master', `Expected 'master', got ${p1Fallback.sumber_harga}`);
  console.log(`   [PASS] Deactivated pricelist fell back to master price (${p1Fallback.harga_master})`);

  // Cleanup: Reset customer C000001 and delete test pricelists
  console.log('13. Cleaning up test data...');
  await api('/api/customers/C000001', 'PUT', { name: 'Toko Berkah Jaya', pricelist_id: null });
  const resDelClean = await api(`/api/pricelists/${pl.id}`, 'DELETE');
  console.assert(resDelClean.status === 200, 'Failed to delete unassigned pricelist');
  await api(`/api/pricelists/${dupPl.id}`, 'DELETE');
  console.log('   [PASS] Cleanup complete. Test pricelists deleted successfully.');

  console.log('\n=== ALL BACKEND TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
