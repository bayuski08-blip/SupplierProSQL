const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..');
const cssPath = path.join(baseDir, 'dashboard.css');
const htmlPath = path.join(baseDir, 'dashboard.html');
const jsPath = path.join(baseDir, 'dashboard.js');

let css = fs.readFileSync(cssPath, 'utf8');
let html = fs.readFileSync(htmlPath, 'utf8');
let js = fs.readFileSync(jsPath, 'utf8');

console.log('--- Applying Fix for Bug 1: CSS Variables & Buttons ---');
// 1. Add missing root color tokens in dashboard.css
const rootTarget = `:root {
    --sidebar-width: 260px;`;
const rootReplacement = `:root {
    --sidebar-width: 260px;
    --rose-50: #fff1f2;
    --rose-100: #ffe4e6;
    --rose-200: #fecdd3;
    --rose-500: #f43f5e;
    --rose-600: #e11d48;
    --amber-50: #fffbeb;
    --amber-100: #fef3c7;
    --amber-500: #f59e0b;
    --amber-600: #d97706;
    --emerald-50: #ecfdf5;
    --emerald-100: #d1fae5;
    --emerald-200: #a7f3d0;
    --emerald-500: #10b981;
    --emerald-600: #059669;`;

if (css.includes(rootTarget) && !css.includes('--rose-600: #e11d48;')) {
    css = css.replace(rootTarget, rootReplacement);
    console.log('✓ Added missing color variables to :root in dashboard.css');
}

// 2. Enhance .btn-toolbar.danger and .btn-toolbar.warning in dashboard.css
const dangerBtnTarget = `.btn-toolbar.danger {
    background: linear-gradient(135deg, #e11d48, #be123c);
    color: white;
    border: none;
    box-shadow: 0 1px 3px rgba(225, 29, 72, 0.4);
}

.btn-toolbar.danger:hover {
    background: linear-gradient(135deg, #be123c, #9f1239);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(225, 29, 72, 0.4);
}`;

const dangerBtnReplacement = `.btn-toolbar.danger {
    background: linear-gradient(135deg, #e11d48, #be123c) !important;
    color: #ffffff !important;
    border: 1px solid #be123c !important;
    box-shadow: 0 1px 3px rgba(225, 29, 72, 0.4) !important;
}

.btn-toolbar.danger:hover {
    background: linear-gradient(135deg, #be123c, #9f1239) !important;
    color: #ffffff !important;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(225, 29, 72, 0.4) !important;
}

.btn-toolbar.warning {
    background: linear-gradient(135deg, #d97706, #b45309) !important;
    color: #ffffff !important;
    border: 1px solid #b45309 !important;
    box-shadow: 0 1px 3px rgba(217, 119, 6, 0.4) !important;
}

.btn-toolbar.warning:hover {
    background: linear-gradient(135deg, #b45309, #92400e) !important;
    color: #ffffff !important;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(217, 119, 6, 0.4) !important;
}`;

if (css.includes(dangerBtnTarget)) {
    css = css.replace(dangerBtnTarget, dangerBtnReplacement);
    console.log('✓ Enhanced .btn-toolbar.danger and added .btn-toolbar.warning in dashboard.css');
}

// 3. Ensure .combobox-dropdown.active and .combobox-dropdown.show display block
const comboboxShowTarget = `.combobox-dropdown.active {
    display: block;
}`;
const comboboxShowReplacement = `.combobox-dropdown.active,
.combobox-dropdown.show {
    display: block !important;
}`;

if (css.includes(comboboxShowTarget)) {
    css = css.replace(comboboxShowTarget, comboboxShowReplacement);
    console.log('✓ Updated .combobox-dropdown.active, .combobox-dropdown.show in dashboard.css');
}

// 4. Update modal confirmation buttons in dashboard.html
const deactBtnTarget = `<button class="btn-toolbar primary" style="background: var(--rose-600); border-color: var(--rose-600);" id="btn-confirm-deactivate-product" onclick="executeDeactivateProduct()">Nonaktifkan</button>`;
const deactBtnReplacement = `<button class="btn-toolbar warning" id="btn-confirm-deactivate-product" onclick="executeDeactivateProduct()"><i data-lucide="eye-off"></i> Ya, Nonaktifkan</button>`;

