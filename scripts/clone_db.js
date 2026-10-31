const mysql = require('mysql2/promise');

async function cloneDatabase() {
  const sourceDb = 'supplierpro';
  const targetDb = 'supplierpro_clone';

  console.log(`Cloning database ${sourceDb} -> ${targetDb}...`);
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: ''
  });

  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${targetDb}\``);
    await conn.query(`CREATE DATABASE \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`Created database ${targetDb}`);

    // Get all tables
    const [tables] = await conn.query(`SHOW TABLES FROM \`${sourceDb}\``);
    const tableKey = `Tables_in_${sourceDb}`;

    // Disable foreign key checks for schema & data copy
    await conn.query(`SET FOREIGN_KEY_CHECKS = 0`);

    for (const row of tables) {
      const tableName = row[tableKey];
      console.log(`Copying table ${tableName}...`);

      // Get create table statement
      const [createRes] = await conn.query(`SHOW CREATE TABLE \`${sourceDb}\`.\`${tableName}\``);
      const createSql = createRes[0]['Create Table'];

      // Create table in target db
      await conn.query(`USE \`${targetDb}\``);
      await conn.query(createSql);

      // Copy data
      await conn.query(`INSERT INTO \`${targetDb}\`.\`${tableName}\` SELECT * FROM \`${sourceDb}\`.\`${tableName}\``);
    }

    await conn.query(`SET FOREIGN_KEY_CHECKS = 1`);
    console.log(`Database cloned successfully to ${targetDb}!`);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  cloneDatabase().catch(err => {
    console.error('Failed to clone database:', err);
    process.exit(1);
  });
}

module.exports = { cloneDatabase };

