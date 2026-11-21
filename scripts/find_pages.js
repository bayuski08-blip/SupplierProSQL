const fs = require('fs');
const html = fs.readFileSync('dashboard.html', 'utf8');
const lines = html.split('\n');

console.log('=== Page Sections ===');
lines.forEach((l, i) => {
  if (l.includes('<section class="page-section"')) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});

console.log('\n=== Modals ===');
lines.forEach((l, i) => {
  if (l.includes('class="modal-overlay"') || l.includes('id="modal-')) {
    console.log(`${i+1}: ${l.trim().slice(0, 80)}`);
  }
});

