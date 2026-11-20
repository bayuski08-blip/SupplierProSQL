const mysql = require('mysql2/promise');

async function testDiagnosis() {
  const pool = mysql.createPool('mysql://root:@localhost:3306/supplierpro_clone');
  console.time('fetch 5000 products all=true query');
  const [rows] = await pool.query(`
    SELECT 
      p.*, 
      c.name as category, 
      u.name as unit,
      NULL AS harga_pricelist,
      p.sell_price AS harga_efektif,
      'master' AS sumber_harga,
      NULL AS pricelist_id,
      NULL AS pricelist_nama,
      NULL AS pricelist_kode
    FROM products p 
    LEFT JOIN product_categories c ON p.category_id = c.id 
    LEFT JOIN product_units u ON p.unit_id = u.id
    ORDER BY p.name ASC, p.id ASC
  `);
  console.timeEnd('fetch 5000 products all=true query');
  console.log('Returned rows:', rows.length);
  const jsonStr = JSON.stringify(rows);
  console.log('JSON payload size in MB:', (jsonStr.length / 1024 / 1024).toFixed(2));
  await pool.end();
}

testDiagnosis().catch(console.error);

