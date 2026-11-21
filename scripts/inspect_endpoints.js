const fs = require('fs');
const server = fs.readFileSync('server.js', 'utf8');
const lines = server.split('\n');

function printRange(start, end, title) {
  console.log(`\n=== ${title} (lines ${start}-${end}) ===`);
  console.log(lines.slice(start - 1, end).join('\n'));
}

// 1. Line 3840-3880
printRange(3840, 3885, 'Endpoint around line 3865');

// 2. Line 1260-1310 (POST /api/products)
printRange(1260, 1310, 'POST /api/products');

// 3. Search for product import
console.log('\n=== Search import in server.js ===');
lines.forEach((l, i) => {
  if (l.toLowerCase().includes('/import') || l.toLowerCase().includes('import products') || l.toLowerCase().includes('import-products')) {
    console.log(`L${i+1}: ${l.trim().slice(0, 120)}`);
  }
});

// 4. Search for delete purchase / delete invoice
console.log('\n=== Search DELETE invoices/purchases in server.js ===');
lines.forEach((l, i) => {
  if (l.includes("app.delete('/api/invoices") || l.includes("app.delete('/api/purchases")) {
    console.log(`L${i+1}: ${l.trim().slice(0, 120)}`);
  }
});

