const http = require('http');
const { spawn } = require('child_process');

const htmlBefore = `
<!DOCTYPE html>
<html>
<head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Inter', sans-serif; font-size: 8.5pt; margin: 0; padding: 4mm 5mm; }
  .invoice-header-info { font-size: 8.5pt; line-height: 1.25; color: #000; }
  .invoice-header-info table { font-size: 8.5pt; line-height: 1.25; }
</style>
</head>
<body>
  <div id="header" style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 3pt; border-bottom: 1.5pt solid #000; padding-bottom: 4pt; width: 19.5cm;">
    <div id="left-block" style="flex: 0 0 55%; display: flex; align-items: flex-start; gap: 8pt;">
      <div style="flex-shrink: 0; width: 68pt; height: 68px; border: 1px solid #ccc; display: flex; align-items: center; justify-content: center;">LOGO</div>
      <div class="invoice-header-info" style="flex: 1; min-width: 0;">
        <div style="font-size: 15pt; font-weight: bold; color: #000; line-height: 1.1; margin-bottom: 2pt; word-break: break-word;">Supplier Pro Toko</div>
        <table style="border: none; border-collapse: collapse;">
          <tr><td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; vertical-align: top; font-size: 8.5pt;">Alamat</td><td style="vertical-align: top; padding: 0.5pt 0; font-size: 8.5pt;">: <span>Jl. Bisnis Raya No. 123</span></td></tr>
          <tr><td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt;">Email</td><td style="padding: 0.5pt 0; font-size: 8.5pt;">: <span>toko@example.com</span></td></tr>
          <tr><td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt;">Tlp</td><td style="padding: 0.5pt 0; font-size: 8.5pt;">: <span>081234567890</span></td></tr>
        </table>
      </div>
    </div>
    <div id="right-block" class="invoice-header-info" style="flex: 0 0 44%; padding-top: 2pt;">
      <table style="border: none; width: 100%; border-collapse: collapse;">
        <tr><td id="label-nama" style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt; width: 100pt;">Nama Customer</td><td style="padding: 0.5pt 0; font-size: 8.5pt; word-break: break-word;">: Warung Sari Rasa</td></tr>
        <tr><td id="label-alamat" style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; vertical-align: top; font-size: 8.5pt;">Alamat Customer</td><td style="padding: 0.5pt 0; font-size: 8.5pt; vertical-align: top; word-break: break-word; max-width: 160pt; overflow: hidden;">: Jl. Sunia Negara No. 33, Pemogan</td></tr>
      </table>
    </div>
  </div>
</body>
</html>
`;

const htmlAfter = htmlBefore.replace(
  '</table>\n    </div>',
  '<tr><td id="label-phone" style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt;">WhatsApp / Telepon</td><td style="padding: 0.5pt 0; font-size: 8.5pt; word-break: break-word;">: 085936103383</td></tr>\n      </table>\n    </div>'
);

const server = http.createServer((req, res) => {
  if (req.url === '/before') res.end(htmlBefore);
  else if (req.url === '/after') res.end(htmlAfter);
  else res.end('ok');
}).listen(4321, async () => {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=9223', '--disable-gpu', '--no-sandbox']);
  await new Promise(r => setTimeout(r, 1500));
  
  try {
    const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    
    let msgId = 1;
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');

    // Measure before
    await send('Page.navigate', { url: 'http://localhost:4321/before' });
    await new Promise(r => setTimeout(r, 1000));
    const beforeMetrics = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        headerHeight: document.getElementById('header').getBoundingClientRect().height,
        leftHeight: document.getElementById('left-block').getBoundingClientRect().height,
        rightHeight: document.getElementById('right-block').getBoundingClientRect().height,
        labelNamaWidth: document.getElementById('label-nama').getBoundingClientRect().width,
        labelAlamatWidth: document.getElementById('label-alamat').getBoundingClientRect().width
      })`
    });

    // Measure after
    await send('Page.navigate', { url: 'http://localhost:4321/after' });
    await new Promise(r => setTimeout(r, 1000));
    const afterMetrics = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        headerHeight: document.getElementById('header').getBoundingClientRect().height,
        leftHeight: document.getElementById('left-block').getBoundingClientRect().height,
        rightHeight: document.getElementById('right-block').getBoundingClientRect().height,
        labelNamaWidth: document.getElementById('label-nama').getBoundingClientRect().width,
        labelAlamatWidth: document.getElementById('label-alamat').getBoundingClientRect().width,
        labelPhoneWidth: document.getElementById('label-phone').getBoundingClientRect().width
      })`
    });

    console.log('BEFORE:', JSON.parse(beforeMetrics.result.value));
    console.log('AFTER:', JSON.parse(afterMetrics.result.value));

    ws.close();
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    chrome.kill();
    server.close();
    process.exit(0);
  }
});

