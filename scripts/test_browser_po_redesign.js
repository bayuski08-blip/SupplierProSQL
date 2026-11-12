const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browserPath = fs.existsSync(chromePath) ? chromePath : edgePath;

const TEST_PORT = 5007;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const CLONE_DB = 'supplierpro_clone';
const CDP_PORT = 9223;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert(desc, condition) {
    if (condition) {
        console.log(`  ✅ PASS: ${desc}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${desc}`);
        failed++;
    }
}

async function runBrowserTest() {
    console.log('====================================================');
    console.log('🌐 CDP BROWSER TEST: Modal PO UI & Interaksi Browser');
    console.log('====================================================\n');

    let serverProcess = null;
    let browserProcess = null;

    try {
        console.log(`1. Menjalankan server SupplierPro di port ${TEST_PORT} (DB: ${CLONE_DB})...`);
        serverProcess = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(TEST_PORT),
                DATABASE_URL: `mysql://root:@127.0.0.1:3306/${CLONE_DB}`,
                DB_NAME: CLONE_DB,
                JWT_SECRET: 'supplierpro_secret_key_demo'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Server start timeout')), 6000);
            serverProcess.stdout.on('data', (d) => {
                if (d.toString().includes('running on port')) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });

        console.log('2. Menjalankan browser headless Chrome...');
        browserProcess = spawn(browserPath, [
            '--headless=new',
            `--remote-debugging-port=${CDP_PORT}`,
            '--disable-gpu',
            '--no-sandbox',
            '--window-size=1280,800'
        ]);

        await sleep(1500);

        // Connect to CDP target
        const resList = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const pages = await resList.json();
        const page = pages[0];
        const wsUrl = page.webSocketDebuggerUrl;

        console.log('3. Terhubung ke CDP WebSocket:', wsUrl);
        const ws = new WebSocket(wsUrl);

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        let msgId = 1;
        function sendCommand(method, params = {}) {
            return new Promise((resolve) => {
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
        }

        async function evaluate(expression) {
            const res = await sendCommand('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            });
            return res?.result?.value;
        }

        await sendCommand('Page.enable');
        await sendCommand('DOM.enable');

        const jwtToken = require('jsonwebtoken').sign(
            { id: 1, username: 'admin', role: 'admin', name: 'Administrator' },
            'supplierpro_secret_key_demo',
            { expiresIn: '1h' }
        );

        // Inject token on new document
        await sendCommand('Page.addScriptToEvaluateOnNewDocument', {
            source: `
                localStorage.setItem('token', '${jwtToken}');
                localStorage.setItem('username', 'admin');
                localStorage.setItem('role', 'admin');
            `
        });

        console.log('4. Navigasi ke halaman dashboard...');
        await sendCommand('Page.navigate', { url: `${BASE_URL}/dashboard.html` });
        await sleep(2500);

        console.log('5. Menguji fungsi openAddPurchaseModal()...');
        await evaluate(`openAddPurchaseModal();`);
        await sleep(400);

        const isModalActive = await evaluate(`document.getElementById('modal-add-purchase').classList.contains('active')`);
        assert('Modal Buat PO berhasil terbuka dan aktif', isModalActive);

        const isSearchFocused = await evaluate(`document.activeElement.id === 'add-purchase-product-search'`);
        assert('Input pencarian produk otomatis terfokus saat modal dibuka', isSearchFocused);

        console.log('6. Menguji pencarian autocomplete dengan kata kunci "kopi"...');
        await evaluate(`(() => {
            const searchInput = document.getElementById('add-purchase-product-search');
            searchInput.value = 'kopi';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        // Debounce 150ms
        await sleep(350);

        const dropdownDisplay = await evaluate(`document.getElementById('add-purchase-product-dropdown').style.display`);
        assert('Dropdown muncul (display: block)', dropdownDisplay === 'block');

        const dropdownItemCount = await evaluate(`document.querySelectorAll('#add-purchase-product-dropdown .po-dropdown-item').length`);
        assert('Ditemukan hasil produk di dropdown', dropdownItemCount > 0);

        const firstItemHasHighlight = await evaluate(`document.querySelector('#add-purchase-product-dropdown .po-search-highlight') !== null`);
        assert('Keyword pencarian di-highlight dengan tag <mark>', firstItemHasHighlight);

        console.log('7. Menguji navigasi keyboard (Enter)...');
        const stateBefore = await evaluate(`({
            display: document.getElementById('add-purchase-product-dropdown').style.display,
            matches: poCurrentMatches.length,
            val: document.getElementById('add-purchase-product-search').value
        })`);
        console.log('  State before enter:', stateBefore);

        const keyResult = await evaluate(`(() => {
            const searchInput = document.getElementById('add-purchase-product-search');
            try {
                const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
                return { dispatched: searchInput.dispatchEvent(ev) };
            } catch(e) {
                return { error: e.message };
            }
        })()`);
        console.log('  Key dispatch result:', keyResult);
        await sleep(300);

        const itemsCount1 = await evaluate(`addPurchaseItems.length`);
        assert('Produk berhasil ditambahkan ke tabel PO (1 item)', itemsCount1 === 1);

        const inputAfterEnter = await evaluate(`document.getElementById('add-purchase-product-search').value`);
        assert('Input pencarian dikosongkan setelah produk dipilih', inputAfterEnter === '');

        const dropdownAfterEnter = await evaluate(`document.getElementById('add-purchase-product-dropdown').style.display`);
        assert('Dropdown tertutup setelah produk dipilih', dropdownAfterEnter === 'none');

        console.log('8. Menguji pencegahan duplikasi (menambah produk yang sama lagi)...');
        await evaluate(`(() => {
            const searchInput = document.getElementById('add-purchase-product-search');
            searchInput.value = 'kopi';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await sleep(400);

        await evaluate(`(() => {
            const searchInput = document.getElementById('add-purchase-product-search');
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        })()`);
        await sleep(300);

        const itemsCount2 = await evaluate(`addPurchaseItems.length`);
        assert('Tabel TIDAK membuat baris ganda (tetap 1 baris item)', itemsCount2 === 1);

        const itemQty = await evaluate(`addPurchaseItems[0].quantity`);
        assert('Qty produk bertambah menjadi 2', itemQty === 2);

        const rowHasHighlightClass = await evaluate(`document.querySelector('#add-purchase-items-container tr').classList.contains('po-row-highlight')`);
        assert('Baris item mendapatkan highlight class (.po-row-highlight)', rowHasHighlightClass);

        console.log('9. Menguji tombol hapus baris...');
        await evaluate(`(() => {
            const deleteBtn = document.querySelector('#add-purchase-items-container button');
            if (deleteBtn) deleteBtn.click();
        })()`);
        await sleep(300);

        const emptyText = await evaluate(`document.getElementById('add-purchase-items-container').innerText`);
        assert('Item terhapus dan tabel menampilkan "Belum ada item."', emptyText.includes('Belum ada item'));

        console.log('10. Menguji Escape menutup dropdown...');
        await evaluate(`(() => {
            const searchInput = document.getElementById('add-purchase-product-search');
            searchInput.value = 'kopi';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await sleep(400);

        const dropdownBeforeEsc = await evaluate(`document.getElementById('add-purchase-product-dropdown').style.display`);
        assert('Dropdown terbuka sebelum Esc', dropdownBeforeEsc === 'block');

        await evaluate(`(() => {
            const searchInput = document.getElementById('add-purchase-product-search');
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        })()`);
        await sleep(200);

        const dropdownAfterEsc = await evaluate(`document.getElementById('add-purchase-product-dropdown').style.display`);
        assert('Dropdown tertutup setelah Escape ditekan', dropdownAfterEsc === 'none');

        ws.close();
        console.log('\n====================================================');
        console.log(`HASIL AKHIR BROWSER: ${passed} PASSED, ${failed} FAILED`);
        console.log('====================================================\n');

        if (failed > 0) {
            process.exit(1);
        }

    } finally {
        if (browserProcess) browserProcess.kill();
        if (serverProcess) serverProcess.kill();
    }
}

runBrowserTest().catch(err => {
    console.error('Browser test failed:', err);
    process.exit(1);
});
