require('dotenv').config();
const mysql = require('mysql2/promise');

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/supplierpro';
  console.log(`Connecting to: ${dbUrl}`);
  const conn = await mysql.createConnection(dbUrl);

  try {
    // 1. Table pricelists
    await conn.query(`
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
    console.log('[OK] Table pricelists ready');

    // 2. Table pricelist_items
    await conn.query(`
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
    console.log('[OK] Table pricelist_items ready');

    // 3. Customer column
    const [cols] = await conn.query("SHOW COLUMNS FROM customers LIKE 'pricelist_id'");
    if (!cols || cols.length === 0) {
      await conn.query(`
        ALTER TABLE customers
        ADD COLUMN pricelist_id INT NULL AFTER customer_category_id,
        ADD CONSTRAINT fk_customers_pricelist
          FOREIGN KEY (pricelist_id) REFERENCES pricelists(id) ON DELETE SET NULL
      `);
      console.log('[OK] Added pricelist_id column to customers');
    } else {
      console.log('[OK] Column pricelist_id already exists in customers');
    }

    // 4. Prefix setting
    await conn.query("INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_pricelist', 'PL')");
    console.log('[OK] Setting prefix_pricelist ready');

    console.log('Migration finished successfully!');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = runMigration;
