/**
 * Comprehensive Verification Script for Spec 25-nov-spec-laporan-penjualan-laba.md
 * Runs ALL migrations, backfill, and Section 7 scenarios (1..13 + PO HPP reversal + HPP role checks)
 * strictly against an isolated CLONED database (`supplierpro_clone`), never production!
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const TEST_PORT = 5025;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';

const SRC_DB_URL = process.env.DATABASE_URL
  || `mysql://${process.env.DB_USER || 'root'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'supplierpro'}`;

const parsedSrc = new URL(SRC_DB_URL);
const SRC_DB_NAME = parsedSrc.pathname.replace('/', '');
const CLONE_DB_NAME = `${SRC_DB_NAME}_clone`;
const CLONE_DB_URL = `${parsedSrc.protocol}//${parsedSrc.username}:${parsedSrc.password}@${parsedSrc.host}/${CLONE_DB_NAME}`;

const tokens = {
  admin: jwt.sign({ id: 1, username: 'superadmin', role: 'admin', name: 'Super Admin' }, JWT_SECRET, { expiresIn: '2h' }),
  finance: jwt.sign({ id: 3, username: 'finance', role: 'finance', name: 'Finance' }, JWT_SECRET, { expiresIn: '2h' }),
  gudang: jwt.sign({ id: 4, username: 'gudang', role: 'gudang', name: 'Gudang' }, JWT_SECRET, { expiresIn: '2h' }),
  kasir: jwt.sign({ id: 5, username: 'kasir', role: 'kasir', name: 'Kasir' }, JWT_SECRET, { expiresIn: '2h' })
};

let serverProc = null;
const results = [];

function record(scenario, name, pass, detail = '') {
  results.push({ scenario, name, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] (${scenario}) ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(method, urlPath, token, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${urlPath}`, opts);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/pdf')) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, pdfBuf: buf };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, body: json, raw: text };
}

async function cloneDatabase() {
  console.log(`\n1. Cloning ${SRC_DB_NAME} -> ${CLONE_DB_NAME}...`);
  const adminConn = await mysql.createConnection({
    host: parsedSrc.hostname,
    port: parseInt(parsedSrc.port, 10) || 3306,
    user: parsedSrc.username,
    password: parsedSrc.password,
    multipleStatements: true
  });

  await adminConn.query(`DROP DATABASE IF EXISTS \`${CLONE_DB_NAME}\``);
  await adminConn.query(`CREATE DATABASE \`${CLONE_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  const [tables] = await adminConn.query(`SHOW TABLES FROM \`${SRC_DB_NAME}\``);
  await adminConn.query(`USE \`${CLONE_DB_NAME}\``);
  await adminConn.query('SET FOREIGN_KEY_CHECKS = 0');

  for (const t of tables) {
    const tbl = Object.values(t)[0];
    const [cr] = await adminConn.query(`SHOW CREATE TABLE \`${SRC_DB_NAME}\`.\`${tbl}\``);
    let createSql = cr[0]['Create Table'];
    await adminConn.query(createSql);
    await adminConn.query(`INSERT INTO \`${CLONE_DB_NAME}\`.\`${tbl}\` SELECT * FROM \`${SRC_DB_NAME}\`.\`${tbl}\``);
  }

  await adminConn.query('SET FOREIGN_KEY_CHECKS = 1');
  await adminConn.end();
  console.log(`   Cloned ${tables.length} tables into ${CLONE_DB_NAME}.`);
}

async function runMigrationsAndBackfill(db) {
  console.log('\n2. Running SQL migration & backfill (twice each to verify idempotency)...');
  const migSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migration_laporan_penjualan_hpp.sql'), 'utf8');
  const bfSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'backfill_hpp_satuan.sql'), 'utf8');

  await db.query(migSql);
  await db.query(migSql); // 2nd run idempotent
  const [cols] = await db.query("SHOW COLUMNS FROM invoice_items WHERE Field IN ('hpp_satuan', 'hpp_estimasi')");
  record('Migrasi', 'Kolom hpp_satuan & hpp_estimasi ada (idempotent 2x)', cols.length === 2, `cols=${cols.map(c => c.Field).join(',')}`);

  const [res1] = await db.query(bfSql);
  const sum1 = res1[res1.length - 1][0];
  // Verify running backfill again does not overwrite hpp_estimasi = 0 rows
  await db.query("UPDATE invoice_items SET hpp_satuan = 99999 WHERE hpp_estimasi = 0 LIMIT 1");
  const [res2] = await db.query(bfSql);
  const [chk] = await db.query("SELECT COUNT(*) AS cnt FROM invoice_items WHERE hpp_satuan = 99999 AND hpp_estimasi = 0");
  record('Backfill', 'Backfill idempotent & tidak menimpa hpp_estimasi=0', Number(chk[0].cnt) === 1,
    `total=${sum1.total_item_invoice}, asli=${sum1.jumlah_snapshot_asli}, estimasi=${sum1.jumlah_baris_estimasi_backfill}, hpp_nol=${sum1.jumlah_hpp_nol}`);
  // Restore clean clone by re-running backfill after resetting test row? Better: restore that row from cost_price_snapshot!
  await db.query("UPDATE invoice_items SET hpp_satuan = ROUND(cost_price_snapshot, 2) WHERE hpp_satuan = 99999");
}

async function startServer() {
  console.log(`\n3. Starting test server on port ${TEST_PORT} (${CLONE_DB_NAME})...`);
  serverProc = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DATABASE_URL: CLONE_DB_URL,
      DB_NAME: CLONE_DB_NAME,
      JWT_SECRET
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stderr.on('data', d => {
    const s = d.toString().trim();
    if (s && !s.includes('ExperimentalWarning')) console.error('[Server stderr]', s);
  });

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const r = await fetch(`${BASE_URL}/api/health`);
      if (r.ok) {
        console.log('   Test server is ready.');
        return;
      }
    } catch (_) {}
  }
  throw new Error('Test server failed to start');
}

function approx(a, b, eps = 0.05) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

async function main() {
  let db;
  try {
    await cloneDatabase();
    db = await mysql.createConnection({
      host: parsedSrc.hostname,
      port: parseInt(parsedSrc.port, 10) || 3306,
      user: parsedSrc.username,
      password: parsedSrc.password,
      database: CLONE_DB_NAME,
      multipleStatements: true,
      dateStrings: true
    });

    await runMigrationsAndBackfill(db);
    await startServer();

    // Ensure PPN enabled = true, pajak_default = 11 in clone, and clean isolated test months 2023-06 & 2023-07
    await db.query("UPDATE settings SET value = 'true' WHERE `key` = 'ppn_enabled'");
    await db.query("UPDATE settings SET value = '11' WHERE `key` = 'pajak_default'");
    await db.query("DELETE sri FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id WHERE sr.date BETWEEN '2023-06-01' AND '2023-07-31'");
    await db.query("DELETE FROM sales_returns WHERE date BETWEEN '2023-06-01' AND '2023-07-31'");
    await db.query("DELETE sip FROM sales_invoice_payments sip JOIN sales_invoices si ON si.id = sip.invoice_id WHERE si.date BETWEEN '2023-06-01' AND '2023-07-31'");
    await db.query("DELETE FROM cash_transactions WHERE date BETWEEN '2023-06-01' AND '2023-07-31'");
    await db.query("DELETE FROM sales_invoices WHERE date BETWEEN '2023-06-01' AND '2023-07-31'");
    await db.query("DELETE FROM purchase_orders WHERE date BETWEEN '2023-06-01' AND '2023-07-31'");

    // Setup test master records
    await db.query("INSERT IGNORE INTO product_categories (id, name) VALUES ('CAT-UJI', 'Kategori Uji')");
    await db.query("INSERT IGNORE INTO product_units (id, name) VALUES ('UNIT-UJI', 'Pcs')");
    await db.query(`INSERT INTO products (id, sku, name, category_id, cost_price, sell_price, stock, min_stock, unit_id, is_active)
      VALUES ('P-UJI-1', 'SKU-UJI-1', 'Produk Uji Laba 1', 'CAT-UJI', 0, 1500, 0, 1, 'UNIT-UJI', 1)
      ON DUPLICATE KEY UPDATE cost_price=0, sell_price=1500, stock=0`);
    await db.query(`INSERT INTO products (id, sku, name, category_id, cost_price, sell_price, stock, min_stock, unit_id, is_active)
      VALUES ('P-UJI-2', 'SKU-UJI-2', 'Produk Uji Laba 2', 'CAT-UJI', 500, 2000, 50, 1, 'UNIT-UJI', 1)
      ON DUPLICATE KEY UPDATE cost_price=500, sell_price=2000, stock=50`);
    await db.query(`INSERT INTO products (id, sku, name, category_id, cost_price, sell_price, stock, min_stock, unit_id, is_active)
      VALUES ('P-UJI-PO', 'SKU-UJI-PO', 'Produk Uji PO Reversal', 'CAT-UJI', 1000, 2000, 10, 1, 'UNIT-UJI', 1)
      ON DUPLICATE KEY UPDATE cost_price=1000, sell_price=2000, stock=10`);

    await db.query("INSERT IGNORE INTO customer_categories (id, name) VALUES ('CC-UJI', 'Umum')");
    await db.query(`INSERT INTO customers (id, name, customer_category_id, phone) VALUES ('C-UJI-1', 'Customer Uji Satu', 'CC-UJI', '08111')
      ON DUPLICATE KEY UPDATE name='Customer Uji Satu'`);
    await db.query(`INSERT INTO customers (id, name, customer_category_id, phone) VALUES ('C-UJI-2', 'Customer Uji Dua', 'CC-UJI', '08222')
      ON DUPLICATE KEY UPDATE name='Customer Uji Dua'`);
    await db.query("INSERT IGNORE INTO vendor_categories (id, name) VALUES ('VC-UJI', 'Supplier')");
    await db.query(`INSERT INTO vendors (id, name, vendor_category_id) VALUES ('V-UJI-1', 'Vendor Uji', 'VC-UJI')
      ON DUPLICATE KEY UPDATE name='Vendor Uji'`);

    console.log('\n4. Running Section 7 Scenarios...');

    // --- SKENARIO 1: Dasar ---
    // Buy 10 @ 1000 via PO (as gudang to verify gudang CAN create PO!)
    const po1 = await api('POST', '/api/purchases', tokens.gudang, {
      vendor_id: 'V-UJI-1', date: '2023-06-01', payment_type_id: 'PT-1',
      items: [{ product_id: 'P-UJI-1', quantity: 10, cost: 1000 }]
    });
    const inv1 = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-1', date: '2023-06-10', payment_type_id: 'PT-1',
      items: [{ id: 'P-UJI-1', quantity: 4, price: 1500 }]
    });
    const s1 = await api('GET', '/api/laporan/penjualan/ringkasan?from=2023-06-01&to=2023-06-12', tokens.admin);
    record('Skenario 1', 'Dasar: 4 x 1.500 (HPP 1.000) -> Penj 6.000, HPP 4.000, Laba 2.000, Margin 33.3%',
      po1.status === 200 && inv1.status === 200 &&
      approx(s1.body?.data?.penjualan_bersih, 6000) &&
      approx(s1.body?.data?.hpp, 4000) &&
      approx(s1.body?.data?.laba_kotor, 2000) &&
      approx(s1.body?.data?.margin_pct, 33.33, 0.1),
      `actual: penj=${s1.body?.data?.penjualan_bersih}, hpp=${s1.body?.data?.hpp}, laba=${s1.body?.data?.laba_kotor}, margin=${s1.body?.data?.margin_pct?.toFixed(2)}%`);

    // --- SKENARIO 2: HPP Berubah (snapshot lama tetap, baru ikut rata-rata baru) ---
    // Remaining stock of P-UJI-1 is 6 @ 1000. Buy 10 @ 1200 -> new cost = (6*1000 + 10*1200)/16 = 1125
    await api('POST', '/api/purchases', tokens.admin, {
      vendor_id: 'V-UJI-1', date: '2023-06-11', payment_type_id: 'PT-1',
      items: [{ product_id: 'P-UJI-1', quantity: 10, cost: 1200 }]
    });
    const inv2 = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-2', date: '2023-06-12', payment_type_id: 'PT-2',
      items: [{ id: 'P-UJI-1', quantity: 2, price: 1500 }]
    });
    const [iiCheck] = await db.query("SELECT invoice_id, hpp_satuan FROM invoice_items WHERE invoice_id IN (?, ?)", [inv1.body.invoiceId, inv2.body.invoiceId]);
    const hpp1 = Number(iiCheck.find(r => r.invoice_id === inv1.body.invoiceId)?.hpp_satuan);
    const hpp2 = Number(iiCheck.find(r => r.invoice_id === inv2.body.invoiceId)?.hpp_satuan);
    record('Skenario 2', 'HPP berubah: inv lama tetap 1000, inv baru pakai HPP baru (1125)',
      approx(hpp1, 1000) && approx(hpp2, 1125),
      `inv1_hpp=${hpp1}, inv2_hpp=${hpp2}`);

    // --- EXTRA: Reversal HPP pada Edit & Cancel PO (user request) ---
    const poRev = await api('POST', '/api/purchases', tokens.admin, {
      vendor_id: 'V-UJI-1', date: '2023-06-02', payment_type_id: 'PT-1',
      items: [{ product_id: 'P-UJI-PO', quantity: 10, cost: 1200 }]
    });
    // Stock 20, cost = (10*1000 + 10*1200)/20 = 1100
    const [pAfterPo] = await db.query("SELECT stock, cost_price FROM products WHERE id = 'P-UJI-PO'");
    await api('PUT', `/api/purchases/${encodeURIComponent(poRev.body.id)}`, tokens.admin, {
      vendor_id: 'V-UJI-1', date: '2023-06-02', payment_type_id: 'PT-1',
      items: [{ product_id: 'P-UJI-PO', quantity: 10, cost: 1400 }],
      correction_reason: 'Koreksi harga beli'
    });
    const [pAfterEditPo] = await db.query("SELECT stock, cost_price FROM products WHERE id = 'P-UJI-PO'");
    await api('PUT', `/api/purchases/${encodeURIComponent(poRev.body.id)}/cancel`, tokens.admin, {});
    const [pAfterCancelPo] = await db.query("SELECT stock, cost_price FROM products WHERE id = 'P-UJI-PO'");
    record('PO HPP Reversal', 'Edit PO & Cancel PO membalikkan stok dan weighted-avg HPP',
      approx(pAfterPo[0].cost_price, 1100) &&
      approx(pAfterEditPo[0].cost_price, 1200) && approx(pAfterEditPo[0].stock, 20) &&
      approx(pAfterCancelPo[0].cost_price, 1000) && approx(pAfterCancelPo[0].stock, 10),
      `afterPO=${pAfterPo[0].cost_price}, afterEdit=${pAfterEditPo[0].cost_price}, afterCancel=${pAfterCancelPo[0].cost_price}`);

    // --- SKENARIO 3: Cancel invoice ---
    const [stkBeforeCancel] = await db.query("SELECT stock FROM products WHERE id = 'P-UJI-2'");
    const invCancel = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-1', date: '2023-06-14', payment_type_id: 'PT-1',
      items: [{ id: 'P-UJI-2', quantity: 3, price: 2000 }]
    });
    await api('PUT', `/api/invoices/${encodeURIComponent(invCancel.body.invoiceId)}/cancel`, tokens.admin, {});
    const [stkAfterCancel] = await db.query("SELECT stock FROM products WHERE id = 'P-UJI-2'");
    const s3 = await api('GET', `/api/laporan/penjualan?group=invoice&from=2023-06-14&to=2023-06-14`, tokens.admin);
    record('Skenario 3', 'Cancel invoice: hilang dari laporan & stok kembali',
      approx(stkAfterCancel[0].stock, stkBeforeCancel[0].stock) && (s3.body?.data?.rows || []).length === 0,
      `stock=${stkAfterCancel[0].stock}, rows=${(s3.body?.data?.rows || []).length}`);

    // --- SKENARIO 4: Edit qty dikurangi (item lama pertahankan HPP lamanya, item baru ambil HPP saat itu) ---
    const invEdit = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-1', date: '2023-06-15', payment_type_id: 'PT-1',
      items: [{ id: 'P-UJI-2', quantity: 5, price: 2000 }]
    }); // HPP snapshot = 500
    // Change P-UJI-2 master cost_price directly in DB to simulate subsequent purchase price change
    await db.query("UPDATE products SET cost_price = 900 WHERE id = 'P-UJI-2'");
    const [stkPreEdit] = await db.query("SELECT stock FROM products WHERE id = 'P-UJI-2'");
    const editRes = await api('PUT', `/api/invoices/${encodeURIComponent(invEdit.body.invoiceId)}`, tokens.admin, {
      customer_id: 'C-UJI-1', date: '2023-06-15', payment_type_id: 'PT-1', requested_status: 'lunas',
      correction_reason: 'Salah input qty',
      items: [
        { product_id: 'P-UJI-2', quantity: 3, price: 2000 },
        { product_id: 'P-UJI-1', quantity: 1, price: 1500 } // new item -> takes current P-UJI-1 HPP (1125)
      ]
    });
    const [stkPostEdit] = await db.query("SELECT stock FROM products WHERE id = 'P-UJI-2'");
    const [iiEdited] = await db.query("SELECT product_id, hpp_satuan FROM invoice_items WHERE invoice_id = ?", [invEdit.body.invoiceId]);
    const hppP2AfterEdit = Number(iiEdited.find(x => x.product_id === 'P-UJI-2')?.hpp_satuan);
    const hppP1AfterEdit = Number(iiEdited.find(x => x.product_id === 'P-UJI-1')?.hpp_satuan);
    record('Skenario 4', 'Edit invoice: qty dikurangi (stok +2), item lama tetap HPP 500, item baru ambil HPP 1125',
      editRes.status === 200 && approx(stkPostEdit[0].stock, Number(stkPreEdit[0].stock) + 2) &&
      approx(hppP2AfterEdit, 500) && approx(hppP1AfterEdit, 1125),
      `oldItemHpp=${hppP2AfterEdit}, newItemHpp=${hppP1AfterEdit}, stockDelta=${Number(stkPostEdit[0].stock) - Number(stkPreEdit[0].stock)}`);
    // Restore P-UJI-2 cost_price to 500
    await db.query("UPDATE products SET cost_price = 500 WHERE id = 'P-UJI-2'");

    // --- SKENARIO 5: Retur kembali ke stok ---
    const invRetGood = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-1', date: '2023-06-16', payment_type_id: 'PT-7',
      items: [{ id: 'P-UJI-2', quantity: 4, price: 2000 }]
    }); // DPP=8000, HPP=2000
    await api('POST', `/api/invoices/${encodeURIComponent(invRetGood.body.invoiceId)}/returns`, tokens.admin, {
      date: '2023-06-16', reason: 'Retur baik',
      items: [{ product_id: 'P-UJI-2', quantity: 1, condition_type: 'kembali_ke_stok' }]
    });
    const s5 = await api('GET', '/api/laporan/penjualan/ringkasan?from=2023-06-16&to=2023-06-16', tokens.admin);
    record('Skenario 5', 'Retur kembali ke stok: Penj Bersih & HPP berkurang proporsional (6.000 / 1.500 / Laba 4.500)',
      approx(s5.body?.data?.penjualan_bersih, 6000) && approx(s5.body?.data?.hpp, 1500) && approx(s5.body?.data?.laba_kotor, 4500),
      `bersih=${s5.body?.data?.penjualan_bersih}, hpp=${s5.body?.data?.hpp}, laba=${s5.body?.data?.laba_kotor}`);

    // --- SKENARIO 6: Retur rusak ---
    const invRetBad = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-1', date: '2023-06-17', payment_type_id: 'PT-7',
      items: [{ id: 'P-UJI-2', quantity: 4, price: 2000 }]
    }); // DPP=8000, HPP=2000
    await api('POST', `/api/invoices/${encodeURIComponent(invRetBad.body.invoiceId)}/returns`, tokens.admin, {
      date: '2023-06-17', reason: 'Barang rusak',
      items: [{ product_id: 'P-UJI-2', quantity: 1, condition_type: 'rusak' }]
    });
    const s6 = await api('GET', '/api/laporan/penjualan/ringkasan?from=2023-06-17&to=2023-06-17', tokens.admin);
    record('Skenario 6', 'Retur rusak: Penj Bersih 6.000, HPP tetap 2.000 (tidak dikembalikan), Laba 4.000',
      approx(s6.body?.data?.penjualan_bersih, 6000) && approx(s6.body?.data?.hpp, 2000) &&
      approx(s6.body?.data?.laba_kotor, 4000) && approx(s6.body?.data?.hpp_retur_rusak, 500),
      `bersih=${s6.body?.data?.penjualan_bersih}, hpp=${s6.body?.data?.hpp}, laba=${s6.body?.data?.laba_kotor}, rusakHpp=${s6.body?.data?.hpp_retur_rusak}`);

    // --- SKENARIO 7: Invoice backdate ---
    const invBack = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-2', date: '2023-06-05', payment_type_id: 'PT-1',
      items: [{ id: 'P-UJI-2', quantity: 1, price: 2000 }]
    });
    const s7 = await api('GET', '/api/laporan/penjualan?group=day&from=2023-06-05&to=2023-06-05', tokens.admin);
    record('Skenario 7', 'Invoice backdate muncul pada tanggal transaksi (2023-06-05)',
      invBack.status === 200 && (s7.body?.data?.rows || []).length === 1 && s7.body.data.rows[0].period === '2023-06-05',
      `id=${invBack.body?.invoiceId}, period=${s7.body?.data?.rows?.[0]?.period}`);

    // --- SKENARIO 8: Invoice outstanding import ---
    const impRes = await api('POST', '/api/invoices/import-outstanding', tokens.admin, {
      invoices: [{ id: 'IMP-UJI-001', date: '2023-06-18', customer_id: 'C-UJI-1', total: 50000, total_dibayar: 0, payment_type_id: 'PT-7' }]
    });
    const s8 = await api('GET', '/api/laporan/penjualan?group=invoice&from=2023-06-18&to=2023-06-18', tokens.admin);
    const impRow = (s8.body?.data?.rows || []).find(r => r.id === 'IMP-UJI-001');
    record('Skenario 8', 'Invoice outstanding import tampil dengan hpp_estimasi = true',
      impRes.status === 200 && impRow && impRow.hpp_estimasi === true,
      `hpp_estimasi=${impRow?.hpp_estimasi}, penj=${impRow?.penjualan_bersih}`);

    // --- SKENARIO 9: Diskon & PPN (basis DPP) ---
    const invDisc = await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-1', date: '2023-06-19', payment_type_id: 'PT-1', discount: 1000,
      items: [{ id: 'P-UJI-2', quantity: 2, price: 5000 }]
    }); // subtotal=10000, discount=1000, PPN=990, total=9990 -> DPP bersih = 9000, HPP = 1000, Laba = 8000
    const s9 = await api('GET', '/api/laporan/penjualan/ringkasan?from=2023-06-19&to=2023-06-19', tokens.admin);
    record('Skenario 9', 'Diskon & PPN basis DPP: kotor 10.000 - diskon 1.000 = bersih 9.000 (tanpa PPN)',
      invDisc.status === 200 &&
      approx(s9.body?.data?.penjualan_kotor, 10000) &&
      approx(s9.body?.data?.diskon, 1000) &&
      approx(s9.body?.data?.penjualan_bersih, 9000) &&
      approx(s9.body?.data?.laba_kotor, 8000),
      `kotor=${s9.body?.data?.penjualan_kotor}, disc=${s9.body?.data?.diskon}, bersih=${s9.body?.data?.penjualan_bersih}`);

    // --- SKENARIO 10: Bulan tanpa penjualan ---
    const s10 = await api('GET', '/api/laporan/penjualan/ringkasan?from=2018-01-01&to=2018-01-31', tokens.admin);
    const p10 = await api('GET', '/api/laporan/performa?bulan=1&tahun=2018', tokens.admin);
    record('Skenario 10', 'Bulan tanpa penjualan: margin null (tampil "-") dan tidak error pembagian nol',
      s10.status === 200 && s10.body?.data?.margin_pct === null && p10.status === 200 && p10.body?.data?.margin === null,
      `ringkasan_margin=${s10.body?.data?.margin_pct}, performa_margin=${p10.body?.data?.margin}`);

    // --- SKENARIO 11: Role & HPP protection ---
    const rFinPenj = await api('GET', '/api/laporan/penjualan?group=day&from=2023-06-01&to=2023-06-30', tokens.finance);
    const rKasPenj = await api('GET', '/api/laporan/penjualan?group=day&from=2023-06-01&to=2023-06-30', tokens.kasir);
    const rGudPenj = await api('GET', '/api/laporan/penjualan?group=day&from=2023-06-01&to=2023-06-30', tokens.gudang);
    const rFinRing = await api('GET', '/api/laporan/penjualan/ringkasan?from=2023-06-01&to=2023-06-30', tokens.finance);
    const rFinPdf = await api('GET', '/api/laporan/penjualan/export-pdf?group=day&from=2023-06-01&to=2023-06-30', tokens.finance);

    const rInvAdm = await api('GET', '/api/invoices?page=1&limit=10', tokens.admin);
    const rInvFin = await api('GET', '/api/invoices?page=1&limit=10', tokens.finance);
    const rInvKas = await api('GET', '/api/invoices?page=1&limit=10', tokens.kasir);

    const rProdGud = await api('GET', '/api/products?page=1&limit=10', tokens.gudang);
    const rProdKas = await api('GET', '/api/products?page=1&limit=10', tokens.kasir);
    const rPoItemsGud = await api('GET', `/api/purchases/${encodeURIComponent(po1.body.id)}/items`, tokens.gudang);
    const rInvItemsKas = await api('GET', `/api/invoices/${encodeURIComponent(inv1.body.invoiceId)}/items`, tokens.kasir);
    const rDashFin = await api('GET', '/api/dashboard/summary', tokens.finance);
    const rDashKas = await api('GET', '/api/dashboard/summary', tokens.kasir);
    const rDashGud = await api('GET', '/api/dashboard/summary', tokens.gudang);

    const gudCanSeeCostPrice = (rProdGud.body?.data || []).some(p => p.cost_price !== undefined) && (rProdGud.body?.data || []).every(p => p.sell_price === undefined);
    const kasNoCostPrice = (rProdKas.body?.data || []).every(p => p.cost_price === undefined) && rProdKas.body?.summary?.totalStockValue === undefined;
    const poGudCanSeeHpp = (rPoItemsGud.body || []).every(it => it.cost !== undefined && it.cost_price !== undefined);
    const invItemsKasSafe = (rInvItemsKas.body || []).every(it => it.cost_price_snapshot === undefined && it.hpp_satuan === undefined);
    const invAdmHasLaba = (rInvAdm.body?.data || []).some(r => 'laba' in r);
    const invFinNoLaba = (rInvFin.body?.data || []).every(r => !('laba' in r) && !('hpp' in r) && !('marginPct' in r));
    const invKasNoLaba = (rInvKas.body?.data || []).every(r => !('laba' in r) && !('hpp' in r));

    record('Skenario 11', 'Akses Laporan Penjualan admin-only (403 untuk finance/kasir/gudang)',
      rFinPenj.status === 403 && rKasPenj.status === 403 && rGudPenj.status === 403 && rFinRing.status === 403 && rFinPdf.status === 403,
      `statuses=[fin:${rFinPenj.status}, kas:${rKasPenj.status}, gud:${rGudPenj.status}, ringFin:${rFinRing.status}, pdfFin:${rFinPdf.status}]`);
    record('Skenario 11b', 'Sanitasi HPP kasir + Gudang akses HPP produk/PO (tanpa sell_price) + Laba invoice admin-only',
      gudCanSeeCostPrice && kasNoCostPrice && poGudCanSeeHpp && invItemsKasSafe && invAdmHasLaba && invFinNoLaba && invKasNoLaba &&
      'grossProfit' in rDashFin.body && !('grossProfit' in rDashKas.body) && !('revenue' in rDashKas.body) && !('grossProfit' in rDashGud.body),
      `gudHasHppNoSell=${gudCanSeeCostPrice}, poGudHasCostAndHpp=${poGudCanSeeHpp}, invAdmLaba=${invAdmHasLaba}, invFinNoLaba=${invFinNoLaba}`);

    // --- SKENARIO 12: Cross-check penuh Juni 2023 ---
    const ccInv = await api('GET', '/api/laporan/penjualan?group=invoice&from=2023-06-01&to=2023-06-30&all=1', tokens.admin);
    const ccDay = await api('GET', '/api/laporan/penjualan?group=day&from=2023-06-01&to=2023-06-30', tokens.admin);
    const ccMon = await api('GET', '/api/laporan/penjualan?group=month&from=2023-06-01&to=2023-06-30', tokens.admin);
    const ccLR = await api('GET', '/api/laporan/laba-rugi?bulan=6&tahun=2023', tokens.admin);

    const sumInvLaba = (ccInv.body?.data?.rows || []).reduce((s, r) => s + Number(r.laba || 0), 0);
    const sumDayLaba = (ccDay.body?.data?.rows || []).reduce((s, r) => s + Number(r.laba_kotor || 0), 0);
    const sumMonLaba = (ccMon.body?.data?.rows || []).reduce((s, r) => s + Number(r.laba_kotor || 0), 0);
    const lrLabaKotor = Number(ccLR.body?.data?.labaKotor || 0);

    record('Skenario 12', 'Cross-check: Σ Per Invoice = Σ Per Hari = Σ Per Bulan = Laba Kotor Laba Rugi',
      approx(sumInvLaba, sumDayLaba) && approx(sumDayLaba, sumMonLaba) && approx(sumMonLaba, lrLabaKotor),
      `inv=${sumInvLaba}, day=${sumDayLaba}, month=${sumMonLaba}, labaRugi=${lrLabaKotor}`);

    // --- Also check Nov 2026 Laba Rugi (Bug Retur & Rp -0 fix verification!) ---
    const lrNov26 = await api('GET', '/api/laporan/laba-rugi?bulan=11&tahun=2026', tokens.admin);
    record('Bugfix Nov26', 'Laba Rugi Nov 2026 memuat Retur INV-2026-11-00090 (DPP Rp 460.000) & basis DPP',
      approx(lrNov26.body?.data?.pendapatan?.retur, 460000) && approx(lrNov26.body?.data?.pendapatan?.kotor, 6125500),
      `kotor=${lrNov26.body?.data?.pendapatan?.kotor}, retur=${lrNov26.body?.data?.pendapatan?.retur}, bersih=${lrNov26.body?.data?.pendapatan?.bersih}`);

    // --- SKENARIO 13: Rentang tanggal, inklusif 23:30, lintas bulan (sebagian), validasi, filter, PDF ---
    // Add invoice in July 2023 and verify cross-month 2023-06-15..2023-07-20
    await api('POST', '/api/invoices', tokens.admin, {
      customer_id: 'C-UJI-2', date: '2023-07-10', payment_type_id: 'PT-2',
      items: [{ id: 'P-UJI-2', quantity: 2, price: 2000 }]
    });
    const crossMon = await api('GET', '/api/laporan/penjualan?group=month&from=2023-06-15&to=2023-07-20', tokens.admin);
    const monRows = crossMon.body?.data?.rows || [];
    const bothPartial = monRows.length === 2 && monRows[0].is_partial === true && monRows[1].is_partial === true;

    // Validation errors
    const errFromGtTo = await api('GET', '/api/laporan/penjualan?group=day&from=2023-07-10&to=2023-07-01', tokens.admin);
    const errOver366 = await api('GET', '/api/laporan/penjualan?group=day&from=2022-01-01&to=2023-06-01', tokens.admin);
    const errOver60m = await api('GET', '/api/laporan/penjualan?group=month&from=2019-01-01&to=2026-11-01', tokens.admin);
    const errBadGroup = await api('GET', '/api/laporan/penjualan?group=week&from=2023-06-01&to=2023-06-10', tokens.admin);

    // Filter customer + payment_type consistency between ringkasan, tabel, and PDF
    const filtRing = await api('GET', '/api/laporan/penjualan/ringkasan?from=2023-06-01&to=2023-07-31&customer_id=C-UJI-2&payment_type_id=PT-2', tokens.admin);
    const filtList = await api('GET', '/api/laporan/penjualan?group=invoice&from=2023-06-01&to=2023-07-31&customer_id=C-UJI-2&payment_type_id=PT-2', tokens.admin);
    const filtPdf = await api('GET', '/api/laporan/penjualan/export-pdf?group=invoice&from=2023-06-01&to=2023-07-31&customer_id=C-UJI-2&payment_type_id=PT-2', tokens.admin);
    const isPdfValid = filtPdf.status === 200 && filtPdf.pdfBuf && filtPdf.pdfBuf.slice(0, 5).toString() === '%PDF-';

    // Inclusive 23:30 test (simulate DATETIME column or timestamp string with 23:30 on end date)
    // Check SQL condition against DATE_ADD(to, INTERVAL 1 DAY) on a DATETIME test value
    const [dtTest] = await db.query("SELECT ('2023-06-30 23:30:00' >= '2023-06-01' AND '2023-06-30 23:30:00' < DATE_ADD('2023-06-30', INTERVAL 1 DAY)) AS included");

    record('Skenario 13', 'Rentang tanggal, lintas bulan (sebagian), validasi 400, filter & PDF',
      bothPartial && errFromGtTo.status === 400 && errOver366.status === 400 && errOver60m.status === 400 && errBadGroup.status === 400 &&
      approx(filtRing.body?.data?.penjualan_bersih, filtList.body?.data?.totals?.penjualan_bersih) &&
      filtRing.body?.data?.jumlah_invoice === filtList.body?.data?.rows?.length &&
      isPdfValid && Number(dtTest[0].included) === 1,
      `partial=${bothPartial}, errs=[${errFromGtTo.status},${errOver366.status},${errOver60m.status},${errBadGroup.status}], filtJml=${filtRing.body?.data?.jumlah_invoice}, pdf=${isPdfValid}`);

    const passedCnt = results.filter(r => r.pass).length;
    const failedCnt = results.filter(r => !r.pass).length;
    console.log(`\n=== SUMMARY: ${passedCnt} PASSED, ${failedCnt} FAILED (Total ${results.length}) ===`);
    if (failedCnt > 0) process.exitCode = 1;
  } finally {
    if (db) await db.end().catch(() => {});
    if (serverProc) serverProc.kill();
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  if (serverProc) serverProc.kill();
  process.exit(1);
});
