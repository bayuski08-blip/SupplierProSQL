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
app.use(express.json());

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
  timezone: '+08:00'  // WITA (UTC+8) — ensures DATE() functions align with Indonesian business time
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

    const isBcryptHash = user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2a$');
    let isMatch = false;

    if (isBcryptHash) {
      isMatch = await bcrypt.compare(password, user.password_hash);
    } else {
      if (password === user.password_hash) {
        isMatch = true;
        try {
          const newHash = await bcrypt.hash(password, 10);
          await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
        } catch (hashErr) {
          console.error('Error auto-migrating user password to bcrypt:', hashErr);
        }
      }
    }

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
app.get('/api/settings', authenticateToken, authorizeRoles('admin'), async (req, res) => {
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
    // Revenue (omzet) - semua invoice yang tidak batal
    const revenueResult = await pool.query("SELECT SUM(total) as revenue FROM sales_invoices WHERE status != 'Batal'");
    const revenue = parseFloat(revenueResult.rows[0].revenue || 0);

    // Piutang - invoice yang belum lunas
    const receivablesResult = await pool.query("SELECT SUM(total - paid_amount) as receivables FROM sales_invoices WHERE status != 'Lunas' AND status != 'Batal'");
    const receivables = parseFloat(receivablesResult.rows[0].receivables || 0);

    // Hutang ke vendor - PO yang belum selesai
    const payablesResult = await pool.query("SELECT SUM(total - paid_amount) as payables FROM purchase_orders WHERE status != 'Selesai' AND status != 'Batal'");
    const payables = parseFloat(payablesResult.rows[0].payables || 0);

    // Stok menipis
    const lowStockResult = await pool.query('SELECT id, name, stock, min_stock FROM products WHERE stock <= min_stock ORDER BY stock ASC');
    const lowStockProducts = lowStockResult.rows;

    // Laba Kotor (Revenue - HPP)
    const hppResult = await pool.query(`
      SELECT COALESCE(SUM(ii.quantity * p.cost_price), 0) as hpp
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN sales_invoices si ON ii.invoice_id = si.id
      WHERE si.status != 'Batal'
    `);
    const hpp = parseFloat(hppResult.rows[0].hpp || 0);
    const grossProfit = revenue - hpp;

    // Order hari ini
    const today = new Date().toISOString().split('T')[0];
    const ordersTodayResult = await pool.query("SELECT COUNT(*) as count FROM sales_invoices WHERE DATE(date) = ? AND status != 'Batal'", [today]);
    const ordersToday = parseInt(ordersTodayResult.rows[0].count || 0);

    // Jumlah pelanggan aktif
    const customersResult = await pool.query('SELECT COUNT(*) as count FROM customers');
    const customerCount = parseInt(customersResult.rows[0].count || 0);

    // Jumlah produk
    const productsResult = await pool.query('SELECT COUNT(*) as count FROM products');
    const productCount = parseInt(productsResult.rows[0].count || 0);

    // Jumlah invoice belum lunas (untuk badge piutang)
    const unpaidCountResult = await pool.query("SELECT COUNT(*) as count FROM sales_invoices WHERE status != 'Lunas' AND status != 'Batal'");
    const unpaidCount = parseInt(unpaidCountResult.rows[0].count || 0);

    res.json({
      revenue,
      receivables,
      payables,
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
      grossProfit,
      ordersToday,
      customerCount,
      productCount,
      unpaidCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/sales-trend', authenticateToken, async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  try {
    const query = `
      SELECT 
        DATE(date) AS tanggal,
        COALESCE(SUM(total), 0) AS total_penjualan,
        COUNT(*) AS jumlah_transaksi
      FROM sales_invoices
      WHERE DATE(date) >= DATE_SUB(CURDATE(), INTERVAL ? - 1 DAY)
        AND status != 'Dibatalkan' AND status != 'Batal'
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

app.get('/api/dashboard/sales-composition', authenticateToken, async (req, res) => {
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
        AND si.status != 'Dibatalkan' AND si.status != 'Batal'
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
    const result = await pool.query(`
      SELECT p.*, c.name as category, u.name as unit 
      FROM products p 
      LEFT JOIN product_categories c ON p.category_id = c.id 
      LEFT JOIN product_units u ON p.unit_id = u.id
    `);
    res.json(result.rows);
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
    res.json(result.rows[0]);
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
    await pool.query(insertQuery, [id || nextId, sku, brandVal, name, category_id, cost_price, sell_price, stock, min_stock, unit_id || 'PU-1']);
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
    const result = await pool.query(updateQuery, [sku, brandVal, name, category_id, cost_price, sell_price, stock, min_stock, unit_id, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json({ success: true, message: 'Produk berhasil diperbarui' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
  const { id } = req.params;
  const deleteQuery = 'DELETE FROM products WHERE id = $1';
  try {
    const result = await pool.query(deleteQuery, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json({ success: true, message: 'Produk berhasil dihapus' });
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
    cc.name AS category_name,
    COALESCE(SUM(CASE WHEN si.status != 'Batal' THEN si.total ELSE 0 END), 0) AS total_belanja,
    COALESCE(SUM(CASE WHEN si.status NOT IN ('Lunas','Batal') THEN si.total - si.paid_amount ELSE 0 END), 0) AS total_piutang_berjalan,
    c.credit_lmt - COALESCE(SUM(CASE WHEN si.status NOT IN ('Lunas','Batal') THEN si.total - si.paid_amount ELSE 0 END), 0) AS sisa_limit_piutang
  FROM customers c
  LEFT JOIN customer_categories cc ON c.customer_category_id = cc.id
  LEFT JOIN sales_invoices si ON si.customer_id = c.id
`;

app.get('/api/customers', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  try {
    const result = await pool.query(CUSTOMER_SELECT_SQL + ' GROUP BY c.id, cc.name ORDER BY c.name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/search', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  const { q } = req.query;
  const pattern = `%${q || ''}%`;
  try {
    const result = await pool.query(
      CUSTOMER_SELECT_SQL +
      ` WHERE (c.name LIKE ? OR c.phone LIKE ? OR c.id LIKE ?)
        GROUP BY c.id, cc.name
        ORDER BY c.name ASC
        LIMIT 20`,
      [pattern, pattern, pattern]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:id', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      CUSTOMER_SELECT_SQL + ' WHERE c.id = $1 GROUP BY c.id, cc.name',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const { name, customer_category_id, phone, city, address, credit_lmt, ktp, npwp, nib, email, no_hp_2 } = req.body;

  // Validasi backend
  if (ktp && !/^\d{16}$/.test(ktp)) return res.status(400).json({ error: 'Nomor KTP harus 16 digit angka' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid' });

  const insertQuery = 'INSERT INTO customers (id, name, customer_category_id, phone, city, address, credit_lmt, ktp, npwp, nib, email, no_hp_2) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)';
  try {
    const prefix = await getSetting('prefix_customer', 'C');
    const id = await generateNextId(pool, 'customers', prefix);
    await pool.query(insertQuery, [id, name, customer_category_id, phone, city, address, credit_lmt, ktp || null, npwp || null, nib || null, email || null, no_hp_2 || null]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/customers/:id', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const { id } = req.params;
  const { name, customer_category_id, phone, city, address, credit_lmt, ktp, npwp, nib, email, no_hp_2 } = req.body;

  // Validasi backend
  if (ktp && !/^\d{16}$/.test(ktp)) return res.status(400).json({ error: 'Nomor KTP harus 16 digit angka' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid' });

  const updateQuery = 'UPDATE customers SET name = $1, customer_category_id = $2, phone = $3, city = $4, address = $5, credit_lmt = $6, ktp = $7, npwp = $8, nib = $9, email = $10, no_hp_2 = $11 WHERE id = $12';
  try {
    const result = await pool.query(updateQuery, [name, customer_category_id, phone, city, address, credit_lmt, ktp || null, npwp || null, nib || null, email || null, no_hp_2 || null, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    }
    res.json({ success: true, message: 'Pelanggan berhasil diperbarui' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/customers/:id', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
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

// --- Vendors Routes ---
app.get('/api/vendors', authenticateToken, authorizeRoles('admin', 'gudang', 'finance'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, vc.name as category_name,
        COALESCE(po_agg.total_purchases, 0) AS total_purchases,
        COALESCE(po_agg.outstanding_debt, 0) AS outstanding_debt
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
      ORDER BY v.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Invoices Routes (Sales) ---
app.get('/api/invoices', authenticateToken, authorizeRoles('admin', 'kasir', 'finance'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT si.*, c.name as customer, pt.name as payment_type_name
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
      ORDER BY si.date DESC, si.id DESC
    `);
    res.json(result.rows.map(r => ({
      id: r.id,
      date: formatDateStr(r.date),
      customerId: r.customer_id,
      customer: r.customer || 'Tanpa Pelanggan',
      total: parseFloat(r.total),
      paid: parseFloat(r.paid_amount),
      paidDate: formatDateStr(r.paid_date) || null,
      type: r.payment_type_name || 'Tunai',
      paymentTypeId: r.payment_type_id,
      status: r.status,
      dueDate: formatDateStr(r.due_date)
    })));
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
    // Security: strip fee fields from non-admin responses
    const rows = result.rows.map(row => {
      if (req.user.role !== 'admin') {
        const { customer_fee, fee_notes, ...rest } = row;
        return rest;
      }
      return row;
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
      SELECT si.*, c.name as customer_name, c.address as customer_address, pt.name as payment_type_name
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
    
    res.json({
      invoice: {
        id: invoiceRow.id,
        date: formatDateStr(invoiceRow.date),
        due_date: formatDateStr(invoiceRow.due_date),
        total: recalculatedTotal,
        subtotal: subtotal,
        tax: recalculatedTax,
        payment_type_name: invoiceRow.payment_type_name || 'Tunai'
      },
      customer: {
        name: invoiceRow.customer_name || 'Pelanggan Umum',
        address: invoiceRow.customer_address || ''
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
  if ((!items || !Array.isArray(items) || items.length === 0) && !req.body.is_import) {
    return res.status(400).json({ error: 'Invoice harus memiliki minimal satu item produk.' });
  }

  console.log(`[Invoice Creation API] Selected Payment Type ID: "${payment_type_id}"`);

  const insertInvoiceQuery = 'INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount, payment_type_id, due_date, status, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)';
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
        subtotal += (parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 0);
      });
    }
    const diskon = parseFloat(req.body.discount || req.body.diskon || 0);
    const taxAmount = ppnEnabled ? Math.round((subtotal - diskon) * (pajakDefault / 100)) : 0;
    const finalTotal = subtotal - diskon + taxAmount;

    const date = req.body.date ? req.body.date.split('T')[0] : new Date().toISOString().split('T')[0];

    // Determine status based on payment type:
    // Tunai / Transfer = instant settlement (Lunas), Kredit X Hari = Belum Bayar
    const instant = await isInstantPayment(payment_type_id);
    const effectivePaid = instant ? finalTotal : parseFloat(paid || 0);
    const status = instant ? 'Lunas'
      : (effectivePaid >= finalTotal ? 'Lunas'
        : (effectivePaid > 0 ? 'Sebagian' : 'Belum Bayar'));

    // Generate invoice ID using atomic per-year counter
    // Use date from request body so year/month match the invoice date (not server clock)
    const invoiceDateForId = req.body.date ? req.body.date.split('T')[0] : new Date().toISOString().split('T')[0];
    const id = await generateInvoiceId(client, invoiceDateForId);
    
    console.log(`[Invoice Creation API] Saving invoice ${id} with payment_type_id: "${payment_type_id}"`);
    await client.query(insertInvoiceQuery, [id, date, customer_id, subtotal, diskon, taxAmount, finalTotal, effectivePaid, payment_type_id, due_date, status, userId]);

    // Reduce stock & insert items with HPP snapshot
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await client.query(updateStockQuery, [item.quantity, item.id]);
        // Also insert to invoice_items — include customer_fee/fee_notes (admin only)
        const itemFee = req.user.role === 'admin' ? (parseFloat(item.customer_fee) || 0) : 0;
        const itemFeeNotes = req.user.role === 'admin' ? (item.fee_notes || null) : null;
        if (itemFee < 0) throw new Error('customer_fee tidak boleh negatif');

        // Snapshot the HPP (cost_price) at time of sale to prevent drift when cost changes later
        const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [item.id]);
        const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || item.cost_price || 0);

        await client.query(
          'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [Date.now().toString() + Math.floor(Math.random() * 1000), id, item.id, item.quantity, item.price || 0, costSnapshot, itemFee, itemFeeNotes]
        );
      }
    }

    if (effectivePaid > 0) {
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      const ctDate = new Date().toISOString().split('T')[0];
      const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [payment_type_id]);
      const method = ptNameRes.rows[0]?.name || 'Transfer Bank';
      const cashCategory = status === 'Lunas' ? 'Penjualan' : 'Pelunasan Piutang';
      console.log(`[Invoice Creation API] Creating cash transaction for invoice ${id}. Paid: ${effectivePaid}, payment_type_id: "${payment_type_id}", method name: "${method}"`);
      await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, payment_type_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ctId, ctDate, 'IN', cashCategory, `Pembayaran Invoice ${id}`, effectivePaid, method, id, payment_type_id, userId]);
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
  const { id, date, due_date, customer_id, total, payment_type_id } = req.body;
  const userId = req.user.id;

  const status = 'Belum Bayar';
  const insertQuery = 'INSERT INTO sales_invoices (id, date, customer_id, subtotal, total, paid_amount, payment_type_id, due_date, status, user_id) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)';

  try {
    await pool.query(insertQuery, [id, date, customer_id, total, total, payment_type_id, due_date, status, userId]);
    res.json({ success: true, invoiceId: id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get('/api/finance/receivables', authenticateToken, authorizeRoles('admin', 'finance', 'kasir'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sales_invoices WHERE status != $1 AND status != $2', ['Lunas', 'Batal']);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/finance/receivables/:id/pay', authenticateToken, authorizeRoles('admin', 'finance', 'kasir'), async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  try {
    const result = await pool.query('SELECT * FROM sales_invoices WHERE id = $1', [id]);
    const invoice = result.rows[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice tidak ditemukan' });

    const currentPaid = parseFloat(invoice.paid_amount);
    const total = parseFloat(invoice.total);
    const newPaid = currentPaid + parseFloat(amount);
    const newStatus = newPaid >= total ? 'Lunas' : 'Sebagian';
    const paidDate = newStatus === 'Lunas' ? new Date().toISOString().split('T')[0] : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (paidDate) {
        await client.query('UPDATE sales_invoices SET paid_amount = $1, status = $2, paid_date = $3 WHERE id = $4', [newPaid, newStatus, paidDate, id]);
      } else {
        await client.query('UPDATE sales_invoices SET paid_amount = $1, status = $2 WHERE id = $3', [newPaid, newStatus, id]);
      }

      // Log cash transaction IN
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      const date = new Date().toISOString().split('T')[0];
      const userId = req.user.id;
      await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [ctId, date, 'IN', 'Pelunasan Piutang', `Pelunasan Invoice ${id}`, amount, 'Transfer Bank', id, userId]);

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_date DATE DEFAULT NULL`);
    console.log('[Migration] sales_invoices & purchase_orders: paid_date column ensured');

    // Auto-migrasi field baru tabel customers
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS ktp VARCHAR(50) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS npwp VARCHAR(50) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nib VARCHAR(30) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_hp_2 VARCHAR(30) NULL`);
    console.log('[Migration] customers: ktp, npwp, nib, email, no_hp_2 columns ensured');
  } catch (err) {
    console.error('[Migration] Failed to execute migrations:', err.message);
  }
})();

app.get('/api/finance/cash-flow', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cash_transactions ORDER BY date DESC, id DESC');
    res.json(result.rows.map(r => ({
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
      isManual: !r.invoice_id && !r.purchase_order_id
    })));
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
      // Reversal invoice paid_amount
      const invRes = await client.query('SELECT * FROM sales_invoices WHERE id=$1', [tx.invoice_id]);
      if (invRes.rows.length > 0) {
        const inv = invRes.rows[0];
        const newPaid = Math.max(0, parseFloat(inv.paid_amount) - parseFloat(tx.amount));
        const newStatus = newPaid >= parseFloat(inv.total) ? 'Lunas' : newPaid > 0 ? 'Sebagian' : 'Belum Bayar';
        await client.query('UPDATE sales_invoices SET paid_amount=$1, status=$2 WHERE id=$3', [newPaid, newStatus, tx.invoice_id]);
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
        if (productId) {
          await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [diff, productId]);
        } else {
          await client.query('UPDATE products SET stock = stock - $1 WHERE name = $2', [diff, productName]);
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
        AND status NOT IN ('Batal', 'Dibatalkan')
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
        AND si.status NOT IN ('Batal', 'Dibatalkan')
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
        AND si.status NOT IN ('Batal', 'Dibatalkan')
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
      WHERE status NOT IN ('Lunas', 'Dibatalkan', 'Batal')
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
        AND status != 'Dibatalkan' AND status != 'Batal'
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
        AND si.status NOT IN ('Batal', 'Dibatalkan')
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
          AND status != 'Dibatalkan' AND status != 'Batal'
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
        AND si.status != 'Dibatalkan' AND si.status != 'Batal'
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
        AND si.status != 'Dibatalkan' AND si.status != 'Batal'
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

app.get('/api/finance/payables', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const result = await pool.query('SELECT po.*, v.name as vendor_name, pt.name as payment_type_name FROM purchase_orders po LEFT JOIN vendors v ON po.vendor_id = v.id LEFT JOIN payment_types pt ON po.payment_type_id = pt.id WHERE po.status != $1 AND po.status != $2', ['Selesai', 'Batal']);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pay vendor PO debt
app.post('/api/finance/payables/:id/pay', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  const payAmount = parseFloat(amount || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
    const po = result.rows[0];
    if (!po) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PO tidak ditemukan' });
    }

    const pType = req.body.payment_type_id || po.payment_type_id;
    const ptRes = await client.query(
      'SELECT name FROM payment_types WHERE id = $1',
      [pType]
    );
    const payMethodStr = ptRes.rows[0]?.name || 'Transfer Bank';

    const currentPaid = parseFloat(po.paid_amount || 0);
    const total = parseFloat(po.total || 0);
    const newPaid = currentPaid + payAmount;
    const newStatus = newPaid >= total ? 'Selesai' : 'Dalam Proses';
    const paidDate = newStatus === 'Selesai' ? new Date().toISOString().split('T')[0] : null;

    if (paidDate) {
      await client.query('UPDATE purchase_orders SET paid_amount = $1, status = $2, paid_date = $3 WHERE id = $4', [newPaid, newStatus, paidDate, id]);
    } else {
      await client.query('UPDATE purchase_orders SET paid_amount = $1, status = $2 WHERE id = $3', [newPaid, newStatus, id]);
    }

    // Log cash transaction OUT
    const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
    const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
    const date = new Date().toISOString().split('T')[0];
    const userId = req.user.id;
    await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, purchase_order_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [ctId, date, 'OUT', 'Pembelian Stok', `Pelunasan ${id}`, payAmount, payMethodStr, id, userId]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
    const result = await pool.query(`
      SELECT po.*, v.name as vendor_name, pt.name as payment_type 
      FROM purchase_orders po 
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN payment_types pt ON po.payment_type_id = pt.id
      ORDER BY po.date DESC, po.id DESC
    `);
    res.json(result.rows.map(row => ({
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
    })));
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
    const finalPaid = parseFloat(paid || paid_amount || 0);
    const effectivePaid = instant ? finalTotal : finalPaid;
    const status = instant ? 'Selesai'
      : (effectivePaid >= finalTotal ? 'Selesai' : 'Dalam Proses');

    const prefix = await getSetting('prefix_purchase', 'PO/{YYYY}/{MM}/');
    const poId = await generateNextId(client, 'purchase_orders', prefix);
    await client.query('INSERT INTO purchase_orders (id, date, vendor_id, subtotal, discount, tax, total, paid_amount, payment_type_id, due_date, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [poId, poDate, vId, subtotal, finalDiskon, taxAmount, finalTotal, effectivePaid, pType, due_date, status, userId]);

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemId = 'POI-' + Date.now() + Math.floor(Math.random() * 1000);
        const prodId = item.product_id || item.id;
        const qty = parseFloat(item.quantity || item.qty || 0);
        const cost = parseFloat(item.cost || item.cost_price || item.price || 0);

        await client.query('INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, cost) VALUES ($1, $2, $3, $4, $5)', [itemId, poId, prodId, qty, cost]);
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [qty, prodId]);
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

app.put('/api/purchases/:id', authenticateToken, authorizeRoles('admin', 'gudang'), async (req, res) => {
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

    // Determine status by payment type
    const instant = await isInstantPayment(pType);
    const finalPaid = parseFloat(paid || paid_amount || 0);
    const effectivePaid = instant ? finalTotal : finalPaid;
    const status = instant ? 'Selesai'
      : (effectivePaid >= finalTotal ? 'Selesai' : 'Dalam Proses');

    const oldItemsRes = await client.query('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    for (const item of oldItemsRes.rows) {
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemId = 'POI-' + Date.now() + Math.floor(Math.random() * 1000);
        const prodId = item.product_id || item.id;
        const qty = parseFloat(item.quantity || item.qty || 0);
        const cost = parseFloat(item.cost || item.cost_price || item.price || 0);

        await client.query('INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, cost) VALUES ($1, $2, $3, $4, $5)', [itemId, poId, prodId, qty, cost]);
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [qty, prodId]);
      }
    }

    await client.query('UPDATE purchase_orders SET date = ?, vendor_id = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, status = ?, payment_type_id = ?, due_date = ? WHERE id = ?', [poDate, vId, subtotal, finalDiskon, taxAmount, finalTotal, effectivePaid, status, pType, due_date, poId]);

    await client.query('DELETE FROM cash_transactions WHERE purchase_order_id = ?', [poId]);
    if (effectivePaid > 0) {
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      const userId = req.user.id;
      const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [pType]);
      const methodEdit = ptNameRes.rows[0]?.name || 'Transfer Bank';
      await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, purchase_order_id, payment_type_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ctId, poDate, 'OUT', 'Pembelian Stok', `Bayar PO ${poId} (Edit)`, effectivePaid, methodEdit, poId, pType, userId]);
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
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('UPDATE purchase_orders SET status = $1 WHERE id = $2', ['Batal', poId]);
    await client.query('DELETE FROM cash_transactions WHERE purchase_order_id = $1', [poId]);

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
app.put('/api/invoices/:id', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const invId = req.params.id;
  const { customer_id, customerId, date, paid, paid_amount, payment_type_id, due_date, items, discount, diskon } = req.body;
  const custId = customer_id || customerId;
  const pType = payment_type_id || 'PT-1';
  const invDate = date || new Date().toISOString().split('T')[0];

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
        subtotal += (parseFloat(item.price || item.sell_price || 0) * (parseFloat(item.quantity || item.qty || 0)));
      });
    }
    const finalDiskon = parseFloat(discount || diskon || 0);
    // PPN is calculated from DPP (Subtotal - Diskon)
    const taxAmount = ppnEnabled ? Math.round((subtotal - finalDiskon) * (pajakDefault / 100)) : 0;
    const finalTotal = subtotal - finalDiskon + taxAmount;

    // 2. Determine status based on payment type
    const instant = await isInstantPayment(pType);
    const finalPaid = parseFloat(paid || paid_amount || 0);
    const effectivePaid = instant ? finalTotal : finalPaid;
    const status = instant ? 'Lunas'
      : (effectivePaid >= finalTotal ? 'Lunas'
        : (effectivePaid > 0 ? 'Sebagian' : 'Belum Bayar'));

    const oldItemsRes = await client.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ?', [invId]);
    for (const item of oldItemsRes.rows) {
      await client.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    await client.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invId]);

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemId = 'IVI-' + Date.now() + Math.floor(Math.random() * 1000);
        const prodId = item.product_id || item.id;
        const qty = parseFloat(item.quantity || item.qty || 0);
        const price = parseFloat(item.price || item.sell_price || 0);
        // customer_fee & fee_notes: only persist if requester is admin
        const itemFee = req.user.role === 'admin' ? (parseFloat(item.customer_fee) || 0) : 0;
        const itemFeeNotes = req.user.role === 'admin' ? (item.fee_notes || null) : null;
        if (itemFee < 0) throw new Error('customer_fee tidak boleh negatif');

        // Snapshot the HPP (cost_price) at time of edit to prevent drift
        const costRes = await client.query('SELECT cost_price FROM products WHERE id = ?', [prodId]);
        const costSnapshot = parseFloat(costRes.rows[0]?.cost_price || item.cost_price || 0);

        await client.query(
          'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [itemId, invId, prodId, qty, price, costSnapshot, itemFee, itemFeeNotes]
        );
        await client.query('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, prodId]);
      }
    }

    if (due_date !== undefined) {
      await client.query('UPDATE sales_invoices SET date = ?, customer_id = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, status = ?, payment_type_id = ?, due_date = ? WHERE id = ?', [invDate, custId, subtotal, finalDiskon, taxAmount, finalTotal, effectivePaid, status, pType, due_date, invId]);
    } else {
      await client.query('UPDATE sales_invoices SET date = ?, customer_id = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, status = ?, payment_type_id = ? WHERE id = ?', [invDate, custId, subtotal, finalDiskon, taxAmount, finalTotal, effectivePaid, status, pType, invId]);
    }

    await client.query('DELETE FROM cash_transactions WHERE invoice_id = ? AND invoice_id IS NOT NULL AND (status IS NULL OR status = \'active\')', [invId]);
    if (effectivePaid > 0) {
      const ctPrefix = await getSetting('prefix_cash_transaction', 'CT');
      const ctId = await generateNextId(client, 'cash_transactions', ctPrefix);
      const ptNameRes = await client.query('SELECT name FROM payment_types WHERE id = ?', [pType]);
      const methodEdit = ptNameRes.rows[0]?.name || 'Transfer Bank';
      const userId = req.user.id;
      const cashCategory = status === 'Lunas' ? 'Penjualan' : 'Pelunasan Piutang';
      await client.query('INSERT INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, payment_type_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ctId, invDate, 'IN', cashCategory, `Pembayaran INV ${invId} (Edit)`, effectivePaid, methodEdit, invId, pType, userId]);
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

app.put('/api/invoices/:id/cancel', authenticateToken, authorizeRoles('admin', 'kasir'), async (req, res) => {
  const invId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query('SELECT status FROM sales_invoices WHERE id = $1', [invId]);
    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    if (checkRes.rows[0].status === 'Batal') {
      await client.query('ROLLBACK');
      return res.json({ success: true });
    }

    const itemsRes = await client.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id = $1', [invId]);
    for (const item of itemsRes.rows) {
      await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('UPDATE sales_invoices SET status = $1 WHERE id = $2', ['Batal', invId]);
    await client.query('DELETE FROM cash_transactions WHERE invoice_id = $1', [invId]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Cash Transactions (Arus Kas) ---
app.get('/api/finance/cashflow', authenticateToken, authorizeRoles('admin', 'finance'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cash_transactions ORDER BY date DESC, id DESC');
    res.json(result.rows.map(r => ({
      id: r.id,
      date: formatDateStr(r.date),
      type: r.type,
      category: r.category,
      desc: r.description,
      amount: parseFloat(r.amount),
      method: r.method
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    const salesRes = await pool.query("SELECT SUM(total) as revenue FROM sales_invoices WHERE status != 'Batal'");
    const revenue = parseFloat(salesRes.rows[0].revenue || 0);

    const hppRes = await pool.query(`
      SELECT SUM(ii.quantity * p.cost_price) as hpp 
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN sales_invoices si ON ii.invoice_id = si.id
      WHERE si.status != 'Batal'
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

    const piutangRes = await pool.query("SELECT SUM(total - paid_amount) as total FROM sales_invoices WHERE status != 'Batal'");
    const piutang = parseFloat(piutangRes.rows[0].total || 0);

    const inventoryRes = await pool.query("SELECT SUM(stock * cost_price) as total FROM products");
    const persediaan = parseFloat(inventoryRes.rows[0].total || 0);

    const hutangRes = await pool.query("SELECT SUM(total - paid_amount) as total FROM purchase_orders WHERE status != 'Batal'");
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
      WHERE si.status != 'Batal'
      GROUP BY p.id, p.name
      ORDER BY value DESC
      LIMIT 5
    `);

    const topCustomersRes = await pool.query(`
      SELECT c.name, SUM(si.total) as value
      FROM sales_invoices si
      JOIN customers c ON si.customer_id = c.id
      WHERE si.status != 'Batal'
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
    const hashedPassword = await bcrypt.hash(targetPassword, 10);
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
  const { name, email, role, active } = req.body;
  try {
    await pool.query(
      'UPDATE users SET name = $1, email = $2, role = $3, active = $4 WHERE id = $5',
      [name, email, role, active, id]
    );
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
    const bcrypt = require('bcrypt');
    const newAdminPassword = 'Admin@2026';
    const hashedPassword = await bcrypt.hash(newAdminPassword, 10);
    
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
        AND si.status NOT IN ('Batal', 'Dibatalkan')
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
        AND si.status NOT IN ('Batal', 'Dibatalkan')
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
        AND si.status NOT IN ('Batal', 'Dibatalkan')
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
        FROM sales_invoices WHERE DATE(date) BETWEEN ? AND ? AND status NOT IN ('Batal', 'Dibatalkan')
      `, [startDate, endDate]);
      const penjualanKotor = parseFloat(resPend.rows[0]?.kotor || 0);
      const diskon = parseFloat(resPend.rows[0]?.diskon || 0);
      const penjualanBersih = penjualanKotor - diskon;

      const resHpp = await client.query(`
        SELECT COALESCE(SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price_snapshot, 0), p.cost_price)), 0) AS hpp
        FROM invoice_items ii JOIN sales_invoices si ON si.id = ii.invoice_id LEFT JOIN products p ON p.id = ii.product_id
        WHERE DATE(si.date) BETWEEN ? AND ? AND si.status NOT IN ('Batal', 'Dibatalkan')
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
        WHERE status NOT IN ('Lunas', 'Dibatalkan', 'Batal') AND DATE(date) <= ?
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
