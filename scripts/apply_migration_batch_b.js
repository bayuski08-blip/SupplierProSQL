const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function applyBatchBMigration(dbName = 'supplierpro_clone') {
  console.log(`Applying Batch B migration to database: ${dbName}...`);
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
    const sqlFile = path.join(__dirname, '..', 'db', 'migration_batch_b.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    await conn.query(sql);
    console.log('Tables created or verified: stock_moves, return_counters, sales_returns, sales_return_items, purchase_returns, purchase_return_items');

    // 2. Add deposit to customers if not exists
    const [custCols] = await conn.query("SHOW COLUMNS FROM customers LIKE 'deposit'");
    if (custCols.length === 0) {
      await conn.query("ALTER TABLE customers ADD COLUMN deposit DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER credit_lmt");
      console.log('Added deposit column to customers table');
    } else {
      console.log('customers.deposit column already exists');
    }

    // 3. Add deposit to vendors if not exists
    const [vendCols] = await conn.query("SHOW COLUMNS FROM vendors LIKE 'deposit'");
    if (vendCols.length === 0) {
      await conn.query("ALTER TABLE vendors ADD COLUMN deposit DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER phone");
      console.log('Added deposit column to vendors table');
    } else {
      console.log('vendors.deposit column already exists');
    }

    // 4. Add return_amount to sales_invoices if not exists
    const [invCols] = await conn.query("SHOW COLUMNS FROM sales_invoices LIKE 'return_amount'");
    if (invCols.length === 0) {
      await conn.query("ALTER TABLE sales_invoices ADD COLUMN return_amount DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER paid_amount");
      console.log('Added return_amount column to sales_invoices table');
    } else {
      console.log('sales_invoices.return_amount column already exists');
    }

    // 5. Add return_amount to purchase_orders if not exists
    const [poCols] = await conn.query("SHOW COLUMNS FROM purchase_orders LIKE 'return_amount'");
    if (poCols.length === 0) {
      await conn.query("ALTER TABLE purchase_orders ADD COLUMN return_amount DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER paid_amount");
      console.log('Added return_amount column to purchase_orders table');
    } else {
      console.log('purchase_orders.return_amount column already exists');
    }

    console.log(`Batch B migration applied successfully to ${dbName}!`);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  const targetDb = process.argv[2] || 'supplierpro_clone';
  applyBatchBMigration(targetDb).catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
  });
}

module.exports = { applyBatchBMigration };

