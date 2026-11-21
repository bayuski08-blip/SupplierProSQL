const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

// Backup original
fs.writeFileSync(serverPath + '.bak_batch_b', code, 'utf8');
console.log('Backup created at server.js.bak_batch_b');

// =========================================================================
// 1. Add Auto-migrate for Batch B tables & columns in startup section
// =========================================================================
const startupTarget = `// MySQL auto-manages AUTO_INCREMENT — no sequence reset needed`;

const startupCode = `// Auto-migrate: Batch B tables, counters, and deposit/return columns
(async () => {
  try {
    await mysqlPool.query(\`
      CREATE TABLE IF NOT EXISTS stock_moves (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id VARCHAR(255) NOT NULL,
        tanggal DATETIME NOT NULL,
        tipe VARCHAR(50) NOT NULL,
        ref_type VARCHAR(50) NULL,
        ref_id VARCHAR(255) NULL,
        ref_no VARCHAR(255) NULL,
        qty_masuk DECIMAL(20,4) NOT NULL DEFAULT 0,
        qty_keluar DECIMAL(20,4) NOT NULL DEFAULT 0,
        qty_sebelum DECIMAL(20,4) NOT NULL DEFAULT 0,
        qty_sesudah DECIMAL(20,4) NOT NULL DEFAULT 0,
        keterangan TEXT NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_backfill TINYINT(1) NOT NULL DEFAULT 0,
        INDEX idx_stock_moves_product (product_id),
        INDEX idx_stock_moves_tanggal (tanggal),
        INDEX idx_stock_moves_tipe (tipe),
        INDEX idx_stock_moves_ref (ref_type, ref_id),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    \`);

    await mysqlPool.query(\`
      CREATE TABLE IF NOT EXISTS return_counters (
        year INT NOT NULL PRIMARY KEY,
        last_sales_number INT NOT NULL DEFAULT 0,
        last_purchase_number INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    \`);

    await mysqlPool.query(\`
      CREATE TABLE IF NOT EXISTS sales_returns (
        id VARCHAR(255) PRIMARY KEY,
        invoice_id VARCHAR(255) NOT NULL,
        customer_id VARCHAR(255) NULL,
        date DATE NOT NULL,
        total_refund DECIMAL(20,4) NOT NULL DEFAULT 0,
        piutang_deduction DECIMAL(20,4) NOT NULL DEFAULT 0,
        customer_deposit_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sr_invoice (invoice_id),
        INDEX idx_sr_customer (customer_id),
        INDEX idx_sr_date (date),
        FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE RESTRICT,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    \`);

    await mysqlPool.query(\`
      CREATE TABLE IF NOT EXISTS sales_return_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        return_id VARCHAR(255) NOT NULL,
        product_id VARCHAR(255) NOT NULL,
        quantity DECIMAL(20,4) NOT NULL,
        condition_type VARCHAR(50) NOT NULL,
        price DECIMAL(20,4) NOT NULL,
        cost_price_snapshot DECIMAL(20,4) NOT NULL DEFAULT 0,
        subtotal DECIMAL(20,4) NOT NULL DEFAULT 0,
        refund_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
        INDEX idx_sri_return (return_id),
        INDEX idx_sri_product (product_id),
        FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    \`);

    await mysqlPool.query(\`
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id VARCHAR(255) PRIMARY KEY,
        purchase_order_id VARCHAR(255) NOT NULL,
        vendor_id VARCHAR(255) NULL,
        date DATE NOT NULL,
        total_refund DECIMAL(20,4) NOT NULL DEFAULT 0,
        hutang_deduction DECIMAL(20,4) NOT NULL DEFAULT 0,
        vendor_deposit_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pr_po (purchase_order_id),
        INDEX idx_pr_vendor (vendor_id),
        INDEX idx_pr_date (date),
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    \`);

    await mysqlPool.query(\`
      CREATE TABLE IF NOT EXISTS purchase_return_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        return_id VARCHAR(255) NOT NULL,
        product_id VARCHAR(255) NOT NULL,
        quantity DECIMAL(20,4) NOT NULL,
        cost DECIMAL(20,4) NOT NULL,
        subtotal DECIMAL(20,4) NOT NULL DEFAULT 0,
        refund_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
        INDEX idx_pri_return (return_id),
        INDEX idx_pri_product (product_id),
        FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    \`);

    const [custCols] = await mysqlPool.query("SHOW COLUMNS FROM customers LIKE 'deposit'");
    if (!custCols || custCols.length === 0) {
      await mysqlPool.query("ALTER TABLE customers ADD COLUMN deposit DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER credit_lmt");
      console.log('[Startup] Added deposit column to customers');
    }

    const [vendCols] = await mysqlPool.query("SHOW COLUMNS FROM vendors LIKE 'deposit'");
    if (!vendCols || vendCols.length === 0) {
      await mysqlPool.query("ALTER TABLE vendors ADD COLUMN deposit DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER phone");
      console.log('[Startup] Added deposit column to vendors');
    }

    const [invCols] = await mysqlPool.query("SHOW COLUMNS FROM sales_invoices LIKE 'return_amount'");
    if (!invCols || invCols.length === 0) {
      await mysqlPool.query("ALTER TABLE sales_invoices ADD COLUMN return_amount DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER paid_amount");
      console.log('[Startup] Added return_amount column to sales_invoices');
    }

    const [poCols] = await mysqlPool.query("SHOW COLUMNS FROM purchase_orders LIKE 'return_amount'");
    if (!poCols || poCols.length === 0) {
      await mysqlPool.query("ALTER TABLE purchase_orders ADD COLUMN return_amount DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER paid_amount");
      console.log('[Startup] Added return_amount column to purchase_orders');
    }

    console.log('[Startup] Batch B schema and tables ready.');
  } catch (err) {
    console.error('[Startup] Failed to check/migrate Batch B schema:', err.message);
  }
})();

// MySQL auto-manages AUTO_INCREMENT — no sequence reset needed`;

