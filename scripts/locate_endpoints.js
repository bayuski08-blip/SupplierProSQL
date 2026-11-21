const fs = require('fs');
const srv = fs.readFileSync('server.js', 'utf8');
const lines = srv.split('\n');

function findLine(str) {
  const matches = [];
  lines.forEach((l, i) => {
    if (l.includes(str)) matches.push(i+1);
  });
  return matches;
}

console.log('generateInvoiceId:', findLine('async function generateInvoiceId'));
console.log('POST /api/invoices:', findLine("app.post('/api/invoices'"));
console.log('PUT /api/invoices/:id:', findLine("app.put('/api/invoices/:id'"));
console.log('POST /api/invoices/:id/cancel:', findLine("app.post('/api/invoices/:id/cancel'"));
console.log('POST /api/purchases:', findLine("app.post('/api/purchases'"));
console.log('PUT /api/purchases/:id:', findLine("app.put('/api/purchases/:id'"));
console.log('PUT /api/purchases/:id/cancel:', findLine("app.put('/api/purchases/:id/cancel'"));
console.log('POST /api/stock-adjust:', findLine("app.post('/api/stock-adjust'"));
console.log('POST /api/products/:id/stock-adjustment:', findLine("app.post('/api/products/:id/stock-adjustment'"));
console.log('POST /api/products:', findLine("app.post('/api/products'"));
console.log('PUT /api/products/:id:', findLine("app.put('/api/products/:id'"));
console.log('POST /api/proformas/:pk/convert:', findLine("/api/proformas/:pk/convert"));
console.log('PATCH /api/finance/cash-flow/:id/cancel:', findLine("app.patch('/api/finance/cash-flow/:id/cancel'"));