if (html.includes(deactBtnTarget)) {
    html = html.replace(deactBtnTarget, deactBtnReplacement);
    console.log('✓ Updated deactivation confirmation button in dashboard.html');
}

const delBtnTarget = `<button class="btn-toolbar primary" style="background: var(--rose-600); border-color: var(--rose-600);" id="btn-confirm-delete-product" onclick="executeDeleteProduct()">Hapus Produk</button>`;
const delBtnReplacement = `<button class="btn-toolbar danger" id="btn-confirm-delete-product" onclick="executeDeleteProduct()"><i data-lucide="trash-2"></i> Ya, Hapus</button>`;

if (html.includes(delBtnTarget)) {
    html = html.replace(delBtnTarget, delBtnReplacement);
    console.log('✓ Updated delete confirmation button in dashboard.html');
}

// Update other confirmation modals to ensure consistent styling
const delMasterBtnTarget = `<button class="btn-toolbar primary" id="btn-confirm-delete-master"
                    style="background: var(--rose-600); color: white; border-color: var(--rose-600);"
                    onclick="executeDeleteMaster()">Hapus</button>`;
const delMasterBtnReplacement = `<button class="btn-toolbar danger" id="btn-confirm-delete-master"
                    onclick="executeDeleteMaster()"><i data-lucide="trash-2"></i> Ya, Hapus</button>`;
if (html.includes(delMasterBtnTarget)) {
    html = html.replace(delMasterBtnTarget, delMasterBtnReplacement);
    console.log('✓ Updated delete master confirmation button in dashboard.html');
}

// 5. Update ComboboxSelect in dashboard.js for Bug 3
const comboOpenTarget = `    open() {
        this.isOpen = true;
        this.filter(this.input.value);
    }

    close() {
        this.isOpen = false;
        if (this.dropdown) {
            this.dropdown.classList.remove('show');
            this.dropdown.innerHTML = '';
        }
        this.highlightedIndex = -1;
        const currentVal = this.hidden ? this.hidden.value : '';
        const selectedItem = this.items.find(i => String(i.id) === String(currentVal));
        if (selectedItem) {
            this.input.value = selectedItem.label;
        } else if (!currentVal) {
            this.input.value = '';
        }
    }`;

const comboOpenReplacement = `    open() {
        if (this.items.length === 0 && Array.isArray(VENDORS) && VENDORS.length > 0) {
            this.setData(VENDORS.map(v => ({ id: v.id, label: v.name, code: v.idNumber || '' })));
        }
        this.isOpen = true;
        this.filter(this.input ? this.input.value : '');
    }

    close() {
        this.isOpen = false;
        if (this.dropdown) {
            this.dropdown.classList.remove('active', 'show');
            this.dropdown.style.display = 'none';
            this.dropdown.innerHTML = '';
        }
        this.highlightedIndex = -1;
        const currentVal = this.hidden ? this.hidden.value : '';
        const selectedItem = this.items.find(i => String(i.id) === String(currentVal));
        if (selectedItem) {
            this.input.value = selectedItem.label;
        } else if (!currentVal) {
            this.input.value = '';
        }
    }`;

if (js.includes(comboOpenTarget)) {
    js = js.replace(comboOpenTarget, comboOpenReplacement);
    console.log('✓ Updated ComboboxSelect open and close methods');
}

const comboRenderDropdownTarget = `        this.dropdown.classList.add('show');`;
const comboRenderDropdownReplacement = `        this.dropdown.classList.add('active', 'show');\n        this.dropdown.style.display = 'block';`;
if (js.includes(comboRenderDropdownTarget)) {
    js = js.replace(comboRenderDropdownTarget, comboRenderDropdownReplacement);
    console.log('✓ Updated ComboboxSelect renderDropdown to set active/show and display block');
}

