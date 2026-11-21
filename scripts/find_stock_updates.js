const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');

function findStockUpdates() {
  const lines = server.split('\n');
  const results = [];
  lines.forEach((line, index) => {
    if (line.match(/UPDATE\s+products\s+SET/i) || line.match(/products\s+SET\s+stock/i) || line.match(/stock\s*=\s*stock/i)) {
      // get surrounding lines
      const start = Math.max(0, index - 5);
      const end = Math.min(lines.length - 1, index + 8);
      results.push({
        lineNum: index + 1,
        snippet: lines.slice(start, end + 1).join('\n')
      });
    }
  });
  return results;
}

const updates = findStockUpdates();
console.log(`Found ${updates.length} stock update occurrences:`);
updates.forEach((u, i) => {
  console.log(`\n--- Occurrence #${i + 1} at line ${u.lineNum} ---`);
  console.log(u.snippet);
});

