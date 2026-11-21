const mysql = require('mysql2/promise');

async function main() {
    const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'supplierpro_clone' });
    const [custs] = await conn.query('SELECT id, name FROM customers LIMIT 5');
    console.log('Customers in supplierpro_clone:', custs);
    const [vends] = await conn.query('SELECT id, name FROM vendors LIMIT 5');
    console.log('Vendors in supplierpro_clone:', vends);
    await conn.end();
}

main().catch(console.error);
