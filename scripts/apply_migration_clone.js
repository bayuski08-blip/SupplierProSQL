const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection('mysql://root:@localhost:3306/supplierpro_clone');
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM products LIKE 'is_active'");
    if (cols.length === 0) {
      await conn.query('ALTER TABLE products ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER unit_id');
      await conn.query('CREATE INDEX idx_products_is_active ON products(is_active)');
      console.log('Added is_active column and index to supplierpro_clone.products');
    } else {
      console.log('is_active column already exists in supplierpro_clone.products');
    }
  } finally {
    await conn.end();
  }
}

run().catch(console.error);

