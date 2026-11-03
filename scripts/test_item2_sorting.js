/**
 * ITEM 2: Test sort by document number
 * Tests the ORDER BY changes on server.js for invoices, purchases, proformas
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: 'supplierpro_clone',
    port: process.env.DB_PORT || 3306
};

async function main() {
    const conn = await mysql.createConnection(DB_CONFIG);
    let pass = 0, fail = 0;

    function check(label, result, expected) {
        const ok = result === expected;
        console.log((ok ? '✅' : '❌') + ' ' + label);
        if (!ok) console.log(`   Expected: ${expected}\n   Got:      ${result}`);
        ok ? pass++ : fail++;
    }

    // ===== INVOICE ORDER BY =====
    console.log('\n=== TEST INVOICES ORDER BY ===');
    const [invRows] = await conn.query(`
        SELECT si.id FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        ORDER BY 
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN 3
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN 2
                WHEN si.id REGEXP '^[0-9]+$' THEN 1
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING(si.id, 5, 4) AS UNSIGNED)
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^[0-9]+$' THEN CAST(si.id AS UNSIGNED)
                ELSE 0
            END DESC,
            si.id DESC
        LIMIT 5
    `);
    console.log('Top 5 invoices:', invRows.map(r => r.id).join(', '));
    // The first row should be an INV-2026-xx-xxxxx format
    const firstInv = invRows[0]?.id || '';
    check('First invoice starts with INV-', firstInv.startsWith('INV-'), true);
    // INV rows should come before PIUTANG or numeric
    const invTypes = invRows.map(r => r.id.startsWith('INV') ? 'INV' : r.id.startsWith('PIUTANG') ? 'PIUTANG' : 'num');
    check('All top-5 invoices are INV format', invTypes.every(t => t === 'INV'), true);

    // Test paginated query (first page)
    const [invPage1] = await conn.query(`
        SELECT si.id FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        ORDER BY 
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN 3
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN 2
                WHEN si.id REGEXP '^[0-9]+$' THEN 1
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING(si.id, 5, 4) AS UNSIGNED)
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^[0-9]+$' THEN CAST(si.id AS UNSIGNED)
                ELSE 0
            END DESC,
            si.id DESC
        LIMIT ? OFFSET ?
    `, [80, 0]);
    const [invPage2] = await conn.query(`
        SELECT si.id FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        ORDER BY 
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN 3
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN 2
                WHEN si.id REGEXP '^[0-9]+$' THEN 1
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING(si.id, 5, 4) AS UNSIGNED)
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^[0-9]+$' THEN CAST(si.id AS UNSIGNED)
                ELSE 0
            END DESC,
            si.id DESC
        LIMIT ? OFFSET ?
    `, [80, 80]);
    const page1Ids = new Set(invPage1.map(r => r.id));
    const page2Ids = invPage2.map(r => r.id);
    const overlap = page2Ids.filter(id => page1Ids.has(id));
    check('Invoice page 1 and page 2 have no overlap (no duplicates)', overlap.length, 0);
    check('Invoice page 1 has 80 rows', invPage1.length, 80);

    // ===== PURCHASE ORDER ORDER BY =====
    console.log('\n=== TEST PURCHASE ORDERS ORDER BY ===');
    const [poRows] = await conn.query(`
        SELECT po.id FROM purchase_orders po
        LEFT JOIN vendors v ON po.vendor_id = v.id
        ORDER BY 
            CASE WHEN po.id REGEXP '^PO-[0-9]{4}' THEN 1 ELSE 0 END DESC,
            CASE WHEN po.id REGEXP '^PO-[0-9]{4}' THEN CAST(SUBSTRING(po.id, 4, 4) AS UNSIGNED) ELSE 0 END DESC,
            CASE WHEN po.id REGEXP '^PO-[0-9]{4}-[0-9]{2}' THEN CAST(SUBSTRING(po.id, 9, 2) AS UNSIGNED) ELSE 0 END DESC,
            CASE WHEN po.id REGEXP '^PO-' THEN CAST(SUBSTRING_INDEX(po.id, '-', -1) AS UNSIGNED) 
                 WHEN po.id REGEXP '^[0-9]+$' THEN CAST(po.id AS UNSIGNED)
                 ELSE 0 
            END DESC,
            po.id DESC
    `);
    console.log('All PO docs:', poRows.map(r => r.id).join(', '));
    // First PO should be newest (highest number)
    const [allPO] = await conn.query('SELECT id FROM purchase_orders ORDER BY id DESC LIMIT 1');
    console.log('Max PO id (string sort):', allPO[0]?.id);
    // Since all POs are PO-YYYY-MM-NNNNNN, newest = latest year/month/seq
    const firstPO = poRows[0]?.id || '';
    check('First PO starts with PO-', firstPO.startsWith('PO-'), true);

    // ===== PROFORMA ORDER BY =====
    console.log('\n=== TEST PROFORMAS ORDER BY ===');
    const [pfRows] = await conn.query(`
        SELECT p.pk, p.proforma_no FROM proformas p
        ORDER BY 
            CASE WHEN p.proforma_no REGEXP '^PF-[0-9]{4}' THEN 1 ELSE 0 END DESC,
            CASE WHEN p.proforma_no REGEXP '^PF-[0-9]{4}' THEN CAST(SUBSTRING(p.proforma_no, 4, 4) AS UNSIGNED) ELSE 0 END DESC,
            CASE WHEN p.proforma_no REGEXP '^PF-' THEN CAST(SUBSTRING_INDEX(p.proforma_no, '-', -1) AS UNSIGNED) ELSE 0 END DESC,
            p.pk DESC
    `);
    console.log('All proformas:', pfRows.map(r => r.proforma_no).join(', '));
    const firstPF = pfRows[0]?.proforma_no || '';
    check('First proforma starts with PF-', firstPF.startsWith('PF-'), true);
    // Verify sequence is descending (latest number first)
    if (pfRows.length >= 2) {
        const seq1 = parseInt(pfRows[0].proforma_no.split('-').pop());
        const seq2 = parseInt(pfRows[1].proforma_no.split('-').pop());
        check('Proforma sequence descending', seq1 >= seq2, true);
    }

    // ===== PERFORMANCE CHECK =====
    console.log('\n=== PERFORMANCE CHECK ===');
    const start = Date.now();
    await conn.query(`
        SELECT si.*, c.name as customer, pt.name as payment_type_name
        FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        LEFT JOIN payment_types pt ON si.payment_type_id = pt.id
        ORDER BY 
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN 3
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN 2
                WHEN si.id REGEXP '^[0-9]+$' THEN 1
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING(si.id, 5, 4) AS UNSIGNED)
                ELSE 0
            END DESC,
            CASE 
                WHEN si.id REGEXP '^INV[-/][0-9]{4}' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^PIUTANG-[0-9]+' THEN CAST(SUBSTRING_INDEX(si.id, '-', -1) AS UNSIGNED)
                WHEN si.id REGEXP '^[0-9]+$' THEN CAST(si.id AS UNSIGNED)
                ELSE 0
            END DESC,
            si.id DESC
        LIMIT 80 OFFSET 0
    `, []);
    const elapsed = Date.now() - start;
    console.log(`Invoice query with new ORDER BY: ${elapsed}ms`);
    check('Invoice query < 2000ms', elapsed < 2000, true);

    await conn.end();
    console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
    if (fail > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });

