const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.TEST_DB || 'supplierpro_clone';

  console.log(`Connecting to database ${database}...`);
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
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log(`Executing migration ${sqlPath}...`);
    await conn.query(sql);
    console.log('Migration executed successfully!');

    const [tables] = await conn.query("SHOW TABLES LIKE 'proforma%'");
    console.log('Proforma tables in DB:', tables);
  } finally {
    await conn.end();
  }
}

runMigration().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});

