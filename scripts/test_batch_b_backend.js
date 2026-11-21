const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const TEST_PORT = 3007;
const SECRET_KEY = 'supplierpro_secret_key_demo';
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;
let db = null;
const results = [];

function pass(name, details = '') {
  results.push({ name, status: 'PASS', details });
  console.log(`[PASS] ${name} ${details ? '(' + details + ')' : ''}`);
}

function fail(name, err) {
  results.push({ name, status: 'FAIL', details: err.message || String(err) });
  console.error(`[FAIL] ${name}:`, err.message || err);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    SECRET_KEY,
    { expiresIn: '1h' }
  );
}

function request(method, urlPath, token, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      { method, headers },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/settings`, (res) => resolve(res));
        req.on('error', reject);
      });
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  throw new Error(`Server failed to start on port ${port} within timeout`);
}

async function runTests() {
  console.log('=== STARTING BATCH B BACKEND TEST SUITE (CLONE DB) ===\n');

  // Connect to clone DB
  db = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'supplierpro_clone'
  });

  // Start server with clone DB env
  const serverPath = path.join(__dirname, '..', 'server.js');
  serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DATABASE_URL: 'mysql://root:@localhost:3306/supplierpro_clone'
    },
    stdio: 'pipe'
  });

  serverProcess.stderr.on('data', (d) => {
    // console.error('[Server Err]:', d.toString());
  });

  await waitForServer(TEST_PORT);
  console.log(`Test server running on port ${TEST_PORT} connected to supplierpro_clone.\n`);

  const adminToken = generateToken({ id: 1, username: 'admin', role: 'admin', name: 'Admin Test' });
  const kasirToken = generateToken({ id: 2, username: 'kasir', role: 'kasir', name: 'Kasir Test' });
  const gudangToken = generateToken({ id: 3, username: 'gudang', role: 'gudang', name: 'Gudang Test' });
  const financeToken = generateToken({ id: 4, username: 'finance', role: 'finance', name: 'Finance Test' });

  // -------------------------------------------------------------------------
  // TEST GROUP 1: B0 - Fondasi Stock Moves & Helper
  // -------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: B0 Stock Moves & Helper ---');

  // 1.1 Create product with stock
  const testProdId = 'P-TEST-B0-' + Date.now();
  const createProdRes = await request('POST', '/api/products', adminToken, {
    id: testProdId,
    sku: 'SKU-B0-01',
    name: 'Produk Uji B0',
    category_id: 'PC-1',
    unit_id: 'PU-1',
    cost_price: 10000,
    sell_price: 15000,
    stock: 50,
    min_stock: 5
  });

  if (createProdRes.status === 200) {
    const [sm] = await db.query('SELECT * FROM stock_moves WHERE product_id = ? AND tipe = "stok_awal"', [testProdId]);
    if (sm.length > 0 && parseFloat(sm[0].qty_masuk) === 50 && parseFloat(sm[0].qty_sesudah) === 50) {
      pass('B0.1: Tambah produk dengan stok awal mencatat stock_moves stok_awal', `qty: ${sm[0].qty_masuk}`);
    } else {
      fail('B0.1', new Error('stock_moves tidak tercatat dengan benar'));
    }
  } else {
    fail('B0.1: Create product', new Error(JSON.stringify(createProdRes.body)));
  }

  // 1.2 Direct edit product stock
  const editProdRes = await request('PUT', `/api/products/${testProdId}`, adminToken, {
    sku: 'SKU-B0-01',
    name: 'Produk Uji B0 (Edited)',
    category_id: 'PC-1',
    unit_id: 'PU-1',
    cost_price: 10000,
    sell_price: 15000,
    stock: 60,
    min_stock: 5
  });
  if (editProdRes.status === 200) {
    const [smEdit] = await db.query('SELECT * FROM stock_moves WHERE product_id = ? AND tipe = "koreksi_edit" ORDER BY id DESC LIMIT 1', [testProdId]);
    if (smEdit.length > 0 && parseFloat(smEdit[0].qty_masuk) === 10 && parseFloat(smEdit[0].qty_sesudah) === 60) {
      pass('B0.2: Edit produk manual ubah stok mencatat stock_moves koreksi_edit', `diff: +10, sesudah: 60`);
    } else {
      fail('B0.2', new Error('stock_moves koreksi_edit tidak sesuai'));
    }
  } else {
    fail('B0.2: Edit product', new Error(JSON.stringify(editProdRes.body)));
  }

  // 1.3 Opname via /api/stock-adjust
  const opnameRes = await request('POST', '/api/stock-adjust', adminToken, {
    product_id: testProdId,
    actual_stock: 55,
    note: 'Opname Uji'
  });
  if (opnameRes.status === 200) {
    const [smOpname] = await db.query('SELECT * FROM stock_moves WHERE product_id = ? AND tipe = "opname" ORDER BY id DESC LIMIT 1', [testProdId]);
    if (smOpname.length > 0 && parseFloat(smOpname[0].qty_keluar) === 5 && parseFloat(smOpname[0].qty_sesudah) === 55) {
      pass('B0.3: Stock opname mencatat stock_moves opname', `keluar: 5, sesudah: 55`);
    } else {
      fail('B0.3', new Error('stock_moves opname tidak sesuai'));
    }
  } else {
    fail('B0.3: Opname', new Error(JSON.stringify(opnameRes.body)));
  }

  // 1.4 Purchase Order stock move
  const poRes = await request('POST', '/api/purchases', adminToken, {
    vendor_id: 'V000001',
    date: '2026-11-21',
    payment_type_id: 'PT-1',
    paid_amount: 100000,
    items: [
      { product_id: testProdId, quantity: 20, cost: 11000 }
    ]
  });
  if (poRes.status === 200 && poRes.body.id) {
    const poId = poRes.body.id;
    const [smPo] = await db.query('SELECT * FROM stock_moves WHERE product_id = ? AND tipe = "pembelian" AND ref_id = ?', [testProdId, poId]);
    if (smPo.length > 0 && parseFloat(smPo[0].qty_masuk) === 20 && parseFloat(smPo[0].qty_sesudah) === 75) {
      pass('B0.4: Buat PO mencatat stock_moves pembelian', `qty_masuk: 20, sesudah: 75`);
    } else {
      fail('B0.4', new Error('stock_moves pembelian tidak sesuai'));
    }
  } else {
    fail('B0.4: Buat PO', new Error(JSON.stringify(poRes.body)));
  }

  // 1.5 Invoice creation stock move
  const invRes = await request('POST', '/api/invoices', kasirToken, {
    customer_id: 'C000001',
    date: '2026-11-21',
    payment_type_id: 'PT-1',
    items: [
      { id: testProdId, quantity: 15, price: 15000 }
    ]
  });
  let createdInvoiceId = null;
  if (invRes.status === 200) {
    createdInvoiceId = invRes.body.invoiceId;
    const [smInv] = await db.query('SELECT * FROM stock_moves WHERE product_id = ? AND tipe = "penjualan" AND ref_id = ?', [testProdId, createdInvoiceId]);
    if (smInv.length > 0 && parseFloat(smInv[0].qty_keluar) === 15 && parseFloat(smInv[0].qty_sesudah) === 60) {
      pass('B0.5: Buat invoice POS mencatat stock_moves penjualan', `qty_keluar: 15, sesudah: 60`);
    } else {
      fail('B0.5', new Error('stock_moves penjualan tidak sesuai'));
    }
  } else {
    fail('B0.5: Buat invoice', new Error(JSON.stringify(invRes.body)));
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 2: B1 - Retur Penjualan
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: B1 Retur Penjualan ---');

  // Create dedicated invoice for retur testing with Kredit (belum lunas)
  const invReturRes = await request('POST', '/api/invoices', kasirToken, {
    customer_id: 'C000001',
    date: '2026-11-21',
    payment_type_id: 'PT-7', // Kredit 30 Hari
    paid: 0,
    items: [
      { id: testProdId, quantity: 10, price: 15000 }
    ]
  });
  const invForReturId = invReturRes.body.invoiceId;

  // 2.1 Return "kembali_ke_stok"
  const curStockBeforeReturRes = await db.query('SELECT stock FROM products WHERE id = ?', [testProdId]);
  const stockBeforeRetur = parseFloat(curStockBeforeReturRes[0][0].stock);

  const retur1Res = await request('POST', `/api/invoices/${invForReturId}/returns`, kasirToken, {
    date: '2026-11-21',
    reason: 'Barang tidak sesuai spesifikasi',
    items: [
      { product_id: testProdId, quantity: 3, condition_type: 'kembali_ke_stok' }
    ]
  });

  if (retur1Res.status === 200 && retur1Res.body.success) {
    const returnId = retur1Res.body.return_id;
    const [curStockAfter] = await db.query('SELECT stock FROM products WHERE id = ?', [testProdId]);
    const stockAfter = parseFloat(curStockAfter[0].stock);
    const [smRetur] = await db.query('SELECT * FROM stock_moves WHERE ref_id = ? AND tipe = "retur_penjualan"', [returnId]);
    const [invAfter] = await db.query('SELECT total, paid_amount, return_amount FROM sales_invoices WHERE id = ?', [invForReturId]);

    const stockExpected = stockBeforeRetur + 3;
    if (stockAfter === stockExpected && smRetur.length > 0 && parseFloat(smRetur[0].qty_masuk) === 3) {
      pass('B1.1: Retur penjualan kembali ke stok menambah stok dan mencatat stock_moves retur_penjualan', `stok: ${stockBeforeRetur} -> ${stockAfter}`);
    } else {
      fail('B1.1', new Error(`Stock mismatch: expected ${stockExpected}, got ${stockAfter}`));
    }

    if (parseFloat(invAfter[0].return_amount) > 0) {
      pass('B1.2: Retur penjualan memotong piutang (return_amount terisi tanpa mengubah total invoice)', `return_amount: ${invAfter[0].return_amount}`);
    } else {
      fail('B1.2', new Error('return_amount pada invoice tidak terupdate'));
    }
  } else {
    fail('B1.1: Retur penjualan', new Error(JSON.stringify(retur1Res.body)));
  }

  // 2.2 Return "rusak"
  const curStockBeforeRusakRes = await db.query('SELECT stock FROM products WHERE id = ?', [testProdId]);
  const stockBeforeRusak = parseFloat(curStockBeforeRusakRes[0][0].stock);

  const retur2Res = await request('POST', `/api/invoices/${invForReturId}/returns`, kasirToken, {
    date: '2026-11-21',
    reason: 'Barang pecah saat pengiriman',
    items: [
      { product_id: testProdId, quantity: 2, condition_type: 'rusak' }
    ]
  });

  if (retur2Res.status === 200 && retur2Res.body.success) {
    const returnId2 = retur2Res.body.return_id;
    const [curStockAfterRusak] = await db.query('SELECT stock FROM products WHERE id = ?', [testProdId]);
    const stockAfterRusak = parseFloat(curStockAfterRusak[0].stock);
    const [smRusak] = await db.query('SELECT * FROM stock_moves WHERE ref_id = ? AND tipe = "retur_penjualan_rusak"', [returnId2]);

    if (stockAfterRusak === stockBeforeRusak && smRusak.length > 0 && parseFloat(smRusak[0].qty_masuk) === 0) {
      pass('B1.3: Retur penjualan rusak TIDAK menambah stok dan mencatat stock_moves retur_penjualan_rusak (qty 0)', `stok tetap: ${stockAfterRusak}`);
    } else {
      fail('B1.3', new Error(`Stock changed unexpectedly: before ${stockBeforeRusak}, after ${stockAfterRusak}`));
    }
  } else {
    fail('B1.3: Retur rusak', new Error(JSON.stringify(retur2Res.body)));
  }

  // 2.3 Validation: cannot return more than remaining qty
  const returExcessRes = await request('POST', `/api/invoices/${invForReturId}/returns`, kasirToken, {
    date: '2026-11-21',
    reason: 'Melebihi kuota',
    items: [
      { product_id: testProdId, quantity: 10, condition_type: 'kembali_ke_stok' } // original 10, already returned 3+2=5, max 5
    ]
  });
  if (returExcessRes.status === 400) {
    pass('B1.4: Validasi retur tolak permintaan melebihi sisa yang bisa diretur (HTTP 400)', returExcessRes.body.error);
  } else {
    fail('B1.4', new Error('Validasi kuota retur tidak menolak permintaan berlebih'));
  }

  // 2.4 Return excess to customer deposit (Lunas invoice)
  // Create cash invoice (fully paid)
  const lunasInvRes = await request('POST', '/api/invoices', kasirToken, {
    customer_id: 'C000001',
    date: '2026-11-21',
    payment_type_id: 'PT-1', // Tunai
    items: [
      { id: testProdId, quantity: 2, price: 15000 }
    ]
  });
  const lunasInvId = lunasInvRes.body.invoiceId;
  const [custBefore] = await db.query('SELECT deposit FROM customers WHERE id = "C000001"');
  const depositBefore = parseFloat(custBefore[0].deposit || 0);

  const returLunasRes = await request('POST', `/api/invoices/${lunasInvId}/returns`, kasirToken, {
    date: '2026-11-21',
    reason: 'Kelebihan beli pada invoice lunas',
    items: [
      { product_id: testProdId, quantity: 1, condition_type: 'kembali_ke_stok' }
    ]
  });
  if (returLunasRes.status === 200) {
    const [custAfter] = await db.query('SELECT deposit FROM customers WHERE id = "C000001"');
    const depositAfter = parseFloat(custAfter[0].deposit || 0);
    if (depositAfter > depositBefore) {
      pass('B1.5: Retur pada invoice lunas masuk ke deposit pelanggan', `deposit: ${depositBefore} -> ${depositAfter}`);
    } else {
      fail('B1.5', new Error('Deposit pelanggan tidak bertambah'));
    }
  } else {
    fail('B1.5: Retur invoice lunas', new Error(JSON.stringify(returLunasRes.body)));
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 3: B2 - Retur Pembelian
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: B2 Retur Pembelian ---');

  // Create PO with kredit (belum lunas)
  const poReturRes = await request('POST', '/api/purchases', adminToken, {
    vendor_id: 'V000001',
    date: '2026-11-21',
    payment_type_id: 'PT-7',
    paid_amount: 0,
    items: [
      { product_id: testProdId, quantity: 10, cost: 10000 }
    ]
  });
  const poForReturId = poReturRes.body.id;

  const [stockBeforePoReturRes] = await db.query('SELECT stock FROM products WHERE id = ?', [testProdId]);
  const stockBeforePoRetur = parseFloat(stockBeforePoReturRes[0].stock);

  const poRetur1Res = await request('POST', `/api/purchases/${poForReturId}/returns`, adminToken, {
    date: '2026-11-21',
    reason: 'Salah barang dari vendor',
    items: [
      { product_id: testProdId, quantity: 4 }
    ]
  });

  if (poRetur1Res.status === 200 && poRetur1Res.body.success) {
    const returnId = poRetur1Res.body.return_id;
    const [stockAfterPoReturRes] = await db.query('SELECT stock FROM products WHERE id = ?', [testProdId]);
    const stockAfterPoRetur = parseFloat(stockAfterPoReturRes[0].stock);
    const [smPoRetur] = await db.query('SELECT * FROM stock_moves WHERE ref_id = ? AND tipe = "retur_pembelian"', [returnId]);
    const [poAfter] = await db.query('SELECT return_amount, paid_amount, total FROM purchase_orders WHERE id = ?', [poForReturId]);

    if (stockAfterPoRetur === (stockBeforePoRetur - 4) && smPoRetur.length > 0 && parseFloat(smPoRetur[0].qty_keluar) === 4) {
      pass('B2.1: Retur pembelian mengurangi stok dan mencatat stock_moves retur_pembelian', `stok: ${stockBeforePoRetur} -> ${stockAfterPoRetur}`);
    } else {
      fail('B2.1', new Error(`Stock mismatch: expected ${stockBeforePoRetur - 4}, got ${stockAfterPoRetur}`));
    }

    if (parseFloat(poAfter[0].return_amount) > 0) {
      pass('B2.2: Retur pembelian memotong hutang (return_amount terisi tanpa ubah total PO)', `return_amount: ${poAfter[0].return_amount}`);
    } else {
      fail('B2.2', new Error('return_amount pada PO tidak terisi'));
    }
  } else {
    fail('B2.1: Retur pembelian', new Error(JSON.stringify(poRetur1Res.body)));
  }

  // 3.2 Validation: stock sufficiency before purchase return
  // Attempt to return more than available product stock
  const [curStockP] = await db.query('SELECT stock FROM products WHERE id = ?', [testProdId]);
  const currentActualStock = parseFloat(curStockP[0].stock);
  // Reduce stock in DB to 1 temporarily to trigger stock insufficient error
  await db.query('UPDATE products SET stock = 1 WHERE id = ?', [testProdId]);

  const poReturStockFailRes = await request('POST', `/api/purchases/${poForReturId}/returns`, adminToken, {
    date: '2026-11-21',
    reason: 'Uji stok tidak cukup',
    items: [
      { product_id: testProdId, quantity: 2 } // needs 2, stock is 1
    ]
  });

  if (poReturStockFailRes.status === 400 && poReturStockFailRes.body.error.includes('tidak mencukupi')) {
    pass('B2.3: Validasi retur pembelian tolak transaksi jika stok produk tidak mencukupi (HTTP 400)', poReturStockFailRes.body.error);
  } else {
    fail('B2.3', new Error('Retur pembelian tidak memvalidasi kecukupan stok'));
  }
  // Restore stock
  await db.query('UPDATE products SET stock = ? WHERE id = ?', [currentActualStock, testProdId]);

  // -------------------------------------------------------------------------
  // TEST GROUP 4: B3 - Soft-Lock pada Edit Invoice dan Edit PO
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: B3 Soft-Lock ---');

  // 4.1 Edit invoice: non-admin (kasir) reduces qty -> rejected 403
  const editInvKasirFailRes = await request('PUT', `/api/invoices/${createdInvoiceId}`, kasirToken, {
    date: '2026-11-21',
    customer_id: 'C000001',
    items: [
      { product_id: testProdId, quantity: 5, price: 15000 } // originally 15, reducing to 5
    ]
  });
  if (editInvKasirFailRes.status === 403 && editInvKasirFailRes.body.error.includes('Retur Penjualan')) {
    pass('B3.1: Soft-lock tolak non-admin mengurangi qty invoice (HTTP 403)', editInvKasirFailRes.body.error);
  } else {
    fail('B3.1', new Error(`Expected 403, got ${editInvKasirFailRes.status}: ${JSON.stringify(editInvKasirFailRes.body)}`));
  }

  // 4.2 Edit invoice: admin reduces qty WITHOUT reason -> rejected 400
  const editInvAdminNoReasonRes = await request('PUT', `/api/invoices/${createdInvoiceId}`, adminToken, {
    date: '2026-11-21',
    customer_id: 'C000001',
    items: [
      { product_id: testProdId, quantity: 5, price: 15000 }
    ]
  });
  if (editInvAdminNoReasonRes.status === 400 && editInvAdminNoReasonRes.body.error.includes('alasan')) {
    pass('B3.2: Soft-lock admin tolak koreksi salah input jika tanpa alasan (HTTP 400)', editInvAdminNoReasonRes.body.error);
  } else {
    fail('B3.2', new Error('Admin tanpa alasan tidak ditolak'));
  }

  // 4.3 Edit invoice: admin reduces qty WITH reason -> allowed & records koreksi_edit
  const editInvAdminSuccessRes = await request('PUT', `/api/invoices/${createdInvoiceId}`, adminToken, {
    date: '2026-11-21',
    customer_id: 'C000001',
    correction_reason: 'Salah ketik qty saat checkout',
    items: [
      { product_id: testProdId, quantity: 10, price: 15000 } // was 15, reduce by 5
    ]
  });
  if (editInvAdminSuccessRes.status === 200) {
    const [smKoreksi] = await db.query('SELECT * FROM stock_moves WHERE ref_id = ? AND tipe = "koreksi_edit" ORDER BY id DESC LIMIT 1', [createdInvoiceId]);
    if (smKoreksi.length > 0 && parseFloat(smKoreksi[0].qty_masuk) === 5) {
      pass('B3.3: Soft-lock admin dengan alasan diizinkan dan mencatat stock_moves koreksi_edit', `qty_masuk: 5, keterangan: ${smKoreksi[0].keterangan}`);
    } else {
      fail('B3.3', new Error('Koreksi edit stock move tidak sesuai'));
    }
  } else {
    fail('B3.3: Edit invoice admin', new Error(JSON.stringify(editInvAdminSuccessRes.body)));
  }

  // 4.4 Edit PO: non-admin (gudang) reduces qty -> rejected 403
  const editPoGudangFailRes = await request('PUT', `/api/purchases/${poForReturId}`, gudangToken, {
    vendor_id: 'V000001',
    date: '2026-11-21',
    payment_type_id: 'PT-7',
    items: [
      { product_id: testProdId, quantity: 2, cost: 10000 } // reduced
    ]
  });
  if (editPoGudangFailRes.status === 403 && editPoGudangFailRes.body.error.includes('Retur Pembelian')) {
    pass('B3.4: Soft-lock tolak non-admin mengurangi qty PO (HTTP 403)', editPoGudangFailRes.body.error);
  } else {
    fail('B3.4', new Error(`Expected 403, got ${editPoGudangFailRes.status}`));
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 5: B4 - Stock Move & Retur Lists API + Sanitasi Data Keuangan
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: B4 Stock Move & Sanitasi ---');

  // 5.1 GET /api/stock-moves as gudang
  const smGudangRes = await request('GET', '/api/stock-moves?limit=10', gudangToken);
  if (smGudangRes.status === 200 && Array.isArray(smGudangRes.body.data)) {
    const data = smGudangRes.body.data;
    // Check fields in first row
    const firstRow = data[0] || {};
    const hasRequired = ('tanggal' in firstRow) && ('productId' in firstRow) && ('qtyMasuk' in firstRow) && ('stokSesudah' in firstRow);

    // CRITICAL: Check absence of any financial fields
    const forbiddenKeys = ['cost', 'price', 'hpp', 'total', 'amount', 'subtotal', 'cash', 'nominal', 'total_refund', 'harga'];
    const keysPresent = Object.keys(firstRow).filter(k => forbiddenKeys.some(f => k.toLowerCase().includes(f)));

    if (hasRequired && keysPresent.length === 0) {
      pass('B4.1: GET /api/stock-moves untuk gudang berhasil dan TER-SANITASI BERSIH (tanpa data keuangan)', `rows: ${data.length}`);
    } else {
      fail('B4.1', new Error(`Data contains forbidden financial keys: ${keysPresent.join(', ')}`));
    }
  } else {
    fail('B4.1: Stock moves gudang', new Error(JSON.stringify(smGudangRes.body)));
  }

  // 5.2 GET /api/returns/sales sanitasi
  const srKasirRes = await request('GET', '/api/returns/sales?limit=10', kasirToken);
  const srFinanceRes = await request('GET', '/api/returns/sales?limit=10', financeToken);

  if (srKasirRes.status === 200 && srFinanceRes.status === 200) {
    const kasirRow = srKasirRes.body.data[0] || {};
    const financeRow = srFinanceRes.body.data[0] || {};

    const kasirHasFinance = ('total_refund' in kasirRow) || ('piutang_deduction' in kasirRow);
    const financeHasFinance = ('total_refund' in financeRow) && ('piutang_deduction' in financeRow);

    if (!kasirHasFinance && financeHasFinance) {
      pass('B4.2: GET /api/returns/sales ter-sanitasi di backend (kasir tidak menerima total_refund, finance menerima)', `finance total_refund: ${financeRow.total_refund}`);
    } else {
      fail('B4.2', new Error(`Sanitization failed: kasirHasFinance=${kasirHasFinance}, financeHasFinance=${financeHasFinance}`));
    }
  } else {
    fail('B4.2: Returns sales', new Error('API request failed'));
  }

  // 5.3 GET /api/returns/purchases sanitasi
  const prGudangRes = await request('GET', '/api/returns/purchases?limit=10', gudangToken);
  const prFinanceRes = await request('GET', '/api/returns/purchases?limit=10', financeToken);

  if (prGudangRes.status === 200 && prFinanceRes.status === 200) {
    const gudangRow = prGudangRes.body.data[0] || {};
    const financeRow = prFinanceRes.body.data[0] || {};

    const gudangHasFinance = ('total_refund' in gudangRow) || ('hutang_deduction' in gudangRow);
    const financeHasFinance = ('total_refund' in financeRow) && ('hutang_deduction' in financeRow);

    if (!gudangHasFinance && financeHasFinance) {
      pass('B4.3: GET /api/returns/purchases ter-sanitasi di backend (gudang tidak menerima total_refund, finance menerima)', `finance total_refund: ${financeRow.total_refund}`);
    } else {
      fail('B4.3', new Error(`Sanitization failed: gudangHasFinance=${gudangHasFinance}, financeHasFinance=${financeHasFinance}`));
    }
  } else {
    fail('B4.3: Returns purchases', new Error('API request failed'));
  }

  console.log('\n=== TEST SUMMARY ===');
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  console.log(`TOTAL: ${results.length} | PASS: ${passCount} | FAIL: ${failCount}`);

  // Cleanup
  if (serverProcess) {
    serverProcess.kill();
  }
  if (db) {
    await db.end();
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(async (err) => {
  console.error('Test suite uncaught error:', err);
  if (serverProcess) serverProcess.kill();
  if (db) await db.end();
  process.exit(1);
});
