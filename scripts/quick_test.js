const http = require('http');
const jwt = require('jsonwebtoken');

const SECRET = 'your-jwt-secret-key-change-in-production';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: 'Admin' }, SECRET, { expiresIn: '1h' });

const paths = [
    '/api/stock-moves?page=1&limit=3',
    '/api/invoices?page=1&limit=1',
    '/api/purchases?page=1&limit=1',
];

async function get(path) {
    return new Promise(resolve => {
        const opts = {
            hostname: '127.0.0.1',
            port: 3000,
            path,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        };
        const req = http.request(opts, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
                catch(e) { resolve({ status: r.statusCode, body: d.substring(0, 200) }); }
            });
        });
        req.on('error', e => resolve({ status: 'ERR', body: e.message }));
        req.end();
    });
}

async function run() {
    for (const p of paths) {
        const r = await get(p);
        console.log(`\nGET ${p}`);
        console.log(`  Status: ${r.status}`);
        if (r.status === 200) {
            const keys = Object.keys(r.body || {});
            console.log(`  Keys: ${keys.join(', ')}`);
            const rows = r.body.data || r.body.invoices || r.body.purchases || r.body;
            if (Array.isArray(rows) && rows.length > 0) {
                console.log(`  First item keys: ${Object.keys(rows[0]).join(', ')}`);
                console.log(`  Sample:`, JSON.stringify(rows[0]).substring(0, 200));
            }
        } else {
            console.log(`  Body:`, typeof r.body === 'string' ? r.body.substring(0,200) : JSON.stringify(r.body).substring(0,200));
        }
    }
}

run();