// 6. Update openAddPurchaseModal in dashboard.js
const openPoTarget = `function openAddPurchaseModal() {
    // Reset all fields
    const vendorEl = document.getElementById('add-purchase-vendor');
    const dateEl = document.getElementById('add-purchase-date');
    const paidEl = document.getElementById('add-purchase-paid');
    const ptEl = document.getElementById('add-purchase-payment-type');
    const searchInput = document.getElementById('add-purchase-product-search');

    if (vendorEl) vendorEl.value = '';
    if (window.addPurchaseVendorCombobox) window.addPurchaseVendorCombobox.reset();`;

const openPoReplacement = `function openAddPurchaseModal() {
    // Ensure vendor combobox is initialized and populated
    if (!window.addPurchaseVendorCombobox) {
        initAddPurchaseVendorCombobox();
    }
    if (window.addPurchaseVendorCombobox) {
        if (Array.isArray(VENDORS) && VENDORS.length > 0) {
            window.addPurchaseVendorCombobox.setData(
                VENDORS.map(v => ({ id: v.id, label: v.name, code: v.idNumber || '' }))
            );
        }
        window.addPurchaseVendorCombobox.reset();
    }

    // Ensure active products are cached in background for search
    ensureProductsLoadedForPOS();

    // Reset all fields
    const vendorEl = document.getElementById('add-purchase-vendor');
    const dateEl = document.getElementById('add-purchase-date');
    const paidEl = document.getElementById('add-purchase-paid');
    const ptEl = document.getElementById('add-purchase-payment-type');
    const searchInput = document.getElementById('add-purchase-product-search');

    if (vendorEl) vendorEl.value = '';`;

if (js.includes(openPoTarget)) {
    js = js.replace(openPoTarget, openPoReplacement);
    console.log('✓ Updated openAddPurchaseModal with combobox init and background product loading');
}

// 7. Update renderPoDropdown to support fallback fetch if PRODUCTS is empty
const oldRenderPoStart = 'function renderPoDropdown(keyword) {';
const oldRenderPoEnd = 'dropdown.style.display = \'block\';\n    positionPoDropdown();\n}';
const rPoIdx = js.indexOf(oldRenderPoStart);
const rPoEndIdx = js.indexOf(oldRenderPoEnd, rPoIdx);

if (rPoIdx !== -1 && rPoEndIdx !== -1) {
    const fullOldRenderPo = js.slice(rPoIdx, rPoEndIdx + oldRenderPoEnd.length);

    const newRenderPo = `async function renderPoDropdown(keyword) {
    const dropdown = document.getElementById('add-purchase-product-dropdown');
    if (!dropdown) return;

    const q = (keyword || '').trim().toLowerCase();
    if (!q) {
        closePoDropdown();
        return;
    }

    // Bug 3 Fix: If PRODUCTS loaded, search in memory; otherwise fetch matching active products
    if (Array.isArray(PRODUCTS) && PRODUCTS.length > 0) {
        const productList = PRODUCTS.filter(p => (p.is_active !== 0 && p.is_active !== false));
        poCurrentMatches = productList.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.sku || '').toLowerCase().includes(q)
        );
    } else {
        try {
            const res = await fetch('/api/products?q=' + encodeURIComponent(q) + '&status=active&limit=20', {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const json = await res.json();
                const rows = Array.isArray(json) ? json : (json.data || []);
                poCurrentMatches = rows.map(p => ({
                    id: p.id,
                    sku: p.sku,
                    name: p.name,
                    price: parseFloat(p.sell_price || 0),
                    cost: parseFloat(p.cost_price || 0),
                    stock: parseFloat(p.stock || 0),
                    unit: p.unit || 'pcs',
                    is_active: p.is_active !== 0 && p.is_active !== false
                }));
            }
        } catch (e) {
            console.error('PO product search error:', e);
            poCurrentMatches = [];
        }
    }

    if (poCurrentMatches.length === 0) {
        dropdown.innerHTML = \`<div class="po-dropdown-empty">Produk tidak ditemukan</div>\`;
        dropdown.style.display = 'block';
        positionPoDropdown();
        return;
    }

    const displayed = poCurrentMatches.slice(0, 8);
    poSearchActiveIndex = 0;

    let itemsHtml = displayed.map((p, idx) => {
        const highlightedName = highlightMatch(p.name, q);
        const buyPrice = p.cost || p.price || 0;
        const metaText = \`Stok \${p.stock ?? 0} · \${rp(buyPrice)}\`;
        const selectedClass = idx === poSearchActiveIndex ? 'po-item-selected' : '';

        return \`
            <div class="po-dropdown-item \${selectedClass}" data-index="\${idx}" data-product-id="\${escapeHtml(p.id)}">
                <div class="po-item-name" style="font-size: 0.85rem; font-weight: 500; color: var(--gray-800); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    \${highlightedName}
                </div>
                <div class="po-item-meta" style="font-size: 0.78rem; color: var(--gray-500); white-space: nowrap; margin-left: 0.5rem;">
                    \${escapeHtml(metaText)}
                </div>
            </div>
        \`;
    }).join('');

    const countText = \`\${poCurrentMatches.length} hasil · ↑↓ pilih · Enter tambah\`;
    dropdown.innerHTML = \`
        <div class="po-dropdown-list">
            \${itemsHtml}
        </div>
        <div class="po-dropdown-footer">
            \${countText}
        </div>
    \`;

    dropdown.querySelectorAll('.po-dropdown-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const prodId = el.dataset.productId;
            const prod = poCurrentMatches.find(p => String(p.id) === String(prodId));
            if (prod) addProductToPo(prod);
        });
    });

    dropdown.style.display = 'block';
    positionPoDropdown();
}`;

    js = js.replace(fullOldRenderPo, newRenderPo);
    console.log('✓ Replaced renderPoDropdown with resilient in-memory & API search');
}

