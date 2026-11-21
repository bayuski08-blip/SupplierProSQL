const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function applyBatchCMigration(dbName = 'supplierpro_clone') {
  console.log(`Applying Batch C migration to database: ${dbName}...`);
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: dbName,
    multipleStatements: true
  });

  try {
    // 1. Run tables creation SQL
    const sqlFile = path.join(__dirname, '..', 'db', 'migration_batch_c.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    await conn.query(sql);
    console.log('Tables created or verified: purchase_payment_counters, purchase_order_payments, settings, purchase_orders.is_outstanding_import');

    // 2. Add is_outstanding_import to purchase_orders if not exists
    const [poCols] = await conn.query("SHOW COLUMNS FROM purchase_orders LIKE 'is_outstanding_import'");
    if (poCols.length === 0) {
      await conn.query("ALTER TABLE purchase_orders ADD COLUMN is_outstanding_import TINYINT(1) NOT NULL DEFAULT 0 AFTER user_id");
      await conn.query("ALTER TABLE purchase_orders ADD INDEX idx_po_is_outstanding_import (is_outstanding_import)");
      console.log('Added is_outstanding_import column and index to purchase_orders table');
    } else {
      console.log('purchase_orders.is_outstanding_import column already exists');
    }

    console.log(`Batch C migration applied successfully to ${dbName}!`);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  const targetDb = process.argv[2] || 'supplierpro_clone';
  applyBatchCMigration(targetDb).catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
  });
}

module.exports = { applyBatchCMigration };

