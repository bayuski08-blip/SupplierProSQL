require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // bcryptjs = pure JS, tidak perlu native compile (aman di shared hosting)
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
// ─── Global crash handlers — harus di atas sebelum kode lain ───────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';

// ─── Shared Password Helper (Login, Admin Reset, Ganti Password Sendiri) ─────
const PASSWORD_SALT_ROUNDS = 10;

async function hashPassword(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Password harus berupa string non-kosong');
  }
  return bcrypt.hash(plaintext, PASSWORD_SALT_ROUNDS);
}

async function verifyPassword(plaintext, hash) {
  if (!plaintext || !hash) return false;
  const isBcrypt = typeof hash === 'string' && (hash.startsWith('$2b$') || hash.startsWith('$2a$'));
  if (isBcrypt) {
    return bcrypt.compare(plaintext, hash);
  }
  // Fallback untuk legacy plaintext password (tidak auto-mengubah DB di helper)
  return plaintext === hash;
}

const getTodayWITA = () => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
  } catch (e) {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().split('T')[0];
  }
};

/**
 * Hitung tanggal maksimum order = hari ini (WITA) + maxDays hari.
 * Masalah 2: izin maksimal +7 hari ke depan.
 */
const getMaxOrderDateWITA = (maxDays = 7) => {
  try {
    const today = getTodayWITA(); // 'YYYY-MM-DD'
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(y, m - 1, d + maxDays);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  } catch (e) {
    const d = new Date(Date.now() + 8 * 3600 * 1000 + maxDays * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
};

/**
 * Validasi tanggal order: format YYYY-MM-DD, tanggal harus ada di kalender,
 * dan tidak boleh melebihi hari ini + maxDays (default 7).
 * Tanggal lampau (tanpa batas) tetap diizinkan.
 * Melempar Error jika tidak valid.
 */
const validateOrderDate = (dateStr, maxDays = 7) => {
  const s = String(dateStr || '').split('T')[0].trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw Object.assign(new Error('Format tanggal tidak valid. Gunakan format YYYY-MM-DD.'), { status: 400 });
  }
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== (m - 1) || dt.getDate() !== d) {
    throw Object.assign(new Error('Tanggal tidak ada dalam kalender.'), { status: 400 });
  }
  const maxDate = getMaxOrderDateWITA(maxDays);
  if (s > maxDate) {
    // Format maxDate sebagai dd/mm/yyyy untuk pesan ke user
    const [my, mm, md] = maxDate.split('-');
    throw Object.assign(
      new Error(`Tanggal Order maksimal 7 hari ke depan (sampai ${md}/${mm}/${my}).`),
      { status: 400 }
    );
  }
  return s; // tanggal valid, kembalikan string bersih
};

const formatDateStr = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val.split('T')[0].split(' ')[0];
  // Date objects from mysql2 DATE columns: use local date components (NOT toISOString which is UTC
  // and can shift to previous day for UTC+ timezones, e.g. 2026-06-12 00:00 WIB → 2026-06-11T17:00Z)
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (val.toISOString) return val.toISOString().split('T')[0];
  return String(val).split('T')[0].split(' ')[0];
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Anti-Cache Middleware untuk seluruh rute API ─────────────────────────────
// Nonaktifkan ETag agar Express tidak menghasilkan weak etag yang memicu respons 304
app.set('etag', false);

// Mencegah LiteSpeed Web Server (Hostinger), reverse proxy, dan browser meng-cache data API
app.use('/api', (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'X-LiteSpeed-Cache-Control': 'no-cache, no-store'
  });
  next();
});

// ─── Landing page gate — must be BEFORE express.static ────────────────────────
// Intercepts requests to the root landing page (/ or /index.html) and
// redirects to /login when the admin has disabled the landing demo page.
app.use(async (req, res, next) => {
  const isLandingRequest =
    req.method === 'GET' &&
    (req.path === '/' || req.path === '/index.html');
  if (!isLandingRequest) return next();
  try {
    const val = await getSetting('tampilkan_landing_demo', 'true');
    if (val === 'false') {
      return res.redirect('/login');
    }
  } catch (_) {
    // getSetting not yet defined at this position — pool may not be ready,
    // default to allowing access (fail open)
  }
  return next();
});

app.use(express.static(__dirname)); // Serve static files from the current directory

// ─── MySQL Connection Pool (with pg-compatible wrapper) ───────────────────────
// Parse mysql://user:pass@host:port/db  OR  use individual env vars
const dbUrl = process.env.DATABASE_URL
  || `mysql://${process.env.DB_USER || 'root'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'supplierpro'}`;

const urlParsed = new URL(dbUrl);

const mysqlPool = mysql.createPool({
  host:     urlParsed.hostname,
  port:     parseInt(urlParsed.port) || 3306,
  user:     urlParsed.username,
  password: urlParsed.password,
  database: urlParsed.pathname.replace('/', ''),
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+08:00', // WITA (UTC+8) — ensures DATE() functions align with Indonesian business time
  dateStrings: true   // Returns DATE/DATETIME columns as pure strings, eliminating UTC timezone shift on Linux/Hostinger servers
});

/**
 * Wraps a raw mysql2 connection/pool so it behaves like the pg library:
 *   • Converts $1,$2,… placeholders → ?
 *   • Strips RETURNING … clauses and exposes insertId in rows[0]
 *   • Returns { rows, rowCount, affectedRows, insertId }
 *   • Intercepts BEGIN / COMMIT / ROLLBACK to use MySQL syntax
 */
function pgify(conn) {
  const execQuery = async (sql, params = []) => {
    // Convert pg-style $N placeholders to MySQL ?
    let mysqlSql = sql.replace(/\$\d+/g, '?');

    // Handle RETURNING clause: strip it and remember we need insertId
    const returningMatch = mysqlSql.match(/\s+RETURNING\s+[\w,\s*]+$/i);
    if (returningMatch) {
      mysqlSql = mysqlSql.slice(0, mysqlSql.length - returningMatch[0].length);
    }

    // Intercept transaction keywords
    const trimmed = mysqlSql.trim().toUpperCase();
    if (trimmed === 'BEGIN')    { await conn.query('START TRANSACTION'); return { rows: [], rowCount: 0 }; }
    if (trimmed === 'COMMIT')   { await conn.query('COMMIT');            return { rows: [], rowCount: 0 }; }
    if (trimmed === 'ROLLBACK') { await conn.query('ROLLBACK');          return { rows: [], rowCount: 0 }; }

    const [result] = await conn.query(mysqlSql, params);

    if (Array.isArray(result)) {
      // SELECT
      return { rows: result, rowCount: result.length };
    } else {
      // INSERT / UPDATE / DELETE
      const insertId  = result.insertId  || 0;
      const affected  = result.affectedRows || 0;
      // If RETURNING was requested expose id so callers using result.rows[0].id still work
      const rows = returningMatch ? [{ id: insertId || (params[0] ?? null) }] : [];
      return { rows, rowCount: affected, affectedRows: affected, insertId };
    }
  };

  return {
    query:   execQuery,
    release: () => (typeof conn.release === 'function' ? conn.release() : null),
  };
}

// Top-level pool shim — mirrors pg's pool.query() and pool.connect()
const pool = {
  query: async (sql, params = []) => {
    const conn = await mysqlPool.getConnection();
    try {
      return await pgify(conn).execQuery
        ? pgify(conn).query(sql, params)
        : pgify(conn).query(sql, params);
    } finally {
      conn.release();
    }
  },
  connect: async () => {
    const conn = await mysqlPool.getConnection();
    return pgify(conn);
  }
};

// Initialize settings table and seed defaults
pool.query(`
  CREATE TABLE IF NOT EXISTS settings (
    \`key\` VARCHAR(255) PRIMARY KEY,
    value TEXT
  )
`).then(() => {
  pool.query(`
    INSERT IGNORE INTO settings (\`key\`, value) VALUES
    ('prefix_product', 'P'),
    ('prefix_customer', 'C'),
    ('prefix_vendor', 'V'),
    ('prefix_cash_transaction', 'CT'),
    ('prefix_purchase', 'PO/{YYYY}/{MM}/'),
    ('prefix_sales', 'INV-{YYYY}-{MM}-'),
    ('modal_pemilik', '0'),
    ('company_name', ''),
    ('company_phone', ''),
    ('company_email', ''),
    ('company_address', ''),
    ('company_logo', ''),
    ('ppn_enabled', 'true'),
    ('pajak_default', '11')
  `);
}).catch(err => console.error('Error initializing settings table on startup:', err));

// Auto-migrate: ensure brand column exists in products table
(async () => {
  try {
    const [cols] = await mysqlPool.query("SHOW COLUMNS FROM products LIKE 'brand'");
    if (!cols || cols.length === 0) {
      await mysqlPool.query("ALTER TABLE products ADD COLUMN brand VARCHAR(255) DEFAULT NULL AFTER sku");
      console.log('[Startup] Column brand added to products table.');
    }
  } catch (err) {
    console.error('[Startup] Failed to check/add brand column:', err.message);
  }
})();

// Auto-migrate: create invoice_counters table if not exists
(async () => {
  try {
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS invoice_counters (
        year INT NOT NULL PRIMARY KEY,
        last_number INT NOT NULL DEFAULT 0
      )
    `);
    console.log('[Startup] invoice_counters table ready.');
  } catch (err) {
    console.error('[Startup] Failed to create invoice_counters table:', err.message);
  }
})();

// Auto-migrate: ensure pricelists, pricelist_items, and customers.pricelist_id exist
(async () => {
  try {
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS pricelists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kode VARCHAR(20) NOT NULL UNIQUE,
        nama VARCHAR(100) NOT NULL,
        keterangan VARCHAR(255) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS pricelist_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pricelist_id INT NOT NULL,
        product_id VARCHAR(255) NOT NULL,
        harga DECIMAL(20,4) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_pricelist_product (pricelist_id, product_id),
        KEY idx_pricelist_items_product (product_id),
        CONSTRAINT fk_pli_pricelist FOREIGN KEY (pricelist_id) REFERENCES pricelists(id) ON DELETE CASCADE,
        CONSTRAINT fk_pli_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);

    const [cols] = await mysqlPool.query("SHOW COLUMNS FROM customers LIKE 'pricelist_id'");
    if (!cols || cols.length === 0) {
      await mysqlPool.query(`
        ALTER TABLE customers
        ADD COLUMN pricelist_id INT NULL AFTER customer_category_id,
        ADD CONSTRAINT fk_customers_pricelist
          FOREIGN KEY (pricelist_id) REFERENCES pricelists(id) ON DELETE SET NULL
      `);
      console.log('[Startup] Column pricelist_id added to customers table.');
    }

    await mysqlPool.query("INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_pricelist', 'PL')");
    console.log('[Startup] Pricelist tables and settings ready.');
  } catch (err) {
    console.error('[Startup] Failed to check/migrate pricelist tables:', err.message);
  }
})();

// Auto-migrate: Batch B tables, counters, and deposit/return columns
(async () => {
  try {
    await mysqlPool.query(`
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
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS return_counters (
        year INT NOT NULL PRIMARY KEY,
        last_sales_number INT NOT NULL DEFAULT 0,
        last_purchase_number INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    await mysqlPool.query(`
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
    `);

    await mysqlPool.query(`
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
    `);

    await mysqlPool.query(`
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
    `);

    await mysqlPool.query(`
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
    `);

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

// MySQL auto-manages AUTO_INCREMENT — no sequence reset needed

// Seed/upgrade payment_types on startup
(async () => {
  const ptDefaults = [
    { id: 'PT-1', name: 'Tunai' },
    { id: 'PT-2', name: 'Transfer' },
    { id: 'PT-3', name: 'Kredit 1 Hari' },
    { id: 'PT-5', name: 'Kredit 7 Hari' },
    { id: 'PT-6', name: 'Kredit 14 Hari' },
    { id: 'PT-7', name: 'Kredit 30 Hari' },
  ];
  try {
    for (const pt of ptDefaults) {
      await pool.query(
        `INSERT INTO payment_types (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [pt.id, pt.name]
      );
    }
    // Clean up old unused payment type IDs PT-4 and PT-8
    await pool.query(`DELETE FROM payment_types WHERE id IN ('PT-4', 'PT-8')`).catch(() => {});
    console.log('[Startup] payment_types seeded/upgraded successfully.');
  } catch (err) {
    console.error('[Startup] Failed to seed payment_types:', err.message);
  }
})();

// Auto-migrate: ensure customers.tipe_pembayaran_id exists with FK to payment_types
(async () => {
  try {
    const [cols] = await mysqlPool.query("SHOW COLUMNS FROM customers LIKE 'tipe_pembayaran_id'");
    if (!cols || cols.length === 0) {
      await mysqlPool.query(`
        ALTER TABLE customers
        ADD COLUMN tipe_pembayaran_id VARCHAR(255) NULL DEFAULT NULL AFTER pricelist_id,
        ADD CONSTRAINT fk_customers_tipe_pembayaran
          FOREIGN KEY (tipe_pembayaran_id) REFERENCES payment_types(id) ON DELETE SET NULL
      `);
      console.log('[Startup] Column tipe_pembayaran_id added to customers table.');
    }
  } catch (err) {
    console.error('[Startup] Failed to check/migrate customers.tipe_pembayaran_id:', err.message);
  }
})();

// Seed/upgrade cash_categories to the canonical defaults (MySQL-compatible)
(async () => {
  // MySQL: UNIQUE constraint already defined in schema — no pg_constraint check needed
  const defaults = [
    { name: 'Penjualan',              type: 'IN',   is_system: 1 },
    { name: 'Pelunasan Piutang',      type: 'IN',   is_system: 1 },
    { name: 'Pembelian Stok',         type: 'OUT',  is_system: 1 },
    { name: 'Penyesuaian Stok',       type: 'OUT',  is_system: 1 },
    { name: 'Pelunasan Hutang',       type: 'OUT',  is_system: 1 },
    { name: 'Gaji & Tunjangan',       type: 'OUT',  is_system: 0 },
    { name: 'Sewa',                   type: 'OUT',  is_system: 0 },
    { name: 'Operasional',            type: 'OUT',  is_system: 0 },
    { name: 'Marketing',              type: 'OUT',  is_system: 0 },
    { name: 'Pajak',                  type: 'OUT',  is_system: 0 },
    { name: 'Pembelian Aset',         type: 'OUT',  is_system: 0 },
    { name: 'Prive Pemilik',          type: 'OUT',  is_system: 0 },
    { name: 'Pengeluaran Lainnya',    type: 'OUT',  is_system: 0 },
    { name: 'Pendapatan Lainnya',     type: 'IN',   is_system: 0 },
    { name: 'Pinjaman Masuk',         type: 'IN',   is_system: 0 },
    { name: 'Setoran Modal',          type: 'IN',   is_system: 0 },
    { name: 'Transfer Antar Kas/Bank',type: 'BOTH', is_system: 0 },
  ];
  try {
    for (const item of defaults) {
      await pool.query(
        `INSERT INTO cash_categories (name, type, is_system)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE type = VALUES(type), is_system = VALUES(is_system)`,
        [item.name, item.type, item.is_system]
      );
    }
    // Remove stale legacy categories
    await pool.query(`
      DELETE FROM cash_categories
      WHERE name IN ('Gaji','Lainnya') AND is_system = 0
        AND id NOT IN (
          SELECT id FROM (
            SELECT DISTINCT cc.id FROM cash_categories cc
            WHERE cc.name NOT IN (
              SELECT DISTINCT ct.category FROM cash_transactions ct WHERE ct.category IS NOT NULL
            )
          ) sub
        )
    `).catch(() => {}); // non-fatal
    console.log('[Startup] cash_categories seeded/upgraded successfully.');
  } catch (err) {
    console.error('[Startup] Failed to seed cash_categories:', err.message);
  }
})();

// Settings & Prefix Helpers
async function getSetting(key, defaultValue) {
  try {
    const res = await pool.query('SELECT value FROM settings WHERE `key` = ?', [key]);
    if (res.rows.length > 0) {
      return res.rows[0].value;
    }
  } catch (err) {
    console.error(`getSetting error for key ${key}:`, err);
  }
  return defaultValue;
}

/**
 * Returns true if payment type means instant settlement (Tunai / Transfer).
 * Any type whose name starts with 'Kredit' is treated as credit/tempo.
 */
async function isInstantPayment(payment_type_id) {
  try {
    const res = await pool.query('SELECT name FROM payment_types WHERE id = ?', [payment_type_id]);
    const name = (res.rows[0]?.name || '').toLowerCase();
    // Kredit X Hari = tempo; everything else (Tunai, Transfer) = instant
    return !name.startsWith('kredit');
  } catch (err) {
    return true; // default: treat as instant on error
  }
}

async function generateNextId(clientOrPool, tableName, prefixSetting) {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');

  let resolvedPrefix = prefixSetting || '';
  resolvedPrefix = resolvedPrefix
    .replace(/{YYYY}/g, yyyy)
    .replace(/{YY}/g, yy)
    .replace(/{MM}/g, mm);

  const query = `SELECT id FROM ${tableName} WHERE id LIKE $1`;
  const result = await clientOrPool.query(query, [resolvedPrefix + '%']);

  let maxNum = 0;
  for (const row of result.rows) {
    const idStr = row.id;
    if (idStr.startsWith(resolvedPrefix)) {
      const suffix = idStr.substring(resolvedPrefix.length);
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(6, '0');
  return resolvedPrefix + padded;
}

/**
 * Generates the next invoice ID using an atomic per-year counter.
 * Format: INV-{YYYY}-{MM}-{NNNNN}
 * - Sequence resets only on year change, NOT on month change.
 * - Uses LAST_INSERT_ID() trick for race-condition-safe increment.
 * - Must be called within an open transaction (pgify client), so rollback works.
 *
 * @param {object} pgClient  pgify-wrapped client from pool.connect()
 * @param {string} invoiceDate ISO date string of the invoice (e.g. '2026-09-28')
 * @returns {string} e.g. 'INV-2026-09-00001'
 */
async function generateInvoiceId(pgClient, invoiceDate) {
  const d = invoiceDate ? new Date(invoiceDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  // Atomic upsert: LAST_INSERT_ID(expr) sets the return value of LAST_INSERT_ID()
  await pgClient.query(
    `INSERT INTO invoice_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    [year]
  );

  // pgify wrapper returns { rows: [{next_number: N}] }
  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return `INV-${year}-${mm}-${padded}`;
}

/**
 * Generates the next payment reference number using an atomic per-year counter.
 * Format: PAY-{YYYY}-{MM}-{NNNNN}
 * - Sequence resets only on year change, NOT on month change.
 * - Uses LAST_INSERT_ID() trick for race-condition-safe increment.
 * - Must be called within an open transaction (pgify client), so rollback works.
 *
 * @param {object} pgClient pgify-wrapped client from pool.connect()
 * @param {string} paymentDate ISO date string of the payment (e.g. '2026-10-14')
 * @returns {string} e.g. 'PAY-2026-10-00001'
 */
async function generatePaymentNo(pgClient, paymentDate) {
  const d = paymentDate ? new Date(paymentDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    `INSERT INTO payment_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return `PAY-${year}-${mm}-${padded}`;
}

/**
 * Generates the next purchase order payment reference number using an atomic per-year counter.
 * Format: POP-{YYYY}-{MM}-{NNNNN}
 * - Resets only on year change, NOT on month change.
 * - Uses LAST_INSERT_ID() trick for race-condition-safe increment.
 *
 * @param {object} pgClient pgify-wrapped client from pool.connect()
 * @param {string} paymentDate ISO date string of the payment (e.g. '2026-11-21')
 * @returns {string} e.g. 'POP-2026-11-00001'
 */
async function generatePurchasePaymentNo(pgClient, paymentDate) {
  const d = paymentDate ? new Date(paymentDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    `INSERT INTO purchase_payment_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return `POP-${year}-${mm}-${padded}`;
}

/**
 * Generate Sales Return ID: RTJ-{YYYY}-{MM}-{NNNNN}
 */
async function generateSalesReturnId(pgClient, returnDate) {
  const d = returnDate ? new Date(returnDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    `INSERT INTO return_counters (year, last_sales_number, last_purchase_number) VALUES (?, LAST_INSERT_ID(1), 0)
     ON DUPLICATE KEY UPDATE last_sales_number = LAST_INSERT_ID(last_sales_number + 1)`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return `RTJ-${year}-${mm}-${padded}`;
}

/**
 * Generate Purchase Return ID: RTB-{YYYY}-{MM}-{NNNNN}
 */
async function generatePurchaseReturnId(pgClient, returnDate) {
  const d = returnDate ? new Date(returnDate) : new Date();
  const year = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  await pgClient.query(
    `INSERT INTO return_counters (year, last_sales_number, last_purchase_number) VALUES (?, 0, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_purchase_number = LAST_INSERT_ID(last_purchase_number + 1)`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return `RTB-${year}-${mm}-${padded}`;
}

/**
 * Generate Product Conversion ID: KNV-{YYYY}-{NNNNN}
 */
async function generateConversionNo(pgClient, conversionDate) {
  const d = conversionDate ? new Date(conversionDate) : new Date();
  const year = d.getFullYear();

  await pgClient.query(
    `INSERT INTO conversion_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return `KNV-${year}-${padded}`;
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

  const insertSql = `
    INSERT INTO stock_moves (
      product_id, tanggal, tipe, ref_type, ref_id, ref_no,
      qty_masuk, qty_keluar, qty_sebelum, qty_sesudah,
      keterangan, created_by, is_backfill
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

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
}

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Role Authorization Middleware
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Akses ditolak: Peran tidak teridentifikasi' });
    }
    const userRole = req.user.role.toLowerCase();
    const hasRole = allowedRoles.some(role => role.toLowerCase() === userRole);
    if (!hasRole) {
      return res.status(403).json({ error: `Akses ditolak: Peran '${req.user.role}' tidak memiliki hak akses` });
    }
    next();
  };
};

// ======================= API ROUTES =======================

// ─── Price & Cost Access Control Helpers ─────────────────────────────────────
// Role kasir tidak boleh menerima field HPP / harga pokok
const HPP_RESTRICTED_ROLES = ['kasir'];
function isHppRestricted(req) {
  return HPP_RESTRICTED_ROLES.includes((req.user?.role || '').toLowerCase());
}
function stripHppFields(row) {
  const r = { ...row };
  delete r.cost_price;
  delete r.cost_price_snapshot;
  delete r.hpp;
  delete r.cost;
  delete r.total_cost;
  delete r.total_stock_value;
  return r;
}

// Role gudang tidak boleh menerima field Harga Jual produk
const SELL_PRICE_RESTRICTED_ROLES = ['gudang'];
function isSellPriceRestricted(req) {
  return SELL_PRICE_RESTRICTED_ROLES.includes((req.user?.role || '').toLowerCase());
}
function stripSellPriceFields(row) {
  const r = { ...row };
  delete r.sell_price;
  delete r.harga_efektif;
  delete r.harga_master;
  delete r.harga_pricelist;
  return r;
}

function sanitizeProductRow(row, req) {
  let r = { ...row };
  if (isHppRestricted(req)) {
    r = stripHppFields(r);
  }
  if (isSellPriceRestricted(req)) {
    r = stripSellPriceFields(r);
  }
  return r;
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Health Check Endpoints (tanpa auth, untuk diagnostik hosting) ───────────
// Buka di browser: https://yourdomain.com/health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Express.js running',
    port: process.env.PORT || 3000,
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    time: new Date().toISOString()
  });
});

// Buka di browser: https://yourdomain.com/api/health
app.get('/api/health', async (req, res) => {
  const info = {
    status: 'ok',
    server: 'Express.js running',
    port: process.env.PORT || 3000,
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    time: new Date().toISOString(),
    db_host: process.env.DB_HOST || process.env.DATABASE_URL ? '(set)' : '(not set)',
    db_name: process.env.DB_NAME || '(not set)',
    db_user: process.env.DB_USER || '(not set)',
    db: 'checking...'
  };
  try {
    await pool.query('SELECT 1');
    info.db = 'connected ✓';
    res.json(info);
  } catch (err) {
    info.db = `FAILED: ${err.code} — ${err.message}`;
    info.status = 'degraded';
    res.status(503).json(info);
  }
});

app.get('/api/transactions/count', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM sales_invoices');
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND active = true', [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error_code: 'INVALID_CREDENTIALS', error: 'Username atau password salah' });
    }

    const isMatch = await verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error_code: 'INVALID_CREDENTIALS', error: 'Username atau password salah' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name }, SECRET_KEY, { expiresIn: '24h' });
    res.json({ token, role: user.role, username: user.username, name: user.name });
  } catch (err) {
    console.error('[LOGIN ERROR]', err.message);
    // Detect DB connection errors specifically
    const isDbError = err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR'
      || err.code === 'ER_BAD_DB_ERROR' || err.code === 'ENOTFOUND'
      || err.code === 'ETIMEDOUT' || err.code === 'ER_NO_DB_ERROR';
    if (isDbError) {
      return res.status(503).json({
        error_code: 'DB_CONNECTION_ERROR',
        error: `Koneksi database gagal (${err.code}): ${err.message}`
      });
    }
    res.status(500).json({ error_code: 'SERVER_ERROR', error: err.message });
  }
});

// PUT /api/auth/change-password — Ganti Password Sendiri untuk SEMUA role
app.put('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { password_lama, password_baru, konfirmasi_password } = req.body;
  const userId = req.user && req.user.id;

  if (!userId) {
    return res.status(401).json({ error: 'Sesi tidak valid, silakan login ulang' });
  }

  // 1. Validasi keberadaan semua field
  if (
    !password_lama || !password_baru || !konfirmasi_password ||
    typeof password_lama !== 'string' || typeof password_baru !== 'string' || typeof konfirmasi_password !== 'string' ||
    password_lama.trim() === '' || password_baru.trim() === '' || konfirmasi_password.trim() === ''
  ) {
    return res.status(400).json({ error: 'Semua field wajib diisi' });
  }

  // 2. Validasi panjang minimal password baru (8 karakter)
  if (password_baru.length < 8) {
    return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
  }

  // 3. Validasi password baru tidak boleh sama dengan password lama
  if (password_baru === password_lama) {
    return res.status(400).json({ error: 'Password baru tidak boleh sama dengan password lama' });
  }

  // 4. Validasi kecocokan konfirmasi password
  if (password_baru !== konfirmasi_password) {
    return res.status(400).json({ error: 'Konfirmasi password tidak cocok' });
  }

  try {
    // Ambil user dari database berdasarkan ID dari token
    const userRes = await pool.query('SELECT id, password_hash, active FROM users WHERE id = $1', [userId]);
    const user = userRes.rows && userRes.rows[0];

    if (!user || !user.active) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan atau nonaktif' });
    }

    // 5. Verifikasi password lama cocok dengan hash di DB
    const isOldMatch = await verifyPassword(password_lama, user.password_hash);
    if (!isOldMatch) {
      return res.status(400).json({ error: 'Password lama salah' });
    }

    // 6. Hash password baru dengan helper bersama
    const newHash = await hashPassword(password_baru);

    // 7. Update database baris user ini saja
    const updateRes = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
    const affected = updateRes.affectedRows || updateRes.rowCount || 0;

    if (affected !== 1) {
      return res.status(500).json({ error: 'Gagal memperbarui password di database' });
    }

    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (err) {
    console.error('[CHANGE PASSWORD ERROR]', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan saat mengganti password' });
  }
});

// --- Master Data Routes ---
app.get('/api/master/product-categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM product_categories');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master/product-units', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM product_units');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master/customer-categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customer_categories');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master/vendor-categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vendor_categories');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master/payment-types', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payment_types');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master/cash-categories', authenticateToken, async (req, res) => {
  try {
    const { type } = req.query;
    let query = 'SELECT * FROM cash_categories';
    const params = [];
    if (type) {
      query += ' WHERE type = $1 OR type = \'BOTH\' ORDER BY id ASC';
      params.push(type);
    } else {
      query += ' ORDER BY id ASC';
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cash-categories', authenticateToken, async (req, res) => {
  const { type } = req.query;
  try {
    let query = 'SELECT * FROM cash_categories';
    let params = [];
    if (type) {
      query += ' WHERE type IN ($1, $2) ORDER BY id ASC';
      params = [type, 'BOTH'];
    } else {
      query += ' ORDER BY id ASC';
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Master Data CRUD (POST, PUT, DELETE) ---
const MASTER_TABLE_WHITELIST = {
  product_categories: 'product_categories',
  product_units: 'product_units',
  customer_categories: 'customer_categories',
  vendor_categories: 'vendor_categories',
  payment_types: 'payment_types',
  cash_categories: 'cash_categories'   // serial PK — handled specially below
};

app.post('/api/master/:type', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const tableName = MASTER_TABLE_WHITELIST[req.params.type];
  if (!tableName) return res.status(400).json({ error: 'Tipe master data tidak valid' });
  const { id, name, type, is_system } = req.body;
  if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });
  try {
    let newId;
    if (tableName === 'cash_categories') {
      // AUTO_INCREMENT PK — let DB assign
      const result = await pool.query(
        `INSERT INTO cash_categories (name, type, is_system) VALUES (?, ?, ?)`,
        [name, type || 'BOTH', is_system ? 1 : 0]
      );
      newId = result.insertId;
    } else {
      newId = id || req.params.type.toUpperCase().slice(0, 2) + '-' + Date.now();
      await pool.query(
        `INSERT INTO ${tableName} (id, name) VALUES (?, ?)`,
        [newId, name]
      );
    }
    res.json({ success: true, id: newId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/master/:type/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const tableName = MASTER_TABLE_WHITELIST[req.params.type];
  if (!tableName) return res.status(400).json({ error: 'Tipe master data tidak valid' });
  const { name, type, is_system } = req.body;
  if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });
  try {
    let result;
    if (tableName === 'cash_categories') {
      result = await pool.query(
        `UPDATE cash_categories SET name=?, type=?, is_system=? WHERE id=?`,
        [name, type || 'BOTH', is_system ? 1 : 0, parseInt(req.params.id)]
      );
    } else {
      result = await pool.query(`UPDATE ${tableName} SET name=? WHERE id=?`, [name, req.params.id]);
    }
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/master/:type/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const tableName = MASTER_TABLE_WHITELIST[req.params.type];
  if (!tableName) return res.status(400).json({ error: 'Tipe master data tidak valid' });
  try {
    // Prevent deleting system categories
    if (tableName === 'cash_categories') {
      const check = await pool.query('SELECT is_system FROM cash_categories WHERE id=?', [parseInt(req.params.id)]);
      if (check.rows[0]?.is_system) return res.status(403).json({ error: 'Kategori sistem tidak dapat dihapus.' });
    }
    const idVal = tableName === 'cash_categories' ? parseInt(req.params.id) : req.params.id;
    const result = await pool.query(`DELETE FROM ${tableName} WHERE id=?`, [idVal]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      res.status(409).json({ error: 'Data masih digunakan dan tidak dapat dihapus.' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

// --- Public Landing Status (no JWT required) ---
app.get('/api/public/landing-status', async (req, res) => {
  try {
    const val = await getSetting('tampilkan_landing_demo', 'true');
    res.json({ tampilkan_landing_demo: val !== 'false' });
  } catch (err) {
    res.json({ tampilkan_landing_demo: true });
  }
});

// --- Admin: update landing demo toggle ---
app.put('/api/pengaturan/landing-demo', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { tampilkan_landing_demo } = req.body;
  if (typeof tampilkan_landing_demo !== 'boolean') {
    return res.status(400).json({ error: 'Parameter tampilkan_landing_demo harus boolean' });
  }
  try {
    await pool.query(
      'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['tampilkan_landing_demo', tampilkan_landing_demo ? 'true' : 'false']
    );
    res.json({ success: true, tampilkan_landing_demo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings Routes ---
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings');
    const settingsMap = {};
    result.rows.forEach(r => {
      settingsMap[r.key] = r.value;
    });
    res.json(settingsMap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const settings = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [key, String(value)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Dashboard & Summary Routes ---
app.get('/api/dashboard/summary', authenticateToken, async (req, res) => {
  try {
    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);
    const canSeePayables = ['admin', 'gudang', 'owner'].includes(role);
    const canSeeOrders = ['admin', 'finance', 'kasir', 'owner'].includes(role);
    const canSeeCustomers = ['admin', 'finance', 'kasir', 'owner'].includes(role);
    const canSeeProducts = ['admin', 'gudang', 'kasir', 'finance', 'owner'].includes(role);

    // Stok menipis - HANYA produk aktif (A1 & A2)
    const lowStockResult = await pool.query('SELECT id, name, stock, min_stock FROM products WHERE (is_active = 1 OR is_active IS NULL) AND stock <= min_stock ORDER BY stock ASC');
    const lowStockProducts = lowStockResult.rows;

    let revenue = 0, receivables = 0, payables = 0, grossProfit = 0, unpaidCount = 0;
    if (canSeePayables) {
      // Hutang ke vendor - PO yang belum selesai
      const payablesResult = await pool.query("SELECT SUM(total - paid_amount - COALESCE(return_amount, 0)) as payables FROM purchase_orders WHERE status NOT IN ('Selesai', 'Batal', 'Cancel', 'Dibatalkan')");
      payables = parseFloat(payablesResult.rows[0]?.payables || 0);
    }

    if (canSeeFinance) {
      // Revenue (omzet) - semua invoice yang tidak batal
      const revenueResult = await pool.query("SELECT SUM(total) as revenue FROM sales_invoices WHERE status NOT IN ('Batal', 'Cancel', 'Dibatalkan')");
      revenue = parseFloat(revenueResult.rows[0]?.revenue || 0);

      // Piutang - invoice yang belum lunas
      const receivablesResult = await pool.query("SELECT SUM(total - paid_amount - COALESCE(return_amount, 0)) as receivables FROM sales_invoices WHERE status NOT IN ('Lunas', 'Batal', 'Cancel', 'Dibatalkan')");
      receivables = parseFloat(receivablesResult.rows[0]?.receivables || 0);

      // Laba Kotor (Revenue - HPP)
      const hppResult = await pool.query(`
        SELECT COALESCE(SUM(ii.quantity * p.cost_price), 0) as hpp
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN sales_invoices si ON ii.invoice_id = si.id
        WHERE si.status NOT IN ('Batal', 'Cancel', 'Dibatalkan')
      `);
      const hpp = parseFloat(hppResult.rows[0]?.hpp || 0);
      grossProfit = revenue - hpp;

      // Jumlah invoice belum lunas (untuk badge piutang)
      const unpaidCountResult = await pool.query("SELECT COUNT(*) as count FROM sales_invoices WHERE status NOT IN ('Lunas', 'Batal', 'Cancel', 'Dibatalkan')");
      unpaidCount = parseInt(unpaidCountResult.rows[0]?.count || 0);
    }

    let ordersToday = 0;
    if (canSeeOrders) {
      const today = new Date().toISOString().split('T')[0];
      const ordersTodayResult = await pool.query("SELECT COUNT(*) as count FROM sales_invoices WHERE DATE(date) = ? AND status NOT IN ('Batal', 'Cancel', 'Dibatalkan')", [today]);
      ordersToday = parseInt(ordersTodayResult.rows[0]?.count || 0);
    }

    let customerCount = 0;
    if (canSeeCustomers) {
      const customersResult = await pool.query('SELECT COUNT(*) as count FROM customers');
      customerCount = parseInt(customersResult.rows[0]?.count || 0);
    }

    let productCount = 0;
    if (canSeeProducts) {
      const productsResult = await pool.query('SELECT COUNT(*) as count FROM products WHERE (is_active = 1 OR is_active IS NULL)');
      productCount = parseInt(productsResult.rows[0]?.count || 0);
    }

    // Bangun response sesuai peran (A7: dashboard per role)
    const responseData = {
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
    };

    if (canSeeFinance) {
      responseData.revenue = revenue;
      responseData.receivables = receivables;
      responseData.payables = payables;
      responseData.grossProfit = grossProfit;
      responseData.unpaidCount = unpaidCount;
    }

    if (canSeeOrders) {
      responseData.ordersToday = ordersToday;
    }

    if (canSeeCustomers) {
      responseData.customerCount = customerCount;
    }

    if (canSeeProducts) {
      responseData.productCount = productCount;
    }

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/sales-trend', authenticateToken, authorizeRoles('admin', 'finance', 'owner'), async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  try {
    const query = `
      SELECT 
        DATE(date) AS tanggal,
        COALESCE(SUM(total), 0) AS total_penjualan,
        COUNT(*) AS jumlah_transaksi
      FROM sales_invoices
      WHERE DATE(date) >= DATE_SUB(CURDATE(), INTERVAL ? - 1 DAY)
        AND status NOT IN ('Dibatalkan', 'Batal', 'Cancel')
      GROUP BY DATE(date)
      ORDER BY DATE(date) ASC
    `;
    const result = await pool.query(query, [days]);

    // Generate dates in YYYY-MM-DD
    const resultDates = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dateVal = String(d.getDate()).padStart(2, '0');
      resultDates.push(`${y}-${m}-${dateVal}`);
    }

    const dataMap = {};
    resultDates.forEach(dateStr => {
      dataMap[dateStr] = {
        tanggal: dateStr,
        total_penjualan: 0,
        jumlah_transaksi: 0
      };
    });

    const formatDateKey = (val) => {
      if (!val) return '';
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val).split('T')[0];
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dateVal = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dateVal}`;
    };

    for (const row of result.rows) {
      const dateKey = formatDateKey(row.tanggal);
      if (dataMap[dateKey]) {
        dataMap[dateKey].total_penjualan = parseFloat(row.total_penjualan) || 0;
        dataMap[dateKey].jumlah_transaksi = parseInt(row.jumlah_transaksi) || 0;
      }
    }

    const finalData = resultDates.map(dateStr => dataMap[dateStr]);
    res.json(finalData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/sales-composition', authenticateToken, authorizeRoles('admin', 'finance', 'owner'), async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  try {
    // MySQL: compute total first, then calculate percentages
    const rawQuery = `
      SELECT 
        pc.name AS kategori,
        COALESCE(SUM(ii.quantity * ii.price), 0) AS total_nilai
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      JOIN product_categories pc ON pc.id = p.category_id
      JOIN sales_invoices si ON si.id = ii.invoice_id
      WHERE DATE(si.date) >= DATE_SUB(CURDATE(), INTERVAL ? - 1 DAY)
        AND si.status NOT IN ('Dibatalkan', 'Batal', 'Cancel')
      GROUP BY pc.name
      ORDER BY total_nilai DESC
    `;
    const result = await pool.query(rawQuery, [days]);
    const grandTotal = result.rows.reduce((s, r) => s + parseFloat(r.total_nilai || 0), 0);
    const finalData = result.rows.map(row => ({
      kategori: row.kategori,
      total_nilai: parseFloat(row.total_nilai) || 0,
      persentase: grandTotal > 0 ? Math.round((parseFloat(row.total_nilai || 0) / grandTotal) * 1000) / 10 : 0
    }));
    res.json(finalData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// --- Products Routes ---
app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const { customer_id, page, limit: limitQ, q, search, category, stock_status, status, paginate, all, sort } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';

    const PRODUCT_SORT_MAP = {
      name_asc: "CASE WHEN p.name IS NULL OR p.name = '' THEN 1 ELSE 0 END, LOWER(p.name) ASC, p.id ASC",
      name_desc: "CASE WHEN p.name IS NULL OR p.name = '' THEN 1 ELSE 0 END, LOWER(p.name) DESC, p.id ASC",
      sku_asc: "CASE WHEN p.sku IS NULL OR p.sku = '' THEN 1 ELSE 0 END, LOWER(REGEXP_REPLACE(p.sku, '[0-9]+$', '')) ASC, CASE WHEN p.sku REGEXP '[0-9]+$' THEN 0 ELSE 1 END, CAST(REGEXP_SUBSTR(p.sku, '[0-9]+$') AS UNSIGNED) ASC, LOWER(p.sku) ASC, LOWER(p.name) ASC, p.id ASC",
      sku_desc: "CASE WHEN p.sku IS NULL OR p.sku = '' THEN 1 ELSE 0 END, LOWER(REGEXP_REPLACE(p.sku, '[0-9]+$', '')) DESC, CASE WHEN p.sku REGEXP '[0-9]+$' THEN 0 ELSE 1 END, CAST(REGEXP_SUBSTR(p.sku, '[0-9]+$') AS UNSIGNED) DESC, LOWER(p.sku) DESC, LOWER(p.name) ASC, p.id ASC",
      category_asc: "CASE WHEN c.name IS NULL OR c.name = '' THEN 1 ELSE 0 END, LOWER(c.name) ASC, LOWER(p.name) ASC, p.id ASC",
      category_desc: "CASE WHEN c.name IS NULL OR c.name = '' THEN 1 ELSE 0 END, LOWER(c.name) DESC, LOWER(p.name) ASC, p.id ASC",
      stock_asc: "p.stock ASC, LOWER(p.name) ASC, p.id ASC",
      stock_desc: "p.stock DESC, LOWER(p.name) ASC, p.id ASC"
    };
    const sortClause = PRODUCT_SORT_MAP[sort] || "p.name ASC, p.id ASC";

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern, pattern);
    }

    if (category && category !== 'all') {
      whereConditions.push('(c.name = ? OR p.category_id = ?)');
      params.push(category, category);
    }

    if (stock_status === 'low') {
      whereConditions.push('p.stock <= p.min_stock');
    } else if (stock_status === 'safe') {
      whereConditions.push('p.stock > p.min_stock');
    }

    // A2.2 Filter status: active (default), inactive, all
    if (status === 'inactive') {
      whereConditions.push('p.is_active = 0');
    } else if (status === 'all') {
      // Tidak ada filter status
    } else {
      // Default: hanya produk aktif
      whereConditions.push('(p.is_active = 1 OR p.is_active IS NULL)');
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      const countSql = `
        SELECT 
          COUNT(*) as total,
          COALESCE(SUM(p.stock * p.cost_price), 0) AS total_stock_value
        FROM products p 
        LEFT JOIN product_categories c ON p.category_id = c.id
        ${whereClause}
      `;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);
      const totalStockValue = parseFloat(countRes.rows[0]?.total_stock_value || 0);

      let dataSql;
      let dataParams = [...params];
      if (customer_id) {
        dataSql = `
          SELECT 
            p.*, 
            c.name as category, 
            u.name as unit,
            pi.harga AS harga_pricelist,
            COALESCE(pi.harga, p.sell_price) AS harga_efektif,
            CASE WHEN pi.harga IS NOT NULL THEN 'pricelist' ELSE 'master' END AS sumber_harga,
            pl.id AS pricelist_id,
            pl.nama AS pricelist_nama,
            pl.kode AS pricelist_kode,
            (
              EXISTS(SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id) OR
              EXISTS(SELECT 1 FROM purchase_order_items poi WHERE poi.product_id = p.id) OR
              EXISTS(SELECT 1 FROM proforma_items pfi WHERE pfi.product_id = p.id)
            ) AS has_transactions,
            EXISTS(SELECT 1 FROM pricelist_items pli WHERE pli.product_id = p.id) AS has_pricelists
          FROM products p 
          LEFT JOIN product_categories c ON p.category_id = c.id 
          LEFT JOIN product_units u ON p.unit_id = u.id
          LEFT JOIN customers cust ON cust.id = ?
          LEFT JOIN pricelists pl ON pl.id = cust.pricelist_id AND pl.is_active = 1
          LEFT JOIN pricelist_items pi ON pi.pricelist_id = pl.id AND pi.product_id = p.id
          ${whereClause}
          ORDER BY ${sortClause}
          LIMIT ? OFFSET ?
        `;
        dataParams = [customer_id, ...params, limitNum, offset];
      } else {
        dataSql = `
          SELECT 
            p.*, 
            c.name as category, 
            u.name as unit,
            NULL AS harga_pricelist,
            p.sell_price AS harga_efektif,
            'master' AS sumber_harga,
            NULL AS pricelist_id,
            NULL AS pricelist_nama,
            NULL AS pricelist_kode,
            (
              EXISTS(SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id) OR
              EXISTS(SELECT 1 FROM purchase_order_items poi WHERE poi.product_id = p.id) OR
              EXISTS(SELECT 1 FROM proforma_items pfi WHERE pfi.product_id = p.id)
            ) AS has_transactions,
            EXISTS(SELECT 1 FROM pricelist_items pli WHERE pli.product_id = p.id) AS has_pricelists
          FROM products p 
          LEFT JOIN product_categories c ON p.category_id = c.id 
          LEFT JOIN product_units u ON p.unit_id = u.id
          ${whereClause}
          ORDER BY ${sortClause}
          LIMIT ? OFFSET ?
        `;
        dataParams = [...params, limitNum, offset];
      }

      const result = await pool.query(dataSql, dataParams);
      const hppRestricted = isHppRestricted(req);
      const sanitizedRows = result.rows.map(r => sanitizeProductRow(r, req));
      return res.json({
        data: sanitizedRows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        },
        summary: {
          totalStockValue: hppRestricted ? undefined : totalStockValue
        }
      });
    }

    // Unpaginated path (for backward compatibility: dropdowns, POS, test scripts)
    let result;
    if (customer_id) {
      result = await pool.query(`
        SELECT 
          p.*, 
          c.name as category, 
          u.name as unit,
          pi.harga AS harga_pricelist,
          COALESCE(pi.harga, p.sell_price) AS harga_efektif,
          CASE WHEN pi.harga IS NOT NULL THEN 'pricelist' ELSE 'master' END AS sumber_harga,
          pl.id AS pricelist_id,
          pl.nama AS pricelist_nama,
          pl.kode AS pricelist_kode,
          (
            EXISTS(SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id) OR
            EXISTS(SELECT 1 FROM purchase_order_items poi WHERE poi.product_id = p.id) OR
            EXISTS(SELECT 1 FROM proforma_items pfi WHERE pfi.product_id = p.id)
          ) AS has_transactions,
          EXISTS(SELECT 1 FROM pricelist_items pli WHERE pli.product_id = p.id) AS has_pricelists
        FROM products p 
        LEFT JOIN product_categories c ON p.category_id = c.id 
        LEFT JOIN product_units u ON p.unit_id = u.id
        LEFT JOIN customers cust ON cust.id = ?
        LEFT JOIN pricelists pl ON pl.id = cust.pricelist_id AND pl.is_active = 1
        LEFT JOIN pricelist_items pi ON pi.pricelist_id = pl.id AND pi.product_id = p.id
        ${whereClause}
        ORDER BY ${sortClause}
      `, [customer_id, ...params]);
    } else {
      result = await pool.query(`
        SELECT 
          p.*, 
          c.name as category, 
          u.name as unit,
          NULL AS harga_pricelist,
          p.sell_price AS harga_efektif,
          'master' AS sumber_harga,
          NULL AS pricelist_id,
          NULL AS pricelist_nama,
          NULL AS pricelist_kode,
          (
            EXISTS(SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id) OR
            EXISTS(SELECT 1 FROM purchase_order_items poi WHERE poi.product_id = p.id) OR
            EXISTS(SELECT 1 FROM proforma_items pfi WHERE pfi.product_id = p.id)
          ) AS has_transactions,
          EXISTS(SELECT 1 FROM pricelist_items pli WHERE pli.product_id = p.id) AS has_pricelists
        FROM products p 
        LEFT JOIN product_categories c ON p.category_id = c.id 
        LEFT JOIN product_units u ON p.unit_id = u.id
        ${whereClause}
        ORDER BY ${sortClause}
      `, params);
    }
    // Sanitize product rows for restricted roles (kasir: no HPP, gudang: no sell_price)
    res.json(result.rows.map(r => sanitizeProductRow(r, req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT p.*, c.name as category, u.name as unit 
      FROM products p 
      LEFT JOIN product_categories c ON p.category_id = c.id 
      LEFT JOIN product_units u ON p.unit_id = u.id
      WHERE p.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    const productRow = sanitizeProductRow(result.rows[0], req);
    res.json(productRow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id, sku, brand, name, category_id, cost_price, sell_price, stock, min_stock, unit_id } = req.body;
  const brandVal = (brand !== undefined && brand !== null && String(brand).trim() !== '') ? String(brand).trim() : null;
  const insertQuery = 'INSERT INTO products (id, sku, brand, name, category_id, cost_price, sell_price, stock, min_stock, unit_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)';
  try {
    const prefix = await getSetting('prefix_product', 'P');
    const nextId = await generateNextId(pool, 'products', prefix);
    const targetId = id || nextId;
    const targetCostPrice = isHppRestricted(req) ? 0 : (parseFloat(cost_price) || 0);
    const targetSellPrice = isSellPriceRestricted(req) ? 0 : (parseFloat(sell_price) || 0);
    await pool.query(insertQuery, [targetId, sku, brandVal, name, category_id, targetCostPrice, targetSellPrice, stock, min_stock, unit_id || 'PU-1']);
    if (parseFloat(stock || 0) > 0) {
      await recordStockMove(pool, {
        product_id: targetId,
        tipe: 'stok_awal',
        ref_type: 'product',
        ref_id: targetId,
        ref_no: sku || targetId,
        qty_masuk: parseFloat(stock),
        qty_keluar: 0,
        qty_sebelum: 0,
        qty_sesudah: parseFloat(stock),
        keterangan: 'Stok Awal Produk Baru',
        created_by: req.user?.id
      });
    }
    res.json({ success: true, message: 'Produk berhasil ditambahkan' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/products/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  const { sku, brand, name, category_id, cost_price, sell_price, stock, min_stock, unit_id } = req.body;
  const brandVal = (brand !== undefined && brand !== null && String(brand).trim() !== '') ? String(brand).trim() : null;
  const updateQuery = 'UPDATE products SET sku = $1, brand = $2, name = $3, category_id = $4, cost_price = $5, sell_price = $6, stock = $7, min_stock = $8, unit_id = $9 WHERE id = $10';
  try {
    const curRes = await pool.query('SELECT stock, cost_price, sell_price FROM products WHERE id = $1', [id]);
    if (curRes.rows.length === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    const oldStock = parseFloat(curRes.rows[0]?.stock || 0);
    const newStock = parseFloat(stock !== undefined ? stock : oldStock);
    const targetCostPrice = (isHppRestricted(req) || cost_price === undefined) ? curRes.rows[0].cost_price : cost_price;
    const targetSellPrice = (isSellPriceRestricted(req) || sell_price === undefined) ? curRes.rows[0].sell_price : sell_price;
    const result = await pool.query(updateQuery, [sku, brandVal, name, category_id, targetCostPrice, targetSellPrice, stock, min_stock, unit_id, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    if (newStock !== oldStock) {
      const diff = newStock - oldStock;
      await recordStockMove(pool, {
        product_id: id,
        tipe: 'koreksi_edit',
        ref_type: 'product',
        ref_id: id,
        ref_no: sku || id,
        qty_masuk: diff > 0 ? diff : 0,
        qty_keluar: diff < 0 ? Math.abs(diff) : 0,
        qty_sebelum: oldStock,
        qty_sesudah: newStock,
        keterangan: 'Edit Produk langsung (stok diubah manual)',
        created_by: req.user?.id
      });
    }
    res.json({ success: true, message: 'Produk berhasil diperbarui' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  try {
    // A2.1: Proteksi delete - periksa riwayat transaksi
    const invCheck = await pool.query('SELECT 1 FROM invoice_items WHERE product_id = ? LIMIT 1', [id]);
    const poCheck = await pool.query('SELECT 1 FROM purchase_order_items WHERE product_id = ? LIMIT 1', [id]);
    const profCheck = await pool.query('SELECT 1 FROM proforma_items WHERE product_id = ? LIMIT 1', [id]);

    if ((invCheck.rows && invCheck.rows.length > 0) || (poCheck.rows && poCheck.rows.length > 0) || (profCheck.rows && profCheck.rows.length > 0)) {
      return res.status(400).json({ error: 'Produk sudah memiliki riwayat transaksi, gunakan Nonaktifkan' });
    }

    // Jika produk terdaftar di Special Price (pricelist), hapus baris harga tersebut
    await pool.query('DELETE FROM pricelist_items WHERE product_id = ?', [id]);

    const result = await pool.query('DELETE FROM products WHERE id = ?', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json({ success: true, message: 'Produk berhasil dihapus' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
      return res.status(400).json({ error: 'Produk sudah memiliki riwayat transaksi, gunakan Nonaktifkan' });
    }
    res.status(400).json({ error: err.message });
  }
});

// A2.2: Nonaktifkan / Aktifkan produk
app.patch('/api/products/:id/status', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  try {
    const activeVal = (is_active === 1 || is_active === true || is_active === '1') ? 1 : 0;
    const result = await pool.query('UPDATE products SET is_active = ? WHERE id = ?', [activeVal, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json({ success: true, is_active: activeVal, message: `Produk berhasil ${activeVal ? 'diaktifkan' : 'dinonaktifkan'}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Stock Adjust (Stock Opname) ---
app.post('/api/stock-adjust', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { product_id, actual_stock, note } = req.body;
  if (!product_id || actual_stock === undefined || actual_stock === null) {
    return res.status(400).json({ error: 'product_id dan actual_stock wajib diisi' });
  }
  const newStock = parseFloat(actual_stock);
  if (isNaN(newStock) || newStock < 0) {
    return res.status(400).json({ error: 'actual_stock harus angka non-negatif' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, stock, name, cost_price FROM products WHERE id = $1', [product_id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    const oldStock = parseFloat(existing.rows[0].stock || 0);
    const productName = existing.rows[0].name;
    const costPrice = parseFloat(existing.rows[0].cost_price || 0);

    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [newStock, product_id]);

    // Tentukan tipe dan jumlah berdasarkan selisih stok
    const diff = newStock - oldStock;
    const txType = diff >= 0 ? 'IN' : 'OUT';
    const amount = Math.abs(diff) * costPrice;
    const keterangan = diff > 0 ? 'tambah banyak' : diff < 0 ? 'Menyusut' : 'tidak berubah';

    const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
    const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
    const ctDate = new Date().toISOString().split('T')[0];
    const desc = `Stock Opname: [${product_id}] ${productName} | Sebelum: ${oldStock} → Sesudah: ${newStock} | ${keterangan}${note ? ' | ' + note : ''}`;
    const userId = req.user.id;

    await client.query(
      'INSERT INTO cash_transactions (id, date, type, category, description, amount, method, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctId, ctDate, txType, 'Penyesuaian Stok', desc, amount, 'Stock Opname', userId]
    );
    await recordStockMove(client, {
      product_id: product_id,
      tanggal: ctDate ? ctDate + ' 12:00:00' : null,
      tipe: 'opname',
      ref_type: 'stock_adjustment',
      ref_id: ctId,
      ref_no: ctId,
      qty_masuk: diff > 0 ? diff : 0,
      qty_keluar: diff < 0 ? Math.abs(diff) : 0,
      qty_sebelum: oldStock,
      qty_sesudah: newStock,
      keterangan: desc,
      created_by: userId
    });
    await client.query('COMMIT');
    res.json({ success: true, old_stock: oldStock, new_stock: newStock, type: txType, amount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Customers Routes ---
// Reusable calculated-fields query fragment (MySQL-compatible)
const CUSTOMER_SELECT_SQL = `
  SELECT
    c.*,
    c.tipe_pembayaran_id AS payment_type_id,
    cc.name AS category_name,
    pl.nama AS pricelist_name,
    pl.kode AS pricelist_kode,
    pt.name AS tipe_pembayaran_name,
    pt.name AS payment_type_name,
    COALESCE(SUM(CASE WHEN si.status NOT IN ('Batal', 'Cancel', 'Dibatalkan') THEN si.total ELSE 0 END), 0) AS total_belanja,
    COALESCE(SUM(CASE WHEN si.status NOT IN ('Lunas','Batal','Cancel','Dibatalkan') THEN si.total - si.paid_amount ELSE 0 END), 0) AS total_piutang_berjalan,
    c.credit_lmt - COALESCE(SUM(CASE WHEN si.status NOT IN ('Lunas','Batal','Cancel','Dibatalkan') THEN si.total - si.paid_amount ELSE 0 END), 0) AS sisa_limit_piutang
  FROM customers c
  LEFT JOIN customer_categories cc ON c.customer_category_id = cc.id
  LEFT JOIN pricelists pl ON c.pricelist_id = pl.id
  LEFT JOIN payment_types pt ON c.tipe_pembayaran_id = pt.id
  LEFT JOIN sales_invoices si ON si.customer_id = c.id
`;

app.get('/api/customers', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'owner'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, category, type, paginate, all, sort } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';

    const CUSTOMER_SORT_MAP = {
      name_asc: "CASE WHEN c.name IS NULL OR c.name = '' THEN 1 ELSE 0 END, LOWER(c.name) ASC, c.id ASC",
      name_desc: "CASE WHEN c.name IS NULL OR c.name = '' THEN 1 ELSE 0 END, LOWER(c.name) DESC, c.id ASC",
      id_asc: "CASE WHEN c.id IS NULL OR c.id = '' THEN 1 ELSE 0 END, LOWER(REGEXP_REPLACE(c.id, '[0-9]+$', '')) ASC, CASE WHEN c.id REGEXP '[0-9]+$' THEN 0 ELSE 1 END, CAST(REGEXP_SUBSTR(c.id, '[0-9]+$') AS UNSIGNED) ASC, c.id ASC",
      id_desc: "CASE WHEN c.id IS NULL OR c.id = '' THEN 1 ELSE 0 END, LOWER(REGEXP_REPLACE(c.id, '[0-9]+$', '')) DESC, CASE WHEN c.id REGEXP '[0-9]+$' THEN 0 ELSE 1 END, CAST(REGEXP_SUBSTR(c.id, '[0-9]+$') AS UNSIGNED) DESC, c.id DESC",
      type_asc: "CASE WHEN cc.name IS NULL OR cc.name = '' THEN 1 ELSE 0 END, LOWER(cc.name) ASC, LOWER(c.name) ASC, c.id ASC",
      type_desc: "CASE WHEN cc.name IS NULL OR cc.name = '' THEN 1 ELSE 0 END, LOWER(cc.name) DESC, LOWER(c.name) ASC, c.id ASC",
      total_belanja_asc: "total_belanja ASC, LOWER(c.name) ASC, c.id ASC",
      total_belanja_desc: "total_belanja DESC, LOWER(c.name) ASC, c.id ASC"
    };
    const sortClause = CUSTOMER_SORT_MAP[sort] || "c.name ASC, c.id ASC";

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(c.name LIKE ? OR c.phone LIKE ? OR c.id LIKE ? OR c.city LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const catQuery = (type || category || '').trim();
    if (catQuery && catQuery !== 'all') {
      whereConditions.push('(cc.name = ? OR c.customer_category_id = ?)');
      params.push(catQuery, catQuery);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      const countSql = `
        SELECT COUNT(DISTINCT c.id) AS total
        FROM customers c
        LEFT JOIN customer_categories cc ON c.customer_category_id = cc.id
        ${whereClause}
      `;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);

      const dataSql = CUSTOMER_SELECT_SQL + `
        ${whereClause}
        GROUP BY c.id, cc.name, pl.nama, pl.kode, pt.name
        ORDER BY ${sortClause}
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...params, limitNum, offset];
      const result = await pool.query(dataSql, dataParams);

      return res.json({
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        }
      });
    }

    const result = await pool.query(
      CUSTOMER_SELECT_SQL + `
      ${whereClause}
      GROUP BY c.id, cc.name, pl.nama, pl.kode, pt.name
      ORDER BY ${sortClause}
    `, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/search', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'owner'), async (req, res) => {
  const { q } = req.query;
  const pattern = `%${q || ''}%`;
  try {
    const result = await pool.query(
      CUSTOMER_SELECT_SQL +
      ` WHERE (c.name LIKE ? OR c.phone LIKE ? OR c.id LIKE ?)
        GROUP BY c.id, cc.name, pl.nama, pl.kode, pt.name
        ORDER BY c.name ASC
        LIMIT 20`,
      [pattern, pattern, pattern]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:id', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'owner'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      CUSTOMER_SELECT_SQL + ' WHERE c.id = $1 GROUP BY c.id, cc.name, pl.nama, pl.kode, pt.name',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', authenticateToken, authorizeRoles('admin', 'kasir', 'owner'), async (req, res) => {
  const { name, customer_category_id, pricelist_id, tipe_pembayaran_id, payment_type_id, phone, city, address, credit_lmt, ktp, npwp, npwp_name, npwp_address, nib, email, no_hp_2 } = req.body;

  // Validasi backend
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama pelanggan wajib diisi' });
  if (ktp && !/^\d{16}$/.test(ktp)) return res.status(400).json({ error: 'Nomor KTP harus 16 digit angka' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid' });

  const plId = (pricelist_id !== undefined && pricelist_id !== null && String(pricelist_id).trim() !== '') ? parseInt(pricelist_id, 10) : null;
  if (plId) {
    const plCheck = await pool.query('SELECT id FROM pricelists WHERE id = ? AND is_active = 1', [plId]);
    if (plCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Pricelist tidak ditemukan atau tidak aktif' });
    }
  }

  const pTypeIdRaw = (tipe_pembayaran_id !== undefined ? tipe_pembayaran_id : payment_type_id);
  const pTypeId = (pTypeIdRaw !== undefined && pTypeIdRaw !== null && String(pTypeIdRaw).trim() !== '') ? String(pTypeIdRaw).trim() : null;
  if (pTypeId) {
    const ptCheck = await pool.query('SELECT id FROM payment_types WHERE id = ?', [pTypeId]);
    if (ptCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Tipe pembayaran tidak ditemukan di master data' });
    }
  }

  const insertQuery = 'INSERT INTO customers (id, name, customer_category_id, pricelist_id, tipe_pembayaran_id, phone, city, address, credit_lmt, ktp, npwp, npwp_name, npwp_address, nib, email, no_hp_2) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)';
  try {
    const prefix = await getSetting('prefix_customer', 'C');
    const id = await generateNextId(pool, 'customers', prefix);
    await pool.query(insertQuery, [id, name.trim(), customer_category_id || null, plId, pTypeId, phone, city, address, credit_lmt || 0, ktp || null, npwp || null, npwp_name || null, npwp_address || null, nib || null, email || null, no_hp_2 || null]);
    res.json({ success: true, id, tipe_pembayaran_id: pTypeId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/customers/:id', authenticateToken, authorizeRoles('admin', 'kasir', 'owner'), async (req, res) => {
  const { id } = req.params;
  const { name, customer_category_id, pricelist_id, tipe_pembayaran_id, payment_type_id, phone, city, address, credit_lmt, ktp, npwp, npwp_name, npwp_address, nib, email, no_hp_2 } = req.body;

  // Validasi backend
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama pelanggan wajib diisi' });
  if (ktp && !/^\d{16}$/.test(ktp)) return res.status(400).json({ error: 'Nomor KTP harus 16 digit angka' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid' });

  const plId = (pricelist_id !== undefined && pricelist_id !== null && String(pricelist_id).trim() !== '') ? parseInt(pricelist_id, 10) : null;
  if (plId) {
    const plCheck = await pool.query('SELECT id FROM pricelists WHERE id = ? AND is_active = 1', [plId]);
    if (plCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Pricelist tidak ditemukan atau tidak aktif' });
    }
  }

  const pTypeIdRaw = (tipe_pembayaran_id !== undefined ? tipe_pembayaran_id : payment_type_id);
  const pTypeId = (pTypeIdRaw !== undefined && pTypeIdRaw !== null && String(pTypeIdRaw).trim() !== '') ? String(pTypeIdRaw).trim() : null;
  if (pTypeId) {
    const ptCheck = await pool.query('SELECT id FROM payment_types WHERE id = ?', [pTypeId]);
    if (ptCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Tipe pembayaran tidak ditemukan di master data' });
    }
  }

  const updateQuery = 'UPDATE customers SET name = $1, customer_category_id = $2, pricelist_id = $3, tipe_pembayaran_id = $4, phone = $5, city = $6, address = $7, credit_lmt = $8, ktp = $9, npwp = $10, npwp_name = $11, npwp_address = $12, nib = $13, email = $14, no_hp_2 = $15 WHERE id = $16';
  try {
    const result = await pool.query(updateQuery, [name.trim(), customer_category_id || null, plId, pTypeId, phone, city, address, credit_lmt || 0, ktp || null, npwp || null, npwp_name || null, npwp_address || null, nib || null, email || null, no_hp_2 || null, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    }
    res.json({ success: true, message: 'Pelanggan berhasil diperbarui', tipe_pembayaran_id: pTypeId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/customers/:id/pricelist - Khusus update penetapan Special Price ke pelanggan (Admin, Owner, Kasir)
app.patch('/api/customers/:id/pricelist', authenticateToken, authorizeRoles('admin', 'kasir', 'owner'), async (req, res) => {
  const { id } = req.params;
  const { pricelist_id } = req.body;
  const plId = (pricelist_id !== undefined && pricelist_id !== null && String(pricelist_id).trim() !== '') ? parseInt(pricelist_id, 10) : null;
  if (plId) {
    const plCheck = await pool.query('SELECT id FROM pricelists WHERE id = ? AND is_active = 1', [plId]);
    if (plCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Pricelist tidak ditemukan atau tidak aktif' });
    }
  }
  try {
    const result = await pool.query('UPDATE customers SET pricelist_id = ? WHERE id = ?', [plId, id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    res.json({ success: true, message: 'Special Price pelanggan berhasil diperbarui', pricelist_id: plId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/customers/:id', authenticateToken, authorizeRoles('admin', 'kasir', 'owner'), async (req, res) => {
  const { id } = req.params;
  const deleteQuery = 'DELETE FROM customers WHERE id = $1';
  try {
    const result = await pool.query(deleteQuery, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    }
    res.json({ success: true, message: 'Pelanggan berhasil dihapus' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Pricelist Helper & Routes ---

/**
 * 4.1 Helper: Sumber kebenaran harga efektif penjualan per customer
 */
async function getEffectivePrices(customerId, productIds = null) {
  let query = `
    SELECT 
      p.id AS product_id,
      p.sku,
      p.name AS product_name,
      p.sell_price AS harga_master,
      p.cost_price AS hpp,
      pi.harga AS harga_pricelist,
      COALESCE(pi.harga, p.sell_price) AS harga_efektif,
      CASE WHEN pi.harga IS NOT NULL THEN 'pricelist' ELSE 'master' END AS sumber_harga,
      pl.id AS pricelist_id,
      pl.kode AS pricelist_kode,
      pl.nama AS pricelist_nama
    FROM products p
    LEFT JOIN customers c ON c.id = ?
    LEFT JOIN pricelists pl ON pl.id = c.pricelist_id AND pl.is_active = 1
    LEFT JOIN pricelist_items pi ON pi.pricelist_id = pl.id AND pi.product_id = p.id
  `;
  const params = [customerId || null];

  if (Array.isArray(productIds) && productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(',');
    query += ` WHERE p.id IN (${placeholders})`;
    params.push(...productIds);
  }

  query += ` ORDER BY p.name ASC`;
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Helper: Generate kode unik pricelist (contoh: PL000001)
 */
async function generatePricelistCode(clientOrPool) {
  const prefix = await getSetting('prefix_pricelist', 'PL');
  const result = await clientOrPool.query('SELECT kode FROM pricelists WHERE kode LIKE ?', [prefix + '%']);
  let maxNum = 0;
  for (const row of result.rows) {
    const codeStr = row.kode;
    if (codeStr && codeStr.startsWith(prefix)) {
      const suffix = codeStr.substring(prefix.length);
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  const nextNum = maxNum + 1;
  return prefix + String(nextNum).padStart(6, '0');
}

// GET /api/pricelists - Daftar pricelist + jumlah produk + jumlah customer
app.get('/api/pricelists', authenticateToken, authorizeRoles('admin', 'owner', 'kasir', 'finance'), async (req, res) => {
  try {
    const isAktifOnly = req.query.aktif === '1' || req.query.is_active === '1';
    let query = `
      SELECT 
        pl.id,
        pl.kode,
        pl.nama,
        pl.keterangan,
        pl.is_active,
        pl.created_at,
        pl.updated_at,
        COUNT(DISTINCT pi.product_id) AS total_items,
        COUNT(DISTINCT c.id) AS total_customers
      FROM pricelists pl
      LEFT JOIN pricelist_items pi ON pi.pricelist_id = pl.id
      LEFT JOIN customers c ON c.pricelist_id = pl.id
    `;
    if (isAktifOnly) {
      query += ` WHERE pl.is_active = 1`;
    }
    query += `
      GROUP BY pl.id, pl.kode, pl.nama, pl.keterangan, pl.is_active, pl.created_at, pl.updated_at
      ORDER BY pl.id DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pricelists/effective-prices - Harga efektif untuk customer tertentu
app.get('/api/pricelists/effective-prices', authenticateToken, authorizeRoles('admin', 'owner', 'kasir', 'finance'), async (req, res) => {
  try {
    const { customer_id } = req.query;
    const prices = await getEffectivePrices(customer_id);

    // Sanitasi respons: sembunyikan HPP untuk role kasir jika tidak berhak
    const userRole = (req.user?.role || '').toLowerCase();
    const canSeeHpp = userRole === 'admin' || userRole === 'owner' || userRole === 'gudang';
    if (!canSeeHpp) {
      prices.forEach(p => {
        delete p.hpp;
      });
    }

    // Ambil info pricelist customer jika ada
    let customerPricelist = null;
    if (customer_id) {
      const custRes = await pool.query(`
        SELECT pl.id, pl.kode, pl.nama, pl.is_active 
        FROM customers c 
        JOIN pricelists pl ON pl.id = c.pricelist_id 
        WHERE c.id = ?
      `, [customer_id]);
      if (custRes.rows.length > 0) {
        customerPricelist = custRes.rows[0];
      }
    }

    res.json({
      success: true,
      customer_id: customer_id || null,
      pricelist: customerPricelist,
      prices
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pricelists - Buat pricelist baru
app.post('/api/pricelists', authenticateToken, authorizeRoles('admin', 'owner', 'kasir'), async (req, res) => {
  const { nama, keterangan } = req.body;
  if (!nama || !nama.trim()) {
    return res.status(400).json({ error: 'Nama pricelist wajib diisi' });
  }

  try {
    // Cek keunikan nama case-insensitive (R6/Spec 4.3)
    const existing = await pool.query('SELECT id FROM pricelists WHERE LOWER(nama) = LOWER(?)', [nama.trim()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Nama pricelist sudah digunakan' });
    }

    const kode = await generatePricelistCode(pool);
    const result = await pool.query(
      'INSERT INTO pricelists (kode, nama, keterangan, is_active) VALUES (?, ?, ?, 1)',
      [kode, nama.trim(), keterangan ? keterangan.trim() : null]
    );

    res.json({
      success: true,
      message: 'Pricelist berhasil dibuat',
      data: {
        id: result.insertId,
        kode,
        nama: nama.trim(),
        keterangan: keterangan ? keterangan.trim() : null,
        is_active: 1
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/pricelists/:id - Detail pricelist + item dengan harga master & HPP
app.get('/api/pricelists/:id', authenticateToken, authorizeRoles('admin', 'owner', 'kasir', 'finance'), async (req, res) => {
  const { id } = req.params;
  try {
    const plRes = await pool.query('SELECT * FROM pricelists WHERE id = ?', [id]);
    if (plRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pricelist tidak ditemukan' });
    }

    const custCountRes = await pool.query('SELECT COUNT(*) AS total_customers FROM customers WHERE pricelist_id = ?', [id]);
    const totalCustomers = Number(custCountRes.rows[0]?.total_customers || 0);

    const itemsRes = await pool.query(`
      SELECT 
        pi.id,
        pi.pricelist_id,
        pi.product_id,
        pi.harga,
        p.sku,
        p.brand,
        p.name AS product_name,
        p.sell_price AS harga_master,
        p.cost_price AS hpp,
        u.name AS unit
      FROM pricelist_items pi
      JOIN products p ON p.id = pi.product_id
      LEFT JOIN product_units u ON p.unit_id = u.id
      WHERE pi.pricelist_id = ?
      ORDER BY p.name ASC
    `, [id]);

    // Sanitasi respons berbasis role (Spec 4.4)
    const userRole = (req.user?.role || '').toLowerCase();
    const canSeeHpp = userRole === 'admin' || userRole === 'owner' || userRole === 'gudang';
    const items = itemsRes.rows.map(item => {
      const it = { ...item };
      if (!canSeeHpp) {
        delete it.hpp;
      }
      return it;
    });

    res.json({
      ...plRes.rows[0],
      total_customers: totalCustomers,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pricelists/:id - Ubah nama, keterangan, is_active
app.put('/api/pricelists/:id', authenticateToken, authorizeRoles('admin', 'owner', 'kasir'), async (req, res) => {
  const { id } = req.params;
  const { nama, keterangan, is_active } = req.body;

  try {
    const plRes = await pool.query('SELECT * FROM pricelists WHERE id = ?', [id]);
    if (plRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pricelist tidak ditemukan' });
    }

    if (nama !== undefined) {
      if (!nama || !nama.trim()) {
        return res.status(400).json({ error: 'Nama pricelist tidak boleh kosong' });
      }
      const existing = await pool.query(
        'SELECT id FROM pricelists WHERE LOWER(nama) = LOWER(?) AND id != ?',
        [nama.trim(), id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Nama pricelist sudah digunakan' });
      }
    }

    const currentPl = plRes.rows[0];
    const newNama = nama !== undefined ? nama.trim() : currentPl.nama;
    const newKeterangan = keterangan !== undefined ? (keterangan ? keterangan.trim() : null) : currentPl.keterangan;
    const newActive = is_active !== undefined ? (is_active ? 1 : 0) : currentPl.is_active;

    await pool.query(
      'UPDATE pricelists SET nama = ?, keterangan = ?, is_active = ? WHERE id = ?',
      [newNama, newKeterangan, newActive, id]
    );

    res.json({ success: true, message: 'Pricelist berhasil diperbarui' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/pricelists/:id - Hapus pricelist (R7: tolak 409 jika sedang dipakai customer)
app.delete('/api/pricelists/:id', authenticateToken, authorizeRoles('admin', 'owner', 'kasir'), async (req, res) => {
  const { id } = req.params;
  try {
    const custRes = await pool.query('SELECT COUNT(*) AS total_customers FROM customers WHERE pricelist_id = ?', [id]);
    const customerCount = Number(custRes.rows[0]?.total_customers || 0);

    if (customerCount > 0) {
      return res.status(409).json({
        error: `Pricelist sedang digunakan oleh ${customerCount} pelanggan. Pricelist hanya boleh dinonaktifkan, tidak dapat dihapus permanen.`,
        total_customers: customerCount
      });
    }

    const result = await pool.query('DELETE FROM pricelists WHERE id = ?', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pricelist tidak ditemukan' });
    }

    res.json({ success: true, message: 'Pricelist berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pricelists/:id/duplicate - Duplikat pricelist beserta itemnya
app.post('/api/pricelists/:id/duplicate', authenticateToken, authorizeRoles('admin', 'owner', 'kasir'), async (req, res) => {
  const { id } = req.params;
  const { nama } = req.body;

  try {
    const sourcePl = await pool.query('SELECT * FROM pricelists WHERE id = ?', [id]);
    if (sourcePl.rows.length === 0) {
      return res.status(404).json({ error: 'Pricelist sumber tidak ditemukan' });
    }

    let newNama = (nama && nama.trim()) ? nama.trim() : `${sourcePl.rows[0].nama} (Salinan)`;
    // Pastikan nama baru unik
    let counter = 1;
    let checkNama = newNama;
    while (true) {
      const ex = await pool.query('SELECT id FROM pricelists WHERE LOWER(nama) = LOWER(?)', [checkNama]);
      if (ex.rows.length === 0) {
        newNama = checkNama;
        break;
      }
      counter++;
      checkNama = `${newNama} ${counter}`;
    }

    const newKode = await generatePricelistCode(pool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insPl = await client.query(
        'INSERT INTO pricelists (kode, nama, keterangan, is_active) VALUES (?, ?, ?, 1)',
        [newKode, newNama, sourcePl.rows[0].keterangan]
      );
      const newId = insPl.insertId;

      await client.query(`
        INSERT INTO pricelist_items (pricelist_id, product_id, harga)
        SELECT ?, product_id, harga FROM pricelist_items WHERE pricelist_id = ?
      `, [newId, id]);

      await client.query('COMMIT');
      res.json({
        success: true,
        message: 'Pricelist berhasil diduplikat',
        data: { id: newId, kode: newKode, nama: newNama }
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pricelists/:id/items - Bulk upsert [{ product_id, harga }] (input massal & import CSV)
app.put('/api/pricelists/:id/items', authenticateToken, authorizeRoles('admin', 'owner', 'kasir'), async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Daftar item tidak boleh kosong' });
  }

  try {
    const plCheck = await pool.query('SELECT id FROM pricelists WHERE id = ?', [id]);
    if (plCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Pricelist tidak ditemukan' });
    }

    // Validasi harga > 0 dan deduplikasi (ambil nilai terakhir jika produk sama) (Spec 4.3 & R5)
    const dedupedMap = new Map();
    for (const it of items) {
      if (!it.product_id) continue;
      const hargaNum = parseFloat(it.harga);
      if (isNaN(hargaNum) || hargaNum <= 0) {
        return res.status(400).json({ error: `Harga untuk produk '${it.product_id}' harus berupa angka lebih besar dari 0` });
      }
      dedupedMap.set(String(it.product_id), hargaNum);
    }

    if (dedupedMap.size === 0) {
      return res.status(400).json({ error: 'Tidak ada item yang valid untuk disimpan' });
    }

    // Validasi apakah product_id valid ada di tabel products
    const productIds = Array.from(dedupedMap.keys());
    const placeholders = productIds.map(() => '?').join(',');
    const prodRes = await pool.query(`SELECT id FROM products WHERE id IN (${placeholders})`, productIds);
    const validProductIds = new Set(prodRes.rows.map(r => r.id));

    const invalidProds = productIds.filter(pid => !validProductIds.has(pid));
    if (invalidProds.length > 0) {
      return res.status(400).json({ error: `Produk berikut tidak ditemukan: ${invalidProds.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [prodId, hargaVal] of dedupedMap.entries()) {
        await client.query(`
          INSERT INTO pricelist_items (pricelist_id, product_id, harga)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE harga = VALUES(harga)
        `, [id, prodId, hargaVal]);
      }
      await client.query('COMMIT');
      res.json({
        success: true,
        message: `${dedupedMap.size} item berhasil disimpan ke pricelist`,
        count: dedupedMap.size
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pricelists/:id/items/:productId - Hapus satu item dari pricelist
app.delete('/api/pricelists/:id/items/:productId', authenticateToken, authorizeRoles('admin', 'owner', 'kasir'), async (req, res) => {
  const { id, productId } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM pricelist_items WHERE pricelist_id = ? AND product_id = ?',
      [id, productId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan di pricelist ini' });
    }
    res.json({ success: true, message: 'Item berhasil dihapus dari pricelist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Vendors Routes ---
app.get('/api/vendors', authenticateToken, authorizeRoles('admin', 'gudang', 'finance'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, category, paginate, all, sort } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';

    const VENDOR_SORT_MAP = {
      name_asc: "CASE WHEN v.name IS NULL OR v.name = '' THEN 1 ELSE 0 END, LOWER(v.name) ASC, v.id ASC",
      name_desc: "CASE WHEN v.name IS NULL OR v.name = '' THEN 1 ELSE 0 END, LOWER(v.name) DESC, v.id ASC",
      id_asc: "CASE WHEN v.id IS NULL OR v.id = '' THEN 1 ELSE 0 END, LOWER(REGEXP_REPLACE(v.id, '[0-9]+$', '')) ASC, CASE WHEN v.id REGEXP '[0-9]+$' THEN 0 ELSE 1 END, CAST(REGEXP_SUBSTR(v.id, '[0-9]+$') AS UNSIGNED) ASC, v.id ASC",
      id_desc: "CASE WHEN v.id IS NULL OR v.id = '' THEN 1 ELSE 0 END, LOWER(REGEXP_REPLACE(v.id, '[0-9]+$', '')) DESC, CASE WHEN v.id REGEXP '[0-9]+$' THEN 0 ELSE 1 END, CAST(REGEXP_SUBSTR(v.id, '[0-9]+$') AS UNSIGNED) DESC, v.id DESC"
    };
    const sortClause = VENDOR_SORT_MAP[sort] || "v.name ASC, v.id ASC";

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(v.name LIKE ? OR v.id LIKE ? OR v.phone LIKE ? OR v.city LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    if (category && category !== 'all') {
      whereConditions.push('(vc.name = ? OR v.vendor_category_id = ?)');
      params.push(category, category);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const baseVendorSql = `
      FROM vendors v
      LEFT JOIN vendor_categories vc ON v.vendor_category_id = vc.id
      LEFT JOIN (
        SELECT vendor_id,
          SUM(total) AS total_purchases,
          SUM(GREATEST(total - paid_amount, 0)) AS outstanding_debt
        FROM purchase_orders
        WHERE status != 'Batal'
        GROUP BY vendor_id
      ) po_agg ON po_agg.vendor_id = v.id
      ${whereClause}
    `;

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      const countSql = `SELECT COUNT(*) AS total FROM vendors v LEFT JOIN vendor_categories vc ON v.vendor_category_id = vc.id ${whereClause}`;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);

      const dataSql = `
        SELECT v.*, vc.name as category_name,
          COALESCE(po_agg.total_purchases, 0) AS total_purchases,
          COALESCE(po_agg.outstanding_debt, 0) AS outstanding_debt
        ${baseVendorSql}
        ORDER BY ${sortClause}
        LIMIT ? OFFSET ?
      `;
      const result = await pool.query(dataSql, [...params, limitNum, offset]);

      return res.json({
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        }
      });
    }

    const result = await pool.query(`
      SELECT v.*, vc.name as category_name,
        COALESCE(po_agg.total_purchases, 0) AS total_purchases,
        COALESCE(po_agg.outstanding_debt, 0) AS outstanding_debt
      ${baseVendorSql}
      ORDER BY ${sortClause}
    `, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Invoices Routes (Sales) ---
app.get('/api/invoices', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, status, customer_id, payment_type_id, payment_type, date_from, date_to, paginate, all } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(si.id LIKE ? OR c.name LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern);
    }

    if (status && status !== 'all') {
      const qStatus = status.toLowerCase();
      if (qStatus.includes('belum')) {
        whereConditions.push('LOWER(si.status) LIKE ?');
        params.push('%belum%');
      } else {
        whereConditions.push('LOWER(si.status) = ?');
        params.push(qStatus);
      }
    }

    if (customer_id && customer_id !== 'all') {
      whereConditions.push('si.customer_id = ?');
      params.push(customer_id);
    }

    const pTypeId = payment_type_id || payment_type;
    if (pTypeId && pTypeId !== 'all') {
      whereConditions.push('si.payment_type_id = ?');
      params.push(pTypeId);
    }

    if (date_from) {
      whereConditions.push('si.date >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereConditions.push('si.date <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const todayStr = formatDateStr(new Date());
    const mapInvoiceRow = (r) => {
      const total = parseFloat(r.total || 0);
      const paid = parseFloat(r.paid_amount || 0);
      const returnAmount = parseFloat(r.return_amount || 0);
      const sisa = Math.max(0, total - paid - returnAmount);
      const dueDateStr = formatDateStr(r.due_date);
      const isOverdue = sisa > 0 && Boolean(dueDateStr) && dueDateStr < todayStr;
      return {
        id: r.id,
        date: formatDateStr(r.date),
        customerId: r.customer_id,
        customer: r.customer || 'Tanpa Pelanggan',
        total: total,
        paid: paid,
        returnAmount: returnAmount,
        sisa: sisa,
        isOverdue: isOverdue,
        paidDate: formatDateStr(r.paid_date) || null,
        type: r.payment_type_name || 'Tunai',
        paymentTypeId: r.payment_type_id,
        status: r.status,
        dueDate: dueDateStr,
        isOutstandingImport: Boolean(r.is_outstanding_import)
      };
    };

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      const countSql = `
        SELECT COUNT(*) AS total 
        FROM sales_invoices si 
        LEFT JOIN customers c ON si.customer_id = c.id 
        ${whereClause}
      `;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);

      const dataSql = `
        SELECT si.*, c.name as customer, pt.name as payment_type_name
        FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
        ${whereClause}
        ORDER BY
          CASE
            WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN 3
            WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN 2
            WHEN si.id REGEXP '^[0-9]+$' THEN 1
            ELSE 0
          END DESC,
          CASE
            WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING(si.id, 5, 4) AS UNSIGNED)
            ELSE 0
          END DESC,
          CASE
            WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
            WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
            WHEN si.id REGEXP '^[0-9]+$' THEN CAST(si.id AS UNSIGNED)
            ELSE 0
          END DESC,
          si.id DESC
        LIMIT ? OFFSET ?
      `;
      const result = await pool.query(dataSql, [...params, limitNum, offset]);

      return res.json({
        data: result.rows.map(mapInvoiceRow),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        }
      });
    }

    const result = await pool.query(`
      SELECT si.*, c.name as customer, pt.name as payment_type_name
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
      ${whereClause}
      ORDER BY
        CASE
          WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN 3
          WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN 2
          WHEN si.id REGEXP '^[0-9]+$' THEN 1
          ELSE 0
        END DESC,
        CASE
          WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING(si.id, 5, 4) AS UNSIGNED)
          ELSE 0
        END DESC,
        CASE
          WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
          WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
          WHEN si.id REGEXP '^[0-9]+$' THEN CAST(si.id AS UNSIGNED)
          ELSE 0
        END DESC,
        si.id DESC
    `, params);
    res.json(result.rows.map(mapInvoiceRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id/items', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ii.*, p.name as product_name, p.sell_price
      FROM invoice_items ii
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = $1
    `, [req.params.id]);
    // Security: strip fee fields from non-admin responses; strip HPP for restricted roles
    const rows = result.rows.map(row => {
      let r = { ...row };
      if (req.user.role !== 'admin') { const { customer_fee, fee_notes, ...rest } = r; r = rest; }
      if (isHppRestricted(req)) { delete r.cost_price_snapshot; }
      return r;
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id/print-data', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const invRes = await pool.query(`
      SELECT si.*, c.name as customer_name, c.address as customer_address,
             c.phone as customer_phone, c.no_hp_2 as customer_no_hp_2,
             pt.name as payment_type_name
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
      WHERE si.id = $1
    `, [id]);
    
    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    
    const invoiceRow = invRes.rows[0];
    
    const itemsRes = await pool.query(`
      SELECT ii.*, p.name as product_name, pu.name as unit_name
      FROM invoice_items ii
      LEFT JOIN products p ON ii.product_id = p.id
      LEFT JOIN product_units pu ON p.unit_id = pu.id
      WHERE ii.invoice_id = $1
    `, [id]);
    
    const settingsRes = await pool.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('company_name', 'company_phone', 'company_email', 'company_address', 'company_logo', 'ppn_enabled', 'pajak_default')`);
    const company = {};
    const settingsMap = {};
    settingsRes.rows.forEach(r => {
      if (r.key.startsWith('company_')) {
        company[r.key.replace('company_', '')] = r.value;
      }
      settingsMap[r.key] = r.value;
    });

    // PPN Recalculation logic
    const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1' || settingsMap['ppn_enabled'] === true;
    const pajakDefault = parseFloat(settingsMap['pajak_default'] || 11);
    const subtotal = parseFloat(invoiceRow.subtotal || 0);
    const diskon = parseFloat(invoiceRow.discount || 0);
    
    const recalculatedTax = ppnEnabled ? Math.round((subtotal - diskon) * (pajakDefault / 100)) : 0;
    const recalculatedTotal = subtotal - diskon + recalculatedTax;
    
    const phone1 = invoiceRow.customer_phone ? String(invoiceRow.customer_phone).trim() : '';
    const phone2 = invoiceRow.customer_no_hp_2 ? String(invoiceRow.customer_no_hp_2).trim() : '';
    const chosenPhone = (phone1 && phone1 !== '-') ? phone1 : ((phone2 && phone2 !== '-') ? phone2 : (phone1 || '-'));

    res.json({
      invoice: {
        id: invoiceRow.id,
        date: formatDateStr(invoiceRow.date),
        due_date: formatDateStr(invoiceRow.due_date),
        total: recalculatedTotal,
        subtotal: subtotal,
        tax: recalculatedTax,
        ppn_enabled: ppnEnabled,
        payment_type_name: invoiceRow.payment_type_name || 'Tunai'
      },
      customer: {
        name: invoiceRow.customer_name || 'Pelanggan Umum',
        address: invoiceRow.customer_address || '',
        phone: chosenPhone
      },
      items: itemsRes.rows.map(item => ({
        product_name: item.product_name,
        unit_name: item.unit_name || '-',
        quantity: parseFloat(item.quantity),
        price: parseFloat(item.price),
        total: parseFloat(item.quantity) * parseFloat(item.price)
      })),
      company: company
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchases/:id/items', authenticateToken, authorizeRoles('admin', 'gudang', 'finance'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT poi.*, p.name as product_name, p.cost_price
      FROM purchase_order_items poi
      LEFT JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  console.log(`[Invoice Creation API] Request received:`, JSON.stringify(req.body, null, 2));
  const { customer_id, total, paid, payment_type_id, due_date, items } = req.body;
  const userId = req.user.id;

  // Server-side input validation — never let an empty string reach the FK constraint
  if (!customer_id) return res.status(400).json({ error: 'customer_id wajib diisi' });
  if (!payment_type_id) return res.status(400).json({ error: 'payment_type_id wajib diisi. Pilih metode pembayaran yang valid.' });

  // Validate tanggal order if provided (Masalah 2: max +7 hari ke depan)
  if (req.body.date) {
    try {
      validateOrderDate(req.body.date, 7);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }
  if ((!items || !Array.isArray(items) || items.length === 0) && !req.body.is_import) {
    return res.status(400).json({ error: 'Invoice harus memiliki minimal satu item produk.' });
  }

  console.log(`[Invoice Creation API] Selected Payment Type ID: "${payment_type_id}"`);

  const insertInvoiceQuery = 'INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount, payment_type_id, due_date, paid_date, status, user_id, is_outstanding_import) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0)';
  const updateStockQuery = 'UPDATE products SET stock = stock - $1 WHERE id = $2';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Recalculate subtotal and tax to ensure correctness (Masalah A)
    const settingsRes = await client.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsMap = {};
    settingsRes.rows.forEach(r => settingsMap[r.key] = r.value);
    
    const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1' || settingsMap['ppn_enabled'] === true;
    const pajakDefault = parseFloat(settingsMap['pajak_default'] || 11);
    
    let subtotal = 0;
    if (items && Array.isArray(items)) {
      items.forEach(item => {
        const itemQty = parseFloat(item.quantity ?? item.qty ?? 0);
        const itemPrice = parseFloat(item.price ?? item.sell_price ?? 0);
        subtotal += itemPrice * itemQty;
      });
    }
    const diskon = parseFloat(req.body.discount || req.body.diskon || 0);
    const taxAmount = ppnEnabled ? Math.round((subtotal - diskon) * (pajakDefault / 100)) : 0;
    const finalTotal = subtotal - diskon + taxAmount;

    const todayWITA = getTodayWITA();
    const date = req.body.date ? req.body.date.split('T')[0] : todayWITA;

    // Determine status based on payment type:
    // Tunai / Transfer = instant settlement (Lunas), Kredit X Hari = Belum Lunas / Sebagian
    const instant = await isInstantPayment(payment_type_id);
    const effectivePaid = instant ? finalTotal : parseFloat(paid || 0);
    const status = instant ? 'Lunas'
      : (effectivePaid >= finalTotal ? 'Lunas'
        : (effectivePaid > 0 ? 'Sebagian' : 'Belum Lunas'));
    const paidDate = status === 'Lunas' ? date : null;

    // Generate invoice ID using atomic per-year counter
    // Use date from request body so year/month match the invoice date (not server clock)
    const invoiceDateForId = req.body.date ? req.body.date.split('T')[0] : todayWITA;
    const id = await generateInvoiceId(client, invoiceDateForId);
    
    console.log(`[Invoice Creation API] Saving invoice ${id} with payment_type_id: "${payment_type_id}"`);
    // Ensure due_date is calculated if Kredit and due_date not passed
    let finalDueDate = due_date || null;
    if (!finalDueDate && !instant) {
      const ptRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [payment_type_id]);
      const ptName = ptRes.rows[0]?.name || '';
      const match = ptName.match(/(kredit|credit)\s+(\d+)\s+hari/i);
      if (match && match[2]) {
        const days = parseInt(match[2], 10);
        const parts = date.split('-');
        if (parts.length === 3) {
          const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10) + days);
          const ry = dt.getFullYear();
          const rm = String(dt.getMonth() + 1).padStart(2, '0');
          const rd = String(dt.getDate()).padStart(2, '0');
          finalDueDate = `${ry}-${rm}-${rd}`;
        }
      }
    }

    await client.query(insertInvoiceQuery, [id, date, customer_id, subtotal, diskon, taxAmount, finalTotal, effectivePaid, payment_type_id, finalDueDate, paidDate, status, userId]);

    // Reduce stock & insert items with HPP snapshot
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const prodId = item.id || item.product_id;
        const itemQty = parseFloat(item.quantity ?? item.qty ?? 0);
        const itemPrice = parseFloat(item.price ?? item.sell_price ?? 0);

        const curProd = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [prodId]);
        const curStock = parseFloat(curProd.rows[0]?.stock || 0);
        const nextStock = curStock - itemQty;

        await client.query(updateStockQuery, [itemQty, prodId]);
        // Also insert to invoice_items — include customer_fee/fee_notes (admin only)
        const itemFee = req.user.role === 'admin' ? (parseFloat(item.customer_fee) || 0) : 0;
        const itemFeeNotes = req.user.role === 'admin' ? (item.fee_notes || null) : null;
        if (itemFee < 0) throw new Error('customer_fee tidak boleh negatif');

        // Snapshot the HPP (cost_price) at time of sale to prevent drift when cost changes later
        const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [prodId]);
        const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || item.cost_price || 0);

        await client.query(
          'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [Date.now().toString() + Math.floor(Math.random() * 1000), id, prodId, itemQty, itemPrice, costSnapshot, itemFee, itemFeeNotes]
        );

        await recordStockMove(client, {
          product_id: prodId,
          tanggal: date ? date + ' 12:00:00' : null,
          tipe: 'penjualan',
          ref_type: 'invoice',
          ref_id: id,
          ref_no: id,
          qty_masuk: 0,
          qty_keluar: itemQty,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: `Penjualan Invoice ${id}`,
          created_by: userId
        });
      }
    }

    if (effectivePaid > 0) {
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      const ctDate = date;
      const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [payment_type_id]);
      const method = ptNameRes.rows[0]?.name || 'Transfer Bank';
      const cashCategory = instant ? 'Penjualan' : 'Pelunasan Piutang';
      const cashDesc = instant ? `Pembayaran Invoice ${id}` : `Uang Muka (DP) Invoice ${id}`;
      console.log(`[Invoice Creation API] Creating cash transaction for invoice ${id}. Paid: ${effectivePaid}, payment_type_id: "${payment_type_id}", method name: "${method}"`);
      await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, payment_type_id, user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ctId, ctDate, 'IN', cashCategory, cashDesc, effectivePaid, method, id, payment_type_id, userId, 'active']);

      // Record DP as first payment entry in sales_invoice_payments
      if (!instant) {
        const dpNo = await generatePaymentNo(client, date);
        const dpNotes = req.body.payment_notes || req.body.dp_notes || 'Uang Muka (DP)';
        await client.query(
          `INSERT INTO sales_invoice_payments
           (payment_no, invoice_id, payment_date, amount, payment_method, notes, is_down_payment, status, cash_transaction_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
          [dpNo, id, date, effectivePaid, method, dpNotes, ctId, userId]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`[Invoice Creation API] Successfully created and committed invoice: ${id}`);
    res.json({ success: true, invoiceId: id });
  } catch (err) {
    console.error(`[Invoice Creation API] Error during invoice creation rollback:`, err);
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Finance Routes ---

app.post('/api/invoices/manual', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  const { id, invoice_number, invoiceNumber, date, due_date, customer_id, total, payment_type_id } = req.body;
  const targetId = id || invoice_number || invoiceNumber;
  const userId = req.user.id;

  if (!targetId) {
    return res.status(400).json({ error: 'Nomor invoice wajib diisi' });
  }

  const status = 'Belum Bayar';
  const insertQuery = 'INSERT INTO sales_invoices (id, date, customer_id, subtotal, total, paid_amount, payment_type_id, due_date, status, user_id, is_outstanding_import) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, 1)';

  try {
    await pool.query(insertQuery, [targetId, date, customer_id, total, total, payment_type_id, due_date, status, userId]);
    res.json({ success: true, invoiceId: targetId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/invoices/import-outstanding
 * Import batch invoice outstanding (migrasi saldo piutang sistem lama).
 * Hak akses: Administrator dan Finance
 * Fitur:
 * - Transaksional (BEGIN ... COMMIT / ROLLBACK)
 * - Mencegah invoice lunas (total_dibayar == total) dan overpayment (total_dibayar > total)
 * - Tipe pembayaran otomatis Kredit (jatuh tempo aktif, tanpa denda)
 * - Jika total_dibayar > 0: otomatis buat 1 record di sales_invoice_payments bertanda 'Saldo awal hasil import'
 * - Nomor invoice eksisting divalidasi keunikan di database dan di dalam batch
 */
app.post('/api/invoices/import-outstanding', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { invoices } = req.body;
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return res.status(400).json({ error: 'Data invoice untuk diimpor tidak boleh kosong' });
  }

  const userId = req.user.id;
  const todayStr = formatDateStr(new Date());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ambil seluruh payment types untuk mapping tipe kredit
    const ptRes = await client.query('SELECT id, name FROM payment_types');
    const paymentTypes = ptRes.rows;
    const ptMap = {};
    paymentTypes.forEach(p => {
      ptMap[p.name.toLowerCase().trim()] = p.id;
      ptMap[p.id.toLowerCase().trim()] = p.id;
    });

    // Default credit type: prioritas Kredit 30 Hari (PT-7) atau tipe Kredit lainnya
    const defaultCreditType = paymentTypes.find(p => p.name.toLowerCase().includes('kredit 30'))?.id
      || paymentTypes.find(p => p.name.toLowerCase().startsWith('kredit'))?.id
      || 'PT-7';

    // 2. Ambil seluruh customer untuk validasi
    const custRes = await client.query('SELECT id, name FROM customers');
    const custMapByName = {};
    const custMapById = {};
    custRes.rows.forEach(c => {
      custMapByName[c.name.toLowerCase().trim()] = c.id;
      custMapById[c.id.toLowerCase().trim()] = c.id;
    });

    const seenIds = new Set();
    const createdInvoices = [];

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const rowNum = inv.row_number || (i + 1);

      // A. Validasi Customer
      const rawCust = String(inv.customer_id || inv.customer_name || inv.customer || '').trim();
      if (!rawCust) {
        throw new Error(`Baris ${rowNum}: Nama customer wajib diisi`);
      }
      const customerId = custMapById[rawCust.toLowerCase()] || custMapByName[rawCust.toLowerCase()];
      if (!customerId) {
        throw new Error(`Baris ${rowNum}: Customer "${rawCust}" tidak ditemukan di database`);
      }

      // B. Tanggal Invoice
      let invoiceDate = inv.date ? formatDateStr(inv.date) : todayStr;
      if (!invoiceDate || isNaN(new Date(invoiceDate).getTime())) {
        invoiceDate = todayStr;
      }

      // C. Validasi Total & Total Dibayar
      const total = parseFloat(inv.total);
      if (isNaN(total) || total <= 0) {
        throw new Error(`Baris ${rowNum}: Total tagihan harus berupa angka lebih besar dari 0`);
      }

      const totalDibayar = parseFloat(inv.total_dibayar ?? inv.paid ?? 0);
      if (isNaN(totalDibayar) || totalDibayar < 0) {
        throw new Error(`Baris ${rowNum}: Total dibayar tidak boleh bernilai negatif`);
      }

      if (totalDibayar >= total) {
        if (totalDibayar === total) {
          throw new Error(`Baris ${rowNum}: Total dibayar sama dengan total tagihan (Rp ${Math.round(total).toLocaleString('id-ID')}). Invoice ini bukan outstanding karena sudah lunas.`);
        } else {
          throw new Error(`Baris ${rowNum}: Total dibayar (Rp ${Math.round(totalDibayar).toLocaleString('id-ID')}) melebihi total tagihan (Rp ${Math.round(total).toLocaleString('id-ID')}). Pembayaran tidak boleh melebihi nilai tagihan.`);
        }
      }

      // D. Tipe Pembayaran (wajib tipe kredit)
      let pTypeId = defaultCreditType;
      const rawPt = String(inv.payment_type || inv.payment_type_id || '').toLowerCase().trim();
      if (rawPt && ptMap[rawPt]) {
        const candidatePt = paymentTypes.find(p => p.id === ptMap[rawPt]);
        if (candidatePt && candidatePt.name.toLowerCase().startsWith('kredit')) {
          pTypeId = candidatePt.id;
        }
      }

      // E. Tanggal Jatuh Tempo
      let dueDate = inv.due_date ? formatDateStr(inv.due_date) : null;
      if (!dueDate) {
        let tenorDays = 30;
        if (pTypeId === 'PT-3') tenorDays = 1;
        else if (pTypeId === 'PT-5') tenorDays = 7;
        else if (pTypeId === 'PT-6') tenorDays = 14;
        const dObj = new Date(invoiceDate);
        dObj.setDate(dObj.getDate() + tenorDays);
        dueDate = formatDateStr(dObj);
      }

      // F. Nomor Invoice (manual jika diisi, atomic counter jika kosong)
      let invoiceId = inv.id ? String(inv.id).trim() : '';
      if (invoiceId) {
        if (seenIds.has(invoiceId.toLowerCase())) {
          throw new Error(`Baris ${rowNum}: Nomor invoice "${invoiceId}" duplikat di dalam file import ini`);
        }
        const existingInv = await client.query('SELECT id FROM sales_invoices WHERE id = ?', [invoiceId]);
        if (existingInv.rows.length > 0) {
          throw new Error(`Baris ${rowNum}: Nomor invoice "${invoiceId}" sudah ada di database`);
        }
        seenIds.add(invoiceId.toLowerCase());
      } else {
        invoiceId = await generateInvoiceId(client, invoiceDate);
        seenIds.add(invoiceId.toLowerCase());
      }

      // G. Hitung sisa tagihan & status
      const sisa = Math.max(0, total - totalDibayar);
      const status = totalDibayar > 0 ? 'Sebagian' : 'Belum Lunas';

      // H. Simpan sales_invoices
      await client.query(
        `INSERT INTO sales_invoices 
         (id, date, customer_id, subtotal, discount, tax, total, paid_amount, payment_type_id, due_date, paid_date, status, user_id, is_outstanding_import) 
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, NULL, ?, ?, 1)`,
        [invoiceId, invoiceDate, customerId, total, total, totalDibayar, pTypeId, dueDate, status, userId]
      );

      // I. Jika total_dibayar > 0, buat 1 record di sales_invoice_payments sebagai saldo awal
      if (totalDibayar > 0) {
        let lastPaymentDate = inv.last_payment_date || inv.tanggal_pembayaran_terakhir;
        lastPaymentDate = lastPaymentDate ? formatDateStr(lastPaymentDate) : invoiceDate;
        if (!lastPaymentDate || isNaN(new Date(lastPaymentDate).getTime())) {
          lastPaymentDate = invoiceDate;
        }
        if (lastPaymentDate > todayStr) {
          throw new Error(`Baris ${rowNum}: Tanggal pembayaran terakhir tidak boleh di masa depan`);
        }

        const paymentNo = await generatePaymentNo(client, lastPaymentDate);
        await client.query(
          `INSERT INTO sales_invoice_payments
           (payment_no, invoice_id, payment_date, amount, payment_method, notes, is_down_payment, status, cash_transaction_id, created_by)
           VALUES (?, ?, ?, ?, 'Saldo Awal', 'Saldo awal hasil import', 0, 'active', NULL, ?)`,
          [paymentNo, invoiceId, lastPaymentDate, totalDibayar, userId]
        );
      }

      createdInvoices.push({
        id: invoiceId,
        customer_id: customerId,
        total,
        total_dibayar: totalDibayar,
        sisa,
        status,
        due_date: dueDate
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `${createdInvoices.length} invoice outstanding berhasil diimpor`,
      count: createdInvoices.length,
      invoices: createdInvoices
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Import Outstanding API] Error rollback:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});
/**
 * Helper to record a payment for an invoice with strict validations:
 * - Role: admin / finance
 * - Amount > 0, integer (bulat)
 * - Date <= today
 * - Row lock FOR UPDATE on sales_invoices
 * - Dynamic balance calculation from active payments in sales_invoice_payments
 * - Overpayment rejection (amount <= sisa)
 * - Atomic payment_no generation: PAY-YYYY-MM-NNNNN
 * - Cash transaction creation (type: 'IN', category: 'Pelunasan Piutang')
 * - sales_invoice_payments insertion
 * - sales_invoices (paid_amount, status, paid_date) update
 */
async function recordInvoicePayment({ invoiceId, amount, paymentDate, paymentMethod, notes, isDownPayment = 0, userId }) {
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    const err = new Error('Nominal pembayaran harus berupa angka lebih besar dari 0');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(numAmount)) {
    const err = new Error('Nominal pembayaran harus berupa Rupiah bulat tanpa pecahan');
    err.status = 400;
    throw err;
  }

  const todayStr = formatDateStr(new Date());
  const payDate = paymentDate ? formatDateStr(paymentDate) : todayStr;
  if (payDate > todayStr) {
    const err = new Error('Tanggal pembayaran tidak boleh di masa depan');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock invoice row
    const invRes = await client.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [invoiceId]);
    if (invRes.rows.length === 0) {
      const err = new Error('Invoice tidak ditemukan');
      err.status = 404;
      throw err;
    }
    const invoice = invRes.rows[0];

    if (invoice.status === 'Batal' || invoice.status === 'Cancel') {
      const err = new Error('Invoice yang sudah dibatalkan tidak dapat menerima pembayaran');
      err.status = 400;
      throw err;
    }

    const total = parseFloat(invoice.total || 0);

    // 2. Lock & calculate active payments from sales_invoice_payments
    const payRes = await client.query(
      'SELECT id, amount FROM sales_invoice_payments WHERE invoice_id = ? AND status = ? FOR UPDATE',
      [invoiceId, 'active']
    );

    let currentTotalPaid = 0;
    if (payRes.rows.length > 0) {
      currentTotalPaid = payRes.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    } else {
      currentTotalPaid = parseFloat(invoice.paid_amount || 0);
    }

    const sisa = Math.max(0, total - currentTotalPaid);

    if (sisa <= 0) {
      const err = new Error('Invoice ini sudah lunas, tidak ada sisa tagihan');
      err.status = 400;
      throw err;
    }

    if (numAmount > sisa) {
      const err = new Error(`Pembayaran melebihi sisa tagihan! Sisa tagihan: Rp ${Math.round(sisa).toLocaleString('id-ID')}, nominal bayar: Rp ${Math.round(numAmount).toLocaleString('id-ID')}`);
      err.status = 400;
      throw err;
    }

    // 3. Generate atomic payment reference number: PAY-YYYY-MM-NNNNN
    const paymentNo = await generatePaymentNo(client, payDate);

    // 4. Create cash transaction
    const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
    const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
    const ctCategory = 'Pelunasan Piutang';
    const ctDesc = isDownPayment
      ? `Uang Muka (DP) Invoice ${invoiceId} (${paymentNo})`
      : `Pembayaran Cicilan Invoice ${invoiceId} (${paymentNo})`;
    const methodStr = paymentMethod || 'Transfer Bank';

    await client.query(
      `INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, user_id, status)
       VALUES (?, ?, 'IN', ?, ?, ?, ?, ?, ?, 'active')`,
      [ctId, payDate, ctCategory, ctDesc, numAmount, methodStr, invoiceId, userId]
    );

    // 5. Insert to sales_invoice_payments
    const insertRes = await client.query(
      `INSERT INTO sales_invoice_payments
       (payment_no, invoice_id, payment_date, amount, payment_method, notes, is_down_payment, status, cash_transaction_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [paymentNo, invoiceId, payDate, numAmount, methodStr, notes || null, isDownPayment ? 1 : 0, ctId, userId]
    );

    // 6. Recalculate totals and update invoice
    const newTotalPaid = currentTotalPaid + numAmount;
    const newSisa = Math.max(0, total - newTotalPaid);
    const newStatus = newSisa <= 0 ? 'Lunas' : 'Sebagian';
    const newPaidDate = newStatus === 'Lunas' ? payDate : null;

    await client.query(
      'UPDATE sales_invoices SET paid_amount = ?, status = ?, paid_date = ? WHERE id = ?',
      [newTotalPaid, newStatus, newPaidDate, invoiceId]
    );

    await client.query('COMMIT');

    return {
      payment: {
        id: insertRes.insertId,
        payment_no: paymentNo,
        invoice_id: invoiceId,
        payment_date: payDate,
        amount: numAmount,
        payment_method: methodStr,
        notes: notes || null,
        is_down_payment: Boolean(isDownPayment),
        cash_transaction_id: ctId
      },
      invoice: {
        id: invoiceId,
        total: total,
        paid_amount: newTotalPaid,
        sisa: newSisa,
        status: newStatus,
        paid_date: newPaidDate
      }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record payment for Purchase Order (Hutang Vendor)
 * - Role: admin / gudang
 * - Amount > 0, integer (bulat)
 * - Date <= today
 * - Row lock FOR UPDATE on purchase_orders
 * - Dynamic balance calculation from active payments in purchase_order_payments
 * - Overpayment rejection (amount <= sisa)
 * - Atomic payment_no generation: POP-YYYY-MM-NNNNN
 * - Cash transaction creation (type: 'OUT', category: 'Pelunasan Hutang')
 * - purchase_order_payments insertion
 * - purchase_orders (paid_amount, status, paid_date) update
 */
async function recordPurchaseOrderPayment({ poId, amount, paymentDate, paymentMethod, notes, isDownPayment = 0, userId }) {
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    const err = new Error('Nominal pembayaran harus berupa angka lebih besar dari 0');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(numAmount)) {
    const err = new Error('Nominal pembayaran harus berupa Rupiah bulat tanpa pecahan');
    err.status = 400;
    throw err;
  }

  const todayStr = formatDateStr(new Date());
  const payDate = paymentDate ? formatDateStr(paymentDate) : todayStr;
  if (payDate > todayStr) {
    const err = new Error('Tanggal pembayaran tidak boleh di masa depan');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock purchase_order row
    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (poRes.rows.length === 0) {
      const err = new Error('Purchase Order tidak ditemukan');
      err.status = 404;
      throw err;
    }
    const po = poRes.rows[0];

    if (po.status === 'Batal' || po.status === 'Cancel') {
      const err = new Error('Purchase Order yang sudah dibatalkan tidak dapat menerima pembayaran');
      err.status = 400;
      throw err;
    }

    const total = parseFloat(po.total || 0);
    const returnAmount = parseFloat(po.return_amount || 0);

    // 2. Lock & calculate active payments from purchase_order_payments
    const payRes = await client.query(
      'SELECT id, amount FROM purchase_order_payments WHERE purchase_order_id = ? AND status = ? FOR UPDATE',
      [poId, 'active']
    );

    let currentTotalPaid = 0;
    if (payRes.rows.length > 0) {
      currentTotalPaid = payRes.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    } else {
      currentTotalPaid = parseFloat(po.paid_amount || 0);
    }

    const sisa = Math.max(0, total - returnAmount - currentTotalPaid);

    if (sisa <= 0) {
      const err = new Error('Hutang PO ini sudah lunas, tidak ada sisa tagihan');
      err.status = 400;
      throw err;
    }

    if (numAmount > sisa) {
      const err = new Error(`Pembayaran melebihi sisa hutang! Sisa hutang: Rp ${Math.round(sisa).toLocaleString('id-ID')}, nominal bayar: Rp ${Math.round(numAmount).toLocaleString('id-ID')}`);
      err.status = 400;
      throw err;
    }

    // 3. Generate atomic payment reference number: POP-YYYY-MM-NNNNN
    const paymentNo = await generatePurchasePaymentNo(client, payDate);

    // 4. Create cash transaction OUT
    const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
    const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
    const ctCategory = 'Pelunasan Hutang';
    const ctDesc = isDownPayment
      ? `Uang Muka (DP) PO ${poId} (${paymentNo})`
      : `Pembayaran Cicilan PO ${poId} (${paymentNo})`;
    const methodStr = paymentMethod || 'Transfer Bank';

    await client.query(
      `INSERT INTO cash_transactions (id, date, type, category, description, amount, method, purchase_order_id, user_id, status)
       VALUES (?, ?, 'OUT', ?, ?, ?, ?, ?, ?, 'active')`,
      [ctId, payDate, ctCategory, ctDesc, numAmount, methodStr, poId, userId]
    );

    // 5. Insert to purchase_order_payments
    const insertRes = await client.query(
      `INSERT INTO purchase_order_payments
       (payment_no, purchase_order_id, payment_date, amount, payment_method, notes, is_down_payment, status, cash_transaction_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [paymentNo, poId, payDate, numAmount, methodStr, notes || null, isDownPayment ? 1 : 0, ctId, userId]
    );

    // 6. Recalculate totals and update purchase_orders
    const newTotalPaid = currentTotalPaid + numAmount;
    const newSisa = Math.max(0, total - returnAmount - newTotalPaid);
    const newStatus = newSisa <= 0 ? 'Selesai' : 'Dalam Proses';
    const newPaidDate = newStatus === 'Selesai' ? payDate : null;

    await client.query(
      'UPDATE purchase_orders SET paid_amount = ?, status = ?, paid_date = ? WHERE id = ?',
      [newTotalPaid, newStatus, newPaidDate, poId]
    );

    await client.query('COMMIT');

    return {
      payment: {
        id: insertRes.insertId,
        payment_no: paymentNo,
        purchase_order_id: poId,
        payment_date: payDate,
        amount: numAmount,
        payment_method: methodStr,
        notes: notes || null,
        is_down_payment: Boolean(isDownPayment),
        cash_transaction_id: ctId
      },
      purchase: {
        id: poId,
        total: total,
        return_amount: returnAmount,
        paid_amount: newTotalPaid,
        sisa: newSisa,
        status: newStatus,
        paid_date: newPaidDate
      }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

app.get('/api/finance/receivables', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, customer_id, status, paginate, all } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';
    const todayStr = formatDateStr(new Date());

    const whereConditions = ["si.status NOT IN ('Batal', 'Cancel', 'Dibatalkan')"];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(si.id LIKE ? OR c.name LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern);
    }

    if (customer_id && customer_id !== 'all') {
      whereConditions.push('si.customer_id = ?');
      params.push(customer_id);
    }

    if (status && status !== 'all') {
      const qStatus = status.toLowerCase();
      if (qStatus === 'overdue') {
        whereConditions.push('(si.total - si.paid_amount) > 0 AND si.due_date IS NOT NULL AND si.due_date < CURDATE()');
      } else if (qStatus.includes('belum')) {
        whereConditions.push('LOWER(si.status) LIKE ?');
        params.push('%belum%');
      } else if (qStatus === 'sebagian') {
        whereConditions.push('LOWER(si.status) = ?');
        params.push('sebagian');
      } else if (qStatus === 'lunas') {
        whereConditions.push('LOWER(si.status) = ?');
        params.push('lunas');
      }
    } else {
      whereConditions.push("si.status NOT IN ('Lunas', 'Batal', 'Cancel', 'Dibatalkan')");
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // Summary query must be calculated from ALL active piutang data according to filters
    const summaryWhereConditions = ["si.status NOT IN ('Lunas', 'Batal', 'Cancel', 'Dibatalkan')"];
    const summaryParams = [];
    if (searchQuery) {
      summaryWhereConditions.push('(si.id LIKE ? OR c.name LIKE ?)');
      const pattern = `%${searchQuery}%`;
      summaryParams.push(pattern, pattern);
    }
    if (customer_id && customer_id !== 'all') {
      summaryWhereConditions.push('si.customer_id = ?');
      summaryParams.push(customer_id);
    }
    const summaryWhereClause = 'WHERE ' + summaryWhereConditions.join(' AND ');

    const mapReceivableRow = (r) => {
      const total = parseFloat(r.total || 0);
      const paid = parseFloat(r.paid_amount || 0);
      const returnAmount = parseFloat(r.return_amount || 0);
      const sisa = Math.max(0, total - paid - returnAmount);
      const dueDateStr = formatDateStr(r.due_date);
      const isOverdue = sisa > 0 && Boolean(dueDateStr) && dueDateStr < todayStr;

      return {
        id: r.id,
        date: formatDateStr(r.date),
        dueDate: dueDateStr,
        customerId: r.customer_id,
        customer: r.customer_name || 'Tanpa Pelanggan',
        customerPhone: r.customer_phone || '-',
        total: total,
        paid: paid,
        returnAmount: returnAmount,
        sisa: sisa,
        type: r.payment_type_name || 'Kredit',
        status: r.status,
        isOverdue: isOverdue,
        paidDate: formatDateStr(r.paid_date) || null,
        isOutstandingImport: Boolean(r.is_outstanding_import)
      };
    };

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      // Summary query
      const summarySql = `
        SELECT 
          COALESCE(SUM(si.total - si.paid_amount), 0) AS total_piutang,
          COALESCE(SUM(CASE WHEN LOWER(si.status) LIKE '%belum%' THEN si.total ELSE 0 END), 0) AS belum_bayar,
          COALESCE(SUM(CASE WHEN LOWER(si.status) = 'sebagian' THEN si.total - si.paid_amount ELSE 0 END), 0) AS sebagian
        FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        ${summaryWhereClause}
      `;
      const summaryRes = await pool.query(summarySql, summaryParams);
      const sumRow = summaryRes.rows[0] || {};

      // Count query for list
      const countSql = `
        SELECT COUNT(*) AS total 
        FROM sales_invoices si 
        LEFT JOIN customers c ON si.customer_id = c.id 
        ${whereClause}
      `;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);

      // Data query
      const dataSql = `
        SELECT si.*, c.name as customer_name, c.phone as customer_phone, pt.name as payment_type_name
        FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
        ${whereClause}
        ORDER BY si.due_date ASC, si.date DESC, si.id DESC
        LIMIT ? OFFSET ?
      `;
      const result = await pool.query(dataSql, [...params, limitNum, offset]);

      return res.json({
        data: result.rows.map(mapReceivableRow),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        },
        summary: {
          totalPiutang: parseFloat(sumRow.total_piutang || 0),
          belumBayar: parseFloat(sumRow.belum_bayar || 0),
          sebagian: parseFloat(sumRow.sebagian || 0),
          total_piutang: parseFloat(sumRow.total_piutang || 0),
          belum_bayar: parseFloat(sumRow.belum_bayar || 0)
        }
      });
    }

    const result = await pool.query(`
      SELECT si.*, c.name as customer_name, c.phone as customer_phone, pt.name as payment_type_name
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
      ${whereClause}
      ORDER BY si.due_date ASC, si.date DESC, si.id DESC
    `, params);
    res.json(result.rows.map(mapReceivableRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices/:id/payments', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const result = await recordInvoicePayment({
      invoiceId: req.params.id,
      amount: req.body.amount,
      paymentDate: req.body.date || req.body.payment_date,
      paymentMethod: req.body.method || req.body.payment_method || 'Transfer Bank',
      notes: req.body.notes,
      isDownPayment: 0,
      userId: req.user.id
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * DELETE /api/finance/receivables/:id
 * Hapus invoice khusus yang berasal dari fitur Import / Input Invoice Outstanding.
 * Hak akses: Administrator dan Finance
 */
app.delete('/api/finance/receivables/:id', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const invId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock baris invoice
    const invRes = await client.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [invId]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    const inv = invRes.rows[0];

    // 2. Validasi ketat: Hanya invoice import/manual outstanding yang boleh dihapus
    const itemsCheck = await client.query('SELECT COUNT(*) as count FROM invoice_items WHERE invoice_id = ?', [invId]);
    const itemCount = parseInt(itemsCheck.rows[0]?.count || 0);

    if (!inv.is_outstanding_import || itemCount > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Akses ditolak: Hanya invoice yang berasal dari Input/Import Outstanding yang dapat dihapus. Piutang dari transaksi penjualan tidak dapat dihapus.'
      });
    }

    // 3. Batalkan arus kas dan hapus data cicilan terkait secara transaksional
    await client.query(
      `UPDATE cash_transactions SET status = 'cancelled' WHERE invoice_id = ? AND (status IS NULL OR status = 'active')`,
      [invId]
    );

    await client.query('DELETE FROM sales_invoice_payments WHERE invoice_id = ?', [invId]);

    // 4. Hapus sales_invoices (tidak ada pemotongan stok karena invoice outstanding)
    await client.query('DELETE FROM sales_invoices WHERE id = ?', [invId]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Invoice outstanding berhasil dihapus' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Delete Outstanding Receivable Error]:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Alias for outstanding invoice deletion
app.delete('/api/invoices/outstanding/:id', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  req.url = `/api/finance/receivables/${req.params.id}`;
  app.handle(req, res);
});

/**
 * POST /api/finance/receivables/export-pdf
 * Export PDF laporan piutang untuk baris invoice terpilih.
 * Hak akses: Administrator dan Finance
 */
app.post('/api/finance/receivables/export-pdf', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Daftar invoice untuk di-export tidak boleh kosong' });
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      SELECT si.id, si.date, si.due_date, si.total, si.paid_amount, si.status,
             c.name AS customer_name, c.phone AS customer_phone
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      WHERE si.id IN (${placeholders}) AND si.status NOT IN ('Batal', 'Cancel', 'Dibatalkan')
      ORDER BY c.name ASC, si.date ASC, si.id ASC
    `;
    const invRes = await pool.query(sql, ids);
    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tidak ada data piutang valid yang ditemukan untuk dicetak' });
    }

    const companyRes = await pool.query("SELECT value FROM settings WHERE `key` = 'company_name'");
    const companyName = companyRes.rows[0]?.value || 'SupplierPro';

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
      bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="laporan_piutang.pdf"');
    doc.pipe(res);

    const formatRp = (num) => 'Rp ' + Math.round(parseFloat(num) || 0).toLocaleString('id-ID');
    const formatDate = (dateStr) => {
      if (!dateStr) return '-';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr).split('T')[0];
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const printDate = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 36;
    const contentWidth = pageWidth - (margin * 2);

    const cols = [
      { id: 'customer', label: 'Nama Customer', width: 170, align: 'left' },
      { id: 'invoice_id', label: 'No. Invoice', width: 115, align: 'left' },
      { id: 'date', label: 'Tgl Invoice', width: 80, align: 'center' },
      { id: 'due_date', label: 'Jatuh Tempo', width: 80, align: 'center' },
      { id: 'total', label: 'Total Invoice', width: 110, align: 'right' },
      { id: 'paid', label: 'Sudah Dibayar', width: 105, align: 'right' },
      { id: 'sisa', label: 'Sisa Piutang', width: 105, align: 'right' }
    ];

    let currentY = 36;

    function renderHeader() {
      doc.save();
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#1e293b')
        .text('LAPORAN PIUTANG', margin, currentY, { align: 'left' });

      doc.font('Helvetica').fontSize(10).fillColor('#64748b')
        .text(`Unit Usaha: ${companyName}`, margin, currentY + 20, { align: 'left' });

      doc.fontSize(9).fillColor('#64748b')
        .text(`Tanggal Cetak: ${printDate}`, margin, currentY + 20, { align: 'right', width: contentWidth });

      currentY += 40;

      doc.rect(margin, currentY, contentWidth, 24).fill('#f1f5f9');
      doc.rect(margin, currentY, contentWidth, 24).stroke('#cbd5e1');

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155');
      let curX = margin;
      cols.forEach(col => {
        doc.text(col.label, curX + 4, currentY + 7, { width: col.width - 8, align: col.align });
        curX += col.width;
      });

      currentY += 24;
      doc.restore();
    }

    renderHeader();

    const grouped = {};
    invRes.rows.forEach(r => {
      const cust = r.customer_name || 'Tanpa Pelanggan';
      if (!grouped[cust]) grouped[cust] = [];
      grouped[cust].push(r);
    });

    const isMultiCustomer = Object.keys(grouped).length > 1;
    let grandTotal = 0;
    let grandPaid = 0;
    let grandSisa = 0;
    const rowHeight = 20;

    for (const custName of Object.keys(grouped)) {
      const items = grouped[custName];
      let subTotal = 0;
      let subPaid = 0;
      let subSisa = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const tot = parseFloat(item.total) || 0;
        const pd = parseFloat(item.paid_amount) || 0;
        const rem = Math.max(0, tot - pd);

        subTotal += tot;
        subPaid += pd;
        subSisa += rem;

        grandTotal += tot;
        grandPaid += pd;
        grandSisa += rem;

        if (currentY + rowHeight > pageHeight - 50) {
          doc.addPage();
          currentY = 36;
          renderHeader();
        }

        if (i % 2 === 1) {
          doc.rect(margin, currentY, contentWidth, rowHeight).fill('#f8fafc');
        }
        doc.moveTo(margin, currentY + rowHeight).lineTo(margin + contentWidth, currentY + rowHeight).strokeColor('#e2e8f0').stroke();

        doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b');
        let curX = margin;

        doc.text(custName, curX + 4, currentY + 5, { width: cols[0].width - 8, align: cols[0].align, lineBreak: false });
        curX += cols[0].width;

        doc.text(String(item.id), curX + 4, currentY + 5, { width: cols[1].width - 8, align: cols[1].align });
        curX += cols[1].width;

        doc.text(formatDate(item.date), curX + 4, currentY + 5, { width: cols[2].width - 8, align: cols[2].align });
        curX += cols[2].width;

        doc.text(formatDate(item.due_date), curX + 4, currentY + 5, { width: cols[3].width - 8, align: cols[3].align });
        curX += cols[3].width;

        doc.text(formatRp(tot), curX + 4, currentY + 5, { width: cols[4].width - 8, align: cols[4].align });
        curX += cols[4].width;

        doc.text(formatRp(pd), curX + 4, currentY + 5, { width: cols[5].width - 8, align: cols[5].align });
        curX += cols[5].width;

        doc.font('Helvetica-Bold').fillColor(rem > 0 ? '#b91c1c' : '#059669')
          .text(formatRp(rem), curX + 4, currentY + 5, { width: cols[6].width - 8, align: cols[6].align });

        currentY += rowHeight;
      }

      if (isMultiCustomer) {
        if (currentY + rowHeight > pageHeight - 50) {
          doc.addPage();
          currentY = 36;
          renderHeader();
        }

        doc.rect(margin, currentY, contentWidth, rowHeight).fill('#f1f5f9');
        doc.rect(margin, currentY, contentWidth, rowHeight).stroke('#cbd5e1');

        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155');
        const labelWidth = cols[0].width + cols[1].width + cols[2].width + cols[3].width;
        doc.text(`Subtotal ${custName}:`, margin + 4, currentY + 5, { width: labelWidth - 8, align: 'right' });

        let curX = margin + labelWidth;
        doc.text(formatRp(subTotal), curX + 4, currentY + 5, { width: cols[4].width - 8, align: cols[4].align });
        curX += cols[4].width;
        doc.text(formatRp(subPaid), curX + 4, currentY + 5, { width: cols[5].width - 8, align: cols[5].align });
        curX += cols[5].width;
        doc.fillColor('#b91c1c').text(formatRp(subSisa), curX + 4, currentY + 5, { width: cols[6].width - 8, align: cols[6].align });

        currentY += rowHeight + 4;
      }
    }

    if (currentY + 24 > pageHeight - 50) {
      doc.addPage();
      currentY = 36;
      renderHeader();
    }

    doc.rect(margin, currentY, contentWidth, 24).fill('#e2e8f0');
    doc.rect(margin, currentY, contentWidth, 24).stroke('#94a3b8');

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
    const labelWidth = cols[0].width + cols[1].width + cols[2].width + cols[3].width;
    doc.text('TOTAL KESELURUHAN:', margin + 4, currentY + 7, { width: labelWidth - 8, align: 'right' });

    let curX = margin + labelWidth;
    doc.text(formatRp(grandTotal), curX + 4, currentY + 7, { width: cols[4].width - 8, align: cols[4].align });
    curX += cols[4].width;
    doc.text(formatRp(grandPaid), curX + 4, currentY + 7, { width: cols[5].width - 8, align: cols[5].align });
    curX += cols[5].width;
    doc.fillColor('#b91c1c').text(formatRp(grandSisa), curX + 4, currentY + 7, { width: cols[6].width - 8, align: cols[6].align });

    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(p);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
        .text(`Halaman ${p + 1} dari ${range.count}`, margin, pageHeight - 26, {
          width: contentWidth,
          align: 'center'
        });
    }

    doc.end();
  } catch (err) {
    console.error('PDF Export Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal membuat file PDF: ' + err.message });
    }
  }
});

// Backward-compatible endpoint for existing UI and tests
app.post('/api/finance/receivables/:id/pay', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const result = await recordInvoicePayment({
      invoiceId: req.params.id,
      amount: req.body.amount,
      paymentDate: req.body.date || req.body.payment_date,
      paymentMethod: req.body.payment_type_id || req.body.method || req.body.payment_method || 'Transfer Bank',
      notes: req.body.notes,
      isDownPayment: 0,
      userId: req.user.id
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

app.get('/api/invoices/:id/payments', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { id } = req.params;
  try {
    const invRes = await pool.query(`
      SELECT si.*, c.name as customer_name, pt.name as payment_type_name
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
      WHERE si.id = $1
    `, [id]);

    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    const inv = invRes.rows[0];

    const payRes = await pool.query(`
      SELECT sip.*, u.name as created_by_name, vu.name as void_by_name
      FROM sales_invoice_payments sip
      LEFT JOIN users u ON sip.created_by = u.id
      LEFT JOIN users vu ON sip.void_by = vu.id
      WHERE sip.invoice_id = $1
      ORDER BY sip.id ASC
    `, [id]);

    const todayStr = formatDateStr(new Date());
    const total = parseFloat(inv.total || 0);
    const activePayments = payRes.rows.filter(p => p.status === 'active');
    const totalPaidFromPayments = activePayments.reduce((s, p) => s + parseFloat(p.amount), 0);
    const totalPaid = payRes.rows.length > 0 ? totalPaidFromPayments : parseFloat(inv.paid_amount || 0);
    const sisa = Math.max(0, total - totalPaid);
    const dueDateStr = formatDateStr(inv.due_date);
    const isOverdue = sisa > 0 && Boolean(dueDateStr) && dueDateStr < todayStr;

    res.json({
      invoice: {
        id: inv.id,
        date: formatDateStr(inv.date),
        dueDate: dueDateStr,
        customer: inv.customer_name || 'Tanpa Pelanggan',
        type: inv.payment_type_name || 'Kredit',
        total: total,
        paid: totalPaid,
        sisa: sisa,
        status: inv.status,
        isOverdue: isOverdue,
        paidDate: formatDateStr(inv.paid_date) || null
      },
      payments: payRes.rows.map(p => ({
        id: p.id,
        paymentNo: p.payment_no,
        date: formatDateStr(p.payment_date),
        amount: parseFloat(p.amount),
        method: p.payment_method,
        notes: p.notes || '',
        isDownPayment: Boolean(p.is_down_payment),
        status: p.status,
        voidReason: p.void_reason || null,
        voidBy: p.void_by_name || null,
        voidAt: p.void_at ? (typeof p.void_at === 'string' ? p.void_at : p.void_at.toISOString()) : null,
        createdBy: p.created_by_name || 'Staff'
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Void Payment Endpoint (supports /api/invoices/payments/:paymentId/void and /api/invoices/:id/payments/:paymentId/void)
const handleVoidPayment = async (req, res) => {
  const paymentId = req.params.paymentId;
  const reason = (req.body.reason || req.body.void_reason || '').trim();

  if (!reason) {
    return res.status(400).json({ error: 'Alasan pembatalan (void) wajib diisi' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find and lock the payment record
    const isNum = !isNaN(parseInt(paymentId, 10)) && /^\d+$/.test(paymentId);
    let payQuery = 'SELECT * FROM sales_invoice_payments WHERE ';
    const payParams = isNum ? [parseInt(paymentId, 10)] : [paymentId];
    payQuery += isNum ? 'id = ? FOR UPDATE' : 'payment_no = ? FOR UPDATE';

    const payRes = await client.query(payQuery, payParams);
    if (payRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Data pembayaran tidak ditemukan' });
    }
    const payment = payRes.rows[0];

    if (payment.status === 'void') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Pembayaran ini sudah dibatalkan (void) sebelumnya' });
    }

    const invoiceId = payment.invoice_id;

    // 2. Lock the associated invoice
    const invRes = await client.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [invoiceId]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice terkait tidak ditemukan' });
    }
    const invoice = invRes.rows[0];

    // 3. Mark payment as void
    await client.query(
      `UPDATE sales_invoice_payments 
       SET status = 'void', void_reason = ?, void_by = ?, void_at = NOW() 
       WHERE id = ?`,
      [reason, req.user.id, payment.id]
    );

    // 4. Reversal cash transaction (mark status as 'cancelled')
    if (payment.cash_transaction_id) {
      await client.query(
        `UPDATE cash_transactions 
         SET status = 'cancelled' 
         WHERE id = ?`,
        [payment.cash_transaction_id]
      );
    }

    // 5. Recalculate invoice totals from all remaining active payments
    const activePayRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total_active, MAX(payment_date) as last_date, COUNT(*) as count 
       FROM sales_invoice_payments 
       WHERE invoice_id = ? AND status = 'active'`,
      [invoiceId]
    );
    const totalActivePaid = parseFloat(activePayRes.rows[0].total_active || 0);
    const invoiceTotal = parseFloat(invoice.total || 0);
    const newSisa = Math.max(0, invoiceTotal - totalActivePaid);
    const newStatus = newSisa <= 0 ? 'Lunas' : (totalActivePaid > 0 ? 'Sebagian' : 'Belum Lunas');
    const newPaidDate = newStatus === 'Lunas' ? activePayRes.rows[0].last_date : null;

    await client.query(
      `UPDATE sales_invoices 
       SET paid_amount = ?, status = ?, paid_date = ? 
       WHERE id = ?`,
      [totalActivePaid, newStatus, newPaidDate, invoiceId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Pembayaran berhasil dibatalkan (void)',
      payment: {
        id: payment.id,
        payment_no: payment.payment_no,
        invoice_id: invoiceId,
        amount: parseFloat(payment.amount),
        status: 'void',
        void_reason: reason,
        void_by: req.user.id
      },
      invoice: {
        id: invoiceId,
        total: invoiceTotal,
        paid_amount: totalActivePaid,
        sisa: newSisa,
        status: newStatus,
        paid_date: newPaidDate ? formatDateStr(newPaidDate) : null
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Void Payment Error]:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

app.post('/api/invoices/payments/:paymentId/void', authenticateToken, authorizeRoles('admin', 'finance'), handleVoidPayment);
app.post('/api/invoices/:id/payments/:paymentId/void', authenticateToken, authorizeRoles('admin', 'finance'), handleVoidPayment);

// --- Cash Flow Route ---
// Auto-migrate: add 'status' column if not exists
pool.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`)
  .catch(err => console.error('Error adding status column to cash_transactions:', err));

// Auto-migrate: add customer_fee and fee_notes columns to invoice_items if not exists
(async () => {
  try {
    await pool.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS customer_fee NUMERIC(15,2) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS fee_notes VARCHAR(255)`);
    console.log('[Migration] invoice_items: customer_fee & fee_notes columns ensured');

    await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS subtotal DECIMAL(20,4) DEFAULT 0`);
    await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS discount DECIMAL(20,4) DEFAULT 0`);
    await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax DECIMAL(20,4) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost_price_snapshot DECIMAL(20,4) DEFAULT 0`);
    console.log('[Migration] purchase_orders: subtotal, discount, tax columns ensured');
    console.log('[Migration] invoice_items: cost_price_snapshot column ensured');

    // Add paid_date to invoices and purchases
    await pool.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS paid_date DATE DEFAULT NULL`);
    await pool.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS is_outstanding_import TINYINT(1) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_date DATE DEFAULT NULL`);
    await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS is_outstanding_import TINYINT(1) NOT NULL DEFAULT 0`);
    console.log('[Migration] sales_invoices & purchase_orders: paid_date & is_outstanding_import column ensured');

    // Auto-migrasi field baru tabel customers
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS ktp VARCHAR(50) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS npwp VARCHAR(50) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS npwp_name VARCHAR(255) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS npwp_address TEXT NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nib VARCHAR(30) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_hp_2 VARCHAR(30) NULL`);
    // Auto-migrasi tabel pembayaran cicilan invoice & counter
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_counters (
        year INT NOT NULL PRIMARY KEY,
        last_number INT NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_invoice_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        payment_no VARCHAR(50) UNIQUE NOT NULL,
        invoice_id VARCHAR(255) NOT NULL,
        payment_date DATE NOT NULL,
        amount DECIMAL(20,4) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        notes TEXT DEFAULT NULL,
        is_down_payment TINYINT(1) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        void_reason TEXT DEFAULT NULL,
        void_by INT DEFAULT NULL,
        void_at DATETIME DEFAULT NULL,
        cash_transaction_id VARCHAR(255) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_invoice_id (invoice_id),
        INDEX idx_payment_date (payment_date),
        INDEX idx_status (status),
        FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE RESTRICT,
        FOREIGN KEY (void_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (cash_transaction_id) REFERENCES cash_transactions(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await pool.query("INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_payment', 'PAY-{YYYY}-{MM}-')");
    console.log('[Migration] sales_invoice_payments & payment_counters tables ensured');

    // Auto-migrasi tabel pembayaran cicilan PO & counter
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_payment_counters (
        year INT NOT NULL PRIMARY KEY,
        last_number INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        payment_no VARCHAR(50) UNIQUE NOT NULL,
        purchase_order_id VARCHAR(255) NOT NULL,
        payment_date DATE NOT NULL,
        amount DECIMAL(20,4) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        notes TEXT DEFAULT NULL,
        is_down_payment TINYINT(1) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        void_reason TEXT DEFAULT NULL,
        void_by INT DEFAULT NULL,
        void_at DATETIME DEFAULT NULL,
        cash_transaction_id VARCHAR(255) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_po_id (purchase_order_id),
        INDEX idx_payment_date (payment_date),
        INDEX idx_status (status),
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
        FOREIGN KEY (void_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (cash_transaction_id) REFERENCES cash_transactions(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    await pool.query("INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_purchase_payment', 'POP-{YYYY}-{MM}-')");
    console.log('[Migration] purchase_order_payments & purchase_payment_counters tables ensured');

    // Auto-migrasi tabel konversi produk & counter
    // Collation: utf8mb4_general_ci (default lokal); di Hostinger tabel sudah dibuat via SQL import
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversion_counters (
        year INT NOT NULL PRIMARY KEY,
        last_number INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_conversions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(50) NOT NULL,
        date DATE NOT NULL,
        source_product_id VARCHAR(255) NOT NULL,
        target_product_id VARCHAR(255) NOT NULL,
        source_qty DECIMAL(20,4) NOT NULL,
        target_qty DECIMAL(20,4) NOT NULL,
        source_hpp_snapshot DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
        moved_value DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
        target_stock_before DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
        target_hpp_before DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
        target_hpp_after DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
        notes TEXT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'posted',
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        cancelled_by INT NULL,
        cancelled_at DATETIME NULL,
        cancel_reason TEXT NULL,
        UNIQUE KEY uq_pc_number (number),
        KEY idx_pc_date (date),
        KEY idx_pc_status (status),
        KEY idx_pc_source (source_product_id),
        KEY idx_pc_target (target_product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    await pool.query("INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_conversion', 'KNV-{YYYY}-')");
    console.log('[Migration] product_conversions & conversion_counters tables ensured');
  } catch (err) {
    console.error('[Migration] Failed to execute migrations:', err.message);
  }
})();

app.get(['/api/finance/cash-flow', '/api/finance/cashflow'], authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const { page, limit: limitQ, type, category, search, q, paginate, all } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';

    const whereConditions = [];
    const params = [];

    if (type && type !== 'all') {
      whereConditions.push('UPPER(ct.type) = ?');
      params.push(type.toUpperCase());
    }

    if (category && category !== 'all') {
      whereConditions.push('ct.category = ?');
      params.push(category);
    }

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(ct.description LIKE ? OR ct.category LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const mapCashRow = (r) => ({
      id: r.id,
      date: formatDateStr(r.date),
      type: r.type,
      category: r.category,
      desc: r.description,
      amount: parseFloat(r.amount),
      method: r.method || '-',
      invoiceId: r.invoice_id || '',
      purchaseOrderId: r.purchase_order_id || '',
      status: r.status || 'active',
      isManual: !r.invoice_id && !r.purchase_order_id,
      runningBalance: parseFloat(r.running_balance || 0),
      running_balance: parseFloat(r.running_balance || 0)
    });

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      // Header summary calculated from ALL active transactions matching filter
      const summarySql = `
        SELECT 
          COALESCE(SUM(CASE WHEN ct.type = 'IN' AND (ct.status IS NULL OR ct.status = 'active') THEN ct.amount ELSE 0 END), 0) AS total_in,
          COALESCE(SUM(CASE WHEN ct.type = 'OUT' AND (ct.status IS NULL OR ct.status = 'active') THEN ct.amount ELSE 0 END), 0) AS total_out
        FROM cash_transactions ct
        ${whereClause}
      `;
      const summaryRes = await pool.query(summarySql, params);
      const sumRow = summaryRes.rows[0] || {};
      const totalIn = parseFloat(sumRow.total_in || 0);
      const totalOut = parseFloat(sumRow.total_out || 0);
      const net = totalIn - totalOut;

      const countSql = `SELECT COUNT(*) AS total FROM cash_transactions ct ${whereClause}`;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);

      // Running balance using MariaDB Window Function
      const dataSql = `
        SELECT * FROM (
          SELECT 
            ct.*,
            SUM(
              CASE 
                WHEN (ct.status IS NULL OR ct.status = 'active') 
                THEN (CASE WHEN ct.type = 'IN' THEN ct.amount ELSE -ct.amount END) 
                ELSE 0 
              END
            ) OVER (ORDER BY ct.date ASC, ct.id ASC) AS running_balance
          FROM cash_transactions ct
        ) t
        ${whereClause.replace(/\bct\./g, 't.')}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ? OFFSET ?
      `;
      const result = await pool.query(dataSql, [...params, limitNum, offset]);

      return res.json({
        data: result.rows.map(mapCashRow),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        },
        summary: {
          totalIn,
          totalOut,
          net
        }
      });
    }

    // Unpaginated fallback
    const result = await pool.query(`
      SELECT * FROM cash_transactions ct
      ${whereClause}
      ORDER BY ct.date DESC, ct.id DESC
    `, params);
    return res.json(result.rows.map(mapCashRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/finance/cash-flow', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { type, category, description, amount, method, date } = req.body;
  const userId = req.user.id;
  if (!type || !amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Tipe dan jumlah wajib diisi' });
  }
  try {
    const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
    const ctId = await generateNextId(pool, 'cash_transactions', ctPrefix);
    const ctDate = date || new Date().toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO cash_transactions (id, date, type, category, description, amount, method, status, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
      [ctId, ctDate, type, category || (type === 'IN' ? 'Pendapatan Lainnya' : 'Pengeluaran Lainnya'), description || '-', parseFloat(amount), method || 'Transfer Bank', userId]
    );
    res.json({ success: true, id: ctId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT - Edit transaksi kas manual (hanya yang tidak punya invoice_id / purchase_order_id)
app.put('/api/finance/cash-flow/:id', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { id } = req.params;
  const { type, category, description, amount, method, date } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM cash_transactions WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    const tx = existing.rows[0];
    if (tx.invoice_id || tx.purchase_order_id) {
      return res.status(403).json({ error: 'Transaksi otomatis tidak dapat diedit' });
    }
    await pool.query(
      `UPDATE cash_transactions SET type=$1, category=$2, description=$3, amount=$4, method=$5, date=$6 WHERE id=$7`,
      [type || tx.type, category || tx.category, description || tx.description,
      parseFloat(amount) || tx.amount, method || tx.method, date || tx.date, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Batalkan transaksi kas (soft delete + reversal untuk auto transactions)
app.patch('/api/finance/cash-flow/:id/cancel', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM cash_transactions WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }
    const tx = existing.rows[0];
    if ((tx.status || 'active') === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Transaksi sudah dibatalkan' });
    }

    // Soft delete
    await client.query(`UPDATE cash_transactions SET status='cancelled' WHERE id=$1`, [id]);

    // Reversal untuk transaksi otomatis
    if (tx.invoice_id) {
      // Void corresponding sales_invoice_payments row if exists
      await client.query(
        `UPDATE sales_invoice_payments 
         SET status = 'void', void_reason = 'Dibatalkan melalui modul Arus Kas', void_by = ?, void_at = NOW() 
         WHERE cash_transaction_id = ? AND status = 'active'`,
        [req.user.id, id]
      );

      // Reversal invoice paid_amount & status
      const invRes = await client.query('SELECT * FROM sales_invoices WHERE id=$1', [tx.invoice_id]);
      if (invRes.rows.length > 0) {
        const inv = invRes.rows[0];
        const newPaid = Math.max(0, parseFloat(inv.paid_amount) - parseFloat(tx.amount));
        const newStatus = newPaid >= parseFloat(inv.total) ? 'Lunas' : newPaid > 0 ? 'Sebagian' : 'Belum Lunas';
        const newPaidDate = newStatus === 'Lunas' ? inv.paid_date : null;
        await client.query('UPDATE sales_invoices SET paid_amount=$1, status=$2, paid_date=$3 WHERE id=$4', [newPaid, newStatus, newPaidDate, tx.invoice_id]);
      }
    } else if (tx.purchase_order_id) {
      // Reversal PO paid_amount
      const poRes = await client.query('SELECT * FROM purchase_orders WHERE id=$1', [tx.purchase_order_id]);
      if (poRes.rows.length > 0) {
        const po = poRes.rows[0];
        const newPaid = Math.max(0, parseFloat(po.paid_amount) - parseFloat(tx.amount));
        const newStatus = newPaid >= parseFloat(po.total) ? 'Selesai' : 'Dalam Proses';
        await client.query('UPDATE purchase_orders SET paid_amount=$1, status=$2 WHERE id=$3', [newPaid, newStatus, tx.purchase_order_id]);
      }
    } else if (tx.category === 'Penyesuaian Stok') {
      // Reversal for stock opname
      const match = tx.description.match(/Stock Opname: (.*?) \| Sebelum: ([\d.]+) → Sesudah: ([\d.]+)/);
      if (match) {
        let productName = match[1].trim();
        let productId = null;
        const idMatch = productName.match(/^\[(.*?)\]\s+(.*)/);
        if (idMatch) {
          productId = idMatch[1];
          productName = idMatch[2];
        }

        const oldStock = parseFloat(match[2]);
        const newStock = parseFloat(match[3]);
        const diff = newStock - oldStock; // Positive if stock increased, negative if decreased

        // Reverse the diff: subtract it from the current stock
        const curProd = await client.query('SELECT stock FROM products WHERE ' + (productId ? 'id = ?' : 'name = ?') + ' FOR UPDATE', [productId || productName]);
        const curStock = parseFloat(curProd.rows[0]?.stock || 0);
        const nextStock = curStock - diff;

        if (productId) {
          await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [diff, productId]);
        } else {
          await client.query('UPDATE products SET stock = stock - $1 WHERE name = $2', [diff, productName]);
        }

        if (productId) {
          await recordStockMove(client, {
            product_id: productId,
            tipe: 'opname',
            ref_type: 'cash_transaction',
            ref_id: id,
            ref_no: id,
            qty_masuk: diff < 0 ? Math.abs(diff) : 0,
            qty_keluar: diff > 0 ? diff : 0,
            qty_sebelum: curStock,
            qty_sesudah: nextStock,
            keterangan: `Pembatalan Opname Kas: ${id}`,
            created_by: req.user.id
          });
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Laba Rugi Endpoint ---
app.get('/api/laporan/laba-rugi', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const bulan = parseInt(req.query.bulan, 10);
  const tahun = parseInt(req.query.tahun, 10);

  console.log(`[Laba Rugi] Request params: bulan="${req.query.bulan}" tahun="${req.query.tahun}" → parsed: bulan=${bulan} tahun=${tahun}`);

  if (isNaN(bulan) || isNaN(tahun) || bulan < 1 || bulan > 12 || tahun < 2000 || tahun > 2100) {
    console.warn(`[Laba Rugi] Invalid params rejected: bulan=${bulan} tahun=${tahun}`);
    return res.status(400).json({ success: false, error: 'Parameter bulan (1-12) dan tahun (2000-2100) harus berupa angka valid' });
  }

  const client = await pool.connect();
  try {
    // Compute start_date and end_date using MySQL date functions
    const dateRes = await client.query(`
      SELECT
        STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d') AS start_date,
        LAST_DAY(STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d')) AS end_date
    `, [tahun, bulan, tahun, bulan]);
    const { start_date, end_date } = dateRes.rows[0];

    console.log(`[Laba Rugi] Date range resolved: ${start_date} → ${end_date}`);

    // 1. PENDAPATAN (Penjualan kotor & diskon)
    // Use BETWEEN with computed dates; exclude both 'Batal' AND legacy 'Dibatalkan' statuses
    const resPendapatan = await client.query(`
      SELECT
        COALESCE(SUM(total), 0) AS kotor,
        COALESCE(SUM(COALESCE(discount, 0)), 0) AS diskon
      FROM sales_invoices
      WHERE DATE(date) BETWEEN ? AND ?
        AND status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
    `, [start_date, end_date]);

    const penjualanKotor = parseFloat(resPendapatan.rows[0]?.kotor || 0);
    const diskon = parseFloat(resPendapatan.rows[0]?.diskon || 0);
    const penjualanBersih = penjualanKotor - diskon;

    console.log(`[Laba Rugi] Pendapatan: kotor=${penjualanKotor} diskon=${diskon} bersih=${penjualanBersih}`);

    // 2. HPP (Cost of Goods Sold) — uses snapshot HPP per item at time of sale.
    //    Falls back to current cost_price for older records without snapshot.
    const resHPP = await client.query(`
      SELECT COALESCE(SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price_snapshot, 0), p.cost_price)), 0) AS hpp
      FROM invoice_items ii
      JOIN sales_invoices si ON si.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
    `, [start_date, end_date]);
    const hpp = parseFloat(resHPP.rows[0]?.hpp || 0);
    const labaKotor = penjualanBersih - hpp;

    console.log(`[Laba Rugi] HPP=${hpp} LabaKotor=${labaKotor}`);

    // 3. BEBAN OPERASIONAL (all OUT transactions not linked to system categories like Pembelian Stok/Penyesuaian Stok)
    // Uses is_system=false from cash_categories to be database-driven — no hardcoded category names
    const resBeban = await client.query(`
      SELECT ct.category, COALESCE(SUM(ct.amount), 0) AS total
      FROM cash_transactions ct
      WHERE ct.type = 'OUT'
        AND (ct.status IS NULL OR ct.status != 'cancelled')
        AND ct.invoice_id IS NULL
        AND ct.purchase_order_id IS NULL
        AND ct.date BETWEEN ? AND ?
        AND ct.category NOT IN (
          SELECT name FROM cash_categories WHERE is_system = 1 AND (type = 'OUT' OR type = 'BOTH')
        )
      GROUP BY ct.category
    `, [start_date, end_date]);

    // 3b. BEBAN FEE CUSTOMER — sourced from invoice_items.customer_fee (not cash_transactions)
    const resFee = await client.query(`
      SELECT COALESCE(SUM(ii.customer_fee), 0) AS total_fee
      FROM invoice_items ii
      JOIN sales_invoices si ON si.id = ii.invoice_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
    `, [start_date, end_date]);
    const bebanFeeCustomer = parseFloat(resFee.rows[0]?.total_fee || 0);

    const rincianBeban = resBeban.rows.map(r => ({
      category: r.category,
      total: parseFloat(r.total)
    }));
    const totalBebanOperasional = rincianBeban.reduce((sum, item) => sum + item.total, 0) + bebanFeeCustomer;
    const labaOperasional = labaKotor - totalBebanOperasional;

    console.log(`[Laba Rugi] BebanOperasional=${totalBebanOperasional} (incl. FeeCustomer=${bebanFeeCustomer}) LabaOperasional=${labaOperasional}`);

    // 4. PENYESUAIAN STOK (stock-opname adjustments — still tracked by category name)
    const resStok = await client.query(`
      SELECT type, COALESCE(SUM(amount), 0) AS total
      FROM cash_transactions
      WHERE category = 'Penyesuaian Stok'
        AND (status IS NULL OR status != 'cancelled')
        AND date BETWEEN $1 AND $2
      GROUP BY type
    `, [start_date, end_date]);

    let penyesuaianStokMasuk = 0;
    let penyesuaianStokKeluar = 0;
    resStok.rows.forEach(r => {
      if (r.type === 'IN') penyesuaianStokMasuk = parseFloat(r.total);
      if (r.type === 'OUT') penyesuaianStokKeluar = parseFloat(r.total);
    });
    const netPenyesuaianStok = penyesuaianStokMasuk - penyesuaianStokKeluar;

    // 5. PENDAPATAN LAIN-LAIN (all IN transactions not linked to system IN categories)
    // Database-driven: system IN categories (Penjualan, Pelunasan Piutang, Penyesuaian Stok) are excluded
    const resLain = await client.query(`
      SELECT COALESCE(SUM(ct.amount), 0) AS total
      FROM cash_transactions ct
      WHERE ct.type = 'IN'
        AND (ct.status IS NULL OR ct.status != 'cancelled')
        AND ct.date BETWEEN ? AND ?
        AND ct.category NOT IN (
          SELECT name FROM cash_categories WHERE is_system = 1 AND (type = 'IN' OR type = 'BOTH')
        )
    `, [start_date, end_date]);
    const pendapatanLain = parseFloat(resLain.rows[0]?.total || 0);

    // LABA BERSIH
    const labaBersih = labaOperasional + netPenyesuaianStok + pendapatanLain;

    console.log(`[Laba Rugi] PendapatanLain=${pendapatanLain} LabaBersih=${labaBersih}`);

    res.json({
      success: true,
      data: {
        periode: { bulan, tahun, start_date, end_date },
        pendapatan: {
          kotor: penjualanKotor,
          diskon: diskon,
          bersih: penjualanBersih
        },
        hpp: hpp,
        labaKotor: labaKotor,
        operasional: {
          rincian: rincianBeban,
          total: totalBebanOperasional,
          bebanFeeCustomer: bebanFeeCustomer
        },
        labaOperasional: labaOperasional,
        penyesuaian_stok: {
          masuk: penyesuaianStokMasuk,
          keluar: penyesuaianStokKeluar,
          net: netPenyesuaianStok
        },
        pendapatanLain: pendapatanLain,
        labaBersih: labaBersih
      }
    });

  } catch (err) {
    console.error(`[Laba Rugi] Query error:`, err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});
// --- Laporan Neraca ---
app.get('/api/laporan/neraca', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const bulan = parseInt(req.query.bulan, 10);
  const tahun = parseInt(req.query.tahun, 10);

  console.log(`[Neraca] Request params: bulan="${req.query.bulan}" tahun="${req.query.tahun}" → parsed: bulan=${bulan} tahun=${tahun}`);

  if (isNaN(bulan) || isNaN(tahun) || bulan < 1 || bulan > 12 || tahun < 2000 || tahun > 2100) {
    console.warn(`[Neraca] Invalid params rejected: bulan=${bulan} tahun=${tahun}`);
    return res.status(400).json({ success: false, error: 'Parameter bulan (1-12) dan tahun (2000-2100) harus berupa angka valid' });
  }

  const client = await pool.connect();
  try {
    // end_date = last day of selected month
    const endDateResult = await client.query(
      `SELECT LAST_DAY(STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d')) AS end_date`,
      [tahun, bulan]
    );
    const endDate = endDateResult.rows[0].end_date;

    // 1. Kas & Bank: sum IN - sum OUT from cash_transactions where status='active'
    const resKas = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0) AS masuk,
        COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0) AS keluar
      FROM cash_transactions
      WHERE DATE(date) <= ?
        AND status = 'active'
    `, [endDate]);
    const kasBank = parseFloat(resKas.rows[0].masuk) - parseFloat(resKas.rows[0].keluar);

    // 2. Piutang Usaha: sum of (total - paid_amount) for unpaid invoices up to end_date
    const resPiutang = await client.query(`
      SELECT COALESCE(SUM(total - paid_amount), 0) AS piutang
      FROM sales_invoices
      WHERE status NOT IN ('Lunas', 'Dibatalkan', 'Batal', 'Cancel')
        AND DATE(date) <= ?
    `, [endDate]);
    const piutangUsaha = parseFloat(resPiutang.rows[0].piutang);

    // 3. Persediaan Barang: current stock value (stock * cost_price)
    const resPersediaan = await client.query(`
      SELECT COALESCE(SUM(stock * cost_price), 0) AS persediaan
      FROM products
    `);
    const persediaan = parseFloat(resPersediaan.rows[0].persediaan);

    const totalAset = kasBank + piutangUsaha + persediaan;

    // 4. Hutang Usaha: sum of (total - paid_amount) for unpaid POs up to end_date
    const resHutang = await client.query(`
      SELECT COALESCE(SUM(total - paid_amount), 0) AS hutang
      FROM purchase_orders
      WHERE status NOT IN ('Selesai', 'Dibatalkan', 'Batal')
        AND DATE(date) <= ?
    `, [endDate]);
    const hutangUsaha = parseFloat(resHutang.rows[0].hutang);

    // 5. Hutang Lain-lain: default 0
    const hutangLain = 0;
    const totalLiabilitas = hutangUsaha + hutangLain;

    // 6. Modal Pemilik: from settings
    const resModal = await client.query(`SELECT value FROM settings WHERE \`key\` = 'modal_pemilik'`);
    const modalPemilik = parseFloat(resModal.rows[0]?.value || 0);

    // 7. Laba Ditahan = Total Aset - Total Liabilitas - Modal Pemilik
    const labaDitahan = totalAset - totalLiabilitas - modalPemilik;
    const totalEkuitas = modalPemilik + labaDitahan;

    const isBalanced = Math.abs(totalAset - (totalLiabilitas + totalEkuitas)) < 1;

    // Format per_tanggal in Indonesian
    const monthNamesId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const endDateObj = new Date(endDate);
    const day = endDateObj.getUTCDate();
    const monthStr = monthNamesId[bulan - 1];
    const perTanggal = `Per ${day} ${monthStr} ${tahun}`;

    res.json({
      success: true,
      data: {
        per_tanggal: perTanggal,
        aset: {
          kas_bank: kasBank,
          piutang_usaha: piutangUsaha,
          persediaan: persediaan,
          total: totalAset
        },
        liabilitas: {
          hutang_usaha: hutangUsaha,
          hutang_lain: hutangLain,
          total: totalLiabilitas
        },
        ekuitas: {
          modal_pemilik: modalPemilik,
          laba_ditahan: labaDitahan,
          total: totalEkuitas
        },
        total_liabilitas_ekuitas: totalLiabilitas + totalEkuitas,
        is_balanced: isBalanced
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// --- Laporan Analisis Performa ---
app.get('/api/laporan/performa', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const bulan = parseInt(req.query.bulan, 10);
  const tahun = parseInt(req.query.tahun, 10);

  console.log(`[Performa] Request params: bulan="${req.query.bulan}" tahun="${req.query.tahun}" → parsed: bulan=${bulan} tahun=${tahun}`);

  if (isNaN(bulan) || isNaN(tahun) || bulan < 1 || bulan > 12 || tahun < 2000 || tahun > 2100) {
    console.warn(`[Performa] Invalid params rejected: bulan=${bulan} tahun=${tahun}`);
    return res.status(400).json({ success: false, error: 'Parameter bulan (1-12) dan tahun (2000-2100) harus berupa angka valid' });
  }

  const client = await pool.connect();
  try {
    // Compute start_date and end_date
    const dateRes = await client.query(`
      SELECT
        STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d') AS start_date,
        LAST_DAY(STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d')) AS end_date,
        DAY(LAST_DAY(STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d'))) AS days_in_month
    `, [tahun, bulan, tahun, bulan, tahun, bulan]);
    const { start_date, end_date, days_in_month } = dateRes.rows[0];

    // 1. Total penjualan & jumlah invoice
    const resSales = await client.query(`
      SELECT
        COALESCE(SUM(total), 0) AS total_penjualan,
        COUNT(id) AS jumlah_invoice
      FROM sales_invoices
      WHERE DATE(date) BETWEEN ? AND ?
        AND status NOT IN ('Dibatalkan', 'Batal', 'Cancel')
    `, [start_date, end_date]);
    const totalPenjualan = parseFloat(resSales.rows[0].total_penjualan);
    const jumlahInvoice = parseInt(resSales.rows[0].jumlah_invoice);

    const rataHari = jumlahInvoice > 0 ? totalPenjualan / parseInt(days_in_month) : 0;
    const rataInvoice = jumlahInvoice > 0 ? totalPenjualan / jumlahInvoice : 0;

    // 2. HPP for margin calculation — uses snapshot HPP per item
    const resHPP = await client.query(`
      SELECT COALESCE(SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price_snapshot, 0), p.cost_price)), 0) AS total_hpp
      FROM invoice_items ii
      LEFT JOIN products p ON p.id = ii.product_id
      JOIN sales_invoices si ON si.id = ii.invoice_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
    `, [start_date, end_date]);
    const totalHPP = parseFloat(resHPP.rows[0].total_hpp);
    const margin = totalPenjualan > 0
      ? ((totalPenjualan - totalHPP) / totalPenjualan) * 100
      : 0;

    // 3. Customer retention
    const resRetention = await client.query(`
      SELECT
        COUNT(DISTINCT customer_id) AS total_customers,
        COUNT(DISTINCT CASE WHEN cnt > 1 THEN customer_id END) AS repeat_customers
      FROM (
        SELECT customer_id, COUNT(id) AS cnt
        FROM sales_invoices
        WHERE DATE(date) BETWEEN ? AND ?
          AND status NOT IN ('Dibatalkan', 'Batal', 'Cancel')
        GROUP BY customer_id
      ) sub
    `, [start_date, end_date]);
    const totalCustomers = parseInt(resRetention.rows[0].total_customers);
    const repeatCustomers = parseInt(resRetention.rows[0].repeat_customers);
    const retention = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

    // 4. Top 5 produk terlaris
    const resProducts = await client.query(`
      SELECT p.name, COALESCE(SUM(ii.quantity * ii.price), 0) AS total_nilai
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      JOIN sales_invoices si ON si.id = ii.invoice_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Dibatalkan', 'Batal', 'Cancel')
      GROUP BY p.name
      ORDER BY total_nilai DESC
      LIMIT 5
    `, [start_date, end_date]);

    let topProducts = resProducts.rows.map(r => ({
      name: r.name,
      total_nilai: parseFloat(r.total_nilai)
    }));
    if (topProducts.length === 0) {
      const resFallback = await client.query(`SELECT name FROM products LIMIT 5`);
      topProducts = resFallback.rows.map(r => ({ name: r.name, total_nilai: 0 }));
    }

    // 5. Top 5 pelanggan teratas
    const resCustomers = await client.query(`
      SELECT c.name, COALESCE(SUM(si.total), 0) AS total_belanja
      FROM sales_invoices si
      JOIN customers c ON c.id = si.customer_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Dibatalkan', 'Batal', 'Cancel')
      GROUP BY c.name
      ORDER BY total_belanja DESC
      LIMIT 5
    `, [start_date, end_date]);
    const topCustomers = resCustomers.rows.map(r => ({
      name: r.name,
      total_belanja: parseFloat(r.total_belanja)
    }));

    res.json({
      success: true,
      data: {
        rata_hari: rataHari,
        rata_invoice: rataInvoice,
        jumlah_invoice: jumlahInvoice,
        margin: margin,
        retention: retention,
        top_products: topProducts,
        top_customers: topCustomers,
        has_data: jumlahInvoice > 0
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/finance/payables', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, vendor_id, status, paginate, all } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';
    const todayStr = formatDateStr(new Date());

    const whereConditions = ["po.status != 'Batal'"];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(po.id LIKE ? OR v.name LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern);
    }

    if (vendor_id && vendor_id !== 'all') {
      whereConditions.push('po.vendor_id = ?');
      params.push(vendor_id);
    }

    if (status && status !== 'all') {
      const qStatus = status.toLowerCase();
      if (qStatus === 'lunas') {
        whereConditions.push('(po.total - po.paid_amount - COALESCE(po.return_amount, 0)) <= 0');
      } else if (qStatus === 'overdue') {
        whereConditions.push('(po.total - po.paid_amount - COALESCE(po.return_amount, 0)) > 0 AND po.due_date IS NOT NULL AND po.due_date < CURDATE()');
      } else if (qStatus.includes('belum')) {
        whereConditions.push('po.paid_amount = 0 AND (po.total - COALESCE(po.return_amount, 0)) > 0');
      } else if (qStatus === 'sebagian') {
        whereConditions.push('po.paid_amount > 0 AND (po.total - po.paid_amount - COALESCE(po.return_amount, 0)) > 0');
      }
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const mapPayableRow = (r) => {
      const total = parseFloat(r.total || 0);
      const paid = parseFloat(r.paid_amount || 0);
      const returnAmount = parseFloat(r.return_amount || 0);
      const sisa = Math.max(0, total - returnAmount - paid);
      const dueDateStr = formatDateStr(r.due_date);
      const isOverdue = sisa > 0 && Boolean(dueDateStr) && dueDateStr < todayStr;
      return {
        id: r.id,
        date: formatDateStr(r.date),
        dueDate: dueDateStr || formatDateStr(r.date) || '-',
        paidDate: formatDateStr(r.paid_date) || null,
        vendorId: r.vendor_id,
        vendor: r.vendor_name || 'Tanpa Vendor',
        total: total,
        paid: paid,
        returnAmount: returnAmount,
        sisa: sisa,
        type: r.payment_type_name || 'Tempo',
        status: sisa > 0 ? (paid > 0 ? 'Sebagian' : 'Belum Lunas') : 'Lunas',
        isOverdue: isOverdue,
        isOutstandingImport: Boolean(r.is_outstanding_import)
      };
    };

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      // Summary query over all vendors & debts
      const summarySql = `
        SELECT 
          COALESCE(SUM(GREATEST(po.total - po.paid_amount - COALESCE(po.return_amount, 0), 0)), 0) AS total_debt,
          COUNT(DISTINCT CASE WHEN (po.total - po.paid_amount - COALESCE(po.return_amount, 0)) > 0 THEN po.vendor_id END) AS vendors_with_debt,
          COUNT(CASE WHEN (po.total - po.paid_amount - COALESCE(po.return_amount, 0)) > 0 AND po.due_date IS NOT NULL AND po.due_date < CURDATE() THEN 1 END) AS overdue_count,
          (SELECT COUNT(*) FROM vendors) AS total_vendors
        FROM purchase_orders po
        WHERE po.status != 'Batal'
      `;
      const summaryRes = await pool.query(summarySql);
      const sumRow = summaryRes.rows[0] || {};
      const totalVendors = parseInt(sumRow.total_vendors || 0);
      const vendorsWithDebt = parseInt(sumRow.vendors_with_debt || 0);
      const vendorsLunas = Math.max(0, totalVendors - vendorsWithDebt);
      const overdueCount = parseInt(sumRow.overdue_count || 0);

      const countSql = `
        SELECT COUNT(*) AS total 
        FROM purchase_orders po 
        LEFT JOIN vendors v ON po.vendor_id = v.id 
        ${whereClause}
      `;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);

      const dataSql = `
        SELECT po.*, v.name as vendor_name, pt.name as payment_type_name
        FROM purchase_orders po
        LEFT JOIN vendors v ON po.vendor_id = v.id
        LEFT JOIN payment_types pt ON po.payment_type_id = pt.id
        ${whereClause}
        ORDER BY po.due_date ASC, po.date DESC, po.id DESC
        LIMIT ? OFFSET ?
      `;
      const result = await pool.query(dataSql, [...params, limitNum, offset]);

      return res.json({
        data: result.rows.map(mapPayableRow),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        },
        summary: {
          totalDebt: parseFloat(sumRow.total_debt || 0),
          vendorsWithDebt,
          vendorsLunas,
          overdueCount,
          total_debt: parseFloat(sumRow.total_debt || 0),
          vendors_with_debt: vendorsWithDebt,
          vendors_lunas: vendorsLunas,
          overdue_count: overdueCount
        }
      });
    }

    const result = await pool.query(`
      SELECT po.*, v.name as vendor_name, pt.name as payment_type_name 
      FROM purchase_orders po 
      LEFT JOIN vendors v ON po.vendor_id = v.id 
      LEFT JOIN payment_types pt ON po.payment_type_id = pt.id 
      ${whereClause}
      ORDER BY po.due_date ASC, po.date DESC, po.id DESC
    `, params);
    res.json(result.rows.map(mapPayableRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pay vendor PO debt (Cicilan Bertahap)
app.post('/api/purchase-orders/:id/payments', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  try {
    const result = await recordPurchaseOrderPayment({
      poId: req.params.id,
      amount: req.body.amount,
      paymentDate: req.body.date || req.body.payment_date,
      paymentMethod: req.body.method || req.body.payment_method || req.body.payment_type_id || 'Transfer Bank',
      notes: req.body.notes,
      isDownPayment: 0,
      userId: req.user.id
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

// Backward-compatible alias for existing callers
app.post('/api/finance/payables/:id/pay', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  try {
    const result = await recordPurchaseOrderPayment({
      poId: req.params.id,
      amount: req.body.amount,
      paymentDate: req.body.date || req.body.payment_date,
      paymentMethod: req.body.payment_type_id || req.body.method || 'Transfer Bank',
      notes: req.body.notes,
      isDownPayment: 0,
      userId: req.user.id
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

// Get PO payments history
app.get('/api/purchase-orders/:id/payments', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  try {
    const poRes = await pool.query(`
      SELECT po.*, v.name as vendor_name, pt.name as payment_type_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN payment_types pt ON po.payment_type_id = pt.id
      WHERE po.id = ?
    `, [id]);

    if (poRes.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase Order tidak ditemukan' });
    }
    const po = poRes.rows[0];

    const payRes = await pool.query(`
      SELECT pop.*, u.name as created_by_name, vu.name as void_by_name
      FROM purchase_order_payments pop
      LEFT JOIN users u ON pop.created_by = u.id
      LEFT JOIN users vu ON pop.void_by = vu.id
      WHERE pop.purchase_order_id = ?
      ORDER BY pop.id ASC
    `, [id]);

    const todayStr = formatDateStr(new Date());
    const total = parseFloat(po.total || 0);
    const returnAmount = parseFloat(po.return_amount || 0);
    const activePayments = payRes.rows.filter(p => p.status === 'active');
    const totalPaidFromPayments = activePayments.reduce((s, p) => s + parseFloat(p.amount), 0);
    const totalPaid = payRes.rows.length > 0 ? totalPaidFromPayments : parseFloat(po.paid_amount || 0);
    const sisa = Math.max(0, total - returnAmount - totalPaid);
    const dueDateStr = formatDateStr(po.due_date);
    const isOverdue = sisa > 0 && Boolean(dueDateStr) && dueDateStr < todayStr;

    res.json({
      purchase: {
        id: po.id,
        date: formatDateStr(po.date),
        dueDate: dueDateStr,
        vendor: po.vendor_name || 'Tanpa Vendor',
        type: po.payment_type_name || 'Tempo',
        total: total,
        returnAmount: returnAmount,
        paid: totalPaid,
        sisa: sisa,
        status: po.status,
        isOverdue: isOverdue,
        paidDate: formatDateStr(po.paid_date) || null,
        isOutstandingImport: Boolean(po.is_outstanding_import)
      },
      payments: payRes.rows.map(p => ({
        id: p.id,
        paymentNo: p.payment_no,
        date: formatDateStr(p.payment_date),
        amount: parseFloat(p.amount),
        method: p.payment_method,
        notes: p.notes || '',
        isDownPayment: Boolean(p.is_down_payment),
        status: p.status,
        voidReason: p.void_reason || null,
        voidBy: p.void_by_name || null,
        voidAt: p.void_at ? (typeof p.void_at === 'string' ? p.void_at : p.void_at.toISOString()) : null,
        createdBy: p.created_by_name || 'Staff'
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Void Purchase Order Payment Endpoint
const handleVoidPurchasePayment = async (req, res) => {
  const paymentId = req.params.paymentId;
  const reason = (req.body.reason || req.body.void_reason || '').trim();

  if (!reason) {
    return res.status(400).json({ error: 'Alasan pembatalan (void) wajib diisi' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find and lock the payment record
    const isNum = !isNaN(parseInt(paymentId, 10)) && /^\d+$/.test(paymentId);
    let payQuery = 'SELECT * FROM purchase_order_payments WHERE ';
    const payParams = isNum ? [parseInt(paymentId, 10)] : [paymentId];
    payQuery += isNum ? 'id = ? FOR UPDATE' : 'payment_no = ? FOR UPDATE';

    const payRes = await client.query(payQuery, payParams);
    if (payRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Data pembayaran hutang tidak ditemukan' });
    }
    const payment = payRes.rows[0];

    if (payment.status === 'void') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Pembayaran ini sudah dibatalkan (void) sebelumnya' });
    }

    const poId = payment.purchase_order_id;

    // 2. Lock the associated purchase order
    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (poRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PO terkait tidak ditemukan' });
    }
    const po = poRes.rows[0];

    // 3. Mark payment as void
    await client.query(
      `UPDATE purchase_order_payments 
       SET status = 'void', void_reason = ?, void_by = ?, void_at = NOW() 
       WHERE id = ?`,
      [reason, req.user.id, payment.id]
    );

    // 4. Reversal cash transaction (mark status as 'cancelled')
    if (payment.cash_transaction_id) {
      await client.query(
        `UPDATE cash_transactions 
         SET status = 'cancelled' 
         WHERE id = ?`,
        [payment.cash_transaction_id]
      );
    }

    // 5. Recalculate PO totals from all remaining active payments
    const activePayRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total_active, MAX(payment_date) as last_date, COUNT(*) as count 
       FROM purchase_order_payments 
       WHERE purchase_order_id = ? AND status = 'active'`,
      [poId]
    );
    const totalActivePaid = parseFloat(activePayRes.rows[0].total_active || 0);
    const poTotal = parseFloat(po.total || 0);
    const returnAmount = parseFloat(po.return_amount || 0);
    const newSisa = Math.max(0, poTotal - returnAmount - totalActivePaid);
    const newStatus = newSisa <= 0 ? 'Selesai' : 'Dalam Proses';
    const newPaidDate = newStatus === 'Selesai' ? activePayRes.rows[0].last_date : null;

    await client.query(
      `UPDATE purchase_orders 
       SET paid_amount = ?, status = ?, paid_date = ? 
       WHERE id = ?`,
      [totalActivePaid, newStatus, newPaidDate, poId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Pembayaran hutang berhasil dibatalkan (void)',
      payment: {
        id: payment.id,
        payment_no: payment.payment_no,
        purchase_order_id: poId,
        amount: parseFloat(payment.amount),
        status: 'void',
        void_reason: reason,
        void_by: req.user.id
      },
      purchase: {
        id: poId,
        total: poTotal,
        return_amount: returnAmount,
        paid_amount: totalActivePaid,
        sisa: newSisa,
        status: newStatus,
        paid_date: newPaidDate ? formatDateStr(newPaidDate) : null
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Void Purchase Payment Error]:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

app.post('/api/purchase-orders/payments/:paymentId/void', authenticateToken, authorizeRoles('admin', 'gudang'), handleVoidPurchasePayment);
app.post('/api/purchase-orders/:id/payments/:paymentId/void', authenticateToken, authorizeRoles('admin', 'gudang'), handleVoidPurchasePayment);

/**
 * DELETE /api/finance/payables/:id
 * Hapus PO hutang khusus yang berasal dari fitur Import Outstanding.
 * Hak akses: Administrator dan Gudang
 */
app.delete('/api/finance/payables/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const poId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock baris PO
    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (poRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase Order tidak ditemukan' });
    }
    const po = poRes.rows[0];

    // 2. Validasi ketat: Hanya hutang import/manual outstanding yang boleh dihapus
    const itemsCheck = await client.query('SELECT COUNT(*) as count FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
    const itemCount = parseInt(itemsCheck.rows[0]?.count || 0);

    if (!po.is_outstanding_import || itemCount > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Akses ditolak: Hanya hutang yang berasal dari Input/Import Outstanding yang dapat dihapus. Hutang dari transaksi Purchase Order tidak dapat dihapus.'
      });
    }

    // 3. Batalkan arus kas dan hapus data cicilan terkait secara transaksional
    await client.query(
      `UPDATE cash_transactions SET status = 'cancelled' WHERE purchase_order_id = ? AND (status IS NULL OR status = 'active')`,
      [poId]
    );

    await client.query('DELETE FROM purchase_order_payments WHERE purchase_order_id = ?', [poId]);

    // 4. Hapus purchase_orders
    await client.query('DELETE FROM purchase_orders WHERE id = ?', [poId]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Hutang outstanding berhasil dihapus' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Delete Outstanding Payable Error]:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Alias for outstanding purchase order deletion
app.delete('/api/purchase-orders/outstanding/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  req.url = `/api/finance/payables/${req.params.id}`;
  app.handle(req, res);
});

/**
 * POST /api/purchase-orders/import-outstanding
 * Import batch hutang PO outstanding (migrasi saldo hutang sistem lama).
 * Hak akses: Administrator dan Gudang
 */
app.post('/api/purchase-orders/import-outstanding', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const purchases = req.body.purchase_orders || req.body.purchases || req.body.invoices || req.body.items;
  if (!Array.isArray(purchases) || purchases.length === 0) {
    return res.status(400).json({ error: 'Data hutang untuk diimpor tidak boleh kosong' });
  }

  const userId = req.user.id;
  const todayStr = formatDateStr(new Date());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ambil seluruh payment types
    const ptRes = await client.query('SELECT id, name FROM payment_types');
    const paymentTypes = ptRes.rows;
    const ptMap = {};
    paymentTypes.forEach(p => {
      ptMap[p.name.toLowerCase().trim()] = p.id;
      ptMap[p.id.toLowerCase().trim()] = p.id;
    });

    // Default payment type: Tempo / Kredit 30 Hari
    const defaultCreditType = paymentTypes.find(p => p.name.toLowerCase().includes('tempo'))?.id
      || paymentTypes.find(p => p.name.toLowerCase().includes('kredit 30'))?.id
      || paymentTypes.find(p => p.name.toLowerCase().startsWith('kredit'))?.id
      || 'PT-7';

    // 2. Ambil seluruh vendor untuk validasi
    const vendRes = await client.query('SELECT id, name FROM vendors');
    const vendMapByName = {};
    const vendMapById = {};
    vendRes.rows.forEach(v => {
      vendMapByName[v.name.toLowerCase().trim()] = v.id;
      vendMapById[v.id.toLowerCase().trim()] = v.id;
    });

    const seenIds = new Set();
    const createdPurchases = [];

    for (let i = 0; i < purchases.length; i++) {
      const p = purchases[i];
      const rowNum = p.row_number || (i + 1);

      // A. Validasi Vendor
      const rawVend = String(p.vendor_id || p.vendor_name || p.vendor || '').trim();
      if (!rawVend) {
        throw new Error(`Baris ${rowNum}: Nama vendor wajib diisi`);
      }
      const vendorId = vendMapById[rawVend.toLowerCase()] || vendMapByName[rawVend.toLowerCase()];
      if (!vendorId) {
        throw new Error(`Baris ${rowNum}: Vendor "${rawVend}" tidak ditemukan di database`);
      }

      // B. Tanggal PO
      let poDate = p.date ? formatDateStr(p.date) : todayStr;
      if (!poDate || isNaN(new Date(poDate).getTime())) {
        poDate = todayStr;
      }

      // C. Validasi Total & Total Dibayar
      const total = parseFloat(p.total);
      if (isNaN(total) || total <= 0) {
        throw new Error(`Baris ${rowNum}: Total tagihan harus berupa angka lebih besar dari 0`);
      }

      const totalDibayar = parseFloat(p.total_dibayar ?? p.paid ?? 0);
      if (isNaN(totalDibayar) || totalDibayar < 0) {
        throw new Error(`Baris ${rowNum}: Total dibayar tidak boleh bernilai negatif`);
      }

      if (totalDibayar >= total) {
        if (totalDibayar === total) {
          throw new Error(`Baris ${rowNum}: Total dibayar sama dengan total hutang (Rp ${Math.round(total).toLocaleString('id-ID')}). Hutang ini bukan outstanding karena sudah lunas.`);
        } else {
          throw new Error(`Baris ${rowNum}: Total dibayar (Rp ${Math.round(totalDibayar).toLocaleString('id-ID')}) melebihi total hutang (Rp ${Math.round(total).toLocaleString('id-ID')}). Pembayaran tidak boleh melebihi nilai tagihan.`);
        }
      }

      // D. Tipe Pembayaran
      let pTypeId = defaultCreditType;
      const rawPt = String(p.payment_type || p.payment_type_id || '').toLowerCase().trim();
      if (rawPt && ptMap[rawPt]) {
        pTypeId = ptMap[rawPt];
      }

      // E. Tanggal Jatuh Tempo
      let dueDate = p.due_date ? formatDateStr(p.due_date) : null;
      if (!dueDate) {
        let tenorDays = 30;
        if (pTypeId === 'PT-3') tenorDays = 1;
        else if (pTypeId === 'PT-5') tenorDays = 7;
        else if (pTypeId === 'PT-6') tenorDays = 14;
        const dObj = new Date(poDate);
        dObj.setDate(dObj.getDate() + tenorDays);
        dueDate = formatDateStr(dObj);
      }

      // F. Nomor PO (manual jika diisi, atomic counter jika kosong)
      let poId = p.id ? String(p.id).trim() : '';
      if (poId) {
        if (seenIds.has(poId.toLowerCase())) {
          throw new Error(`Baris ${rowNum}: Nomor PO "${poId}" duplikat di dalam file import ini`);
        }
        const existingPo = await client.query('SELECT id FROM purchase_orders WHERE id = ?', [poId]);
        if (existingPo.rows.length > 0) {
          throw new Error(`Baris ${rowNum}: Nomor PO "${poId}" sudah ada di database`);
        }
        seenIds.add(poId.toLowerCase());
      } else {
        const prefix = await getSetting('prefix_purchase', 'PO-{YYYY}-{MM}-');
        poId = await generateNextId(client, 'purchase_orders', prefix);
        seenIds.add(poId.toLowerCase());
      }

      // G. Hitung sisa hutang & status
      const sisa = Math.max(0, total - totalDibayar);
      const status = totalDibayar > 0 ? 'Dalam Proses' : 'Dalam Proses';

      // H. Simpan purchase_orders
      await client.query(
        `INSERT INTO purchase_orders 
         (id, date, vendor_id, subtotal, discount, tax, total, paid_amount, return_amount, payment_type_id, due_date, paid_date, status, user_id, is_outstanding_import) 
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0, ?, ?, NULL, ?, ?, 1)`,
        [poId, poDate, vendorId, total, total, totalDibayar, pTypeId, dueDate, status, userId]
      );

      // I. Jika total_dibayar > 0, buat 1 record di purchase_order_payments sebagai saldo awal
      if (totalDibayar > 0) {
        let lastPaymentDate = p.last_payment_date || p.tanggal_pembayaran_terakhir;
        lastPaymentDate = lastPaymentDate ? formatDateStr(lastPaymentDate) : poDate;
        if (!lastPaymentDate || isNaN(new Date(lastPaymentDate).getTime())) {
          lastPaymentDate = poDate;
        }
        if (lastPaymentDate > todayStr) {
          throw new Error(`Baris ${rowNum}: Tanggal pembayaran terakhir tidak boleh di masa depan`);
        }

        const paymentNo = await generatePurchasePaymentNo(client, lastPaymentDate);
        await client.query(
          `INSERT INTO purchase_order_payments
           (payment_no, purchase_order_id, payment_date, amount, payment_method, notes, is_down_payment, status, cash_transaction_id, created_by)
           VALUES (?, ?, ?, ?, 'Saldo Awal', 'Saldo awal hasil import', 0, 'active', NULL, ?)`,
          [paymentNo, poId, lastPaymentDate, totalDibayar, userId]
        );
      }

      createdPurchases.push({
        id: poId,
        vendor_id: vendorId,
        total,
        total_dibayar: totalDibayar,
        sisa,
        status,
        due_date: dueDate
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `${createdPurchases.length} hutang outstanding berhasil diimpor`,
      count: createdPurchases.length,
      purchases: createdPurchases
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Import Outstanding PO API] Error rollback:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/finance/payables/export-pdf
 * Export PDF laporan hutang untuk baris PO terpilih.
 * Hak akses: Administrator dan Gudang
 */
app.post('/api/finance/payables/export-pdf', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Daftar PO hutang untuk di-export tidak boleh kosong' });
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      SELECT po.id, po.date, po.due_date, po.total, po.paid_amount, po.return_amount, po.status,
             v.name AS vendor_name, v.phone AS vendor_phone
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      WHERE po.id IN (${placeholders}) AND po.status != 'Batal'
      ORDER BY v.name ASC, po.date ASC, po.id ASC
    `;
    const poRes = await pool.query(sql, ids);
    if (poRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tidak ada data hutang valid yang ditemukan untuk dicetak' });
    }

    const companyRes = await pool.query("SELECT value FROM settings WHERE `key` = 'company_name'");
    const companyName = companyRes.rows[0]?.value || 'SupplierPro';

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
      bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="laporan_hutang.pdf"');
    doc.pipe(res);

    const formatRp = (num) => 'Rp ' + Math.round(parseFloat(num) || 0).toLocaleString('id-ID');
    const formatDate = (dateStr) => {
      if (!dateStr) return '-';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr).split('T')[0];
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const printDate = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 36;
    const contentWidth = pageWidth - (margin * 2);

    const cols = [
      { id: 'vendor', label: 'Nama Vendor', width: 170, align: 'left' },
      { id: 'po_id', label: 'No. PO', width: 115, align: 'left' },
      { id: 'date', label: 'Tgl PO', width: 80, align: 'center' },
      { id: 'due_date', label: 'Jatuh Tempo', width: 80, align: 'center' },
      { id: 'total', label: 'Total Hutang', width: 110, align: 'right' },
      { id: 'paid', label: 'Sudah Dibayar', width: 105, align: 'right' },
      { id: 'sisa', label: 'Sisa Hutang', width: 105, align: 'right' }
    ];

    let currentY = 36;

    function renderHeader() {
      doc.save();
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#1e293b')
        .text('LAPORAN HUTANG USAHA', margin, currentY, { align: 'left' });

      doc.font('Helvetica').fontSize(10).fillColor('#64748b')
        .text(`Unit Usaha: ${companyName}`, margin, currentY + 20, { align: 'left' });

      doc.fontSize(9).fillColor('#64748b')
        .text(`Tanggal Cetak: ${printDate}`, margin, currentY + 20, { align: 'right', width: contentWidth });

      currentY += 40;

      doc.rect(margin, currentY, contentWidth, 24).fill('#f1f5f9');
      doc.rect(margin, currentY, contentWidth, 24).stroke('#cbd5e1');

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155');
      let curX = margin;
      cols.forEach(col => {
        doc.text(col.label, curX + 4, currentY + 7, { width: col.width - 8, align: col.align });
        curX += col.width;
      });

      currentY += 24;
      doc.restore();
    }

    renderHeader();

    const grouped = {};
    poRes.rows.forEach(r => {
      const vend = r.vendor_name || 'Tanpa Vendor';
      if (!grouped[vend]) grouped[vend] = [];
      grouped[vend].push(r);
    });

    const isMultiVendor = Object.keys(grouped).length > 1;
    let grandTotal = 0;
    let grandPaid = 0;
    let grandSisa = 0;
    const rowHeight = 20;

    for (const vendName of Object.keys(grouped)) {
      const items = grouped[vendName];
      let subTotal = 0;
      let subPaid = 0;
      let subSisa = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const tot = parseFloat(item.total) || 0;
        const pd = parseFloat(item.paid_amount) || 0;
        const ret = parseFloat(item.return_amount) || 0;
        const rem = Math.max(0, tot - ret - pd);

        subTotal += tot;
        subPaid += pd;
        subSisa += rem;

        grandTotal += tot;
        grandPaid += pd;
        grandSisa += rem;

        if (currentY + rowHeight > pageHeight - 50) {
          doc.addPage();
          currentY = 36;
          renderHeader();
        }

        if (i % 2 === 1) {
          doc.rect(margin, currentY, contentWidth, rowHeight).fill('#f8fafc');
        }
        doc.moveTo(margin, currentY + rowHeight).lineTo(margin + contentWidth, currentY + rowHeight).strokeColor('#e2e8f0').stroke();

        doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b');
        let curX = margin;

        doc.text(vendName, curX + 4, currentY + 5, { width: cols[0].width - 8, align: cols[0].align, lineBreak: false });
        curX += cols[0].width;

        doc.text(String(item.id), curX + 4, currentY + 5, { width: cols[1].width - 8, align: cols[1].align });
        curX += cols[1].width;

        doc.text(formatDate(item.date), curX + 4, currentY + 5, { width: cols[2].width - 8, align: cols[2].align });
        curX += cols[2].width;

        doc.text(formatDate(item.due_date), curX + 4, currentY + 5, { width: cols[3].width - 8, align: cols[3].align });
        curX += cols[3].width;

        doc.text(formatRp(tot), curX + 4, currentY + 5, { width: cols[4].width - 8, align: cols[4].align });
        curX += cols[4].width;

        doc.text(formatRp(pd), curX + 4, currentY + 5, { width: cols[5].width - 8, align: cols[5].align });
        curX += cols[5].width;

        doc.font('Helvetica-Bold').fillColor(rem > 0 ? '#b91c1c' : '#059669')
          .text(formatRp(rem), curX + 4, currentY + 5, { width: cols[6].width - 8, align: cols[6].align });

        currentY += rowHeight;
      }

      if (isMultiVendor) {
        if (currentY + rowHeight > pageHeight - 50) {
          doc.addPage();
          currentY = 36;
          renderHeader();
        }

        doc.rect(margin, currentY, contentWidth, rowHeight).fill('#f1f5f9');
        doc.rect(margin, currentY, contentWidth, rowHeight).stroke('#cbd5e1');

        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155');
        const labelWidth = cols[0].width + cols[1].width + cols[2].width + cols[3].width;
        doc.text(`Subtotal ${vendName}:`, margin + 4, currentY + 5, { width: labelWidth - 8, align: 'right' });

        let curX = margin + labelWidth;
        doc.text(formatRp(subTotal), curX + 4, currentY + 5, { width: cols[4].width - 8, align: cols[4].align });
        curX += cols[4].width;
        doc.text(formatRp(subPaid), curX + 4, currentY + 5, { width: cols[5].width - 8, align: cols[5].align });
        curX += cols[5].width;
        doc.fillColor('#b91c1c').text(formatRp(subSisa), curX + 4, currentY + 5, { width: cols[6].width - 8, align: cols[6].align });

        currentY += rowHeight + 4;
      }
    }

    if (currentY + 24 > pageHeight - 50) {
      doc.addPage();
      currentY = 36;
      renderHeader();
    }

    doc.rect(margin, currentY, contentWidth, 24).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
    const grandLabelWidth = cols[0].width + cols[1].width + cols[2].width + cols[3].width;
    doc.text(`GRAND TOTAL (${ids.length} PO Terpilih):`, margin + 4, currentY + 7, { width: grandLabelWidth - 8, align: 'right' });

    let curX = margin + grandLabelWidth;
    doc.text(formatRp(grandTotal), curX + 4, currentY + 7, { width: cols[4].width - 8, align: cols[4].align });
    curX += cols[4].width;
    doc.text(formatRp(grandPaid), curX + 4, currentY + 7, { width: cols[5].width - 8, align: cols[5].align });
    curX += cols[5].width;
    doc.fillColor('#fca5a5').text(formatRp(grandSisa), curX + 4, currentY + 7, { width: cols[6].width - 8, align: cols[6].align });

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
        .text(`Halaman ${i + 1} dari ${totalPages}`, margin, pageHeight - 30, { align: 'center', width: contentWidth });
    }

    doc.end();
  } catch (err) {
    console.error('[Export PDF Payables Error]:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal membuat file PDF laporan hutang: ' + err.message });
    }
  }
});

// --- Vendors Routes Extra CRUD ---
app.post('/api/vendors', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { name, vendor_category_id, category_id, phone, city, address, id_number, nama_bank, nomor_rek, pemilik_rek } = req.body;
  const catId = vendor_category_id || category_id || 'VC-1';
  try {
    const prefix = await getSetting('prefix_vendor', 'V');
    const vId = await generateNextId(pool, 'vendors', prefix);
    await pool.query(
      'INSERT INTO vendors (id, name, vendor_category_id, phone, city, address, id_number, nama_bank, nomor_rek, pemilik_rek) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [vId, name, catId, phone, city, address, id_number, nama_bank, nomor_rek, pemilik_rek]
    );
    res.json({ success: true, id: vId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/vendors/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  const { name, vendor_category_id, category_id, phone, city, address, id_number, nama_bank, nomor_rek, pemilik_rek } = req.body;
  const catId = vendor_category_id || category_id;
  try {
    const result = await pool.query(
      'UPDATE vendors SET name = $1, vendor_category_id = $2, phone = $3, city = $4, address = $5, id_number = $6, nama_bank = $7, nomor_rek = $8, pemilik_rek = $9 WHERE id = $10',
      [name, catId, phone, city, address, id_number, nama_bank, nomor_rek, pemilik_rek, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Vendor tidak ditemukan' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/vendors/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM vendors WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Vendor tidak ditemukan' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Purchase Orders Routes ---
app.get('/api/purchases', authenticateToken, authorizeRoles('admin', 'gudang', 'finance'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, status, vendor_id, date_from, date_to, paginate, all } = req.query;
    const isPaginated = (page !== undefined || paginate === 'true') && all !== 'true' && limitQ !== 'all';

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(po.id LIKE ? OR v.name LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern);
    }

    if (status && status !== 'all') {
      whereConditions.push('LOWER(po.status) = ?');
      params.push(status.toLowerCase());
    }

    if (vendor_id && vendor_id !== 'all') {
      whereConditions.push('po.vendor_id = ?');
      params.push(vendor_id);
    }

    if (date_from) {
      whereConditions.push('po.date >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereConditions.push('po.date <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const mapPurchaseRow = (row) => ({
      id: row.id,
      date: formatDateStr(row.date),
      vendorId: row.vendor_id,
      vendor: row.vendor_name || 'Tanpa Vendor',
      total: parseFloat(row.total),
      paid: parseFloat(row.paid_amount),
      paidDate: formatDateStr(row.paid_date) || null,
      type: row.payment_type || 'Tunai',
      status: row.status,
      paymentTypeId: row.payment_type_id,
      dueDate: formatDateStr(row.due_date)
    });

    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
      const offset = (pageNum - 1) * limitNum;

      const countSql = `
        SELECT COUNT(*) AS total 
        FROM purchase_orders po 
        LEFT JOIN vendors v ON po.vendor_id = v.id 
        ${whereClause}
      `;
      const countRes = await pool.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0);

      const dataSql = `
        SELECT po.*, v.name as vendor_name, pt.name as payment_type 
        FROM purchase_orders po 
        LEFT JOIN vendors v ON po.vendor_id = v.id
        LEFT JOIN payment_types pt ON po.payment_type_id = pt.id
        ${whereClause}
        ORDER BY
          CASE WHEN po.id REGEXP '^PO-[0-9]{4}' THEN 1 ELSE 0 END DESC,
          CASE WHEN po.id REGEXP '^PO-[0-9]{4}' THEN CAST(SUBSTRING(po.id, 4, 4) AS UNSIGNED) ELSE 0 END DESC,
          CASE WHEN po.id REGEXP '^PO-[0-9]{4}-[0-9]{2}' THEN CAST(SUBSTRING(po.id, 9, 2) AS UNSIGNED) ELSE 0 END DESC,
          CASE WHEN po.id REGEXP '^PO-' THEN CAST(SUBSTRING_INDEX(po.id, '-', -1) AS UNSIGNED)
               WHEN po.id REGEXP '^[0-9]+$' THEN CAST(po.id AS UNSIGNED)
               ELSE 0
          END DESC,
          po.id DESC
        LIMIT ? OFFSET ?
      `;
      const result = await pool.query(dataSql, [...params, limitNum, offset]);

      return res.json({
        data: result.rows.map(mapPurchaseRow),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1
        }
      });
    }

    const result = await pool.query(`
      SELECT po.*, v.name as vendor_name, pt.name as payment_type 
      FROM purchase_orders po 
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN payment_types pt ON po.payment_type_id = pt.id
      ${whereClause}
      ORDER BY
        CASE WHEN po.id REGEXP '^PO-[0-9]{4}' THEN 1 ELSE 0 END DESC,
        CASE WHEN po.id REGEXP '^PO-[0-9]{4}' THEN CAST(SUBSTRING(po.id, 4, 4) AS UNSIGNED) ELSE 0 END DESC,
        CASE WHEN po.id REGEXP '^PO-[0-9]{4}-[0-9]{2}' THEN CAST(SUBSTRING(po.id, 9, 2) AS UNSIGNED) ELSE 0 END DESC,
        CASE WHEN po.id REGEXP '^PO-' THEN CAST(SUBSTRING_INDEX(po.id, '-', -1) AS UNSIGNED)
             WHEN po.id REGEXP '^[0-9]+$' THEN CAST(po.id AS UNSIGNED)
             ELSE 0
        END DESC,
        po.id DESC
    `, params);
    res.json(result.rows.map(mapPurchaseRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchases', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { vendor_id, vendorId, date, paid, paid_amount, payment_type_id, due_date, items, discount, diskon } = req.body;
  const vId = vendor_id || vendorId;
  const pType = payment_type_id || 'PT-1';
  const poDate = date || new Date().toISOString().split('T')[0];
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Recalculate subtotal, tax, and finalTotal from items
    const settingsRes = await client.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsMap = {};
    settingsRes.rows.forEach(r => settingsMap[r.key] = r.value);
    
    const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1' || settingsMap['ppn_enabled'] === true;
    const pajakDefault = parseFloat(settingsMap['pajak_default'] || 11);
    
    let subtotal = 0;
    if (items && Array.isArray(items)) {
      items.forEach(item => {
        subtotal += (parseFloat(item.cost || item.cost_price || item.price || 0) * (parseFloat(item.quantity || item.qty || 0)));
      });
    }
    const finalDiskon = parseFloat(discount || diskon || 0);
    // PPN is calculated from DPP (Subtotal - Diskon)
    const taxAmount = ppnEnabled ? Math.round((subtotal - finalDiskon) * (pajakDefault / 100)) : 0;
    const finalTotal = subtotal - finalDiskon + taxAmount;

    // Determine if payment type is instant (Tunai/Transfer) or credit (Kredit X Hari)
    const instant = await isInstantPayment(pType);
    let effectivePaid = 0;
    let status = 'Belum Lunas';
    let effectiveDueDate = due_date;

    if (instant) {
      effectivePaid = finalTotal;
      status = 'Selesai';
      effectiveDueDate = null;
    } else {
      effectivePaid = 0;
      status = 'Belum Lunas';
      if (!effectiveDueDate) {
        let tenorDays = 30;
        const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [pType]);
        const ptName = ptNameRes.rows[0]?.name || '';
        const match = ptName.match(/(\d+)\s*hari/i);
        if (match) {
          tenorDays = parseInt(match[1], 10);
        }
        const dObj = new Date(poDate);
        dObj.setDate(dObj.getDate() + tenorDays);
        effectiveDueDate = formatDateStr(dObj);
      }
    }

    const paidDate = status === 'Selesai' ? poDate : null;

    const prefix = await getSetting('prefix_purchase', 'PO/{YYYY}/{MM}/');
    const poId = await generateNextId(client, 'purchase_orders', prefix);
    await client.query(
      'INSERT INTO purchase_orders (id, date, vendor_id, subtotal, discount, tax, total, paid_amount, payment_type_id, due_date, paid_date, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [poId, poDate, vId, subtotal, finalDiskon, taxAmount, finalTotal, effectivePaid, pType, effectiveDueDate, paidDate, status, userId]
    );

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemId = 'POI-' + Date.now() + Math.floor(Math.random() * 1000);
        const prodId = item.product_id || item.id;
        const qty = parseFloat(item.quantity || item.qty || 0);
        const cost = parseFloat(item.cost || item.cost_price || item.price || 0);

        await client.query('INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, cost) VALUES ($1, $2, $3, $4, $5)', [itemId, poId, prodId, qty, cost]);

        // Calculate weighted average HPP
        const prodRes = await client.query('SELECT stock, cost_price FROM products WHERE id = ? FOR UPDATE', [prodId]);
        if (prodRes.rows.length > 0) {
          const currentStock = parseFloat(prodRes.rows[0].stock || 0);
          const currentCost = parseFloat(prodRes.rows[0].cost_price || 0);
          let newCost = cost;
          if (currentStock > 0 && (currentStock + qty) > 0) {
            newCost = ((currentStock * currentCost) + (qty * cost)) / (currentStock + qty);
          } else {
            newCost = cost;
          }
          const newStock = currentStock + qty;
          await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [newStock, newCost, prodId]);
          await recordStockMove(client, {
            product_id: prodId,
            tanggal: poDate ? poDate + ' 12:00:00' : null,
            tipe: 'pembelian',
            ref_type: 'purchase_order',
            ref_id: poId,
            ref_no: poId,
            qty_masuk: qty,
            qty_keluar: 0,
            qty_sebelum: currentStock,
            qty_sesudah: newStock,
            keterangan: `Pembelian PO ${poId}`,
            created_by: userId
          });
        }
      }
    }

    if (effectivePaid > 0) {
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [pType]);
      const method = ptNameRes.rows[0]?.name || 'Transfer Bank';
      await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, purchase_order_id, payment_type_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ctId, poDate, 'OUT', 'Pembelian Stok', `Bayar ${poId}`, effectivePaid, method, poId, pType, userId]);
    }

    await client.query('COMMIT');
    res.json({ success: true, id: poId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/purchases/:id', authenticateToken, authorizeRoles('admin', 'gudang', 'finance'), async (req, res) => {
  const poId = req.params.id;
  const { vendor_id, vendorId, date, paid, paid_amount, payment_type_id, due_date, items, discount, diskon } = req.body;
  const vId = vendor_id || vendorId;
  const pType = payment_type_id || 'PT-1';
  const poDate = date || new Date().toISOString().split('T')[0];

  console.log(`[PO Edit API] Request received for PO: ${poId}`);
  console.log(`[PO Edit API] Payload items:`, JSON.stringify(items, null, 2));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Recalculate subtotal, tax, and finalTotal from items
    const settingsRes = await client.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsMap = {};
    settingsRes.rows.forEach(r => settingsMap[r.key] = r.value);
    
    const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1' || settingsMap['ppn_enabled'] === true;
    const pajakDefault = parseFloat(settingsMap['pajak_default'] || 11);
    
    let subtotal = 0;
    if (items && Array.isArray(items)) {
      items.forEach(item => {
        subtotal += (parseFloat(item.cost || item.cost_price || item.price || 0) * (parseFloat(item.quantity || item.qty || 0)));
      });
    }
    const finalDiskon = parseFloat(discount || diskon || 0);
    // PPN is calculated from DPP (Subtotal - Diskon)
    const taxAmount = ppnEnabled ? Math.round((subtotal - finalDiskon) * (pajakDefault / 100)) : 0;
    const finalTotal = subtotal - finalDiskon + taxAmount;

    // 2. Check active payments in purchase_order_payments (C2: Soft-Lock)
    const activePayRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total_active, COUNT(*) as count 
       FROM purchase_order_payments 
       WHERE purchase_order_id = ? AND status = 'active'`,
      [poId]
    );
    const totalActivePaid = parseFloat(activePayRes.rows[0].total_active || 0);
    const activePaymentCount = parseInt(activePayRes.rows[0].count || 0);

    // Rule C2: Edit yang membuat total PO lebih kecil dari total pembayaran cicilan aktif ditolak
    if (totalActivePaid > 0 && finalTotal < totalActivePaid) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        softLock: true,
        error: `Total PO baru (Rp ${Math.round(finalTotal).toLocaleString('id-ID')}) tidak boleh lebih kecil dari total pembayaran cicilan aktif yang sudah dicatat (Rp ${Math.round(totalActivePaid).toLocaleString('id-ID')}).`
      });
    }

    // Determine status & effectivePaid by payment type & active cicilan
    const instant = await isInstantPayment(pType);
    const finalPaid = parseFloat(paid || paid_amount || 0);
    let effectivePaid = 0;
    let status = 'Dalam Proses';

    if (activePaymentCount > 0) {
      if (instant) {
        // Tipe pembayaran diubah ke tunai/instant: void cicilan lama, cancel cash transactions lama
        await client.query(
          `UPDATE cash_transactions SET status = 'cancelled' WHERE purchase_order_id = ? AND (status IS NULL OR status = 'active')`,
          [poId]
        );
        await client.query(
          `UPDATE purchase_order_payments SET status = 'void', void_reason = 'Tipe pembayaran diubah ke Tunai/Instant', void_by = ?, void_at = NOW() WHERE purchase_order_id = ? AND status = 'active'`,
          [req.user.id, poId]
        );
        effectivePaid = finalTotal;
        status = 'Selesai';
        const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
        const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
        const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [pType]);
        const methodEdit = ptNameRes.rows[0]?.name || 'Tunai';
        await client.query(
          'INSERT INTO cash_transactions (id, date, type, category, description, amount, method, purchase_order_id, payment_type_id, user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ctId, poDate, 'OUT', 'Pembelian Stok', `Bayar PO ${poId} (Ubah ke ${methodEdit})`, finalTotal, methodEdit, poId, pType, req.user.id, 'active']
        );
      } else {
        effectivePaid = totalActivePaid;
        status = (finalTotal - totalActivePaid) <= 0 ? 'Selesai' : 'Dalam Proses';
      }
    } else {
      effectivePaid = instant ? finalTotal : finalPaid;
      status = instant ? 'Selesai' : (effectivePaid >= finalTotal ? 'Selesai' : 'Dalam Proses');
    }

    const oldItemsRes = await client.query('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);

    // B3 Soft-Lock check for PO: check if any item qty decreased or item was removed
    const oldPoQtyMap = {};
    for (const it of oldItemsRes.rows) {
      oldPoQtyMap[it.product_id] = (oldPoQtyMap[it.product_id] || 0) + parseFloat(it.quantity || 0);
    }
    const newPoQtyMap = {};
    if (items && Array.isArray(items)) {
      for (const it of items) {
        const pId = it.product_id || it.id;
        newPoQtyMap[pId] = (newPoQtyMap[pId] || 0) + parseFloat(it.quantity || it.qty || 0);
      }
    }
    let hasPoReduction = false;
    for (const pId of Object.keys(oldPoQtyMap)) {
      const newQ = newPoQtyMap[pId] || 0;
      if (newQ < oldPoQtyMap[pId]) {
        hasPoReduction = true;
        break;
      }
    }
    const correctionReason = req.body.correction_reason || req.body.reason || '';
    if (hasPoReduction) {
      if (req.user.role.toLowerCase() !== 'admin') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          softLock: true,
          error: 'Pengurangan jumlah item pada PO yang sudah berjalan harus dicatat melalui Retur Pembelian. Hubungi Admin untuk koreksi salah input.'
        });
      }
      if (!correctionReason.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          softLock: true,
          error: 'Koreksi salah input untuk pengurangan item PO wajib menyertakan alasan.'
        });
      }
    }

    for (const item of oldItemsRes.rows) {
      const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
      const nextStock = curStock - parseFloat(item.quantity || 0);
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
      await recordStockMove(client, {
        product_id: item.product_id,
        tanggal: poDate ? poDate + ' 12:00:00' : null,
        tipe: 'koreksi_edit',
        ref_type: 'purchase_order',
        ref_id: poId,
        ref_no: poId,
        qty_masuk: 0,
        qty_keluar: parseFloat(item.quantity || 0),
        qty_sebelum: curStock,
        qty_sesudah: nextStock,
        keterangan: `Koreksi Edit PO ${poId} (reversal item lama)${correctionReason ? ' - ' + correctionReason : ''}`,
        created_by: req.user.id
      });
    }

    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemId = 'POI-' + Date.now() + Math.floor(Math.random() * 1000);
        const prodId = item.product_id || item.id;
        const qty = parseFloat(item.quantity || item.qty || 0);
        const cost = parseFloat(item.cost || item.cost_price || item.price || 0);

        await client.query('INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, cost) VALUES ($1, $2, $3, $4, $5)', [itemId, poId, prodId, qty, cost]);
        const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [prodId]);
        const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
        const nextStock = curStock + qty;
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [qty, prodId]);
        await recordStockMove(client, {
          product_id: prodId,
          tanggal: poDate ? poDate + ' 12:00:00' : null,
          tipe: 'koreksi_edit',
          ref_type: 'purchase_order',
          ref_id: poId,
          ref_no: poId,
          qty_masuk: qty,
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: `Koreksi Edit PO ${poId} (item baru)`,
          created_by: req.user.id
        });
      }
    }

    await client.query('UPDATE purchase_orders SET date = ?, vendor_id = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, status = ?, payment_type_id = ?, due_date = ? WHERE id = ?', [poDate, vId, subtotal, finalDiskon, taxAmount, finalTotal, effectivePaid, status, pType, due_date, poId]);

    if (activePaymentCount === 0) {
      await client.query('DELETE FROM cash_transactions WHERE purchase_order_id = ?', [poId]);
      if (effectivePaid > 0) {
        const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
        const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
        const userId = req.user.id;
        const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [pType]);
        const methodEdit = ptNameRes.rows[0]?.name || 'Transfer Bank';
        await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, purchase_order_id, payment_type_id, user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ctId, poDate, 'OUT', 'Pembelian Stok', `Bayar PO ${poId} (Edit)`, effectivePaid, methodEdit, poId, pType, userId, 'active']);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/purchases/:id/cancel', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const poId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query('SELECT status FROM purchase_orders WHERE id = $1', [poId]);
    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PO tidak ditemukan' });
    }
    if (checkRes.rows[0].status === 'Batal') {
      await client.query('ROLLBACK');
      return res.json({ success: true });
    }

    const itemsRes = await client.query('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    for (const item of itemsRes.rows) {
      const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
      const nextStock = curStock - parseFloat(item.quantity || 0);
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
      await recordStockMove(client, {
        product_id: item.product_id,
        tipe: 'koreksi_edit',
        ref_type: 'purchase_order',
        ref_id: poId,
        ref_no: poId,
        qty_masuk: 0,
        qty_keluar: parseFloat(item.quantity || 0),
        qty_sebelum: curStock,
        qty_sesudah: nextStock,
        keterangan: `Pembatalan PO ${poId}`,
        created_by: req.user.id
      });
    }

    // Auto-void all active payments for this PO
    await client.query(
      `UPDATE purchase_order_payments 
       SET status = 'void', void_reason = 'PO dibatalkan', void_by = ?, void_at = NOW() 
       WHERE purchase_order_id = ? AND status = 'active'`,
      [req.user.id, poId]
    );

    // Cancel all cash transactions for this PO
    await client.query(
      `UPDATE cash_transactions 
       SET status = 'cancelled' 
       WHERE purchase_order_id = ? AND (status IS NULL OR status = 'active')`,
      [poId]
    );

    await client.query('UPDATE purchase_orders SET status = ?, paid_amount = 0, paid_date = NULL WHERE id = ?', ['Batal', poId]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Sales Invoices Extra CRUD ---

/**
 * syncInvoicePaymentState — Fungsi terpusat sinkronisasi status invoice & kas.
 * Dipanggil dari PUT /api/invoices/:id dalam satu transaksi yang sudah berjalan.
 *
 * Aturan sinkronisasi (semua berjalan dalam transaksi client yang diberikan):
 *   - Tunai/Transfer (instant): status Lunas, kas IN 'Penjualan', piutang nihil.
 *   - Kredit (non-instant)   : status Belum Lunas/Sebagian, piutang terbuka.
 *   - Lunas → Belum Lunas    : kas di-reversal (cancelled), paid_amount = 0.
 *   - Belum Lunas → Lunas    : kas baru 'Penjualan' dicatat, paid_amount = total.
 *   - Kredit X → Kredit Y    : due_date dihitung ulang, sisa piutang tetap.
 *   - Total berubah           : paid_amount & status direcalculate dari pembayaran aktif.
 *
 * @param {object} opts
 * @param {object} opts.client          - mysql2 connection (sudah dalam BEGIN)
 * @param {object} opts.currentInv      - baris lama dari sales_invoices
 * @param {string} opts.invId
 * @param {string} opts.invDate         - tanggal invoice (YYYY-MM-DD)
 * @param {string} opts.newPType        - payment_type_id baru
 * @param {number} opts.finalTotal      - total invoice setelah recalculate
 * @param {number} opts.totalActivePaid - SUM amount dari sales_invoice_payments aktif
 * @param {number} opts.activePayCount  - jumlah cicilan aktif
 * @param {string} opts.requestedStatus - 'lunas' | 'belum' | 'sebagian' (dari frontend)
 * @param {number} opts.userId
 * @returns {{ status, effectivePaid, paidDate, newDueDate }}
 */
async function syncInvoicePaymentState({
  client, currentInv, invId, invDate, newPType,
  finalTotal, totalActivePaid, activePayCount,
  requestedStatus, userId
}) {
  const instant = await isInstantPayment(newPType);
  const oldInstant = await isInstantPayment(currentInv.payment_type_id || 'PT-1');

  // Ambil nama tipe pembayaran baru untuk isi method kas
  const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [newPType]);
  const ptName = ptNameRes.rows[0]?.name || 'Transfer Bank';

  // Hitung due_date baru untuk tipe kredit
  let newDueDate = null;
  if (!instant) {
    const match = ptName.match(/(kredit|credit)\s+(\d+)\s+hari/i);
    if (match && match[2]) {
      const days = parseInt(match[2], 10);
      const parts = invDate.split('-');
      if (parts.length === 3) {
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10) + days);
        newDueDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
    }
  }

  let effectivePaid = 0;
  let status = 'Belum Lunas';
  let paidDate = null;

  // ── Kasus A: Ada cicilan aktif (soft-lock sebelumnya sudah konfirmasi) ──
  if (activePayCount > 0) {
    effectivePaid = totalActivePaid;
    const sisa = Math.max(0, finalTotal - totalActivePaid);

    if (instant) {
      // Kredit → Tunai/Transfer: tutup piutang, lunas
      // Batalkan semua kas cicilan lama
      await client.query(
        `UPDATE cash_transactions SET status = 'cancelled' WHERE invoice_id = ? AND (status IS NULL OR status = 'active')`,
        [invId]
      );
      await client.query(
        `UPDATE sales_invoice_payments SET status = 'void', void_reason = 'Tipe pembayaran diubah ke Tunai/Transfer', void_by = ?, void_at = NOW() WHERE invoice_id = ? AND status = 'active'`,
        [userId, invId]
      );
      effectivePaid = finalTotal;
      status = 'Lunas';
      paidDate = invDate;
      // Buat kas baru: Penjualan
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      await client.query(
        'INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, payment_type_id, user_id, status) VALUES (?, ?, \'IN\', \'Penjualan\', ?, ?, ?, ?, ?, ?, \'active\')',
        [ctId, invDate, `Pembayaran INV ${invId} (Ubah ke ${ptName})`, finalTotal, ptName, invId, newPType, userId]
      );
    } else {
      // Kredit tetap kredit: recalculate dari cicilan aktif
      status = sisa <= 0 ? 'Lunas' : (totalActivePaid > 0 ? 'Sebagian' : 'Belum Lunas');
      paidDate = status === 'Lunas' ? (currentInv.paid_date || invDate) : null;
    }

  // ── Kasus B: Tidak ada cicilan aktif ──
  } else {
    const normalizedReq = (requestedStatus || '').toLowerCase();

    if (instant) {
      // Tunai/Transfer: selalu Lunas, kas Penjualan
      effectivePaid = finalTotal;
      status = 'Lunas';
      paidDate = invDate;

      // Hapus kas lama, buat baru
      await client.query(
        `UPDATE cash_transactions SET status = 'cancelled' WHERE invoice_id = ? AND (status IS NULL OR status = 'active')`,
        [invId]
      );
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      await client.query(
        'INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, payment_type_id, user_id, status) VALUES (?, ?, \'IN\', \'Penjualan\', ?, ?, ?, ?, ?, ?, \'active\')',
        [ctId, invDate, `Pembayaran INV ${invId} (Edit)`, finalTotal, ptName, invId, newPType, userId]
      );

    } else if (normalizedReq === 'lunas') {
      // User ingin Lunas, tipe Kredit tapi tidak ada cicilan → catat Lunas manual
      effectivePaid = finalTotal;
      status = 'Lunas';
      paidDate = invDate;

      await client.query(
        `UPDATE cash_transactions SET status = 'cancelled' WHERE invoice_id = ? AND (status IS NULL OR status = 'active')`,
        [invId]
      );
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      await client.query(
        'INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, payment_type_id, user_id, status) VALUES (?, ?, \'IN\', \'Pelunasan Piutang\', ?, ?, ?, ?, ?, ?, \'active\')',
        [ctId, invDate, `Pelunasan INV ${invId} (Edit)`, finalTotal, ptName, invId, newPType, userId]
      );

    } else {
      // Belum Lunas (kredit): batalkan kas lama, piutang terbuka
      effectivePaid = 0;
      status = 'Belum Lunas';
      paidDate = null;

      await client.query(
        `UPDATE cash_transactions SET status = 'cancelled' WHERE invoice_id = ? AND (status IS NULL OR status = 'active')`,
        [invId]
      );
    }
  }

  return { status, effectivePaid, paidDate, newDueDate };
}

app.put('/api/invoices/:id', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  const invId = req.params.id;
  const {
    customer_id, customerId, date,
    paid, paid_amount, payment_type_id,
    due_date, items, discount, diskon,
    requested_status   // ← field baru: 'lunas' | 'belum' | 'sebagian'
  } = req.body;
  const custId = customer_id || customerId;
  const pType = payment_type_id || 'PT-1';

  // Validasi role untuk operasi sensitif: kasir tidak bisa ubah status/tipe
  const callerRole = (req.user.role || '').toLowerCase();
  const canChangeStatusOrType = callerRole === 'admin' || callerRole === 'finance';

  // Masalah 2: Validasi batas tanggal order maksimal +7 hari ke depan pada Edit Invoice
  if (date) {
    try {
      validateOrderDate(date, 7);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the invoice row
    const invCheck = await client.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [invId]);
    if (invCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    const currentInv = invCheck.rows[0];
    const invDate = (date && String(date).trim()) ? formatDateStr(date) : (formatDateStr(currentInv.date) || getTodayWITA());

    if (currentInv.status === 'Cancel' || currentInv.status === 'Batal') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice yang sudah dibatalkan tidak dapat diedit' });
    }

    // Jika kasir mencoba mengubah tipe pembayaran atau status → tolak
    if (!canChangeStatusOrType) {
      const pTypeUnchanged = !payment_type_id || payment_type_id === currentInv.payment_type_id;
      const statusUnchanged = !requested_status;
      if (!pTypeUnchanged || !statusUnchanged) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Hanya administrator dan finance yang dapat mengubah tipe pembayaran atau status invoice.' });
      }
    }

    // 1. Recalculate subtotal, tax, and finalTotal from items
    const settingsRes = await client.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsMap = {};
    settingsRes.rows.forEach(r => settingsMap[r.key] = r.value);
    
    const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1' || settingsMap['ppn_enabled'] === true;
    const pajakDefault = parseFloat(settingsMap['pajak_default'] || 11);
    
    let subtotal = 0;
    if (items && Array.isArray(items)) {
      items.forEach(item => {
        subtotal += (parseFloat(item.price || item.sell_price || 0) * (parseFloat(item.quantity || item.qty || 0)));
      });
    }
    const finalDiskon = parseFloat(discount || diskon || 0);
    // PPN is calculated from DPP (Subtotal - Diskon)
    const taxAmount = ppnEnabled ? Math.round((subtotal - finalDiskon) * (pajakDefault / 100)) : 0;
    const finalTotal = subtotal - finalDiskon + taxAmount;

    // 2. Check active payments in sales_invoice_payments
    const activePayRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total_active, COUNT(*) as count 
       FROM sales_invoice_payments 
       WHERE invoice_id = ? AND status = 'active'`,
      [invId]
    );
    const totalActivePaid = parseFloat(activePayRes.rows[0].total_active || 0);
    const activePaymentCount = parseInt(activePayRes.rows[0].count || 0);

    // Rule: Edit yang membuat total invoice lebih kecil dari total pembayaran aktif ditolak
    if (totalActivePaid > 0 && finalTotal < totalActivePaid) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Total invoice baru (Rp ${Math.round(finalTotal).toLocaleString('id-ID')}) tidak boleh lebih kecil dari total pembayaran aktif yang sudah diterima (Rp ${Math.round(totalActivePaid).toLocaleString('id-ID')}).`
      });
    }

    // 3. Sinkronisasi status, tipe pembayaran, dan kas secara terpusat
    const { status, effectivePaid, paidDate, newDueDate } = await syncInvoicePaymentState({
      client,
      currentInv,
      invId,
      invDate,
      newPType: pType,
      finalTotal,
      totalActivePaid,
      activePayCount: activePaymentCount,
      requestedStatus: requested_status || (canChangeStatusOrType ? null : null),
      userId: req.user.id
    });

    // Tentukan due_date final:
    // - Jika frontend kirim due_date eksplisit → pakai itu
    // - Jika tipe kredit → pakai yang dihitung syncInvoicePaymentState
    // - Jika tipe tunai → null
    let finalDueDate;
    if (due_date !== undefined) {
      finalDueDate = due_date;
    } else if (newDueDate) {
      finalDueDate = newDueDate;
    } else {
      finalDueDate = currentInv.due_date ? formatDateStr(currentInv.due_date) : null;
    }

    // 4. Stock adjustment via DELTA (Hanya untuk invoice yang bukan import outstanding)
    if (!currentInv.is_outstanding_import) {
      const oldItemsRes = await client.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ? FOR UPDATE', [invId]);
      const oldQtyMap = {};
      for (const row of oldItemsRes.rows) {
        const pId = row.product_id;
        oldQtyMap[pId] = (oldQtyMap[pId] || 0) + parseFloat(row.quantity || 0);
      }

      const newQtyMap = {};
      if (items && Array.isArray(items)) {
        for (const item of items) {
          const pId = item.product_id || item.id;
          newQtyMap[pId] = (newQtyMap[pId] || 0) + parseFloat(item.quantity || item.qty || 0);
        }
      }

      const allProductIds = new Set([...Object.keys(oldQtyMap), ...Object.keys(newQtyMap)]);

      // B3 Soft-Lock check for Invoice: check if any item qty decreased or item removed
      let hasInvReduction = false;
      for (const pId of Object.keys(oldQtyMap)) {
        const newQ = newQtyMap[pId] || 0;
        if (newQ < oldQtyMap[pId]) {
          hasInvReduction = true;
          break;
        }
      }
      const invCorrectionReason = req.body.correction_reason || req.body.reason || '';
      if (hasInvReduction) {
        if (req.user.role.toLowerCase() !== 'admin') {
          await client.query('ROLLBACK');
          return res.status(403).json({
            softLock: true,
            error: 'Pengurangan jumlah item pada invoice yang sudah berjalan harus dicatat melalui Retur Penjualan. Hubungi Admin untuk koreksi salah input.'
          });
        }
        if (!invCorrectionReason.trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            softLock: true,
            error: 'Koreksi salah input untuk pengurangan item invoice wajib menyertakan alasan.'
          });
        }
      }

      for (const pId of allProductIds) {
        const oldQty = oldQtyMap[pId] || 0;
        const newQty = newQtyMap[pId] || 0;
        const delta = newQty - oldQty;

        if (delta > 0) {
          // Qty bertambah / item baru: kurangi stok dengan validasi kecukupan
          const pRes = await client.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [pId]);
          if (pRes.rows.length === 0) {
            throw new Error(`Produk dengan ID ${pId} tidak ditemukan`);
          }
          const currentStock = parseFloat(pRes.rows[0].stock || 0);
          if (currentStock < delta) {
            throw new Error(`Stok produk "${pRes.rows[0].name}" tidak mencukupi untuk penambahan (${delta} dibutuhkan, stok saat ini: ${currentStock})`);
          }
          const nextStock = currentStock - delta;
          await client.query('UPDATE products SET stock = stock - ? WHERE id = ?', [delta, pId]);
          await recordStockMove(client, {
            product_id: pId,
            tanggal: invDate ? invDate + ' 12:00:00' : null,
            tipe: 'koreksi_edit',
            ref_type: 'invoice',
            ref_id: invId,
            ref_no: invId,
            qty_masuk: 0,
            qty_keluar: delta,
            qty_sebelum: currentStock,
            qty_sesudah: nextStock,
            keterangan: `Koreksi Edit Invoice (tambah qty): ${invCorrectionReason || '-'}`,
            created_by: req.user.id
          });
        } else if (delta < 0) {
          // Qty berkurang / item dihapus: kembalikan selisih ke stok
          const returnQty = Math.abs(delta);
          const pRes = await client.query('SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE', [pId]);
          const currentStock = parseFloat(pRes.rows[0]?.stock || 0);
          const nextStock = currentStock + returnQty;
          await client.query('UPDATE products SET stock = stock + ? WHERE id = ?', [returnQty, pId]);
          await recordStockMove(client, {
            product_id: pId,
            tanggal: invDate ? invDate + ' 12:00:00' : null,
            tipe: 'koreksi_edit',
            ref_type: 'invoice',
            ref_id: invId,
            ref_no: invId,
            qty_masuk: returnQty,
            qty_keluar: 0,
            qty_sebelum: currentStock,
            qty_sesudah: nextStock,
            keterangan: `Koreksi Edit Invoice (kurang qty): ${invCorrectionReason}`,
            created_by: req.user.id
          });
        }
      }

      await client.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invId]);

      if (items && Array.isArray(items)) {
        for (const item of items) {
          const itemId = 'IVI-' + Date.now() + Math.floor(Math.random() * 1000);
          const prodId = item.product_id || item.id;
          const qty = parseFloat(item.quantity || item.qty || 0);
          const price = parseFloat(item.price || item.sell_price || 0);
          const itemFee = req.user.role === 'admin' ? (parseFloat(item.customer_fee) || 0) : 0;
          const itemFeeNotes = req.user.role === 'admin' ? (item.fee_notes || null) : null;
          if (itemFee < 0) throw new Error('customer_fee tidak boleh negatif');

          const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [prodId]);
          const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || item.cost_price || 0);

          await client.query(
            'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [itemId, invId, prodId, qty, price, costSnapshot, itemFee, itemFeeNotes]
          );
        }
      }
    }

    // 5. Update sales_invoices
    await client.query(
      'UPDATE sales_invoices SET date = ?, customer_id = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, status = ?, payment_type_id = ?, due_date = ?, paid_date = ? WHERE id = ?',
      [invDate, custId, subtotal, finalDiskon, taxAmount, finalTotal, effectivePaid, status, pType, finalDueDate, paidDate, invId]
    );

    await client.query('COMMIT');
    res.json({ success: true, status, effectivePaid, paidDate, due_date: finalDueDate });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/invoices/:id/cancel', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  const invId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query('SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE', [invId]);
    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    const currentInv = checkRes.rows[0];
    if (currentInv.status === 'Cancel' || currentInv.status === 'Batal') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice sudah berstatus Cancel, tidak dapat dibatalkan lagi.' });
    }

    // 1. Restore product stock (HANYA untuk invoice non-outstanding import)
    if (!currentInv.is_outstanding_import) {
      const itemsRes = await client.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id = $1', [invId]);
      for (const item of itemsRes.rows) {
        const prodRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
        const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
        const nextStock = curStock + parseFloat(item.quantity || 0);
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
        await recordStockMove(client, {
          product_id: item.product_id,
          tipe: 'cancel_invoice',
          ref_type: 'invoice',
          ref_id: invId,
          ref_no: invId,
          qty_masuk: parseFloat(item.quantity || 0),
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: `Pembatalan Invoice ${invId}`,
          created_by: req.user.id
        });
      }
    }

    // 2. Automatically void all active payments for this invoice
    await client.query(
      `UPDATE sales_invoice_payments 
       SET status = 'void', void_reason = 'Invoice dibatalkan', void_by = ?, void_at = NOW() 
       WHERE invoice_id = ? AND status = 'active'`,
      [req.user.id, invId]
    );

    // 3. Reversal all active cash transactions related to this invoice (mark status as 'cancelled')
    await client.query(
      `UPDATE cash_transactions 
       SET status = 'cancelled' 
       WHERE invoice_id = ? AND (status IS NULL OR status = 'active')`,
      [invId]
    );

    // 4. Update sales_invoices status to 'Cancel'
    await client.query('UPDATE sales_invoices SET status = $1, paid_amount = 0, paid_date = NULL WHERE id = $2', ['Cancel', invId]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Invoice berhasil dibatalkan' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Cash Transactions (Arus Kas) ---


app.post('/api/finance/cashflow', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { type, category, description, amount, method, date } = req.body;
  const ctDate = date || new Date().toISOString().split('T')[0];
  try {
    const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
    const ctId = await generateNextId(pool, 'cash_transactions', ctPrefix);
    await pool.query(
      'INSERT INTO cash_transactions (id, date, type, category, description, amount, method) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [ctId, ctDate, type, category, description, parseFloat(amount), method]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Reports & Dashboard API ---
app.get('/api/finance/reports/profit-loss', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const salesRes = await pool.query("SELECT SUM(total) as revenue FROM sales_invoices WHERE status NOT IN ('Batal', 'Cancel', 'Dibatalkan')");
    const revenue = parseFloat(salesRes.rows[0].revenue || 0);

    const hppRes = await pool.query(`
      SELECT SUM(ii.quantity * p.cost_price) as hpp 
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN sales_invoices si ON ii.invoice_id = si.id
      WHERE si.status NOT IN ('Batal', 'Cancel', 'Dibatalkan')
    `);
    const hpp = parseFloat(hppRes.rows[0].hpp || 0);

    const expensesRes = await pool.query(`
      SELECT category, SUM(amount) as total 
      FROM cash_transactions 
      WHERE type = 'OUT' AND category NOT IN ('Pembelian Stok', 'Hutang')
      GROUP BY category
    `);

    res.json({
      revenue,
      hpp,
      expenses: expensesRes.rows.map(r => ({
        category: r.category,
        amount: parseFloat(r.total)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/finance/reports/balance-sheet', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const cashInRes = await pool.query("SELECT SUM(amount) as total FROM cash_transactions WHERE type = 'IN'");
    const cashOutRes = await pool.query("SELECT SUM(amount) as total FROM cash_transactions WHERE type = 'OUT'");
    const cash = parseFloat(cashInRes.rows[0].total || 0) - parseFloat(cashOutRes.rows[0].total || 0);

    const piutangRes = await pool.query("SELECT SUM(total - paid_amount) as total FROM sales_invoices WHERE status NOT IN ('Batal', 'Cancel', 'Dibatalkan')");
    const piutang = parseFloat(piutangRes.rows[0].total || 0);

    const inventoryRes = await pool.query("SELECT SUM(stock * cost_price) as total FROM products");
    const persediaan = parseFloat(inventoryRes.rows[0].total || 0);

    const hutangRes = await pool.query("SELECT SUM(total - paid_amount) as total FROM purchase_orders WHERE status NOT IN ('Batal', 'Cancel', 'Dibatalkan')");
    const hutang = parseFloat(hutangRes.rows[0].total || 0);

    res.json({
      cash,
      piutang,
      persediaan,
      hutang
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/insights', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const topProductsRes = await pool.query(`
      SELECT p.name, SUM(ii.quantity * ii.price) as value
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN sales_invoices si ON ii.invoice_id = si.id
      WHERE si.status NOT IN ('Batal', 'Cancel', 'Dibatalkan')
      GROUP BY p.id, p.name
      ORDER BY value DESC
      LIMIT 5
    `);

    const topCustomersRes = await pool.query(`
      SELECT c.name, SUM(si.total) as value
      FROM sales_invoices si
      JOIN customers c ON si.customer_id = c.id
      WHERE si.status NOT IN ('Batal', 'Cancel', 'Dibatalkan')
      GROUP BY c.id, c.name
      ORDER BY value DESC
      LIMIT 5
    `);

    res.json({
      topProducts: topProductsRes.rows.map(r => ({ name: r.name, value: parseFloat(r.value) })),
      topCustomers: topCustomersRes.rows.map(r => ({ name: r.name, value: parseFloat(r.value) }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Product Stock Opname ---
app.post('/api/products/:id/stock-adjustment', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const prodId = req.params.id;
  const { actual_stock, reason } = req.body;
  const finalActual = parseFloat(actual_stock);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prodRes = await client.query('SELECT stock FROM products WHERE id = $1', [prodId]);
    if (prodRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }

    const systemStock = parseFloat(prodRes.rows[0].stock || 0);
    const diff = finalActual - systemStock;
    if (diff === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, message: 'Tidak ada perbedaan stok' });
    }

    const type = diff > 0 ? 'IN' : 'OUT';
    const qty = Math.abs(diff);
    const adjId = 'ADJ-' + Date.now();
    const date = new Date().toISOString().split('T')[0];
    const userId = req.user.id;

    await client.query('INSERT INTO stock_adjustments (id, product_id, type, quantity, reason, adjustment_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [adjId, prodId, type, qty, reason, date, userId]);
    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [finalActual, prodId]);
    await recordStockMove(client, {
      product_id: prodId,
      tanggal: date ? date + ' 12:00:00' : null,
      tipe: 'opname',
      ref_type: 'stock_adjustment',
      ref_id: adjId,
      ref_no: adjId,
      qty_masuk: diff > 0 ? qty : 0,
      qty_keluar: diff < 0 ? qty : 0,
      qty_sebelum: systemStock,
      qty_sesudah: finalActual,
      keterangan: reason || 'Stock Opname',
      created_by: userId
    });

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Users / Staff CRUD ---
app.get('/api/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, name, email, role, active FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { username, name, email, password, role, active } = req.body;
  try {
    const targetPassword = password || '123456';
    if (targetPassword.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    const hashedPassword = await hashPassword(targetPassword);
    await pool.query(
      'INSERT INTO users (username, name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5, $6)',
      [username, name, email, hashedPassword, role || 'kasir', active !== undefined ? active : true]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, email, role, active, password } = req.body;
  try {
    let result;
    if (password && typeof password === 'string' && password.trim().length > 0) {
      const cleanPassword = password.trim();
      if (cleanPassword.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
      }
      const hashedPassword = await hashPassword(cleanPassword);
      result = await pool.query(
        'UPDATE users SET name = $1, email = $2, role = $3, active = $4, password_hash = $5 WHERE id = $6',
        [name, email, role, active, hashedPassword, id]
      );
    } else {
      result = await pool.query(
        'UPDATE users SET name = $1, email = $2, role = $3, active = $4 WHERE id = $5',
        [name, email, role, active, id]
      );
    }
    const affected = result.affectedRows || result.rowCount || 0;
    if (affected === 0) {
      return res.status(404).json({ error: 'Staff tidak ditemukan' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE users SET active = false WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve HTML files
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});



// One-time setup function that runs on server start to seed superadmin
(async () => {
  try {
    const newAdminPassword = 'Admin@2026';
    const hashedPassword = await hashPassword(newAdminPassword);
    
    await pool.query(`
      INSERT IGNORE INTO users (username, name, email, password_hash, role, active)
      VALUES ('superadmin', 'Super Administrator', 
              'superadmin@supplierpro.id', ?, 'admin', 1)
    `, [hashedPassword]);
    console.log('[Seed] Superadmin user verification completed');
  } catch (err) {
    console.error('[Seed] Failed to seed superadmin user:', err.message);
  }
})();

// --- Laporan Customer Fee (Admin Only) ---
app.get('/api/reports/customer-fee', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ success: false, error: 'Parameter start_date dan end_date wajib diisi (format: YYYY-MM-DD)' });
  }
  const client = await pool.connect();
  try {
    // Breakdown per bulan
    const resBulan = await client.query(`
      SELECT
        DATE_FORMAT(DATE(si.date), '%Y-%m') AS periode,
        SUM(ii.customer_fee) AS total_fee,
        COUNT(DISTINCT si.id) AS jumlah_transaksi
      FROM invoice_items ii
      JOIN sales_invoices si ON si.id = ii.invoice_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
        AND ii.customer_fee > 0
      GROUP BY DATE_FORMAT(DATE(si.date), '%Y-%m')
      ORDER BY DATE_FORMAT(DATE(si.date), '%Y-%m')
    `, [start_date, end_date]);

    // Breakdown per produk
    const resProduk = await client.query(`
      SELECT
        p.name AS produk,
        SUM(ii.customer_fee) AS total_fee,
        COUNT(*) AS jumlah_item
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      JOIN sales_invoices si ON si.id = ii.invoice_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
        AND ii.customer_fee > 0
      GROUP BY p.name
      ORDER BY total_fee DESC
    `, [start_date, end_date]);

    // Breakdown per detail item
    const resDetail = await client.query(`
      SELECT
        si.id AS invoice_id,
        DATE(si.date) AS date,
        COALESCE(c.name, 'Pelanggan Umum') AS customer_name,
        COALESCE(p.name, '-') AS product_name,
        ii.quantity,
        ii.customer_fee,
        ii.fee_notes
      FROM invoice_items ii
      JOIN sales_invoices si ON si.id = ii.invoice_id
      LEFT JOIN customers c ON c.id = si.customer_id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE DATE(si.date) BETWEEN ? AND ?
        AND si.status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
        AND ii.customer_fee > 0
      ORDER BY DATE(si.date) DESC, si.id DESC
    `, [start_date, end_date]);

    const totalFee = resBulan.rows.reduce((s, r) => s + parseFloat(r.total_fee || 0), 0);

    res.json({
      success: true,
      data: {
        start_date,
        end_date,
        total_fee: totalFee,
        per_bulan: resBulan.rows.map(r => ({
          periode: r.periode,
          total_fee: parseFloat(r.total_fee || 0),
          jumlah_transaksi: parseInt(r.jumlah_transaksi)
        })),
        per_produk: resProduk.rows.map(r => ({
          produk: r.produk,
          total_fee: parseFloat(r.total_fee || 0),
          jumlah_item: parseInt(r.jumlah_item)
        })),
        detail: resDetail.rows.map(r => ({
          invoice_id: r.invoice_id,
          date: formatDateStr(r.date),
          customer_name: r.customer_name,
          product_name: r.product_name,
          quantity: parseFloat(r.quantity || 0),
          customer_fee: parseFloat(r.customer_fee || 0),
          fee_notes: r.fee_notes || ''
        }))
      }
    });
  } catch (err) {
    console.error('[Customer Fee Report] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// --- API Endpoint: Get Last Reconciliation Status ---
app.get('/api/finance/reconciliation-status', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const dbRes = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'reconciliation_last_status'`);
    if (dbRes.rows.length === 0) {
      return res.json({ success: true, status: { balanced: true, lastRun: null, issues: [] } });
    }
    const status = JSON.parse(dbRes.rows[0].value);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Daily Reconciliation Runner
async function runDailyReconciliation() {
  const logFile = path.join(__dirname, 'reconciliation.log');
  const now = new Date();
  
  // Reconcile for current month and previous month
  const targetMonths = [
    { month: now.getMonth() + 1, year: now.getFullYear() }
  ];
  // Also add previous month
  const prevDate = new Date();
  prevDate.setMonth(now.getMonth() - 1);
  targetMonths.push({ month: prevDate.getMonth() + 1, year: prevDate.getFullYear() });

  let allBalanced = true;
  let allIssues = [];
  const logEntries = [];

  logEntries.push(`\n==================================================`);
  logEntries.push(`AUTOMATIC RECONCILIATION RUN: ${now.toISOString()}`);
  logEntries.push(`==================================================`);

  const client = await pool.connect();
  try {
    for (const target of targetMonths) {
      const { month, year } = target;
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      
      const lastDayResult = await client.query(`SELECT LAST_DAY(?) AS end_date`, [startDate]);
      const rawEndDate = lastDayResult.rows[0]?.end_date;
      let endDate = '';
      if (rawEndDate instanceof Date) {
        const y = rawEndDate.getFullYear();
        const m = String(rawEndDate.getMonth() + 1).padStart(2, '0');
        const d = String(rawEndDate.getDate()).padStart(2, '0');
        endDate = `${y}-${m}-${d}`;
      } else {
        endDate = formatDateStr(rawEndDate);
      }

      logEntries.push(`Reconciling Periode: ${startDate} -> ${endDate}`);

      // 1. Laba Rugi
      const resPend = await client.query(`
        SELECT COALESCE(SUM(total), 0) AS kotor, COALESCE(SUM(COALESCE(discount, 0)), 0) AS diskon
        FROM sales_invoices WHERE DATE(date) BETWEEN ? AND ? AND status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
      `, [startDate, endDate]);
      const penjualanKotor = parseFloat(resPend.rows[0]?.kotor || 0);
      const diskon = parseFloat(resPend.rows[0]?.diskon || 0);
      const penjualanBersih = penjualanKotor - diskon;

      const resHpp = await client.query(`
        SELECT COALESCE(SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price_snapshot, 0), p.cost_price)), 0) AS hpp
        FROM invoice_items ii JOIN sales_invoices si ON si.id = ii.invoice_id LEFT JOIN products p ON p.id = ii.product_id
        WHERE DATE(si.date) BETWEEN ? AND ? AND si.status NOT IN ('Batal', 'Dibatalkan', 'Cancel')
      `, [startDate, endDate]);
      const hpp = parseFloat(resHpp.rows[0]?.hpp || 0);
      const labaKotor = penjualanBersih - hpp;

      // Beban
      const resBeban = await client.query(`
        SELECT COALESCE(SUM(ct.amount), 0) AS total
        FROM cash_transactions ct WHERE ct.type = 'OUT' AND (ct.status IS NULL OR ct.status != 'cancelled')
        AND ct.invoice_id IS NULL AND ct.purchase_order_id IS NULL AND ct.date BETWEEN ? AND ?
        AND ct.category NOT IN (SELECT name FROM cash_categories WHERE is_system = 1 AND (type = 'OUT' OR type = 'BOTH'))
      `, [startDate, endDate]);
      const beban = parseFloat(resBeban.rows[0]?.total || 0);

      // Pendapatan Lain
      const resLain = await client.query(`
        SELECT COALESCE(SUM(ct.amount), 0) AS total
        FROM cash_transactions ct WHERE ct.type = 'IN' AND (ct.status IS NULL OR ct.status != 'cancelled')
        AND ct.date BETWEEN ? AND ?
        AND ct.category NOT IN (SELECT name FROM cash_categories WHERE is_system = 1 AND (type = 'IN' OR type = 'BOTH'))
      `, [startDate, endDate]);
      const pendapatanLain = parseFloat(resLain.rows[0]?.total || 0);
      const labaBersih = labaKotor - beban + pendapatanLain;

      // 2. Neraca
      const resKas = await client.query(`
        SELECT COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0) AS masuk,
               COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0) AS keluar
        FROM cash_transactions WHERE DATE(date) <= ? AND status = 'active'
      `, [endDate]);
      const kasBank = parseFloat(resKas.rows[0].masuk) - parseFloat(resKas.rows[0].keluar);

      const resPiutang = await client.query(`
        SELECT COALESCE(SUM(total - paid_amount), 0) AS piutang FROM sales_invoices
        WHERE status NOT IN ('Lunas', 'Dibatalkan', 'Batal', 'Cancel') AND DATE(date) <= ?
      `, [endDate]);
      const piutangUsaha = parseFloat(resPiutang.rows[0].piutang);

      const resPersediaan = await client.query(`SELECT COALESCE(SUM(stock * cost_price), 0) AS persediaan FROM products`);
      const persediaan = parseFloat(resPersediaan.rows[0].persediaan);
      const totalAset = kasBank + piutangUsaha + persediaan;

      const resHutang = await client.query(`
        SELECT COALESCE(SUM(total - paid_amount), 0) AS hutang FROM purchase_orders
        WHERE status NOT IN ('Selesai', 'Dibatalkan', 'Batal') AND DATE(date) <= ?
      `, [endDate]);
      const hutangUsaha = parseFloat(resHutang.rows[0].hutang);
      
      const resModal = await client.query(`SELECT value FROM settings WHERE \`key\` = 'modal_pemilik'`);
      const modalPemilik = parseFloat(resModal.rows[0]?.value || 0);
      const labaDitahan = totalAset - hutangUsaha - modalPemilik;
      const totalPasiva = hutangUsaha + modalPemilik + labaDitahan;

      const selisih = Math.abs(totalAset - totalPasiva);
      const balanced = selisih < 1;

      if (!balanced) {
        allBalanced = false;
        const msg = `[${startDate}] Selisih Neraca sebesar Rp ${selisih.toLocaleString('id-ID')}`;
        allIssues.push(msg);
        logEntries.push(`❌ ${msg}`);
      } else {
        logEntries.push(`✅ Neraca Balance (Laba Bersih: Rp ${labaBersih.toLocaleString('id-ID')})`);
      }

      // Check Integritas Data
      const invLunasRes = await client.query(`
        SELECT COUNT(*) AS count FROM sales_invoices WHERE status = 'Lunas' AND paid_amount < total - 1
      `);
      const invLunasCount = parseInt(invLunasRes.rows[0]?.count || 0);
      if (invLunasCount > 0) {
        allBalanced = false;
        const msg = `[${startDate}] ${invLunasCount} invoice Lunas memiliki paid_amount < total`;
        allIssues.push(msg);
        logEntries.push(`❌ ${msg}`);
      }

      const stokNegatifRes = await client.query(`SELECT COUNT(*) AS count FROM products WHERE stock < 0`);
      const stokNegatifCount = parseInt(stokNegatifRes.rows[0]?.count || 0);
      if (stokNegatifCount > 0) {
        allBalanced = false;
        const msg = `[${startDate}] ${stokNegatifCount} produk memiliki stok negatif`;
        allIssues.push(msg);
        logEntries.push(`❌ ${msg}`);
      }
    }

    // Write final status to settings
    const finalStatus = {
      balanced: allBalanced,
      lastRun: now.toISOString(),
      issues: allIssues
    };
    await client.query(`INSERT INTO settings (\`key\`, value) VALUES ('reconciliation_last_status', ?) ON DUPLICATE KEY UPDATE value = ?`, [JSON.stringify(finalStatus), JSON.stringify(finalStatus)]);
    logEntries.push(`Result: ${allBalanced ? 'ALL BALANCED' : 'ISSUES DETECTED'}`);

  } catch (err) {
    logEntries.push(`ERROR DURING RECONCILIATION: ${err.message}`);
    console.error('[Auto Reconcile] Error:', err);
  } finally {
    client.release();
    fs.appendFileSync(logFile, logEntries.join('\n') + '\n');
    console.log('[Auto Reconcile] Daily reconciliation finished.');
  }
}

// Check every hour if the day has changed to trigger daily reconciliation
let lastReconcileDay = new Date().getDate();
setInterval(() => {
  const currentDay = new Date().getDate();
  if (currentDay !== lastReconcileDay) {
    lastReconcileDay = currentDay;
    runDailyReconciliation();
  }
}, 3600000); // Hourly check

// Trigger on startup (delayed slightly to ensure tables are loaded/migrated)
setTimeout(() => {
  runDailyReconciliation();
}, 10000);

// Handle PayloadTooLargeError — return JSON instead of HTML 413 page
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Payload terlalu besar. Maksimal 10MB per request. Bagi file import menjadi beberapa batch yang lebih kecil.'
    });
  }
  next(err);
});

// ─── PROFORMA INVOICE MODULE ──────────────────────────────────────────────────

/**
 * Auto-migrate: create proforma tables if not exist
 * Uses the same idempotent pattern as invoice_counters migration above.
 */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proforma_counters (
        year INT NOT NULL PRIMARY KEY,
        last_number INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proformas (
        pk INT AUTO_INCREMENT PRIMARY KEY,
        proforma_no VARCHAR(20) NOT NULL UNIQUE,
        customer_id VARCHAR(255),
        order_date DATE NOT NULL,
        berlaku_hingga DATE NOT NULL,
        payment_type_id VARCHAR(255),
        subtotal DECIMAL(20,4) DEFAULT 0,
        discount DECIMAL(20,4) DEFAULT 0,
        ppn_rate DECIMAL(5,2) DEFAULT 0,
        ppn_amount DECIMAL(20,4) DEFAULT 0,
        ppn_enabled TINYINT(1) DEFAULT 0,
        total DECIMAL(20,4) DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'aktif',
        alasan_pembatalan TEXT DEFAULT NULL,
        user_id INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        invoice_id VARCHAR(255) DEFAULT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
        FOREIGN KEY (payment_type_id) REFERENCES payment_types(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL,
        INDEX idx_proforma_customer (customer_id),
        INDEX idx_proforma_status (status),
        INDEX idx_proforma_order_date (order_date),
        INDEX idx_proforma_berlaku (berlaku_hingga)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proforma_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        proforma_pk INT NOT NULL,
        product_id VARCHAR(255),
        product_name_snapshot VARCHAR(255) NOT NULL,
        unit_name_snapshot VARCHAR(50) DEFAULT '-',
        quantity DECIMAL(20,4) NOT NULL,
        price DECIMAL(20,4) NOT NULL,
        subtotal_item DECIMAL(20,4) NOT NULL,
        customer_fee DECIMAL(20,4) DEFAULT 0,
        fee_notes TEXT DEFAULT NULL,
        cost_price_snapshot DECIMAL(20,4) DEFAULT 0,
        FOREIGN KEY (proforma_pk) REFERENCES proformas(pk) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
        INDEX idx_proforma_items_pk (proforma_pk)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    // Ensure default setting for masa berlaku
    await pool.query(`INSERT IGNORE INTO settings (\`key\`, value) VALUES ('proforma_berlaku_hari', '7')`);

    // Ensure Item 3 & Item 4 columns exist (idempotent ALTER)
    try {
      const colRes = await pool.query("SHOW COLUMNS FROM proformas LIKE 'revisi'");
      if (colRes.rows.length === 0) {
        await pool.query("ALTER TABLE proformas ADD COLUMN revisi INT NOT NULL DEFAULT 0 AFTER status");
      }
      const diubahPadaRes = await pool.query("SHOW COLUMNS FROM proformas LIKE 'diubah_pada'");
      if (diubahPadaRes.rows.length === 0) {
        await pool.query("ALTER TABLE proformas ADD COLUMN diubah_pada DATETIME NULL AFTER revisi");
      }
      const diubahOlehRes = await pool.query("SHOW COLUMNS FROM proformas LIKE 'diubah_oleh'");
      if (diubahOlehRes.rows.length === 0) {
        await pool.query("ALTER TABLE proformas ADD COLUMN diubah_oleh INT NULL AFTER diubah_pada, ADD CONSTRAINT fk_proforma_diubah_oleh FOREIGN KEY (diubah_oleh) REFERENCES users(id) ON DELETE SET NULL");
      }
      const sumberRes = await pool.query("SHOW COLUMNS FROM proformas LIKE 'sumber'");
      if (sumberRes.rows.length === 0) {
        await pool.query("ALTER TABLE proformas ADD COLUMN sumber ENUM('manual','dari_invoice') NOT NULL DEFAULT 'manual' AFTER diubah_oleh");
      }
      const ukIdx = await pool.query("SHOW INDEX FROM proformas WHERE Key_name = 'uk_proforma_invoice_id'");
      if (ukIdx.rows.length === 0) {
        await pool.query("ALTER TABLE proformas ADD UNIQUE KEY uk_proforma_invoice_id (invoice_id)");
      }
    } catch (e) {
      console.warn('[Startup] Proforma column migration check:', e.message);
    }

    console.log('[Startup] Proforma tables ready.');
  } catch (err) {
    console.error('[Startup] Failed to create proforma tables:', err.message);
  }
})();

/**
 * Generates the next proforma number using an atomic per-year counter.
 * Format: PF-{YYYY}-{NNNNN} (year from order_date, resets yearly)
 * Thread-safe via LAST_INSERT_ID() trick (same as generateInvoiceId).
 */
async function generateProformaNo(pgClient, orderDate) {
  // Use the order_date year for the number (consistent with invoice behavior, resets yearly)
  const year = orderDate
    ? parseInt(String(orderDate).split('-')[0], 10)
    : new Date().getFullYear();

  await pgClient.query(
    `INSERT INTO proforma_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    [year]
  );

  const result = await pgClient.query('SELECT LAST_INSERT_ID() AS next_number');
  const nextNum = Number(result.rows[0].next_number);
  const padded = String(nextNum).padStart(5, '0');
  return `PF-${year}-${padded}`;
}

// ─── Shared calculation helper (same logic as POST /api/invoices) ──────────
async function calcProformaAmounts(pgClient, items, discount) {
  const settingsRes = await pgClient.query(
    `SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`
  );
  const settingsMap = {};
  settingsRes.rows.forEach(r => { settingsMap[r.key] = r.value; });

  const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1';
  const ppnRate = parseFloat(settingsMap['pajak_default'] || 11);
  const diskon = parseFloat(discount || 0);

  let subtotal = 0;
  items.forEach(item => {
    subtotal += parseFloat(item.price || 0) * parseFloat(item.quantity || item.qty || 0);
  });

  const ppnAmount = ppnEnabled ? Math.round((subtotal - diskon) * (ppnRate / 100)) : 0;
  const total = subtotal - diskon + ppnAmount;

  return { subtotal, diskon, ppnEnabled, ppnRate, ppnAmount, total };
}

// POST /api/proformas — Buat proforma baru
app.post('/api/proformas', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const { customer_id, order_date, payment_type_id, items, discount } = req.body;

  if (!customer_id) return res.status(400).json({ error: 'customer_id wajib diisi' });
  if (!payment_type_id) return res.status(400).json({ error: 'payment_type_id wajib diisi' });
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Proforma harus memiliki minimal satu item.' });

  // Validate order_date (Masalah 2: max +7 hari ke depan)
  const todayWITA = getTodayWITA();
  let orderDateStr;
  try {
    orderDateStr = order_date ? validateOrderDate(order_date, 7) : todayWITA;
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Calculate amounts using shared logic
    const { subtotal, diskon, ppnEnabled, ppnRate, ppnAmount, total } =
      await calcProformaAmounts(client, items, discount);

    // Masa berlaku default from settings
    const berlakuHari = parseInt(await getSetting('proforma_berlaku_hari', '7'), 10);
    // Calculate berlaku_hingga from order_date (not today) — string arithmetic is safe for dates
    const [oy, om, od] = orderDateStr.split('-').map(Number);
    const berlakuDt = new Date(oy, om - 1, od + berlakuHari);
    const berlakuStr = `${berlakuDt.getFullYear()}-${String(berlakuDt.getMonth()+1).padStart(2,'0')}-${String(berlakuDt.getDate()).padStart(2,'0')}`;

    const proformaNo = await generateProformaNo(client, orderDateStr);
    const userId = req.user.id;

    await client.query(
      `INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id,
        subtotal, discount, ppn_rate, ppn_amount, ppn_enabled, total, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aktif', ?)`,
      [proformaNo, customer_id, orderDateStr, berlakuStr, payment_type_id,
       subtotal, diskon, ppnRate, ppnAmount, ppnEnabled ? 1 : 0, total, userId]
    );

    // Get the inserted pk
    const pkRes = await client.query('SELECT LAST_INSERT_ID() AS pk');
    const proformaPk = Number(pkRes.rows[0].pk);

    // Insert items — snapshot product name and unit
    for (const item of items) {
      const prodId = item.id || item.product_id;
      const qty = parseFloat(item.quantity || item.qty || 0);
      const price = parseFloat(item.price || 0);
      const subtotalItem = qty * price;

      // Fetch product snapshot data
      const prodRes = await client.query(
        `SELECT p.name, pu.name AS unit_name, p.cost_price
         FROM products p LEFT JOIN product_units pu ON p.unit_id = pu.id
         WHERE p.id = ?`,
        [prodId]
      );
      const prodRow = prodRes.rows[0] || {};
      const prodNameSnap = prodRow.name || item.name || 'Produk';
      const unitNameSnap = prodRow.unit_name || '-';
      const costSnap = parseFloat(prodRow.cost_price || 0);

      // Fee: only admin can set fee
      const itemFee = req.user.role === 'admin' ? (parseFloat(item.customer_fee) || 0) : 0;
      const itemFeeNotes = req.user.role === 'admin' ? (item.fee_notes || null) : null;

      await client.query(
        `INSERT INTO proforma_items (proforma_pk, product_id, product_name_snapshot, unit_name_snapshot,
          quantity, price, subtotal_item, customer_fee, fee_notes, cost_price_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [proformaPk, prodId, prodNameSnap, unitNameSnap, qty, price, subtotalItem, itemFee, itemFeeNotes, costSnap]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, proformaNo, proformaPk });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Proforma Create] Error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/proformas — Daftar proforma dengan filter dan pagination
app.get('/api/proformas', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || 1));
    const limit = Math.min(80, Math.max(1, parseInt(req.query.limit || 30)));
    const offset = (page - 1) * limit;
    const status = req.query.status || 'all';
    const search = req.query.search || '';
    const sumber = req.query.sumber || 'all';

    let whereClause = '';
    const params = [];

    const conditions = [];
    if (status !== 'all') {
      conditions.push('p.status = ?');
      params.push(status);
    }
    if (sumber !== 'all') {
      conditions.push('p.sumber = ?');
      params.push(sumber);
    }
    if (search) {
      conditions.push('(p.proforma_no LIKE ? OR c.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (conditions.length) whereClause = 'WHERE ' + conditions.join(' AND ');

    const todayStr = getTodayWITA();

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM proformas p
       LEFT JOIN customers c ON p.customer_id = c.id
       ${whereClause}`,
      params
    );
    const totalRows = Number(countRes.rows[0].total);

    const rows = await pool.query(
      `SELECT p.pk, p.proforma_no, p.order_date, p.berlaku_hingga, p.status,
              p.subtotal, p.discount, p.ppn_amount, p.total,
              p.payment_type_id, p.invoice_id, p.sumber,
              c.name AS customer_name,
              pt.name AS payment_type_name,
              CASE
                WHEN p.status = 'aktif' AND p.berlaku_hingga < ? THEN 'kedaluwarsa'
                ELSE p.status
              END AS display_status
       FROM proformas p
       LEFT JOIN customers c ON p.customer_id = c.id
       LEFT JOIN payment_types pt ON p.payment_type_id = pt.id
       ${whereClause}
       ORDER BY
         CASE WHEN p.proforma_no REGEXP '^PF-[0-9]{4}' THEN 1 ELSE 0 END DESC,
         CASE WHEN p.proforma_no REGEXP '^PF-[0-9]{4}' THEN CAST(SUBSTRING(p.proforma_no, 4, 4) AS UNSIGNED) ELSE 0 END DESC,
         CASE WHEN p.proforma_no REGEXP '^PF-' THEN CAST(SUBSTRING_INDEX(p.proforma_no, '-', -1) AS UNSIGNED) ELSE 0 END DESC,
         p.pk DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [todayStr, ...params]
    );

    res.json({
      rows: rows.rows.map(r => ({
        pk: r.pk,
        proforma_no: r.proforma_no,
        order_date: formatDateStr(r.order_date),
        berlaku_hingga: formatDateStr(r.berlaku_hingga),
        status: r.status,
        display_status: r.display_status,
        subtotal: parseFloat(r.subtotal),
        discount: parseFloat(r.discount),
        ppn_amount: parseFloat(r.ppn_amount),
        total: parseFloat(r.total),
        payment_type_id: r.payment_type_id,
        payment_type_name: r.payment_type_name,
        customer_name: r.customer_name,
        invoice_id: r.invoice_id,
        sumber: r.sumber || 'manual'
      })),
      total: totalRows,
      page,
      limit,
      totalPages: Math.ceil(totalRows / limit)
    });
  } catch (err) {
    console.error('[GET /api/proformas] Stack trace:', err.stack || err);
    res.status(500).json({ error: err.message || 'Gagal memuat daftar proforma' });
  }
});

// GET /api/proformas/:pk/print-data — Data cetak proforma
app.get('/api/proformas/:pk/print-data', authenticateToken, async (req, res) => {
  try {
    const { pk } = req.params;
    const todayStr = getTodayWITA();

    const pfRes = await pool.query(
      `SELECT p.*, c.name AS customer_name, c.address AS customer_address,
              c.phone AS customer_phone, c.no_hp_2 AS customer_no_hp_2,
              pt.name AS payment_type_name,
              CASE
                WHEN p.status = 'aktif' AND p.berlaku_hingga < ? THEN 'kedaluwarsa'
                ELSE p.status
              END AS display_status
       FROM proformas p
       LEFT JOIN customers c ON p.customer_id = c.id
       LEFT JOIN payment_types pt ON p.payment_type_id = pt.id
       WHERE p.pk = ?`,
      [todayStr, pk]
    );
    if (pfRes.rows.length === 0) return res.status(404).json({ error: 'Proforma tidak ditemukan' });

    const pf = pfRes.rows[0];

    const itemsRes = await pool.query(
      `SELECT pi.*
       FROM proforma_items pi
       WHERE pi.proforma_pk = ?
       ORDER BY pi.id`,
      [pk]
    );

    const settingsRes = await pool.query(
      `SELECT \`key\`, value FROM settings WHERE \`key\` IN
       ('company_name','company_phone','company_email','company_address','company_logo','ppn_enabled','pajak_default')`
    );
    const company = {};
    settingsRes.rows.forEach(r => {
      if (r.key.startsWith('company_')) company[r.key.replace('company_', '')] = r.value;
    });

    const pfPhone1 = pf.customer_phone ? String(pf.customer_phone).trim() : '';
    const pfPhone2 = pf.customer_no_hp_2 ? String(pf.customer_no_hp_2).trim() : '';
    const pfChosenPhone = (pfPhone1 && pfPhone1 !== '-') ? pfPhone1 : ((pfPhone2 && pfPhone2 !== '-') ? pfPhone2 : (pfPhone1 || '-'));

    res.json({
      proforma: {
        pk: pf.pk,
        proforma_no: pf.proforma_no,
        order_date: formatDateStr(pf.order_date),    // tanggal order yg tersimpan, bukan hari cetak
        berlaku_hingga: formatDateStr(pf.berlaku_hingga),
        status: pf.status,
        display_status: pf.display_status,
        subtotal: parseFloat(pf.subtotal),
        discount: parseFloat(pf.discount),
        ppn_rate: parseFloat(pf.ppn_rate),
        ppn_amount: parseFloat(pf.ppn_amount),
        ppn_enabled: pf.ppn_enabled === 1 || pf.ppn_enabled === true,
        total: parseFloat(pf.total),
        payment_type_name: pf.payment_type_name || 'Tunai',
        payment_type_id: pf.payment_type_id,
        customer_id: pf.customer_id,
        revisi: parseInt(pf.revisi || 0),
        sumber: pf.sumber || 'manual',
        invoice_id: pf.invoice_id
      },
      customer: {
        name: pf.customer_name || 'Pelanggan Umum',
        address: pf.customer_address || '',
        phone: pfChosenPhone
      },
      // Items: NO fee fields (not exposed regardless of role — fee tidak tampil di cetakan proforma)
      items: itemsRes.rows.map(item => ({
        product_name: item.product_name_snapshot,
        unit_name: item.unit_name_snapshot || '-',
        quantity: parseFloat(item.quantity),
        price: parseFloat(item.price),
        total: parseFloat(item.subtotal_item)
      })),
      company
    });
  } catch (err) {
    console.error('[GET /api/proformas/:pk/print-data] Stack trace:', err.stack || err);
    res.status(500).json({ error: err.message || 'Gagal memuat data cetak proforma' });
  }
});

// GET /api/proformas/:pk/items — Item proforma (role-based sanitization: fee stripped for non-admin)
app.get('/api/proformas/:pk/items', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  try {
    const { pk } = req.params;
    const itemsRes = await pool.query(
      `SELECT pi.*
       FROM proforma_items pi
       WHERE pi.proforma_pk = ?
       ORDER BY pi.id`,
      [pk]
    );

    const rows = itemsRes.rows.map(row => {
      if (req.user.role !== 'admin') {
        const { customer_fee, fee_notes, cost_price_snapshot, ...rest } = row;
        return rest;
      }
      return row;
    });

    res.json(rows);
  } catch (err) {
    console.error('[GET /api/proformas/:pk/items] Stack trace:', err.stack || err);
    res.status(500).json({ error: err.message || 'Gagal memuat item proforma' });
  }
});

// PUT /api/proformas/:pk — Edit / Update proforma (Item 3)
app.put('/api/proformas/:pk', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const { pk } = req.params;
  const { revisi, order_date, berlaku_hingga, payment_type_id, items, discount, ppn_enabled } = req.body;
  const userId = req.user.id;

  // 1. Validasi input dasar
  let cleanOrderDate = '';
  try {
    cleanOrderDate = validateOrderDate(order_date, 7);
  } catch (dateErr) {
    return res.status(dateErr.status || 400).json({ error: dateErr.message });
  }

  let cleanBerlaku = String(berlaku_hingga || '').split('T')[0].trim();
  if (!cleanBerlaku || !/^\d{4}-\d{2}-\d{2}$/.test(cleanBerlaku)) {
    const berlakuHari = parseInt(await getSetting('proforma_berlaku_hari', '7'), 10);
    const [oy, om, od] = cleanOrderDate.split('-').map(Number);
    const berlakuDt = new Date(oy, om - 1, od + berlakuHari);
    cleanBerlaku = `${berlakuDt.getFullYear()}-${String(berlakuDt.getMonth() + 1).padStart(2, '0')}-${String(berlakuDt.getDate()).padStart(2, '0')}`;
  } else if (cleanBerlaku < cleanOrderDate) {
    return res.status(400).json({ error: 'Masa berlaku tidak boleh lebih awal dari Tanggal Order.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Minimal harus ada 1 item produk dalam proforma.' });
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const q = parseFloat(it.quantity !== undefined ? it.quantity : it.qty);
    const p = parseFloat(it.price);
    if (isNaN(q) || q <= 0) {
      return res.status(400).json({ error: `Jumlah item baris ke-${i + 1} harus lebih dari 0.` });
    }
    if (isNaN(p) || p < 0) {
      return res.status(400).json({ error: `Harga item baris ke-${i + 1} tidak valid.` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Kunci proforma row untuk mencegah tabrakan / perubahan konkruen
    const pfRes = await client.query('SELECT * FROM proformas WHERE pk = ? FOR UPDATE', [pk]);
    if (pfRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Proforma tidak ditemukan.' });
    }
    const currentPf = pfRes.rows[0];

    // Status check: hanya proforma berstatus 'aktif' yang boleh diedit
    if (currentPf.status !== 'aktif') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Proforma sudah berstatus '${currentPf.status}' dan tidak bisa diedit.` });
    }

    // Tabrakan (Optimistic Concurrency Control): cek nilai revisi
    if (revisi !== undefined && revisi !== null && Number(revisi) !== Number(currentPf.revisi)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Proforma sudah diubah oleh pengguna lain, muat ulang halaman.' });
    }

    // Pelanggan tidak boleh berubah
    if (req.body.customer_id && req.body.customer_id !== currentPf.customer_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Pelanggan tidak boleh diubah pada proforma ini.' });
    }

    // 3. Ambil data fee item lama untuk preservasi fee jika diedit oleh non-admin
    const oldItemsRes = await client.query('SELECT * FROM proforma_items WHERE proforma_pk = ?', [pk]);
    const oldFeeMap = {};
    oldItemsRes.rows.forEach(oi => {
      if (oi.product_id) {
        oldFeeMap[oi.product_id] = {
          customer_fee: parseFloat(oi.customer_fee) || 0,
          fee_notes: oi.fee_notes || null,
          cost_price_snapshot: parseFloat(oi.cost_price_snapshot) || 0,
          unit: oi.unit_name_snapshot || '-'
        };
      }
    });

    // 4. Hitung ulang total di SERVER
    const prodIds = items.map(it => it.id || it.product_id).filter(Boolean);
    let dbProducts = [];
    if (prodIds.length > 0) {
      const placeholders = prodIds.map(() => '?').join(',');
      const prRes = await client.query(
        `SELECT p.id, p.name, pu.name AS unit_name, p.cost_price, p.sell_price
         FROM products p
         LEFT JOIN product_units pu ON p.unit_id = pu.id
         WHERE p.id IN (${placeholders})`,
        prodIds
      );
      dbProducts = prRes.rows;
    }
    const prodMap = {};
    dbProducts.forEach(p => { prodMap[p.id] = p; });

    let subtotal = 0;
    const finalItems = [];

    for (const it of items) {
      const pid = it.id || it.product_id;
      const qty = parseFloat(it.quantity !== undefined ? it.quantity : it.qty);
      const price = parseFloat(it.price);
      const itemSubtotal = Math.round(qty * price * 100) / 100;
      subtotal += itemSubtotal;

      const dbP = prodMap[pid] || {};
      const oldFee = oldFeeMap[pid];

      let custFee = 0;
      let fNotes = null;
      let costSnap = parseFloat(dbP.cost_price) || (oldFee ? oldFee.cost_price_snapshot : 0);
      let prodName = it.product_name_snapshot || it.name || dbP.name || 'Produk';
      let unitName = it.unit_name_snapshot || it.unit || dbP.unit_name || (oldFee ? oldFee.unit : '-');

      if (req.user.role === 'admin') {
        custFee = parseFloat(it.customer_fee !== undefined ? it.customer_fee : it.fee) || 0;
        fNotes = (it.fee_notes !== undefined ? it.fee_notes : it.feeNotes) || null;
      } else {
        // Non-admin: jika item sudah ada sebelumnya, pertahankan fee & notes!
        if (oldFee) {
          custFee = oldFee.customer_fee;
          fNotes = oldFee.fee_notes;
          costSnap = oldFee.cost_price_snapshot;
        } else {
          custFee = 0;
          fNotes = null;
        }
      }

      finalItems.push({
        product_id: pid || null,
        product_name_snapshot: prodName,
        unit_name_snapshot: unitName,
        quantity: qty,
        price: price,
        subtotal_item: itemSubtotal,
        customer_fee: custFee,
        fee_notes: fNotes,
        cost_price_snapshot: costSnap
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const discNum = Math.min(subtotal, Math.max(0, parseFloat(discount) || 0));
    const dpp = Math.max(0, subtotal - discNum);
    const isPpn = ppn_enabled !== undefined
      ? (ppn_enabled === true || ppn_enabled === 'true' || ppn_enabled === 1)
      : (currentPf.ppn_enabled === 1 || currentPf.ppn_enabled === true);
    const ppnRate = isPpn ? (parseFloat(currentPf.ppn_rate) || 11.00) : 0.00;
    const ppnAmount = isPpn ? Math.round(dpp * (ppnRate / 100)) : 0;
    const total = dpp + ppnAmount;

    const paymentTypeId = payment_type_id || currentPf.payment_type_id;

    // 5. Ganti item atomik di dalam transaksi
    await client.query('DELETE FROM proforma_items WHERE proforma_pk = ?', [pk]);

    for (const fi of finalItems) {
      await client.query(
        `INSERT INTO proforma_items (
          proforma_pk, product_id, product_name_snapshot, unit_name_snapshot,
          quantity, price, subtotal_item, customer_fee, fee_notes, cost_price_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pk, fi.product_id, fi.product_name_snapshot, fi.unit_name_snapshot,
          fi.quantity, fi.price, fi.subtotal_item, fi.customer_fee, fi.fee_notes, fi.cost_price_snapshot
        ]
      );
    }

    // 6. Update proforma header
    const nextRevisi = Number(currentPf.revisi || 0) + 1;
    await client.query(
      `UPDATE proformas SET
        order_date = ?,
        berlaku_hingga = ?,
        payment_type_id = ?,
        subtotal = ?,
        discount = ?,
        ppn_rate = ?,
        ppn_amount = ?,
        ppn_enabled = ?,
        total = ?,
        revisi = ?,
        diubah_pada = NOW(),
        diubah_oleh = ?
       WHERE pk = ?`,
      [
        cleanOrderDate,
        cleanBerlaku,
        paymentTypeId,
        subtotal,
        discNum,
        ppnRate,
        ppnAmount,
        isPpn ? 1 : 0,
        total,
        nextRevisi,
        userId,
        pk
      ]
    );

    await client.query('COMMIT');
    console.log(`[Proforma Edit] PF ${currentPf.proforma_no} (PK ${pk}) updated to Rev.${nextRevisi} by user ${userId}`);

    res.json({
      success: true,
      pk: Number(pk),
      proforma_no: currentPf.proforma_no,
      revisi: nextRevisi,
      nextRevisi: nextRevisi
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /api/proformas/:pk] Stack trace:', err.stack || err);
    res.status(500).json({ error: err.message || 'Gagal menyimpan perubahan proforma.' });
  } finally {
    client.release();
  }
});

// PUT /api/proformas/:pk/cancel — Batalkan proforma
app.put('/api/proformas/:pk/cancel', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  try {
    const { pk } = req.params;
    const { alasan } = req.body;

    const pfRes = await pool.query('SELECT status FROM proformas WHERE pk = ?', [pk]);
    if (pfRes.rows.length === 0) return res.status(404).json({ error: 'Proforma tidak ditemukan' });
    const current = pfRes.rows[0].status;
    if (current !== 'aktif') {
      return res.status(400).json({ error: `Hanya proforma berstatus 'aktif' yang bisa dibatalkan. Status saat ini: ${current}` });
    }

    await pool.query(
      `UPDATE proformas SET status = 'dibatalkan', alasan_pembatalan = ? WHERE pk = ?`,
      [alasan || null, pk]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/proformas/:pk/extend — Perpanjang masa berlaku
app.put('/api/proformas/:pk/extend', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  try {
    const { pk } = req.params;
    const { berlaku_hingga } = req.body;

    if (!berlaku_hingga || !/^\d{4}-\d{2}-\d{2}$/.test(berlaku_hingga))
      return res.status(400).json({ error: 'berlaku_hingga harus format YYYY-MM-DD' });

    const pfRes = await pool.query('SELECT status FROM proformas WHERE pk = ?', [pk]);
    if (pfRes.rows.length === 0) return res.status(404).json({ error: 'Proforma tidak ditemukan' });
    if (pfRes.rows[0].status !== 'aktif')
      return res.status(400).json({ error: 'Hanya proforma aktif yang bisa diperpanjang' });

    await pool.query('UPDATE proformas SET berlaku_hingga = ? WHERE pk = ?', [berlaku_hingga, pk]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/proformas/:pk/convert — Konversi proforma menjadi invoice
app.post('/api/proformas/:pk/convert', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const { pk } = req.params;
  // order_date for the resulting invoice (user picks in modal, defaults to today)
  const { order_date: invoiceOrderDate, payment_type_id: overridePaymentTypeId, force_expired } = req.body;
  const userId = req.user.id;
  const todayWITA = getTodayWITA();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the proforma row to prevent concurrent conversion
    const pfRes = await client.query(
      `SELECT p.*, c.name AS customer_name, pt.name AS payment_type_name
       FROM proformas p
       LEFT JOIN customers c ON p.customer_id = c.id
       LEFT JOIN payment_types pt ON p.payment_type_id = pt.id
       WHERE p.pk = ? FOR UPDATE`,
      [pk]
    );
    if (pfRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Proforma tidak ditemukan' });
    }

    const pf = pfRes.rows[0];

    // Prevent double conversion
    if (pf.status !== 'aktif') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Proforma berstatus '${pf.status}', tidak bisa dikonversi` });
    }

    // Check if expired and force not set
    const berlakuStr = formatDateStr(pf.berlaku_hingga);
    const isExpired = berlakuStr < todayWITA;
    if (isExpired && !force_expired) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Proforma sudah kedaluwarsa.',
        expired: true,
        berlaku_hingga: berlakuStr
      });
    }

    // Fetch items
    const itemsRes = await client.query(
      `SELECT * FROM proforma_items WHERE proforma_pk = ? ORDER BY id`,
      [pk]
    );
    const pfItems = itemsRes.rows;

    // --- Stock check ---
    const stockErrors = [];
    for (const item of pfItems) {
      if (!item.product_id) continue;
      const stockRes = await client.query('SELECT stock, name FROM products WHERE id = ?', [item.product_id]);
      if (stockRes.rows.length === 0) continue;
      const available = parseFloat(stockRes.rows[0].stock);
      const needed = parseFloat(item.quantity);
      if (available < needed) {
        stockErrors.push({
          product_name: item.product_name_snapshot,
          available,
          needed
        });
      }
    }
    if (stockErrors.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Stok tidak mencukupi untuk beberapa produk.',
        stock_errors: stockErrors
      });
    }

    // --- Price change check (warning only, use snapshot) ---
    const priceWarnings = [];
    for (const item of pfItems) {
      if (!item.product_id) continue;
      const priceRes = await client.query('SELECT sell_price FROM products WHERE id = ?', [item.product_id]);
      if (priceRes.rows.length === 0) continue;
      const currentPrice = parseFloat(priceRes.rows[0].sell_price);
      const snapshotPrice = parseFloat(item.price);
      if (Math.abs(currentPrice - snapshotPrice) > 0.001) {
        priceWarnings.push({
          product_name: item.product_name_snapshot,
          snapshot_price: snapshotPrice,
          current_price: currentPrice,
          diff: currentPrice - snapshotPrice
        });
      }
    }

    // Determine invoice date (Masalah 2: validasi +7 hari)
    let invoiceDateStr;
    if (invoiceOrderDate) {
      try {
        invoiceDateStr = validateOrderDate(invoiceOrderDate, 7);
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.status || 400).json({ error: e.message });
      }
    } else {
      invoiceDateStr = todayWITA;
    }

    // Determine payment type (use proforma's unless overridden)
    const finalPaymentTypeId = overridePaymentTypeId || pf.payment_type_id;

    // --- Build items for invoice creation (use SNAPSHOT prices) ---
    const invoiceItems = pfItems.map(item => ({
      id: item.product_id,
      quantity: parseFloat(item.quantity),
      price: parseFloat(item.price),        // snapshot price
      customer_fee: req.user.role === 'admin' ? parseFloat(item.customer_fee || 0) : 0,
      fee_notes: req.user.role === 'admin' ? (item.fee_notes || null) : null
    }));

    // --- Reuse exact same calculation as invoice creation ---
    const settingsRes = await client.query(
      `SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`
    );
    const settingsMap = {};
    settingsRes.rows.forEach(r => { settingsMap[r.key] = r.value; });
    const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1';
    const pajakDefault = parseFloat(settingsMap['pajak_default'] || 11);

    let subtotal = 0;
    invoiceItems.forEach(item => { subtotal += item.price * item.quantity; });
    const diskon = parseFloat(pf.discount || 0);
    const taxAmount = ppnEnabled ? Math.round((subtotal - diskon) * (pajakDefault / 100)) : 0;
    const finalTotal = subtotal - diskon + taxAmount;

    const instant = await isInstantPayment(finalPaymentTypeId);
    const effectivePaid = instant ? finalTotal : 0;
    const status = instant ? 'Lunas' : 'Belum Lunas';
    const paidDate = status === 'Lunas' ? invoiceDateStr : null;

    // Calculate due date for credit
    let finalDueDate = null;
    if (!instant) {
      const ptRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [finalPaymentTypeId]);
      const ptName = ptRes.rows[0]?.name || '';
      const match = ptName.match(/(kredit|credit)\s+(\d+)\s+hari/i);
      if (match && match[2]) {
        const days = parseInt(match[2], 10);
        const [iy, im, id_] = invoiceDateStr.split('-').map(Number);
        const dt = new Date(iy, im - 1, id_ + days);
        finalDueDate = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      }
    }

    const invoiceId = await generateInvoiceId(client, invoiceDateStr);

    await client.query(
      `INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount,
        payment_type_id, due_date, paid_date, status, user_id, is_outstanding_import)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [invoiceId, invoiceDateStr, pf.customer_id, subtotal, diskon, taxAmount, finalTotal,
       effectivePaid, finalPaymentTypeId, finalDueDate, paidDate, status, userId]
    );

    // Insert invoice items & reduce stock
    for (const item of invoiceItems) {
      if (!item.id) continue;
      const curRes = await client.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.id]);
      const curStock = parseFloat(curRes.rows[0]?.stock || 0);
      const nextStock = curStock - item.quantity;
      await client.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
      const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [item.id]);
      const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || 0);
      await client.query(
        `INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [Date.now().toString() + Math.floor(Math.random() * 1000), invoiceId, item.id,
         item.quantity, item.price, costSnapshot, item.customer_fee || 0, item.fee_notes || null]
      );
      await recordStockMove(client, {
        product_id: item.id,
        tanggal: invoiceDateStr ? invoiceDateStr + ' 12:00:00' : null,
        tipe: 'penjualan',
        ref_type: 'invoice',
        ref_id: invoiceId,
        ref_no: invoiceId,
        qty_masuk: 0,
        qty_keluar: item.quantity,
        qty_sebelum: curStock,
        qty_sesudah: nextStock,
        keterangan: `Penjualan Konversi Proforma ${invoiceId}`,
        created_by: userId
      });
    }

    // Cash transaction for instant payment
    if (effectivePaid > 0) {
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [finalPaymentTypeId]);
      const method = ptNameRes.rows[0]?.name || 'Transfer Bank';
      await client.query(
        `INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, payment_type_id, user_id, status)
         VALUES (?, ?, 'IN', 'Penjualan', ?, ?, ?, ?, ?, ?, 'active')`,
        [ctId, invoiceDateStr, `Pembayaran Invoice ${invoiceId}`, effectivePaid, method, invoiceId, finalPaymentTypeId, userId]
      );
    }

    // Mark proforma as converted
    await client.query(
      `UPDATE proformas SET status = 'dikonversi', invoice_id = ? WHERE pk = ?`,
      [invoiceId, pk]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      invoiceId,
      price_warnings: priceWarnings.length > 0 ? priceWarnings : undefined
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Proforma Convert] Error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});


// POST /api/invoices/:id/proforma — Buat proforma dari invoice (Item 4)
app.post('/api/invoices/:id/proforma', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const { id: invoiceId } = req.params;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Cek invoice ada dan tidak dibatalkan
    const invRes = await client.query(
      `SELECT si.*, c.name AS customer_name, pt.name AS payment_type_name
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
       WHERE si.id = ?`,
      [invoiceId]
    );
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Invoice ${invoiceId} tidak ditemukan.` });
    }
    const inv = invRes.rows[0];
    const statusLower = (inv.status || '').toLowerCase();
    if (statusLower === 'batal' || statusLower === 'cancel') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Invoice ${invoiceId} sudah dibatalkan, tidak bisa dibuatkan proforma.` });
    }

    // 2. Cek apakah sudah ada proforma dari invoice ini
    const existRes = await client.query(
      `SELECT p.pk, p.proforma_no, p.status FROM proformas p WHERE p.invoice_id = ?`,
      [invoiceId]
    );
    if (existRes.rows.length > 0) {
      const existing = existRes.rows[0];
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        sudah_ada: true,
        proforma: { pk: existing.pk, proforma_no: existing.proforma_no, status: existing.status }
      });
    }

    // 3. Ambil items dari invoice
    const itemsRes = await client.query(
      `SELECT ii.product_id, ii.quantity, ii.price, ii.customer_fee, ii.fee_notes, ii.cost_price_snapshot,
              COALESCE(p.name, ii.product_id) AS product_name_snapshot,
              COALESCE(pu.name, '-') AS unit_name_snapshot
       FROM invoice_items ii
       LEFT JOIN products p ON ii.product_id = p.id
       LEFT JOIN product_units pu ON p.unit_id = pu.id
       WHERE ii.invoice_id = ?`,
      [invoiceId]
    );
    const items = itemsRes.rows;
    if (items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Invoice ${invoiceId} tidak memiliki item.` });
    }

    // 4. Kalkulasi ulang amounts dari invoice (ikuti invoice asli)
    const subtotal = items.reduce((s, it) => s + parseFloat(it.price) * parseFloat(it.quantity), 0);
    const diskon = parseFloat(inv.discount || 0);
    const ppnRate = parseFloat(inv.tax && inv.subtotal ? (inv.tax / (inv.subtotal - diskon) * 100) : 11) || 11;
    const ppnAmount = parseFloat(inv.tax || 0);
    const ppnEnabled = ppnAmount > 0 ? 1 : 0;
    const total = parseFloat(inv.total || (subtotal - diskon + ppnAmount));

    // 5. Nomor proforma (ikuti tanggal invoice)
    const orderDateStr = formatDateStr(inv.date) || getTodayWITA();
    const proformaNo = await generateProformaNo(client, orderDateStr);

    // 6. berlaku_hingga = order_date (proforma dari invoice = snapshot, tidak punya masa berlaku)
    const berlakuStr = orderDateStr;

    // 7. Insert proforma
    await client.query(
      `INSERT INTO proformas (proforma_no, customer_id, order_date, berlaku_hingga, payment_type_id,
        subtotal, discount, ppn_rate, ppn_amount, ppn_enabled, total, status, user_id, invoice_id, sumber)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dikonversi', ?, ?, 'dari_invoice')`,
      [proformaNo, inv.customer_id, orderDateStr, berlakuStr, inv.payment_type_id,
       subtotal, diskon, ppnRate, ppnAmount, ppnEnabled, total, userId, invoiceId]
    );
    const pkRes = await client.query('SELECT LAST_INSERT_ID() AS pk');
    const proformaPk = Number(pkRes.rows[0].pk);

    // 8. Insert items (salin dari invoice, termasuk fee — disimpan di DB, tidak ditampilkan di cetakan)
    for (const item of items) {
      const qty = parseFloat(item.quantity || 0);
      const price = parseFloat(item.price || 0);
      const subtotalItem = qty * price;
      await client.query(
        `INSERT INTO proforma_items (proforma_pk, product_id, product_name_snapshot, unit_name_snapshot,
          quantity, price, subtotal_item, customer_fee, fee_notes, cost_price_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [proformaPk, item.product_id, item.product_name_snapshot, item.unit_name_snapshot,
         qty, price, subtotalItem, parseFloat(item.customer_fee || 0), item.fee_notes || null, parseFloat(item.cost_price_snapshot || 0)]
      );
    }

    await client.query('COMMIT');
    console.log(`[Proforma dari Invoice] PF ${proformaNo} (PK ${proformaPk}) dibuat dari Invoice ${invoiceId} oleh user ${userId}`);
    res.json({
      success: true,
      sudah_ada: false,
      proforma: { pk: proformaPk, proforma_no: proformaNo, status: 'dikonversi' }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/invoices/:id/proforma] Error:', err.stack || err);
    res.status(500).json({ error: err.message || 'Gagal membuat proforma dari invoice.' });
  } finally {
    client.release();
  }
});
// ─── END PROFORMA MODULE ───────────────────────────────────────────────────────


// =========================================================================
// BATCH B ROUTES: RETUR PENJUALAN, RETUR PEMBELIAN, STOCK MOVE
// =========================================================================

/**
 * POST /api/invoices/:id/returns
 * Membuat Retur Penjualan dalam satu transaksi DB
 */
app.post('/api/invoices/:id/returns', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'owner'), async (req, res) => {
  const invId = req.params.id;
  const { date, reason, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Minimal satu item harus dipilih untuk retur' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Alasan retur wajib diisi' });
  }

  const returnDate = date ? String(date).split('T')[0] : getTodayWITA();
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch & lock invoice
    const invRes = await client.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [invId]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    const inv = invRes.rows[0];
    if (inv.status === 'Cancel' || inv.status === 'Batal') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice yang sudah dibatalkan tidak dapat diretur' });
    }

    // 2. Fetch original invoice items & existing returns for this invoice
    const origItemsRes = await client.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [invId]);
    const origMap = {};
    for (const row of origItemsRes.rows) {
      origMap[row.product_id] = row;
    }

    const prevReturnsRes = await client.query(`
      SELECT sri.product_id, SUM(sri.quantity) as returned_qty
      FROM sales_return_items sri
      JOIN sales_returns sr ON sr.id = sri.return_id
      WHERE sr.invoice_id = ?
      GROUP BY sri.product_id
    `, [invId]);
    const prevReturnedMap = {};
    for (const r of prevReturnsRes.rows) {
      prevReturnedMap[r.product_id] = parseFloat(r.returned_qty || 0);
    }

    // Proportional factors from original invoice — gunakan tax dari invoice
    // tapi cek settings ppn_enabled saat ini untuk memastikan konsistensi
    const settingsRetRes = await pool.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsRetMap = {};
    settingsRetRes.rows.forEach(r => { settingsRetMap[r.key] = r.value; });
    const ppnEnabledNow = settingsRetMap['ppn_enabled'] === 'true' || settingsRetMap['ppn_enabled'] === '1';

    const invSubtotal = parseFloat(inv.subtotal || 0);
    const invDiscount = parseFloat(inv.discount || 0);
    const discountRatio = invSubtotal > 0 ? (invDiscount / invSubtotal) : 0;
    const invDpp = invSubtotal - invDiscount;
    // Hanya hitung tax ratio jika ppn_enabled aktif di pengaturan saat ini
    const invTax = ppnEnabledNow ? parseFloat(inv.tax || 0) : 0;
    const taxRatio = (ppnEnabledNow && invDpp > 0) ? (invTax / invDpp) : 0;

    let totalRefund = 0;
    const itemsToProcess = [];

    for (const it of items) {
      const pId = it.product_id || it.productId || it.id;
      const qty = parseFloat(it.quantity || it.qty || 0);
      const condition = it.condition_type || it.condition || 'kembali_ke_stok';

      if (qty <= 0) continue; // skip 0 qty items

      const orig = origMap[pId];
      if (!orig) {
        throw new Error(`Produk dengan ID ${pId} bukan bagian dari invoice ${invId}`);
      }

      const origQty = parseFloat(orig.quantity || 0);
      const alreadyReturned = prevReturnedMap[pId] || 0;
      const maxReturnable = Math.max(0, origQty - alreadyReturned);

      if (qty > maxReturnable) {
        throw new Error(`Qty retur untuk produk ${pId} melebihi sisa yang bisa diretur (maks: ${maxReturnable}, diminta: ${qty})`);
      }

      const origPrice = parseFloat(orig.price || 0);
      const snapshotCost = parseFloat(orig.cost_price_snapshot || 0);
      const itemSubtotal = origPrice * qty;

      // Net proportional refund
      const netAfterDiscount = itemSubtotal * (1 - discountRatio);
      const itemRefund = netAfterDiscount * (1 + taxRatio);

      totalRefund += itemRefund;

      itemsToProcess.push({
        product_id: pId,
        quantity: qty,
        condition_type: condition,
        price: origPrice,
        cost_price_snapshot: snapshotCost,
        subtotal: itemSubtotal,
        refund_amount: itemRefund
      });
    }

    if (itemsToProcess.length === 0) {
      throw new Error('Minimal satu item harus memiliki qty retur >= 1');
    }

    // 3. Generate Return ID
    const returnId = await generateSalesReturnId(client, returnDate);

    // 4. Financial allocation (Piutang vs Deposit)
    const invTotal = parseFloat(inv.total || 0);
    const invPaid = parseFloat(inv.paid_amount || 0);
    const currentReturnAmount = parseFloat(inv.return_amount || 0);
    const remainingPiutang = Math.max(0, invTotal - invPaid - currentReturnAmount);

    let piutangDeduction = 0;
    let customerDepositAmount = 0;

    if (totalRefund <= remainingPiutang) {
      piutangDeduction = totalRefund;
      customerDepositAmount = 0;
    } else {
      piutangDeduction = remainingPiutang;
      customerDepositAmount = totalRefund - remainingPiutang;
    }

    // Update customer deposit if excess refund
    if (customerDepositAmount > 0 && inv.customer_id) {
      await client.query('UPDATE customers SET deposit = deposit + ? WHERE id = ?', [customerDepositAmount, inv.customer_id]);
    }

    // Update invoice return_amount & status
    const newTotalReturn = currentReturnAmount + piutangDeduction;
    const isNowFullyPaid = (invPaid + newTotalReturn) >= (invTotal - 0.01);
    const updatedStatus = isNowFullyPaid ? 'Lunas' : inv.status;

    await client.query(
      'UPDATE sales_invoices SET return_amount = ?, status = ? WHERE id = ?',
      [newTotalReturn, updatedStatus, invId]
    );

    // 5. Insert sales_returns header
    await client.query(`
      INSERT INTO sales_returns (
        id, invoice_id, customer_id, date, total_refund,
        piutang_deduction, customer_deposit_amount, reason, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      returnId, invId, inv.customer_id, returnDate, totalRefund,
      piutangDeduction, customerDepositAmount, reason.trim(), userId
    ]);

    // 6. Process items (Stock & Stock Move)
    for (const item of itemsToProcess) {
      await client.query(`
        INSERT INTO sales_return_items (
          return_id, product_id, quantity, condition_type,
          price, cost_price_snapshot, subtotal, refund_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        returnId, item.product_id, item.quantity, item.condition_type,
        item.price, item.cost_price_snapshot, item.subtotal, item.refund_amount
      ]);

      const prodRes = await client.query('SELECT id, name, stock, cost_price FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      const curStock = parseFloat(prodRes.rows[0]?.stock || 0);
      const curCost = parseFloat(prodRes.rows[0]?.cost_price || 0);

      if (item.condition_type === 'kembali_ke_stok') {
        const nextStock = curStock + item.quantity;
        // Weighted average reversal using original cost snapshot
        let newCost = curCost;
        if (curStock > 0 && nextStock > 0) {
          newCost = ((curStock * curCost) + (item.quantity * item.cost_price_snapshot)) / nextStock;
        } else {
          newCost = item.cost_price_snapshot > 0 ? item.cost_price_snapshot : curCost;
        }
        await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [nextStock, newCost, item.product_id]);

        await recordStockMove(client, {
          product_id: item.product_id,
          tanggal: returnDate + ' 12:00:00',
          tipe: 'retur_penjualan',
          ref_type: 'sales_return',
          ref_id: returnId,
          ref_no: invId,
          qty_masuk: item.quantity,
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: nextStock,
          keterangan: `Retur Penjualan ${returnId} (Invoice ${invId}): ${reason.trim()}`,
          created_by: userId
        });
      } else {
        // Kondisi rusak: stok tidak bertambah, catat stock_moves tipe retur_penjualan_rusak
        await recordStockMove(client, {
          product_id: item.product_id,
          tanggal: returnDate + ' 12:00:00',
          tipe: 'retur_penjualan_rusak',
          ref_type: 'sales_return',
          ref_id: returnId,
          ref_no: invId,
          qty_masuk: 0,
          qty_keluar: 0,
          qty_sebelum: curStock,
          qty_sesudah: curStock,
          keterangan: `Retur Penjualan Rusak ${returnId} (Invoice ${invId}) - tidak kembali ke stok: ${reason.trim()}`,
          created_by: userId
        });
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      return_id: returnId,
      returnId: returnId,
      total_refund: totalRefund,
      piutang_deduction: piutangDeduction,
      customer_deposit_amount: customerDepositAmount,
      invoice_status: updatedStatus
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/invoices/:id/returns-form
 * Data untuk membuka form retur penjualan: invoice header + items + maxReturnable per item
 */
app.get('/api/invoices/:id/returns-form', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'owner'), async (req, res) => {
  const invId = req.params.id;
  try {
    // Fetch invoice header
    const invRes = await pool.query(`
      SELECT si.*, c.name as customer_name, c.deposit as customer_deposit
      FROM sales_invoices si
      LEFT JOIN customers c ON c.id = si.customer_id
      WHERE si.id = ?
    `, [invId]);
    if (invRes.rows.length === 0) return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    const inv = invRes.rows[0];

    // Fetch invoice items
    const itemsRes = await pool.query(`
      SELECT ii.product_id, ii.quantity, ii.price,
             p.name as product_name, p.sku as product_sku, p.stock as current_stock
      FROM invoice_items ii
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = ?
    `, [invId]);

    // Fetch already returned qty per product for this invoice
    const retRes = await pool.query(`
      SELECT sri.product_id, SUM(sri.quantity) as returned_qty
      FROM sales_return_items sri
      JOIN sales_returns sr ON sr.id = sri.return_id
      WHERE sr.invoice_id = ?
      GROUP BY sri.product_id
    `, [invId]);
    const retMap = {};
    retRes.rows.forEach(r => { retMap[r.product_id] = parseFloat(r.returned_qty || 0); });

    const items = itemsRes.rows.map(it => {
      const returned = retMap[it.product_id] || 0;
      return {
        product_id: it.product_id,
        product_name: it.product_name || it.product_id,
        product_sku: it.product_sku || '',
        invoice_qty: parseFloat(it.quantity || 0),
        returned_qty: returned,
        maxReturnable: Math.max(0, parseFloat(it.quantity || 0) - returned),
        price: parseFloat(it.price || 0)
      };
    });

    // Remaining debt (sisa piutang)
    const totalInv = parseFloat(inv.total || 0);
    const paidAmt = parseFloat(inv.paid_amount || 0);
    const returnAmt = parseFloat(inv.return_amount || 0);
    const remainingDebt = Math.max(0, totalInv - paidAmt - returnAmt);

    // Fetch settings for PPN
    const settingsRes = await pool.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsMap = {};
    settingsRes.rows.forEach(r => { settingsMap[r.key] = r.value; });
    const ppnEnabled = settingsMap['ppn_enabled'] === 'true' || settingsMap['ppn_enabled'] === '1' || settingsMap['ppn_enabled'] === true;

    res.json({
      invoice: {
        id: inv.id,
        date: formatDateStr(inv.date),
        customer_name: inv.customer_name || '-',
        status: inv.status || '',
        subtotal: parseFloat(inv.subtotal || 0),
        discount: parseFloat(inv.discount || 0),
        tax: ppnEnabled ? parseFloat(inv.tax || 0) : 0,
        ppn_enabled: ppnEnabled,
        total: totalInv,
        paid_amount: paidAmt,
        return_amount: returnAmt
      },
      items,
      remainingDebt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/purchases/:id/returns-form
 * Data untuk membuka form retur pembelian: PO header + items + maxReturnable per item
 */
app.get('/api/purchases/:id/returns-form', authenticateToken, authorizeRoles('admin', 'gudang', 'finance', 'owner'), async (req, res) => {
  const poId = req.params.id;
  try {
    // Fetch PO header
    const poRes = await pool.query(`
      SELECT po.*, v.name as vendor_name, v.deposit as vendor_deposit
      FROM purchase_orders po
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.id = ?
    `, [poId]);
    if (poRes.rows.length === 0) return res.status(404).json({ error: 'Purchase Order tidak ditemukan' });
    const po = poRes.rows[0];

    // Fetch PO items
    const itemsRes = await pool.query(`
      SELECT poi.product_id, poi.quantity, poi.cost,
             p.name as product_name, p.sku as product_sku, p.stock as current_stock
      FROM purchase_order_items poi
      LEFT JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = ?
    `, [poId]);

    // Fetch already returned qty per product for this PO
    const retRes = await pool.query(`
      SELECT pri.product_id, SUM(pri.quantity) as returned_qty
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      WHERE pr.purchase_order_id = ?
      GROUP BY pri.product_id
    `, [poId]);
    const retMap = {};
    retRes.rows.forEach(r => { retMap[r.product_id] = parseFloat(r.returned_qty || 0); });

    const items = itemsRes.rows.map(it => {
      const returned = retMap[it.product_id] || 0;
      return {
        product_id: it.product_id,
        product_name: it.product_name || it.product_id,
        product_sku: it.product_sku || '',
        purchase_qty: parseFloat(it.quantity || 0),
        returned_qty: returned,
        maxReturnable: Math.max(0, parseFloat(it.quantity || 0) - returned),
        cost: parseFloat(it.cost || 0),
        current_stock: parseFloat(it.current_stock || 0)
      };
    });

    const totalPO = parseFloat(po.total || 0);
    const paidAmt = parseFloat(po.paid_amount || 0);
    const returnAmt = parseFloat(po.return_amount || 0);
    const remainingDebt = Math.max(0, totalPO - paidAmt - returnAmt);

    const settingsPoFormRes = await pool.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsPoFormMap = {};
    settingsPoFormRes.rows.forEach(r => { settingsPoFormMap[r.key] = r.value; });
    const ppnEnabledPoForm = settingsPoFormMap['ppn_enabled'] === 'true' || settingsPoFormMap['ppn_enabled'] === '1' || settingsPoFormMap['ppn_enabled'] === true;

    res.json({
      purchase: {
        id: po.id,
        date: formatDateStr(po.date),
        vendor_name: po.vendor_name || '-',
        status: po.status || '',
        subtotal: parseFloat(po.subtotal || 0),
        discount: parseFloat(po.discount || 0),
        tax: ppnEnabledPoForm ? parseFloat(po.tax || 0) : 0,
        ppn_enabled: ppnEnabledPoForm,
        total: totalPO,
        paid_amount: paidAmt,
        return_amount: returnAmt
      },
      items,
      remainingDebt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/invoices/:id/returns
 * Mengambil riwayat retur untuk satu invoice tertentu
 */
app.get('/api/invoices/:id/returns', authenticateToken, async (req, res) => {
  const invId = req.params.id;
  const role = (req.user?.role || 'kasir').toLowerCase();
  const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

  try {
    const returnsRes = await pool.query(`
      SELECT sr.*, u.name as user_name
      FROM sales_returns sr
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE sr.invoice_id = ?
      ORDER BY sr.date DESC, sr.created_at DESC
    `, [invId]);

    const result = [];
    for (const r of returnsRes.rows) {
      const itemsRes = await pool.query(`
        SELECT sri.*, p.name as product_name, p.sku
        FROM sales_return_items sri
        LEFT JOIN products p ON p.id = sri.product_id
        WHERE sri.return_id = ?
      `, [r.id]);

      result.push({
        id: r.id,
        invoice_id: r.invoice_id,
        customer_id: r.customer_id,
        date: formatDateStr(r.date),
        reason: r.reason,
        user_name: r.user_name || '-',
        ...(canSeeFinance ? {
          total_refund: parseFloat(r.total_refund || 0),
          piutang_deduction: parseFloat(r.piutang_deduction || 0),
          customer_deposit_amount: parseFloat(r.customer_deposit_amount || 0),
        } : {}),
        items: itemsRes.rows.map(it => ({
          product_id: it.product_id,
          product_name: it.product_name,
          sku: it.sku,
          quantity: parseFloat(it.quantity || 0),
          condition_type: it.condition_type,
          ...(canSeeFinance ? {
            price: parseFloat(it.price || 0),
            subtotal: parseFloat(it.subtotal || 0),
            refund_amount: parseFloat(it.refund_amount || 0)
          } : {})
        }))
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/purchases/:id/returns
 * Membuat Retur Pembelian dalam satu transaksi DB
 */
app.post('/api/purchases/:id/returns', authenticateToken, authorizeRoles('admin', 'gudang', 'finance', 'owner'), async (req, res) => {
  const poId = req.params.id;
  const { date, reason, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Minimal satu item harus dipilih untuk retur' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Alasan retur wajib diisi' });
  }

  const returnDate = date ? String(date).split('T')[0] : getTodayWITA();
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch & lock PO
    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (poRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase Order tidak ditemukan' });
    }
    const po = poRes.rows[0];
    if (po.status === 'Batal') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Purchase Order yang sudah dibatalkan tidak dapat diretur' });
    }

    // 2. Fetch original items & previous returns
    const origItemsRes = await client.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
    const origMap = {};
    for (const row of origItemsRes.rows) {
      origMap[row.product_id] = row;
    }

    const prevReturnsRes = await client.query(`
      SELECT pri.product_id, SUM(pri.quantity) as returned_qty
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      WHERE pr.purchase_order_id = ?
      GROUP BY pri.product_id
    `, [poId]);
    const prevReturnedMap = {};
    for (const r of prevReturnsRes.rows) {
      prevReturnedMap[r.product_id] = parseFloat(r.returned_qty || 0);
    }

    // Fetch settings for PPN
    const settingsPoRes = await pool.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN ('ppn_enabled', 'pajak_default')`);
    const settingsPoMap = {};
    settingsPoRes.rows.forEach(r => { settingsPoMap[r.key] = r.value; });
    const ppnEnabledPo = settingsPoMap['ppn_enabled'] === 'true' || settingsPoMap['ppn_enabled'] === '1' || settingsPoMap['ppn_enabled'] === true;

    const poSubtotal = parseFloat(po.subtotal || 0);
    const poDiscount = parseFloat(po.discount || 0);
    const discountRatio = poSubtotal > 0 ? (poDiscount / poSubtotal) : 0;
    const poDpp = poSubtotal - poDiscount;
    const poTax = ppnEnabledPo ? parseFloat(po.tax || 0) : 0;
    const taxRatio = (ppnEnabledPo && poDpp > 0) ? (poTax / poDpp) : 0;

    let totalRefund = 0;
    const itemsToProcess = [];

    for (const it of items) {
      const pId = it.product_id || it.productId || it.id;
      const qty = parseFloat(it.quantity || it.qty || 0);

      if (qty <= 0) continue;

      const orig = origMap[pId];
      if (!orig) {
        throw new Error(`Produk dengan ID ${pId} bukan bagian dari PO ${poId}`);
      }

      const origQty = parseFloat(orig.quantity || 0);
      const alreadyReturned = prevReturnedMap[pId] || 0;
      const maxReturnable = Math.max(0, origQty - alreadyReturned);

      if (qty > maxReturnable) {
        throw new Error(`Qty retur untuk produk ${pId} melebihi sisa yang bisa diretur (maks: ${maxReturnable}, diminta: ${qty})`);
      }

      // Check current stock sufficiency
      const prodRes = await client.query('SELECT id, name, stock, cost_price FROM products WHERE id = ? FOR UPDATE', [pId]);
      if (prodRes.rows.length === 0) {
        throw new Error(`Produk ${pId} tidak ditemukan`);
      }
      const curStock = parseFloat(prodRes.rows[0].stock || 0);
      if (curStock < qty) {
        throw new Error(`Stok produk "${prodRes.rows[0].name}" tidak mencukupi untuk retur pembelian (dibutuhkan ${qty}, stok saat ini: ${curStock})`);
      }

      const origCost = parseFloat(orig.cost || 0);
      const itemSubtotal = origCost * qty;
      const netAfterDiscount = itemSubtotal * (1 - discountRatio);
      const itemRefund = netAfterDiscount * (1 + taxRatio);

      totalRefund += itemRefund;

      itemsToProcess.push({
        product_id: pId,
        quantity: qty,
        cost: origCost,
        subtotal: itemSubtotal,
        refund_amount: itemRefund,
        curStock,
        curCost: parseFloat(prodRes.rows[0].cost_price || 0)
      });
    }

    if (itemsToProcess.length === 0) {
      throw new Error('Minimal satu item harus memiliki qty retur >= 1');
    }

    // 3. Generate Return ID
    const returnId = await generatePurchaseReturnId(client, returnDate);

    // 4. Financial allocation (Hutang vs Deposit Vendor)
    const poTotal = parseFloat(po.total || 0);
    const poPaid = parseFloat(po.paid_amount || 0);
    const currentReturnAmount = parseFloat(po.return_amount || 0);
    const remainingHutang = Math.max(0, poTotal - poPaid - currentReturnAmount);

    let hutangDeduction = 0;
    let vendorDepositAmount = 0;

    if (totalRefund <= remainingHutang) {
      hutangDeduction = totalRefund;
      vendorDepositAmount = 0;
    } else {
      hutangDeduction = remainingHutang;
      vendorDepositAmount = totalRefund - remainingHutang;
    }

    // Update vendor deposit if excess refund
    if (vendorDepositAmount > 0 && po.vendor_id) {
      await client.query('UPDATE vendors SET deposit = deposit + ? WHERE id = ?', [vendorDepositAmount, po.vendor_id]);
    }

    // Update PO return_amount & status
    const newTotalReturn = currentReturnAmount + hutangDeduction;
    const isNowFullySettled = (poPaid + newTotalReturn) >= (poTotal - 0.01);
    const updatedStatus = isNowFullySettled ? 'Selesai' : po.status;

    await client.query(
      'UPDATE purchase_orders SET return_amount = ?, status = ? WHERE id = ?',
      [newTotalReturn, updatedStatus, poId]
    );

    // 5. Insert purchase_returns header
    await client.query(`
      INSERT INTO purchase_returns (
        id, purchase_order_id, vendor_id, date, total_refund,
        hutang_deduction, vendor_deposit_amount, reason, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      returnId, poId, po.vendor_id, returnDate, totalRefund,
      hutangDeduction, vendorDepositAmount, reason.trim(), userId
    ]);

    // 6. Process items (Stock deduction, Weighted Average Cost recalculation, Stock Move)
    for (const item of itemsToProcess) {
      await client.query(`
        INSERT INTO purchase_return_items (
          return_id, product_id, quantity, cost, subtotal, refund_amount
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        returnId, item.product_id, item.quantity, item.cost, item.subtotal, item.refund_amount
      ]);

      const nextStock = item.curStock - item.quantity;
      let newCost = item.curCost;
      if (nextStock > 0) {
        newCost = ((item.curStock * item.curCost) - (item.quantity * item.cost)) / nextStock;
        if (newCost < 0) newCost = item.curCost;
      }

      await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [nextStock, newCost, item.product_id]);

      await recordStockMove(client, {
        product_id: item.product_id,
        tanggal: returnDate + ' 12:00:00',
        tipe: 'retur_pembelian',
        ref_type: 'purchase_return',
        ref_id: returnId,
        ref_no: poId,
        qty_masuk: 0,
        qty_keluar: item.quantity,
        qty_sebelum: item.curStock,
        qty_sesudah: nextStock,
        keterangan: `Retur Pembelian ${returnId} (PO ${poId}): ${reason.trim()}`,
        created_by: userId
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      return_id: returnId,
      returnId: returnId,
      total_refund: totalRefund,
      hutang_deduction: hutangDeduction,
      vendor_deposit_amount: vendorDepositAmount,
      po_status: updatedStatus
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/purchases/:id/returns
 * Mengambil riwayat retur untuk satu PO tertentu
 */
app.get('/api/purchases/:id/returns', authenticateToken, async (req, res) => {
  const poId = req.params.id;
  const role = (req.user?.role || 'kasir').toLowerCase();
  const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

  try {
    const returnsRes = await pool.query(`
      SELECT pr.*, u.name as user_name
      FROM purchase_returns pr
      LEFT JOIN users u ON u.id = pr.user_id
      WHERE pr.purchase_order_id = ?
      ORDER BY pr.date DESC, pr.created_at DESC
    `, [poId]);

    const result = [];
    for (const r of returnsRes.rows) {
      const itemsRes = await pool.query(`
        SELECT pri.*, p.name as product_name, p.sku
        FROM purchase_return_items pri
        LEFT JOIN products p ON p.id = pri.product_id
        WHERE pri.return_id = ?
      `, [r.id]);

      result.push({
        id: r.id,
        purchase_order_id: r.purchase_order_id,
        vendor_id: r.vendor_id,
        date: formatDateStr(r.date),
        reason: r.reason,
        user_name: r.user_name || '-',
        ...(canSeeFinance ? {
          total_refund: parseFloat(r.total_refund || 0),
          hutang_deduction: parseFloat(r.hutang_deduction || 0),
          vendor_deposit_amount: parseFloat(r.vendor_deposit_amount || 0),
        } : {}),
        items: itemsRes.rows.map(it => ({
          product_id: it.product_id,
          product_name: it.product_name,
          sku: it.sku,
          quantity: parseFloat(it.quantity || 0),
          ...(canSeeFinance ? {
            cost: parseFloat(it.cost || 0),
            subtotal: parseFloat(it.subtotal || 0),
            refund_amount: parseFloat(it.refund_amount || 0)
          } : {})
        }))
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/sales
 * Daftar Retur Penjualan (Paginated 80 baris, disanitasi berdasarkan role)
 */
app.get('/api/returns/sales', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'gudang', 'owner'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, date_from, date_to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
    const offset = (pageNum - 1) * limitNum;

    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || '').trim();
    if (searchQuery) {
      whereConditions.push('(sr.id LIKE ? OR sr.invoice_id LIKE ? OR c.name LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern, pattern);
    }
    if (date_from) {
      whereConditions.push('sr.date >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereConditions.push('sr.date <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countRes = await pool.query(`
      SELECT COUNT(*) as total
      FROM sales_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      ${whereClause}
    `, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await pool.query(`
      SELECT sr.*, c.name as customer_name, u.name as user_name,
        (SELECT COUNT(*) FROM sales_return_items WHERE return_id = sr.id) as item_count,
        (SELECT GROUP_CONCAT(DISTINCT condition_type) FROM sales_return_items WHERE return_id = sr.id) as conditions
      FROM sales_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN users u ON u.id = sr.user_id
      ${whereClause}
      ORDER BY sr.date DESC, sr.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, offset]);

    const data = dataRes.rows.map(r => {
      const row = {
        id: r.id,
        invoice_id: r.invoice_id,
        date: formatDateStr(r.date),
        customer_name: r.customer_name || 'Tanpa Pelanggan',
        item_count: parseInt(r.item_count || 0),
        reason: r.reason,
        conditions: r.conditions || 'kembali_ke_stok',
        user_name: r.user_name || '-'
      };
      if (canSeeFinance) {
        row.total_refund = parseFloat(r.total_refund || 0);
        row.piutang_deduction = parseFloat(r.piutang_deduction || 0);
        row.customer_deposit_amount = parseFloat(r.customer_deposit_amount || 0);
      }
      return row;
    });

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/sales/:id
 * Detail Retur Penjualan (disanitasi)
 */
app.get('/api/returns/sales/:id', authenticateToken, authorizeRoles('admin', 'kasir', 'finance', 'gudang', 'owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const srRes = await pool.query(`
      SELECT sr.*, c.name as customer_name, u.name as user_name
      FROM sales_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE sr.id = ?
    `, [id]);
    if (srRes.rows.length === 0) {
      return res.status(404).json({ error: 'Retur tidak ditemukan' });
    }
    const sr = srRes.rows[0];

    const itemsRes = await pool.query(`
      SELECT sri.*, p.name as product_name, p.sku
      FROM sales_return_items sri
      LEFT JOIN products p ON p.id = sri.product_id
      WHERE sri.return_id = ?
    `, [id]);

    const result = {
      return: {
        id: sr.id,
        invoice_id: sr.invoice_id,
        return_date: formatDateStr(sr.date),
        customer_id: sr.customer_id,
        customer_name: sr.customer_name || 'Tanpa Pelanggan',
        reason: sr.reason,
        created_by_name: sr.user_name || '-',
        ...(canSeeFinance ? {
          total_refund: parseFloat(sr.total_refund || 0),
          deducted_from_debt: parseFloat(sr.piutang_deduction || 0),
          added_to_deposit: parseFloat(sr.customer_deposit_amount || 0),
        } : {})
      },
      items: itemsRes.rows.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        product_sku: it.sku || '',
        qty: parseFloat(it.quantity || 0),
        condition: it.condition_type,
        ...(canSeeFinance ? {
          price: parseFloat(it.price || 0),
          subtotal: parseFloat(it.subtotal || 0),
          refund_amount: parseFloat(it.refund_amount || 0)
        } : {})
      }))
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/purchases
 * Daftar Retur Pembelian (Paginated 80 baris, disanitasi berdasarkan role)
 */
app.get('/api/returns/purchases', authenticateToken, authorizeRoles('admin', 'gudang', 'finance', 'owner'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, date_from, date_to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
    const offset = (pageNum - 1) * limitNum;

    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || '').trim();
    if (searchQuery) {
      whereConditions.push('(pr.id LIKE ? OR pr.purchase_order_id LIKE ? OR v.name LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern, pattern);
    }
    if (date_from) {
      whereConditions.push('pr.date >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereConditions.push('pr.date <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countRes = await pool.query(`
      SELECT COUNT(*) as total
      FROM purchase_returns pr
      LEFT JOIN vendors v ON v.id = pr.vendor_id
      ${whereClause}
    `, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await pool.query(`
      SELECT pr.*, v.name as vendor_name, u.name as user_name,
        (SELECT COUNT(*) FROM purchase_return_items WHERE return_id = pr.id) as item_count
      FROM purchase_returns pr
      LEFT JOIN vendors v ON v.id = pr.vendor_id
      LEFT JOIN users u ON u.id = pr.user_id
      ${whereClause}
      ORDER BY pr.date DESC, pr.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, offset]);

    const data = dataRes.rows.map(r => {
      const row = {
        id: r.id,
        purchase_order_id: r.purchase_order_id,
        date: formatDateStr(r.date),
        vendor_name: r.vendor_name || 'Tanpa Vendor',
        item_count: parseInt(r.item_count || 0),
        reason: r.reason,
        user_name: r.user_name || '-'
      };
      if (canSeeFinance) {
        row.total_refund = parseFloat(r.total_refund || 0);
        row.hutang_deduction = parseFloat(r.hutang_deduction || 0);
        row.vendor_deposit_amount = parseFloat(r.vendor_deposit_amount || 0);
      }
      return row;
    });

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/returns/purchases/:id
 * Detail Retur Pembelian (disanitasi)
 */
app.get('/api/returns/purchases/:id', authenticateToken, authorizeRoles('admin', 'gudang', 'finance', 'owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const role = (req.user?.role || 'kasir').toLowerCase();
    const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

    const prRes = await pool.query(`
      SELECT pr.*, v.name as vendor_name, u.name as user_name
      FROM purchase_returns pr
      LEFT JOIN vendors v ON v.id = pr.vendor_id
      LEFT JOIN users u ON u.id = pr.user_id
      WHERE pr.id = ?
    `, [id]);
    if (prRes.rows.length === 0) {
      return res.status(404).json({ error: 'Retur tidak ditemukan' });
    }
    const pr = prRes.rows[0];

    const itemsRes = await pool.query(`
      SELECT pri.*, p.name as product_name, p.sku
      FROM purchase_return_items pri
      LEFT JOIN products p ON p.id = pri.product_id
      WHERE pri.return_id = ?
    `, [id]);

    const result = {
      return: {
        id: pr.id,
        purchase_id: pr.purchase_order_id,
        return_date: formatDateStr(pr.date),
        vendor_id: pr.vendor_id,
        vendor_name: pr.vendor_name || 'Tanpa Vendor',
        reason: pr.reason,
        created_by_name: pr.user_name || '-',
        ...(canSeeFinance ? {
          total_refund: parseFloat(pr.total_refund || 0),
          deducted_from_debt: parseFloat(pr.hutang_deduction || 0),
          added_to_deposit: parseFloat(pr.vendor_deposit_amount || 0),
        } : {})
      },
      items: itemsRes.rows.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        product_sku: it.sku || '',
        qty: parseFloat(it.quantity || 0),
        condition: 'retur_ke_vendor',
        ...(canSeeFinance ? {
          price: parseFloat(it.cost || 0),
          subtotal: parseFloat(it.subtotal || 0),
          refund_amount: parseFloat(it.refund_amount || 0)
        } : {})
      }))
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock-moves
 * Monitoring qty barang keluar-masuk saja (B4.2).
 * STRICTLY NO FINANCIAL DATA (no prices, HPP, cash, balances).
 */
app.get('/api/stock-moves', authenticateToken, authorizeRoles('admin', 'gudang', 'owner'), async (req, res) => {
  try {
    const { page, limit: limitQ, q, search, tipe, product_id, date_from, date_to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(80, Math.max(1, parseInt(limitQ) || 80));
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = [];
    const params = [];

    const searchQuery = (q || search || '').trim();
    if (searchQuery) {
      whereConditions.push('(p.name LIKE ? OR p.sku LIKE ? OR sm.ref_no LIKE ? OR sm.keterangan LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    if (product_id && product_id !== 'all') {
      whereConditions.push('sm.product_id = ?');
      params.push(product_id);
    }

    if (tipe && tipe !== 'all') {
      whereConditions.push('sm.tipe = ?');
      params.push(tipe.toLowerCase());
    }

    if (date_from) {
      whereConditions.push('DATE(sm.tanggal) >= ?');
      params.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(sm.tanggal) <= ?');
      params.push(date_to);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countRes = await pool.query(`
      SELECT COUNT(*) as total
      FROM stock_moves sm
      JOIN products p ON p.id = sm.product_id
      ${whereClause}
    `, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    const dataRes = await pool.query(`
      SELECT sm.id, sm.tanggal, sm.tipe, sm.ref_type, sm.ref_id, sm.ref_no,
             sm.qty_masuk, sm.qty_keluar, sm.qty_sebelum, sm.qty_sesudah,
             sm.keterangan, sm.created_at, sm.is_backfill,
             p.id as product_id, p.name as product_name, p.sku, pu.name as unit_name,
             u.name as user_name
      FROM stock_moves sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN product_units pu ON pu.id = p.unit_id
      LEFT JOIN users u ON u.id = sm.created_by
      ${whereClause}
      ORDER BY sm.tanggal DESC, sm.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, offset]);

    // Format output strictly without any financial fields
    const data = dataRes.rows.map(r => ({
      id: r.id,
      tanggal: r.tanggal ? String(r.tanggal).replace('T', ' ').slice(0, 19) : '',
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku || '-',
      unit: r.unit_name || 'Pcs',
      tipe: r.tipe,
      refType: r.ref_type || '-',
      refId: r.ref_id || '-',
      refNo: r.ref_no || r.ref_id || '-',
      qtyMasuk: parseFloat(r.qty_masuk || 0),
      qtyKeluar: parseFloat(r.qty_keluar || 0),
      qtySebelum: parseFloat(r.qty_sebelum || 0),
      stokSesudah: parseFloat(r.qty_sesudah || 0),
      keterangan: r.keterangan || '-',
      user: r.user_name || 'Sistem',
      isBackfill: Boolean(r.is_backfill)
    }));

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// FITUR: KONVERSI PRODUK (Carton -> Kg / Satuan Lain)
// Akses: Admin & Gudang (Gudang tidak melihat HPP / nilai)
// =========================================================================

// GET /api/conversions — Daftar dokumen konversi produk
app.get('/api/conversions', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  try {
    const { page, limit, search, status, startDate, endDate, date_from, date_to } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 80);
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = [];
    const params = [];

    const searchQuery = (search || '').trim();
    if (searchQuery) {
      whereConditions.push('(pc.number LIKE ? OR sp.name LIKE ? OR sp.sku LIKE ? OR tp.name LIKE ? OR tp.sku LIKE ? OR pc.notes LIKE ?)');
      const pattern = `%${searchQuery}%`;
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const filterStatus = (status || '').trim().toLowerCase();
    if (filterStatus && filterStatus !== 'all') {
      whereConditions.push('pc.status = ?');
      params.push(filterStatus);
    }

    const fromDate = date_from || startDate;
    if (fromDate) {
      whereConditions.push('pc.date >= ?');
      params.push(fromDate);
    }

    const toDate = date_to || endDate;
    if (toDate) {
      whereConditions.push('pc.date <= ?');
      params.push(toDate);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countRes = await pool.query(`
      SELECT COUNT(*) as total
      FROM product_conversions pc
      JOIN products sp ON sp.id = pc.source_product_id COLLATE utf8mb4_unicode_ci
      JOIN products tp ON tp.id = pc.target_product_id COLLATE utf8mb4_unicode_ci
      ${whereClause}
    `, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const dataRes = await pool.query(`
      SELECT pc.id, pc.number, pc.date,
             pc.source_product_id, pc.source_qty,
             pc.target_product_id, pc.target_qty,
             pc.source_hpp_snapshot, pc.moved_value,
             pc.target_stock_before, pc.target_hpp_before, pc.target_hpp_after,
             pc.notes, pc.status, pc.created_at, pc.cancelled_at, pc.cancel_reason,
             sp.name AS source_product_name, sp.sku AS source_product_sku, su.name AS source_unit_name,
             tp.name AS target_product_name, tp.sku AS target_product_sku, tu.name AS target_unit_name,
             u.name AS creator_name, cu.name AS canceller_name
      FROM product_conversions pc
      JOIN products sp ON sp.id = pc.source_product_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN product_units su ON su.id = sp.unit_id
      JOIN products tp ON tp.id = pc.target_product_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN product_units tu ON tu.id = tp.unit_id
      LEFT JOIN users u ON u.id = pc.created_by
      LEFT JOIN users cu ON cu.id = pc.cancelled_by
      ${whereClause}
      ORDER BY pc.date DESC, pc.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, offset]);

    const isGudang = (req.user?.role || '').toLowerCase() === 'gudang';

    const data = dataRes.rows.map(r => {
      const row = {
        id: r.id,
        number: r.number,
        date: r.date ? formatDateStr(r.date) : '',
        source_product_id: r.source_product_id,
        source_product_name: r.source_product_name,
        source_product_sku: r.source_product_sku || '-',
        source_unit: r.source_unit_name || '-',
        source_qty: parseFloat(r.source_qty || 0),
        target_product_id: r.target_product_id,
        target_product_name: r.target_product_name,
        target_product_sku: r.target_product_sku || '-',
        target_unit: r.target_unit_name || '-',
        target_qty: parseFloat(r.target_qty || 0),
        notes: r.notes || '-',
        status: r.status,
        created_at: r.created_at,
        created_by_name: r.creator_name || 'Sistem',
        cancelled_at: r.cancelled_at,
        cancelled_by_name: r.canceller_name || null,
        cancel_reason: r.cancel_reason || null
      };

      // Visibilitas HPP: gudang TIDAK melihat nilai / HPP
      if (!isGudang) {
        row.source_hpp_snapshot = parseFloat(r.source_hpp_snapshot || 0);
        row.moved_value = parseFloat(r.moved_value || 0);
        row.target_stock_before = parseFloat(r.target_stock_before || 0);
        row.target_hpp_before = parseFloat(r.target_hpp_before || 0);
        row.target_hpp_after = parseFloat(r.target_hpp_after || 0);
      }

      return row;
    });

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversions/:id — Detail dokumen konversi
app.get('/api/conversions/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  try {
    const convId = req.params.id;
    const dataRes = await pool.query(`
      SELECT pc.id, pc.number, pc.date,
             pc.source_product_id, pc.source_qty,
             pc.target_product_id, pc.target_qty,
             pc.source_hpp_snapshot, pc.moved_value,
             pc.target_stock_before, pc.target_hpp_before, pc.target_hpp_after,
             pc.notes, pc.status, pc.created_at, pc.cancelled_at, pc.cancel_reason,
             sp.name AS source_product_name, sp.sku AS source_product_sku, su.name AS source_unit_name,
             tp.name AS target_product_name, tp.sku AS target_product_sku, tu.name AS target_unit_name,
             u.name AS creator_name, cu.name AS canceller_name
      FROM product_conversions pc
      JOIN products sp ON sp.id = pc.source_product_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN product_units su ON su.id = sp.unit_id
      JOIN products tp ON tp.id = pc.target_product_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN product_units tu ON tu.id = tp.unit_id
      LEFT JOIN users u ON u.id = pc.created_by
      LEFT JOIN users cu ON cu.id = pc.cancelled_by
      WHERE pc.id = ? OR pc.number = ?
      LIMIT 1
    `, [convId, convId]);

    if (dataRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dokumen konversi tidak ditemukan' });
    }

    const r = dataRes.rows[0];
    const isGudang = (req.user?.role || '').toLowerCase() === 'gudang';

    const result = {
      id: r.id,
      number: r.number,
      date: r.date ? formatDateStr(r.date) : '',
      source_product_id: r.source_product_id,
      source_product_name: r.source_product_name,
      source_product_sku: r.source_product_sku || '-',
      source_unit: r.source_unit_name || '-',
      source_qty: parseFloat(r.source_qty || 0),
      target_product_id: r.target_product_id,
      target_product_name: r.target_product_name,
      target_product_sku: r.target_product_sku || '-',
      target_unit: r.target_unit_name || '-',
      target_qty: parseFloat(r.target_qty || 0),
      notes: r.notes || '-',
      status: r.status,
      created_at: r.created_at,
      created_by_name: r.creator_name || 'Sistem',
      cancelled_at: r.cancelled_at,
      cancelled_by_name: r.canceller_name || null,
      cancel_reason: r.cancel_reason || null
    };

    if (!isGudang) {
      result.source_hpp_snapshot = parseFloat(r.source_hpp_snapshot || 0);
      result.moved_value = parseFloat(r.moved_value || 0);
      result.target_stock_before = parseFloat(r.target_stock_before || 0);
      result.target_hpp_before = parseFloat(r.target_hpp_before || 0);
      result.target_hpp_after = parseFloat(r.target_hpp_after || 0);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversions — Simpan dan posting konversi produk baru
app.post('/api/conversions', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { date, source_product_id, source_qty, target_product_id, target_qty, notes } = req.body;

  // 1. Validasi input dasar
  if (!source_product_id || !target_product_id) {
    return res.status(400).json({ error: 'Produk sumber dan produk tujuan wajib dipilih' });
  }
  if (source_product_id === target_product_id) {
    return res.status(400).json({ error: 'Produk sumber dan produk tujuan tidak boleh sama' });
  }

  const sQty = parseFloat(source_qty);
  const tQty = parseFloat(target_qty);
  if (isNaN(sQty) || sQty <= 0) {
    return res.status(400).json({ error: 'Qty sumber harus berupa angka lebih besar dari 0' });
  }
  if (isNaN(tQty) || tQty <= 0) {
    return res.status(400).json({ error: 'Qty tujuan harus berupa angka lebih besar dari 0' });
  }

  const convDate = date ? formatDateStr(date) : getTodayWITA();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Kunci (lock) kedua produk dengan urutan ID konsisten untuk mencegah deadlock
    const sortedIds = [source_product_id, target_product_id].sort();
    const prodsRes = await client.query(
      'SELECT id, name, sku, stock, cost_price FROM products WHERE id IN (?, ?) FOR UPDATE',
      [sortedIds[0], sortedIds[1]]
    );

    const prodMap = {};
    prodsRes.rows.forEach(p => { prodMap[p.id] = p; });

    const sourceProd = prodMap[source_product_id];
    const targetProd = prodMap[target_product_id];

    if (!sourceProd) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produk sumber tidak ditemukan' });
    }
    if (!targetProd) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produk tujuan tidak ditemukan' });
    }

    const currentSourceStock = parseFloat(sourceProd.stock || 0);
    const currentSourceCost = parseFloat(sourceProd.cost_price || 0);
    const currentTargetStock = parseFloat(targetProd.stock || 0);
    const currentTargetCost = parseFloat(targetProd.cost_price || 0);

    // 3. Validasi stok sumber mencukupi
    if (currentSourceStock < sQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Stok sumber tidak mencukupi untuk '${sourceProd.name}' (Tersedia: ${currentSourceStock}, Diminta: ${sQty})`
      });
    }

    // 4. Perhitungan nilai & HPP rata-rata tertimbang
    const movedValue = currentSourceCost * sQty;
    const newSourceStock = currentSourceStock - sQty;

    let newTargetCost = 0;
    if (currentTargetStock <= 0) {
      newTargetCost = movedValue / tQty;
    } else {
      newTargetCost = ((currentTargetStock * currentTargetCost) + movedValue) / (currentTargetStock + tQty);
    }
    const newTargetStock = currentTargetStock + tQty;

    // 5. Update stok & HPP kedua produk
    // Stok sumber berkurang, HPP sumber TIDAK berubah
    await client.query('UPDATE products SET stock = ? WHERE id = ?', [newSourceStock, source_product_id]);
    // Stok tujuan bertambah, HPP tujuan disesuaikan dengan weighted average
    await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [newTargetStock, newTargetCost, target_product_id]);

    // 6. Generate nomor dokumen KNV-{YYYY}-{NNNNN}
    const convNo = await generateConversionNo(client, convDate);

    // 7. Simpan dokumen product_conversions
    const insRes = await client.query(`
      INSERT INTO product_conversions (
        number, date, source_product_id, source_qty, target_product_id, target_qty,
        source_hpp_snapshot, moved_value, target_stock_before, target_hpp_before, target_hpp_after,
        notes, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)
    `, [
      convNo, convDate, source_product_id, sQty, target_product_id, tQty,
      currentSourceCost, movedValue, currentTargetStock, currentTargetCost, newTargetCost,
      notes ? notes.trim() : null, req.user.id
    ]);
    const convId = insRes.insertId || insRes.rows?.[0]?.id;

    // 8. Catat 2 baris Stock Moves (tanpa nilai uang, hanya mutasi fisik)
    // a. Keluar dari sumber
    await recordStockMove(client, {
      product_id: source_product_id,
      tanggal: convDate + ' 12:00:00',
      tipe: 'konversi_keluar',
      ref_type: 'product_conversion',
      ref_id: String(convNo),
      ref_no: convNo,
      qty_masuk: 0,
      qty_keluar: sQty,
      qty_sebelum: currentSourceStock,
      qty_sesudah: newSourceStock,
      keterangan: `Konversi keluar ke ${targetProd.name} (${convNo})`,
      created_by: req.user.id
    });

    // b. Masuk ke tujuan
    await recordStockMove(client, {
      product_id: target_product_id,
      tanggal: convDate + ' 12:00:00',
      tipe: 'konversi_masuk',
      ref_type: 'product_conversion',
      ref_id: String(convNo),
      ref_no: convNo,
      qty_masuk: tQty,
      qty_keluar: 0,
      qty_sebelum: currentTargetStock,
      qty_sesudah: newTargetStock,
      keterangan: `Konversi masuk dari ${sourceProd.name} (${convNo})`,
      created_by: req.user.id
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      id: convId,
      number: convNo,
      message: `Konversi produk ${convNo} berhasil disimpan`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/conversions/:id/cancel — Batalkan dokumen konversi
app.post('/api/conversions/:id/cancel', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { cancel_reason } = req.body;
  if (!cancel_reason || typeof cancel_reason !== 'string' || !cancel_reason.trim()) {
    return res.status(400).json({ error: 'Alasan pembatalan wajib diisi' });
  }

  const convId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ambil data dokumen konversi
    const convRes = await client.query(
      'SELECT * FROM product_conversions WHERE id = ? OR number = ? FOR UPDATE',
      [convId, convId]
    );
    if (convRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Dokumen konversi tidak ditemukan' });
    }

    const conv = convRes.rows[0];
    if (conv.status !== 'posted') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Hanya konversi berstatus 'posted' yang dapat dibatalkan (Status saat ini: ${conv.status})`
      });
    }

    // 2. Kunci kedua produk dengan urutan ID konsisten
    const sortedIds = [conv.source_product_id, conv.target_product_id].sort();
    const prodsRes = await client.query(
      'SELECT id, name, sku, stock, cost_price FROM products WHERE id IN (?, ?) FOR UPDATE',
      [sortedIds[0], sortedIds[1]]
    );

    const prodMap = {};
    prodsRes.rows.forEach(p => { prodMap[p.id] = p; });

    const sourceProd = prodMap[conv.source_product_id];
    const targetProd = prodMap[conv.target_product_id];

    if (!sourceProd || !targetProd) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produk sumber atau produk tujuan tidak ditemukan di master produk' });
    }

    const currentTargetStock = parseFloat(targetProd.stock || 0);
    const currentTargetCost = parseFloat(targetProd.cost_price || 0);
    const currentSourceStock = parseFloat(sourceProd.stock || 0);

    const tQty = parseFloat(conv.target_qty);
    const sQty = parseFloat(conv.source_qty);
    const movedVal = parseFloat(conv.moved_value);
    const targetHppBefore = parseFloat(conv.target_hpp_before);

    // 3. GUARD: Stok produk tujuan saat ini tidak boleh lebih kecil dari target_qty
    if (currentTargetStock < tQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Stok produk tujuan '${targetProd.name}' saat ini (${currentTargetStock}) lebih kecil dari qty hasil konversi (${tQty}). Stok hasil konversi sudah terpakai sebagian.`
      });
    }

    // 4. Balikkan stok produk sumber (+ source_qty, HPP tetap)
    const newSourceStock = currentSourceStock + sQty;
    await client.query('UPDATE products SET stock = ? WHERE id = ?', [newSourceStock, conv.source_product_id]);

    // 5. Balikkan stok & HPP produk tujuan
    const remainingTargetStock = currentTargetStock - tQty;
    let newTargetCost = 0;
    if (remainingTargetStock === 0) {
      newTargetCost = targetHppBefore;
    } else {
      newTargetCost = ((currentTargetStock * currentTargetCost) - movedVal) / remainingTargetStock;
      if (newTargetCost < 0) newTargetCost = targetHppBefore;
    }
    await client.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [remainingTargetStock, newTargetCost, conv.target_product_id]);

    // 6. Update status dokumen konversi ke cancelled
    const nowDt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await client.query(`
      UPDATE product_conversions
      SET status = 'cancelled',
          cancelled_by = ?,
          cancelled_at = ?,
          cancel_reason = ?
      WHERE id = ?
    `, [req.user.id, nowDt, cancel_reason.trim(), conv.id]);

    // 7. Catat 2 baris Stock Moves pembalik
    // a. Tujuan keluar (batal_konversi)
    await recordStockMove(client, {
      product_id: conv.target_product_id,
      tanggal: nowDt,
      tipe: 'batal_konversi',
      ref_type: 'product_conversion',
      ref_id: String(conv.number),
      ref_no: conv.number,
      qty_masuk: 0,
      qty_keluar: tQty,
      qty_sebelum: currentTargetStock,
      qty_sesudah: remainingTargetStock,
      keterangan: `Pembatalan Konversi ${conv.number}: ${cancel_reason.trim()}`,
      created_by: req.user.id
    });

    // b. Sumber masuk (batal_konversi)
    await recordStockMove(client, {
      product_id: conv.source_product_id,
      tanggal: nowDt,
      tipe: 'batal_konversi',
      ref_type: 'product_conversion',
      ref_id: String(conv.number),
      ref_no: conv.number,
      qty_masuk: sQty,
      qty_keluar: 0,
      qty_sebelum: currentSourceStock,
      qty_sesudah: newSourceStock,
      keterangan: `Pembatalan Konversi ${conv.number}: ${cancel_reason.trim()}`,
      created_by: req.user.id
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Konversi ${conv.number} berhasil dibatalkan`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});
// =========================================================================

// Bind ke 0.0.0.0 agar bisa diakses dari luar (wajib di hosting)
app.listen(port, '0.0.0.0', () => {
  console.log(`SupplierPro API running on port ${port} (0.0.0.0)`);
});

// Global error handler — pastikan server tidak crash diam-diam
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});
