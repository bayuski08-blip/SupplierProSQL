const mysql = require('mysql2/promise');
require('dotenv').config();

async function syncClone() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const sourceDb = 'supplierpro';
  const targetDb = 'supplierpro_clone';

  console.log(`Connecting to MySQL on ${host}:${port}...`);
  const conn = await mysql.createConnection({ host, port, user, password });

  try {
    console.log(`Dropping and re-creating ${targetDb}...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${targetDb}\``);
    await conn.query(`CREATE DATABASE \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    const [tables] = await conn.query(`SHOW TABLES FROM \`${sourceDb}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const r of tables) {
      const tbl = Object.values(r)[0];
      const [createRes] = await conn.query(`SHOW CREATE TABLE \`${sourceDb}\`.\`${tbl}\``);
      const createSql = createRes[0]['Create Table'];
      await conn.query(`USE \`${targetDb}\``);
      await conn.query(createSql);
      await conn.query(`INSERT INTO \`${targetDb}\`.\`${tbl}\` SELECT * FROM \`${sourceDb}\`.\`${tbl}\``);
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`Successfully synced ${tables.length} tables to ${targetDb}.`);
  } finally {
    await conn.end();
  }
}

syncClone().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});