if (!code.includes('CREATE TABLE IF NOT EXISTS stock_moves')) {
  code = code.replace(startupTarget, startupCode);
  console.log('1. Added Batch B auto-migration to startup section.');
} else {
  console.log('1. Startup migration already present, skipping.');
}

// =========================================================================
// 2. Add Helper Functions: recordStockMove, generateSalesReturnId, generatePurchaseReturnId
// =========================================================================
const helperTarget = `async function generatePaymentNo(pgClient, paymentDate) {
  const d = paymentDate ? new Date(paymentDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    \`INSERT INTO payment_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)\`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return \`PAY-\${year}-\${mm}-\${padded}\`;
}`;

const helperAddition = `async function generatePaymentNo(pgClient, paymentDate) {
  const d = paymentDate ? new Date(paymentDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    \`INSERT INTO payment_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)\`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return \`PAY-\${year}-\${mm}-\${padded}\`;
}

/**
 * Generate Sales Return ID: RTJ-{YYYY}-{MM}-{NNNNN}
 */
async function generateSalesReturnId(pgClient, returnDate) {
  const d = returnDate ? new Date(returnDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    \`INSERT INTO return_counters (year, last_sales_number, last_purchase_number) VALUES (?, LAST_INSERT_ID(1), 0)
     ON DUPLICATE KEY UPDATE last_sales_number = LAST_INSERT_ID(last_sales_number + 1)\`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return \`RTJ-\${year}-\${mm}-\${padded}\`;
}

/**
 * Generate Purchase Return ID: RTB-{YYYY}-{MM}-{NNNNN}
 */
async function generatePurchaseReturnId(pgClient, returnDate) {
  const d = returnDate ? new Date(returnDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    \`INSERT INTO return_counters (year, last_sales_number, last_purchase_number) VALUES (?, 0, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_purchase_number = LAST_INSERT_ID(last_purchase_number + 1)\`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return \`RTB-\${year}-\${mm}-\${padded}\`;
}

/**
 * Record stock move entry in the current transaction/connection
 * CRITICAL RULE: NO financial data (price, cost, HPP, cash) stored here!
 */
async function recordStockMove(conn, {
  product_id,
  tanggal,
  tipe,
  ref_type,
  ref_id,
  ref_no,
  qty_masuk = 0,
  qty_keluar = 0,
  qty_sebelum = null,
  qty_sesudah = null,
  keterangan = null,
  created_by = null,
  is_backfill = 0
}) {
  if (!product_id) return null;

  let before = qty_sebelum;
  let after = qty_sesudah;

  if (before === null || after === null) {
    const prodRes = await conn.query('SELECT stock FROM products WHERE id = ?', [product_id]);
    const current = parseFloat(prodRes.rows[0]?.stock || 0);
    if (before === null && after !== null) {
      before = current;
    } else if (before !== null && after === null) {
      after = current;
    } else {
      before = current;
      after = current + (parseFloat(qty_masuk) || 0) - (parseFloat(qty_keluar) || 0);
    }
  }

  const dt = tanggal || (new Date().toISOString().slice(0, 19).replace('T', ' '));

  const insertSql = \`
    INSERT INTO stock_moves (
      product_id, tanggal, tipe, ref_type, ref_id, ref_no,
      qty_masuk, qty_keluar, qty_sebelum, qty_sesudah,
      keterangan, created_by, is_backfill
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  \`;

  await conn.query(insertSql, [
    product_id,
    dt,
    tipe,
    ref_type || null,
    ref_id ? String(ref_id) : null,
    ref_no ? String(ref_no) : (ref_id ? String(ref_id) : null),
    parseFloat(qty_masuk) || 0,
    parseFloat(qty_keluar) || 0,
    parseFloat(before) || 0,
    parseFloat(after) || 0,
    keterangan || null,
    created_by || null,
    is_backfill ? 1 : 0
  ]);
}`;

if (!code.includes('async function recordStockMove')) {
  code = code.replace(helperTarget, helperAddition);
  console.log('2. Added recordStockMove, generateSalesReturnId, generatePurchaseReturnId.');
} else {
  console.log('2. recordStockMove already present, skipping.');
}

fs.writeFileSync(serverPath, code, 'utf8');
console.log('Patched server.js step 1 & 2.');

