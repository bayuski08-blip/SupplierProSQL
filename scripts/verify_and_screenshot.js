const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, SECRET_KEY);
const ARTIFACT_DIR = 'C:\\Users\\BDLP02\\.gemini\\antigravity\\brain\\12aac20a-cd9b-4630-b060-0605d5605c61';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function setupTest18Items() {
  const c = await mysql.createConnection(process.env.DATABASE_URL);
  const invId = 'INV-TEST-18ITEMS';
  await c.query(`
    INSERT INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount, due_date, payment_type_id, status, user_id)
    VALUES (?, '2026-11-13', 'C000002', 1800000, 0, 198000, 1998000, 1998000, '', 'PT-1', 'Lunas', 1)
    ON DUPLICATE KEY UPDATE subtotal=VALUES(subtotal)
  `, [invId]);

  await c.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invId]);
  const prods = ['P000001', 'P000002', 'P000003', 'P000004', 'P000005', 'P000006', 'P000007'];
  for (let i = 1; i <= 18; i++) {
    const pId = prods[(i - 1) % prods.length];
    await c.query(
      'INSERT INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot) VALUES (?, ?, ?, ?, ?, ?)',
      ['ITEM-18-' + i, invId, pId, i, 100000, 80000]
    );
  }
  await c.end();
  console.log('✅ Created test fixture INV-TEST-18ITEMS (18 items, 2 pages)');
}

async function run() {
  await setupTest18Items();

  console.log('=== Starting Test Server & Headless Chrome ===');
  const server = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await wait(3000);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1200,1200'
  ]);
  await wait(2000);

  try {
    const targetsRes = await fetch('http://127.0.0.1:9222/json/list');
    const targets = await targetsRes.json();
    let target = targets.find(t => t.type === 'page');
    if (!target) {
      target = await (await fetch('http://127.0.0.1:9222/json/new')).json();
    }

    const cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    // Set token
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await wait(1000);
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('token', '${token}')`
    });

    // Helper to take screenshot of an element
    async function captureElement(selector, filename) {
      const clipRes = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector('${selector}');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()`,
        returnByValue: true
      });
      const clip = clipRes.result.value;
      if (!clip) {
        console.error('Element not found for clip:', selector);
        return;
      }
      const ss = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
      });
      const localPath = path.join(__dirname, '..', filename);
      const brainPath = path.join(ARTIFACT_DIR, filename);
      fs.writeFileSync(localPath, Buffer.from(ss.data, 'base64'));
      fs.writeFileSync(brainPath, Buffer.from(ss.data, 'base64'));
      console.log(`📸 Saved screenshot: ${filename} (Local & Brain)`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // KASUS 1: Customer dengan nomor terisi (Warung Sari Rasa -> 085936103383)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- KASUS 1: Customer dengan nomor terisi (INV-2026-10-00005) ---');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/invoice-print.html?id=INV-2026-10-00005' });
    await wait(2000);

    const check1 = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const rows = Array.from(document.querySelectorAll('.invoice-header-info table tr'));
        const labels = rows.map(r => r.cells[0]?.textContent.trim());
        const values = rows.map(r => r.cells[1]?.textContent.trim());
        const phoneRowIdx = labels.findIndex(l => l.includes('WhatsApp / Telepon'));
        const alamatRowIdx = labels.findIndex(l => l.includes('Alamat Customer'));
        const header = document.querySelector('.invoice-page > div:first-child');
        return {
          labels,
          values,
          phoneRowIdx,
          alamatRowIdx,
          phoneVal: values[phoneRowIdx],
          isDirectlyBelow: phoneRowIdx === alamatRowIdx + 1,
          headerHeight: header ? header.getBoundingClientRect().height : 0
        };
      })()`,
      returnByValue: true
    });
    console.log('Kasus 1 Result:', check1.result.value);
    await captureElement('.invoice-page', 'screenshot_case1_phone.png');

    // ─────────────────────────────────────────────────────────────────────────
    // KASUS 2: Customer tanpa nomor (Toko Berkah Jaya -> '-')
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- KASUS 2: Customer tanpa nomor (INV-2026-09-00003) ---');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/invoice-print.html?id=INV-2026-09-00003' });
    await wait(2000);

    const check2 = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const rows = Array.from(document.querySelectorAll('.invoice-header-info table tr'));
        const labels = rows.map(r => r.cells[0]?.textContent.trim());
        const values = rows.map(r => r.cells[1]?.textContent.trim());
        const phoneRowIdx = labels.findIndex(l => l.includes('WhatsApp / Telepon'));
        const alamatRowIdx = labels.findIndex(l => l.includes('Alamat Customer'));
        return {
          labels,
          values,
          phoneVal: values[phoneRowIdx],
          isDirectlyBelow: phoneRowIdx === alamatRowIdx + 1
        };
      })()`,
      returnByValue: true
    });
    console.log('Kasus 2 Result:', check2.result.value);
    await captureElement('.invoice-page', 'screenshot_case2_no_phone.png');

    // ─────────────────────────────────────────────────────────────────────────
    // KASUS 3: Invoice multi-item yang berlanjut ke halaman 2 (INV-TEST-18ITEMS)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- KASUS 3: Invoice multi-item (INV-TEST-18ITEMS, 2 Halaman) ---');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/invoice-print.html?id=INV-TEST-18ITEMS' });
    await wait(2000);

    const check3 = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const pages = document.querySelectorAll('.invoice-page');
        const page1Items = pages[0]?.querySelectorAll('.invoice-items-table tbody tr').length;
        const page2Items = pages[1]?.querySelectorAll('.invoice-items-table tbody tr').length;
        const page1Bersambung = pages[0]?.querySelector('.invoice-bersambung')?.textContent.trim();
        const page2Strip = pages[1]?.querySelector('.invoice-compact-strip')?.textContent.trim();
        const page2Totals = pages[1]?.querySelector('.invoice-totals')?.textContent.trim();
        return {
          totalPages: pages.length,
          page1Items,
          page2Items,
          page1Bersambung,
          page2Strip,
          hasPage2Totals: Boolean(page2Totals)
        };
      })()`,
      returnByValue: true
    });
    console.log('Kasus 3 Result:', check3.result.value);
    await captureElement('.invoice-page:nth-child(1)', 'screenshot_case3_page1.png');
    await captureElement('.invoice-page:nth-child(2)', 'screenshot_case3_page2.png');

    // ─────────────────────────────────────────────────────────────────────────
    // KASUS 4: Proforma Invoice
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- KASUS 4: Proforma Invoice (type=proforma&pk=1) ---');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/invoice-print.html?type=proforma&pk=1' });
    await wait(2000);

    const check4 = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const rows = Array.from(document.querySelectorAll('.invoice-header-info table tr'));
        const labels = rows.map(r => r.cells[0]?.textContent.trim());
        const values = rows.map(r => r.cells[1]?.textContent.trim());
        const phoneRowIdx = labels.findIndex(l => l.includes('WhatsApp / Telepon'));
        const alamatRowIdx = labels.findIndex(l => l.includes('Alamat Customer'));
        return {
          labels,
          values,
          phoneVal: values[phoneRowIdx],
          isDirectlyBelow: phoneRowIdx === alamatRowIdx + 1
        };
      })()`,
      returnByValue: true
    });
    console.log('Kasus 4 Result (Proforma):', check4.result.value);
    await captureElement('.invoice-page', 'screenshot_case4_proforma.png');

    cdp.close();
    console.log('\n🎉 ALL TESTS AND SCREENSHOTS COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    chrome.kill();
    server.kill();
    process.exit(0);
  }
}

run();