// 8. Update addProductToPo and renderAddPurchaseItems to preserve product_name
const addProdToPoTarget = `        addPurchaseItems.push({
            product_id: prod.id,
            quantity: 1,
            price: prod.cost || prod.price || 0
        });`;

const addProdToPoReplacement = `        addPurchaseItems.push({
            product_id: prod.id,
            product_name: prod.name,
            unit: prod.unit || 'pcs',
            quantity: 1,
            price: prod.cost || prod.price || 0
        });`;

if (js.includes(addProdToPoTarget)) {
    js = js.replace(addProdToPoTarget, addProdToPoReplacement);
    console.log('✓ Updated addProductToPo to store product_name and unit');
}

const renderAddPoItemTarget = `const product = PRODUCTS.find(p => String(p.id) === String(item.product_id)) || { name: item.product_id, unit: 'pcs' };`;
const renderAddPoItemReplacement = `const product = (Array.isArray(PRODUCTS) ? PRODUCTS.find(p => String(p.id) === String(item.product_id)) : null) || { name: item.product_name || item.product_id, unit: item.unit || 'pcs' };`;

if (js.includes(renderAddPoItemTarget)) {
    js = js.replace(renderAddPoItemTarget, renderAddPoItemReplacement);
    console.log('✓ Updated renderAddPurchaseItems to fallback gracefully to item.product_name');
}

