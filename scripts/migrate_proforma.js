const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runProductionMigration() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME && process.env.DB_NAME !== 'undefined'
    ? process.env.DB_NAME
    : 'supplierpro';

  console.log(`Connecting to ${database} on ${host}:${port}...`);
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true
  });

  try {
    const sqlPath = path.join(__dirname, '..', 'db', 'migration_proforma.sql');
    console.log(`Reading ${sqlPath}...`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`Executing migration on ${database}...`);
    await conn.query(sql);
    console.log('✅ Migration executed successfully!');

    // Verify created tables
    const [tables] = await conn.query("SHOW TABLES LIKE 'proforma%'");
    console.log('Tables created:', tables);

    // Verify settings
    const [settingRows] = await conn.query("SELECT * FROM settings WHERE `key` = 'proforma_berlaku_hari'");
    console.log('Setting proforma_berlaku_hari:', settingRows);
  } finally {
    await conn.end();
  }
}

runProductionMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

