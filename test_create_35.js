const mysql = require('./node_modules/mysql2/promise');

async function main() {
  const c = await mysql.createConnection('mysql://root:@localhost:3306/supplierpro');
  const invId = 'INV-TEST-35ITEMS';
  await c.query(`
    INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount, due_date, payment_type_id, status, user_id)
    VALUES (?, '2026-10-29', 'C000001', 1000000, 0, 110000, 1110000, 1110000, '', 'PT-1', 'Lunas', 1)
    ON DUPLICATE KEY UPDATE subtotal=VALUES(subtotal)
  `, [invId]);

  await c.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invId]);

  const prods = ['P000001', 'P000002', 'P000003', 'P000004', 'P000005', 'P000006', 'P000007'];
  for (let i = 1; i <= 35; i++) {
    const pId = prods[(i - 1) % prods.length];
    await c.query(
      'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot) VALUES (?, ?, ?, ?, ?, ?)',
      ['ITEM-35-' + i, invId, pId, i, 10000 * i, 8000 * i]
    );
  }

  const [cnt] = await c.query('SELECT count(*) as count FROM invoice_items WHERE invoice_id = ?', [invId]);
  console.log('Successfully created test invoice INV-TEST-35ITEMS with count:', cnt[0].count);
  await c.end();
}

main().catch(console.error);