// 9. Bug 2: Inject Real-time Reactive Dashboard Auto-Refresh & Cross-Tab Sync
const reactiveSyncModule = `// ==========================================================================
// BUG 2: REAL-TIME REACTIVE DASHBOARD AUTO-REFRESH & CROSS-TAB SYNC
// ==========================================================================
let syncChannel = null;
try {
    if (typeof BroadcastChannel !== 'undefined') {
        syncChannel = new BroadcastChannel('supplierpro_data_sync');
    }
} catch (e) {
    console.warn('BroadcastChannel not supported, falling back to storage event', e);
}

function notifyDataChange(type = 'general', payload = {}) {
    const timestamp = Date.now();
    const message = { type, timestamp, payload };

    // 1. Post to BroadcastChannel
    if (syncChannel) {
        try {
            syncChannel.postMessage(message);
        } catch (e) {
            console.error('Failed to broadcast data change', e);
        }
    }

    // 2. Fallback: trigger storage event for tabs in same origin
    try {
        localStorage.setItem('supplierpro_sync_event', JSON.stringify(message));
    } catch (_) {}

    // 3. Immediately refresh local dashboard if on dashboard page
    if (currentPage === 'dashboard') {
        refreshDashboardData(true);
    }
}

function handleSyncMessage(msg) {
    if (!msg || !msg.timestamp) return;
    console.log('[Sync] Received data change notification:', msg.type);

    if (currentPage === 'dashboard') {
        refreshDashboardData(true);
    }
}

if (syncChannel) {
    syncChannel.onmessage = (event) => {
        handleSyncMessage(event.data);
    };
}

window.addEventListener('storage', (e) => {
    if (e.key === 'supplierpro_sync_event' && e.newValue) {
        try {
            const data = JSON.parse(e.newValue);
            handleSyncMessage(data);
        } catch (_) {}
    }
});

let isRefreshingDashboard = false;
async function refreshDashboardData(silent = false) {
    if (isRefreshingDashboard) return;
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();

    isRefreshingDashboard = true;
    try {
        const canSeeFinance = ['admin', 'finance', 'owner'].includes(role);

        // Fetch dashboard summary with cache: 'no-store'
        const summaryPromise = fetch('/api/dashboard/summary', {
            headers: getAuthHeaders(),
            cache: 'no-store'
        }).then(r => r.ok ? r.json() : null).then(data => {
            if (data) DASHBOARD_SUMMARY = data;
        }).catch(err => {
            if (!silent) console.warn('Silent refresh summary error:', err);
        });

        const promises = [summaryPromise];

        if (canSeeFinance) {
            const daysTrend = 7;
            const trendPromise = fetch('/api/dashboard/sales-trend?days=' + daysTrend, {
                headers: getAuthHeaders(),
                cache: 'no-store'
            }).then(r => r.ok ? r.json() : null).then(data => {
                if (data) SALES_CHART_DATA = data;
            }).catch(() => {});

            const compPromise = fetch('/api/dashboard/sales-composition?days=30', {
                headers: getAuthHeaders(),
                cache: 'no-store'
            }).then(r => r.ok ? r.json() : null).then(data => {
                if (data) DONUT_DATA = data;
            }).catch(() => {});

            promises.push(trendPromise, compPromise);
        }

        await Promise.allSettled(promises);

        if (currentPage === 'dashboard') {
            renderDashboard();
            if (canSeeFinance) {
                renderSalesChart();
                renderDonutChart();
            }
        }
    } catch (err) {
        if (!silent) console.error('Error refreshing dashboard:', err);
    } finally {
        isRefreshingDashboard = false;
    }
}

let dashboardAutoRefreshTimer = null;
function startDashboardAutoRefresh() {
    if (dashboardAutoRefreshTimer) clearInterval(dashboardAutoRefreshTimer);
    dashboardAutoRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && currentPage === 'dashboard') {
            refreshDashboardData(true);
        }
    }, 30000);
}

// Event listeners for page visibility and focus
window.addEventListener('pageshow', () => {
    if (currentPage === 'dashboard') {
        refreshDashboardData(true);
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentPage === 'dashboard') {
        refreshDashboardData(true);
    }
});

window.addEventListener('focus', () => {
    if (currentPage === 'dashboard') {
        refreshDashboardData(true);
    }
});
`;

if (!js.includes('supplierpro_data_sync')) {
    // Inject near start of dashboard.js
    const marker = '// ---------- Dynamic Data ----------';
    js = js.replace(marker, reactiveSyncModule + '\n' + marker);
    console.log('✓ Injected real-time auto-refresh and cross-tab sync module');
}

// 10. Start dashboard auto-refresh timer in init()
const initTimerTarget = `if (typeof lucide !== 'undefined') lucide.createIcons();\n}`;
const initTimerReplacement = `if (typeof lucide !== 'undefined') lucide.createIcons();\n    startDashboardAutoRefresh();\n}`;

