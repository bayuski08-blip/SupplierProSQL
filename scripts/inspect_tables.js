const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  console.log(`Connecting as ${user} to ${host}:${port}...`);

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: 'supplierpro_clone'
  });
  for (const t of ['customers', 'payment_types', 'users', 'sales_invoices']) {
    const [res] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
    console.log(`=== ${t} ===\n` + res[0]['Create Table'] + '\n');
  }
  await conn.end();
})();
