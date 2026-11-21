const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [dbs] = await conn.query('SHOW DATABASES');
    console.log('Databases:', dbs.map(d => Object.values(d)[0]));
    const [tables] = await conn.query('SHOW TABLES');
    console.log('Tables in current DB:', tables.map(t => Object.values(t)[0]));
    
    // Check purchase_orders columns
    const [poCols] = await conn.query('DESCRIBE purchase_orders');
    console.log('\nColumns in purchase_orders:');
    console.log(poCols.map(c => `${c.Field} (${c.Type}, Null:${c.Null}, Key:${c.Key}, Default:${c.Default})`).join('\n'));
    
    // Check sales_invoices columns
    const [siCols] = await conn.query('DESCRIBE sales_invoices');
    console.log('\nColumns in sales_invoices:');
    console.log(siCols.map(c => `${c.Field} (${c.Type}, Null:${c.Null}, Key:${c.Key}, Default:${c.Default})`).join('\n'));

    // Check sales_invoice_payments columns
    const [sipCols] = await conn.query('DESCRIBE sales_invoice_payments');
    console.log('\nColumns in sales_invoice_payments:');
    console.log(sipCols.map(c => `${c.Field} (${c.Type}, Null:${c.Null}, Key:${c.Key}, Default:${c.Default})`).join('\n'));
    
    // Check payment_counters
    const [pcRows] = await conn.query('SELECT * FROM payment_counters');
    console.log('\npayment_counters:', pcRows);
    
    // Check settings for prefixes
    const [setRows] = await conn.query('SELECT * FROM settings WHERE `key` LIKE "%prefix%"');
    console.log('\nPrefix settings:', setRows);
    
    // Check purchase_orders count and status
    const [poStatus] = await conn.query('SELECT status, COUNT(*) as cnt, SUM(total) as tot, SUM(paid_amount) as paid FROM purchase_orders GROUP BY status');
    console.log('\nPurchase orders by status:', poStatus);

    // Check sample purchase_orders
    const [samplePo] = await conn.query('SELECT id, date, vendor_id, total, paid_amount, status, payment_type_id, due_date, paid_date, is_outstanding_import FROM purchase_orders LIMIT 10');
    console.log('\nSample purchase_orders:', samplePo);
    
    // Check cash transactions categories
    const [ctCats] = await conn.query('SELECT DISTINCT category, type FROM cash_transactions');
    console.log('\nCash transaction categories:', ctCats);

    // Check existing cash_transactions for purchase_order_id
    const [poCash] = await conn.query('SELECT * FROM cash_transactions WHERE purchase_order_id IS NOT NULL LIMIT 5');
    console.log('\nSample cash_transactions with purchase_order_id:', poCash);

    await conn.end();
  } catch (e) {
    console.error('Error:', e);
  }
})();