if (js.includes(initTimerTarget) && !js.includes('startDashboardAutoRefresh();')) {
    js = js.replace(initTimerTarget, initTimerReplacement);
    console.log('✓ Started dashboard auto-refresh timer in init()');
}

// 11. Refresh dashboard when user navigates to dashboard
const navDashboardTarget = `    // If current page is not allowed, navigate to the first allowed page
    if (!allowedPages.includes(currentPage)) {
        const firstAllowed = allowedPages[0] || 'dashboard';
        navigateTo(firstAllowed);
    }`;

// Look in navigateTo(page):
const navToTarget = `    currentPage = page;\n\n    // A1: Toggle pos-active class`;
const navToReplacement = `    currentPage = page;\n\n    if (page === 'dashboard') {\n        refreshDashboardData(true);\n    }\n\n    // A1: Toggle pos-active class`;

if (js.includes(navToTarget) && !js.includes('if (page === \'dashboard\') {\n        refreshDashboardData(true);')) {
    js = js.replace(navToTarget, navToReplacement);
    console.log('✓ Triggered refreshDashboardData in navigateTo when visiting dashboard');
}

// 12. Hook notifyDataChange into mutations
const hooks = [
    // POS Checkout
    {
        target: `openModal('modal-checkout-success');`,
        insert: `notifyDataChange('sales');`
    },
    // Cancel invoice
    {
        target: `showToast('Invoice ' + invoiceId + ' berhasil dibatalkan', 'success');`,
        insert: `notifyDataChange('invoice_cancel');`
    },
    // Save invoice edits
    {
        target: `showToast('Perubahan invoice berhasil disimpan', 'success');`,
        insert: `notifyDataChange('invoice_edit');`
    },
    // Save purchase
    {
        target: `showToast(isEdit ? 'Purchase order berhasil diperbarui' : 'Purchase order berhasil disimpan', 'success');`,
        insert: `notifyDataChange('purchase');`
    },
    // Cancel purchase
    {
        target: `showToast('Purchase Order #' + purchaseId + ' berhasil dibatalkan', 'success');`,
        insert: `notifyDataChange('purchase_cancel');`
    },
    // Stock opname
    {
        target: `showToast('Stok berhasil disesuaikan!', 'success');`,
        insert: `notifyDataChange('stock_opname');`
    },
    // Submit payment
    {
        target: `showToast('Pembayaran invoice ' + invoiceId + ' berhasil dicatat!', 'success');`,
        insert: `notifyDataChange('payment');`
    },
    // Void payment
    {
        target: `showToast('Pembayaran berhasil di-void (dibatalkan)', 'success');`,
        insert: `notifyDataChange('payment_void');`
    },
    // Delete outstanding invoice
    {
        target: `showToast('Invoice outstanding berhasil dihapus!', 'success');`,
        insert: `notifyDataChange('invoice_delete');`
    },
    // Save product
    {
        target: `showToast(isEdit ? 'Produk berhasil diperbarui!' : 'Produk berhasil ditambahkan!', 'success');`,
        insert: `notifyDataChange('product');`
    },
    // Toggle product status
    {
        target: `showToast(data.message || (is_active ? 'Produk berhasil diaktifkan!' : 'Produk berhasil dinonaktifkan!'), 'success');`,
        insert: `notifyDataChange('product_status');`
    },
    // Delete product
    {
        target: `showToast('Produk berhasil dihapus!', 'success');`,
        insert: `notifyDataChange('product_delete');`
    },
    // Cash transaction save
    {
        target: `showToast(isEdit ? 'Transaksi kas berhasil diperbarui' : 'Transaksi kas berhasil dicatat', 'success');`,
        insert: `notifyDataChange('cash');`
    }
];

hooks.forEach(({ target, insert }) => {
    if (js.includes(target)) {
        js = js.replace(target, target + '\n            ' + insert);
        console.log(`✓ Hooked notifyDataChange into: ${insert}`);
    }
});

fs.writeFileSync(cssPath, css, 'utf8');
fs.writeFileSync(htmlPath, html, 'utf8');
fs.writeFileSync(jsPath, js, 'utf8');

console.log('\nAll updates written successfully!');

