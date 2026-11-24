/**
 * Runner Migrasi & Backfill HPP Snapshot (idempotent)
 * Penggunaan:
 *   node scripts/backfill_hpp.js
 *   DATABASE_URL=mysql://root:@127.0.0.1:3306/supplierpro_clone node scripts/backfill_hpp.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function run() {
  const dbUrl = process.env.DATABASE_URL
    || `mysql://${process.env.DB_USER || 'root'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'supplierpro'}`;

  const u = new URL(dbUrl);
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: parseInt(u.port, 10) || 3306,
    user: u.username,
    password: u.password,
    database: u.pathname.replace('/', ''),
    multipleStatements: true
  });

  try {
    const migSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migration_laporan_penjualan_hpp.sql'), 'utf8');
    await conn.query(migSql);
    console.log('[OK] migration_laporan_penjualan_hpp.sql dijalankan');

    const backfillSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'backfill_hpp_satuan.sql'), 'utf8');
    const [results] = await conn.query(backfillSql);
    const summaryRow = Array.isArray(results) ? results[results.length - 1]?.[0] : null;
    if (summaryRow) {
      console.log('[OK] Backfill summary:', summaryRow);
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[ERR] Backfill failed:', err);
      process.exit(1);
    });
}

module.exports = run;
