const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function diagnose() {
  console.log('--- ENV SETTINGS ---');
  console.log('DB_HOST:', process.env.DB_HOST);
  console.log('DB_PORT:', process.env.DB_PORT);
  console.log('DB_USER:', process.env.DB_USER);
  console.log('DB_NAME:', process.env.DB_NAME);

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';

  // 1. Check all databases on MySQL
  const rootConn = await mysql.createConnection({ host, port, user, password });
  const [dbs] = await rootConn.query('SHOW DATABASES');
  console.log('\nAvailable databases:', dbs.map(d => Object.values(d)[0]));

  for (const db of ['supplierpro', 'u945953739_supplierpro', 'supplierpro_clone']) {
    try {
      const conn = await mysql.createConnection({ host, port, user, password, database: db });
      const [pf] = await conn.query("SHOW TABLES LIKE 'proforma%'");
      console.log(`\nIn database [${db}]:`);
      console.log('  Proforma tables:', pf.map(r => Object.values(r)[0]));
      if (pf.length > 0) {
        const [cnt] = await conn.query("SELECT COUNT(*) as c FROM proformas");
        console.log('  Proformas count:', cnt[0].c);
        const [itemsCnt] = await conn.query("SELECT COUNT(*) as c FROM proforma_items");
        console.log('  Proforma items count:', itemsCnt[0].c);
      }
      await conn.end();
    } catch (e) {
      console.log(`\nIn database [${db}]: ERROR ->`, e.message);
    }
  }

  await rootConn.end();
}

diagnose().catch(err => console.error(err));

