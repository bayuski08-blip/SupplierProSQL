const fs = require('fs');
const srv = fs.readFileSync('server.js', 'utf8');
const lines = srv.split('\n');

console.log('=== Invoices & Piutang Endpoints ===');
lines.forEach((l, i) => {
  if (l.includes("app.get('/api/invoices") || l.includes("app.get('/api/piutang") || l.includes("app.get('/api/hutang") || l.includes("app.get('/api/purchases")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});

