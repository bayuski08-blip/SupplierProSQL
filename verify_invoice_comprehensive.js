const { spawn } = require('child_process');
const fs = require('fs');
const jwt = require('./node_modules/jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, SECRET_KEY);

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

async function run() {
  console.log('=== Starting Test Server & Chrome ===');
  // Start server
  const server = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'inherit' });
  await wait(2000);

  // Start Chrome
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1200,900'
  ]);
  await wait(1500);

  try {
    const targetsRes = await fetch('http://127.0.0.1:9222/json/list');
    const targets = await targetsRes.json();
    let target = targets.find(t => t.type === 'page');
    if (!target) {
      const newTarget = await (await fetch('http://127.0.0.1:9222/json/new')).json();
      target = newTarget;
    }

    const cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 1. Navigate to localhost to set localStorage token
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/' });
    await wait(1000);
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('token', '${token}')`
    });

    // 2. Test INV-2026-10-00005 (6 items)
    console.log('\n--- Testing INV-2026-10-00005 (6 items) ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/invoice-print.html?id=INV-2026-10-00005' });
    await wait(2000);

    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const headerInfo = document.querySelector('.invoice-header-info');
        const headerTable = headerInfo ? headerInfo.querySelector('table') : null;
        const table = document.querySelector('.invoice-items-table');
        const thead = table ? table.querySelector('thead') : null;
        const th = table ? table.querySelector('th') : null;
        const rows = table ? table.querySelectorAll('tbody tr') : [];
        const firstTd = rows.length > 0 ? rows[0].querySelector('td') : null;
        const firstRow = rows.length > 0 ? rows[0] : null;
        const bottom = document.querySelector('.invoice-bottom');
        const signatures = document.querySelector('.invoice-signatures');
        const totals = document.querySelector('.invoice-totals');

        const csHeader = headerInfo ? window.getComputedStyle(headerInfo) : {};
        const csTable = table ? window.getComputedStyle(table) : {};
        const csTh = th ? window.getComputedStyle(th) : {};
        const csTd = firstTd ? window.getComputedStyle(firstTd) : {};
        const csThead = thead ? window.getComputedStyle(thead) : {};
        const csTr = firstRow ? window.getComputedStyle(firstRow) : {};
        const csBottom = bottom ? window.getComputedStyle(bottom) : {};
        const csSignatures = signatures ? window.getComputedStyle(signatures) : {};
        const csTotals = totals ? window.getComputedStyle(totals) : {};

        return {
          itemCount: rows.length,
          headerFontSize: csHeader.fontSize,
          headerLineHeight: csHeader.lineHeight,
          tableFontSize: csTable.fontSize,
          tableLineHeight: csTable.lineHeight,
          thFontSize: csTh.fontSize,
          thFontWeight: csTh.fontWeight,
          thPadding: csTh.padding,
          thBorder: csTh.border,
          tdFontSize: csTd.fontSize,
          tdFontWeight: csTd.fontWeight,
          tdPadding: csTd.padding,
          tdBorder: csTd.border,
          theadDisplay: csThead.display,
          trBreakInside: csTr.breakInside || csTr.pageBreakInside,
          trHeight: firstRow ? firstRow.getBoundingClientRect().height : 0,
          thHeight: th ? th.getBoundingClientRect().height : 0,
          bottomBreakInside: csBottom.breakInside || csBottom.pageBreakInside,
          signaturesBreakInside: csSignatures.breakInside || csSignatures.pageBreakInside,
          totalsBreakInside: csTotals.breakInside || csTotals.pageBreakInside
        };
      })()`,
      returnByValue: true
    });

    console.log('Inspection Results for INV-2026-10-00005:', evalResult.result.value);

    // Generate A4 PDF for INV-2026-10-00005
    const pdf6A4 = await cdp.send('Page.printToPDF', {
      paperWidth: 8.27, // A4 width in inches (210mm)
      paperHeight: 11.69, // A4 height in inches (297mm)
      marginTop: 0.39, // ~10mm
      marginBottom: 0.39,
      marginLeft: 0.39,
      marginRight: 0.39,
      printBackground: true
    });
    fs.writeFileSync('test_invoice_6items_a4.pdf', Buffer.from(pdf6A4.data, 'base64'));
    console.log('Saved test_invoice_6items_a4.pdf');

    // Generate A5 PDF for INV-2026-10-00005
    const pdf6A5 = await cdp.send('Page.printToPDF', {
      paperWidth: 5.83, // A5 width in inches (148mm)
      paperHeight: 8.27, // A5 height in inches (210mm)
      marginTop: 0.25,
      marginBottom: 0.25,
      marginLeft: 0.25,
      marginRight: 0.25,
      printBackground: true
    });
    fs.writeFileSync('test_invoice_6items_a5.pdf', Buffer.from(pdf6A5.data, 'base64'));
    console.log('Saved test_invoice_6items_a5.pdf');

    // 3. Test INV-TEST-35ITEMS (35 items)
    console.log('\n--- Testing INV-TEST-35ITEMS (35 items) ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/invoice-print.html?id=INV-TEST-35ITEMS' });
    await wait(2000);

    const eval35 = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const rows = document.querySelectorAll('.invoice-items-table tbody tr');
        return {
          itemCount: rows.length,
          firstRowHeight: rows[0].getBoundingClientRect().height,
          lastRowHeight: rows[rows.length - 1].getBoundingClientRect().height,
          tableTotalHeight: document.querySelector('.invoice-items-table').getBoundingClientRect().height
        };
      })()`,
      returnByValue: true
    });
    console.log('Inspection Results for INV-TEST-35ITEMS:', eval35.result.value);

    // Generate A4 PDF for 35 items
    const pdf35A4 = await cdp.send('Page.printToPDF', {
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.39,
      marginBottom: 0.39,
      marginLeft: 0.39,
      marginRight: 0.39,
      printBackground: true
    });
    fs.writeFileSync('test_invoice_35items_a4.pdf', Buffer.from(pdf35A4.data, 'base64'));
    console.log('Saved test_invoice_35items_a4.pdf');

    cdp.close();
  } finally {
    chrome.kill();
    server.kill();
  }
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

