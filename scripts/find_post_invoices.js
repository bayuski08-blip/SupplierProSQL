const fs = require('fs');
const srv = fs.readFileSync('server.js', 'utf8');
const lines = srv.split('\n');

lines.forEach((l, i) => {
  if (l.includes("app.post('/api/invoices'") || l.includes("app.post('/api/invoices',") || l.includes("app.post('/api/invoices\"")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});

