// ==========================================================================
// SupplierPro Dashboard — JavaScript
// ==========================================================================

// Auth check
if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

// BATCH C: State Variables
let selectedHutangIds = new Set();
let _voidPurchaseId = null;
let _voidPurchasePaymentId = null;
let _currentHutangPO = null;
let parsedHutangImportData = null;

// ==========================================================================
// TOAST NOTIFICATION SYSTEM
// ==========================================================================
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    const icons = { success: '✓', error: '✕', warning: '⚠️', info: 'ℹ️' };
    toast.style.cssText = `background:${colors[type] || colors.success};color:white;padding:0.75rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);display:flex;align-items:center;gap:0.5rem;min-width:200px;max-width:360px;transform:translateX(120%);transition:transform 0.3s ease;`;
    toast.innerHTML = `<span style="font-size:1rem;">${icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });
    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// PO Item Management
function addPurchaseItemRow(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const prefix = containerId.startsWith('edit') ? 'edit' : 'add';
    const row = document.createElement('div');
    row.className = `form-row ${prefix}-purchase-item`;
    row.style.marginBottom = '0.5rem';

    const productOptions = PRODUCTS.map(p => `<option value="${p.id}">${p.name} (Stok: ${p.stock})</option>`).join('');

    row.innerHTML = `
        <div class="form-group" style="flex: 2;">
            <select class="form-input item-product">
                <option value="" disabled selected>Pilih Produk...</option>
                ${productOptions}
            </select>
        </div>
        <div class="form-group" style="flex: 1;">
            <input type="number" class="form-input item-qty" placeholder="Qty">
        </div>
        <div class="form-group" style="flex: 1.5;">
            <input type="number" class="form-input item-price" placeholder="Harga Beli">
        </div>
        <div class="form-group" style="flex: 0.5;">
            <button type="button" class="btn-toolbar secondary" style="color:var(--rose-600);" onclick="this.parentElement.parentElement.remove()">
                <i data-lucide="x" style="width:14px; height:14px;"></i>
            </button>
        </div>
    `;
    container.appendChild(row);
    if (window.lucide) lucide.createIcons();
}

// ---------- Currency Formatter ----------
function rp(n) {
    return 'Rp ' + Number(n).toLocaleString('id-ID');
}


/**
 * formatNumTrim(val) — Normalisasi angka DECIMAL string DB ke tampilan bersih.
 * 1.0000->1, 1.5->1.5, 205000.0->205000, 0.25->0.25
 */
/**
 * formatNumberTrim(val) — Normalisasi angka dari DECIMAL string DB ke tampilan bersih.
 * Aturan: 1.0000 -> 1, 10.00 -> 10, 205000.0 -> 205000, 1.5000 -> 1.5, 0.2500 -> 0.25
 * @param {string|number} val
 * @returns {string}
 */
function formatNumberTrim(val) {
    if (val === null || val === undefined || val === '') return '';
    var s = String(val).trim();
    if (!s.includes('.')) return s;
    var trimmed = s.replace(/\.?0+$/, '');
    return trimmed === '' ? '0' : trimmed;
}
const formatNumTrim = formatNumberTrim;

function rpShort(n) {
    if (n >= 1_000_000_000) return 'Rp ' + (n / 1_000_000_000).toFixed(1) + 'M';
    if (n >= 1_000_000) return 'Rp ' + (n / 1_000_000).toFixed(1) + 'jt';
    if (n >= 1_000) return 'Rp ' + (n / 1_000).toFixed(0) + 'rb';
    return rp(n);
}

// ---------- Date Formatter (DD/MM/YYYY, timezone-safe) ----------
function formatDate(ds) {
    if (!ds) return '-';
    const clean = String(ds).split('T')[0].split(' ')[0];
    const p = clean.split('-');
    if (p.length < 3) return ds;
    return `${p[2]}/${p[1]}/${p[0]}`;
}
window.formatDate = formatDate;

// ---------- Pagination & State ----------
const PAGE_SIZE = 80;

const paginationState = {
    products: { page: 1, total: 0, totalPages: 1 },
    customers: { page: 1, total: 0, totalPages: 1 },
    vendors: { page: 1, total: 0, totalPages: 1 },
    purchases: { page: 1, total: 0, totalPages: 1 },
    invoices: { page: 1, total: 0, totalPages: 1 },
    proformas: { page: 1, total: 0, totalPages: 1 },
    piutang: { page: 1, total: 0, totalPages: 1 },
    hutang: { page: 1, total: 0, totalPages: 1 },
    cashflow: { page: 1, total: 0, totalPages: 1 }
};

let ALL_PRODUCTS = [];
let ALL_CUSTOMERS = [];
let ALL_VENDORS = [];
let ALL_PAYMENT_TYPES = [];
let PIUTANG_LIST = [];
let HUTANG_LIST = [];
let currentCashFlowFilter = 'all';
window.ALL_PAYMENT_TYPES = ALL_PAYMENT_TYPES;
window.paymentTypes = ALL_PAYMENT_TYPES;

/**
 * Reusable Pagination Renderer (Vanilla JS)
 */
function renderPagination({ containerId, currentPage, totalItems, pageSize = PAGE_SIZE, onPageChange }) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!totalItems || totalItems <= pageSize) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    const pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (currentPage > 3) pages.push('...');
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);
        for (let i = start; i <= end; i++) {
            if (!pages.includes(i)) pages.push(i);
        }
        if (currentPage < totalPages - 2) pages.push('...');
        if (!pages.includes(totalPages)) pages.push(totalPages);
    }

    const pageButtonsHtml = pages.map(p => {
        if (p === '...') {
            return '<span class="pagination-ellipsis">&hellip;</span>';
        }
        const isActive = p === currentPage;
        return '<button type="button" class="pagination-btn ' + (isActive ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
    }).join('');

    container.innerHTML = 
        '<div class="pagination-wrapper">' +
            '<div class="pagination-info">' +
                'Menampilkan <b>' + startItem + '–' + endItem + '</b> dari <b>' + totalItems + '</b> data' +
            '</div>' +
            '<div class="pagination-controls">' +
                '<button type="button" class="pagination-btn pagination-prev" ' + (currentPage <= 1 ? 'disabled' : '') + '>' +
                    '&laquo; Sebelumnya' +
                '</button>' +
                '<div class="pagination-pages desktop-only">' +
                    pageButtonsHtml +
                '</div>' +
                '<div class="pagination-mobile-info mobile-only">' +
                    'Hal. ' + currentPage + ' dari ' + totalPages +
                '</div>' +
                '<button type="button" class="pagination-btn pagination-next" ' + (currentPage >= totalPages ? 'disabled' : '') + '>' +
                    'Berikutnya &raquo;' +
                '</button>' +
            '</div>' +
        '</div>';

    const prevBtn = container.querySelector('.pagination-prev');
    if (prevBtn && currentPage > 1) {
        prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
    }

    const nextBtn = container.querySelector('.pagination-next');
    if (nextBtn && currentPage < totalPages) {
        nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
    }

    container.querySelectorAll('.pagination-pages .pagination-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetPage = parseInt(e.currentTarget.dataset.page);
            if (targetPage && targetPage !== currentPage) {
                onPageChange(targetPage);
            }
        });
    });
}

// Debounce helper for server-side search input
function debounce(fn, delay = 250) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ==========================================================================
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

    if (msg.type === 'settings') {
        loadInvoicePreferences();
    }

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

window.addEventListener('hashchange', () => {
    const rawRole = localStorage.getItem('role') || 'kasir';
    const role = rawRole.toLowerCase();
    const allowedPages = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.kasir;
    const hPage = (window.location.hash || '').replace('#', '').trim();
    if (hPage) {
        if (allowedPages.includes(hPage)) {
            navigateTo(hPage);
        } else {
            const defaultPage = allowedPages[0] || 'dashboard';
            navigateTo(defaultPage);
            try {
                history.replaceState(null, '', window.location.pathname + (window.location.search ? window.location.search : ''));
            } catch (_) {}
        }
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

// ---------- Dynamic Data ----------
// ==========================================================================
// A4: REUSABLE COMBOBOX COMPONENT
// ==========================================================================
class ComboboxSelect {
    constructor(options) {
        this.container = typeof options.container === 'string' ? document.getElementById(options.container) : options.container;
        this.input = typeof options.input === 'string' ? document.getElementById(options.input) : options.input;
        this.hidden = typeof options.hidden === 'string' ? document.getElementById(options.hidden) : options.hidden;
        this.dropdown = typeof options.dropdown === 'string' ? document.getElementById(options.dropdown) : options.dropdown;
        this.placeholder = options.placeholder || 'Pilih...';
        this.emptyMessage = options.emptyMessage || 'Vendor tidak ditemukan';
        this.maxItems = options.maxItems || 20;
        this.onSelect = options.onSelect || null;
        this.items = [];
        this.filteredItems = [];
        this.highlightedIndex = -1;
        this.isOpen = false;

        this.init();
    }

    init() {
        if (!this.input || !this.dropdown) return;

        this.input.addEventListener('focus', () => this.open());
        this.input.addEventListener('click', () => this.open());
        this.input.addEventListener('input', () => this.filter(this.input.value));
        this.input.addEventListener('keydown', (e) => this.onKeyDown(e));

        document.addEventListener('click', (e) => {
            if (this.container && !this.container.contains(e.target)) {
                this.close();
            }
        });
    }

    setData(items) {
        this.items = items || [];
        if (this.isOpen) {
            this.filter(this.input.value);
        }
    }

    open() {
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
    }

    filter(query) {
        const q = (query || '').trim().toLowerCase();
        if (!q) {
            this.filteredItems = this.items.slice(0, this.maxItems);
        } else {
            this.filteredItems = this.items.filter(item => {
                const label = (item.label || '').toLowerCase();
                const code = (item.code || '').toLowerCase();
                return label.includes(q) || code.includes(q);
            }).slice(0, this.maxItems);
        }
        this.highlightedIndex = -1;
        this.renderDropdown();
    }

    renderDropdown() {
        if (!this.dropdown) return;
        this.dropdown.innerHTML = '';

        if (this.filteredItems.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combobox-item-empty';
            emptyEl.textContent = this.emptyMessage;
            this.dropdown.appendChild(emptyEl);
        } else {
            this.filteredItems.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'combobox-item' + (String(item.id) === String(this.hidden?.value) ? ' selected' : '');
                div.dataset.index = index;

                let codeHtml = item.code ? `<span class="code">${item.code}</span>` : '';
                div.innerHTML = `
                    <span class="label">${item.label}</span>
                    ${codeHtml}
                `;

                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.selectItem(item);
                });
                div.addEventListener('mouseenter', () => {
                    this.highlightIndex(index);
                });

                this.dropdown.appendChild(div);
            });
        }

        this.dropdown.classList.add('active', 'show');
        this.dropdown.style.display = 'block';
    }

    highlightIndex(index) {
        const items = this.dropdown.querySelectorAll('.combobox-item');
        items.forEach(el => el.classList.remove('highlighted'));
        if (index >= 0 && index < items.length) {
            this.highlightedIndex = index;
            items[index].classList.add('highlighted');
            items[index].scrollIntoView({ block: 'nearest' });
        } else {
            this.highlightedIndex = -1;
        }
    }

    selectItem(item) {
        if (!item) return;
        if (this.hidden) this.hidden.value = item.id;
        if (this.input) this.input.value = item.label;
        this.close();
        if (typeof this.onSelect === 'function') {
            this.onSelect(item);
        }
    }

    setValue(id) {
        const found = this.items.find(i => String(i.id) === String(id));
        if (found) {
            if (this.hidden) this.hidden.value = found.id;
            if (this.input) this.input.value = found.label;
        } else {
            if (this.hidden) this.hidden.value = '';
            if (this.input) this.input.value = '';
        }
    }

    reset() {
        if (this.hidden) this.hidden.value = '';
        if (this.input) this.input.value = '';
        this.close();
    }

    onKeyDown(e) {
        if (!this.isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            this.open();
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const max = this.filteredItems.length;
            if (max > 0) {
                const next = (this.highlightedIndex + 1) % max;
                this.highlightIndex(next);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const max = this.filteredItems.length;
            if (max > 0) {
                const prev = (this.highlightedIndex - 1 + max) % max;
                this.highlightIndex(prev);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.highlightedIndex >= 0 && this.highlightedIndex < this.filteredItems.length) {
                this.selectItem(this.filteredItems[this.highlightedIndex]);
            } else if (this.filteredItems.length === 1) {
                this.selectItem(this.filteredItems[0]);
            }
        } else if (e.key === 'Escape') {
            this.close();
        }
    }
}

function initAddPurchaseVendorCombobox() {
    if (!document.getElementById('add-purchase-vendor-container')) return;
    if (!window.addPurchaseVendorCombobox) {
        window.addPurchaseVendorCombobox = new ComboboxSelect({
            container: 'add-purchase-vendor-container',
            input: 'add-purchase-vendor-input',
            hidden: 'add-purchase-vendor',
            dropdown: 'add-purchase-vendor-dropdown',
            placeholder: 'Cari nama atau kode vendor...',
            emptyMessage: 'Vendor tidak ditemukan',
            maxItems: 20
        });
    }
    if (Array.isArray(VENDORS) && VENDORS.length > 0) {
        window.addPurchaseVendorCombobox.setData(
            VENDORS.map(v => ({ id: v.id, label: v.name, code: v.idNumber || '' }))
        );
    }
}

let CURRENT_PAGE_PRODUCTS = new Map();
let addPurchaseVendorCombobox = null;

let PRODUCTS = [];
let CUSTOMERS = [];
let VENDORS = [];

let INVOICES = [];
let PURCHASES = [];
let CASH_TRANSACTIONS = [];
let USERS = [];
let PRICELISTS = [];
// POS effective prices cache
let currentPOSCustomerEffectivePrices = {};

// ─── State Mode Edit Proforma ─────────────────────────────────────────────────
let posEditMode = false;
let posEditProformaPk = null;
let posEditProformaRevisi = 0;
let posEditCartDirty = false; // Track perubahan belum disimpan

// Map invoice_id → proforma_pk untuk tombol di tabel invoice
let INVOICE_PROFORMA_MAP = {};

// Sales data for chart (dynamic)
let SALES_CHART_DATA = [];

// Donut chart data (dynamic)
let DONUT_DATA = [];

// Page title mapping
const PAGE_TITLES = {
    dashboard: { title: 'Dashboard', subtitle: 'Selamat pagi, Ahmad 👋' },
    pos: { title: 'Order / Kasir', subtitle: 'Buat transaksi penjualan baru' },
    products: { title: 'Produk & Stok', subtitle: 'Kelola inventaris produk Anda' },
    customers: { title: 'Pelanggan', subtitle: 'Daftar pelanggan dan reseller' },
    vendors: { title: 'Vendor', subtitle: 'Daftar pemasok dan supplier' },
    purchases: { title: 'Pembelian', subtitle: 'Riwayat purchase order' },
    proformas: { title: 'Proforma Invoice', subtitle: 'Daftar dokumen proforma dan penawaran pra-invoice' },
    invoices: { title: 'Transaksi / Invoice', subtitle: 'Riwayat invoice penjualan' },
    piutang: { title: 'Piutang', subtitle: 'Tagihan pelanggan yang belum lunas' },
    hutang: { title: 'Hutang', subtitle: 'Kewajiban pembayaran ke vendor' },
    cashflow: { title: 'Arus Kas', subtitle: 'Mutasi kas masuk dan keluar' },
    profitloss: { title: 'Laba Rugi', subtitle: 'Laporan pendapatan dan beban' },
    balance: { title: 'Neraca', subtitle: 'Posisi keuangan bisnis Anda' },
    reports: { title: 'Laporan & Insight', subtitle: 'Analisis performa bisnis' },
    settings: { title: 'Pengaturan', subtitle: 'Konfigurasi profil dan preferensi' },
    roles: { title: 'Otoritas Akses', subtitle: 'Kelola hak akses dan peran staff' },
    'master-data': { title: 'Master Data', subtitle: 'Kelola kategori, satuan, dan tipe pembayaran' },
    pricelists: { title: 'Special Price', subtitle: 'Kelola daftar harga khusus untuk pelanggan' },
    returns: { title: 'Daftar Retur', subtitle: 'Riwayat retur penjualan dan pembelian' },
    'stock-moves': { title: 'Stock Move', subtitle: 'Monitoring pergerakan fisik stok' },
    conversions: { title: 'Konversi Produk', subtitle: 'Pecah atau gabung stok produk antar satuan' },
};

// ---------- Role Based Access Control (RBAC) ----------
const ROLE_PERMISSIONS = {
    admin: ['dashboard', 'pos', 'products', 'customers', 'vendors', 'purchases', 'proformas', 'invoices', 'piutang', 'hutang', 'cashflow', 'profitloss', 'balance', 'reports', 'settings', 'roles', 'master-data', 'customerfee', 'pricelists', 'returns', 'stock-moves', 'conversions'],
    finance: ['dashboard', 'invoices', 'piutang', 'cashflow', 'profitloss', 'balance', 'reports', 'returns'],
    gudang: ['dashboard', 'products', 'purchases', 'vendors', 'hutang', 'stock-moves', 'returns', 'conversions'],
    kasir: ['dashboard', 'pos', 'customers', 'proformas', 'invoices', 'pricelists', 'returns']
};

function applyRoleRestrictions() {
    const rawRole = localStorage.getItem('role') || 'kasir';
    const role = rawRole.toLowerCase();
    const allowedPages = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.kasir;

    // Show/hide nav-items based on allowedPages
    document.querySelectorAll('.nav-item').forEach(item => {
        const page = item.dataset.page;
        if (allowedPages.includes(page)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });

    // Control visibility of invoice import buttons: only Admin & Finance
    const canImportInvoice = role === 'admin' || role === 'finance';
    const btnImportInv = document.getElementById('btn-import-invoice');
    if (btnImportInv) btnImportInv.style.display = canImportInvoice ? '' : 'none';
    const btnImportPiutang = document.getElementById('btn-import-piutang');
    if (btnImportPiutang) btnImportPiutang.style.display = canImportInvoice ? '' : 'none';

    // Control visibility of hutang import buttons: only Admin & Gudang (C6)
    const canImportHutang = role === 'admin' || role === 'gudang';
    const btnImportHutang = document.getElementById('btn-import-hutang');
    if (btnImportHutang) btnImportHutang.style.display = canImportHutang ? '' : 'none';

    // Returns tabs & financial visibility:
    const returnsSalesTabBtn = document.getElementById('tab-btn-returns-sales');
    const returnsPurchasesTabBtn = document.getElementById('tab-btn-returns-purchases');
    if (returnsSalesTabBtn && returnsPurchasesTabBtn) {
        if (role === 'gudang') {
            returnsSalesTabBtn.style.display = 'none';
            returnsPurchasesTabBtn.style.display = '';
            if (typeof switchReturnsTab === 'function') switchReturnsTab('purchases');
        } else if (role === 'kasir') {
            returnsPurchasesTabBtn.style.display = 'none';
            returnsSalesTabBtn.style.display = '';
            if (typeof switchReturnsTab === 'function') switchReturnsTab('sales');
        } else {
            returnsSalesTabBtn.style.display = '';
            returnsPurchasesTabBtn.style.display = '';
        }
    }

    const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';
    document.querySelectorAll('.th-returns-finance, .th-sales-return-finance, .th-purchase-return-finance, .th-ret-detail-finance').forEach(el => {
        el.style.display = canSeeFinance ? '' : 'none';
    });

    // Sembunyikan HPP untuk kasir
    const canSeeHpp = role === 'admin' || role === 'owner' || role === 'gudang';
    document.querySelectorAll('.th-product-hpp, .td-product-hpp, .form-group-product-cost').forEach(el => {
        el.style.display = canSeeHpp ? '' : 'none';
    });

    // Sembunyikan nilai / HPP konversi untuk selain Admin (misal Gudang)
    const canSeeConversionValue = role === 'admin' || role === 'owner';
    document.querySelectorAll('.th-conversion-value, .td-conversion-value, .conversion-admin-value-field').forEach(el => {
        el.style.display = canSeeConversionValue ? '' : 'none';
    });

    const recentStockCard = document.getElementById('dash-card-recent-stock-moves');
    if (recentStockCard) {
        recentStockCard.style.display = (role === 'admin' || role === 'gudang') ? '' : 'none';
    }

    // Sembunyikan kolom piutang di tabel customers untuk kasir
    const canSeePiutangCustomer = role !== 'kasir';
    document.querySelectorAll('.th-customer-piutang, .td-customer-piutang').forEach(el => {
        el.style.display = canSeePiutangCustomer ? '' : 'none';
    });

    // Also hide nav groups if all their items are hidden
    document.querySelectorAll('.nav-group').forEach(group => {
        const visibleItems = Array.from(group.querySelectorAll('.nav-item')).filter(item => item.style.display !== 'none');
        if (visibleItems.length === 0) {
            group.style.display = 'none';
        } else {
            group.style.display = '';
        }
    });

    // If current page is not allowed, navigate to the first allowed page
    if (!allowedPages.includes(currentPage)) {
        const firstAllowed = allowedPages[0] || 'dashboard';
        navigateTo(firstAllowed);
    }
}

// ---------- Navigation ----------
let currentPage = 'dashboard';

function navigateTo(page) {
    const rawRole = localStorage.getItem('role') || 'kasir';
    const role = rawRole.toLowerCase();
    const allowedPages = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.kasir;
    if (!allowedPages.includes(page)) {
        const defaultPage = allowedPages[0] || 'dashboard';
        if (currentPage !== defaultPage) {
            navigateTo(defaultPage);
        }
        return;
    }

    // Hide all sections
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    // Deactivate all nav items
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Show target
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');

    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // Update topbar
    const info = PAGE_TITLES[page] || { title: page, subtitle: '' };
    document.getElementById('topbar-title').textContent = info.title;
    document.getElementById('topbar-subtitle').textContent = info.subtitle;

    currentPage = page;

    if (page === 'dashboard') {
        refreshDashboardData(true);
    }

    // A1: Toggle pos-active class untuk desktop full-height POS layout
    if (page === 'pos') {
        document.body.classList.add('pos-active');
        ensureProductsLoadedForPOS().then(() => {
            renderPOSProducts();
            if (typeof populateCustomerSelect === 'function') {
                populateCustomerSelect(document.getElementById('pos-customer-search')?.value || '');
            }
        });
        // Jika mode edit aktif dan navigasi manual ke POS dari sidebar, keluar mode edit (tanpa confirm)
        // enterProformaEditMode akan set ulang state setelah navigasi
    } else {
        // Keluar mode edit jika navigate ke halaman lain (kecuali enterProformaEditMode yang trigger navigateTo sendiri)
        if (posEditMode && page !== 'pos') {
            // exitProformaEditMode sudah handle navigateTo('proformas'), tapi di sini kita skip
            // karena user mungkin klik nav lain intentionally
            posEditMode = false;
            posEditProformaPk = null;
            const banner = document.getElementById('pos-edit-mode-banner');
            if (banner) banner.style.display = 'none';
            const btnCheckout = document.getElementById('btn-checkout');
            const btnCreateProforma = document.getElementById('btn-create-proforma');
            const editActionsRow = document.getElementById('pos-edit-actions-row');
            if (btnCheckout) btnCheckout.style.display = '';
            if (btnCreateProforma) btnCreateProforma.style.display = '';
            if (editActionsRow) editActionsRow.style.display = 'none';
            const custSearch = document.getElementById('pos-customer-search');
            if (custSearch) { custSearch.disabled = false; custSearch.style.background = ''; }
            cart = [];
            currentPOSCustomerEffectivePrices = {};
        }
        document.body.classList.remove('pos-active');
    }

    if (page === 'settings') {
        loadCompanyProfile();
    }
    if (page === 'pricelists') {
        fetchPricelists();
    }
    if (page === 'proformas') {
        fetchProformas(1);
    }
    if (page === 'returns') {
        if (typeof loadReturnsPage === 'function') loadReturnsPage();
    }
    if (page === 'stock-moves') {
        if (typeof loadStockMovesPage === 'function') loadStockMovesPage(1);
    }
    if (page === 'conversions') {
        if (typeof loadConversionsPage === 'function') loadConversionsPage(1);
    }

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
}

// Bind nav items
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        navigateTo(item.dataset.page);
    });
});

// Mobile sidebar toggle
document.getElementById('mobile-sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
});

document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
});

// ---------- Modal Stack Management (B1, B2, B3) ----------
const openModalsStack = [];

function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;

    // Remove if already in stack, push to top
    const idx = openModalsStack.indexOf(id);
    if (idx !== -1) {
        openModalsStack.splice(idx, 1);
    }
    openModalsStack.push(id);

    // Dynamic z-index and pointer-events
    openModalsStack.forEach((modalId, i) => {
        const m = document.getElementById(modalId);
        if (m) {
            m.style.zIndex = 1000 + ((i + 1) * 20);
            if (i === openModalsStack.length - 1) {
                m.style.pointerEvents = 'auto';
            } else {
                m.style.pointerEvents = 'none';
            }
        }
    });

    document.body.classList.add('modal-open');
    el.classList.add('active');

    if (id === 'modal-add-product') {
        const brandEl = document.getElementById('add-product-brand');
        const skuEl = document.getElementById('add-product-sku');
        const nameEl = document.getElementById('add-product-name');
        const priceEl = document.getElementById('add-product-price');
        const costEl = document.getElementById('add-product-cost');
        const stockEl = document.getElementById('add-product-stock');
        const minStockEl = document.getElementById('add-product-minstock');

        if (brandEl) brandEl.value = '';
        if (skuEl) skuEl.value = '';
        if (nameEl) nameEl.value = '';
        if (priceEl) priceEl.value = '';
        if (costEl) costEl.value = '';
        if (stockEl) stockEl.value = '';
        if (minStockEl) minStockEl.value = '';
    } else if (id === 'modal-manual-invoice') {
        const invId = document.getElementById('manual-invoice-id');
        const custSearch = document.getElementById('manual-invoice-customer-search');
        const custVal = document.getElementById('manual-invoice-customer');
        const totalEl = document.getElementById('manual-invoice-total');
        const methodEl = document.getElementById('manual-invoice-payment-method');
        const dateEl = document.getElementById('manual-invoice-date');
        const duedateEl = document.getElementById('manual-invoice-duedate');
        const dropdown = document.getElementById('manual-invoice-customer-dropdown');

        if (invId) invId.value = '';
        if (custSearch) custSearch.value = '';
        if (custVal) custVal.value = '';
        if (totalEl) totalEl.value = '';
        if (methodEl) methodEl.value = '';
        if (dateEl) dateEl.value = '';
        if (duedateEl) duedateEl.value = '';
        if (dropdown) {
            dropdown.style.display = 'none';
            dropdown.innerHTML = '';
        }
    }
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('active');
        el.style.zIndex = '';
        el.style.pointerEvents = '';
    }

    const idx = openModalsStack.indexOf(id);
    if (idx !== -1) {
        openModalsStack.splice(idx, 1);
    }

    if (openModalsStack.length > 0) {
        document.body.classList.add('modal-open');
        const topModal = document.getElementById(openModalsStack[openModalsStack.length - 1]);
        if (topModal) topModal.style.pointerEvents = 'auto';
    } else {
        document.body.classList.remove('modal-open');
    }
}

// Global Esc key listener: closes topmost modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openModalsStack.length > 0) {
        const topModalId = openModalsStack[openModalsStack.length - 1];
        closeModal(topModalId);
    }
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeModal(overlay.id);
        }
    });
});

// ---------- Dashboard Rendering ----------
let DASHBOARD_SUMMARY = null;

async function fetchDashboardSummary() {
    try {
        const res = await fetch('/api/dashboard/summary', { headers: getAuthHeaders() });
        if (res.ok) {
            DASHBOARD_SUMMARY = await res.json();
        }
    } catch (err) {
        console.warn('Dashboard summary not accessible for current role', err);
    }
}

async function fetchSalesTrend(days = 7) {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    if (role !== 'admin' && role !== 'finance') return;
    try {
        const res = await fetch(`/api/dashboard/sales-trend?days=${days}`, { headers: getAuthHeaders() });
        if (res.ok) {
            SALES_CHART_DATA = await res.json();
        }
    } catch (err) {
        console.warn('Sales trend not accessible for current role', err);
    }
}

async function fetchSalesComposition(days = 30) {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    if (role !== 'admin' && role !== 'finance') return;
    try {
        const res = await fetch(`/api/dashboard/sales-composition?days=${days}`, { headers: getAuthHeaders() });
        if (res.ok) {
            DONUT_DATA = await res.json();
        }
    } catch (err) {
        console.warn('Sales composition not accessible for current role', err);
    }
}

let currentTrendDays = 7;
let currentCompositionDays = 30;

async function refreshCharts() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    if (role !== 'admin' && role !== 'finance') return;
    await Promise.all([
        fetchSalesTrend(currentTrendDays),
        fetchSalesComposition(currentCompositionDays)
    ]);
    renderSalesChart();
    renderDonutChart();
}

async function handleChartDaysChange(days) {
    // Show loading states
    const chart = document.getElementById('sales-chart');
    if (chart) {
        chart.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:200px; width:100%; color:var(--gray-400);">Memuat data...</div>';
    }
    const donutWrapper = document.getElementById('donut-chart');
    if (donutWrapper) {
        donutWrapper.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:140px; width:100%; color:var(--gray-400); font-size:0.875rem;">Memuat data...</div>';
    }

    // Toggle active classes on the buttons
    const trendButtons = document.querySelectorAll('#page-dashboard .dash-card-actions button');
    trendButtons.forEach(btn => {
        const isTarget = btn.textContent.includes(String(days));
        if (isTarget) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update title
    const titleEl = document.querySelector('#page-dashboard .dash-card:first-child .dash-card-title');
    if (titleEl) {
        titleEl.textContent = `Penjualan ${days} Hari Terakhir`;
    }

    currentTrendDays = days;
    currentCompositionDays = days;

    await refreshCharts();
}

function setupChartListeners() {
    const trendButtons = document.querySelectorAll('#page-dashboard .dash-card-actions button');
    trendButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const is30d = btn.textContent.includes('30');
            const days = is30d ? 30 : 7;
            handleChartDaysChange(days);
        });
    });
}

async function checkReconciliationStatus() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    if (role !== 'admin' && role !== 'finance') return;
    try {
        const res = await fetch('/api/finance/reconciliation-status', { headers: getAuthHeaders() });
        if (res.ok) {
            const data = await res.json();
            const alertEl = document.getElementById('reconciliation-alert');
            const alertText = document.getElementById('reconciliation-alert-text');
            if (data.success && data.status && !data.status.balanced) {
                alertText.innerHTML = `Ditemukan ketidaksesuaian data keuangan pada pencatatan otomatis harian. Masalah:<br/>` + 
                    data.status.issues.map(issue => `&bull; ${issue}`).join('<br/>') +
                    `<br/><span style="font-weight: 600; margin-top: 0.5rem; display: inline-block;">Silakan periksa laporan keuangan dan log transaksi cash flow.</span>`;
                alertEl.style.display = 'block';
                if (window.lucide) window.lucide.createIcons();
            } else {
                alertEl.style.display = 'none';
            }
        }
    } catch (err) {
        console.warn('Reconciliation status check suppressed for non-finance role', err);
    }
}

function renderDashboard() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();

    // A7: Charts hanya untuk Admin dan Finance
    const chartsRow = document.getElementById('dashboard-charts-row');
    if (chartsRow) {
        if (role === 'admin' || role === 'finance') {
            chartsRow.style.display = '';
            renderSalesChart();
            renderDonutChart();
        } else {
            chartsRow.style.display = 'none';
        }
    }

    checkReconciliationStatus();
    renderSummaryCards();
    renderRecentTransactions();
    renderLowStock();
    renderRecentStockMoves();
}

function renderSummaryCards() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();

    // Prioritize fetched API summary, fallback to computed values from loaded arrays
    const totalOmzet = DASHBOARD_SUMMARY?.revenue ?? INVOICES.filter(i => i.status && i.status.toLowerCase() !== 'batal').reduce((s, i) => s + i.total, 0);
    const totalPiutang = DASHBOARD_SUMMARY?.receivables ?? INVOICES.filter(i => i.status && i.status.toLowerCase() !== 'lunas' && i.status.toLowerCase() !== 'batal').reduce((s, i) => s + (i.total - i.paid), 0);
    const totalHutang = DASHBOARD_SUMMARY?.payables ?? PURCHASES.filter(p => p.status && p.status.toLowerCase() !== 'selesai' && p.status.toLowerCase() !== 'batal').reduce((s, p) => s + (p.total - p.paid), 0);
    
    // A1 & A2: Produk nonaktif TIDAK ikut dihitung di Stok Menipis
    const lowStockCount = DASHBOARD_SUMMARY?.lowStockCount ?? PRODUCTS.filter(p => (p.is_active !== 0 && p.is_active !== false) && p.stock <= p.minStock).length;
    const labaKotor = DASHBOARD_SUMMARY?.grossProfit ?? (totalOmzet * 0.28);
    const ordersToday = DASHBOARD_SUMMARY?.ordersToday ?? (() => {
        const today = new Date().toISOString().split('T')[0];
        return INVOICES.filter(i => (i.date || '').startsWith(today) && i.status && i.status.toLowerCase() !== 'batal').length;
    })();
    const activeCustomers = DASHBOARD_SUMMARY?.customerCount ?? CUSTOMERS.length;
    const totalProducts = DASHBOARD_SUMMARY?.productCount ?? PRODUCTS.filter(p => p.is_active !== 0 && p.is_active !== false).length;

    // A7: Pembagian card dashboard per role
    const cards = [];

    // Omzet & Keuangan: Admin & Finance saja
    if (role === 'admin' || role === 'finance') {
        cards.push({ label: 'Omzet Bulan Ini', value: rpShort(totalOmzet), trend: 'Total penjualan', trendDir: 'up', icon: 'trending-up', color: 'blue' });
        cards.push({ label: 'Total Piutang', value: rpShort(totalPiutang), trend: totalPiutang > 0 ? 'Belum terbayar' : 'Semua lunas', trendDir: totalPiutang > 0 ? 'down' : 'up', icon: 'hand-coins', color: 'amber' });
        cards.push({ label: 'Laba Kotor', value: rpShort(labaKotor), trend: labaKotor >= 0 ? 'Revenue - HPP' : 'Rugi', trendDir: labaKotor >= 0 ? 'up' : 'down', icon: 'wallet', color: 'emerald' });
    }

    // Total Hutang: Admin & Gudang saja (C6 / A7: sesuai izin halaman Hutang)
    if (role === 'admin' || role === 'gudang') {
        cards.push({ label: 'Total Hutang', value: rpShort(totalHutang), trend: totalHutang > 0 ? 'Ke vendor' : 'Semua lunas', trendDir: totalHutang > 0 ? 'down' : 'up', icon: 'landmark', color: 'rose' });
    }

    // Stok Menipis: Admin, Finance, Kasir, Gudang
    cards.push({ label: 'Stok Menipis', value: lowStockCount + ' produk', trend: lowStockCount > 0 ? 'Perlu restock' : 'Stok aman', trendDir: lowStockCount > 0 ? 'down' : 'up', icon: 'alert-triangle', color: 'orange' });

    // Order Hari Ini: Admin, Finance, Kasir (Gudang tidak melihat order hari ini)
    if (role === 'admin' || role === 'finance' || role === 'kasir') {
        cards.push({ label: 'Order Hari Ini', value: ordersToday + ' transaksi', trend: 'Hari ini', trendDir: 'up', icon: 'shopping-cart', color: 'indigo' });
    }

    // Pelanggan Aktif: Admin, Finance, Kasir
    if (role === 'admin' || role === 'finance' || role === 'kasir') {
        cards.push({ label: 'Pelanggan Aktif', value: activeCustomers + ' pelanggan', trend: 'Terdaftar', trendDir: 'up', icon: 'users', color: 'violet' });
    }

    // Produk Terdaftar: Admin & Gudang (Kasir tidak perlu card katalog)
    if (role === 'admin' || role === 'gudang') {
        cards.push({ label: 'Produk Terdaftar', value: totalProducts + ' produk', trend: 'Katalog', trendDir: 'up', icon: 'package', color: 'cyan' });
    }

    const grid = document.getElementById('summary-grid');
    if (grid) {
        grid.innerHTML = cards.map(c => `
            <div class="summary-card ${c.color}">
                <div class="summary-card-header">
                    <div class="summary-card-icon ${c.color}"><i data-lucide="${c.icon}"></i></div>
                    <span class="summary-card-trend ${c.trendDir}">${c.trendDir === 'up' ? '↑' : '↓'} ${c.trend}</span>
                </div>
                <div class="summary-card-value">${c.value}</div>
                <div class="summary-card-label">${c.label}</div>
            </div>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }
}


function renderSalesChart() {
    const chart = document.getElementById('sales-chart');
    if (!chart) return;

    if (!SALES_CHART_DATA || SALES_CHART_DATA.length === 0) {
        chart.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:200px; width:100%; color:var(--gray-400);">Belum ada data penjualan</div>';
        return;
    }

    const maxVal = Math.max(...SALES_CHART_DATA.map(d => d.total_penjualan), 0);
    const INDO_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

    const formatIndonesianDate = (dateStr) => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length < 3) return dateStr;
        const day = parseInt(parts[2], 10);
        const monthIdx = parseInt(parts[1], 10) - 1;
        const monthName = INDO_MONTHS[monthIdx] || '';
        return `${day} ${monthName}`;
    };

    chart.innerHTML = SALES_CHART_DATA.map(d => {
        const h = maxVal > 0 ? Math.max((d.total_penjualan / maxVal) * 200, 8) : 8;
        const label = formatIndonesianDate(d.tanggal);
        return `
            <div class="chart-bar-col">
                <div class="chart-bar-value" title="${rp(d.total_penjualan)}">${rpShort(d.total_penjualan)}</div>
                <div class="chart-bar" style="height: ${h}px;" title="Total: ${rp(d.total_penjualan)}&#10;Transaksi: ${d.jumlah_transaksi}"></div>
                <div class="chart-bar-label">${label}</div>
            </div>
        `;
    }).join('');
}

function renderDonutChart() {
    const wrapper = document.getElementById('donut-chart');
    if (!wrapper) return;

    if (!DONUT_DATA || DONUT_DATA.length === 0) {
        wrapper.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:140px; width:100%; color:var(--gray-400); font-size:0.875rem;">Belum ada data penjualan</div>';
        return;
    }

    const CATEGORY_COLORS = {
        'Minuman': '#3b82f6',
        'Makanan': '#10b981',
        'Sembako': '#f59e0b',
        'Lainnya': '#8b5cf6'
    };
    const FALLBACK_COLORS = ['#ec4899', '#06b6d4', '#f43f5e', '#14b8a6', '#64748b'];

    let fallbackIdx = 0;
    const chartData = DONUT_DATA.map(d => {
        let color = CATEGORY_COLORS[d.kategori];
        if (!color) {
            color = FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
            fallbackIdx++;
        }
        return {
            label: d.kategori,
            value: d.persentase,
            color: color
        };
    });

    const total = chartData.reduce((s, d) => s + d.value, 0);
    if (total === 0) {
        wrapper.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:140px; width:100%; color:var(--gray-400); font-size:0.875rem;">Belum ada data penjualan</div>';
        return;
    }

    let cumulative = 0;
    const radius = 52;
    const circumference = 2 * Math.PI * radius;

    let circles = '';
    chartData.forEach(d => {
        const dashLength = (d.value / total) * circumference;
        const dashOffset = -(cumulative / total) * circumference;
        circles += `<circle cx="70" cy="70" r="${radius}" fill="none" stroke="${d.color}" stroke-width="16" 
                     stroke-dasharray="${dashLength} ${circumference - dashLength}" 
                     stroke-dashoffset="${dashOffset}" 
                     style="transition: all 0.8s ease;"/>`;
        cumulative += d.value;
    });

    const svg = `<svg class="donut-svg" viewBox="0 0 140 140">${circles}</svg>`;
    const legend = chartData.map(d => `
        <div class="donut-legend-item">
            <span class="donut-legend-dot" style="background: ${d.color};"></span>
            <span>${d.label}</span>
            <span class="donut-legend-value">${d.value}%</span>
        </div>
    `).join('');

    wrapper.innerHTML = svg + `<div class="donut-legend">${legend}</div>`;
}

function renderRecentTransactions() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const cardEl = document.getElementById('dash-card-recent-transactions');

    // A7: Gudang tidak memiliki izin transaksi / invoice -> card tidak dirender
    if (role === 'gudang') {
        if (cardEl) cardEl.style.display = 'none';
        return;
    }
    if (cardEl) cardEl.style.display = '';

    // A7: Untuk kasir jangan tampilkan agregat total omset
    const thTotal = document.getElementById('th-recent-tx-total');
    if (thTotal) {
        thTotal.style.display = (role === 'kasir') ? 'none' : '';
    }

    const tbody = document.getElementById('recent-transactions-body');
    if (!tbody) return;

    tbody.innerHTML = INVOICES.slice(0, 5).map(inv => `
        <tr>
            <td style="font-weight:600; color: var(--blue-600);">${inv.id}</td>
            <td>${inv.customer}</td>
            ${role === 'kasir' ? '' : `<td style="font-weight:600;">${rp(inv.total)}</td>`}
            <td><span class="badge-status ${inv.status}">${capitalize(inv.status)}</span></td>
        </tr>
    `).join('');
}

function renderLowStock() {
    // A1: Tampilkan dalam frame dengan scroll vertikal. A2: Produk nonaktif tidak ikut dihitung.
    let lowStock = [];
    if (DASHBOARD_SUMMARY && Array.isArray(DASHBOARD_SUMMARY.lowStockProducts)) {
        lowStock = DASHBOARD_SUMMARY.lowStockProducts.map(p => ({
            name: p.name,
            stock: parseFloat(p.stock),
            minStock: parseFloat(p.min_stock)
        }));
    } else {
        lowStock = PRODUCTS.filter(p => (p.is_active !== 0 && p.is_active !== false) && p.stock <= p.minStock);
    }

    const tbody = document.getElementById('low-stock-body');
    if (!tbody) return;

    tbody.innerHTML = lowStock.map(p => `
        <tr>
            <td style="font-weight: 600;">${p.name}</td>
            <td style="font-weight: 700; color: var(--rose-500);">${p.stock}</td>
            <td>${p.minStock}</td>
            <td><span class="badge-status rendah">Rendah</span></td>
        </tr>
    `).join('');

    if (lowStock.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--gray-400); padding:2rem;">Semua stok aman</td></tr>';
    }
}

async function renderRecentStockMoves() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const cardEl = document.getElementById('dash-card-recent-stock-moves');
    if (!cardEl) return;

    if (role !== 'admin' && role !== 'gudang') {
        cardEl.style.display = 'none';
        return;
    }
    cardEl.style.display = '';

    const tbody = document.getElementById('recent-stock-moves-body');
    if (!tbody) return;

    try {
        const res = await fetch('/api/stock-moves?page=1&limit=10', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        const moves = json.data || [];
        if (moves.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--gray-400); padding:1rem;">Belum ada pergerakan stok.</td></tr>';
            return;
        }

        tbody.innerHTML = moves.map(m => {
            const dateStr = (m.tanggal || '').split('T')[0];
            const moveType = m.tipe || '';
            const typeLabel = typeof formatMoveType === 'function' ? formatMoveType(moveType) : moveType;
            const inQty = parseFloat(m.qtyMasuk || 0);
            const outQty = parseFloat(m.qtyKeluar || 0);
            const qtyDisplay = inQty > 0 ? `<span style="color:var(--emerald-600); font-weight:600;">+${inQty}</span>` : `<span style="color:var(--rose-600); font-weight:600;">-${outQty}</span>`;
            return `
                <tr>
                    <td style="font-size:0.8rem; color:var(--gray-500);">${dateStr}</td>
                    <td style="font-weight:500;">${m.productName || '-'}<br><small style="color:var(--gray-400);">${m.sku || ''}</small></td>
                    <td><span class="badge-status ${moveType}">${typeLabel}</span></td>
                    <td style="text-align:right;">${qtyDisplay}</td>
                    <td style="text-align:right; font-weight:600;">${parseFloat(m.stokSesudah || 0)}</td>
                </tr>
            `;
        }).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.error('Failed to render recent stock moves card', e);
    }
}

// ---------- Products Page ----------
function renderProducts(filter = '', category = '') {
    // Server-side pagination: reset to page 1 and fetch
    paginationState.products.page = 1;
    fetchProducts(1);
}

function _renderProductsTable(filtered) {

    tbody.innerHTML = filtered.map(p => {
        const stockStatus = p.stock <= p.minStock ? 'rendah' : 'aman';
        const stockLabel = p.stock <= p.minStock ? 'Rendah' : 'Aman';
        return `
            <tr>
                <td><code style="background:var(--gray-100); padding:2px 6px; border-radius:4px; font-size:0.78rem;">${p.sku}</code></td>
                <td style="font-weight:600;">${p.name}</td>
                <td>${p.category}</td>
                <td>${rp(p.cost)}</td>
                <td style="font-weight:700;">${rp(p.price)}</td>
                <td style="font-weight:700;">${p.stock}</td>
                <td>${p.unit}</td>
                <td>${p.minStock}</td>
                <td><span class="badge-status ${stockStatus}">${stockLabel}</span></td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Produk" onclick="openEditProductModal('${p.id}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--blue-600);" title="Stock Opname" onclick="openStockOpnameModal('${p.id}')">
                        <i data-lucide="boxes" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Hapus Produk" onclick="deleteProduct('${p.id}')">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

// Search & filter bindings for products (server-side, debounced)
document.getElementById('product-search')?.addEventListener('input', debounce(() => {
    paginationState.products.page = 1;
    fetchProducts(1);
}, 300));
document.getElementById('product-category-filter')?.addEventListener('change', () => {
    paginationState.products.page = 1;
    fetchProducts(1);
});
document.getElementById('product-sort')?.addEventListener('change', () => {
    paginationState.products.page = 1;
    fetchProducts(1);
});

// ---------- Customers Page ----------
let customerViewMode = 'kanban';

function renderCustomers(filter = '', type = '') {
    // Server-side pagination: reset to page 1 and fetch
    paginationState.customers.page = 1;
    fetchCustomers(1);
}

function _renderCustomersLocal_UNUSED(filter = '', type = '') {
    const grid = document.getElementById('customers-grid');
    const listBody = document.getElementById('customers-list-body');
    if (!grid) return;

    let filtered = CUSTOMERS;
    if (filter) {
        const q = filter.toLowerCase();
        filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }
    if (type && type !== 'all') {
        filtered = filtered.filter(c => c.type === type);
    }

    // Helper: sisa limit color based on 50%/10% thresholds
    function limitColor(sisa, limit) {
        if (limit <= 0) return 'var(--slate-400)';
        const pct = sisa / limit;
        if (pct > 0.5) return 'var(--emerald-600)';
        if (pct > 0.1) return 'var(--amber-500)';
        return 'var(--rose-500)';
    }

    grid.innerHTML = filtered.map(c => {
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canSeePiutang = role !== 'kasir';
        const color = limitColor(c.sisaLimitPiutang ?? c.remainingLimit, c.creditLimit);
        const pctUsed = c.creditLimit > 0 ? Math.min(100, Math.round((c.totalPiutangBerjalan ?? c.outstandingReceivables) / c.creditLimit * 100)) : 0;
        return `
        <div class="entity-card" style="position: relative;">
            <button class="btn-toolbar secondary" style="position: absolute; top: 1rem; right: 1rem; padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Edit Pelanggan" onclick="openEditCustomerModal('${c.id}')">
                <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
            </button>
            <button class="btn-toolbar secondary" style="position: absolute; top: 1rem; right: 3rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Hapus Pelanggan" onclick="deleteCustomer('${c.id}')">
                <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
            </button>
            <div class="entity-card-header" style="cursor:pointer;" onclick="openCustomerDetail('${c.id}')">
                <div class="entity-avatar ${c.color}">${c.name.charAt(0)}</div>
                <div>
                    <div class="entity-name">${c.name}</div>
                    <div class="entity-type">${c.type} &bull; ${c.city}</div>
                    ${c.pricelistName ? `<div style="margin-top:0.25rem;"><span class="badge-pricelist-source" style="font-size:0.7rem; padding:0.15rem 0.4rem;">${c.pricelistName}</span></div>` : ''}
                </div>
            </div>
            <div class="entity-details">
                <div class="entity-detail">
                    <span class="entity-detail-label">Telepon / WA</span>
                    <span class="entity-detail-value">${c.phone}</span>
                </div>
                ${canSeePiutang ? `<div class="entity-detail">
                    <span class="entity-detail-label">Sisa Limit Piutang</span>
                    <span class="entity-detail-value" style="color:${color}; font-weight:700;">${rpShort(c.sisaLimitPiutang ?? c.remainingLimit)}</span>
                </div>` : ''}
                <div class="entity-detail">
                    <span class="entity-detail-label">Total Belanja</span>
                    <span class="entity-detail-value">${rpShort(c.totalBelanja ?? c.totalSpent)}</span>
                </div>
            </div>
            ${canSeePiutang ? `<div style="margin-top:0.6rem;">
                <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--slate-500);margin-bottom:3px;">
                    <span>Limit terpakai ${pctUsed}%</span>
                    <span>${rpShort(c.creditLimit)}</span>
                </div>
                <div style="background:var(--slate-200);border-radius:99px;height:5px;overflow:hidden;">
                    <div style="height:100%;width:${pctUsed}%;background:${color};border-radius:99px;transition:width .4s;"></div>
                </div>
            </div>` : ''}
        </div>
    `}).join('');

    if (listBody) {
        listBody.innerHTML = filtered.map(c => {
            const sisa = c.sisaLimitPiutang ?? c.remainingLimit;
            const color = sisa / (c.creditLimit || 1) > 0.5
                ? 'var(--emerald-600)'
                : sisa / (c.creditLimit || 1) > 0.1
                    ? 'var(--amber-500)'
                    : 'var(--rose-500)';
            return `
            <tr style="cursor:pointer;" onclick="openCustomerDetail('${c.id}')">
                <td style="font-weight:600; color: var(--blue-600);">${c.id}</td>
                <td style="font-weight:600;">
                    ${c.name}
                    ${c.pricelistName ? `<div style="margin-top:0.2rem;"><span class="badge-pricelist-source" style="font-size:0.65rem; padding:0.1rem 0.35rem;">${c.pricelistName}</span></div>` : ''}
                </td>
                <td><span class="badge-status aman">${c.type}</span></td>
                <td>
                    ${(c.tipePembayaranName || c.tipe_pembayaran_name)
                        ? `<span class="badge-status" style="background:var(--slate-100);color:var(--slate-700);font-size:0.75rem;">${c.tipePembayaranName || c.tipe_pembayaran_name}</span>`
                        : `<span style="color:var(--slate-400);font-size:0.75rem;font-style:italic;">Belum diatur (Kredit 30 Hari)</span>`}
                </td>
                <td>${c.city}</td>
                <td>${c.phone}</td>
                <td class="td-customer-piutang" style="font-weight:700;">${rp(c.creditLimit)}</td>
                <td class="td-customer-piutang" style="font-weight:700; color:${color}">${rp(sisa)}</td>
                <td style="font-weight:600;">${rp(c.totalBelanja ?? c.totalSpent)}</td>
                <td style="text-align: right; white-space: nowrap;" onclick="event.stopPropagation()">
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Edit Pelanggan" onclick="openEditCustomerModal('${c.id}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Hapus Pelanggan" onclick="deleteCustomer('${c.id}')">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                </td>
            </tr>
        `}).join('');
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    startDashboardAutoRefresh();
}

document.getElementById('customer-search')?.addEventListener('input', debounce(() => {
    paginationState.customers.page = 1;
    fetchCustomers(1);
}, 300));
document.getElementById('customer-type-filter')?.addEventListener('change', () => {
    paginationState.customers.page = 1;
    fetchCustomers(1);
});
document.getElementById('customer-sort')?.addEventListener('change', () => {
    paginationState.customers.page = 1;
    fetchCustomers(1);
});

// Customer view toggle bindings
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-view-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.currentTarget;
            document.querySelectorAll('.btn-view-toggle').forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = 'var(--gray-500)';
                b.style.boxShadow = 'none';
            });
            targetBtn.classList.add('active');
            targetBtn.style.background = 'white';
            targetBtn.style.color = 'var(--blue-600)';
            targetBtn.style.boxShadow = '0 1px 2px rgb(0 0 0 / 0.05)';

            customerViewMode = targetBtn.dataset.view;
            if (customerViewMode === 'list') {
                document.getElementById('customers-grid').style.display = 'none';
                document.getElementById('customers-list').style.display = 'block';
            } else {
                document.getElementById('customers-grid').style.display = 'grid';
                document.getElementById('customers-list').style.display = 'none';
            }
        });
    });
});

// ---------- Vendors Page ----------
let vendorViewMode = 'kanban';

function renderVendors(filter = '') {
    paginationState.vendors.page = 1;
    fetchVendors(1);
}

function _renderVendorsLocal_UNUSED(filter = '') {
    const grid = document.getElementById('vendors-grid');
    const listBody = document.getElementById('vendors-list-body');
    if (!grid) return;

    let filtered = VENDORS;
    if (filter) {
        const q = filter.toLowerCase();
        filtered = filtered.filter(v => v.name.toLowerCase().includes(q) || (v.id && v.id.toLowerCase().includes(q)));
    }

    grid.innerHTML = filtered.map(v => `
        <div class="entity-card" style="position: relative;">
            <button class="btn-toolbar secondary" style="position: absolute; top: 1rem; right: 1rem; padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Edit Vendor" onclick="openEditVendorModal('${v.id}')">
                <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
            </button>
            <div class="entity-card-header">
                <div class="entity-avatar ${v.color}">${v.name.charAt(0)}</div>
                <div>
                    <div class="entity-name">${v.name}</div>
                    <div class="entity-type">${v.category} &middot; ${v.city}</div>
                </div>
            </div>
            <div class="entity-details">
                <div class="entity-detail">
                    <span class="entity-detail-label">ID Vendor</span>
                    <span class="entity-detail-value">${v.id || 'V0XX'}</span>
                </div>
                <div class="entity-detail">
                    <span class="entity-detail-label">Telepon / WA</span>
                    <span class="entity-detail-value">${v.phone}</span>
                </div>
                <div class="entity-detail">
                    <span class="entity-detail-label">Total Pembelian</span>
                    <span class="entity-detail-value">${rpShort(v.totalPurchases)}</span>
                </div>
                <div class="entity-detail">
                    <span class="entity-detail-label">Hutang</span>
                    <span class="entity-detail-value" style="color: ${v.debt > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'}; font-weight:700;">${v.debt > 0 ? rp(v.debt) : 'Lunas'}</span>
                </div>
            </div>
        </div>
    `).join('');

    if (listBody) {
        listBody.innerHTML = filtered.map(v => `
            <tr>
                <td style="font-weight:600; color: var(--blue-600);">${v.id || 'V0XX'}</td>
                <td style="font-weight:600;">${v.name}</td>
                <td><span class="badge-status aman">${v.category}</span></td>
                <td>${v.city}</td>
                <td>${v.phone}</td>
                <td style="font-weight:700; color: ${v.debt > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">${v.debt > 0 ? rp(v.debt) : 'Lunas'}</td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Edit Vendor" onclick="openEditVendorModal('${v.id}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

document.getElementById('vendor-search')?.addEventListener('input', debounce(() => {
    paginationState.vendors.page = 1;
    fetchVendors(1);
}, 300));
document.getElementById('vendor-sort')?.addEventListener('change', () => {
    paginationState.vendors.page = 1;
    fetchVendors(1);
});

// Vendor view toggle bindings
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-vendor-view-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.currentTarget;
            document.querySelectorAll('.btn-vendor-view-toggle').forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = 'var(--gray-500)';
                b.style.boxShadow = 'none';
            });
            targetBtn.classList.add('active');
            targetBtn.style.background = 'white';
            targetBtn.style.color = 'var(--blue-600)';
            targetBtn.style.boxShadow = '0 1px 2px rgb(0 0 0 / 0.05)';

            vendorViewMode = targetBtn.dataset.view;
            if (vendorViewMode === 'list') {
                document.getElementById('vendors-grid').style.display = 'none';
                document.getElementById('vendors-list').style.display = 'block';
            } else {
                document.getElementById('vendors-grid').style.display = 'grid';
                document.getElementById('vendors-list').style.display = 'none';
            }
        });
    });
});

// ---------- Purchases Page ----------
function renderPurchases(filter = '') {
    paginationState.purchases.page = 1;
    fetchPurchases(1);
}

function _renderPurchasesLocal_UNUSED(filter = '') {
    if (!filter || typeof filter !== 'string') {
        const sel = document.getElementById('purchase-status-filter');
        filter = sel ? sel.value : 'all';
    }
    const tbody = document.getElementById('purchases-body');
    let filtered = PURCHASES;
    if (filter && filter !== 'all') {
        filtered = filtered.filter(p => p.status.toLowerCase() === filter);
    }
    const searchEl = document.getElementById('purchase-search');
    if (searchEl && searchEl.value) {
        const q = searchEl.value.toLowerCase();
        filtered = filtered.filter(p =>
            p.id.toLowerCase().includes(q) ||
            (p.vendor && p.vendor.toLowerCase().includes(q))
        );
    }

    tbody.innerHTML = filtered.map(p => `
        <tr>
            <td style="font-weight:600; color: var(--blue-600);">${p.id}</td>
            <td>${p.date}</td>
            <td>${p.vendor}</td>
            <td style="font-weight:700;">${rp(p.total)}</td>
            <td>${rp(p.paid)}</td>
            <td>${p.type}</td>
            <td><span class="badge-status ${p.status.toLowerCase()}">${capitalize(p.status)}</span></td>
            <td style="text-align: right; white-space: nowrap;">
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Cetak PO" onclick="openModal('modal-print-po')">
                    <i data-lucide="printer" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit PO" onclick="openEditPurchaseModal('${p.id}')">
                    <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
                ${p.status.toLowerCase() !== 'batal' ? `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Batalkan PO" onclick="cancelPurchase('${p.id}')">
                    <i data-lucide="x-circle" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>` : ''}
            </td>
        </tr>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ---------- Invoices Page ----------
function renderInvoices(filter = '') {
    paginationState.invoices.page = 1;
    fetchInvoices(1);
}

function _renderInvoicesLocal_UNUSED(filter = '') {
    if (!filter || typeof filter !== 'string') {
        const sel = document.getElementById('invoice-status-filter');
        filter = sel ? sel.value : 'all';
    }
    const tbody = document.getElementById('invoices-body');
    if (!tbody) return;

    let filtered = INVOICES;
    if (filter && filter !== 'all') {
        filtered = filtered.filter(i => i.status.toLowerCase() === filter);
    }
    const searchEl = document.getElementById('invoice-search');
    if (searchEl && searchEl.value) {
        const q = searchEl.value.toLowerCase();
        filtered = filtered.filter(i =>
            i.id.toLowerCase().includes(q) ||
            (i.customer && i.customer.toLowerCase().includes(q))
        );
    }

    tbody.innerHTML = filtered.map(inv => {
        const statusLower = (inv.status || '').toLowerCase();
        // Normalize status to single-word CSS class (e.g. 'Belum Bayar' → 'belum')
        const statusClass = statusLower.includes('belum') ? 'belum' : statusLower.replace(/\s+/g, '-');
        return `
        <tr>
            <td style="font-weight:600; color: var(--blue-600);">${inv.id}</td>
            <td>${inv.date}</td>
            <td>${inv.customer}</td>
            <td style="font-weight:700;">${rp(inv.total)}</td>
            <td>${rp(inv.paid)}</td>
            <td>${inv.type}</td>
            <td><span class="badge-status ${statusClass}">${capitalize(inv.status || 'Belum Bayar')}</span></td>
            <td style="text-align: right; white-space: nowrap;">
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Print Preview" onclick="window.open('/invoice-print.html?id=${encodeURIComponent(inv.id)}', '_blank', 'noopener')">
                    <i data-lucide="printer" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Invoice" onclick="openEditInvoiceModal('${inv.id}')">
                    <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
                ${statusLower !== 'batal' ? `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--rose-500);" title="Batalkan Invoice" onclick="cancelInvoice('${inv.id}')">
                    <i data-lucide="x-circle" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>` : ''}
                ${statusLower !== 'lunas' && statusLower !== 'batal' ? `<button class="btn-toolbar primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="openPiutangPaymentModal('${inv.id}', ${inv.total - inv.paid})">Bayar</button>` : ''}
            </td>
        </tr>
    `}).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ---------- Piutang Page ----------
function renderPiutang(filter) {
    paginationState.piutang.page = 1;
    fetchPiutang(1);
}

function _renderPiutangLocal_UNUSED(filter) {
    if (!filter || typeof filter !== 'string') {
        const sel = document.getElementById('piutang-status-filter');
        filter = sel ? sel.value : 'all';
    }
    const piutangInvoices = INVOICES.filter(i => !['lunas', 'batal'].includes(i.status.toLowerCase()));
    const totalPiutang = piutangInvoices.reduce((s, i) => s + (i.total - i.paid), 0);
    const belumBayar = INVOICES.filter(i => i.status.toLowerCase().includes('belum')).reduce((s, i) => s + i.total, 0);
    const sebagian = INVOICES.filter(i => i.status.toLowerCase() === 'sebagian').reduce((s, i) => s + (i.total - i.paid), 0);

    document.getElementById('piutang-summary').innerHTML =
        '<div class="finance-summary-card highlight">' +
            '<div class="fs-value">' + rp(totalPiutang) + '</div>' +
            '<div class="fs-label">Total Piutang</div>' +
        '</div>' +
        '<div class="finance-summary-card">' +
            '<div class="fs-value" style="color:var(--rose-500);">' + rp(belumBayar) + '</div>' +
            '<div class="fs-label">Belum Dibayar</div>' +
        '</div>' +
        '<div class="finance-summary-card">' +
            '<div class="fs-value" style="color:var(--amber-500);">' + rp(sebagian) + '</div>' +
            '<div class="fs-label">Dibayar Sebagian</div>' +
        '</div>';

    // Populate customer filter dropdown (preserving current selection)
    const custFilterEl = document.getElementById('piutang-customer-filter');
    if (custFilterEl) {
        const selectedCust = custFilterEl.value;
        const uniqueCustomers = [...new Map(
            INVOICES.filter(i => i.customer).map(i => [String(i.customerId), i.customer])
        ).entries()].sort((a, b) => a[1].localeCompare(b[1]));
        custFilterEl.innerHTML = '<option value="all">Semua Pelanggan</option>' +
            uniqueCustomers.map(([cid, cname]) =>
                '<option value="' + cid + '" ' + (selectedCust === cid ? 'selected' : '') + '>' + cname + '</option>'
            ).join('');
    }

    const tbody = document.getElementById('piutang-body');
    let filtered = INVOICES.filter(i => i.status.toLowerCase() !== 'batal');
    const today = new Date().toISOString().split('T')[0];

    if (filter && filter !== 'all') {
        if (filter === 'overdue') {
            filtered = filtered.filter(i => { const sisa = i.total - i.paid; return sisa > 0 && i.dueDate && i.dueDate < today; });
        } else if (filter === 'belum bayar' || filter === 'belum') {
            filtered = filtered.filter(i => i.status.toLowerCase().includes('belum'));
        } else {
            filtered = filtered.filter(i => i.status.toLowerCase() === filter);
        }
    }

    const custFilter = custFilterEl ? custFilterEl.value : 'all';
    if (custFilter && custFilter !== 'all') {
        filtered = filtered.filter(i => String(i.customerId) === String(custFilter));
    }

    const searchEl = document.getElementById('piutang-search');
    if (searchEl && searchEl.value) {
        const q = searchEl.value.toLowerCase();
        filtered = filtered.filter(i => i.id.toLowerCase().includes(q) || (i.customer && i.customer.toLowerCase().includes(q)));
    }

    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canPayOrVoid = role === 'admin' || role === 'finance';

    tbody.innerHTML = filtered.map(inv => {
        const sisa = inv.total - inv.paid;
        const isOverdue = sisa > 0 && inv.dueDate && inv.dueDate < today;
        const statusLower = (inv.status || '').toLowerCase();
        const overdueBadge = isOverdue
            ? '<span class="badge-status overdue" style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;padding:2px 7px;margin-left:4px;vertical-align:middle;"><i data-lucide="clock" style="width:11px;height:11px;"></i> Lewat JT</span>'
            : '';
        let actionButtons = '<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" title="Riwayat Cicilan & Bayar" onclick="openPaymentHistoryModal(\'' + inv.id + '\')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>';
        return '<tr>' +
            '<td style="font-weight:600;color:var(--blue-600);">' + inv.id + '</td>' +
            '<td>' + inv.customer + '</td>' +
            '<td style="font-weight:700;">' + rp(inv.total) + '</td>' +
            '<td>' + rp(inv.paid) + '</td>' +
            '<td style="font-weight:700;color:' + (sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)') + ';">' + rp(sisa) + '</td>' +
            '<td>' + (inv.dueDate || '-') + overdueBadge + '</td>' +
            '<td>' + (statusLower.includes('belum') ? '-' : (inv.paidDate || '-')) + '</td>' +
            '<td>' + (statusLower.includes('belum') ? '-' : (inv.type || '-')) + '</td>' +
            '<td><span class="badge-status ' + (statusLower.includes('belum') ? 'belum' : statusLower.replace(/\s+/g, '-')) + '">' + capitalize(inv.status) + '</span></td>' +
            '<td style="white-space:nowrap;">' + actionButtons + '</td>' +
            '</tr>';
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ---------- Hutang Page ----------
function renderHutang(filter = '') {
    paginationState.hutang.page = 1;
    fetchHutang(1);
}

function _renderHutangLocal_UNUSED(filter = '') {
    if (!filter || typeof filter !== 'string') {
        const sel = document.getElementById('hutang-status-filter');
        filter = sel ? sel.value : 'all';
    }
    const totalHutang = VENDORS.reduce((s, v) => s + v.debt, 0);
    const vendorsWithDebt = VENDORS.filter(v => v.debt > 0);

    document.getElementById('hutang-summary').innerHTML = `
        <div class="finance-summary-card highlight">
            <div class="fs-value">${rp(totalHutang)}</div>
            <div class="fs-label">Total Hutang</div>
        </div>
        <div class="finance-summary-card">
            <div class="fs-value">${vendorsWithDebt.length}</div>
            <div class="fs-label">Vendor Belum Lunas</div>
        </div>
        <div class="finance-summary-card">
            <div class="fs-value">${VENDORS.length - vendorsWithDebt.length}</div>
            <div class="fs-label">Vendor Lunas</div>
        </div>
    `;

    // Convert purchases to hutang rows
    const tbody = document.getElementById('hutang-body');
    let purchaseData = PURCHASES;

    if (filter === 'lunas') {
        purchaseData = PURCHASES.filter(p => p.paid >= p.total);
    } else if (filter === 'belum bayar' || filter === 'belum') {
        purchaseData = PURCHASES.filter(p => parseFloat(p.paid) === 0);
    } else if (filter === 'sebagian') {
        purchaseData = PURCHASES.filter(p => p.paid > 0 && p.paid < p.total);
    }
    const searchEl = document.getElementById('hutang-search');
    if (searchEl && searchEl.value) {
        const q = searchEl.value.toLowerCase();
        purchaseData = purchaseData.filter(p =>
            p.id.toLowerCase().includes(q) ||
            (p.vendor && p.vendor.toLowerCase().includes(q))
        );
    }

    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canPay = role === 'admin' || role === 'finance';
    const canEditPO = role === 'admin' || role === 'finance' || role === 'gudang';

    tbody.innerHTML = purchaseData.map(p => {
        const sisa = p.total - p.paid;
        const st = sisa > 0 ? 'belum' : 'lunas';
        const payBtn = (canPay && sisa > 0) ? `<button class="btn-toolbar primary" style="padding:0.3rem 0.65rem; font-size:0.75rem; margin-right:0.25rem;" onclick="openHutangPaymentModal('${p.id}', ${sisa})">Bayar</button>` : '';
        const editBtn = canEditPO ? `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" title="Edit PO" onclick="openEditPurchaseModal('${p.id}')"><i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i></button>` : '';
        return `
            <tr>
                <td style="font-weight:600; color: var(--blue-600);">${p.id}</td>
                <td>${p.vendor}</td>
                <td style="font-weight:700;">${rp(p.total)}</td>
                <td>${rp(p.paid)}</td>
                <td style="font-weight:700; color: ${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'}">${rp(sisa)}</td>
                <td>${p.dueDate || p.date || '-'}</td>
                <td>${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.paidDate || '-')}</td>
                <td>${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.type || '-')}</td>
                <td><span class="badge-status ${st}">${sisa > 0 ? 'Belum Lunas' : 'Lunas'}</span></td>
                <td style="text-align:right; white-space:nowrap;">${payBtn}${editBtn}</td>
            </tr>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function fetchHutang(page) {
    try {
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        if (role !== 'admin' && role !== 'gudang') {
            return;
        }

        if (page !== undefined) paginationState.hutang.page = page;
        const q = document.getElementById('hutang-search')?.value || '';
        const status = document.getElementById('hutang-status-filter')?.value || 'all';
        const pg = paginationState.hutang.page;
        let url = '/api/finance/payables?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (status && status !== 'all') url += '&status=' + encodeURIComponent(status);

        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
            console.warn('Payables fetch error:', res.status);
            return;
        }
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};
        const summary = json.summary || {};
        paginationState.hutang.total = pag.total || 0;
        paginationState.hutang.totalPages = pag.totalPages || 1;

        // 4 Summary cards (Total Hutang, Vendor Belum Lunas, Vendor Lunas, Lewat JT)
        const summEl = document.getElementById('hutang-summary');
        if (summEl) {
            const totalDebt = parseFloat(summary.total_debt || summary.totalDebt || 0);
            const vendorsWithDebt = parseInt(summary.vendors_with_debt || summary.vendorsWithDebt || 0);
            const vendorsLunas = parseInt(summary.vendors_lunas || summary.vendorsLunas || 0);
            const overdueCount = parseInt(summary.overdue_count || summary.overdueCount || 0);
            summEl.innerHTML = `
            <div class="finance-summary-card highlight">
                <div class="fs-value">${rp(totalDebt)}</div>
                <div class="fs-label">Total Hutang</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value">${vendorsWithDebt}</div>
                <div class="fs-label">Vendor Belum Lunas</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value">${vendorsLunas}</div>
                <div class="fs-label">Vendor Lunas</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value" style="color:var(--rose-600);">${overdueCount}</div>
                <div class="fs-label">Lewat Jatuh Tempo</div>
            </div>`;
        }

        const canManageHutang = role === 'admin' || role === 'gudang';
        const tbody = document.getElementById('hutang-body');
        if (!tbody) return;

        tbody.innerHTML = rows.map(p => {
            const sisa = p.sisa !== undefined ? p.sisa : Math.max(0, p.total - (p.returnAmount || 0) - p.paid);
            const isChecked = selectedHutangIds.has(String(p.id));
            const overdueBadge = p.isOverdue
                ? '<span class="badge-status overdue" style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;padding:2px 7px;margin-left:4px;vertical-align:middle;"><i data-lucide="clock" style="width:11px;height:11px;"></i> Lewat JT</span>'
                : '';

            const checkboxHtml = `<td style="text-align: center; width: 36px;">
                <input type="checkbox" class="check-hutang-item" value="${p.id}" ${isChecked ? 'checked' : ''} onchange="onHutangCheckboxChange(this, '${p.id}')">
            </td>`;

            let actionButtons = '';
            if (canManageHutang) {
                const histBtn = `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" title="Riwayat Cicilan & Bayar" onclick="openHutangPaymentHistoryModal('${p.id}')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>`;
                const deleteBtn = p.isOutstandingImport
                    ? `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;color:var(--rose-500);" title="Hapus Hutang Outstanding" onclick="confirmDeleteOutstandingHutang('${p.id}', ${p.paid || 0})"><i data-lucide="trash-2" style="width:13px;height:13px;margin:0;"></i></button>`
                    : '';
                const editBtn = (!p.isOutstandingImport && (role === 'admin' || role === 'gudang'))
                    ? `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;" title="Edit PO" onclick="openEditPurchaseModal('${p.id}')"><i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i></button>`
                    : '';
                actionButtons = `${histBtn}${deleteBtn}${editBtn}`;
            } else {
                actionButtons = '<span style="color:var(--gray-400);font-size:0.8rem;">Lihat Saja</span>';
            }

            const stClass = sisa > 0 ? (parseFloat(p.paid) > 0 ? 'sebagian' : 'belum') : 'lunas';
            const stLabel = sisa > 0 ? (parseFloat(p.paid) > 0 ? 'Sebagian' : 'Belum Lunas') : 'Lunas';

            return `
            <tr>
                ${checkboxHtml}
                <td style="font-weight:600; color: var(--blue-600);">${p.id}</td>
                <td>${p.vendor}</td>
                <td style="font-weight:700;">${rp(p.total)}</td>
                <td>${rp(p.paid)}</td>
                <td style="font-weight:700; color: ${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">${rp(sisa)}</td>
                <td>${p.dueDate || p.date || '-'}${overdueBadge}</td>
                <td>${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.paidDate || '-')}</td>
                <td>${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.type || '-')}</td>
                <td><span class="badge-status ${stClass}">${stLabel}</span></td>
                <td style="text-align:right; white-space:nowrap;">${actionButtons}</td>
            </tr>`;
        }).join('');

        updateCheckAllHutangState();
        updateExportHutangPdfButton();

        renderPagination({
            containerId: 'pagination-hutang',
            currentPage: pg,
            totalItems: paginationState.hutang.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchHutang(p)
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch hutang', err);
    }
}

// ---------- Cash Flow Page ----------
function renderCashFlow(filter = '') {
    if (filter && filter !== '') currentCashFlowFilter = filter;
    paginationState.cashflow.page = 1;
    fetchCashTransactions(1);
}

function _renderCashFlowLocal_UNUSED(filter = '') {
    const activeTx = CASH_TRANSACTIONS.filter(t => (t.status || 'active') === 'active');
    const totalIn = activeTx.filter(t => t.type === 'IN').reduce((s, t) => s + t.amount, 0);
    const totalOut = activeTx.filter(t => t.type === 'OUT').reduce((s, t) => s + t.amount, 0);
    const net = totalIn - totalOut;

    document.getElementById('cashflow-summary').innerHTML = `
        <div class="finance-summary-card">
            <div class="fs-value" style="color: var(--emerald-500);">${rp(totalIn)}</div>
            <div class="fs-label">Total Kas Masuk</div>
        </div>
        <div class="finance-summary-card">
            <div class="fs-value" style="color: var(--rose-500);">${rp(totalOut)}</div>
            <div class="fs-label">Total Kas Keluar</div>
        </div>
        <div class="finance-summary-card highlight">
            <div class="fs-value">${rp(net)}</div>
            <div class="fs-label">Saldo Bersih</div>
        </div>
    `;

    const tbody = document.getElementById('cashflow-body');
    let filtered = CASH_TRANSACTIONS;

    // Filter tipe (in/out)
    if (filter === 'in') filtered = filtered.filter(t => t.type === 'IN');
    if (filter === 'out') filtered = filtered.filter(t => t.type === 'OUT');

    tbody.innerHTML = filtered.map(t => {
        const isCancelled = t.status === 'cancelled';
        const isManual = t.isManual && t.category !== 'Penyesuaian Stok';
        const rowStyle = isCancelled ? 'opacity:0.55; text-decoration: line-through;' : '';

        const actionBtns = isCancelled ? `<span class="badge-status batal" style="font-size:0.7rem;">Dibatalkan</span>` : `
            ${isManual ? `<button class="btn-toolbar secondary" style="padding:0.2rem 0.45rem; font-size:0.72rem; margin-right:0.2rem;" title="Edit" onclick="openEditCashModal('${t.id}')"><i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i></button>` : ''}
            <button class="btn-toolbar secondary" style="padding:0.2rem 0.45rem; font-size:0.72rem; color:var(--rose-500);" title="${isManual ? 'Hapus' : 'Void/Batal'}" onclick="cancelCashTransaction('${t.id}')"><i data-lucide="x-circle" style="width:13px;height:13px;margin:0;"></i></button>
        `;

        return `
        <tr style="${rowStyle}">
            <td>${t.date}</td>
            <td style="font-weight:600;">${t.desc}</td>
            <td><span class="badge-status ${t.category === 'Penjualan' || t.category === 'Piutang' ? 'lunas' : 'tempo'}">${t.category}</span></td>
            <td><span class="badge-status ${t.type.toLowerCase()}">${t.type === 'IN' ? 'Masuk' : 'Keluar'}</span></td>
            <td style="font-weight:700; color: ${t.type === 'IN' ? 'var(--emerald-500)' : 'var(--rose-500)'};">${t.type === 'IN' ? '+' : '-'}${rp(t.amount)}</td>
            <td><span class="badge-status ${t.status === 'cancelled' ? 'batal' : 'lunas'}">${t.status === 'cancelled' ? 'Dibatalkan' : 'Aktif'}</span></td>
            <td>${t.method}</td>
            <td style="text-align:right; white-space:nowrap;">${actionBtns}</td>
        </tr>
    `}).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ---------- Profit & Loss Page ----------
async function renderProfitLoss() {
    const bulanSelect = document.getElementById('filter-bulan');
    const tahunSelect = document.getElementById('filter-tahun');

    // Set default to current month/year if not set yet
    if (!bulanSelect.value) {
        const today = new Date();
        bulanSelect.value = today.getMonth() + 1;
        tahunSelect.value = today.getFullYear();
    }

    const bulan = bulanSelect.value;
    const tahun = tahunSelect.value;
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    const periodEl = document.getElementById('report-period');
    if (periodEl) periodEl.innerText = `Periode: ${monthNames[bulan - 1]} ${tahun}`;

    const contentEl = document.getElementById('report-content');
    if (contentEl) contentEl.innerHTML = '<div style="text-align:center; padding: 2rem;">Memuat...</div>';

    try {
        const res = await fetch(`/api/laporan/laba-rugi?bulan=${bulan}&tahun=${tahun}`, {
            headers: getAuthHeaders()
        });
        const dataRes = await res.json();

        if (!dataRes.success) throw new Error(dataRes.error || 'Gagal memuat data');

        const d = dataRes.data;
        const fmtAmt = (amt, isSubtotal = false) => {
            if (amt < 0) return `<span style="color:var(--rose-600);">- ${rp(Math.abs(amt))}</span>`;
            if (amt > 0 && isSubtotal) return `<span style="color:var(--emerald-600);">${rp(amt)}</span>`;
            return `<span>${rp(amt)}</span>`;
        };

        const rowStyle = "display:flex; justify-content:space-between; padding:0.5rem 0; border-bottom:1px dashed var(--gray-200);";
        const titleStyle = "font-weight:600; color:var(--indigo-600); margin-bottom:0.75rem; text-transform:uppercase; letter-spacing:0.05em; font-size:1.1rem; margin-top:1.5rem;";
        const highlightStyle = "display:flex; justify-content:space-between; padding:1rem; border-radius:6px; margin-top:0.5rem; margin-bottom:1.5rem; font-weight:700; font-size:1.1rem; background:var(--gray-50);";

        const grandTotalStyle = `margin-top:2rem; padding:1.5rem; color: ${d.labaBersih >= 0 ? 'var(--emerald-600)' : 'var(--rose-600)'}; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-size:1.25rem; font-weight:700; background: ${d.labaBersih >= 0 ? 'var(--emerald-50)' : 'var(--rose-50)'}; border-top: 2px solid ${d.labaBersih >= 0 ? 'var(--emerald-200)' : 'var(--rose-200)'};`;

        const html = `
            <!-- 1. PENDAPATAN -->
            <div>
                <div style="${titleStyle}">Pendapatan</div>
                <div style="${rowStyle}">
                    <span>Penjualan Kotor</span>
                    ${fmtAmt(d.pendapatan.kotor)}
                </div>
                <div style="${rowStyle} color:var(--gray-500); padding-left:1.5rem;">
                    <span>Dikurangi: Retur & Diskon</span>
                    ${fmtAmt(-d.pendapatan.diskon)}
                </div>
                <div style="${rowStyle} font-weight:600; border-bottom:none; padding-top:1rem;">
                    <span>Penjualan Bersih</span>
                    ${fmtAmt(d.pendapatan.bersih, true)}
                </div>
            </div>

            <!-- 2. HPP -->
            <div>
                <div style="${titleStyle}">Harga Pokok Penjualan (HPP)</div>
                <div style="${rowStyle}">
                    <span>Total Pembelian / HPP</span>
                    ${fmtAmt(-d.hpp)}
                </div>
            </div>

            <!-- LABA KOTOR -->
            <div style="${highlightStyle}">
                <span>Laba Kotor</span>
                ${fmtAmt(d.labaKotor, true)}
            </div>

            <!-- 3. BEBAN OPERASIONAL -->
            <div>
                <div style="${titleStyle}">Beban Operasional</div>
                ${d.operasional.rincian.length > 0 ? d.operasional.rincian.map(r => `
                    <div style="${rowStyle} color:var(--gray-500); padding-left:1.5rem;">
                        <span>${r.category}</span>
                        ${fmtAmt(-r.total)}
                    </div>
                `).join('') : `<div style="${rowStyle} color:var(--gray-500); padding-left:1.5rem;"><span>Tidak ada beban tercatat</span><span>Rp 0</span></div>`}
                ${d.operasional.bebanFeeCustomer > 0 ? `
                <div style="${rowStyle} color:#92400e; padding-left:1.5rem; background:#fffbeb; border-radius:4px; padding:0.4rem 0.4rem 0.4rem 1.5rem;">
                    <span style="display:flex;align-items:center;gap:0.3rem;">Beban Fee Customer <span style="font-size:0.7rem;background:#fef3c7;border-radius:3px;padding:0.1rem 0.3rem;">(Internal)</span></span>
                    ${fmtAmt(-d.operasional.bebanFeeCustomer)}
                </div>` : ''}
                <div style="${rowStyle} font-weight:600; border-bottom:none; padding-top:1rem;">
                    <span>Total Beban Operasional</span>
                    ${fmtAmt(-d.operasional.total)}
                </div>
            </div>

            <!-- LABA OPERASIONAL -->
            <div style="${highlightStyle}">
                <span>Laba Operasional</span>
                ${fmtAmt(d.labaOperasional, true)}
            </div>

            <!-- 4. PENYESUAIAN STOK -->
            <div>
                <div style="${titleStyle}">Penyesuaian Stok</div>
                <div style="${rowStyle} color:var(--gray-500); padding-left:1.5rem;">
                    <span>Penyesuaian Stok Masuk</span>
                    ${fmtAmt(d.penyesuaian_stok.masuk)}
                </div>
                <div style="${rowStyle} color:var(--gray-500); padding-left:1.5rem;">
                    <span>Penyesuaian Stok Keluar</span>
                    ${fmtAmt(-d.penyesuaian_stok.keluar)}
                </div>
                <div style="${rowStyle} font-weight:600; border-bottom:none; padding-top:1rem;">
                    <span>Net Penyesuaian Stok</span>
                    ${fmtAmt(d.penyesuaian_stok.net, true)}
                </div>
            </div>

            <!-- 5. PENDAPATAN LAIN-LAIN -->
            <div>
                <div style="${titleStyle}">Pendapatan Lain-lain</div>
                <div style="${rowStyle}">
                    <span>Pendapatan di luar usaha</span>
                    ${fmtAmt(d.pendapatanLain, true)}
                </div>
            </div>

            <!-- THIN DIVIDER -->
            <hr style="margin-top: 2rem; border: 0; border-top: 1px solid var(--gray-200);">

            <!-- LABA BERSIH -->
            <div style="${grandTotalStyle}">
                <span>${d.labaBersih >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH'}</span>
                ${fmtAmt(d.labaBersih, true)}
            </div>
        `;

        if (contentEl) contentEl.innerHTML = html;
    } catch (err) {
        if (contentEl) contentEl.innerHTML = `<div style="text-align:center; padding: 2rem; color: red;">${err.message}</div>`;
    }
}

// ---------- Balance Sheet Page ----------
async function renderBalance() {
    const bulanSelect = document.getElementById('balance-filter-bulan');
    const tahunSelect = document.getElementById('balance-filter-tahun');

    // Set default to current month/year on first load
    if (!bulanSelect.value) {
        const today = new Date();
        bulanSelect.value = today.getMonth() + 1;
        tahunSelect.value = today.getFullYear();
    }

    const bulan = bulanSelect.value;
    const tahun = tahunSelect.value;

    const content = document.getElementById('balance-content');
    const periodEl = document.getElementById('balance-report-period');
    const statusEl = document.getElementById('balance-status-indicator');

    if (content) content.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--gray-400);">Memuat data neraca...</div>`;
    if (statusEl) statusEl.style.display = 'none';

    try {
        const res = await fetch(`/api/laporan/neraca?bulan=${bulan}&tahun=${tahun}`, {
            headers: getAuthHeaders()
        });
        const dataRes = await res.json();

        if (!dataRes.success) throw new Error(dataRes.error || 'Gagal memuat data neraca');

        const d = dataRes.data;

        if (periodEl) periodEl.innerText = d.per_tanggal;

        const rowStyle = 'display:flex; justify-content:space-between; align-items:center; padding:1rem 0; border-bottom:1px solid var(--gray-100); font-size:0.9rem;';
        const lastRowStyle = 'display:flex; justify-content:space-between; align-items:center; padding:1rem 0; font-size:0.9rem;';
        const totalRowStyle = 'display:flex; justify-content:space-between; align-items:center; padding:1.1rem 0; margin-top:0.5rem; border-top:2px solid var(--gray-200); font-weight:700; font-size:1rem;';
        const sectionTitleStyle = 'font-weight:700; color:var(--indigo-600); margin-bottom:1.25rem; text-transform:uppercase; letter-spacing:0.06em; font-size:0.85rem;';
        const subTitleStyle = 'font-weight:600; color:var(--gray-500); margin:1.25rem 0 0.25rem 0; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em;';
        const cardStyle = 'background:white; border-radius:12px; border:1px solid var(--gray-200); padding:1.75rem;';
        const grandTotalStyle = 'display:flex; justify-content:space-between; align-items:center; padding:1.1rem 0; margin-top:1.25rem; border-top:2px solid var(--gray-300); font-weight:700; font-size:1.05rem;';

        content.innerHTML = `
            <!-- ASET -->
            <div style="${cardStyle}">
                <div style="${sectionTitleStyle}">Aset</div>

                <div style="${subTitleStyle}">Aset Lancar</div>
                <div style="${rowStyle}"><span>Kas &amp; Bank</span><span>${rp(d.aset.kas_bank)}</span></div>
                <div style="${rowStyle}"><span>Piutang Usaha</span><span>${rp(d.aset.piutang_usaha)}</span></div>
                <div style="${lastRowStyle}"><span>Persediaan Barang</span><span>${rp(d.aset.persediaan)}</span></div>

                <div style="${totalRowStyle}"><span>Total Aset</span><span style="color:var(--indigo-600);">${rp(d.aset.total)}</span></div>
            </div>

            <!-- LIABILITAS & EKUITAS -->
            <div style="display:flex; flex-direction:column; gap:1.25rem;">
                <div style="${cardStyle}">
                    <div style="${sectionTitleStyle}">Liabilitas</div>
                    <div style="${subTitleStyle}">Kewajiban Lancar</div>
                    <div style="${rowStyle}"><span>Hutang Usaha</span><span>${rp(d.liabilitas.hutang_usaha)}</span></div>
                    <div style="${lastRowStyle}"><span>Hutang Lain-lain</span><span>${rp(d.liabilitas.hutang_lain)}</span></div>
                    <div style="${totalRowStyle}"><span>Total Liabilitas</span><span>${rp(d.liabilitas.total)}</span></div>
                </div>

                <div style="${cardStyle}">
                    <div style="${sectionTitleStyle}">Ekuitas</div>
                    <div style="${rowStyle}"><span>Modal Pemilik</span><span>${rp(d.ekuitas.modal_pemilik)}</span></div>
                    <div style="${lastRowStyle}"><span>Laba Ditahan</span><span style="color:${d.ekuitas.laba_ditahan >= 0 ? 'var(--emerald-600)' : 'var(--rose-600)'}">${rp(d.ekuitas.laba_ditahan)}</span></div>
                    <div style="${totalRowStyle}"><span>Total Ekuitas</span><span>${rp(d.ekuitas.total)}</span></div>

                    <div style="${grandTotalStyle}">
                        <span>Total Liabilitas &amp; Ekuitas</span>
                        <span style="color:var(--indigo-600);">${rp(d.total_liabilitas_ekuitas)}</span>
                    </div>
                </div>
            </div>
        `;

        // Balance status indicator
        if (statusEl) {
            statusEl.style.display = 'flex';
            if (d.is_balanced) {
                statusEl.style.background = 'var(--emerald-50)';
                statusEl.style.color = 'var(--emerald-700)';
                statusEl.style.border = '1px solid var(--emerald-200)';
                statusEl.innerHTML = `<i data-lucide="check-circle"></i> Neraca Seimbang — Total Aset = Total Liabilitas &amp; Ekuitas`;
            } else {
                statusEl.style.background = 'var(--rose-50)';
                statusEl.style.color = 'var(--rose-700)';
                statusEl.style.border = '1px solid var(--rose-200)';
                statusEl.innerHTML = `<i data-lucide="alert-triangle"></i> Neraca Tidak Seimbang — Periksa kembali data transaksi`;
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

    } catch (err) {
        console.error('renderBalance error:', err);
        if (content) content.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--rose-500);">Gagal memuat data: ${err.message}</div>`;
    }
}

// ---------- Reports Page ----------
async function renderReports() {
    const bulanSelect = document.getElementById('reports-filter-bulan');
    const tahunSelect = document.getElementById('reports-filter-tahun');

    // Default to current month/year on first load
    if (!bulanSelect.value) {
        const today = new Date();
        bulanSelect.value = today.getMonth() + 1;
        tahunSelect.value = today.getFullYear();
    }

    const bulan = bulanSelect.value;
    const tahun = tahunSelect.value;

    const insightsEl = document.getElementById('report-insights');
    const productsEl = document.getElementById('top-products-chart');
    const customersEl = document.getElementById('top-customers-list');
    const noDataEl = document.getElementById('reports-no-data');

    // Loading states
    insightsEl.innerHTML = `<div style="grid-column:1/-1; padding:2rem; text-align:center; color:var(--gray-400);">Memuat data...</div>`;
    productsEl.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--gray-400);">Memuat...</div>`;
    customersEl.innerHTML = `<li style="padding:1rem; text-align:center; color:var(--gray-400);">Memuat...</li>`;
    if (noDataEl) noDataEl.style.display = 'none';

    try {
        const res = await fetch(`/api/laporan/performa?bulan=${bulan}&tahun=${tahun}`, {
            headers: getAuthHeaders()
        });
        const dataRes = await res.json();

        if (!dataRes.success) throw new Error(dataRes.error || 'Gagal memuat data');

        const d = dataRes.data;

        // Show no-data notice if no transactions
        if (noDataEl) noDataEl.style.display = d.has_data ? 'none' : 'block';

        // 1. Insight Cards
        insightsEl.innerHTML = `
            <div class="insight-card">
                <div class="insight-card-title"><i data-lucide="trending-up"></i> Rata-rata Penjualan/Hari</div>
                <div class="insight-card-value">${rpShort(d.rata_hari)}</div>
                <div class="insight-card-desc">Berdasarkan data bulan ini</div>
            </div>
            <div class="insight-card">
                <div class="insight-card-title"><i data-lucide="receipt"></i> Rata-rata Nilai Invoice</div>
                <div class="insight-card-value">${rpShort(d.rata_invoice)}</div>
                <div class="insight-card-desc">Dari ${d.jumlah_invoice} invoice bulan ini</div>
            </div>
            <div class="insight-card">
                <div class="insight-card-title"><i data-lucide="percent"></i> Margin Rata-rata</div>
                <div class="insight-card-value">${d.margin.toFixed(1)}%</div>
                <div class="insight-card-desc">Laba kotor dibanding omzet</div>
            </div>
            <div class="insight-card">
                <div class="insight-card-title"><i data-lucide="users"></i> Customer Retention</div>
                <div class="insight-card-value">${Math.round(d.retention)}%</div>
                <div class="insight-card-desc">Pelanggan yang repeat order</div>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // 2. Top Products Bar Chart
        if (!d.has_data || d.top_products.every(p => p.total_nilai === 0)) {
            productsEl.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--gray-400); font-size:0.88rem;">Belum ada data penjualan bulan ini</div>`;
        } else {
            const maxProd = d.top_products[0].total_nilai || 1;
            productsEl.innerHTML = d.top_products.map(p => {
                const pct = (p.total_nilai / maxProd) * 100;
                return `
                    <div class="hbar-item">
                        <span class="hbar-label" title="${p.name}">${p.name}</span>
                        <div class="hbar-track">
                            <div class="hbar-fill" style="width: ${pct}%;">
                                <span class="hbar-fill-text">${pct >= 30 ? rpShort(p.total_nilai) : ''}</span>
                            </div>
                        </div>
                        <span class="hbar-value">${rpShort(p.total_nilai)}</span>
                    </div>
                `;
            }).join('');
        }

        // 3. Top Customers Rank List
        const badgeColors = [
            'background:linear-gradient(135deg,#f59e0b,#d97706); color:white;',  // gold
            'background:var(--gray-300); color:white;',                           // silver
            'background:#cd7f32; color:white;',                                   // bronze
        ];
        if (d.top_customers.length === 0) {
            customersEl.innerHTML = `<li style="padding:1.5rem; text-align:center; color:var(--gray-400); font-size:0.88rem;">Belum ada data penjualan bulan ini</li>`;
        } else {
            customersEl.innerHTML = d.top_customers.map((c, i) => `
                <li class="insight-rank-item">
                    <span class="insight-rank-num" style="${i < 3 ? badgeColors[i] : ''}">${i + 1}</span>
                    <span class="insight-rank-name">${c.name}</span>
                    <span class="insight-rank-value">${rpShort(c.total_belanja)}</span>
                </li>
            `).join('');
        }

    } catch (err) {
        console.error('renderReports error:', err);
        insightsEl.innerHTML = `<div style="grid-column:1/-1; padding:2rem; text-align:center; color:var(--rose-500);">Gagal memuat data: ${err.message}</div>`;
        productsEl.innerHTML = '';
        customersEl.innerHTML = '';
    }
}

// ---------- POS / Kasir ----------
let cart = [];
let currentPpnRate = 11;
let selectedCartPaymentTypeId = 'PT-1';

function renderPOSProducts(searchTerm = '', category = '') {
    const grid = document.getElementById('pos-product-grid');
    const customerId = document.getElementById('pos-customer-id')?.value;
    const noCustomer = !customerId;

    let filtered = PRODUCTS;
    if (searchTerm) {
        const q = searchTerm.toLowerCase();
        filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
    }
    if (category && category !== 'all') {
        filtered = filtered.filter(p => p.category === category);
    }

    if (noCustomer) {
        // Tampilkan pesan + produk dinonaktifkan
        const placeholder = `<div style="position:relative; display:contents;">
            ${filtered.map(p => `
            <div class="pos-product-card" style="opacity:0.45; cursor:not-allowed; pointer-events:none;" title="Pilih pelanggan terlebih dahulu">
                <div class="pos-product-emoji">${p.emoji}</div>
                <div class="pos-product-name">${p.name}</div>
                <div class="pos-product-price">${rp(p.price)}</div>
                <div class="pos-product-stock">Stok: ${p.stock} ${p.unit}</div>
            </div>
            `).join('')}
        </div>`;
        grid.innerHTML = placeholder;
        // Overlay pesan di atas grid
        let overlayEl = document.getElementById('pos-product-lock-overlay');
        if (!overlayEl) {
            overlayEl = document.createElement('div');
            overlayEl.id = 'pos-product-lock-overlay';
            overlayEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:10;pointer-events:none;';
            overlayEl.innerHTML = '<div style="background:rgba(255,255,255,0.92);border:1.5px solid var(--blue-200);border-radius:0.75rem;padding:1rem 1.5rem;text-align:center;box-shadow:0 4px 16px rgba(59,130,246,0.12);">' +
                '<i data-lucide="user" style="width:20px;height:20px;color:var(--blue-500);display:block;margin:0 auto 0.5rem;"></i>' +
                '<div style="font-weight:600;color:var(--blue-700);font-size:0.875rem;">Pilih pelanggan terlebih dahulu</div>' +
                '<div style="font-size:0.75rem;color:var(--gray-500);margin-top:0.2rem;">Harga produk ditentukan berdasarkan pricelist pelanggan</div>' +
                '</div>';
            const posProducts = document.querySelector('.pos-products');
            if (posProducts) {
                if (getComputedStyle(posProducts).position === 'static') posProducts.style.position = 'relative';
                posProducts.appendChild(overlayEl);
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        } else {
            overlayEl.style.display = 'flex';
        }
        return;
    }

    // Sembunyikan overlay jika ada
    const overlayEl = document.getElementById('pos-product-lock-overlay');
    if (overlayEl) overlayEl.style.display = 'none';

    grid.innerHTML = filtered.map(p => `
        <div class="pos-product-card" onclick="addToCart('${p.id}')">
            <div class="pos-product-emoji">${p.emoji}</div>
            <div class="pos-product-name">${p.name}</div>
            <div class="pos-product-price">${rp(p.price)}</div>
            <div class="pos-product-stock">Stok: ${p.stock} ${p.unit}</div>
        </div>
    `).join('');
}

function addToCart(productId) {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return;
    // Guard: wajib pilih pelanggan dulu
    const customerId = document.getElementById('pos-customer-id')?.value;
    if (!customerId) {
        showToast('Pilih pelanggan terlebih dahulu sebelum memilih produk.', 'warning');
        return;
    }

    const existing = cart.find(c => c.id === productId);
    if (existing) {
        existing.qty += 1;
    } else {
        // Apply pricelist effective price if customer is selected
        const eff = currentPOSCustomerEffectivePrices[productId];
        const effectivePrice = eff ? parseFloat(eff.harga_efektif) : parseFloat(product.price);
        const sumberHarga = eff ? eff.sumber_harga : 'master';
        const pricelistNama = eff ? (eff.pricelist_nama || '') : '';
        const cost = parseFloat(product.cost_price || product.cost || 0);
        cart.push({
            ...product,
            price: effectivePrice,
            originalPrice: parseFloat(product.price),
            sumberHarga,
            pricelistNama,
            cost,
            manual_override: false,
            qty: 1,
            fee: 0,
            feeNotes: ''
        });
    }
    renderCart();

    // A6: Auto-scroll ke item terbaru + highlight
    const cartContainer = document.getElementById('pos-cart-items');
    if (cartContainer) {
        setTimeout(() => {
            cartContainer.scrollTop = cartContainer.scrollHeight;
            const lastItem = cartContainer.querySelector('.cart-item:last-child');
            if (lastItem) {
                lastItem.classList.add('cart-item-highlight');
                setTimeout(() => lastItem.classList.remove('cart-item-highlight'), 1000);
            }
        }, 50);
    }
}

function updateCartQty(productId, delta) {
    const item = cart.find(c => c.id === productId);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        cart = cart.filter(c => c.id !== productId);
    }
    renderCart();
}

function removeFromCart(productId) {
    cart = cart.filter(c => c.id !== productId);
    renderCart();
}

function renderCart() {
    const container = document.getElementById('pos-cart-items');
    const emptyState = document.getElementById('cart-empty');
    const countEl = document.getElementById('cart-count');
    const isAdmin = (localStorage.getItem('role') || 'kasir').toLowerCase() === 'admin';

    countEl.textContent = cart.reduce((s, c) => s + c.qty, 0);

    if (cart.length === 0) {
        container.innerHTML = `<div class="empty-state" id="cart-empty"><i data-lucide="shopping-bag"></i><p>Keranjang masih kosong</p></div>`;
        document.getElementById('cart-subtotal').textContent = 'Rp 0';
        document.getElementById('cart-discount').textContent = 'Rp 0';
        
        const ppnRowEl = document.getElementById('cart-ppn-row');
        const ppnEl = document.getElementById('cart-ppn');
        const ppnLabelEl = document.getElementById('cart-ppn-label');
        if (ppnRowEl) ppnRowEl.style.display = currentPpnEnabled ? 'flex' : 'none';
        if (ppnEl) ppnEl.textContent = 'Rp 0';
        if (ppnLabelEl) ppnLabelEl.textContent = `(${currentPpnRate}%)`;
        
        document.getElementById('cart-total').textContent = 'Rp 0';
        lucide.createIcons();
        return;
    }

    container.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div class="cart-item-row">
                <div class="cart-item-info">
                    <div class="cart-item-name">
                        ${item.emoji ? item.emoji + ' ' : ''}${item.name}
                        ${item.manual_override ? '<span class="badge-manual-source" style="font-size:0.65rem; margin-left:4px;">✏️ Manual</span>' : (item.sumberHarga === 'pricelist' ? `<span class="badge-pricelist-source" style="font-size:0.65rem; margin-left:4px;">${item.pricelistNama || 'Pricelist'}</span>` : '')}
                        ${(isAdmin && item.cost > 0 && item.price < item.cost) ? '<span class="badge-hpp-warning" style="font-size:0.65rem; margin-left:4px;">⚠️ Bawah HPP</span>' : ''}
                        ${isAdmin && item.fee > 0 ? `<span class="fee-indicator">Fee: ${rp(item.fee)}</span>` : ''}
                    </div>
                    <div class="cart-item-price-edit" style="display:flex; align-items:center; gap:0.25rem;">
                        <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                        <input type="number" step="any" value="${formatNumberTrim(item.price)}" onchange="updateCartPrice('${item.id}', this.value)" style="width:70px; padding:0.1rem 0.25rem; font-size:0.875rem; border:1px solid var(--gray-200); border-radius:0.25rem;" />
                        <span style="font-size:0.75rem; color:var(--gray-500);">/ ${item.unit}</span>
                    </div>
                </div>
                <div class="cart-item-qty">
                    <button class="cart-qty-btn" onclick="updateCartQty('${item.id}', -1)">-</button>
                    <span class="cart-qty-val">${formatNumberTrim(item.qty)}</span>
                    <button class="cart-qty-btn" onclick="updateCartQty('${item.id}', 1)">+</button>
                </div>
                <div class="cart-item-total">${rp(item.price * item.qty)}</div>
                ${isAdmin ? `<button class="cart-fee-toggle" onclick="toggleFeeRow('${item.id}')" title="Toggle fee">fee</button>` : ''}
                <button class="cart-item-remove" onclick="removeFromCart('${item.id}')"><i data-lucide="trash-2"></i></button>
            </div>
            ${isAdmin ? `
            <div class="cart-item-fee-row" id="fee-row-${item.id}" style="display:none;">
                <span class="cart-item-fee-label">Fee (Rp)</span>
                <input type="number" min="0" value="${item.fee || 0}" placeholder="0"
                    class="cart-item-fee-input"
                    onchange="updateCartFee('${item.id}', this.value)"
                    title="Fee internal per item (hanya terlihat admin, tidak tampil di invoice)" />
                <input type="text" value="${item.feeNotes || ''}" placeholder="Catatan fee..."
                    class="cart-item-fee-input"
                    style="max-width:130px;"
                    oninput="updateCartFeeNotes('${item.id}', this.value)"
                    title="Catatan fee (opsional)" />
            </div>` : ''}
        </div>
    `).join('');

    window.updateCartPrice = (id, newPrice) => {
        const item = cart.find(c => c.id === id);
        if (item) {
            item.price = parseFloat(newPrice) || 0;
            item.manual_override = true; // R3: track manual edit
            // Re-render without full re-render so input focus is kept
        }
    };

    window.updateCartFee = (id, newFee) => {
        const item = cart.find(c => c.id === id);
        if (item) {
            item.fee = Math.max(0, parseFloat(newFee) || 0);
        }
    };

    window.updateCartFeeNotes = (id, notes) => {
        const item = cart.find(c => c.id === id);
        if (item) {
            item.feeNotes = notes || '';
        }
    };

    // A5: Toggle visibility fee row (hanya admin)
    window.toggleFeeRow = (id) => {
        const row = document.getElementById(`fee-row-${id}`);
        if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    };

    const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const discount = 0; // if there is discount logic
    const afterDiscount = subtotal - discount;
    const ppnAmount = currentPpnEnabled ? afterDiscount * (currentPpnRate / 100) : 0;
    const total = afterDiscount + ppnAmount;

    document.getElementById('cart-subtotal').textContent = rp(subtotal);
    document.getElementById('cart-discount').textContent = 'Rp 0';

    const ppnRowEl = document.getElementById('cart-ppn-row');
    const ppnEl = document.getElementById('cart-ppn');
    const ppnLabelEl = document.getElementById('cart-ppn-label');
    if (ppnRowEl) ppnRowEl.style.display = currentPpnEnabled ? 'flex' : 'none';
    if (ppnEl) ppnEl.textContent = rp(ppnAmount);
    if (ppnLabelEl) ppnLabelEl.textContent = `(${currentPpnRate}%)`;

    document.getElementById('cart-total').textContent = rp(total);

    lucide.createIcons();
}

// Old Settings PPN binding removed

// POS search
document.getElementById('pos-search')?.addEventListener('input', (e) => {
    const activeCat = document.querySelector('.pos-category-tab.active')?.dataset.cat || 'all';
    renderPOSProducts(e.target.value, activeCat);
});

// POS category tabs
document.getElementById('pos-category-tabs')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('pos-category-tab')) {
        document.querySelectorAll('.pos-category-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        // A6: Auto-scroll chip aktif ke tengah view
        e.target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        renderPOSProducts(document.getElementById('pos-search').value, e.target.dataset.cat);
    }
});

// Payment type buttons
document.querySelectorAll('.cart-payment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.cart-payment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Keep track of currently selected payment method
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'cart-payment-type') {
        selectedCartPaymentTypeId = e.target.value;
        console.log(`[Frontend State] Payment method changed to: ${selectedCartPaymentTypeId}`);
        // Show/hide DP wrapper based on payment type
        const payName = getPaymentTypeName(e.target).toLowerCase();
        const isKredit = payName.includes('tempo') || payName.includes('kredit') || payName.includes('credit');
        const dpWrapper = document.getElementById('cart-dp-wrapper');
        if (dpWrapper) {
            dpWrapper.style.display = isKredit ? 'block' : 'none';
            if (!isKredit) {
                const dpInput = document.getElementById('cart-dp-amount');
                if (dpInput) dpInput.value = '';
            }
        }
    }
});

// Checkout
document.getElementById('btn-checkout')?.addEventListener('click', async () => {
    if (cart.length === 0) return;

    const customerId = document.getElementById('pos-customer-id').value;
    if (!customerId) {
        showToast('Silakan pilih pelanggan terlebih dahulu.', 'warning');
        return;
    }

    const paymentTypeSelect = document.getElementById('cart-payment-type');
    if (paymentTypeSelect) {
        selectedCartPaymentTypeId = paymentTypeSelect.value;
    }
    const payment_type_id = selectedCartPaymentTypeId;

    // Guard: payment type must be selected
    if (!payment_type_id) {
        showToast('Pilih metode pembayaran terlebih dahulu.', 'warning');
        return;
    }

    // Detect payment behaviour by name (not hardcoded PT-2 ID)
    const payTypeName = getPaymentTypeName(paymentTypeSelect).toLowerCase();
    // Kredit/Tempo = deferred payment (paid=0 on creation); Transfer/Tunai = full paid
    const isTempo = payTypeName.includes('tempo') || payTypeName.includes('credit') || payTypeName.includes('kredit');
    // Transfer = full immediate payment (same as Tunai for amount purposes)
    // Tunai = full immediate payment

    const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const ppnAmount = (typeof currentPpnEnabled !== 'undefined' && currentPpnEnabled) ? Math.round(subtotal * (currentPpnRate / 100)) : 0;
    const total = subtotal + ppnAmount;

    // Tempo/credit: if DP entered use it, otherwise 0; Tunai/Transfer = full paid
    const dpAmount = isTempo ? (parseFloat(document.getElementById('cart-dp-amount')?.value) || 0) : 0;
    const paid = isTempo ? dpAmount : total;

    console.log(`[Checkout] payment_type_id=${payment_type_id} | name=${payTypeName} | isTempo=${isTempo} | paid=${paid} | total=${total}`);

    // Get order date from input; fallback to today (WITA) if empty
    const orderDateInput = document.getElementById('cart-order-date');
    const todayWITA = getTodayWITA();
    const maxOrderDate = getMaxOrderDateWITA();
    let orderDate = (orderDateInput && orderDateInput.value) ? orderDateInput.value : todayWITA;
    if (orderDateInput && !orderDateInput.value) {
        orderDateInput.value = todayWITA;
    }
    if (orderDate > maxOrderDate) {
        showToast(`Tanggal Order maksimal 7 hari ke depan (sampai ${formatMaxDateDisplay(maxOrderDate)}).`, 'warning');
        if (orderDateInput) orderDateInput.value = todayWITA;
        return;
    }

    const payload = {
        customer_id: customerId,
        date: orderDate,
        total: total,
        paid: paid,
        payment_type_id: payment_type_id,
        due_date: calculateDueDate(getPaymentTypeName(paymentTypeSelect), orderDate),
        items: cart.map(item => ({
            id: item.id,
            quantity: item.qty,
            price: item.price,
            customer_fee: item.fee || 0,
            fee_notes: item.feeNotes || ''
        }))
    };

    console.log(`[Checkout Submission] Submitting checkout payload to backend:`, JSON.stringify(payload, null, 2));

    try {
        const res = await fetch('/api/invoices', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const result = await res.json();
            const successDesc = document.querySelector('#modal-checkout-success p');
            if (successDesc) successDesc.innerHTML = `Transaksi berhasil.<br>Nomor Invoice: <b>${result.invoiceId}</b>`;
            
            const printBtn = document.getElementById('btn-print-new-invoice');
            if (printBtn) {
                printBtn.dataset.invoiceId = result.invoiceId;
            }

            openModal('modal-checkout-success');
            notifyDataChange('sales');

            cart = [];
            currentPOSCustomerEffectivePrices = {};
            document.getElementById('pos-customer-id').value = '';
            document.getElementById('pos-customer-search').value = '';
            const clearBtn = document.getElementById('pos-customer-clear');
            if (clearBtn) clearBtn.style.display = 'none';
            // Reset Tanggal Order to today
            const resetDateEl = document.getElementById('cart-order-date');
            if (resetDateEl) {
                const todayStr = getTodayWITA();
                resetDateEl.value = todayStr;
                resetDateEl.max = getMaxOrderDateWITA();
            }
            const posBadge = document.getElementById('pos-customer-pricelist-badge');
            if (posBadge) posBadge.innerHTML = '';
            selectedCartPaymentTypeId = 'PT-1';
            document.getElementById('cart-payment-type').value = 'PT-1';

            renderCart();
            await fetchProducts();
            renderPOSProducts();
            await fetchInvoices();
            await fetchCashTransactions();
            await renderDashboard();
        } else {
            let errMsg = 'Terjadi kesalahan';
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (e) {
                if (res.status === 401 || res.status === 403) errMsg = 'Sesi telah habis, silakan login kembali.';
                else errMsg = `Error ${res.status}: Server gagal merespon.`;
            }
            showToast('Gagal membuat invoice: ' + errMsg, 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
});

// ─── FITUR PROFORMA INVOICE (BAGIAN B) ─────────────────────────────────────────

// POS: Tombol Cetak Proforma
document.getElementById('btn-create-proforma')?.addEventListener('click', async () => {
    if (cart.length === 0) {
        showToast('Keranjang masih kosong.', 'warning');
        return;
    }

    const customerId = document.getElementById('pos-customer-id').value;
    if (!customerId) {
        showToast('Silakan pilih pelanggan terlebih dahulu.', 'warning');
        return;
    }

    const paymentTypeSelect = document.getElementById('cart-payment-type');
    const payment_type_id = paymentTypeSelect ? paymentTypeSelect.value : selectedCartPaymentTypeId;
    if (!payment_type_id) {
        showToast('Pilih metode pembayaran terlebih dahulu.', 'warning');
        return;
    }

    // Tanggal Order proforma (ATURAN UMUM 6)
    const orderDateInput = document.getElementById('cart-order-date');
    const todayWITA = getTodayWITA();
    const maxOrderDate = getMaxOrderDateWITA();
    let orderDate = (orderDateInput && orderDateInput.value) ? orderDateInput.value : todayWITA;
    if (orderDateInput && !orderDateInput.value) {
        orderDateInput.value = todayWITA;
    }
    if (orderDate > maxOrderDate) {
        showToast(`Tanggal Order maksimal 7 hari ke depan (sampai ${formatMaxDateDisplay(maxOrderDate)}).`, 'warning');
        if (orderDateInput) orderDateInput.value = todayWITA;
        return;
    }

    const btn = document.getElementById('btn-create-proforma');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width:14px;height:14px;"></i> Menyimpan...';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    const payload = {
        customer_id: customerId,
        order_date: orderDate,
        payment_type_id: payment_type_id,
        discount: 0,
        items: cart.map(item => ({
            id: item.id,
            product_id: item.id,
            name: item.name,
            quantity: item.qty,
            price: item.price,
            customer_fee: item.fee || 0,
            fee_notes: item.feeNotes || ''
        }))
    };

    try {
        const res = await fetch('/api/proformas', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const result = await res.json();
            showToast(`Proforma ${result.proformaNo} berhasil dibuat!`, 'success');

            // Buka print preview proforma di tab baru (pakai invoice-print template)
            window.open(`invoice-print.html?type=proforma&pk=${result.proformaPk}`, '_blank');

            // Kosongkan keranjang & reset form POS
            cart = [];
            currentPOSCustomerEffectivePrices = {};
            document.getElementById('pos-customer-id').value = '';
            document.getElementById('pos-customer-search').value = '';
            const clearBtn = document.getElementById('pos-customer-clear');
            if (clearBtn) clearBtn.style.display = 'none';

            const resetDateEl = document.getElementById('cart-order-date');
            if (resetDateEl) {
                const todayStr = getTodayWITA();
                resetDateEl.value = todayStr;
                resetDateEl.max = getMaxOrderDateWITA();
            }
            const posBadge = document.getElementById('pos-customer-pricelist-badge');
            if (posBadge) posBadge.innerHTML = '';
            selectedCartPaymentTypeId = 'PT-1';
            if (paymentTypeSelect) paymentTypeSelect.value = 'PT-1';

            renderCart();
            if (typeof fetchProformas === 'function') fetchProformas();
        } else {
            let errMsg = `Error ${res.status}`;
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (_) {}
            console.error('[Proforma Create] Server error:', res.status, errMsg);
            showToast(`Gagal membuat proforma: ${errMsg}`, 'error');
        }
    } catch (err) {
        console.error('[Proforma POS] Fetch exception:', err);
        showToast(`Gagal menghubungi server: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
});

// State & pagination untuk proforma list
let currentProformasData = [];
let currentProformaPage = 1;

async function fetchProformas(page = 1) {
    currentProformaPage = page;
    if (page !== undefined && paginationState.proformas) paginationState.proformas.page = page;
    const search = document.getElementById('proforma-search')?.value.trim() || '';
    const status = document.getElementById('proforma-status-filter')?.value || 'all';
    const tbody = document.getElementById('proformas-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--gray-400);"><i data-lucide="loader-2" class="spin" style="width:20px;height:20px;display:inline-block;"></i> Memuat data...</td></tr>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    try {
        const sumber = document.getElementById('proforma-sumber-filter')?.value || 'all';
        const queryParams = new URLSearchParams({
            page: page,
            limit: PAGE_SIZE,
            search: search,
            status: status
        });
        if (sumber && sumber !== 'all') queryParams.set('sumber', sumber);

        const res = await fetch(`/api/proformas?${queryParams.toString()}`, {
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            let errMsg = `Error ${res.status}`;
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (_) {}
            console.error('[fetchProformas] Server error:', res.status, errMsg);
            if (res.status === 401 || res.status === 403) {
                showToast('Sesi telah berakhir, silakan login kembali.', 'error');
                return;
            }
            throw new Error(errMsg);
        }

        const data = await res.json();
        currentProformasData = data.rows || [];
        if (paginationState.proformas) {
            paginationState.proformas.total = data.total || 0;
            paginationState.proformas.totalPages = data.totalPages || 1;
        }
        renderProformasTable(data, page);
    } catch (err) {
        console.error('[fetchProformas] Error:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--rose-500);">Gagal memuat proforma: ${err.message}</td></tr>`;
        }
    }
}

function renderProformasTable(data, page = 1) {
    const tbody = document.getElementById('proformas-body');
    if (!tbody) return;

    if (!data.rows || data.rows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding: 3rem 1rem; color: var(--gray-400);">
                    <i data-lucide="file-check" style="width: 42px; height: 42px; color: var(--gray-300); margin-bottom: 0.5rem; display: inline-block;"></i>
                    <p style="margin: 0; font-size: 0.95rem; font-weight: 600; color: var(--gray-600);">Belum ada proforma</p>
                    <p style="margin: 4px 0 0; font-size: 0.8rem; color: var(--gray-400);">Buat dokumen proforma penawaran baru dari menu Order / Kasir.</p>
                </td>
            </tr>
        `;
        renderPagination({
            containerId: 'pagination-proformas',
            currentPage: page,
            totalItems: 0,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchProformas(p)
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    const rowsHtml = data.rows.map(r => {
        const displaySt = (r.display_status || r.status || '').toLowerCase();
        let statusClass = 'aktif';
        let statusLabel = 'Aktif';

        if (displaySt === 'kedaluwarsa') {
            statusClass = 'kedaluwarsa';
            statusLabel = 'Kedaluwarsa';
        } else if (displaySt === 'dikonversi') {
            statusClass = 'dikonversi';
            statusLabel = 'Dikonversi';
        } else if (displaySt === 'dibatalkan') {
            statusClass = 'dibatalkan';
            statusLabel = 'Dibatalkan';
        }

        const dariBadge = r.sumber === 'dari_invoice'
            ? '<span class="badge-status dari-invoice">Dari Invoice</span>'
            : '';

        let actionsHtml = `
            <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Cetak Proforma" onclick="printProforma(${r.pk})">
                <i data-lucide="printer" style="width: 14px; height: 14px; margin: 0;"></i>
            </button>
        `;

        if (r.status === 'aktif') {
            actionsHtml += `
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Proforma" onclick="editProforma(${r.pk})">
                    <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
                <button class="btn-toolbar primary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Jadikan Invoice" onclick="openConvertProformaModal(${r.pk})">
                    Invoice
                </button>
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Perpanjang Masa Berlaku" onclick="openExtendProformaModal(${r.pk}, '${r.proforma_no}', '${r.berlaku_hingga}')">
                    <i data-lucide="calendar-plus" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--rose-500); border-color: #fecaca; background: #fee2e2;" title="Batalkan Proforma" onclick="openCancelProformaModal(${r.pk}, '${r.proforma_no}')">
                    <i data-lucide="x-circle" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
            `;
        } else if (r.status === 'dikonversi' && r.invoice_id) {
            actionsHtml += `
                <a href="#" onclick="viewInvoiceFromProforma('${r.invoice_id}'); return false;" class="btn-toolbar secondary" style="display:inline-flex; align-items:center; gap:2px; font-size:0.75rem; padding: 0.25rem 0.5rem; text-decoration:none; color:var(--blue-600); margin-right: 0.25rem;" title="Lihat Invoice">
                    <i data-lucide="external-link" style="width:13px;height:13px;margin:0;"></i> ${r.invoice_id}
                </a>
            `;
        }

        return `
            <tr>
                <td style="font-weight:600; color: var(--blue-600);">${r.proforma_no}</td>
                <td>${r.order_date}</td>
                <td style="font-weight:600;">${r.customer_name || 'Pelanggan Umum'}</td>
                <td style="font-weight:700;">${rp(r.total)}</td>
                <td>${r.sumber === 'dari_invoice' ? '-' : (r.berlaku_hingga || '-')}</td>
                <td>${r.payment_type_name || 'Tunai'}</td>
                <td><span class="badge-status ${statusClass}">${statusLabel}</span>${dariBadge}</td>
                <td style="text-align: right; white-space: nowrap;">
                    ${actionsHtml}
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowsHtml;
    renderPagination({
        containerId: 'pagination-proformas',
        currentPage: page,
        totalItems: paginationState.proformas ? paginationState.proformas.total : (data.total || 0),
        pageSize: PAGE_SIZE,
        onPageChange: (p) => fetchProformas(p)
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function printProforma(pk) {
    window.open(`invoice-print.html?type=proforma&pk=${encodeURIComponent(pk)}`, '_blank');
}

function viewInvoiceFromProforma(invoiceId) {
    if (!invoiceId) return;
    navigateTo('invoices');
    setTimeout(() => {
        const s = document.getElementById('invoice-search');
        if (s) {
            s.value = invoiceId;
            renderInvoices();
        }
    }, 200);
}

// ─── Item 3: Mode Edit Proforma ───────────────────────────────────────────────

/**
 * Masuk ke mode edit proforma: navigasi ke POS, isi keranjang dari data proforma.
 */
async function enterProformaEditMode(pk) {
    try {
        const res = await fetch(`/api/proformas/${pk}/print-data`, { headers: getAuthHeaders() });
        if (!res.ok) {
            let errMsg = `Error ${res.status}`;
            try { const d = await res.json(); if (d.error) errMsg = d.error; } catch(_) {}
            showToast(`Gagal memuat data proforma: ${errMsg}`, 'error');
            return;
        }
        const data = await res.json();
        const pf = data.proforma;

        // Ambil juga items dengan harga snapshot (termasuk fee jika admin)
        const itemsRes = await fetch(`/api/proformas/${pk}/items`, { headers: getAuthHeaders() });
        if (!itemsRes.ok) {
            showToast('Gagal memuat item proforma', 'error');
            return;
        }
        const pfItems = await itemsRes.json();

        // Jika status bukan aktif — beri tahu user
        if (pf.display_status === 'dikonversi') {
            showToast('Proforma sudah dikonversi menjadi invoice, tidak bisa diedit.', 'warning');
            return;
        }
        if (pf.display_status === 'dibatalkan') {
            showToast('Proforma sudah dibatalkan, tidak bisa diedit.', 'warning');
            return;
        }

        // Navigasi ke POS dulu
        navigateTo('pos');

        // Tunggu sebentar agar halaman aktif
        await new Promise(r => setTimeout(r, 100));

        // Set state
        posEditMode = true;
        posEditProformaPk = pk;
        posEditProformaRevisi = pf.revisi !== undefined ? pf.revisi : 0;
        posEditCartDirty = false;

        // Isi pelanggan (readonly)
        const custSearch = document.getElementById('pos-customer-search');
        const custId = document.getElementById('pos-customer-id');
        const custClear = document.getElementById('pos-customer-clear');
        if (custSearch) {
            custSearch.value = data.customer?.name || '';
            custSearch.disabled = true;
            custSearch.style.background = '#f1f5f9';
        }
        if (custId) custId.value = pf.customer_id || '';
        if (custClear) custClear.style.display = 'none';

        // Isi keranjang dari snapshot items
        cart = pfItems.map(item => ({
            id: item.product_id,
            name: item.product_name_snapshot || 'Produk',
            price: parseFloat(item.price),
            qty: parseFloat(item.quantity),
            unit: item.unit_name_snapshot || '-',
            fee: parseFloat(item.customer_fee || 0),
            feeNotes: item.fee_notes || '',
            // Tandai sebagai item snapshot (harga dari proforma, bukan pricelist saat ini)
            snapshotPrice: true
        }));
        currentPOSCustomerEffectivePrices = {};

        // Set tanggal order
        const orderDateEl = document.getElementById('cart-order-date');
        if (orderDateEl) {
            orderDateEl.value = pf.order_date || getTodayWITA();
            // Tanggal order TIDAK dibatasi max saat edit (sudah divalidasi saat buat)
            orderDateEl.removeAttribute('max');
        }

        // Set payment type
        const payTypeEl = document.getElementById('cart-payment-type');
        if (payTypeEl && pf.payment_type_id) {
            // Cari option yang cocok
            const opts = payTypeEl.options;
            for (let i = 0; i < opts.length; i++) {
                if (opts[i].value === String(pf.payment_type_id)) {
                    payTypeEl.selectedIndex = i;
                    selectedCartPaymentTypeId = opts[i].value;
                    break;
                }
            }
        }

        // Tampilkan banner mode edit
        const banner = document.getElementById('pos-edit-mode-banner');
        if (banner) {
            banner.style.display = 'block';
            const label = document.getElementById('pos-edit-mode-label');
            if (label) label.textContent = `Mode Edit: ${pf.proforma_no}`;
        }

        // Sembunyikan tombol normal, tampilkan tombol edit
        const btnCheckout = document.getElementById('btn-checkout');
        const btnCreateProforma = document.getElementById('btn-create-proforma');
        const editActionsRow = document.getElementById('pos-edit-actions-row');
        if (btnCheckout) btnCheckout.style.display = 'none';
        if (btnCreateProforma) btnCreateProforma.style.display = 'none';
        if (editActionsRow) editActionsRow.style.display = 'flex';

        // Render ulang keranjang
        renderCart();
        if (typeof lucide !== 'undefined') lucide.createIcons();

        showToast(`Mode edit proforma ${pf.proforma_no}`, 'info');
    } catch (err) {
        console.error('[enterProformaEditMode] Error:', err);
        showToast('Gagal membuka mode edit proforma: ' + err.message, 'error');
    }
}

/**
 * Keluar dari mode edit proforma. confirm = apakah tanya jika ada perubahan.
 */
function exitProformaEditMode(confirm = false) {
    if (confirm && posEditCartDirty) {
        if (!window.confirm('Ada perubahan yang belum disimpan. Keluar dari mode edit?')) {
            return;
        }
    }

    posEditMode = false;
    posEditProformaPk = null;
    posEditProformaRevisi = 0;
    posEditCartDirty = false;

    // Reset UI
    const banner = document.getElementById('pos-edit-mode-banner');
    if (banner) banner.style.display = 'none';

    const btnCheckout = document.getElementById('btn-checkout');
    const btnCreateProforma = document.getElementById('btn-create-proforma');
    const editActionsRow = document.getElementById('pos-edit-actions-row');
    if (btnCheckout) btnCheckout.style.display = '';
    if (btnCreateProforma) btnCreateProforma.style.display = '';
    if (editActionsRow) editActionsRow.style.display = 'none';

    // Unlock customer search
    const custSearch = document.getElementById('pos-customer-search');
    if (custSearch) {
        custSearch.disabled = false;
        custSearch.style.background = '';
    }

    // Reset tanggal ke max normal
    const orderDateEl = document.getElementById('cart-order-date');
    if (orderDateEl) {
        orderDateEl.max = getMaxOrderDateWITA();
        orderDateEl.value = getTodayWITA();
    }

    // Kosongkan keranjang
    cart = [];
    currentPOSCustomerEffectivePrices = {};
    const custId = document.getElementById('pos-customer-id');
    const custSearchEl = document.getElementById('pos-customer-search');
    const custClear = document.getElementById('pos-customer-clear');
    if (custId) custId.value = '';
    if (custSearchEl) custSearchEl.value = '';
    if (custClear) custClear.style.display = 'none';
    const posBadge = document.getElementById('pos-customer-pricelist-badge');
    if (posBadge) posBadge.innerHTML = '';

    renderCart();
    navigateTo('proformas');
}

/**
 * Simpan perubahan proforma. printAfter = buka tab cetak setelah simpan.
 */
async function saveProformaEdit(printAfter = false) {
    if (!posEditProformaPk) return;
    if (cart.length === 0) {
        showToast('Keranjang tidak boleh kosong.', 'warning');
        return;
    }

    const orderDateEl = document.getElementById('cart-order-date');
    const orderDate = orderDateEl ? orderDateEl.value : getTodayWITA();

    const payTypeEl = document.getElementById('cart-payment-type');
    const paymentTypeId = payTypeEl ? payTypeEl.value : selectedCartPaymentTypeId;

    const payload = {
        revisi: posEditProformaRevisi,
        order_date: orderDate,
        payment_type_id: paymentTypeId,
        discount: 0,
        items: cart.map(item => ({
            product_id: item.id,
            name: item.name,
            quantity: item.qty,
            price: item.price,
            customer_fee: item.fee || 0,
            fee_notes: item.feeNotes || ''
        }))
    };

    const saveBtns = [
        document.getElementById('btn-save-proforma-edit'),
        document.getElementById('btn-save-print-proforma-edit')
    ].filter(Boolean);
    saveBtns.forEach(b => { b.disabled = true; });

    try {
        const res = await fetch(`/api/proformas/${posEditProformaPk}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.status === 409) {
            const d = await res.json().catch(() => ({}));
            showToast(`Konflik: ${d.error || 'Proforma sudah diubah oleh pengguna lain, muat ulang.'}`, 'error');
            saveBtns.forEach(b => { b.disabled = false; });
            return;
        }

        if (!res.ok) {
            let errMsg = `Error ${res.status}`;
            try { const d = await res.json(); if (d.error) errMsg = d.error; } catch(_) {}
            showToast(`Gagal menyimpan: ${errMsg}`, 'error');
            saveBtns.forEach(b => { b.disabled = false; });
            return;
        }

        const result = await res.json();
        showToast(`Proforma ${result.proforma_no || ''} berhasil diperbarui (Rev.${(posEditProformaRevisi || 0) + 1}).`, 'success');

        if (printAfter) {
            window.open(`invoice-print.html?type=proforma&pk=${posEditProformaPk}`, '_blank');
        }

        posEditCartDirty = false;
        exitProformaEditMode(false);
    } catch (err) {
        console.error('[saveProformaEdit] Error:', err);
        showToast('Gagal menghubungi server: ' + err.message, 'error');
        saveBtns.forEach(b => { b.disabled = false; });
    }
}

/**
 * Entry point dari tombol Edit di tabel proforma.
 */
function editProforma(pk) {
    enterProformaEditMode(pk);
}
window.editProforma = editProforma;

// ─── Item 4: Buat Proforma dari Invoice ───────────────────────────────────────

/**
 * Buka modal konfirmasi buat proforma dari invoice.
 */
function openBuatProformaDariInvoice(invoiceId) {
    document.getElementById('buat-proforma-invoice-id').value = invoiceId;
    const desc = document.getElementById('buat-proforma-desc');
    if (desc) desc.textContent = `Buat dokumen proforma dari invoice ${invoiceId}? Proforma ini hanya salinan penawaran dan tidak mengubah stok, piutang, atau kas.`;
    openModal('modal-buat-proforma-dari-invoice');
}
window.openBuatProformaDariInvoice = openBuatProformaDariInvoice;

/**
 * Konfirmasi dan eksekusi buat proforma dari invoice.
 */
async function confirmBuatProformaDariInvoice() {
    const invoiceId = document.getElementById('buat-proforma-invoice-id').value;
    if (!invoiceId) return;

    const btn = document.getElementById('btn-confirm-buat-proforma');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width:13px;height:13px;"></i> Memproses...';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/proforma`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });

        let result;
        try { result = await res.json(); } catch(_) { result = {}; }

        if (!res.ok) {
            showToast(`Gagal membuat proforma: ${result.error || 'Terjadi kesalahan'}`, 'error');
            return;
        }

        closeModal('modal-buat-proforma-dari-invoice');

        if (result.sudah_ada) {
            showToast(`Proforma ${result.proforma.proforma_no} sudah ada untuk invoice ini.`, 'info');
        } else {
            showToast(`Proforma ${result.proforma.proforma_no} berhasil dibuat!`, 'success');
        }

        // Update map dan buka print tab
        INVOICE_PROFORMA_MAP[invoiceId] = result.proforma.pk;
        window.open(`invoice-print.html?type=proforma&pk=${result.proforma.pk}`, '_blank');

        // Refresh tabel invoice agar tombol berubah
        await fetchInvoices(paginationState.invoices.page);
    } catch (err) {
        console.error('[confirmBuatProformaDariInvoice] Error:', err);
        showToast('Gagal menghubungi server: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}
window.confirmBuatProformaDariInvoice = confirmBuatProformaDariInvoice;

/**
 * Buka cetak proforma yang sudah ada dari invoice.
 */
function printProformaDariInvoice(proformaPk) {
    window.open(`invoice-print.html?type=proforma&pk=${encodeURIComponent(proformaPk)}`, '_blank');
}
window.printProformaDariInvoice = printProformaDariInvoice;

// ─── Modal Konversi Proforma ke Invoice ───────────────────────────────────────
let activeConvertProforma = null;

async function openConvertProformaModal(pk) {
    try {
        const modalInfo = document.getElementById('convert-proforma-info');
        const warningsEl = document.getElementById('convert-proforma-warnings');
        const orderDateInput = document.getElementById('convert-order-date');
        const paymentSelect = document.getElementById('convert-payment-type');
        const confirmBtn = document.getElementById('btn-confirm-convert');

        document.getElementById('convert-proforma-pk').value = pk;
        if (modalInfo) modalInfo.innerHTML = '<i data-lucide="loader-2" class="spin" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Memuat detail proforma...';
        if (warningsEl) warningsEl.innerHTML = '';
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i data-lucide="check-circle"></i> Konfirmasi Jadikan Invoice';
        }

        // Default Tanggal Order invoice = hari konversi (getTodayWITA)
        const todayWITA = getTodayWITA();
        if (orderDateInput) {
            orderDateInput.value = todayWITA;
            orderDateInput.max = getMaxOrderDateWITA();
        }

        // Pastikan ALL_PAYMENT_TYPES tersedia
        if (!Array.isArray(ALL_PAYMENT_TYPES) || ALL_PAYMENT_TYPES.length === 0) {
            try {
                const ptRes = await fetch('/api/master/payment-types', { headers: getAuthHeaders() });
                if (ptRes.ok) {
                    ALL_PAYMENT_TYPES = await ptRes.json();
                    window.paymentTypes = ALL_PAYMENT_TYPES;
                }
            } catch (_) {}
        }

        if (paymentSelect && Array.isArray(ALL_PAYMENT_TYPES) && ALL_PAYMENT_TYPES.length > 0) {
            paymentSelect.innerHTML = ALL_PAYMENT_TYPES.map(pt => `<option value="${pt.id}">${pt.name}</option>`).join('');
        }

        openModal('modal-convert-proforma');
        if (typeof lucide !== 'undefined') lucide.createIcons();

        const res = await fetch(`/api/proformas/${pk}/print-data`, { headers: getAuthHeaders() });
        if (!res.ok) {
            let errMsg = `Error ${res.status}`;
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (_) {}
            throw new Error(errMsg);
        }
        const data = await res.json();
        activeConvertProforma = data;

        const pf = data.proforma;
        const cust = data.customer || { name: 'Pelanggan Umum' };

        if (modalInfo) {
            modalInfo.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span style="font-weight:700; font-size:1rem; color:var(--gray-900);">${pf.proforma_no}</span>
                    <span style="font-weight:700; color:var(--blue-600);">${rp(pf.total)}</span>
                </div>
                <div style="font-size:0.8rem; color:var(--gray-600); line-height:1.4;">
                    <div>Pelanggan: <b>${cust.name}</b></div>
                    <div>Tgl Proforma: ${formatDate(pf.order_date)} | Berlaku: ${formatDate(pf.berlaku_hingga)}</div>
                    <div>Item: ${data.items.length} produk</div>
                </div>
            `;
        }

        // Set matching payment type in select
        if (paymentSelect && pf.payment_type_name && Array.isArray(ALL_PAYMENT_TYPES)) {
            const matchPt = ALL_PAYMENT_TYPES.find(p => p.name.toLowerCase() === pf.payment_type_name.toLowerCase());
            if (matchPt) paymentSelect.value = matchPt.id;
        }

        // Check warnings:
        let warningsHtml = '';

        // 1. Peringatan Kedaluwarsa (Soft-lock)
        if (pf.display_status === 'kedaluwarsa') {
            warningsHtml += `
                <div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:0.6rem 0.75rem; border-radius:6px; font-size:0.78rem; margin-bottom:0.5rem; line-height:1.4;">
                    <div style="display:flex; align-items:center; gap:4px; font-weight:700;">
                        <i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> Proforma Telah Kedaluwarsa
                    </div>
                    <div>Masa berlaku habis pada <b>${formatDate(pf.berlaku_hingga)}</b>. Anda tetap dapat melanjutkan konversi ke invoice jika disetujui.</div>
                </div>
            `;
        }

        // 2. Cek harga master vs snapshot (Warning harga)
        if (Array.isArray(PRODUCTS) && PRODUCTS.length > 0) {
            const priceDiffs = [];
            data.items.forEach(it => {
                const master = PRODUCTS.find(p => p.name.toLowerCase() === (it.product_name || '').toLowerCase() || p.id === it.product_id);
                if (master && Math.abs(parseFloat(master.price || master.sell_price || 0) - parseFloat(it.price || 0)) > 0.001) {
                    priceDiffs.push({
                        name: it.product_name,
                        snapshot: it.price,
                        current: master.price || master.sell_price
                    });
                }
            });

            if (priceDiffs.length > 0) {
                const diffList = priceDiffs.map(d => `<li>${d.name}: snapshot <b>${rp(d.snapshot)}</b> (master saat ini: ${rp(d.current)})</li>`).join('');
                warningsHtml += `
                    <div style="background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:0.6rem 0.75rem; border-radius:6px; font-size:0.78rem; margin-bottom:0.5rem; line-height:1.4;">
                        <div style="display:flex; align-items:center; gap:4px; font-weight:700;">
                            <i data-lucide="info" style="width:14px;height:14px;"></i> Perbedaan Harga Master Terdeteksi
                        </div>
                        <ul style="margin:4px 0 0 1rem; padding:0;">${diffList}</ul>
                        <div style="margin-top:4px; font-style:italic;">Konversi akan tetap menggunakan <b>HARGA SNAPSHOT</b> proforma.</div>
                    </div>
                `;
            }
        }

        if (warningsEl) warningsEl.innerHTML = warningsHtml;
        if (confirmBtn) confirmBtn.disabled = false;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('[openConvertProformaModal] Error:', err);
        const modalInfo = document.getElementById('convert-proforma-info');
        if (modalInfo) modalInfo.innerHTML = `<span style="color:var(--rose-500);">Gagal memuat proforma: ${err.message}</span>`;
        openModal('modal-convert-proforma');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}
window.openConvertProformaModal = openConvertProformaModal;
window.enterProformaEditMode = enterProformaEditMode;
window.exitProformaEditMode = exitProformaEditMode;
window.saveProformaEdit = saveProformaEdit;

async function submitConvertProforma() {
    const pk = document.getElementById('convert-proforma-pk').value;
    const orderDate = document.getElementById('convert-order-date').value;
    const paymentType = document.getElementById('convert-payment-type').value;
    const confirmBtn = document.getElementById('btn-confirm-convert');

    if (!orderDate) {
        showToast('Pilih Tanggal Order invoice terlebih dahulu.', 'warning');
        return;
    }

    const todayWITA = getTodayWITA();
    const maxOrderDate = getMaxOrderDateWITA();
    if (orderDate > maxOrderDate) {
        showToast(`Tanggal Order maksimal 7 hari ke depan (sampai ${formatMaxDateDisplay(maxOrderDate)}).`, 'warning');
        return;
    }

    const origText = confirmBtn ? confirmBtn.innerHTML : '';
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width:14px;height:14px;"></i> Memproses...';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    try {
        const res = await fetch(`/api/proformas/${pk}/convert`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                order_date: orderDate,
                payment_type_id: paymentType,
                force_expired: true
            })
        });

        let result = {};
        try {
            result = await res.json();
        } catch (_) {}

        if (res.ok) {
            closeModal('modal-convert-proforma');
            showToast(`Sukses! Proforma berhasil dijadikan Invoice: ${result.invoiceId}`, 'success');

            // Refresh data safely without leaking exceptions to outer catch
            try {
                const targetPage = (paginationState.proformas && paginationState.proformas.page) || currentProformaPage || 1;
                await fetchProformas(targetPage);
                if (typeof fetchInvoices === 'function') await fetchInvoices();
                if (typeof fetchProducts === 'function') await fetchProducts();
                if (typeof fetchCashTransactions === 'function') await fetchCashTransactions();
                if (typeof renderDashboard === 'function') await renderDashboard();
            } catch (refreshErr) {
                console.warn('[submitConvertProforma] Warning refreshing UI data:', refreshErr);
            }

            // Dialog konfirmasi cetak invoice baru
            setTimeout(() => {
                if (confirm(`Invoice ${result.invoiceId} berhasil dibuat!\n\nApakah Anda ingin membuka cetak invoice sekarang?`)) {
                    window.open(`invoice-print.html?id=${encodeURIComponent(result.invoiceId)}`, '_blank');
                }
            }, 300);
        } else {
            console.error('[submitConvertProforma] Server error:', res.status, result);
            // Tampilkan error stok atau alasan lain
            if (result.stock_errors && Array.isArray(result.stock_errors)) {
                const stockDetails = result.stock_errors.map(s => `• ${s.product_name}: Butuh ${s.needed}, Tersedia ${s.available}`).join('\n');
                alert(`Gagal konversi karena stok tidak mencukupi:\n\n${stockDetails}`);
            } else {
                showToast('Gagal konversi proforma: ' + (result.error || `Error ${res.status}`), 'error');
            }
        }
    } catch (err) {
        console.error('[submitConvertProforma] Error:', err);
        showToast('Gagal menghubungi server: ' + (err.message || 'Koneksi terputus'), 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = origText || '<i data-lucide="check-circle"></i> Konfirmasi Jadikan Invoice';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}
window.submitConvertProforma = submitConvertProforma;

// ─── Modal Perpanjang Masa Berlaku Proforma ───────────────────────────────────
function openExtendProformaModal(pk, proformaNo, currentBerlaku) {
    document.getElementById('extend-proforma-pk').value = pk;
    const desc = document.getElementById('extend-proforma-desc');
    if (desc) {
        desc.innerHTML = `Perpanjang masa berlaku untuk <b>${proformaNo}</b>.<br>Masa berlaku saat ini: <b>${formatDate(currentBerlaku)}</b>`;
    }
    const input = document.getElementById('extend-berlaku-date');
    if (input) {
        input.value = currentBerlaku ? currentBerlaku.split('T')[0] : getTodayWITA();
        input.min = getTodayWITA();
    }
    openModal('modal-extend-proforma');
}

async function submitExtendProforma() {
    const pk = document.getElementById('extend-proforma-pk').value;
    const berlakuHingga = document.getElementById('extend-berlaku-date').value;

    if (!berlakuHingga) {
        showToast('Pilih tanggal berlaku hingga yang baru.', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/proformas/${pk}/extend`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ berlaku_hingga: berlakuHingga })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-extend-proforma');
            showToast('Masa berlaku proforma berhasil diperpanjang.', 'success');
            try {
                const targetPage = (paginationState.proformas && paginationState.proformas.page) || currentProformaPage || 1;
                await fetchProformas(targetPage);
            } catch (refreshErr) {
                console.warn('[submitExtendProforma] Warning refreshing UI data:', refreshErr);
            }
        } else {
            showToast(data.error || 'Gagal memperpanjang masa berlaku.', 'error');
        }
    } catch (err) {
        console.error('[submitExtendProforma] Error:', err);
        showToast('Gagal menghubungi server: ' + (err.message || 'Koneksi terputus'), 'error');
    }
}

// ─── Modal Batalkan Proforma ──────────────────────────────────────────────────
function openCancelProformaModal(pk, proformaNo) {
    document.getElementById('cancel-proforma-pk').value = pk;
    const desc = document.getElementById('cancel-proforma-desc');
    if (desc) {
        desc.innerHTML = `Apakah Anda yakin ingin membatalkan proforma <b>${proformaNo}</b>?<br><small style="color:var(--gray-500);">Data proforma akan tetap tersimpan dengan status 'dibatalkan'.</small>`;
    }
    const reasonEl = document.getElementById('cancel-proforma-reason');
    if (reasonEl) reasonEl.value = '';
    openModal('modal-cancel-proforma');
}

async function submitCancelProforma() {
    const pk = document.getElementById('cancel-proforma-pk').value;
    const alasan = document.getElementById('cancel-proforma-reason')?.value.trim();

    try {
        const res = await fetch(`/api/proformas/${pk}/cancel`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ alasan })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-cancel-proforma');
            showToast('Proforma berhasil dibatalkan.', 'success');
            try {
                const targetPage = (paginationState.proformas && paginationState.proformas.page) || currentProformaPage || 1;
                await fetchProformas(targetPage);
            } catch (refreshErr) {
                console.warn('[submitCancelProforma] Warning refreshing UI data:', refreshErr);
            }
        } else {
            showToast(data.error || 'Gagal membatalkan proforma.', 'error');
        }
    } catch (err) {
        console.error('[submitCancelProforma] Error:', err);
        showToast('Gagal menghubungi server: ' + (err.message || 'Koneksi terputus'), 'error');
    }
}
window.openExtendProformaModal = openExtendProformaModal;
window.submitExtendProforma = submitExtendProforma;
window.openCancelProformaModal = openCancelProformaModal;
window.submitCancelProforma = submitCancelProforma;
window.viewInvoiceFromProforma = viewInvoiceFromProforma;

// Populate customer select in POS
function populateCustomerSelect(filter = '') {
    const dropdown = document.getElementById('pos-customer-dropdown');
    if (!dropdown) return;

    if (!Array.isArray(CUSTOMERS) || CUSTOMERS.length === 0) {
        if (typeof fetchCustomers === 'function') fetchCustomers();
    }

    let filtered = Array.isArray(CUSTOMERS) ? [...CUSTOMERS] : [];
    if (filter && typeof filter === 'string') {
        const q = filter.trim().toLowerCase();
        if (q) {
            filtered = filtered.filter(c => {
                const name = (c.name || '').toLowerCase();
                const type = (c.type || '').toLowerCase();
                const phone = (c.phone || '').toLowerCase();
                const id = (c.id || '').toLowerCase();
                return name.includes(q) || type.includes(q) || phone.includes(q) || id.includes(q);
            });
        }
    }

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 0.75rem; color: var(--gray-400); text-align: center; font-size: 0.875rem;">Pelanggan tidak ditemukan</div>';
        return;
    }

    dropdown.innerHTML = filtered.map(c => `
        <div class="customer-dropdown-item" data-id="${c.id}" data-name="${(c.name || '').replace(/"/g, '&quot;')}" style="padding: 0.55rem 0.85rem; cursor: pointer; border-bottom: 1px solid var(--gray-100); display: flex; flex-direction: column; transition: background-color 0.15s;">
            <span style="font-weight: 600; font-size: 0.875rem; color: var(--gray-900);">${c.name || 'Pelanggan'}</span>
            <span style="font-size: 0.72rem; color: var(--gray-500); margin-top: 2px;">${c.type ? c.type + ' &middot; ' : ''}${c.phone || '-'}</span>
        </div>
    `).join('');

    // Add click listeners to items
    dropdown.querySelectorAll('.customer-dropdown-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            const customer = (CUSTOMERS || []).find(c => String(c.id) === String(id));
            const name = e.currentTarget.dataset.name || (customer ? customer.name : '');
            const currentCustomerId = document.getElementById('pos-customer-id').value;

            // Jika pelanggan sudah dipilih dan berbeda, dan keranjang tidak kosong: minta konfirmasi
            if (currentCustomerId && currentCustomerId !== id && cart.length > 0) {
                if (!confirm('Mengganti pelanggan akan mengosongkan keranjang karena Special Price mungkin berbeda. Lanjutkan?')) {
                    dropdown.style.display = 'none';
                    return;
                }
                // Kosongkan keranjang
                cart = [];
                renderCart();
            }

            const searchInput = document.getElementById('pos-customer-search');
            if (searchInput) searchInput.value = name;
            document.getElementById('pos-customer-id').value = id;
            dropdown.style.display = 'none';

            // Tampilkan tombol clear (X)
            const clearBtn = document.getElementById('pos-customer-clear');
            if (clearBtn) clearBtn.style.display = 'inline-block';

            // Set default payment type pelanggan di kasir / order (desktop & mobile)
            applyCustomerPaymentTypeDefault(customer || id);

            // Ambil effective prices pelanggan & update badge
            await handlePOSCustomerChange(id);

            // Update product grid (unlock produk)
            const activeCat = document.querySelector('.pos-category-tab.active')?.dataset.cat || 'all';
            renderPOSProducts(document.getElementById('pos-search')?.value || '', activeCat);
        });

        // Add hover effect
        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = 'var(--gray-50)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = 'transparent';
        });
    });
}

// POS Customer Search bindings
function initPOSCustomerSearch() {
    const searchInput = document.getElementById('pos-customer-search');
    const dropdown = document.getElementById('pos-customer-dropdown');
    const toggle = document.getElementById('pos-customer-dropdown-toggle');
    const clearBtn = document.getElementById('pos-customer-clear');

    if (searchInput && dropdown) {
        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.style.display !== 'block') {
                populateCustomerSelect('');
                dropdown.style.display = 'block';
                searchInput.select();
            }
        });

        searchInput.addEventListener('focus', () => {
            populateCustomerSelect('');
            dropdown.style.display = 'block';
            searchInput.select();
        });

        searchInput.addEventListener('input', (e) => {
            populateCustomerSelect(e.target.value);
            dropdown.style.display = 'block';
            const curId = document.getElementById('pos-customer-id').value;
            const curCust = (CUSTOMERS || []).find(c => String(c.id) === String(curId));
            if (!curCust || curCust.name !== e.target.value) {
                document.getElementById('pos-customer-id').value = '';
            }
            if (clearBtn) clearBtn.style.display = e.target.value ? 'inline-block' : 'none';
        });

        toggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            } else {
                populateCustomerSelect('');
                dropdown.style.display = 'block';
                searchInput.focus();
            }
        });

        clearBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (cart.length > 0) {
                if (!confirm('Menghapus pelanggan akan mengosongkan keranjang. Lanjutkan?')) return;
                cart = [];
                renderCart();
            }
            searchInput.value = '';
            document.getElementById('pos-customer-id').value = '';
            clearBtn.style.display = 'none';
            dropdown.style.display = 'none';
            handlePOSCustomerChange('');
            applyCustomerPaymentTypeDefault(null);
            const activeCat = document.querySelector('.pos-category-tab.active')?.dataset.cat || 'all';
            renderPOSProducts(document.getElementById('pos-search')?.value || '', activeCat);
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.customer-search-wrapper')) {
                dropdown.style.display = 'none';
            }
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initPOSCustomerSearch();
        initPoProductSearch();
        initAddPurchaseVendorCombobox();
    });
} else {
    setTimeout(() => {
        initPOSCustomerSearch();
        initPoProductSearch();
        initAddPurchaseVendorCombobox();
    }, 0);
}

// ---------- Tab Filter Bindings ----------
document.querySelectorAll('.tab-filters').forEach(filterGroup => {
    filterGroup.querySelectorAll('.tab-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            filterGroup.querySelectorAll('.tab-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.dataset.filter;

            // Determine which page this filter belongs to and re-render
            const section = filterGroup.closest('.page-section');
            if (!section) return;
            const pageId = section.id.replace('page-', '');

            switch (pageId) {
                case 'invoices': renderInvoices(filter); break;
                case 'piutang': renderPiutang(filter); break;
                case 'hutang': renderHutang(filter); break;
                case 'cashflow': currentCashFlowFilter = filter; paginationState.cashflow.page = 1; fetchCashTransactions(1); break;
                case 'purchases': renderPurchases(filter); break;
            }
        });
    });
});

// ---------- Utility ----------
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Returns today's date string in YYYY-MM-DD format using WITA (UTC+8) timezone.
 * Avoids the off-by-one shift that occurs when using new Date().toISOString() on a UTC server.
 */
function getTodayWITA() {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
    } catch (e) {
        const now = new Date();
        const wita = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        return wita.toISOString().split('T')[0];
    }
}

/**
 * Returns the maximum allowed order date (today + 7 days) in YYYY-MM-DD format (WITA).
 * Masalah 2: user boleh memilih tanggal maju maksimal 7 hari ke depan.
 */
function getMaxOrderDateWITA() {
    try {
        const now = new Date();
        // Ambil komponen tanggal hari ini di WITA
        const wita = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(now);
        // Tambahkan 7 hari sebagai string YYYY-MM-DD (aman dari DST)
        const d = new Date(wita + 'T00:00:00');
        d.setDate(d.getDate() + 7);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch (e) {
        // Fallback: gunakan UTC+8 manual
        const now = new Date();
        const wita = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        wita.setDate(wita.getDate() + 7);
        return wita.toISOString().split('T')[0];
    }
}

/**
 * Format tanggal maksimum +7 hari ke format DD/MM/YYYY untuk pesan toast.
 */
function formatMaxDateDisplay(maxDateStr) {
    if (!maxDateStr) return '';
    const parts = maxDateStr.split('-');
    if (parts.length !== 3) return maxDateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function calculateDueDate(paymentTypeName, transactionDateStr) {
    if (!paymentTypeName) return '';
    const nameLower = paymentTypeName.toLowerCase();
    // Match both: 'Kredit X Hari' (Indonesian) and 'Credit X Hari' (English)
    const isCredit = nameLower.includes('kredit') || nameLower.includes('credit');
    if (!isCredit) return '';
    const match = paymentTypeName.match(/(kredit|credit)\s+(\d+)\s+hari/i);
    if (match && match[2]) {
        const days = parseInt(match[2], 10);
        if (!transactionDateStr) return '';
        const parts = transactionDateStr.split('T')[0].split('-');
        if (parts.length === 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const d = parseInt(parts[2], 10);
            const dt = new Date(y, m, d + days);
            const ry = dt.getFullYear();
            const rm = String(dt.getMonth() + 1).padStart(2, '0');
            const rd = String(dt.getDate()).padStart(2, '0');
            return `${ry}-${rm}-${rd}`;
        }
    }
    return '';
}

function getPaymentTypeName(selectElement) {
    if (!selectElement) return '';
    if (selectElement.options.length === 0) return '';
    return selectElement.options[selectElement.selectedIndex].text;
}

function onPurchasePaymentTypeChange(mode) {
    const typeSelect = document.getElementById(`${mode}-purchase-payment-type`);
    const dateInput = document.getElementById(`${mode}-purchase-date`);
    const dueDateGroup = document.getElementById(`${mode}-purchase-duedate-group`);
    const dueDateInput = document.getElementById(`${mode}-purchase-due-date`);

    if (!typeSelect || !dueDateGroup) return;

    const typeName = getPaymentTypeName(typeSelect);
    const typeNameLower = typeName.toLowerCase();
    if (typeNameLower.includes('kredit') || typeNameLower.includes('credit')) {
        dueDateGroup.style.display = 'block';
        if (dateInput && dateInput.value) {
            dueDateInput.value = calculateDueDate(typeName, dateInput.value);
        }
    } else {
        dueDateGroup.style.display = 'none';
        dueDateInput.value = '';
    }
}

// ---------- Initialize Everything ----------
async function init() {
    // Update dashboard subtitle & sidebar user info with logged-in user details
    const userDisplayName = localStorage.getItem('name') || localStorage.getItem('username') || 'User';
    const userRole = localStorage.getItem('role') || 'Staff';
    const capitalizedRole = userRole.charAt(0).toUpperCase() + userRole.slice(1).toLowerCase();

    PAGE_TITLES.dashboard.subtitle = `Selamat Datang, ${userDisplayName} 👋`;
    const subtitleEl = document.getElementById('topbar-subtitle');
    if (subtitleEl && currentPage === 'dashboard') {
        subtitleEl.textContent = PAGE_TITLES.dashboard.subtitle;
    }

    const sidebarAvatarEl = document.querySelector('.sidebar-user-avatar');
    const sidebarNameEl = document.querySelector('.sidebar-user-name');
    const sidebarRoleEl = document.querySelector('.sidebar-user-role');

    if (sidebarNameEl) sidebarNameEl.textContent = userDisplayName;
    if (sidebarRoleEl) sidebarRoleEl.textContent = capitalizedRole;
    if (sidebarAvatarEl) {
        const parts = userDisplayName.trim().split(/\s+/);
        const initials = parts.length === 1
            ? parts[0].charAt(0).toUpperCase()
            : (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
        sidebarAvatarEl.textContent = initials;
    }

    // Apply RBAC UI restrictions
    applyRoleRestrictions();

    // Direct URL navigation support (hash or search param ?page=...)
    const loggedRole = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const allowedPages = ROLE_PERMISSIONS[loggedRole] || ROLE_PERMISSIONS.kasir;
    const urlParams = new URLSearchParams(window.location.search);
    const hashPage = (window.location.hash || '').replace('#', '').trim();
    const directPage = urlParams.get('page') || hashPage;
    if (directPage) {
        if (allowedPages.includes(directPage)) {
            navigateTo(directPage);
        } else {
            const defaultPage = allowedPages[0] || 'dashboard';
            navigateTo(defaultPage);
            if (window.location.hash) {
                try {
                    history.replaceState(null, '', window.location.pathname + (window.location.search ? window.location.search : ''));
                } catch (_) {}
            }
        }
    }

    // Logout handler
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            localStorage.removeItem('role');
            localStorage.removeItem('name');
            sessionStorage.clear();
            window.location.href = 'login.html';
        });
    }

    // Settings shortcut handler
    const settingsShortcutBtn = document.getElementById('settings-shortcut-btn');
    if (settingsShortcutBtn) {
        settingsShortcutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('settings');
        });
    }

    // Render empty placeholders while loading
    renderDashboard();
    renderProducts();
    renderCustomers();
    renderVendors();

    // Populate dropdowns and fetch role-permitted data from DB (A7: eliminate 403 storm)
    await populateMasterDropdowns();
    await loadInvoicePreferences();

    const fetchPromises = [fetchDashboardSummary()];

    if (loggedRole === 'admin') {
        fetchPromises.push(
            fetchProducts(),
            fetchCustomers(),
            fetchPricelists(),
            fetchVendors(),
            fetchPurchases(),
            fetchInvoices(),
            fetchCashTransactions(),
            fetchUsers(),
            loadPrefixSettings(),
            loadLandingDemoSetting()
        );
    } else if (loggedRole === 'finance') {
        fetchPromises.push(
            fetchInvoices(),
            fetchPurchases(),
            fetchCashTransactions(),
            fetchVendors(),
            fetchCustomers()
        );
    } else if (loggedRole === 'kasir') {
        fetchPromises.push(
            fetchProducts(),
            fetchCustomers(),
            fetchInvoices(),
            fetchPricelists()
        );
    } else if (loggedRole === 'gudang') {
        fetchPromises.push(
            fetchProducts(),
            fetchPurchases(),
            fetchVendors()
        );
    } else {
        fetchPromises.push(fetchProducts());
    }

    await Promise.allSettled(fetchPromises);

    // Re-render dashboard with real DB data
    renderDashboard();
    if (['admin', 'kasir', 'finance'].includes(loggedRole)) {
        renderInvoices();
        renderPiutang();
    }
    if (['admin', 'gudang'].includes(loggedRole)) {
        renderHutang();
    }

    // Dynamically populate year filters to ensure current year is always available
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    ['filter-tahun', 'balance-filter-tahun', 'reports-filter-tahun'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.innerHTML = '';
            for (let y = currentYear + 1; y >= currentYear - 5; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                select.appendChild(opt);
            }
        }
    });

    // Set default bulan/tahun ke SAAT INI untuk semua filter laporan
    ['filter-bulan', 'balance-filter-bulan', 'reports-filter-bulan'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = currentMonth;
    });
    ['filter-tahun', 'balance-filter-tahun', 'reports-filter-tahun'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = currentYear;
    });

    renderCashFlow();
    renderProfitLoss();

    renderBalance();
    renderReports();
    renderPOSProducts();
    populateCustomerSelect();
    setupChartListeners();

    const btnAddPoItem = document.getElementById('btn-add-purchase-item');
    if (btnAddPoItem) btnAddPoItem.addEventListener('click', () => { if (window.addAddPurchaseItem) window.addAddPurchaseItem(); });

    // Recalculate PO due date when date inputs change
    document.getElementById('add-purchase-date')?.addEventListener('change', () => onPurchasePaymentTypeChange('add'));
    document.getElementById('edit-purchase-date')?.addEventListener('change', () => onPurchasePaymentTypeChange('edit'));

    // Edit item button is dynamically added with onclick in HTML, so we don't need to bind it here unless missing

    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();
}


// ---------- API Integrations ----------
const getAuthHeaders = () => ({
    'Authorization': 'Bearer ' + localStorage.getItem('token'),
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
});

async function ensureProductsLoadedForPOS() {
    if (PRODUCTS.length > 0) return;
    try {
        const res = await fetch('/api/products?all=true&status=active', { headers: getAuthHeaders() });
        const data = await res.json();
        const mapProduct = p => ({
            id: p.id,
            sku: p.sku,
            brand: p.brand || '',
            name: p.name,
            category: p.category,
            category_id: p.category_id,
            cost: parseFloat(p.cost_price),
            price: parseFloat(p.sell_price),
            stock: parseFloat(p.stock),
            minStock: parseFloat(p.min_stock),
            unit: p.unit || 'pcs',
            unit_id: p.unit_id,
            is_active: p.is_active !== 0 && p.is_active !== false,
            emoji: ''
        });
        PRODUCTS = (Array.isArray(data) ? data : []).map(mapProduct);
    } catch (e) {
        console.error('Failed to load products for POS', e);
    }
}

function escapeJsString(str) {
    if (!str) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function onProductStatusFilterChange() {
    paginationState.products.page = 1;
    fetchProducts(1);
}

let pendingDeactivateProductId = null;
let pendingDeleteProductId = null;

function confirmToggleProductStatus(id, newStatus, stock, name) {
    if (newStatus === 0 && stock > 0) {
        pendingDeactivateProductId = id;
        document.getElementById('deactivate-product-id').value = id;
        const msgEl = document.getElementById('deactivate-product-message');
        const warnEl = document.getElementById('deactivate-product-stock-warning');
        const warnText = document.getElementById('deactivate-product-warning-text');
        if (warnEl) warnEl.style.display = 'block';
        if (warnText) {
            warnText.innerHTML = `Produk ini masih memiliki stok sebanyak <strong>${stock}</strong>. Menonaktifkannya akan menyembunyikan produk dari POS, PO, dan transaksi baru.`;
        }
        if (msgEl) {
            msgEl.innerHTML = `Apakah Anda yakin ingin menonaktifkan produk <strong>"${name}"</strong>?`;
        }
        if (window.lucide) lucide.createIcons();
        openModal('modal-confirm-deactivate-product');
    } else {
        toggleProductStatus(id, newStatus);
    }
}

async function executeDeactivateProduct() {
    const id = pendingDeactivateProductId || document.getElementById('deactivate-product-id')?.value;
    if (!id) return;
    pendingDeactivateProductId = null;
    closeModal('modal-confirm-deactivate-product');
    await toggleProductStatus(id, 0);
}

async function toggleProductStatus(id, is_active) {
    try {
        const res = await fetch(`/api/products/${id}/status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ is_active })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || (is_active ? 'Produk berhasil diaktifkan!' : 'Produk berhasil dinonaktifkan!'), 'success');
            notifyDataChange('product_status');
            await fetchProducts(paginationState.products.page);
            // Refresh POS cache
            PRODUCTS = [];
            if (typeof renderPOSProducts === 'function' && currentPage === 'pos') {
                ensureProductsLoadedForPOS().then(() => renderPOSProducts());
            }
        } else {
            showToast(data.error || 'Gagal mengubah status produk', 'error');
        }
    } catch (err) {
        console.error('Failed to toggle product status', err);
        showToast('Gagal menghubungi server', 'error');
    }
}

function confirmDeleteProduct(id, name, hasPricelists) {
    pendingDeleteProductId = id;
    document.getElementById('delete-product-id').value = id;
    const msgEl = document.getElementById('delete-product-message');
    const plWarnEl = document.getElementById('delete-product-pricelist-warning');
    if (msgEl) {
        msgEl.innerHTML = `Apakah Anda yakin ingin menghapus produk <strong>"${name}"</strong>? Tindakan ini tidak dapat dibatalkan.`;
    }
    if (plWarnEl) {
        plWarnEl.style.display = hasPricelists ? 'block' : 'none';
    }
    if (window.lucide) lucide.createIcons();
    openModal('modal-confirm-delete-product');
}

async function executeDeleteProduct() {
    const id = pendingDeleteProductId || document.getElementById('delete-product-id')?.value;
    if (!id) return;
    pendingDeleteProductId = null;
    closeModal('modal-confirm-delete-product');

    try {
        const res = await fetch(`/api/products/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Produk berhasil dihapus!', 'success');
            notifyDataChange('product_delete');
            await fetchProducts(paginationState.products.page);
            PRODUCTS = [];
            if (typeof renderPOSProducts === 'function' && currentPage === 'pos') {
                ensureProductsLoadedForPOS().then(() => renderPOSProducts());
            }
        } else {
            showToast(data.error || 'Gagal menghapus produk', 'error');
        }
    } catch (err) {
        console.error('Failed to delete product', err);
        showToast('Gagal menghubungi server', 'error');
    }
}

async function fetchProducts(page) {
    try {
        // Paginated fetch untuk tabel produk (A3: Hapus blocking sequential fetch all products)
        if (page !== undefined) paginationState.products.page = page;
        const q = document.getElementById('product-search')?.value || '';
        const category = document.getElementById('product-category-filter')?.value || '';
        const statusFilter = document.getElementById('product-status-filter')?.value || 'active';
        const sort = document.getElementById('product-sort')?.value || 'name_asc';
        const pg = paginationState.products.page;
        let url = '/api/products?page=' + pg + '&limit=' + PAGE_SIZE + '&status=' + encodeURIComponent(statusFilter);
        if (q) url += '&q=' + encodeURIComponent(q);
        if (category && category !== 'all') url += '&category=' + encodeURIComponent(category);
        if (sort) url += '&sort=' + encodeURIComponent(sort);

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();

        const rows = json.data || [];
        const pag = json.pagination || {};
        paginationState.products.total = pag.total || 0;
        paginationState.products.totalPages = pag.totalPages || 1;

        const mapProduct = p => ({
            id: p.id,
            sku: p.sku,
            brand: p.brand || '',
            name: p.name,
            category: p.category,
            category_id: p.category_id,
            cost: (p.cost_price != null && !isNaN(p.cost_price)) ? parseFloat(p.cost_price) : 0,
            price: parseFloat(p.sell_price),
            stock: parseFloat(p.stock),
            minStock: parseFloat(p.min_stock),
            unit: p.unit || 'pcs',
            unit_id: p.unit_id,
            is_active: p.is_active !== 0 && p.is_active !== false,
            has_transactions: !!p.has_transactions,
            has_pricelists: !!p.has_pricelists,
            emoji: ''
        });

        // Simpan baris halaman ini untuk akses instan di modal (A3: Modal Opname Instan)
        CURRENT_PAGE_PRODUCTS.clear();

        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canSeeHpp = role === 'admin' || role === 'owner' || role === 'gudang';

        const tbody = document.getElementById('products-body');
        if (!tbody) return;
        tbody.innerHTML = rows.map(p => {
            const pr = mapProduct(p);
            CURRENT_PAGE_PRODUCTS.set(String(pr.id), pr);

            const isActive = pr.is_active;
            const stockStatus = pr.stock <= pr.minStock ? 'rendah' : 'aman';
            const stockLabel = pr.stock <= pr.minStock ? 'Rendah' : 'Aman';
            const statusBadge = isActive
                ? `<span class="badge-status ${stockStatus}">${stockLabel}</span>`
                : `<span class="badge-status nonaktif">Nonaktif</span>`;

            // A2.2: Tombol toggle status
            const toggleStatusBtn = isActive
                ? `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--amber-600);" title="Nonaktifkan Produk" onclick="confirmToggleProductStatus('${pr.id}', 0, ${pr.stock}, '${escapeJsString(pr.name)}')">
                    <i data-lucide="eye-off" style="width: 14px; height: 14px; margin: 0;"></i>
                   </button>`
                : `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--emerald-600);" title="Aktifkan Produk" onclick="toggleProductStatus('${pr.id}', 1)">
                    <i data-lucide="eye" style="width: 14px; height: 14px; margin: 0;"></i>
                   </button>`;

            // A2.1: Proteksi Delete Produk
            let deleteBtn = '';
            if (pr.has_transactions) {
                deleteBtn = `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--gray-400); cursor: not-allowed; opacity: 0.5;" title="Produk sudah memiliki riwayat transaksi, gunakan Nonaktifkan" disabled>
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>`;
            } else {
                deleteBtn = `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Hapus Produk" onclick="confirmDeleteProduct('${pr.id}', '${escapeJsString(pr.name)}', ${pr.has_pricelists ? 1 : 0})">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>`;
            }

            return `
            <tr style="${isActive ? '' : 'opacity: 0.75; background: var(--gray-50);'}">
                <td><code style="background:var(--gray-100); padding:2px 6px; border-radius:4px; font-size:0.78rem;">${pr.sku}</code></td>
                <td style="font-weight:600;">${pr.name}</td>
                <td>${pr.category || '-'}</td>
                <td class="td-product-hpp" style="${canSeeHpp ? '' : 'display:none;'}">${canSeeHpp ? rp(pr.cost) : ''}</td>
                <td style="font-weight:700;">${rp(pr.price)}</td>
                <td style="font-weight:700;">${pr.stock}</td>
                <td>${pr.unit}</td>
                <td>${pr.minStock}</td>
                <td>${statusBadge}</td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Produk" onclick="openEditProductModal('${pr.id}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--blue-600);" title="Stock Opname" onclick="openStockOpnameModal('${pr.id}')">
                        <i data-lucide="boxes" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    ${toggleStatusBtn}
                    ${deleteBtn}
                </td>
            </tr>
            `;
        }).join('');

        renderPagination({
            containerId: 'pagination-products',
            currentPage: pg,
            totalItems: paginationState.products.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchProducts(p)
        });

        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch products', err);
    }
}

async function saveProduct(isEdit) {
    const id = isEdit ? document.getElementById('edit-product-id').value : null;
    const prefix = isEdit ? 'edit' : 'add';

    const categoryEl = document.getElementById(`${prefix}-product-category`);
    // category_id is the value from the select (populated with name or id depending on master)
    const categoryValue = categoryEl ? categoryEl.value : '';

    const payload = {
        brand: document.getElementById(`${prefix}-product-brand`)?.value.trim() || null,
        name: document.getElementById(`${prefix}-product-name`).value,
        sku: document.getElementById(`${prefix}-product-sku`).value,
        category_id: categoryValue,   // FIX: backend expects category_id not category
        cost_price: parseFloat(document.getElementById(`${prefix}-product-cost`).value) || 0,
        sell_price: parseFloat(document.getElementById(`${prefix}-product-price`).value) || 0,
        stock: isEdit ? parseFloat(document.getElementById('edit-product-stock').value) || 0 : parseFloat(document.getElementById('add-product-stock').value) || 0,
        min_stock: parseFloat(document.getElementById(`${prefix}-product-minstock`).value) || 0,
        unit_id: isEdit ? document.getElementById('edit-product-unit').value : document.getElementById('add-product-unit').value
    };

    if (!payload.name || !payload.sku) {
        showToast('Nama produk dan SKU wajib diisi!', 'warning');
        return;
    }

    const url = isEdit ? `/api/products/${id}` : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal(`modal-${isEdit ? 'edit' : 'add'}-product`);
            showToast(isEdit ? 'Produk berhasil diperbarui!' : 'Produk berhasil ditambahkan!', 'success');
            notifyDataChange('product');
            await fetchProducts();
            if (typeof renderPOSProducts === 'function') renderPOSProducts();
        } else {
            const err = await res.json();
            showToast('Error: ' + (err.error || 'Gagal menyimpan produk'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
}

async function openEditProductModal(id) {
    let p = CURRENT_PAGE_PRODUCTS.get(String(id));
    if (!p) {
        try {
            const res = await fetch(`/api/products/${id}`, { headers: getAuthHeaders() });
            if (res.ok) {
                const row = await res.json();
                p = {
                    id: row.id,
                    sku: row.sku,
                    brand: row.brand || '',
                    name: row.name,
                    category: row.category,
                    category_id: row.category_id,
                    cost: parseFloat(row.cost_price),
                    price: parseFloat(row.sell_price),
                    stock: parseFloat(row.stock),
                    minStock: parseFloat(row.min_stock),
                    unit: row.unit || 'pcs',
                    unit_id: row.unit_id
                };
            }
        } catch (err) {
            console.error('Failed to fetch product for edit', err);
        }
    }
    if (!p) {
        showToast('Data produk tidak ditemukan!', 'error');
        return;
    }
    document.getElementById('edit-product-id').value = p.id;
    const brandEl = document.getElementById('edit-product-brand');
    if (brandEl) brandEl.value = p.brand || '';
    document.getElementById('edit-product-name').value = p.name;
    document.getElementById('edit-product-sku').value = p.sku;
    const catEl = document.getElementById('edit-product-category');
    if (catEl) {
        catEl.value = p.category || '';
        if (!catEl.value && p.category_id) catEl.value = p.category_id;
    }
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canSeeHpp = role === 'admin' || role === 'owner' || role === 'gudang';
    document.getElementById('edit-product-cost').value = (p.cost != null && !isNaN(p.cost) && canSeeHpp) ? formatNumberTrim(p.cost) : '';
    document.getElementById('edit-product-price').value = formatNumberTrim(p.price);
    document.getElementById('edit-product-stock').value = formatNumberTrim(p.stock);
    document.getElementById('edit-product-minstock').value = formatNumberTrim(p.minStock);
    const unitEl = document.getElementById('edit-product-unit');
    if (unitEl) unitEl.value = p.unit_id || p.unit || '';
    openModal('modal-edit-product');
}

// ==========================================================================
// STOCK OPNAME (A3: Instant Opening)
// ==========================================================================
let stockOpnameProductId = null;

async function openStockOpnameModal(id) {
    let p = CURRENT_PAGE_PRODUCTS.get(String(id));
    if (!p) {
        try {
            const res = await fetch(`/api/products/${id}`, { headers: getAuthHeaders() });
            if (res.ok) {
                const row = await res.json();
                p = {
                    id: row.id,
                    name: row.name,
                    stock: parseFloat(row.stock || 0)
                };
            }
        } catch (err) {
            console.error('Failed to fetch product for opname', err);
        }
    }
    if (!p) {
        showToast('Data produk tidak ditemukan!', 'error');
        return;
    }

    stockOpnameProductId = p.id;
    const nameEl = document.getElementById('stock-opname-name') || document.querySelector('#modal-stock-opname .form-group:nth-child(1) input');
    const stockEl = document.getElementById('stock-opname-stock') || document.querySelector('#modal-stock-opname .form-row .form-group:first-child input');
    const actualEl = document.getElementById('stock-opname-actual') || document.querySelector('#modal-stock-opname .form-row .form-group:last-child input');
    const noteEl = document.getElementById('stock-opname-note') || document.querySelector('#modal-stock-opname textarea');

    if (nameEl) nameEl.value = p.name;
    if (stockEl) stockEl.value = formatNumberTrim(p.stock !== undefined ? p.stock : 0);
    if (actualEl) {
        actualEl.value = '';
        setTimeout(() => actualEl.focus(), 150);
    }
    if (noteEl) noteEl.value = '';

    openModal('modal-stock-opname');
}

async function submitStockOpname() {
    if (!stockOpnameProductId) return;
    const actualEl = document.getElementById('stock-opname-actual') || document.querySelector('#modal-stock-opname .form-row .form-group:last-child input');
    const noteEl = document.getElementById('stock-opname-note') || document.querySelector('#modal-stock-opname textarea');
    const actual = parseFloat(actualEl ? actualEl.value : '');
    if (isNaN(actual) || actual < 0) {
        showToast('Masukkan jumlah stok fisik yang valid!', 'warning');
        return;
    }
    const note = noteEl ? noteEl.value : '';
    try {
        const res = await fetch('/api/stock-adjust', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ product_id: stockOpnameProductId, actual_stock: actual, note })
        });
        if (res.ok) {
            closeModal('modal-stock-opname');
            showToast('Stok berhasil disesuaikan!', 'success');
            notifyDataChange('stock_opname');
            stockOpnameProductId = null;
            await fetchProducts(paginationState.products.page);
            PRODUCTS = [];
            if (typeof renderPOSProducts === 'function' && currentPage === 'pos') {
                ensureProductsLoadedForPOS().then(() => renderPOSProducts());
            }
        } else {
            const err = await res.json();
            showToast('Gagal: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
}

function deleteProduct(id) {
    const p = CURRENT_PAGE_PRODUCTS.get(String(id));
    if (p) {
        if (p.has_transactions) {
            showToast('Produk sudah memiliki riwayat transaksi, gunakan fitur Nonaktifkan.', 'warning');
            return;
        }
        confirmDeleteProduct(id, p.name, p.has_pricelists ? 1 : 0);
    } else {
        confirmDeleteProduct(id, 'Produk #' + id, 0);
    }
}

async function fetchCustomers(page) {
    try {
        const mapCustomer = c => ({
            ...c,
            id: c.id,
            name: c.name,
            type: c.category_name || c.customer_category_id || c.type || '',
            categoryId: c.customer_category_id || '',
            phone: c.phone || '-',
            city: c.city || '-',
            address: c.address || '',
            creditLimit: parseFloat(c.credit_lmt) || 0,
            totalBelanja: parseFloat(c.total_belanja) || 0,
            totalPiutangBerjalan: parseFloat(c.total_piutang_berjalan) || 0,
            sisaLimitPiutang: parseFloat(c.sisa_limit_piutang) || parseFloat(c.credit_lmt) || 0,
            // legacy aliases for backward compat
            totalSpent: parseFloat(c.total_belanja) || 0,
            outstandingReceivables: parseFloat(c.total_piutang_berjalan) || 0,
            remainingLimit: parseFloat(c.sisa_limit_piutang) ?? parseFloat(c.credit_lmt) ?? 0,
            pricelistId: c.pricelist_id || null,
            pricelistName: c.pricelist_nama || c.pricelist_name || '',
            pricelistKode: c.pricelist_kode || '',
            tipePembayaranId: c.tipe_pembayaran_id || c.payment_type_id || null,
            tipePembayaranName: c.tipe_pembayaran_name || c.payment_type_name || '',
            tipe_pembayaran_id: c.tipe_pembayaran_id || c.payment_type_id || null,
            payment_type_id: c.tipe_pembayaran_id || c.payment_type_id || null,
            tipe_pembayaran_name: c.tipe_pembayaran_name || c.payment_type_name || '',
            payment_type_name: c.tipe_pembayaran_name || c.payment_type_name || '',
            color: 'blue'
        });

        // Fetch all for POS dropdown / POS search (unpaginated)
        const resAll = await fetch('/api/customers?all=true', { headers: getAuthHeaders() });
        const dataAll = await resAll.json();
        CUSTOMERS = (Array.isArray(dataAll) ? dataAll : []).map(mapCustomer);
        // Update POS dropdown
        if (typeof populateCustomerSelect === 'function') {
            populateCustomerSelect(document.getElementById('pos-customer-search')?.value || '');
        }

        // Paginated fetch for table
        if (page !== undefined) paginationState.customers.page = page;
        const q = document.getElementById('customer-search')?.value || '';
        const type = document.getElementById('customer-type-filter')?.value || '';
        const sort = document.getElementById('customer-sort')?.value || 'name_asc';
        const pg = paginationState.customers.page;
        let url = '/api/customers?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (type && type !== 'all') url += '&category=' + encodeURIComponent(type);
        if (sort) url += '&sort=' + encodeURIComponent(sort);

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();
        const rows = (json.data || []).map(mapCustomer);
        const pag = json.pagination || {};
        paginationState.customers.total = pag.total || 0;
        paginationState.customers.totalPages = pag.totalPages || 1;

        // Helper
        function limitColor(sisa, limit) {
            if (limit <= 0) return 'var(--slate-400)';
            const pct = sisa / limit;
            if (pct > 0.5) return 'var(--emerald-600)';
            if (pct > 0.1) return 'var(--amber-500)';
            return 'var(--rose-500)';
        }

        // Render cards
        const grid = document.getElementById('customers-grid');
        if (grid) {
            grid.innerHTML = rows.map(c => {
                const color = limitColor(c.sisaLimitPiutang ?? c.remainingLimit, c.creditLimit);
                const pctUsed = c.creditLimit > 0 ? Math.min(100, Math.round((c.totalPiutangBerjalan ?? c.outstandingReceivables) / c.creditLimit * 100)) : 0;
                return `
                <div class="entity-card" style="position: relative;">
                    <button class="btn-toolbar secondary" style="position: absolute; top: 1rem; right: 1rem; padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Edit Pelanggan" onclick="openEditCustomerModal('${c.id}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <button class="btn-toolbar secondary" style="position: absolute; top: 1rem; right: 3rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Hapus Pelanggan" onclick="deleteCustomer('${c.id}')">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <div class="entity-card-header" style="cursor:pointer;" onclick="openCustomerDetail('${c.id}')">
                        <div class="entity-avatar ${c.color}">${c.name.charAt(0)}</div>
                        <div>
                            <div class="entity-name">${c.name}</div>
                            <div class="entity-type">${c.type} &bull; ${c.city}</div>
                            ${c.pricelistName ? `<div style="margin-top:0.25rem;"><span class="badge-pricelist-source" style="font-size:0.7rem; padding:0.15rem 0.4rem;">${c.pricelistName}</span></div>` : ''}
                            ${(c.tipePembayaranName || c.tipe_pembayaran_name) ? `<div style="margin-top:0.2rem;"><span class="badge-status" style="font-size:0.68rem; padding:0.1rem 0.35rem; background:var(--slate-100); color:var(--slate-700);">${c.tipePembayaranName || c.tipe_pembayaran_name}</span></div>` : ''}
                        </div>
                    </div>
                    <div class="entity-details">
                        <div class="entity-detail">
                            <span class="entity-detail-label">Telepon / WA</span>
                            <span class="entity-detail-value">${c.phone}</span>
                        </div>
                        <div class="entity-detail">
                            <span class="entity-detail-label">Sisa Limit Piutang</span>
                            <span class="entity-detail-value" style="color:${color}; font-weight:700;">${rpShort(c.sisaLimitPiutang ?? c.remainingLimit)}</span>
                        </div>
                        <div class="entity-detail">
                            <span class="entity-detail-label">Total Belanja</span>
                            <span class="entity-detail-value">${rpShort(c.totalBelanja ?? c.totalSpent)}</span>
                        </div>
                    </div>
                    <div style="margin-top:0.6rem;">
                        <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--slate-500);margin-bottom:3px;">
                            <span>Limit terpakai ${pctUsed}%</span>
                            <span>${rpShort(c.creditLimit)}</span>
                        </div>
                        <div style="background:var(--slate-200);border-radius:99px;height:5px;overflow:hidden;">
                            <div style="height:100%;width:${pctUsed}%;background:${color};border-radius:99px;transition:width .4s;"></div>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }

        // Render list
        const listBody = document.getElementById('customers-list-body');
        if (listBody) {
            listBody.innerHTML = rows.map(c => {
                const sisa = c.sisaLimitPiutang ?? c.remainingLimit;
                const color = sisa / (c.creditLimit || 1) > 0.5
                    ? 'var(--emerald-600)'
                    : sisa / (c.creditLimit || 1) > 0.1
                        ? 'var(--amber-500)'
                        : 'var(--rose-500)';
                return `
                <tr style="cursor:pointer;" onclick="openCustomerDetail('${c.id}')">
                    <td style="font-weight:600; color: var(--blue-600);">${c.id}</td>
                    <td style="font-weight:600;">
                        ${c.name}
                        ${c.pricelistName ? `<div style="margin-top:0.2rem;"><span class="badge-pricelist-source" style="font-size:0.65rem; padding:0.1rem 0.35rem;">${c.pricelistName}</span></div>` : ''}
                    </td>
                    <td><span class="badge-status aman">${c.type}</span></td>
                    <td>
                        ${(c.tipePembayaranName || c.tipe_pembayaran_name)
                            ? `<span class="badge-status" style="background:var(--slate-100);color:var(--slate-700);font-size:0.75rem;">${c.tipePembayaranName || c.tipe_pembayaran_name}</span>`
                            : `<span style="color:var(--slate-400);font-size:0.75rem;font-style:italic;">Belum diatur (Kredit 30 Hari)</span>`}
                    </td>
                    <td>${c.city}</td>
                    <td>${c.phone}</td>
                    <td style="font-weight:700;">${rp(c.creditLimit)}</td>
                    <td style="font-weight:700; color:${color}">${rp(sisa)}</td>
                    <td style="font-weight:600;">${rp(c.totalBelanja ?? c.totalSpent)}</td>
                    <td style="text-align: right; white-space: nowrap;" onclick="event.stopPropagation()">
                        <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Edit Pelanggan" onclick="openEditCustomerModal('${c.id}')">
                            <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                        </button>
                        <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Hapus Pelanggan" onclick="deleteCustomer('${c.id}')">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                        </button>
                    </td>
                </tr>
                `;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-customers',
            currentPage: pg,
            totalItems: paginationState.customers.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchCustomers(p)
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch customers', err);
    }
}

async function saveCustomer(isEdit) {
    const id = isEdit ? document.getElementById('edit-customer-id').value : null;
    const prefix = isEdit ? 'edit' : 'add';

    // Ambil nilai semua field
    const name = document.getElementById(`${prefix}-customer-name`).value.trim();
    const ktp = document.getElementById(`${prefix}-customer-ktp`)?.value.trim() || '';
    const email = document.getElementById(`${prefix}-customer-email`)?.value.trim() || '';

    // Validasi frontend
    if (!name) {
        showToast('Nama pelanggan wajib diisi!', 'warning');
        return;
    }
    if (ktp && !/^\d{16}$/.test(ktp)) {
        showToast('Nomor KTP harus 16 digit angka!', 'warning');
        return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('Format email tidak valid!', 'warning');
        return;
    }

    const payload = {
        name,
        customer_category_id: document.getElementById(`${prefix}-customer-type`).value,
        city: document.getElementById(`${prefix}-customer-city`).value,
        address: document.getElementById(`${prefix}-customer-address`)?.value || '',
        phone: document.getElementById(`${prefix}-customer-phone`).value,
        credit_lmt: document.getElementById(`${prefix}-customer-limit`).value,
        ktp: ktp || null,
        npwp: document.getElementById(`${prefix}-customer-npwp`)?.value.trim() || null,
        npwp_name: document.getElementById(`${prefix}-customer-npwp-name`)?.value.trim() || null,
        npwp_address: document.getElementById(`${prefix}-customer-npwp-address`)?.value.trim() || null,
        nib: document.getElementById(`${prefix}-customer-nib`)?.value.trim() || null,
        email: email || null,
        no_hp_2: document.getElementById(`${prefix}-customer-no-hp-2`)?.value.trim() || null,
        pricelist_id: document.getElementById(`${prefix}-customer-pricelist`)?.value ? parseInt(document.getElementById(`${prefix}-customer-pricelist`).value) : null,
        tipe_pembayaran_id: document.getElementById(`${prefix}-customer-payment-type`)?.value || null
    };

    const url = isEdit ? `/api/customers/${id}` : '/api/customers';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal(`modal-${isEdit ? 'edit' : 'add'}-customer`);
            showToast(isEdit ? 'Pelanggan berhasil diperbarui!' : 'Pelanggan berhasil ditambahkan!', 'success');
            await fetchCustomers();
        } else {
            const err = await res.json();
            showToast('Error: ' + (err.error || 'Gagal menyimpan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menyimpan pelanggan', 'error');
    }
}

function openAddCustomerModal() {
    const fields = ['name', 'city', 'phone', 'limit', 'no-hp-2', 'email', 'ktp', 'npwp', 'npwp-name', 'npwp-address', 'nib'];
    fields.forEach(f => {
        const el = document.getElementById(`add-customer-${f}`);
        if (el) el.value = '';
    });
    const addrEl = document.getElementById('add-customer-address');
    if (addrEl) addrEl.value = '';
    const typeEl = document.getElementById('add-customer-type');
    if (typeEl) typeEl.selectedIndex = 0;
    populateCustomerPricelistDropdown('add-customer-pricelist', '');
    populateCustomerPaymentTypeDropdown('add-customer-payment-type', '');
    openModal('modal-add-customer');
}

function openEditCustomerModal(id) {
    const c = CUSTOMERS.find(x => x.id === id);
    if (!c) return;
    document.getElementById('edit-customer-id').value = c.id;
    document.getElementById('edit-customer-id-display').value = c.id;
    document.getElementById('edit-customer-name').value = c.name;
    document.getElementById('edit-customer-type').value = c.categoryId;
    document.getElementById('edit-customer-city').value = c.city || '';
    const addrEl = document.getElementById('edit-customer-address');
    if (addrEl) addrEl.value = c.address || '';
    document.getElementById('edit-customer-phone').value = c.phone || '';
    document.getElementById('edit-customer-limit').value = c.creditLimit;
    // Field baru
    const noHp2El = document.getElementById('edit-customer-no-hp-2');
    if (noHp2El) noHp2El.value = c.no_hp_2 || '';
    const emailEl = document.getElementById('edit-customer-email');
    if (emailEl) emailEl.value = c.email || '';
    const ktpEl = document.getElementById('edit-customer-ktp');
    if (ktpEl) ktpEl.value = c.ktp || '';
    const npwpEl = document.getElementById('edit-customer-npwp');
    if (npwpEl) npwpEl.value = c.npwp || '';
    const npwpNameEl = document.getElementById('edit-customer-npwp-name');
    if (npwpNameEl) npwpNameEl.value = c.npwp_name || '';
    const npwpAddressEl = document.getElementById('edit-customer-npwp-address');
    if (npwpAddressEl) npwpAddressEl.value = c.npwp_address || '';
    const nibEl = document.getElementById('edit-customer-nib');
    if (nibEl) nibEl.value = c.nib || '';
    populateCustomerPricelistDropdown('edit-customer-pricelist', c.pricelistId);
    populateCustomerPaymentTypeDropdown('edit-customer-payment-type', c.tipePembayaranId || c.tipe_pembayaran_id || c.payment_type_id || '');

    // Pastikan seluruh field form pelanggan aktif untuk diedit
    const _ecFieldIds = [
        'edit-customer-name', 'edit-customer-type', 'edit-customer-city',
        'edit-customer-address', 'edit-customer-phone', 'edit-customer-limit',
        'edit-customer-no-hp-2', 'edit-customer-email', 'edit-customer-ktp',
        'edit-customer-npwp', 'edit-customer-npwp-name', 'edit-customer-npwp-address', 'edit-customer-nib',
        'edit-customer-payment-type'
    ];
    _ecFieldIds.forEach(fid => {
        const el = document.getElementById(fid);
        if (el) el.disabled = false;
    });

    openModal('modal-edit-customer');
}

function openCustomerDetail(id) {
    const c = CUSTOMERS.find(x => x.id === id);
    if (!c) return;

    const avatarEl = document.getElementById('detail-customer-avatar');
    if (avatarEl) {
        avatarEl.textContent = c.name.charAt(0);
        avatarEl.className = 'entity-avatar blue';
    }

    document.getElementById('detail-customer-name').textContent = c.name;

    const typeEl = document.getElementById('detail-customer-type');
    if (typeEl) {
        typeEl.textContent = c.type;
    }

    document.getElementById('detail-customer-id').textContent = c.id;
    document.getElementById('detail-customer-city').textContent = c.city || '-';
    document.getElementById('detail-customer-phone').textContent = c.phone || '-';
    document.getElementById('detail-customer-address').textContent = c.address || 'Tidak ada alamat lengkap';

    // Field baru
    const noHp2El = document.getElementById('detail-customer-no-hp-2');
    if (noHp2El) noHp2El.textContent = c.no_hp_2 || '-';
    const emailEl = document.getElementById('detail-customer-email');
    if (emailEl) emailEl.textContent = c.email || '-';
    const ktpEl = document.getElementById('detail-customer-ktp');
    if (ktpEl) ktpEl.textContent = c.ktp || '-';
    const npwpEl = document.getElementById('detail-customer-npwp');
    if (npwpEl) npwpEl.textContent = c.npwp || '-';
    const npwpNameEl = document.getElementById('detail-customer-npwp-name');
    if (npwpNameEl) npwpNameEl.textContent = c.npwp_name || '-';
    const npwpAddressEl = document.getElementById('detail-customer-npwp-address');
    if (npwpAddressEl) npwpAddressEl.textContent = c.npwp_address || '-';
    const nibEl = document.getElementById('detail-customer-nib');
    if (nibEl) nibEl.textContent = c.nib || '-';
    const plDetailEl = document.getElementById('detail-customer-pricelist');
    if (plDetailEl) {
        plDetailEl.textContent = c.pricelistName ? `${c.pricelistName} (${c.pricelistKode || '-'})` : 'Harga Standar (Master)';
    }
    const ptDetailEl = document.getElementById('detail-customer-payment-type');
    if (ptDetailEl) {
        ptDetailEl.textContent = c.tipePembayaranName || c.tipe_pembayaran_name || '— Belum diatur (default Kredit 30 Hari) —';
    }

    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canSeePiutang = role !== 'kasir';
    const piutangRow = document.getElementById('detail-customer-piutang-row');
    if (piutangRow) piutangRow.style.display = canSeePiutang ? 'flex' : 'none';
    const limitContainer = document.getElementById('detail-customer-limit-container');
    if (limitContainer) limitContainer.style.display = canSeePiutang ? 'block' : 'none';

    const sisa = c.sisaLimitPiutang ?? c.remainingLimit;
    const totalSpent = c.totalBelanja ?? c.totalSpent;
    const piutang = c.totalPiutangBerjalan ?? c.outstandingReceivables;
    const limit = c.creditLimit;

    document.getElementById('detail-customer-total-belanja').textContent = rp(totalSpent);
    document.getElementById('detail-customer-piutang-berjalan').textContent = rp(piutang);

    const sisaEl = document.getElementById('detail-customer-sisa-limit');
    let pctUsed = limit > 0 ? Math.min(100, Math.round(piutang / limit * 100)) : 0;

    let color = 'var(--rose-500)';
    if (limit > 0) {
        const pctRemaining = sisa / limit;
        if (pctRemaining > 0.5) {
            color = 'var(--emerald-600)';
        } else if (pctRemaining > 0.1) {
            color = 'var(--amber-500)';
        }
    } else {
        color = 'var(--slate-400)';
    }

    if (sisaEl) {
        sisaEl.textContent = rp(sisa);
        sisaEl.style.color = color;
    }

    document.getElementById('detail-customer-limit-used-pct').textContent = `Limit terpakai ${pctUsed}%`;
    document.getElementById('detail-customer-limit-total').textContent = rp(limit);

    const progressBar = document.getElementById('detail-customer-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${pctUsed}%`;
        progressBar.style.background = color;
    }

    const editBtn = document.getElementById('detail-customer-edit-btn');
    if (editBtn) {
        editBtn.onclick = () => {
            closeModal('modal-customer-detail');
            openEditCustomerModal(id);
        };
    }

    openModal('modal-customer-detail');
    if (window.lucide) lucide.createIcons();
}

async function deleteCustomer(id) {
    if (!confirm('Yakin ingin menghapus pelanggan ini?')) return;
    try {
        const res = await fetch(`/api/customers/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            showToast('Pelanggan berhasil dihapus!', 'success');
            await fetchCustomers();
        } else {
            showToast('Gagal menghapus pelanggan', 'error');
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================================================
// VENDORS — CRUD
// ==========================================================================

async function fetchVendors(page) {
    try {
        const mapVendor = v => ({
            id: v.id,
            name: v.name,
            category: v.category_name || v.vendor_category_id || '',
            categoryId: v.vendor_category_id || '',
            phone: v.phone || '-',
            city: v.city || '-',
            address: v.address || '',
            bank: v.nama_bank || v.bank_account || '',
            rekening: v.nomor_rek || '',
            pemilik: v.pemilik_rek || '',
            idNumber: String(v.id_number || ''),
            totalPurchases: parseFloat(v.total_purchases) || 0,
            debt: parseFloat(v.outstanding_debt) || parseFloat(v.debt) || 0
        });

        // Fetch all for dropdowns
        const resAll = await fetch('/api/vendors?all=true', { headers: getAuthHeaders() });
        const dataAll = await resAll.json();
        VENDORS = (Array.isArray(dataAll) ? dataAll : []).map(mapVendor);

        // Populate vendor dropdowns in PO modals
        const vendorOptions = '<option value="" disabled selected>- Pilih Vendor -</option>' +
            VENDORS.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
        if (window.addPurchaseVendorCombobox) {
            window.addPurchaseVendorCombobox.setData(
                VENDORS.map(v => ({ id: v.id, label: v.name, code: v.idNumber || '' }))
            );
        }
        const editVendorEl = document.getElementById('edit-purchase-vendor');
        if (editVendorEl) editVendorEl.innerHTML = vendorOptions;

        // Paginated fetch for table
        if (page !== undefined) paginationState.vendors.page = page;
        const q = document.getElementById('vendor-search')?.value || '';
        const sort = document.getElementById('vendor-sort')?.value || 'name_asc';
        const pg = paginationState.vendors.page;
        let url = '/api/vendors?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (sort) url += '&sort=' + encodeURIComponent(sort);

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();
        const rows = (json.data || []).map(mapVendor);
        const pag = json.pagination || {};
        paginationState.vendors.total = pag.total || 0;
        paginationState.vendors.totalPages = pag.totalPages || 1;

        const grid = document.getElementById('vendors-grid');
        const listBody = document.getElementById('vendors-list-body');

        if (grid) {
            grid.innerHTML = rows.map(v => `
            <div class="entity-card" style="position: relative;">
                <button class="btn-toolbar secondary" style="position: absolute; top: 1rem; right: 1rem; padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Edit Vendor" onclick="openEditVendorModal('${v.id}')">
                    <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>
                <div class="entity-card-header">
                    <div class="entity-avatar blue">${v.name.charAt(0)}</div>
                    <div>
                        <div class="entity-name">${v.name}</div>
                        <div class="entity-type">${v.category} &middot; ${v.city}</div>
                    </div>
                </div>
                <div class="entity-details">
                    <div class="entity-detail">
                        <span class="entity-detail-label">ID Vendor</span>
                        <span class="entity-detail-value">${v.id || 'V0XX'}</span>
                    </div>
                    <div class="entity-detail">
                        <span class="entity-detail-label">Telepon / WA</span>
                        <span class="entity-detail-value">${v.phone}</span>
                    </div>
                    <div class="entity-detail">
                        <span class="entity-detail-label">Total Pembelian</span>
                        <span class="entity-detail-value">${rpShort(v.totalPurchases)}</span>
                    </div>
                </div>
            </div>`).join('');
        }

        if (listBody) {
            listBody.innerHTML = rows.map(v => `
            <tr>
                <td style="font-weight:600;">${v.id || '-'}</td>
                <td style="font-weight:600;">${v.name}</td>
                <td>${v.category}</td>
                <td>${v.city}</td>
                <td>${v.phone}</td>
                <td style="font-weight:700;">${rp(v.totalPurchases)}</td>
                <td style="text-align:right; white-space:nowrap;">
                    <button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" title="Edit Vendor" onclick="openEditVendorModal('${v.id}')">
                        <i data-lucide="edit-2" style="width:14px;height:14px;margin:0;"></i>
                    </button>
                </td>
            </tr>`).join('');
        }

        renderPagination({
            containerId: 'pagination-vendors',
            currentPage: pg,
            totalItems: paginationState.vendors.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchVendors(p)
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch vendors', err);
    }
}

async function saveVendor(isEdit) {
    const id = isEdit ? document.getElementById('edit-vendor-id').value : null;
    const prefix = isEdit ? 'edit' : 'add';

    const payload = {
        name: document.getElementById(`${prefix}-vendor-name`)?.value || '',
        vendor_category_id: document.getElementById(`${prefix}-vendor-category`)?.value || '',
        phone: document.getElementById(`${prefix}-vendor-phone`)?.value || '',
        city: document.getElementById(`${prefix}-vendor-city`)?.value || '',
        address: document.getElementById(`${prefix}-vendor-address`)?.value || '',
        nama_bank: document.getElementById(`${prefix}-vendor-bank`)?.value || '',
        nomor_rek: document.getElementById(`${prefix}-vendor-rekening`)?.value || '',
        pemilik_rek: document.getElementById(`${prefix}-vendor-pemilik`)?.value || '',
        // id_number field: NPWP/KTP
        id_number: String(document.getElementById(`${prefix}-vendor-idnumber`)?.value || '').trim()
    };

    const url = isEdit ? `/api/vendors/${id}` : '/api/vendors';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal(`modal-${isEdit ? 'edit' : 'add'}-vendor`);
            showToast(isEdit ? 'Vendor berhasil diperbarui!' : 'Vendor berhasil ditambahkan!', 'success');
            await fetchVendors();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast('Error: ' + (err.error || 'Gagal menyimpan vendor'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menyimpan vendor', 'error');
    }
}

function openAddVendorModal() {
    const fields = ['name', 'category', 'phone', 'city', 'address', 'bank', 'rekening', 'pemilik', 'idnumber'];
    fields.forEach(f => {
        const el = document.getElementById(`add-vendor-${f}`);
        if (el) el.value = '';
    });
    openModal('modal-add-vendor');
}

function openEditVendorModal(id) {
    const v = VENDORS.find(x => x.id === id);
    if (!v) return;
    document.getElementById('edit-vendor-id').value = v.id;
    document.getElementById('edit-vendor-id-display').value = v.id;
    document.getElementById('edit-vendor-name').value = v.name;
    document.getElementById('edit-vendor-category').value = v.categoryId || '';
    document.getElementById('edit-vendor-phone').value = v.phone || '';
    document.getElementById('edit-vendor-city').value = v.city || '';
    document.getElementById('edit-vendor-address').value = v.address || '';
    if (document.getElementById('edit-vendor-bank')) document.getElementById('edit-vendor-bank').value = v.bank || '';
    if (document.getElementById('edit-vendor-rekening')) document.getElementById('edit-vendor-rekening').value = v.rekening || '';
    if (document.getElementById('edit-vendor-pemilik')) document.getElementById('edit-vendor-pemilik').value = v.pemilik || '';
    if (document.getElementById('edit-vendor-idnumber')) document.getElementById('edit-vendor-idnumber').value = String(v.idNumber || '');
    openModal('modal-edit-vendor');
}

async function deleteVendor(id) {
    if (!confirm('Yakin ingin menghapus vendor ini?')) return;
    try {
        const res = await fetch(`/api/vendors/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            showToast('Vendor berhasil dihapus!', 'success');
            await fetchVendors();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast('Gagal menghapus vendor: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghapus vendor', 'error');
    }
}

// ==========================================================================
// PURCHASE ORDERS — CRUD
// ==========================================================================

async function fetchPurchases(page) {
    try {
        // Full data for Hutang computation (unpaginated)
        const resAll = await fetch('/api/purchases?all=true', { headers: getAuthHeaders() });
        const dataAll = await resAll.json();
        if (!resAll.ok || (dataAll && dataAll.error)) {
            showToast('Gagal memuat data purchase, coba lagi.', 'error');
            return;
        }
        PURCHASES = Array.isArray(dataAll) ? dataAll : [];

        // Paginated for table
        if (page !== undefined) paginationState.purchases.page = page;
        const q = document.getElementById('purchase-search')?.value || '';
        const status = document.getElementById('purchase-status-filter')?.value || 'all';
        const pg = paginationState.purchases.page;
        let url = '/api/purchases?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (status && status !== 'all') url += '&status=' + encodeURIComponent(status);

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};
        paginationState.purchases.total = pag.total || 0;
        paginationState.purchases.totalPages = pag.totalPages || 1;

        const tbody = document.getElementById('purchases-body');
        if (tbody) {
            tbody.innerHTML = rows.map(p => {
                const retAmount = parseFloat(p.return_amount || p.returnAmount || 0);
                const retBadge = retAmount > 0 ? `<span class="badge-retur-indicator" title="Total Retur: ${rp(retAmount)}">Ada Retur</span>` : '';
                return `
            <tr>
                <td style="font-weight:600; color: var(--blue-600);">${p.id}${retBadge ? ' ' + retBadge : ''}</td>
                <td>${p.date}</td>
                <td>${p.vendor}</td>
                <td style="font-weight:700;">${rp(p.total)}</td>
                <td>${rp(p.paid)}</td>
                <td>${p.type}</td>
                <td><span class="badge-status ${p.status.toLowerCase()}">${capitalize(p.status)}</span></td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Cetak PO" onclick="openModal('modal-print-po')">
                        <i data-lucide="printer" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit PO" onclick="openEditPurchaseModal('${p.id}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    ${p.status.toLowerCase() !== 'batal' ? `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--amber-600);" title="Retur Pembelian" onclick="openPurchaseReturnModal('${p.id}')">
                        <i data-lucide="rotate-ccw" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>` : ''}
                    ${p.status.toLowerCase() !== 'batal' ? `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Batalkan PO" onclick="cancelPurchase('${p.id}')">
                        <i data-lucide="x-circle" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>` : ''}
                </td>
            </tr>`;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-purchases',
            currentPage: pg,
            totalItems: paginationState.purchases.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchPurchases(p)
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch purchases', err);
        showToast('Gagal memuat data purchase, coba lagi.', 'error');
    }
}

let addPurchaseItems = [];
let poSearchDebounceTimer = null;
let poSearchActiveIndex = 0;
let poCurrentMatches = [];

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function highlightMatch(text, query) {
    if (!query || !text) return escapeHtml(text || '');
    const lowerText = text.toLowerCase();
    const lowerQ = query.toLowerCase();
    let result = '';
    let startIndex = 0;
    let index = lowerText.indexOf(lowerQ, startIndex);
    
    while (index !== -1) {
        result += escapeHtml(text.substring(startIndex, index));
        result += `<mark class="po-search-highlight">${escapeHtml(text.substring(index, index + query.length))}</mark>`;
        startIndex = index + query.length;
        index = lowerText.indexOf(lowerQ, startIndex);
    }
    result += escapeHtml(text.substring(startIndex));
    return result;
}

function renderAddPurchaseItems(highlightProductId = null) {
    const container = document.getElementById('add-purchase-items-container');
    if (!container) return;

    container.innerHTML = '';
    let subtotal = 0;

    addPurchaseItems.forEach((item, index) => {
        const product = (Array.isArray(PRODUCTS) ? PRODUCTS.find(p => String(p.id) === String(item.product_id)) : null) || { name: item.product_name || item.product_id, unit: item.unit || 'pcs' };
        const itemTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0);
        subtotal += itemTotal;

        const isHighlighted = highlightProductId && String(item.product_id) === String(highlightProductId);
        const tr = document.createElement('tr');
        if (isHighlighted) {
            tr.className = 'po-row-highlight';
            setTimeout(() => tr.classList.remove('po-row-highlight'), 1500);
        }
        tr.dataset.productId = item.product_id;

        tr.innerHTML = `
            <td style="padding: 0.5rem 0.75rem;">
                <div style="font-weight: 500; color: var(--gray-900);">${escapeHtml(product.name)}</div>
            </td>
            <td style="padding: 0.5rem; text-align: center; white-space: nowrap;">
                <input type="number" min="1" value="${formatNumberTrim(item.quantity)}" oninput="updateAddPurchaseItemQty(${index}, this.value)" onchange="updateAddPurchaseItemQty(${index}, this.value)" step="any" min="0.001" style="width: 80px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: center;">
                <span style="font-size: 0.8rem; color: var(--gray-500); margin-left: 0.25rem;">${escapeHtml(product.unit || 'pcs')}</span>
            </td>
            <td style="padding: 0.5rem; text-align: right;">
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.25rem;">
                    <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                    <input type="number" value="${formatNumberTrim(item.price)}" oninput="updateAddPurchaseItemPrice(${index}, this.value)" onchange="updateAddPurchaseItemPrice(${index}, this.value)" step="any" style="width: 90px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: right;">
                </div>
            </td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: var(--gray-900);">
                ${rp(itemTotal)}
            </td>
            <td style="padding: 0.5rem; text-align: center;">
                <button type="button" onclick="removeAddPurchaseItem(${index})" title="Hapus item" style="color: var(--rose-500); background: none; border: none; cursor: pointer; padding: 0.25rem; display: inline-flex; align-items: center; justify-content: center;">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </td>
        `;
        container.appendChild(tr);
    });

    if (addPurchaseItems.length === 0) {
        container.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 1.25rem 1rem; color: var(--gray-400); font-size: 0.875rem;">Belum ada item.</td></tr>`;
    }

    const subtotalEl = document.getElementById('add-purchase-subtotal-display');
    const totalEl = document.getElementById('add-purchase-total-display');
    if (subtotalEl) subtotalEl.textContent = rp(subtotal);
    if (totalEl) totalEl.textContent = rp(subtotal);

    if (typeof lucide !== 'undefined') lucide.createIcons();
    positionPoDropdown();
}

function addProductToPo(prod) {
    if (!prod) return;
    const existing = addPurchaseItems.find(i => String(i.product_id) === String(prod.id));
    if (existing) {
        existing.quantity = (parseInt(existing.quantity) || 0) + 1;
    } else {
        addPurchaseItems.push({
            product_id: prod.id,
            product_name: prod.name,
            unit: prod.unit || 'pcs',
            quantity: 1,
            price: prod.cost || prod.price || 0
        });
    }
    renderAddPurchaseItems(prod.id);

    const searchInput = document.getElementById('add-purchase-product-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    closePoDropdown();
}


// ==========================================================================
// SHARED PRODUCT AUTOCOMPLETE COMPONENT (Reused in PO and Edit Invoice)
// ==========================================================================
class ProductAutocomplete {
    constructor(config) {
        this.inputId = config.inputId;
        this.dropdownId = config.dropdownId;
        this.wrapperId = config.wrapperId || null;
        this.modalSelector = config.modalSelector || null;
        this.getPrice = config.getPrice || function(p) { return parseFloat(p.price || 0); };
        this.onSelect = config.onSelect || function() {};
        this.matches = [];
        this.activeIndex = 0;
        this.debounceTimer = null;
    }

    getInput() { return document.getElementById(this.inputId); }
    getDropdown() { return document.getElementById(this.dropdownId); }

    close() {
        const dd = this.getDropdown();
        if (dd) {
            dd.style.display = 'none';
            dd.innerHTML = '';
        }
        this.matches = [];
        this.activeIndex = 0;
    }

    position() {
        const input = this.getInput();
        const dd = this.getDropdown();
        if (!input || !dd || dd.style.display === 'none') return;

        const inputRect = input.getBoundingClientRect();
        const ddH = dd.offsetHeight || 320;
        const spaceBelow = window.innerHeight - inputRect.bottom - 8;
        const spaceAbove = inputRect.top - 8;
        const GAP = 4;

        const openUpward = spaceBelow < ddH && spaceAbove > spaceBelow;
        const width = Math.min(Math.max(inputRect.width, 260), window.innerWidth - 32);
        let left = inputRect.left;
        if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
        if (left < 8) left = 8;

        dd.style.width = width + 'px';
        dd.style.left  = left + 'px';

        if (openUpward) {
            dd.style.bottom = (window.innerHeight - inputRect.top + GAP) + 'px';
            dd.style.top    = 'auto';
        } else {
            dd.style.top    = (inputRect.bottom + GAP) + 'px';
            dd.style.bottom = 'auto';
        }
    }

    async search(keyword) {
        const dd = this.getDropdown();
        if (!dd) return;

        const q = (keyword || '').trim().toLowerCase();
        if (!q) {
            this.close();
            return;
        }

        let matches = [];
        // Hanya produk aktif
        if (Array.isArray(PRODUCTS) && PRODUCTS.length > 0) {
            const productList = PRODUCTS.filter(p => (p.is_active !== 0 && p.is_active !== false));
            matches = productList.filter(p =>
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
                    matches = rows.map(p => ({
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
                console.error('Product search error:', e);
                matches = [];
            }
        }

        this.matches = matches;
        this.activeIndex = 0;

        if (matches.length === 0) {
            dd.innerHTML = '<div class="po-dropdown-empty">Produk tidak ditemukan</div>';
            dd.style.display = 'block';
            this.position();
            return;
        }

        const displayed = matches.slice(0, 8);
        const self = this;
        const itemsHtml = displayed.map((p, idx) => {
            const highlightedName = highlightMatch(p.name, q);
            const price = self.getPrice(p);
            const metaText = 'Stok ' + (p.stock != null ? p.stock : 0) + ' · ' + rp(price);
            const selectedClass = idx === self.activeIndex ? 'po-item-selected' : '';

            return '<div class="po-dropdown-item ' + selectedClass + '" data-index="' + idx + '" data-product-id="' + escapeHtml(p.id) + '">' +
                '<div class="po-item-name" style="font-size:0.85rem; font-weight:500; color:var(--gray-800); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
                    highlightedName +
                '</div>' +
                '<div class="po-item-meta" style="font-size:0.78rem; color:var(--gray-500); white-space:nowrap; margin-left:0.5rem;">' +
                    escapeHtml(metaText) +
                '</div>' +
            '</div>';
        }).join('');

        const countText = matches.length + ' hasil · ↑↓ pilih · Enter tambah';
        dd.innerHTML = '<div class="po-dropdown-list">' + itemsHtml + '</div>' +
                       '<div class="po-dropdown-footer">' + countText + '</div>';

        dd.querySelectorAll('.po-dropdown-item').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const prodId = el.dataset.productId;
                const prod = self.matches.find(p => String(p.id) === String(prodId));
                if (prod) {
                    self.onSelect(prod);
                    const inp = self.getInput();
                    if (inp) {
                        inp.value = '';
                        inp.focus();
                    }
                    self.close();
                }
            });
        });

        dd.style.display = 'block';
        this.position();
    }

    updateSelection() {
        const dd = this.getDropdown();
        if (!dd || dd.style.display === 'none') return;
        const items = dd.querySelectorAll('.po-dropdown-item');
        const self = this;
        items.forEach((item, idx) => {
            if (idx === self.activeIndex) {
                item.classList.add('po-item-selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('po-item-selected');
            }
        });
    }

    init() {
        const input = this.getInput();
        const dd = this.getDropdown();
        if (!input || !dd) return;
        if (input.dataset.autocompleteInit === 'true') return;
        input.dataset.autocompleteInit = 'true';

        const self = this;
        input.addEventListener('input', (e) => {
            clearTimeout(self.debounceTimer);
            const val = e.target.value;
            self.debounceTimer = setTimeout(() => {
                self.search(val);
            }, 150);
        });

        input.addEventListener('keydown', (e) => {
            if (dd.style.display !== 'block' || self.matches.length === 0) {
                if (e.key === 'Enter') e.preventDefault();
                return;
            }

            const displayedCount = Math.min(self.matches.length, 8);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                self.activeIndex = (self.activeIndex + 1) % displayedCount;
                self.updateSelection();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                self.activeIndex = (self.activeIndex - 1 + displayedCount) % displayedCount;
                self.updateSelection();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const selectedProd = self.matches[self.activeIndex];
                if (selectedProd) {
                    self.onSelect(selectedProd);
                    input.value = '';
                    self.close();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                self.close();
            }
        });

        if (this.modalSelector) {
            const modal = document.querySelector(this.modalSelector);
            if (modal) {
                modal.addEventListener('scroll', () => {
                    if (dd.style.display === 'block') self.position();
                });
            }
        }

        window.addEventListener('resize', () => {
            if (dd.style.display === 'block') self.position();
        });

        document.addEventListener('click', (e) => {
            const wrapper = self.wrapperId ? document.getElementById(self.wrapperId) : null;
            const container = wrapper || (input ? input.closest('.po-search-container') || input.parentElement : null);
            if (!container || !dd) return;
            if (!container.contains(e.target) && !dd.contains(e.target)) {
                self.close();
            }
        });
    }
}

// ── PO Modal Product Search Instance ──────────────────────────────────────────
var poProductAutocomplete = null;
function getPoProductAutocomplete() {
    if (!poProductAutocomplete) {
        poProductAutocomplete = new ProductAutocomplete({
            inputId: 'add-purchase-product-search',
            dropdownId: 'add-purchase-product-dropdown',
            modalSelector: '#modal-add-purchase .modal',
            getPrice: function(p) { return p.cost || p.price || 0; },
            onSelect: function(p) { addProductToPo(p); }
        });
    }
    return poProductAutocomplete;
}

// Backwards-compatible PO delegators (used by tests & existing callers)
function positionPoDropdown() {
    getPoProductAutocomplete().position();
}
function closePoDropdown() {
    getPoProductAutocomplete().close();
}
async function renderPoDropdown(keyword) {
    return getPoProductAutocomplete().search(keyword);
}
function updatePoDropdownSelection() {
    getPoProductAutocomplete().updateSelection();
}
function initPoProductSearch() {
    getPoProductAutocomplete().init();
}


window.addAddPurchaseItem = (prodId) => {
    let targetId = prodId;
    if (!targetId) {
        const select = document.getElementById('add-purchase-product-select');
        targetId = select?.value;
    }
    if (!targetId) return;
    const prod = PRODUCTS.find(p => String(p.id) === String(targetId));
    if (prod) addProductToPo(prod);
};

window.removeAddPurchaseItem = (index) => {
    addPurchaseItems.splice(index, 1);
    renderAddPurchaseItems();
};

window.updateAddPurchaseItemQty = (index, val) => {
    const qty = parseFloat(val);
    addPurchaseItems[index].quantity = qty > 0 ? qty : 1;
    renderAddPurchaseItems();
};

window.updateAddPurchaseItemPrice = (index, val) => {
    const price = parseFloat(val);
    if (price >= 0) addPurchaseItems[index].price = price;
    renderAddPurchaseItems();
};

// FIX: open add-purchase modal with cleared form
function openAddPurchaseModal() {
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

    if (vendorEl) vendorEl.value = '';
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    if (paidEl) paidEl.value = '';
    if (ptEl) ptEl.selectedIndex = 0;
    if (searchInput) searchInput.value = '';

    closePoDropdown();
    initPoProductSearch();
    onPurchasePaymentTypeChange('add');

    addPurchaseItems = [];
    renderAddPurchaseItems();
    openModal('modal-add-purchase');

    setTimeout(() => {
        if (searchInput) searchInput.focus();
    }, 150);
}

let editPurchaseItems = [];

function renderEditPurchaseItems() {
    const container = document.getElementById('edit-purchase-items-container');
    if (!container) return;

    container.innerHTML = '';
    let subtotal = 0;

    editPurchaseItems.forEach((item, index) => {
        const product = PRODUCTS.find(p => p.id === item.product_id) || { name: item.product_name || item.product_id, unit: 'pcs' };
        const itemPrice = parseFloat(item.price ?? item.cost ?? 0);
        const itemTotal = (parseFloat(item.quantity) || 0) * itemPrice;
        subtotal += itemTotal;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 0.5rem;">
                <div style="font-weight: 500; color: var(--gray-900);">${product.name}</div>
            </td>
            <td style="padding: 0.5rem; text-align: center; white-space: nowrap;">
                <input type="number" min="1" value="${formatNumberTrim(item.quantity)}" onchange="updateEditPurchaseItemQty(${index}, this.value)" step="any" min="0.001" style="width: 80px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: center;">
                <span style="font-size: 0.8rem; color: var(--gray-500); margin-left: 0.25rem;">${product.unit || 'pcs'}</span>
            </td>
            <td style="padding: 0.5rem; text-align: right;">
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.25rem;">
                    <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                    <input type="number" value="${formatNumberTrim(itemPrice)}" onchange="updateEditPurchaseItemPrice(${index}, this.value)" step="any" style="width: 90px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: right;">
                </div>
            </td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: var(--gray-900);">
                ${rp(itemTotal)}
            </td>
            <td style="padding: 0.5rem; text-align: center;">
                <button type="button" onclick="removeEditPurchaseItem(${index})" style="color: var(--rose-500); background: none; border: none; cursor: pointer; padding: 0.25rem;">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </td>
        `;
        container.appendChild(tr);
    });

    if (editPurchaseItems.length === 0) {
        container.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 1rem; color: var(--gray-500);">Belum ada item.</td></tr>`;
    }

    document.getElementById('edit-purchase-total').textContent = rp(subtotal);

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.addEditPurchaseItem = () => {
    const select = document.getElementById('edit-purchase-product-select');
    if (!select || !select.value) return;

    const prod = PRODUCTS.find(p => p.id === select.value);
    if (!prod) return;

    const existing = editPurchaseItems.find(i => i.product_id === prod.id);
    if (existing) {
        existing.quantity = (parseFloat(existing.quantity) || 0) + 1;
    } else {
        editPurchaseItems.push({
            product_id: prod.id,
            quantity: 1,
            price: prod.cost || prod.price
        });
    }
    renderEditPurchaseItems();
};

window.removeEditPurchaseItem = (index) => {
    editPurchaseItems.splice(index, 1);
    renderEditPurchaseItems();
};

window.updateEditPurchaseItemQty = (index, val) => {
    const qty = parseFloat(val);
    if (qty > 0) {
        editPurchaseItems[index].quantity = qty;
    } else {
        editPurchaseItems[index].quantity = 1;
    }
    renderEditPurchaseItems();
};

window.updateEditPurchaseItemPrice = (index, val) => {
    const price = parseFloat(val);
    if (price >= 0) {
        editPurchaseItems[index].price = price;
    }
    renderEditPurchaseItems();
};

let originalEditPurchaseItems = [];

// FIX: open edit-purchase modal and load existing items
async function openEditPurchaseModal(id) {
    const po = PURCHASES.find(x => x.id === id);
    if (!po) return;

    // Fill header fields
    const idEl = document.getElementById('edit-purchase-id');
    const vendorEl = document.getElementById('edit-purchase-vendor');
    const dateEl = document.getElementById('edit-purchase-date');
    const paidEl = document.getElementById('edit-purchase-paid');
    const ptEl = document.getElementById('edit-purchase-payment-type');

    if (idEl) idEl.value = po.id;
    const numDisplay = document.getElementById('edit-purchase-number-display');
    if (numDisplay) numDisplay.value = po.id;
    if (vendorEl) vendorEl.value = po.vendorId || '';
    if (dateEl) dateEl.value = (po.date || '').split('T')[0];
    if (paidEl) paidEl.value = po.paid || '';
    if (ptEl) ptEl.value = po.paymentTypeId || '';
    const statusEl = document.getElementById('edit-purchase-status');
    if (statusEl) statusEl.value = po.status || 'Dalam Proses';
    const dueDateEl = document.getElementById('edit-purchase-due-date');
    if (dueDateEl) dueDateEl.value = po.dueDate || '';

    // Adjust due date picker visibility
    onPurchasePaymentTypeChange('edit');

    // Populate product select
    const select = document.getElementById('edit-purchase-product-select');
    if (select) {
        select.innerHTML = '<option value="" disabled selected>- Pilih Produk -</option>' +
            PRODUCTS.map(p => `<option value="${p.id}">${p.name} (${rp(p.cost || p.price)})</option>`).join('');
    }

    // Reset items and show loading
    editPurchaseItems = [];
    originalEditPurchaseItems = [];
    const container = document.getElementById('edit-purchase-items-container');
    if (container) container.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem; color: var(--gray-400);">Memuat data item...</td></tr>';

    try {
        const res = await fetch(`/api/purchases/${encodeURIComponent(id)}/items?_t=${Date.now()}`, { headers: getAuthHeaders() });
        if (res.ok) {
            editPurchaseItems = await res.json();
            originalEditPurchaseItems = JSON.parse(JSON.stringify(editPurchaseItems));
        } else {
            console.warn('Failed to load PO items, status:', res.status);
        }
    } catch (err) {
        console.error('Failed to load PO items', err);
    }
    // Always render — will show 'Belum ada item' if array empty
    renderEditPurchaseItems();

    openModal('modal-edit-purchase');
}

async function savePurchase(isEdit, bypassSoftLock = false, correctionReason = null) {
    const id = isEdit ? document.getElementById('edit-purchase-id').value : null;
    const prefix = isEdit ? 'edit' : 'add';

    let itemsToSave = [];
    if (isEdit) {
        itemsToSave = editPurchaseItems.map(i => ({ product_id: i.product_id, qty: i.quantity, price: i.price ?? i.cost ?? 0, total: i.quantity * (i.price ?? i.cost ?? 0) }));
    } else {
        itemsToSave = addPurchaseItems.map(i => ({ product_id: i.product_id, qty: i.quantity, price: i.price, total: i.quantity * i.price }));
    }

    if (itemsToSave.length === 0) {
        showToast('Tambahkan minimal satu item produk!', 'warning');
        return;
    }

    // Soft-Lock Check (B3) for Edit Purchase
    if (isEdit && !bypassSoftLock && Array.isArray(originalEditPurchaseItems) && originalEditPurchaseItems.length > 0) {
        let isQtyReducedOrItemRemoved = false;
        for (const orig of originalEditPurchaseItems) {
            const cur = editPurchaseItems.find(i => String(i.product_id) === String(orig.product_id));
            if (!cur) {
                isQtyReducedOrItemRemoved = true;
                break;
            }
            const origQty = parseFloat(orig.quantity || orig.qty || 0);
            const curQty = parseFloat(cur.quantity || cur.qty || 0);
            if (curQty < origQty) {
                isQtyReducedOrItemRemoved = true;
                break;
            }
        }

        if (isQtyReducedOrItemRemoved) {
            promptSoftLockModal('purchase');
            return;
        }
    }

    const vendorVal = document.getElementById(`${prefix}-purchase-vendor`)?.value || '';
    if (!vendorVal) {
        showToast('Pilih vendor terlebih dahulu!', 'warning');
        return;
    }
    const total = itemsToSave.reduce((s, i) => s + i.total, 0);

    let dueDate = document.getElementById(`${prefix}-purchase-due-date`)?.value || '';
    if (!dueDate) {
        dueDate = calculateDueDate(getPaymentTypeName(document.getElementById(`${prefix}-purchase-payment-type`)), document.getElementById(`${prefix}-purchase-date`)?.value);
    }

    const payTypeName = getPaymentTypeName(document.getElementById(`${prefix}-purchase-payment-type`)).toLowerCase();
    const isKredit = payTypeName.includes('kredit') || payTypeName.includes('credit');
    const paidInput = parseFloat(document.getElementById(`${prefix}-purchase-paid`)?.value || 0);
    // Jika bukan kredit (Tunai/Transfer), paid otomatis = total (Lunas). Untuk PO baru kredit, bayar = 0 (belum lunas)
    const paid = isKredit ? (isEdit ? paidInput : 0) : total;

    const payload = {
        vendor_id: document.getElementById(`${prefix}-purchase-vendor`)?.value || '',
        date: document.getElementById(`${prefix}-purchase-date`)?.value || '',
        total: total,
        paid: paid,
        payment_type_id: document.getElementById(`${prefix}-purchase-payment-type`)?.value || '',
        due_date: dueDate,
        items: itemsToSave
    };

    if (correctionReason) {
        payload.correction_reason = correctionReason;
    }

    const url = isEdit ? `/api/purchases/${id}` : '/api/purchases';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal(`modal-${isEdit ? 'edit' : 'add'}-purchase`);
            showToast(isEdit ? 'Purchase Order berhasil diperbarui!' : 'Purchase Order berhasil dibuat!', 'success');
            notifyDataChange('purchase');
            await fetchPurchases();
            await fetchProducts(); // update stock
            renderHutang();
        } else {
            let errMsg = 'Gagal menyimpan PO';
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (e) {
                if (res.status === 401 || res.status === 403) errMsg = 'Sesi telah habis, silakan login kembali.';
                else errMsg = `Error ${res.status}: Terjadi kesalahan di server.`;
            }
            showToast('Error: ' + errMsg, 'error');
            if (res.status === 401 || res.status === 403) {
                setTimeout(() => window.location.reload(), 1500);
            }
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
}

// ==========================================================================
// INVOICES — CRUD
// ==========================================================================

async function fetchInvoices(page) {
    try {
        // Full data for summary cards, charts, recent transactions (unpaginated)
        const resAll = await fetch(`/api/invoices?all=true&_t=${Date.now()}`, { headers: getAuthHeaders() });
        const dataAll = await resAll.json();
        if (!resAll.ok || (dataAll && dataAll.error)) {
            showToast('Gagal memuat data invoice, coba lagi.', 'error');
            return;
        }
        INVOICES = Array.isArray(dataAll) ? dataAll : [];
        renderSummaryCards();
        renderRecentTransactions();
        refreshCharts();

        // Load INVOICE_PROFORMA_MAP — proforma yang sudah ada dari invoice (Item 4)
        try {
            const pfMapRes = await fetch('/api/proformas?sumber=dari_invoice&limit=500&page=1', { headers: getAuthHeaders() });
            if (pfMapRes.ok) {
                const pfMapData = await pfMapRes.json();
                INVOICE_PROFORMA_MAP = {};
                (pfMapData.rows || []).forEach(pf => {
                    if (pf.invoice_id) INVOICE_PROFORMA_MAP[pf.invoice_id] = pf.pk;
                });
            }
        } catch(_) { /* silent — map hanya untuk UI hint */ }

        // Paginated fetch for invoices table
        if (page !== undefined) paginationState.invoices.page = page;
        const q = document.getElementById('invoice-search')?.value || '';
        const status = document.getElementById('invoice-status-filter')?.value || 'all';
        const paymentTypeId = document.getElementById('invoice-payment-type-filter')?.value || 'all';
        const pg = paginationState.invoices.page;
        let url = '/api/invoices?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (status && status !== 'all') url += '&status=' + encodeURIComponent(status);
        if (paymentTypeId && paymentTypeId !== 'all') url += '&payment_type_id=' + encodeURIComponent(paymentTypeId);

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};
        paginationState.invoices.total = pag.total || 0;
        paginationState.invoices.totalPages = pag.totalPages || 1;

        const today = new Date().toISOString().split('T')[0];
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canEdit = role === 'admin' || role === 'finance' || role === 'kasir';
        const tbody = document.getElementById('invoices-body');
        if (tbody) {
            tbody.innerHTML = rows.map(inv => {
                const statusLower = (inv.status || '').toLowerCase();
                const sisa = inv.total - inv.paid;
                const isOverdue = sisa > 0 && inv.dueDate && inv.dueDate < today;
                const overdueBadge = isOverdue ? '<span class="badge-status overdue" style="margin-left:4px; font-size:0.7rem; padding:2px 7px;">Lewat JT</span>' : '';
                const retAmount = parseFloat(inv.return_amount || inv.returnAmount || 0);
                const retBadge = retAmount > 0 ? `<span class="badge-retur-indicator" title="Total Retur: ${rp(retAmount)}">Ada Retur</span>` : '';
                return `
                <tr>
                    <td style="font-weight:600; color: var(--blue-600);">${inv.id}${retBadge ? ' ' + retBadge : ''}</td>
                    <td>${inv.date}</td>
                    <td style="font-weight:600;">${inv.customer || '-'}${overdueBadge}</td>
                    <td style="font-weight:700;">${rp(inv.total)}</td>
                    <td>${rp(inv.paid)}</td>
                    <td>${inv.type || '-'}</td>
                    <td><span class="badge-status ${statusLower.includes('belum') ? 'belum' : statusLower.replace(/\s+/g, '-')}">${capitalize(inv.status)}</span></td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Cetak Invoice" onclick="printInvoice('${inv.id}')">
                            <i data-lucide="printer" style="width: 14px; height: 14px; margin: 0;"></i>
                        </button>
                        ${canEdit && statusLower !== 'batal' && statusLower !== 'cancel' ? `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Invoice" onclick="openEditInvoiceModal('${inv.id}')">
                            <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                        </button>` : ''}
                        ${statusLower !== 'batal' && statusLower !== 'cancel' ? (
                            INVOICE_PROFORMA_MAP[inv.id]
                            ? `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem; margin-right:0.25rem; color:var(--blue-700); border-color:var(--blue-300);" title="Cetak Proforma" onclick="printProformaDariInvoice(${INVOICE_PROFORMA_MAP[inv.id]})"><i data-lucide="file-text" style="width:13px;height:13px;margin:0;"></i></button>`
                            : `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem; margin-right:0.25rem;" title="Buat Proforma" onclick="openBuatProformaDariInvoice('${inv.id}')"><i data-lucide="file-plus" style="width:13px;height:13px;margin:0;"></i></button>`
                        ) : ''}
                        ${statusLower !== 'lunas' && statusLower !== 'batal' && statusLower !== 'cancel' ? `<button class="btn-toolbar primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="openPiutangPaymentModal('${inv.id}', ${sisa})">Bayar</button>` : ''}
                    </td>
                </tr>`;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-invoices',
            currentPage: pg,
            totalItems: paginationState.invoices.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchInvoices(p)
        });

        // Also refresh piutang
        if (typeof fetchPiutang === 'function') await fetchPiutang(paginationState.piutang.page);

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch invoices', err);
        showToast('Gagal memuat data invoice, coba lagi.', 'error');
    }
}

async function fetchPiutang(page) {
    // Kasir tidak memiliki akses ke piutang — abaikan tanpa toast error
    const _fpRole = (localStorage.getItem('role') || 'kasir').toLowerCase();
    if (_fpRole === 'kasir') return;
    try {
        if (page !== undefined) paginationState.piutang.page = page;
        const q = document.getElementById('piutang-search')?.value || '';
        const status = document.getElementById('piutang-status-filter')?.value || 'all';
        const custFilter = document.getElementById('piutang-customer-filter')?.value || 'all';
        const pg = paginationState.piutang.page;
        let url = '/api/finance/receivables?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (status && status !== 'all') url += '&status=' + encodeURIComponent(status);
        if (custFilter && custFilter !== 'all') url += '&customer_id=' + encodeURIComponent(custFilter);

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};
        const summary = json.summary || {};
        paginationState.piutang.total = pag.total || 0;
        paginationState.piutang.totalPages = pag.totalPages || 1;

        // Summary cards from server (full filtered dataset)
        const summEl = document.getElementById('piutang-summary');
        if (summEl) {
            summEl.innerHTML =
                '<div class="finance-summary-card highlight">' +
                    '<div class="fs-value">' + rp(parseFloat(summary.total_piutang || 0)) + '</div>' +
                    '<div class="fs-label">Total Piutang</div>' +
                '</div>' +
                '<div class="finance-summary-card">' +
                    '<div class="fs-value" style="color:var(--rose-500);">' + rp(parseFloat(summary.belum_bayar || 0)) + '</div>' +
                    '<div class="fs-label">Belum Dibayar</div>' +
                '</div>' +
                '<div class="finance-summary-card">' +
                    '<div class="fs-value" style="color:var(--amber-500);">' + rp(parseFloat(summary.sebagian || 0)) + '</div>' +
                    '<div class="fs-label">Dibayar Sebagian</div>' +
                '</div>';
        }

        // Populate customer filter dropdown
        const custFilterEl = document.getElementById('piutang-customer-filter');
        if (custFilterEl && INVOICES.length > 0) {
            const selectedCust = custFilterEl.value;
            const uniqueCustomers = [...new Map(
                INVOICES.filter(i => i.customer).map(i => [String(i.customerId), i.customer])
            ).entries()].sort((a, b) => a[1].localeCompare(b[1]));
            custFilterEl.innerHTML = '<option value="all">Semua Pelanggan</option>' +
                uniqueCustomers.map(([cid, cname]) =>
                    '<option value="' + cid + '" ' + (selectedCust === cid ? 'selected' : '') + '>' + cname + '</option>'
                ).join('');
        }

        const today = new Date().toISOString().split('T')[0];
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canPayOrVoid = role === 'admin' || role === 'finance';

        const tbody = document.getElementById('piutang-body');
        if (!tbody) return;
        tbody.innerHTML = rows.map(inv => {
            const sisa = inv.total - inv.paid;
            const isOverdue = sisa > 0 && inv.dueDate && inv.dueDate < today;
            const statusLower = (inv.status || '').toLowerCase();
            const overdueBadge = isOverdue
                ? '<span class="badge-status overdue" style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;padding:2px 7px;margin-left:4px;vertical-align:middle;"><i data-lucide=\"clock\" style=\"width:11px;height:11px;\"></i> Lewat JT</span>'
                : '';
            let actionButtons;
            if (canPayOrVoid) {
                // A6: Sembunyikan tombol "Bayar" di setiap baris, sisakan tombol cicilan/riwayat bayar 3 garis
                const deleteBtn = inv.isOutstandingImport
                    ? `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;color:var(--rose-500);" title="Hapus Invoice Outstanding" onclick="confirmDeleteOutstandingInvoice('${inv.id}', ${inv.paid || 0})"><i data-lucide="trash-2" style="width:13px;height:13px;margin:0;"></i></button>`
                    : '';

                actionButtons = `<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" title="Riwayat Cicilan & Bayar" onclick="openPaymentHistoryModal('${inv.id}')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>${deleteBtn}`;
            } else {
                actionButtons = '<span style="color:var(--gray-400);font-size:0.8rem;">Lihat Saja</span>';
            }

            // Requirement 6: Checkbox di sisi kiri invoice
            const isCancel = statusLower === 'cancel' || statusLower === 'batal';
            const isChecked = selectedPiutangIds.has(String(inv.id));
            const checkboxHtml = `<td style="text-align: center; width: 36px;">
                <input type="checkbox" class="check-piutang-item" value="${inv.id}" ${isCancel ? 'disabled' : ''} ${isChecked ? 'checked' : ''} onchange="onPiutangCheckboxChange(this, '${inv.id}')">
            </td>`;

            return `
            <tr>
                ${checkboxHtml}
                <td style="font-weight:600; color:var(--blue-600);">${inv.id}</td>
                <td>${inv.customer || '-'}</td>
                <td style="font-weight:700;">${rp(inv.total)}</td>
                <td>${rp(inv.paid)}</td>
                <td style="font-weight:700; color:${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">${rp(sisa)}</td>
                <td>${inv.dueDate || '-'}${overdueBadge}</td>
                <td>${statusLower.includes('belum') ? '-' : (inv.paidDate || '-')}</td>
                <td>${statusLower.includes('belum') ? '-' : (inv.type || '-')}</td>
                <td><span class="badge-status ${statusLower.includes('belum') ? 'belum' : statusLower.replace(/\s+/g, '-')}">${capitalize(inv.status)}</span></td>
                <td style="text-align:right; white-space:nowrap;">${actionButtons}</td>
            </tr>`;
        }).join('');

        updateCheckAllPiutangState();
        updateExportPdfButton();

        renderPagination({
            containerId: 'pagination-piutang',
            currentPage: pg,
            totalItems: paginationState.piutang.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchPiutang(p)
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch piutang', err);
    }
}

let editInvoiceItems = [];
let editInvoiceCurrentCustomerId = null;
let editInvoicePoCurrentMatches = [];
let editInvoicePoSearchActiveIndex = 0;
let editInvoicePoSearchDebounce = null;

function renderEditInvoiceItems() {
    const container = document.getElementById('edit-invoice-items-container');
    if (!container) return;
    const isAdmin = (localStorage.getItem('role') || 'kasir').toLowerCase() === 'admin';
    const thFee = document.getElementById('edit-invoice-th-fee');
    if (thFee) {
        thFee.style.display = isAdmin ? 'table-cell' : 'none';
    }

    container.innerHTML = '';
    let subtotal = 0;

    editInvoiceItems.forEach((item, index) => {
        const product = PRODUCTS.find(p => p.id === item.product_id) || { name: item.product_name || item.product_id, unit: 'pcs' };
        const itemTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0);
        subtotal += itemTotal;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 0.5rem;">
                <div style="font-weight: 500; color: var(--gray-900);">${product.name}</div>
            </td>
            <td style="padding: 0.5rem; text-align: center;">
                <input type="number" min="1" value="${formatNumTrim(item.quantity)}" onchange="updateEditInvoiceItemQty(${index}, this.value)" step="any" style="width: 80px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: center;">
            </td>
            <td style="padding: 0.5rem; text-align: right;">
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.25rem;">
                    <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                    <input type="number" value="${formatNumTrim(item.price)}" onchange="updateEditInvoiceItemPrice(${index}, this.value)" step="any" style="width: 90px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: right;">
                </div>
            </td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: var(--gray-900);">
                ${rp(itemTotal)}
            </td>
            ${isAdmin ? `
            <td style="padding: 0.5rem;">
                <div style="display:flex;gap:0.25rem;align-items:center;">
                    <input type="number" min="0" value="${parseFloat(item.customer_fee) || 0}" placeholder="Fee"
                        onchange="updateEditInvoiceItemFee(${index}, this.value)"
                        style="width:70px;padding:0.2rem 0.3rem;font-size:0.78rem;border:1px solid #fcd34d;border-radius:0.25rem;background:#fffbeb;color:#92400e;">
                    <input type="text" value="${item.fee_notes || ''}" placeholder="Catatan"
                        oninput="updateEditInvoiceItemFeeNotes(${index}, this.value)"
                        style="width:90px;padding:0.2rem 0.3rem;font-size:0.78rem;border:1px solid #fcd34d;border-radius:0.25rem;background:#fffbeb;color:#92400e;">
                </div>
            </td>` : ''}
            <td style="padding: 0.5rem; text-align: center;">
                <button type="button" onclick="removeEditInvoiceItem(${index})" style="color: var(--rose-500); background: none; border: none; cursor: pointer; padding: 0.25rem;">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </td>
        `;
        container.appendChild(tr);
    });

    if (editInvoiceItems.length === 0) {
        const colspan = isAdmin ? 6 : 5;
        container.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; padding: 1rem; color: var(--gray-500);">Belum ada item.</td></tr>`;
    }

    const ppnActive = (typeof currentPpnEnabled !== 'undefined') ? currentPpnEnabled : false;
    const ppnRateEff = (typeof currentPpnRate !== 'undefined') ? currentPpnRate : 11;
    const ppn = ppnActive ? Math.round(subtotal * (ppnRateEff / 100)) : 0;
    const grandTotal = subtotal + ppn;

    // Show/hide PPN row in edit invoice modal based on settings
    const ppnRowEl = document.getElementById('edit-invoice-ppn-row');
    if (ppnRowEl) ppnRowEl.style.display = ppnActive ? '' : 'none';
    const ppnLabelEl = document.getElementById('edit-invoice-ppn-label');
    if (ppnLabelEl) ppnLabelEl.textContent = `(${ppnRateEff}%)`;

    document.getElementById('edit-invoice-subtotal').textContent = rp(subtotal);
    document.getElementById('edit-invoice-ppn').textContent = rp(ppn);
    document.getElementById('edit-invoice-total').textContent = rp(grandTotal);

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Edit Invoice Product Search Instance ──────────────────────────────────────
let editInvoiceProductAutocomplete = null;
function getEditInvoiceProductAutocomplete() {
    if (!editInvoiceProductAutocomplete) {
        editInvoiceProductAutocomplete = new ProductAutocomplete({
            inputId: 'edit-invoice-product-search',
            dropdownId: 'edit-invoice-product-dropdown',
            wrapperId: 'edit-invoice-search-wrapper',
            modalSelector: '#modal-edit-invoice .modal',
            getPrice: function(p) { return getEditInvoiceProductPrice(p); },
            onSelect: function(p) { addEditInvoiceItemFromSearch(p); }
        });
    }
    return editInvoiceProductAutocomplete;
}

function closeEditInvoiceDropdown() {
    getEditInvoiceProductAutocomplete().close();
}

function positionEditInvoiceDropdown() {
    getEditInvoiceProductAutocomplete().position();
}

function renderEditInvoiceDropdown(keyword) {
    return getEditInvoiceProductAutocomplete().search(keyword);
}

function initEditInvoiceProductSearch() {
    getEditInvoiceProductAutocomplete().init();
}

function getEditInvoiceProductPrice(prod) {
    if (editInvoiceCurrentCustomerId) {
        var eff = currentPOSCustomerEffectivePrices[prod.id];
        if (eff) return parseFloat(eff.harga_efektif);
    }
    return parseFloat(prod.price || prod.sell_price || 0);
}

function addEditInvoiceItemFromSearch(prod) {
    if (!prod) return;
    var existing = editInvoiceItems.find(function(i) { return String(i.product_id) === String(prod.id); });
    if (existing) {
        existing.quantity = (parseFloat(existing.quantity) || 0) + 1;
    } else {
        editInvoiceItems.push({
            product_id: prod.id,
            product_name: prod.name,
            quantity: 1,
            price: getEditInvoiceProductPrice(prod)
        });
    }
    renderEditInvoiceItems();
    var input = document.getElementById('edit-invoice-product-search');
    if (input) { input.value = ''; input.focus(); }
    closeEditInvoiceDropdown();
}

// Legacy stub
window.addEditInvoiceItem = function() {};

window.removeEditInvoiceItem = (index) => {
    editInvoiceItems.splice(index, 1);
    renderEditInvoiceItems();
};

window.updateEditInvoiceItemQty = (index, val) => {
    const qty = parseFloat(val);
    if (qty > 0) {
        editInvoiceItems[index].quantity = qty;
    } else {
        editInvoiceItems[index].quantity = 1;
    }
    renderEditInvoiceItems();
};

window.updateEditInvoiceItemPrice = (index, val) => {
    const price = parseFloat(val);
    if (price >= 0) {
        editInvoiceItems[index].price = price;
    }
    renderEditInvoiceItems();
};

window.updateEditInvoiceItemFee = (index, val) => {
    const fee = parseFloat(val);
    editInvoiceItems[index].customer_fee = fee >= 0 ? fee : 0;
};

window.updateEditInvoiceItemFeeNotes = (index, val) => {
    editInvoiceItems[index].fee_notes = val || '';
};

let originalEditInvoiceItems = [];

async function openEditInvoiceModal(id) {
    const inv = INVOICES.find(x => x.id === id);
    if (!inv) return;

    const statusLower = (inv.status || '').toLowerCase();
    if (statusLower === 'cancel' || statusLower === 'batal') {
        showToast('Invoice yang sudah dibatalkan tidak dapat diedit atau dibatalkan lagi.', 'warning');
        return;
    }

    // Cek role — kasir tidak bisa ubah status/tipe pembayaran
    const role = (localStorage.getItem('role') || '').toLowerCase();
    const canChangeStatusOrType = role === 'admin' || role === 'finance';

    document.getElementById('edit-invoice-id').value = inv.id;
    document.getElementById('edit-invoice-number-display').value = inv.id;
    document.getElementById('edit-invoice-date').value = inv.date ? String(inv.date).split('T')[0].split(' ')[0] : '';
    document.getElementById('edit-invoice-customer-display').value = inv.customer || '';

    // Status dropdown
    const statusEl = document.getElementById('edit-invoice-status');
    if (statusEl) {
        const sl = (inv.status || '').toLowerCase();
        statusEl.value = sl === 'lunas' ? 'lunas' : (sl === 'sebagian' ? 'sebagian' : 'belum');
        statusEl.disabled = !canChangeStatusOrType;
    }

    // Tipe Pembayaran dropdown — diisi dari master (sudah dimuat di init)
    const ptEl = document.getElementById('edit-invoice-payment-type');
    if (ptEl) {
        if (Array.isArray(ALL_PAYMENT_TYPES) && ALL_PAYMENT_TYPES.length > 0) {
            ptEl.innerHTML = ALL_PAYMENT_TYPES.map(pt =>
                `<option value="${pt.id}">${pt.name}</option>`
            ).join('');
        } else {
            // Fallback: muat ulang dari API
            try {
                const r = await fetch('/api/master/payment-types', { headers: getAuthHeaders() });
                if (r.ok) {
                    const pts = await r.json();
                    ptEl.innerHTML = pts.map(pt => `<option value="${pt.id}">${pt.name}</option>`).join('');
                }
            } catch (_) {}
        }
        // Set nilai awal = tipe pembayaran saat ini
        ptEl.value = inv.paymentTypeId || 'PT-1';
        ptEl.disabled = !canChangeStatusOrType;
    }

    // Simpan customerId untuk lookup special price saat user tambah produk baru
    editInvoiceCurrentCustomerId = inv.customerId || null;

    // Load effective prices untuk pelanggan ini
    if (editInvoiceCurrentCustomerId) {
        try {
            var effRes = await fetch(
                '/api/pricelists/effective-prices?customer_id=' + encodeURIComponent(editInvoiceCurrentCustomerId),
                { headers: getAuthHeaders() }
            );
            if (effRes.ok) {
                var effData = await effRes.json();
                var effRows = Array.isArray(effData) ? effData : (Array.isArray(effData.prices) ? effData.prices : []);
                currentPOSCustomerEffectivePrices = {};
                effRows.forEach(function(row) { currentPOSCustomerEffectivePrices[row.product_id] = row; });
            }
        } catch(_) {}
    }

    // Reset search input (allow re-init)
    var searchInput = document.getElementById('edit-invoice-product-search');
    if (searchInput) { searchInput.value = ''; delete searchInput.dataset.editInvSearchInit; }
    closeEditInvoiceDropdown();

    // Reset items and show loading
    editInvoiceItems = [];
    originalEditInvoiceItems = [];
    const container = document.getElementById('edit-invoice-items-container');
    if (container) container.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem; color: var(--gray-400);">Memuat data item...</td></tr>';

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/items`, { headers: getAuthHeaders() });
        if (res.ok) {
            editInvoiceItems = await res.json();
            originalEditInvoiceItems = JSON.parse(JSON.stringify(editInvoiceItems));
        } else {
            console.warn('Failed to load invoice items, status:', res.status);
        }
    } catch (err) {
        console.error('Failed to load invoice items', err);
    }
    // Always render — will show 'Belum ada item' if array empty
    renderEditInvoiceItems();

    openModal('modal-edit-invoice');
    setTimeout(initEditInvoiceProductSearch, 50);
}

let pendingSaveInvoicePayload = null;

async function saveInvoiceEdits(bypassSoftLock = false, correctionReason = null) {
    const id = document.getElementById('edit-invoice-id').value;
    if (!id) return;

    // Soft-Lock Check (B3) for Edit Invoice
    if (!bypassSoftLock && Array.isArray(originalEditInvoiceItems) && originalEditInvoiceItems.length > 0) {
        let isQtyReducedOrItemRemoved = false;
        for (const orig of originalEditInvoiceItems) {
            const cur = editInvoiceItems.find(i => String(i.product_id) === String(orig.product_id));
            if (!cur) {
                isQtyReducedOrItemRemoved = true;
                break;
            }
            const origQty = parseFloat(orig.quantity || orig.qty || 0);
            const curQty = parseFloat(cur.quantity || cur.qty || 0);
            if (curQty < origQty) {
                isQtyReducedOrItemRemoved = true;
                break;
            }
        }

        if (isQtyReducedOrItemRemoved) {
            promptSoftLockModal('invoice');
            return;
        }
    }

    const date = document.getElementById('edit-invoice-date').value;
    const statusVal = document.getElementById('edit-invoice-status').value;  // 'lunas' | 'belum' | 'sebagian'

    // Ambil tipe pembayaran dari dropdown baru
    const paymentTypeEl = document.getElementById('edit-invoice-payment-type');
    const paymentTypeId = paymentTypeEl ? paymentTypeEl.value : null;

    const inv = INVOICES.find(x => x.id === id);
    const customer_id = inv ? inv.customerId : null;

    const subtotal = editInvoiceItems.reduce((s, i) => s + (parseFloat(i.price || i.sell_price || 0) * parseInt(i.quantity || i.qty || 0)), 0);
    const ppnRate = (typeof currentPpnEnabled !== 'undefined' && !currentPpnEnabled) ? 0 : ((typeof currentPpnRate !== 'undefined' ? currentPpnRate : 11) / 100);
    const newTotal = subtotal + Math.round(subtotal * ppnRate);

    const paidAmount = inv ? parseFloat(inv.paid || 0) : 0;

    // Soft-lock Guard: new total must not be smaller than active payments received
    if (paidAmount > 0 && newTotal < paidAmount) {
        showToast(`Total invoice baru (${rp(newTotal)}) tidak boleh lebih kecil dari pembayaran yang sudah diterima (${rp(paidAmount)}).`, 'warning');
        return;
    }

    // Hitung due_date baru berdasarkan tipe pembayaran baru
    const selectedPtEl = document.getElementById('edit-invoice-payment-type');
    const selectedPtName = selectedPtEl ? (selectedPtEl.options[selectedPtEl.selectedIndex]?.text || '') : '';
    const newDueDate = calculateDueDate(selectedPtName, date);

    pendingSaveInvoicePayload = {
        id,
        date,
        requested_status: statusVal,   // ← dikirim ke backend untuk sinkronisasi
        customer_id,
        total: newTotal,
        paid_amount: paidAmount,
        payment_type_id: paymentTypeId || (inv ? inv.paymentTypeId : 'PT-1'),
        due_date: newDueDate || undefined,
        items: editInvoiceItems,
        correction_reason: correctionReason || undefined
    };

    // Jika invoice sudah ada cicilan aktif, tampilkan soft-lock modal peringatan
    if (paidAmount > 0) {
        const statsEl = document.getElementById('confirm-edit-invoice-stats');
        if (statsEl) {
            const sisaBaru = Math.max(0, newTotal - paidAmount);
            const ptNameDisplay = selectedPtName || (inv ? inv.type : '-');
            const statusDisplay = statusVal === 'lunas' ? '✅ Lunas' : (statusVal === 'sebagian' ? '⚠️ Sebagian' : '❌ Belum Lunas');
            statsEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span>Total Baru:</span> <b>${rp(newTotal)}</b>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: var(--emerald-600);">
                    <span>Total Pembayaran Diterima:</span> <b>${rp(paidAmount)}</b>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: ${sisaBaru > 0 ? 'var(--rose-600)' : 'var(--emerald-600)'};">
                    <span>Sisa Tagihan Baru:</span> <b>${rp(sisaBaru)}</b>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span>Tipe Pembayaran:</span> <b>${ptNameDisplay}</b>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Status Baru:</span> <b>${statusDisplay}</b>
                </div>
            `;
        }
        openModal('modal-confirm-edit-invoice');
    } else {
        await executeSaveInvoiceEdits();
    }
}

async function executeSaveInvoiceEdits() {
    if (!pendingSaveInvoicePayload) return;
    const { id, ...bodyData } = pendingSaveInvoicePayload;
    closeModal('modal-confirm-edit-invoice');

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(bodyData)
        });
        if (res.ok) {
            closeModal('modal-edit-invoice');
            showToast('Invoice berhasil diperbarui!', 'success');
            notifyDataChange('invoice_edit');
            // Muat ulang daftar invoice dan piutang tanpa full page reload
            await fetchInvoices();
            await fetchProducts(); // stock changed
            if (typeof fetchPiutang === 'function') await fetchPiutang();
            if (typeof fetchDashboardSummary === 'function') await fetchDashboardSummary();
        } else {
            let errMsg = 'Gagal menyimpan invoice';
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (e) {
                if (res.status === 401 || res.status === 403) errMsg = 'Sesi habis atau tidak memiliki izin. Silakan login ulang.';
                else errMsg = `Error ${res.status} dari server.`;
            }
            showToast('Error: ' + errMsg, 'error');
            if (res.status === 401) setTimeout(() => window.location.reload(), 1500);
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    } finally {
        pendingSaveInvoicePayload = null;
    }
}

let cancelInvoiceId = null;

async function cancelInvoice(id) {
    if (!id) {
        id = document.getElementById('edit-invoice-id')?.value;
    }
    if (!id) return;
    cancelInvoiceId = id;
    const inv = INVOICES.find(x => x.id === id);
    const paidAmount = inv ? parseFloat(inv.paid || 0) : 0;
    const alertEl = document.getElementById('cancel-invoice-payments-alert');
    const textEl = document.getElementById('cancel-invoice-payments-text');
    const btnConfirm = document.getElementById('btn-confirm-cancel-invoice');

    if (paidAmount > 0) {
        if (alertEl) alertEl.style.display = 'block';
        if (textEl) {
            textEl.innerHTML = `Invoice ini memiliki pembayaran aktif sebesar <b>${rp(paidAmount)}</b>. Membatalkan invoice akan <b>otomatis membatalkan (void) semua pembayaran</b> dan membalikkan posting kas. Lanjutkan?`;
        }
        if (btnConfirm) {
            btnConfirm.innerHTML = '<i data-lucide="x-circle"></i> Ya, Batalkan & Void Pembayaran';
        }
    } else {
        if (alertEl) alertEl.style.display = 'none';
        if (btnConfirm) {
            btnConfirm.innerHTML = '<i data-lucide="x-circle"></i> Ya, Batalkan';
        }
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
    openModal('modal-cancel-invoice');
}

async function confirmCancelInvoice() {
    const id = cancelInvoiceId || document.getElementById('edit-invoice-id')?.value;
    if (!id) return;
    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/cancel`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            closeModal('modal-cancel-invoice');
            closeModal('modal-edit-invoice');
            showToast('Invoice berhasil dibatalkan. Stok telah dikembalikan.', 'success');
            notifyDataChange('invoice_cancel');
            await fetchInvoices();
            if (typeof fetchPiutang === 'function') await fetchPiutang();
            await fetchProducts();
            renderPOSProducts();
        } else {
            const err = await res.json();
            showToast('Gagal: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
    cancelInvoiceId = null;
}

let cancelPurchaseId = null;

async function confirmCancelPurchase() {
    const id = cancelPurchaseId || document.getElementById('edit-purchase-id')?.value;
    if (!id) return;
    try {
        const res = await fetch(`/api/purchases/${encodeURIComponent(id)}/cancel`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            closeModal('modal-cancel-purchase');
            closeModal('modal-edit-purchase');
            showToast('PO berhasil dibatalkan. Stok telah dikembalikan.', 'success');
            notifyDataChange('purchase_cancel');
            await fetchPurchases();
            await fetchProducts();
            if (typeof renderHutang === 'function') renderHutang();
        } else {
            const err = await res.json();
            showToast('Gagal: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
    cancelPurchaseId = null;
}

window.cancelPurchase = (id) => {
    cancelPurchaseId = id;
    const po = (Array.isArray(PURCHASES) ? PURCHASES : []).find(p => p.id === id);
    const paid = po ? (parseFloat(po.paid) || 0) : 0;
    const idInput = document.getElementById('cancel-purchase-id');
    const paidInput = document.getElementById('cancel-purchase-paid');
    const textEl = document.getElementById('cancel-purchase-text');
    const alertEl = document.getElementById('cancel-purchase-alert-paid');
    const alertText = document.getElementById('cancel-purchase-alert-paid-text');

    if (idInput) idInput.value = id;
    if (paidInput) paidInput.value = paid;
    if (textEl) textEl.innerHTML = `Apakah Anda yakin ingin membatalkan Purchase Order <strong>${id}</strong>?`;
    if (paid > 0) {
        if (alertEl) alertEl.style.display = 'block';
        if (alertText) alertText.innerHTML = `<strong>PERHATIAN:</strong> PO ini sudah memiliki riwayat cicilan/pembayaran sebesar <strong>${rp(paid)}</strong>. Membatalkan PO ini akan membatalkan seluruh catatan cicilan dan membalikkan arus kas terkait!`;
    } else {
        if (alertEl) alertEl.style.display = 'none';
    }
    openModal('modal-cancel-purchase');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.cancelPurchaseFromEdit = () => {
    const id = document.getElementById('edit-purchase-id')?.value;
    if (id) {
        window.cancelPurchase(id);
    }
};// ==========================================================================
// CASH FLOW — CRUD
// ==========================================================================

async function fetchCashTransactions(page) {
    try {
        // Full data for CASH_TRANSACTIONS global cache
        const resAll = await fetch('/api/finance/cash-flow?all=true', { headers: getAuthHeaders() });
        const dataAll = await resAll.json();
        CASH_TRANSACTIONS = Array.isArray(dataAll) ? dataAll : [];

        // Paginated fetch for table
        if (page !== undefined) paginationState.cashflow.page = page;
        const typeFilter = currentCashFlowFilter || 'all';
        const pg = paginationState.cashflow.page;
        let url = '/api/finance/cash-flow?page=' + pg + '&limit=' + PAGE_SIZE;
        if (typeFilter && typeFilter !== 'all') url += '&type=' + encodeURIComponent(typeFilter.toUpperCase());

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};
        const summary = json.summary || {};
        paginationState.cashflow.total = pag.total || 0;
        paginationState.cashflow.totalPages = pag.totalPages || 1;

        // Summary from server (full dataset)
        const summEl = document.getElementById('cashflow-summary');
        if (summEl) {
            const totalIn = parseFloat(summary.total_in || 0);
            const totalOut = parseFloat(summary.total_out || 0);
            const net = parseFloat(summary.net || 0);
            summEl.innerHTML = `
            <div class="finance-summary-card">
                <div class="fs-value" style="color: var(--emerald-500);">${rp(totalIn)}</div>
                <div class="fs-label">Total Kas Masuk</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value" style="color: var(--rose-500);">${rp(totalOut)}</div>
                <div class="fs-label">Total Kas Keluar</div>
            </div>
            <div class="finance-summary-card highlight">
                <div class="fs-value">${rp(net)}</div>
                <div class="fs-label">Saldo Bersih</div>
            </div>`;
        }

        const tbody = document.getElementById('cashflow-body');
        if (tbody) {
            tbody.innerHTML = rows.map(t => {
                const isCancelled = t.status === 'cancelled';
                const isManual = t.isManual && t.category !== 'Penyesuaian Stok';
                const rowStyle = isCancelled ? 'opacity:0.55; text-decoration: line-through;' : '';
                const actionBtns = isCancelled ? '<span class="badge-status batal" style="font-size:0.7rem;">Dibatalkan</span>' : `
                    ${isManual ? `<button class="btn-toolbar secondary" style="padding:0.2rem 0.45rem; font-size:0.72rem; margin-right:0.2rem;" title="Edit" onclick="openEditCashModal('${t.id}')"><i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i></button>` : ''}
                    <button class="btn-toolbar secondary" style="padding:0.2rem 0.45rem; font-size:0.72rem; color:var(--rose-500);" title="${isManual ? 'Hapus' : 'Void/Batal'}" onclick="cancelCashTransaction('${t.id}')"><i data-lucide="x-circle" style="width:13px;height:13px;margin:0;"></i></button>
                `;
                const runBal = (t.running_balance !== undefined && t.running_balance !== null)
                    ? '<span style=\"font-weight:600; color:' + (t.running_balance >= 0 ? 'var(--emerald-600)' : 'var(--rose-600)') + ';\">' + rp(t.running_balance) + '</span>'
                    : '-';
                return `
                <tr style="${rowStyle}">
                    <td>${t.date}</td>
                    <td style="font-weight:600;">${t.desc}</td>
                    <td><span class="badge-status ${t.category === 'Penjualan' || t.category === 'Piutang' ? 'lunas' : 'tempo'}">${t.category}</span></td>
                    <td><span class="badge-status ${t.type.toLowerCase()}">${t.type === 'IN' ? 'Masuk' : 'Keluar'}</span></td>
                    <td style="font-weight:700; color: ${t.type === 'IN' ? 'var(--emerald-500)' : 'var(--rose-500)'};">${t.type === 'IN' ? '+' : '-'}${rp(t.amount)}</td>
                    <td>${runBal}</td>
                    <td><span class="badge-status ${t.status === 'cancelled' ? 'batal' : 'lunas'}">${t.status === 'cancelled' ? 'Dibatalkan' : 'Aktif'}</span></td>
                    <td>${t.method}</td>
                    <td style="text-align:right; white-space:nowrap;">${actionBtns}</td>
                </tr>`;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-cashflow',
            currentPage: pg,
            totalItems: paginationState.cashflow.total,
            pageSize: PAGE_SIZE,
            onPageChange: (p) => fetchCashTransactions(p)
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Failed to fetch cash flow', err);
    }
}

function openAddCashModal() {
    // Reset semua field ke kosong/default
    const today = new Date().toISOString().split('T')[0];
    const typeEl = document.getElementById('add-cash-type');
    if (typeEl) typeEl.value = 'IN';
    const dateEl = document.getElementById('add-cash-date');
    if (dateEl) dateEl.value = today;
    const descEl = document.getElementById('add-cash-desc');
    if (descEl) descEl.value = '';
    const amountEl = document.getElementById('add-cash-amount');
    if (amountEl) amountEl.value = '';
    const methodEl = document.getElementById('add-cash-method');
    if (methodEl) methodEl.selectedIndex = 0;
    const catEl = document.getElementById('add-cash-category');
    if (catEl) catEl.selectedIndex = 0;
    openModal('modal-add-cash');
}

async function saveCashTransaction() {
    const type = document.getElementById('add-cash-type').value;
    const category = document.getElementById('add-cash-category').value;
    const description = document.getElementById('add-cash-desc').value;
    const amount = document.getElementById('add-cash-amount').value;
    const method = document.getElementById('add-cash-method').value;
    const date = document.getElementById('add-cash-date').value;

    if (!amount || parseFloat(amount) <= 0) {
        showToast('Jumlah wajib diisi dan harus lebih dari 0!', 'warning');
        return;
    }

    const payload = { type, category, description, amount: parseFloat(amount), method, date };

    try {
        const res = await fetch('/api/finance/cash-flow', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal('modal-add-cash');
            showToast('Transaksi kas berhasil disimpan!', 'success');
            notifyDataChange('cash');
            await fetchCashTransactions();
        } else {
            const err = await res.json();
            showToast('Error: ' + err.error, 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menyimpan transaksi kas', 'error');
    }
}

// Edit Cash Transaction - buka modal edit
function openEditCashModal(id) {
    const tx = CASH_TRANSACTIONS.find(t => t.id === id);
    if (!tx) return;
    document.getElementById('edit-cash-id').value = tx.id;
    document.getElementById('edit-cash-type').value = tx.type;
    document.getElementById('edit-cash-date').value = tx.date;
    document.getElementById('edit-cash-desc').value = tx.desc || '';
    document.getElementById('edit-cash-amount').value = tx.amount;
    document.getElementById('edit-cash-method').value = tx.method;
    document.getElementById('edit-cash-category').value = tx.category || 'Lainnya';
    openModal('modal-edit-cash');
}

async function saveCashTransactionEdit() {
    const id = document.getElementById('edit-cash-id').value;
    const payload = {
        type: document.getElementById('edit-cash-type').value,
        category: document.getElementById('edit-cash-category').value,
        description: document.getElementById('edit-cash-desc').value,
        amount: parseFloat(document.getElementById('edit-cash-amount').value),
        method: document.getElementById('edit-cash-method').value,
        date: document.getElementById('edit-cash-date').value
    };
    try {
        const res = await fetch(`/api/finance/cash-flow/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal('modal-edit-cash');
            showToast('Transaksi berhasil diperbarui!', 'success');
            await fetchCashTransactions();
        } else {
            const err = await res.json();
            showToast('Error: ' + err.error, 'error');
        }
    } catch (err) {
        showToast('Gagal memperbarui transaksi', 'error');
    }
}

async function cancelCashTransaction(id) {
    if (!confirm('Yakin ingin membatalkan transaksi ini? Untuk transaksi otomatis, pembayaran terkait akan dikembalikan.')) return;
    try {
        const res = await fetch(`/api/finance/cash-flow/${id}/cancel`, {
            method: 'PATCH',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            showToast('Transaksi berhasil dibatalkan!', 'success');
            await fetchCashTransactions();
            await fetchInvoices();
            await fetchPurchases();
        } else {
            const err = await res.json();
            showToast('Error: ' + err.error, 'error');
        }
    } catch (err) {
        showToast('Gagal membatalkan transaksi', 'error');
    }
}


// BATCH C: Dedicated Hutang Payment Modal & Logic
function openHutangPaymentModal(poId, sisa) {
    const idEl = document.getElementById('hutang-payment-po-id');
    const amtEl = document.getElementById('hutang-payment-amount');
    const dateEl = document.getElementById('hutang-payment-date');
    const maxHint = document.getElementById('hutang-payment-max-hint');
    const notesEl = document.getElementById('hutang-payment-notes');
    const infoId = document.getElementById('hutang-payment-info-id');
    const infoVendor = document.getElementById('hutang-payment-info-vendor');
    const infoTotal = document.getElementById('hutang-payment-info-total');
    const infoSisa = document.getElementById('hutang-payment-info-sisa');

    if (idEl) idEl.value = poId;
    if (amtEl) { amtEl.value = ''; amtEl.max = sisa || ''; }
    if (notesEl) notesEl.value = '';

    const todayStr = new Date().toISOString().split('T')[0];
    if (dateEl) { dateEl.value = todayStr; dateEl.max = todayStr; }
    if (maxHint) maxHint.textContent = 'Maks: ' + rp(sisa || 0) + ' (sisa hutang)';

    let po = (Array.isArray(PURCHASES) ? PURCHASES : []).find(p => p.id === poId);
    if (!po && _currentHutangPO && _currentHutangPO.id === poId) {
        po = _currentHutangPO;
    }
    if (infoId) infoId.textContent = poId;
    if (infoVendor) infoVendor.textContent = po ? (po.vendor || '-') : '-';
    if (infoTotal) infoTotal.textContent = po ? rp(po.total) : '-';
    if (infoSisa) infoSisa.textContent = rp(sisa || 0);

    openModal('modal-hutang-payment');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function fillFullHutangPayment() {
    const amtEl = document.getElementById('hutang-payment-amount');
    if (!amtEl) return;
    const max = parseFloat(amtEl.max) || 0;
    if (max > 0) { amtEl.value = max; return; }
    const sisaText = document.getElementById('hutang-payment-info-sisa')?.textContent || '';
    const numStr = sisaText.replace(/[^0-9]/g, '');
    if (numStr) amtEl.value = parseInt(numStr, 10);
}

async function submitHutangPayment() {
    const poId = document.getElementById('hutang-payment-po-id')?.value;
    const amtVal = document.getElementById('hutang-payment-amount')?.value;
    const dateVal = document.getElementById('hutang-payment-date')?.value;
    const methodVal = document.getElementById('hutang-payment-method')?.value || 'Transfer Bank';
    const notesVal = document.getElementById('hutang-payment-notes')?.value || '';

    if (!poId) { showToast('ID PO tidak ditemukan', 'warning'); return; }
    const amount = parseFloat(amtVal);
    if (!amount || amount <= 0) { showToast('Nominal pembayaran wajib diisi dan > 0', 'warning'); return; }
    if (!Number.isInteger(amount)) { showToast('Nominal pembayaran harus bilangan bulat', 'warning'); return; }
    if (!dateVal) { showToast('Tanggal pembayaran wajib diisi', 'warning'); return; }

    const todayStr = new Date().toISOString().split('T')[0];
    if (dateVal > todayStr) { showToast('Tanggal pembayaran tidak boleh di masa depan', 'warning'); return; }

    const btn = document.getElementById('btn-submit-hutang-payment');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }

    try {
        const res = await fetch(`/api/purchase-orders/${encodeURIComponent(poId)}/payments`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                amount: amount,
                payment_date: dateVal,
                payment_method: methodVal,
                notes: notesVal
            })
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-hutang-payment');
            showToast('Pembayaran hutang berhasil dicatat!', 'success');
            notifyDataChange('purchase_payment');
            await fetchPurchases();
            await fetchHutang();
            if (typeof fetchCashTransactions === 'function') await fetchCashTransactions();
            if (typeof fetchVendors === 'function') await fetchVendors();
            if (_voidPurchaseId === poId) {
                await openHutangPaymentHistoryModal(poId);
            }
        } else {
            showToast('Gagal: ' + (data.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="check"></i> Konfirmasi Pembayaran';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

// Open piutang payment modal — fills invoice info box, date, and max hint
function openPiutangPaymentModal(invoiceId, sisa) {
    const typeEl = document.getElementById('payment-type');
    const refEl = document.getElementById('payment-ref-id');
    const amtEl = document.getElementById('payment-amount');
    const dateEl = document.getElementById('payment-date');
    const maxHint = document.getElementById('payment-max-hint');
    const infoBox = document.getElementById('payment-invoice-info-box');
    const notesEl = document.getElementById('payment-notes');
    if (typeEl) typeEl.value = 'receivable';
    if (refEl) refEl.value = invoiceId;
    if (amtEl) { amtEl.value = ''; amtEl.max = sisa || ''; }
    if (notesEl) notesEl.value = '';
    const todayStr = new Date().toISOString().split('T')[0];
    if (dateEl) { dateEl.value = todayStr; dateEl.max = todayStr; }
    if (maxHint) maxHint.textContent = 'Maks: ' + rp(sisa || 0) + ' (sisa tagihan)';
    const inv = INVOICES.find(i => i.id === invoiceId);
    if (infoBox) {
        infoBox.style.display = 'block';
        const infoId = document.getElementById('payment-info-id');
        const infoCust = document.getElementById('payment-info-customer');
        const infoTotal = document.getElementById('payment-info-total');
        const infoSisa = document.getElementById('payment-info-sisa');
        if (infoId) infoId.textContent = invoiceId;
        if (infoCust) infoCust.textContent = inv ? inv.customer : '-';
        if (infoTotal) infoTotal.textContent = inv ? rp(inv.total) : '-';
        if (infoSisa) infoSisa.textContent = rp(sisa || 0);
    }
    openModal('modal-payment');
}

async function submitPayment() {
    const typeEl = document.getElementById('payment-type');
    const isReceivable = typeEl ? typeEl.value === 'receivable' : false;
    const id = document.getElementById('payment-ref-id').value;
    const amount = document.getElementById('payment-amount').value;
    const methodEl = document.getElementById('payment-method');
    const method = methodEl ? methodEl.value : 'Transfer Bank';
    const dateEl = document.getElementById('payment-date');
    const notesEl = document.getElementById('payment-notes');
    const paymentDate = dateEl ? dateEl.value : new Date().toISOString().split('T')[0];
    const notes = notesEl ? notesEl.value.trim() : '';
    if (!id) { showToast('Referensi invoice tidak ditemukan!', 'warning'); return; }
    if (!amount || parseFloat(amount) <= 0) { showToast('Jumlah pembayaran wajib diisi dan > 0!', 'warning'); return; }
    if (!paymentDate) { showToast('Tanggal pembayaran wajib diisi!', 'warning'); return; }
    const today = new Date().toISOString().split('T')[0];
    if (paymentDate > today) { showToast('Tanggal pembayaran tidak boleh di masa depan!', 'warning'); return; }
    const url = isReceivable
        ? '/api/invoices/' + encodeURIComponent(id) + '/payments'
        : '/api/finance/payables/' + encodeURIComponent(id) + '/pay';
    const body = isReceivable
        ? { amount: parseFloat(amount), payment_date: paymentDate, payment_method: method, notes }
        : { amount: parseFloat(amount), payment_type_id: method };
    let paymentSuccess = false;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (res.ok) {
            paymentSuccess = true;
            closeModal('modal-payment');
            showToast('Pembayaran berhasil dicatat!', 'success');
            notifyDataChange('payment');
        } else {
            let errMsg = 'Gagal memproses pembayaran';
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (e) {
                if (res.status === 401 || res.status === 403) errMsg = 'Akses ditolak. Hanya Admin/Finance yang bisa mencatat pembayaran.';
                else errMsg = 'Error ' + res.status + ' dari server.';
            }
            showToast('Error: ' + errMsg, 'error');
            if (res.status === 401 || res.status === 403) setTimeout(() => window.location.reload(), 1500);
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal mengirim data pembayaran ke server', 'error');
        return;
    }
    if (paymentSuccess) {
        try {
            if (isReceivable) {
                await fetchInvoices();
                renderPiutang();
            } else {
                await fetchPurchases();
                renderHutang();
            }
            await fetchCashTransactions();
            await fetchVendors();
        } catch (err) {
            console.error('Refresh data error', err);
            showToast('Pembayaran sukses, tapi gagal me-refresh tampilan tabel', 'warning');
        }
    }
}


// Fill the payment amount field with full remaining balance
function fillFullPayment() {
    const amtEl = document.getElementById('payment-amount');
    if (!amtEl) return;
    const max = parseFloat(amtEl.max) || 0;
    if (max > 0) { amtEl.value = max; return; }
    const sisaText = document.getElementById('payment-info-sisa')?.textContent || '';
    const numStr = sisaText.replace(/[^0-9]/g, '');
    if (numStr) amtEl.value = parseInt(numStr, 10);
}

// State for void/history modals
let _voidPaymentId = null;
let _voidInvoiceId = null;

// Open payment history modal and fetch cicilan list
async function openPaymentHistoryModal(invoiceId) {
    _voidInvoiceId = invoiceId;
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canVoid = role === 'admin' || role === 'finance';
    const subtitleEl = document.getElementById('hist-invoice-subtitle');
    const totalEl = document.getElementById('hist-total-display');
    const paidEl = document.getElementById('hist-paid-display');
    const sisaEl = document.getElementById('hist-sisa-display');
    const dueEl = document.getElementById('hist-due-display');
    const overdueBadgeWrap = document.getElementById('hist-overdue-badge-wrap');
    const tbody = document.getElementById('hist-payments-body');
    const footerLeft = document.getElementById('hist-footer-left');
    if (subtitleEl) subtitleEl.textContent = 'Memuat...';
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--gray-400);">Memuat data...</td></tr>';
    if (footerLeft) footerLeft.style.display = canVoid ? '' : 'none';
    openModal('modal-payment-history');
    try {
        const res = await fetch('/api/invoices/' + encodeURIComponent(invoiceId) + '/payments', { headers: getAuthHeaders() });
        if (!res.ok) {
            const err = await res.json();
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--rose-500);">' + (err.error || 'Gagal memuat data') + '</td></tr>';
            return;
        }
        const data = await res.json();
        const inv = data.invoice;
        const payments = data.payments || [];
        if (subtitleEl) subtitleEl.textContent = 'Invoice: ' + inv.id + ' — ' + inv.customer;
        if (totalEl) totalEl.textContent = rp(inv.total);
        if (paidEl) paidEl.textContent = rp(inv.paid);
        if (sisaEl) sisaEl.textContent = rp(inv.sisa);
        if (dueEl) dueEl.textContent = inv.dueDate || '-';
        if (overdueBadgeWrap) {
            overdueBadgeWrap.innerHTML = inv.isOverdue
                ? '<span class="badge-status overdue" style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;padding:2px 7px;"><i data-lucide="clock" style="width:11px;height:11px;"></i> Lewat Jatuh Tempo</span>'
                : '';
        }
        if (payments.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--gray-400);">Belum ada pembayaran tercatat.</td></tr>';
        } else if (tbody) {
            tbody.innerHTML = payments.map(p => {
                const isVoid = p.status === 'void';
                const rowStyle = isVoid ? 'opacity:0.55;' : '';
                const statusBadge = isVoid
                    ? '<span class="badge-status batal" style="font-size:0.72rem;">Void</span>'
                    : '<span class="badge-status lunas" style="font-size:0.72rem;">Aktif</span>';
                const dpBadge = p.isDownPayment ? '<span class="badge-dp" style="font-size:0.68rem;margin-left:4px;">DP</span>' : '';
                const voidBtn = (canVoid && !isVoid)
                    ? '<button class="btn-toolbar secondary" style="padding:0.2rem 0.4rem;font-size:0.72rem;color:var(--rose-600);" title="Void Pembayaran" onclick="openVoidPaymentModal(' + p.id + ',\'' + p.paymentNo + '\',' + p.amount + ',\'' + p.date + '\')"><i data-lucide="trash-2" style="width:12px;height:12px;margin:0;"></i></button>'
                    : '';
                const voidInfo = (isVoid && p.voidReason)
                    ? '<div style="font-size:0.7rem;color:var(--rose-600);margin-top:2px;">Alasan: ' + p.voidReason + '</div>'
                    : '';
                return '<tr style="' + rowStyle + '">' +
                    '<td style="font-size:0.8rem;">' + (p.paymentNo || '-') + dpBadge + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.date || '-') + '</td>' +
                    '<td style="font-weight:700;font-size:0.85rem;">' + rp(p.amount) + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.method || '-') + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.isDownPayment ? 'Down Payment' : 'Cicilan') + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.notes || '-') + '</td>' +
                    '<td>' + statusBadge + voidInfo + '</td>' +
                    '<td style="font-size:0.75rem;color:var(--gray-500);">' + (p.createdBy || '-') + '</td>' +
                    '<td style="text-align:right;">' + voidBtn + '</td>' +
                    '</tr>';
            }).join('');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Error loading payment history', err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--rose-500);">' + err.message + '</td></tr>';
    }
}

// Called from payment history modal footer button
function triggerPayFromHistory() {
    if (!_voidInvoiceId) return;
    const inv = INVOICES.find(i => i.id === _voidInvoiceId);
    const sisa = inv ? (inv.total - inv.paid) : 0;
    closeModal('modal-payment-history');
    openPiutangPaymentModal(_voidInvoiceId, sisa);
}

// Open void payment confirmation modal
function openVoidPaymentModal(paymentId, paymentNo, amount, date) {
    _voidPaymentId = paymentId;
    const noEl = document.getElementById('void-info-no');
    const amtEl = document.getElementById('void-info-amount');
    const dateEl = document.getElementById('void-info-date');
    const reasonEl = document.getElementById('void-payment-reason');
    if (noEl) noEl.textContent = paymentNo || '-';
    if (amtEl) amtEl.textContent = rp(amount || 0);
    if (dateEl) dateEl.textContent = date || '-';
    if (reasonEl) reasonEl.value = '';
    openModal('modal-void-payment');
}

// Submit void payment
async function submitVoidPayment() {
    if (!_voidPaymentId) { showToast('ID pembayaran tidak ditemukan!', 'warning'); return; }
    const reasonEl = document.getElementById('void-payment-reason');
    const reason = reasonEl ? reasonEl.value.trim() : '';
    if (!reason) { showToast('Alasan pembatalan wajib diisi!', 'warning'); return; }
    const btn = document.getElementById('btn-submit-void');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
    try {
        const res = await fetch('/api/invoices/payments/' + encodeURIComponent(_voidPaymentId) + '/void', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ void_reason: reason })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-void-payment');
            showToast('Pembayaran berhasil di-void dan posting kas dibalik.', 'success');
            notifyDataChange('payment_void');
            _voidPaymentId = null;
            await fetchInvoices();
            await fetchCashTransactions();
            if (_voidInvoiceId) await openPaymentHistoryModal(_voidInvoiceId);
        } else {
            showToast('Gagal void: ' + (data.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="trash-2"></i> Konfirmasi Void'; }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

// ==========================================================================
// BATCH C: HUTANG PAYMENT HISTORY & VOID
// ==========================================================================
async function openHutangPaymentHistoryModal(poId) {
    _voidPurchaseId = poId;
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canManage = role === 'admin' || role === 'gudang';
    const subtitleEl = document.getElementById('hist-po-subtitle');
    const totalEl = document.getElementById('hist-po-total-display');
    const paidEl = document.getElementById('hist-po-paid-display');
    const sisaEl = document.getElementById('hist-po-sisa-display');
    const dueEl = document.getElementById('hist-po-due-display');
    const overdueBadgeWrap = document.getElementById('hist-po-overdue-badge-wrap');
    const tbody = document.getElementById('hist-po-payments-body');
    const footerLeft = document.getElementById('hist-po-footer-left');

    if (subtitleEl) subtitleEl.textContent = 'Memuat...';
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--gray-400);">Memuat data...</td></tr>';
    if (footerLeft) footerLeft.style.display = canManage ? '' : 'none';

    openModal('modal-hutang-payment-history');

    try {
        const res = await fetch('/api/purchase-orders/' + encodeURIComponent(poId) + '/payments', { headers: getAuthHeaders() });
        if (!res.ok) {
            const err = await res.json();
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--rose-500);">' + (err.error || 'Gagal memuat data') + '</td></tr>';
            return;
        }
        const data = await res.json();
        const po = data.purchase;
        _currentHutangPO = po;
        const payments = data.payments || [];

        if (subtitleEl) subtitleEl.textContent = 'PO: ' + po.id + ' — ' + po.vendor;
        if (totalEl) totalEl.textContent = rp(po.total);
        if (paidEl) paidEl.textContent = rp(po.paid);
        if (sisaEl) sisaEl.textContent = rp(po.sisa);
        if (dueEl) dueEl.textContent = po.dueDate || '-';
        if (overdueBadgeWrap) {
            overdueBadgeWrap.innerHTML = po.isOverdue
                ? '<span class="badge-status overdue" style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;padding:2px 7px;"><i data-lucide="clock" style="width:11px;height:11px;"></i> Lewat Jatuh Tempo</span>'
                : '';
        }

        if (payments.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--gray-400);">Belum ada pembayaran tercatat.</td></tr>';
        } else if (tbody) {
            tbody.innerHTML = payments.map(p => {
                const isVoid = p.status === 'void';
                const rowStyle = isVoid ? 'opacity:0.55;' : '';
                const statusBadge = isVoid
                    ? '<span class="badge-status batal" style="font-size:0.72rem;">Void</span>'
                    : '<span class="badge-status lunas" style="font-size:0.72rem;">Aktif</span>';
                const dpBadge = p.isDownPayment ? '<span class="badge-dp" style="font-size:0.68rem;margin-left:4px;">DP</span>' : '';
                const voidBtn = (canManage && !isVoid)
                    ? '<button class="btn-toolbar secondary" style="padding:0.2rem 0.4rem;font-size:0.72rem;color:var(--rose-600);" title="Void Pembayaran" onclick="openVoidHutangPaymentModal(' + p.id + ',\'' + p.paymentNo + '\',' + p.amount + ',\'' + p.date + '\')"><i data-lucide="trash-2" style="width:12px;height:12px;margin:0;"></i></button>'
                    : '';
                const voidInfo = (isVoid && p.voidReason)
                    ? '<div style="font-size:0.7rem;color:var(--rose-600);margin-top:2px;">Alasan: ' + p.voidReason + '</div>'
                    : '';
                return '<tr style="' + rowStyle + '">' +
                    '<td style="font-size:0.8rem;">' + (p.paymentNo || '-') + dpBadge + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.date || '-') + '</td>' +
                    '<td style="font-weight:700;font-size:0.85rem;">' + rp(p.amount) + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.method || '-') + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.isDownPayment ? 'Down Payment' : 'Cicilan') + '</td>' +
                    '<td style="font-size:0.8rem;">' + (p.notes || '-') + '</td>' +
                    '<td>' + statusBadge + voidInfo + '</td>' +
                    '<td style="font-size:0.75rem;color:var(--gray-500);">' + (p.createdBy || '-') + '</td>' +
                    '<td style="text-align:right;">' + voidBtn + '</td>' +
                    '</tr>';
            }).join('');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Error loading hutang payment history', err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--rose-500);">' + err.message + '</td></tr>';
    }
}

function triggerPayFromHutangHistory() {
    if (!_voidPurchaseId) return;
    let sisa = 0;
    if (_currentHutangPO && _currentHutangPO.id === _voidPurchaseId) {
        sisa = _currentHutangPO.sisa || 0;
    } else {
        const po = (Array.isArray(PURCHASES) ? PURCHASES : []).find(p => p.id === _voidPurchaseId);
        sisa = po ? (po.total - po.paid) : 0;
    }
    closeModal('modal-hutang-payment-history');
    openHutangPaymentModal(_voidPurchaseId, sisa);
}

function openVoidHutangPaymentModal(paymentId, paymentNo, amount, date) {
    _voidPurchasePaymentId = paymentId;
    const noEl = document.getElementById('void-hutang-info-no');
    const amtEl = document.getElementById('void-hutang-info-amount');
    const dateEl = document.getElementById('void-hutang-info-date');
    const reasonEl = document.getElementById('void-hutang-payment-reason');
    if (noEl) noEl.textContent = paymentNo || '-';
    if (amtEl) amtEl.textContent = rp(amount || 0);
    if (dateEl) dateEl.textContent = date || '-';
    if (reasonEl) reasonEl.value = '';
    openModal('modal-void-hutang-payment');
}

async function submitVoidHutangPayment() {
    if (!_voidPurchasePaymentId) { showToast('ID pembayaran tidak ditemukan!', 'warning'); return; }
    const reasonEl = document.getElementById('void-hutang-payment-reason');
    const reason = reasonEl ? reasonEl.value.trim() : '';
    if (!reason) { showToast('Alasan pembatalan wajib diisi!', 'warning'); return; }
    const btn = document.getElementById('btn-submit-void-hutang');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
    try {
        const res = await fetch('/api/purchase-orders/payments/' + encodeURIComponent(_voidPurchasePaymentId) + '/void', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ void_reason: reason })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-void-hutang-payment');
            showToast('Pembayaran hutang berhasil di-void dan kas dibalikkan.', 'success');
            notifyDataChange('purchase_payment_void');
            _voidPurchasePaymentId = null;
            await fetchPurchases();
            await fetchHutang();
            if (typeof fetchCashTransactions === 'function') await fetchCashTransactions();
            if (_voidPurchaseId) await openHutangPaymentHistoryModal(_voidPurchaseId);
        } else {
            showToast('Gagal void: ' + (data.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="trash-2"></i> Konfirmasi Void'; }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}
// ==========================================================================
// USERS — CRUD
// ==========================================================================

async function fetchUsers() {
    try {
        const res = await fetch('/api/users', { headers: getAuthHeaders() });
        const data = await res.json();
        USERS = data;
        renderUsers();
    } catch (err) {
        console.error('Failed to fetch users', err);
    }
}

function renderUsers() {
    const tbody = document.getElementById('users-body');
    if (!tbody) return;

    tbody.innerHTML = USERS.map(u => `
        <tr>
            <td style="font-weight: 600;">${u.username}</td>
            <td>${u.name}</td>
            <td><span class="badge-status pending">${u.role}</span></td>
            <td><span class="badge-status ${u.active ? 'lunas' : 'batal'}">${u.active ? 'Aktif' : 'Nonaktif'}</span></td>
            <td>
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="openEditStaffModal('${u.id}')"><i data-lucide="edit-2" style="width:14px;height:14px;margin:0;"></i></button>
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color:var(--rose-600);" onclick="deleteStaff('${u.id}')"><i data-lucide="trash-2" style="width:14px;height:14px;margin:0;"></i></button>
            </td>
        </tr>
    `).join('');

    if (window.lucide) lucide.createIcons();
}

function openEditStaffModal(id) {
    const u = USERS.find(x => x.id == id);
    if (!u) return;
    document.getElementById('modal-add-staff').querySelector('h3').textContent = 'Edit Staff';
    document.getElementById('staff-id').value = u.id;
    document.getElementById('staff-name').value = u.name;
    document.getElementById('staff-username').value = u.username;
    document.getElementById('staff-username').disabled = true;
    const pwInp = document.getElementById('staff-password');
    if (pwInp) {
        pwInp.value = ''; // Leave empty if no change
        pwInp.type = 'password';
    }
    const hint = document.getElementById('staff-password-hint');
    if (hint) hint.textContent = 'Minimal 6 karakter. Kosongkan jika tidak ingin mengubah password saat edit.';
    document.getElementById('staff-email').value = u.email || '';
    document.getElementById('staff-role').value = u.role;
    document.getElementById('staff-status').value = u.active ? 'true' : 'false';
    openModal('modal-add-staff');
    if (window.lucide) lucide.createIcons();
}

function openAddStaffModal() {
    document.getElementById('modal-add-staff').querySelector('h3').textContent = 'Tambah Staff';
    document.getElementById('staff-id').value = '';
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-username').value = '';
    document.getElementById('staff-username').disabled = false;
    const pwInp = document.getElementById('staff-password');
    if (pwInp) {
        pwInp.value = '';
        pwInp.type = 'password';
    }
    const hint = document.getElementById('staff-password-hint');
    if (hint) hint.textContent = 'Minimal 6 karakter. Default: 123456 jika dikosongkan.';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-role').value = 'kasir';
    document.getElementById('staff-status').value = 'true';
    openModal('modal-add-staff');
    if (window.lucide) lucide.createIcons();
}

async function saveStaff() {
    const id = document.getElementById('staff-id').value;
    const isEdit = !!id;

    const payload = {
        name: document.getElementById('staff-name').value,
        username: document.getElementById('staff-username').value,
        password: document.getElementById('staff-password').value,
        email: document.getElementById('staff-email').value,
        role: document.getElementById('staff-role').value,
        active: document.getElementById('staff-status').value === 'true'
    };

    const url = isEdit ? `/api/users/${id}` : '/api/users';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal('modal-add-staff');
            showToast('Data staff berhasil disimpan!', 'success');
            await fetchUsers();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast('Error: ' + (err.error || 'Gagal menyimpan staff'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menyimpan staff', 'error');
    }
}

async function deleteStaff(id) {
    if (!confirm('Yakin ingin menghapus staff ini?')) return;
    try {
        const res = await fetch(`/api/users/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            showToast('Staff berhasil dihapus!', 'success');
            await fetchUsers();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast('Gagal menghapus: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghapus staff', 'error');
    }
}

// ---------- Change Password Modal & Toggle Handlers ----------
function togglePasswordVisibility(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const isPw = inp.type === 'password';
    inp.type = isPw ? 'text' : 'password';
    if (btn) {
        btn.innerHTML = isPw
            ? '<i data-lucide="eye-off" style="width: 16px; height: 16px;"></i>'
            : '<i data-lucide="eye" style="width: 16px; height: 16px;"></i>';
        if (window.lucide) lucide.createIcons();
    }
}

function openChangePasswordModal(e) {
    if (e) e.preventDefault();
    const oldP = document.getElementById('cp-old-password');
    const newP = document.getElementById('cp-new-password');
    const confP = document.getElementById('cp-confirm-password');
    if (oldP) { oldP.value = ''; oldP.type = 'password'; }
    if (newP) { newP.value = ''; newP.type = 'password'; }
    if (confP) { confP.value = ''; confP.type = 'password'; }

    // Reset eye toggle icons
    const modal = document.getElementById('modal-change-password');
    if (modal) {
        modal.querySelectorAll('.btn-toggle-pw').forEach(btn => {
            btn.innerHTML = '<i data-lucide="eye" style="width: 16px; height: 16px;"></i>';
        });
    }

    const errBox = document.getElementById('cp-error-msg');
    if (errBox) {
        errBox.textContent = '';
        errBox.style.display = 'none';
    }

    openModal('modal-change-password');
    if (window.lucide) lucide.createIcons();
}

async function submitChangePassword() {
    const oldPassword = (document.getElementById('cp-old-password')?.value || '');
    const newPassword = (document.getElementById('cp-new-password')?.value || '');
    const confirmPassword = (document.getElementById('cp-confirm-password')?.value || '');
    const errBox = document.getElementById('cp-error-msg');
    const submitBtn = document.getElementById('btn-submit-change-password');

    function showError(msg) {
        if (errBox) {
            errBox.textContent = msg;
            errBox.style.display = 'block';
        } else {
            showToast(msg, 'error');
        }
    }

    if (errBox) errBox.style.display = 'none';

    // Client-side validations
    if (!oldPassword || !newPassword || !confirmPassword) {
        return showError('Semua field wajib diisi');
    }
    if (newPassword.length < 8) {
        return showError('Password baru minimal 8 karakter');
    }
    if (newPassword === oldPassword) {
        return showError('Password baru tidak boleh sama dengan password lama');
    }
    if (confirmPassword !== newPassword) {
        return showError('Konfirmasi password tidak cocok');
    }

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;animation:spin 1s linear infinite;"></i> Menyimpan...';
            if (window.lucide) lucide.createIcons();
        }

        const res = await fetch('/api/auth/change-password', {
            method: 'PUT',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password_lama: oldPassword,
                password_baru: newPassword,
                konfirmasi_password: confirmPassword
            })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
            closeModal('modal-change-password');
            showToast(data.message || 'Password berhasil diubah!', 'success');
        } else {
            showError(data.error || 'Gagal mengubah password');
        }
    } catch (err) {
        console.error(err);
        showError('Gagal terhubung ke server');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="check" style="width: 16px; height: 16px;"></i> Simpan Password';
            if (window.lucide) lucide.createIcons();
        }
    }
}

// Run on DOM ready
document.addEventListener('DOMContentLoaded', init);

async function populateMasterDropdowns() {
    try {
        const fetchAndFill = async (endpoint, selectIds, valueField = 'id', labelField = 'name') => {
            const res = await fetch(endpoint, { headers: getAuthHeaders() });
            const data = await res.json();
            const optionsHtml = data.map(item => `<option value="${item[valueField]}">${item[labelField]}</option>`).join('');
            selectIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = optionsHtml;
            });
            return data; // Return data for further processing if needed
        };

        const prodCats = await fetchAndFill('/api/master/product-categories', ['add-product-category', 'edit-product-category'], 'id', 'name');
        await fetchAndFill('/api/master/product-units', ['add-product-unit', 'edit-product-unit'], 'id', 'name');
        const custCats = await fetchAndFill('/api/master/customer-categories', ['add-customer-type', 'edit-customer-type'], 'id', 'name');
        await fetchAndFill('/api/master/vendor-categories', ['add-vendor-category', 'edit-vendor-category'], 'id', 'name');
        const paymentTypes = await fetchAndFill('/api/master/payment-types', ['cart-payment-type', 'add-purchase-payment-type', 'edit-purchase-payment-type', 'edit-invoice-payment-type', 'payment-method', 'manual-invoice-payment-type', 'edit-invoice-payment-type'], 'id', 'name');
        ALL_PAYMENT_TYPES = paymentTypes || [];
        window.ALL_PAYMENT_TYPES = ALL_PAYMENT_TYPES;
        window.paymentTypes = ALL_PAYMENT_TYPES;

        // Populate Payment Type Filter in Invoices Page (Requirement 5)
        const invPayFilter = document.getElementById('invoice-payment-type-filter');
        if (invPayFilter && Array.isArray(paymentTypes)) {
            invPayFilter.innerHTML = '<option value="all">Semua Tipe</option>' + paymentTypes.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        }

        // Restore cart payment type from frontend state variable
        const cartPaymentTypeSelect = document.getElementById('cart-payment-type');
        // Initialize Tanggal Order to today (WITA) with max constraint & listeners
        const cartOrderDateEl = document.getElementById('cart-order-date');
        if (cartOrderDateEl) {
            const curToday = getTodayWITA();
            const curMax = getMaxOrderDateWITA();
            cartOrderDateEl.max = curMax;
            if (!cartOrderDateEl.value) {
                cartOrderDateEl.value = curToday;
            }
            if (!cartOrderDateEl.dataset.initialized) {
                cartOrderDateEl.dataset.initialized = 'true';
                cartOrderDateEl.addEventListener('change', () => {
                    const maxDate = getMaxOrderDateWITA();
                    cartOrderDateEl.max = maxDate;
                    if (!cartOrderDateEl.value) {
                        cartOrderDateEl.value = getTodayWITA();
                    } else if (cartOrderDateEl.value > maxDate) {
                        showToast(`Tanggal Order maksimal 7 hari ke depan (sampai ${formatMaxDateDisplay(maxDate)}).`, 'warning');
                        cartOrderDateEl.value = getTodayWITA();
                    }
                });
                cartOrderDateEl.addEventListener('blur', () => {
                    if (!cartOrderDateEl.value) {
                        cartOrderDateEl.value = getTodayWITA();
                    }
                });
            }
        }
        if (cartPaymentTypeSelect) {
            cartPaymentTypeSelect.value = selectedCartPaymentTypeId;
            console.log('[Frontend State] Restored #cart-payment-type select value to: ' + selectedCartPaymentTypeId);
        }

        // Populate Product Category Filter
        const prodCatFilter = document.getElementById('product-category-filter');
        if (prodCatFilter) {
            prodCatFilter.innerHTML = '<option value="all">Semua Kategori</option>' + prodCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        }

        // Populate POS Category Tabs
        const posCatTabs = document.getElementById('pos-category-tabs');
        if (posCatTabs) {
            posCatTabs.innerHTML = '<button class="pos-category-tab active" data-cat="all">Semua</button>' + prodCats.map(c => `<button class="pos-category-tab" data-cat="${c.name}">${c.name}</button>`).join('');
            // Bind events for pos tabs
            document.querySelectorAll('.pos-category-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.pos-category-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    renderPOSProducts(document.getElementById('pos-search').value, tab.dataset.cat);
                });
            });
        }

        // Populate Customer Category Filter
        const custTypeFilter = document.getElementById('customer-type-filter');
        if (custTypeFilter) {
            custTypeFilter.innerHTML = '<option value="all">Semua Tipe</option>' + custCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        }

        // Fetch and populate Cash Categories
        await fetchCashCategories();
    } catch (err) {
        console.error('Failed to populate master dropdowns', err);
    }
}

// ==========================================================================
// MASTER DATA — CRUD
// ==========================================================================

let currentMasterType = 'product_categories';
let masterDataToDelete = null;

const MASTER_LABELS = {
    product_categories: 'Kategori Produk',
    product_units: 'Satuan Produk',
    customer_categories: 'Kategori Pelanggan',
    vendor_categories: 'Kategori Vendor',
    payment_types: 'Tipe Pembayaran',
    cash_categories: 'Kategori Arus Kas'
};

const MASTER_API_MAP = {
    product_categories: 'product-categories',
    product_units: 'product-units',
    customer_categories: 'customer-categories',
    vendor_categories: 'vendor-categories',
    payment_types: 'payment-types',
    cash_categories: 'cash-categories'
};

async function fetchMasterData(type) {
    currentMasterType = type || currentMasterType;
    const apiKey = MASTER_API_MAP[currentMasterType];
    try {
        const res = await fetch(`/api/master/${apiKey}`, { headers: getAuthHeaders() });
        const data = await res.json();
        renderMasterTable(data);
    } catch (err) {
        console.error('fetchMasterData error:', err);
    }
}

function renderMasterTable(data) {
    const tbody = document.getElementById('master-data-body');
    const emptyState = document.getElementById('master-data-empty');
    const table = document.getElementById('master-data-table');

    if (!data || data.length === 0) {
        tbody.innerHTML = '';
        table.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }

    table.style.display = '';
    emptyState.style.display = 'none';

    const isCashCat = currentMasterType === 'cash_categories';

    const typeBadge = (type) => {
        const map = { IN: ['Kas Masuk', '#059669', '#d1fae5'], OUT: ['Kas Keluar', '#dc2626', '#fee2e2'], BOTH: ['Keduanya', '#7c3aed', '#ede9fe'] };
        const [label, color, bg] = map[type] || [type, '#6b7280', '#f3f4f6'];
        return `<span style="background:${bg};color:${color};font-size:0.7rem;font-weight:600;padding:0.15rem 0.45rem;border-radius:999px;">${label}</span>`;
    };

    const systemBadge = (is_system) => is_system
        ? `<span style="background:#dbeafe;color:#1d4ed8;font-size:0.7rem;font-weight:600;padding:0.15rem 0.45rem;border-radius:999px;">Sistem</span>`
        : '';

    tbody.innerHTML = data.map(row => {
        const encodedName = row.name.replace(/'/g, "\\'");
        const editArgs = isCashCat
            ? `'${row.id}', '${encodedName}', '${row.type}', ${!!row.is_system}`
            : `'${row.id}', '${encodedName}'`;
        const canDelete = !isCashCat || !row.is_system;
        return `
        <tr>
            <td style="font-family: monospace; color: var(--gray-500); font-size: 0.8rem;">${row.id}</td>
            <td style="font-weight: 600;">
                ${row.name}
                ${isCashCat ? typeBadge(row.type) + ' ' + systemBadge(row.is_system) : ''}
            </td>
            <td style="text-align: right;">
                <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;"
                    onclick="openEditMasterModal(${editArgs})"
                    title="Edit">
                    <i data-lucide="edit-2" style="width:14px;height:14px;margin:0;"></i>
                </button>
                ${canDelete ? `<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-600);"
                    onclick="openDeleteMasterModal('${row.id}', '${encodedName}')"
                    title="Hapus">
                    <i data-lucide="trash-2" style="width:14px;height:14px;margin:0;"></i>
                </button>` : ''}
            </td>
        </tr>
    `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function _toggleCashCatFields(show) {
    const row = document.getElementById('master-data-cashcat-row');
    const idRow = document.getElementById('master-data-id-row');
    if (row) row.style.display = show ? '' : 'none';
    if (idRow) idRow.style.display = show ? 'none' : ''; // cash_categories use serial ID
}

function openAddMasterModal() {
    const isCashCat = currentMasterType === 'cash_categories';
    document.getElementById('modal-master-data-title').textContent =
        'Tambah ' + (MASTER_LABELS[currentMasterType] || 'Data Master');
    document.getElementById('master-data-edit-id').value = '';
    document.getElementById('master-data-id').value = '';
    document.getElementById('master-data-id').disabled = false;
    document.getElementById('master-data-name').value = '';
    if (document.getElementById('master-data-cashcat-type')) {
        document.getElementById('master-data-cashcat-type').value = 'IN';
        document.getElementById('master-data-cashcat-is-system').checked = false;
    }
    _toggleCashCatFields(isCashCat);
    openModal('modal-master-data');
}

function openEditMasterModal(id, name, type, is_system) {
    const isCashCat = currentMasterType === 'cash_categories';
    document.getElementById('modal-master-data-title').textContent =
        'Edit ' + (MASTER_LABELS[currentMasterType] || 'Data Master');
    document.getElementById('master-data-edit-id').value = id;
    document.getElementById('master-data-id').value = id;
    document.getElementById('master-data-id').disabled = true;
    document.getElementById('master-data-name').value = name;
    if (isCashCat && document.getElementById('master-data-cashcat-type')) {
        document.getElementById('master-data-cashcat-type').value = type || 'BOTH';
        document.getElementById('master-data-cashcat-is-system').checked = !!is_system;
    }
    _toggleCashCatFields(isCashCat);
    openModal('modal-master-data');
}

async function saveMasterData() {
    const editId = document.getElementById('master-data-edit-id').value;
    const id = document.getElementById('master-data-id').value.trim();
    const name = document.getElementById('master-data-name').value.trim();
    const isCashCat = currentMasterType === 'cash_categories';

    if (!name) {
        alert('Nama tidak boleh kosong.');
        return;
    }

    const isEdit = !!editId;
    const url = isEdit ? `/api/master/${currentMasterType}/${editId}` : `/api/master/${currentMasterType}`;
    const method = isEdit ? 'PUT' : 'POST';

    let body;
    if (isCashCat) {
        const type = document.getElementById('master-data-cashcat-type')?.value || 'BOTH';
        const is_system = document.getElementById('master-data-cashcat-is-system')?.checked || false;
        body = { name, type, is_system };
    } else {
        body = isEdit ? { name } : { id: id || undefined, name };
    }

    try {
        const res = await fetch(url, {
            method,
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await res.json();
        if (result.success) {
            closeModal('modal-master-data');
            showToast('Master data berhasil disimpan!', 'success');
            await fetchMasterData();
            await populateMasterDropdowns(); // refresh all dropdowns after master change
        } else {
            showToast('Gagal menyimpan: ' + (result.error || 'Error tidak diketahui'), 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function openDeleteMasterModal(id, name) {
    masterDataToDelete = { id, name };
    document.getElementById('delete-master-name').textContent = name;
    openModal('modal-delete-master');
}

async function confirmDeleteMaster() {
    if (!masterDataToDelete) return;
    const { id } = masterDataToDelete;
    try {
        const res = await fetch(`/api/master/${currentMasterType}/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const result = await res.json();
        closeModal('modal-delete-master');
        if (result.success) {
            masterDataToDelete = null;
            showToast('Master data berhasil dihapus!', 'success');
            await fetchMasterData();
            await populateMasterDropdowns();
        } else {
            showToast('Gagal menghapus: ' + (result.error || 'Error tidak diketahui'), 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// Wire up master data tabs
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('#master-data-tabs .tab-filter');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentMasterType = tab.dataset.master;
            fetchMasterData(currentMasterType);
        });
    });

    // Auto-load when navigating to master-data page
    const masterNavItem = document.getElementById('nav-master-data');
    if (masterNavItem) {
        masterNavItem.addEventListener('click', () => {
            fetchMasterData(currentMasterType);
        });
    }

    // Auto-load when navigating to settings page
    const settingsNavItem = document.getElementById('nav-settings');
    if (settingsNavItem) {
        settingsNavItem.addEventListener('click', () => {
            loadPrefixSettings();
        });
    }
});

// Invoice Preferences
let currentPpnEnabled = false;
let transactionCount = 0;
let pendingPpnToggleState = true;

async function loadInvoicePreferences() {
    try {
        const resSet = await fetch('/api/settings', { headers: getAuthHeaders() });
        if (resSet.ok) {
            const settings = await resSet.json();
            currentPpnEnabled = settings.ppn_enabled === 'true' || settings.ppn_enabled === '1' || settings.ppn_enabled === true;
            currentPpnRate = parseFloat(settings.pajak_default || 11);
            
            const ppnCheck = document.getElementById('settings-ppn-enabled');
            if (ppnCheck) ppnCheck.checked = currentPpnEnabled;
            
            const ppnInput = document.getElementById('settings-ppn');
            if (ppnInput) {
                ppnInput.value = currentPpnRate;
                ppnInput.disabled = !currentPpnEnabled;
            }
        }

        try {
            const resCount = await fetch('/api/transactions/count', { headers: getAuthHeaders() });
            if (resCount.ok) {
                const countData = await resCount.json();
                transactionCount = parseInt(countData.count || 0, 10);
                console.log('Loaded transaction count for PPN toggle:', transactionCount);
            }
        } catch (_) {}
        
        // Update the cart view in POS to reflect initial PPN settings
        if (typeof renderCart === 'function') {
            renderCart();
        }
    } catch (err) {
        console.error('Failed to load invoice preferences', err);
    }
}

// --- Landing Demo Setting ---

function syncLandingToggleUI(isOn) {
    const track = document.getElementById('landing-toggle-track');
    const thumb = document.getElementById('landing-toggle-thumb');
    const checkbox = document.getElementById('settings-tampilkan-landing');
    if (!track || !thumb || !checkbox) return;
    checkbox.checked = isOn;
    track.style.background = isOn ? 'var(--blue-500, #3b82f6)' : 'var(--gray-300)';
    thumb.style.transform = isOn ? 'translateX(20px)' : 'translateX(0)';
}

async function loadLandingDemoSetting() {
    // Card hanya ditampilkan untuk admin
    const isAdmin = (localStorage.getItem('role') || '').toLowerCase() === 'admin';
    const card = document.getElementById('settings-card-landing-demo');
    if (card) card.style.display = isAdmin ? '' : 'none';
    if (!isAdmin) return;

    try {
        const res = await fetch('/api/public/landing-status');
        if (res.ok) {
            const data = await res.json();
            syncLandingToggleUI(data.tampilkan_landing_demo !== false);
        }
    } catch (err) {
        console.error('Failed to load landing demo setting', err);
    }
}

window.saveLandingDemoSetting = async function(value) {
    syncLandingToggleUI(value);
    try {
        const res = await fetch('/api/pengaturan/landing-demo', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ tampilkan_landing_demo: Boolean(value) })
        });
        if (res.ok) {
            showToast(
                value
                    ? 'Landing page demo diaktifkan.'
                    : 'Landing page demo dinonaktifkan. Pengunjung akan diarahkan ke halaman login.',
                'success'
            );
        } else {
            const err = await res.json();
            showToast('Gagal menyimpan: ' + (err.error || 'Terjadi kesalahan'), 'error');
            // revert UI on failure
            syncLandingToggleUI(!value);
            const checkbox = document.getElementById('settings-tampilkan-landing');
            if (checkbox) checkbox.checked = !value;
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
        syncLandingToggleUI(!value);
    }
};

async function saveInvoicePreferences() {
    const payload = {
        ppn_enabled: document.getElementById('settings-ppn-enabled')?.checked ? 'true' : 'false',
        pajak_default: document.getElementById('settings-ppn')?.value || '11'
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Preferensi Invoice berhasil disimpan!', 'success');
            currentPpnEnabled = payload.ppn_enabled === 'true';
            currentPpnRate = parseFloat(payload.pajak_default);
            renderCart();
            notifyDataChange('settings');
        } else {
            const err = await res.json();
            showToast('Gagal menyimpan preferensi: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Terjadi kesalahan jaringan', 'error');
    }
}

window.handlePpnToggle = function(el) {
    const isChecked = el.checked;
    console.log('PPN toggle changed to:', isChecked, 'transactionCount:', transactionCount);
    if (transactionCount > 0) {
        el.checked = !isChecked; // revert temporarily
        pendingPpnToggleState = isChecked;
        openModal('modal-confirm-ppn');
    } else {
        document.getElementById('settings-ppn').disabled = !isChecked;
    }
};

window.confirmPpnToggle = function() {
    const ppnCheck = document.getElementById('settings-ppn-enabled');
    const ppnInput = document.getElementById('settings-ppn');
    if (ppnCheck) ppnCheck.checked = pendingPpnToggleState;
    if (ppnInput) ppnInput.disabled = !pendingPpnToggleState;
    closeModal('modal-confirm-ppn');
};

window.cancelPpnToggle = function() {
    closeModal('modal-confirm-ppn');
};

document.getElementById('btn-save-invoice-prefs')?.addEventListener('click', saveInvoicePreferences);

// Prefix Settings Functions
async function loadPrefixSettings() {
    try {
        const res = await fetch('/api/settings', { headers: getAuthHeaders() });
        if (res.ok) {
            const settings = await res.json();
            const productEl = document.getElementById('settings-prefix-product');
            const customerEl = document.getElementById('settings-prefix-customer');
            const vendorEl = document.getElementById('settings-prefix-vendor');
            const cashTxEl = document.getElementById('settings-prefix-cash-tx');
            const purchaseEl = document.getElementById('settings-prefix-purchase');
            const salesEl = document.getElementById('settings-prefix-sales');
            const pricelistEl = document.getElementById('settings-prefix-pricelist');

            if (productEl) productEl.value = settings.prefix_product ?? 'P';
            if (customerEl) customerEl.value = settings.prefix_customer ?? 'C';
            if (vendorEl) vendorEl.value = settings.prefix_vendor ?? 'V';
            if (cashTxEl) cashTxEl.value = settings.prefix_cash_transaction ?? 'CT';
            if (purchaseEl) purchaseEl.value = settings.prefix_purchase ?? 'PO/{YYYY}/{MM}/';
            if (salesEl) salesEl.value = settings.prefix_sales ?? 'INV/{YYYY}/{MM}/';
            if (pricelistEl) pricelistEl.value = settings.prefix_pricelist ?? 'PL';
        }
    } catch (err) {
        console.error('Failed to load prefix settings', err);
    }
}

async function savePrefixSettings() {
    const payload = {
        prefix_product: document.getElementById('settings-prefix-product')?.value || 'P',
        prefix_customer: document.getElementById('settings-prefix-customer')?.value || 'C',
        prefix_vendor: document.getElementById('settings-prefix-vendor')?.value || 'V',
        prefix_cash_transaction: document.getElementById('settings-prefix-cash-tx')?.value || 'CT',
        prefix_purchase: document.getElementById('settings-prefix-purchase')?.value || 'PO/{YYYY}/{MM}/',
        prefix_sales: document.getElementById('settings-prefix-sales')?.value || 'INV/{YYYY}/{MM}/',
        prefix_pricelist: document.getElementById('settings-prefix-pricelist')?.value || 'PL'
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Pengaturan prefix penomoran berhasil disimpan!', 'success');
            await loadPrefixSettings();
        } else {
            const err = await res.json();
            showToast('Gagal menyimpan prefix: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
}

// Make functions globally accessible
window.savePrefixSettings = savePrefixSettings;

async function saveManualInvoice() {
    const payload = {
        id: document.getElementById('manual-invoice-id').value,
        customer_id: document.getElementById('manual-invoice-customer').value,
        date: document.getElementById('manual-invoice-date').value,
        due_date: document.getElementById('manual-invoice-duedate').value,
        total: parseFloat(document.getElementById('manual-invoice-total').value) || 0,
        payment_type_id: document.getElementById('manual-invoice-payment-type').value
    };

    if (!payload.id || !payload.customer_id || !payload.total) {
        alert('Mohon isi No Invoice, Customer, dan Total Transaksi.');
        return;
    }

    try {
        const res = await fetch('/api/invoices/manual', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('modal-manual-invoice');
            showToast('Invoice outstanding berhasil dicatat', 'success');
            document.getElementById('manual-invoice-id').value = '';
            document.getElementById('manual-invoice-total').value = '';
            document.getElementById('manual-invoice-customer').value = '';
            document.getElementById('manual-invoice-customer-search').value = '';
            const dropdown = document.getElementById('manual-invoice-customer-dropdown');
            if (dropdown) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
            }
            await fetchInvoices();
            if (typeof fetchPiutang === 'function') await fetchPiutang();
        } else {
            const err = await res.json();
            alert('Gagal: ' + err.error);
        }
    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan jaringan.');
    }
}
window.saveManualInvoice = saveManualInvoice;

let CASH_CATEGORIES = [];

async function fetchCashCategories() {
    try {
        const res = await fetch('/api/cash-categories', { headers: getAuthHeaders() });
        if (res.ok) {
            CASH_CATEGORIES = await res.json();
            onCashTypeChange('add');
            onCashTypeChange('edit');
        }
    } catch (err) {
        console.error('Failed to fetch cash categories', err);
    }
}

window.onCashTypeChange = (prefix) => {
    const typeEl = document.getElementById(`${prefix}-cash-type`);
    const catEl = document.getElementById(`${prefix}-cash-category`);
    if (!typeEl || !catEl) return;

    const selectedType = typeEl.value;
    const filteredCats = CASH_CATEGORIES.filter(c => c.type === selectedType || c.type === 'BOTH');

    catEl.innerHTML = filteredCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
};

function populateManualInvoiceCustomerSelect(filter = '') {
    const dropdown = document.getElementById('manual-invoice-customer-dropdown');
    if (!dropdown) return;

    let filtered = CUSTOMERS;
    if (filter) {
        const q = filter.toLowerCase();
        filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || (c.city && c.city.toLowerCase().includes(q)));
    }

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 0.75rem; color: var(--gray-400); text-align: center; font-size: 0.875rem;">Customer tidak ditemukan</div>';
        return;
    }

    dropdown.innerHTML = filtered.map(c => `
        <div class="manual-invoice-customer-dropdown-item" data-id="${c.id}" data-name="${c.name}" style="padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--gray-100); display: flex; flex-direction: column; transition: background-color 0.2s;">
            <span style="font-weight: 500; font-size: 0.875rem;">${c.name} — ${c.city || ''}</span>
        </div>
    `).join('');

    dropdown.querySelectorAll('.manual-invoice-customer-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            document.getElementById('manual-invoice-customer-search').value = name;
            document.getElementById('manual-invoice-customer').value = id;
            dropdown.style.display = 'none';

            // Set default payment type pelanggan untuk invoice manual
            const cust = (CUSTOMERS || []).find(c => String(c.id) === String(id));
            let targetPtId = null;
            if (cust && (cust.tipe_pembayaran_id || cust.payment_type_id || cust.tipePembayaranId)) {
                targetPtId = cust.tipe_pembayaran_id || cust.payment_type_id || cust.tipePembayaranId;
            } else {
                const types = Array.isArray(ALL_PAYMENT_TYPES) ? ALL_PAYMENT_TYPES : [];
                const found30 = types.find(p => (p.name || '').trim().toLowerCase() === 'kredit 30 hari')
                    || types.find(p => (p.name || '').toLowerCase().includes('kredit 30'))
                    || types.find(p => (p.name || '').toLowerCase().startsWith('kredit'));
                if (found30) targetPtId = found30.id;
            }
            const miPaySelect = document.getElementById('manual-invoice-payment-type');
            if (miPaySelect && targetPtId) {
                miPaySelect.value = targetPtId;
                miPaySelect.dispatchEvent(new Event('change'));
            }
        });

        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = 'var(--gray-50)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = 'transparent';
        });
    });
}

// Manual Invoice Customer Search bindings
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('manual-invoice-customer-search');
    const hiddenInput = document.getElementById('manual-invoice-customer');
    const dropdown = document.getElementById('manual-invoice-customer-dropdown');

    if (searchInput && hiddenInput && dropdown) {
        searchInput.addEventListener('focus', () => {
            populateManualInvoiceCustomerSelect(searchInput.value);
            dropdown.style.display = 'block';
        });

        searchInput.addEventListener('input', (e) => {
            populateManualInvoiceCustomerSelect(e.target.value);
            dropdown.style.display = 'block';
            hiddenInput.value = ''; // Reset actual selection
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#modal-manual-invoice .customer-search-wrapper')) {
                dropdown.style.display = 'none';
            }
        });
    }
});

// ==========================================================================
// EXCEL IMPORT & EXPORT SYSTEM (PRD2 Master Data Update)
// ==========================================================================
let currentImportSection = null;
let selectedImportFile = null;

const sectionTitles = {
    'produk': 'Produk',
    'pelanggan': 'Pelanggan',
    'vendor': 'Vendor',
    'pembelian': 'Pembelian',
    'invoice': 'Invoice',
    'hutang': 'Hutang Outstanding'
};

function openImportModal(section) {
    if (section === 'invoice') {
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        if (role !== 'admin' && role !== 'finance') {
            showToast('Akses ditolak: Hanya role Administrator dan Finance yang dapat mengimpor invoice outstanding.', 'error');
            return;
        }
    } else if (section === 'hutang') {
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        if (role !== 'admin' && role !== 'gudang') {
            showToast('Akses ditolak: Hanya role Administrator dan Gudang yang dapat mengimpor hutang outstanding.', 'error');
            return;
        }
    }
    currentImportSection = section;
    selectedImportFile = null;
    parsedInvoiceImportData = null;
    parsedHutangImportData = null;

    // Set Title
    const titleEl = document.getElementById('import-modal-title');
    if (titleEl) {
        titleEl.innerText = section === 'invoice' ? 'Import Invoice Outstanding' : (section === 'hutang' ? 'Import Hutang Outstanding' : `Import Data ${sectionTitles[section] || section}`);
    }

    // Reset Dropzone & Input
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.value = '';

    // Reset Modal States
    document.getElementById('import-state-initial').style.display = 'block';
    const previewEl = document.getElementById('import-state-preview');
    if (previewEl) previewEl.style.display = 'none';
    document.getElementById('import-state-progress').style.display = 'none';
    document.getElementById('import-state-result').style.display = 'none';

    // Show normal footer buttons
    const footer = document.getElementById('import-modal-footer');
    footer.style.display = 'flex';
    footer.innerHTML = `
        <button class="btn-toolbar secondary" id="import-btn-cancel" onclick="closeImportModal()">Batal</button>
        <button class="btn-toolbar primary" id="import-btn-submit" onclick="startImportProcess()"
            style="opacity:0.5;cursor:not-allowed;pointer-events:none;">
            <i data-lucide="upload"></i> ${(section === 'invoice' || section === 'hutang') ? 'Periksa & Preview Data' : 'Proses Import'}
        </button>
    `;

    setImportFile(null);

    // Show modal
    openModal('modal-import-unified');
}

function closeImportModal() {
    closeModal('modal-import-unified');
    currentImportSection = null;
    selectedImportFile = null;
}

function handleImportDrop(e) {
    e.preventDefault();
    const dropzone = document.getElementById('import-dropzone');
    if (dropzone) {
        dropzone.style.borderColor = '#CBD5E1';
        dropzone.style.background = 'var(--gray-50)';
    }
    if (e.dataTransfer.files.length > 0) {
        setImportFile(e.dataTransfer.files[0]);
    }
}

function handleImportFileSelect(input) {
    if (input.files.length > 0) {
        setImportFile(input.files[0]);
    }
}

function setImportFile(file) {
    selectedImportFile = file;
    const contentDiv = document.getElementById('import-dropzone-content');
    const btnSubmit = document.getElementById('import-btn-submit');

    if (!file) {
        if (contentDiv) {
            contentDiv.innerHTML = `
                <i data-lucide="upload-cloud" style="width:36px;height:36px;color:var(--gray-400);margin-bottom:0.75rem;"></i>
                <p style="font-weight:600;color:var(--gray-700);margin-bottom:0.25rem;">Pilih File untuk Diimpor</p>
                <p style="font-size:0.75rem;color:var(--gray-500);">Klik atau seret file .xlsx ke sini</p>
            `;
        }
        if (btnSubmit) {
            btnSubmit.style.opacity = '0.5';
            btnSubmit.style.cursor = 'not-allowed';
            btnSubmit.style.pointerEvents = 'none';
            btnSubmit.innerHTML = `<i data-lucide="upload"></i> ${(currentImportSection === 'invoice' || currentImportSection === 'hutang') ? 'Periksa & Preview Data' : 'Proses Import'}`;
        }
    } else {
        if (contentDiv) {
            contentDiv.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;font-weight:600;color:var(--gray-800);">
                    <span>📄 ${file.name}</span>
                    <button onclick="event.stopPropagation(); setImportFile(null);" style="background:transparent;border:none;color:var(--rose-500);font-size:1.2rem;cursor:pointer;font-weight:bold;padding:0 0.25rem;">&times;</button>
                </div>
            `;
        }
        if (btnSubmit) {
            btnSubmit.style.opacity = '1';
            btnSubmit.style.cursor = 'pointer';
            btnSubmit.style.pointerEvents = 'auto';
            btnSubmit.innerHTML = `<i data-lucide="upload"></i> ${(currentImportSection === 'invoice' || currentImportSection === 'hutang') ? 'Periksa & Preview Data' : 'Proses Import'}`;
        }
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function downloadImportTemplate() {
    let headers = [];
    let rows = [];
    let filename = "";

    if (currentImportSection === 'produk') {
        headers = ["SKU", "Nama Produk", "Brand/Merk", "Kategori", "Harga Beli", "Harga Jual", "Stok", "Stok Minimum", "Satuan"];
        rows = [
            ["MNM-001", "Kopi Arabica 250g", "", "Minuman", 45000, 68000, 100, 20, "pcs"],
            ["MKN-001", "Mie Instan (dus)", "Indomie", "Makanan", 92000, 115000, 50, 10, "dus"]
        ];
        filename = "sample_produk.xlsx";
    } else if (currentImportSection === 'pelanggan') {
        headers = ["Nama", "Tipe", "Telepon", "Kota", "Alamat", "Limit Piutang", "Tipe Pembayaran"];
        rows = [
            ["Toko Berkah Jaya", "Reseller", "089696469991", "Kota Denpasar", "Jl. Sunia Negara No. 33", 10000000, "Kredit 30 Hari"],
            ["Warung Sari Rasa", "Warung", "085936103383", "Denpasar", "Jl. Sunia Negara No. 33 Pemogan", 2000000, "Tunai"]
        ];
        filename = "sample_pelanggan.xlsx";
    } else if (currentImportSection === 'vendor') {
        headers = ["Nama", "Kategori", "Telepon", "Kota", "Alamat", "No. Identitas", "Bank", "No. Rekening", "Pemilik Rekening"];
        rows = [
            ["PT Sumber Minuman Nusantara", "Minuman", "089696469991", "Kota Denpasar", "Jl. Sunia Negara No. 33", "3171011234567890", "BCA", "1234567890", "PT Sumber Minuman Nusantara"],
            ["CV Pangan Makmur", "Sembako", "03177789012", "Gianyar", "Jl. Cokroaminoto Gg. Pucuk Sari 9", "3578022345678901", "Mandiri", "0987654321", "CV Pangan Makmur"]
        ];
        filename = "sample_vendor.xlsx";
    } else if (currentImportSection === 'pembelian') {
        headers = ["Tanggal", "Nama Vendor", "Total", "Terbayar", "Tipe Pembayaran", "Jatuh Tempo"];
        rows = [
            ["2026-06-12", "PT Sumber Minuman Nusantara", 225000, 225000, "Tunai", "2026-06-12"],
            ["2026-06-12", "CV Pangan Makmur", 500000, 500000, "Tempo", "2026-06-30"]
        ];
        filename = "sample_pembelian.xlsx";
    } else if (currentImportSection === 'invoice') {
        const headers = [
            "No. Invoice",
            "Tanggal",
            "Nama Customer",
            "Total",
            "Total Dibayar",
            "Tanggal Pembayaran Terakhir",
            "Sisa Tagihan",
            "Tipe Pembayaran",
            "Jatuh Tempo"
        ];
        const rows = [
            ["INV-2026-05-00101", "2026-05-10", "Toko Berkah Jaya", 5000000, 2000000, "2026-05-15", 3000000, "Kredit 30 Hari", "2026-06-09"],
            ["INV-2026-05-00102", "2026-05-12", "Warung Sari Rasa", 1500000, 0, "", 1500000, "Kredit 14 Hari", "2026-05-26"]
        ];
        filename = "Template_Import_Invoice_Outstanding.xlsx";

        const wb = XLSX.utils.book_new();
        const wsTemplate = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        XLSX.utils.book_append_sheet(wb, wsTemplate, "Template");

        const guideData = [
            ["PANDUAN PENGISIAN TEMPLATE IMPORT INVOICE OUTSTANDING"],
            [""],
            ["Kolom", "Status", "Keterangan & Aturan Format"],
            ["No. Invoice", "Opsional", "Nomor invoice dari sistem lama (contoh: INV-2026-05-00101). Kosongkan jika ingin nomor di-generate otomatis oleh sistem."],
            ["Tanggal", "Wajib", "Tanggal pembuatan invoice. Format: YYYY-MM-DD (contoh: 2026-05-10)."],
            ["Nama Customer", "Wajib", "Nama pelanggan yang sudah terdaftar di Master Data Pelanggan."],
            ["Total", "Wajib", "Total tagihan invoice. Format angka murni tanpa titik/koma ribuan (contoh: 5000000)."],
            ["Total Dibayar", "Opsional", "Jumlah yang sudah dicicil/dibayar sebelum migrasi. Boleh 0 atau kosong. Tidak boleh sama atau lebih besar dari Total."],
            ["Tanggal Pembayaran Terakhir", "Opsional", "Tanggal pembayaran saldo awal. Kosongkan jika sama dengan tanggal invoice. Format: YYYY-MM-DD."],
            ["Sisa Tagihan", "Informasi", "Hanya sebagai referensi/pembanding visual di template. Sistem selalu menghitung ulang: Total - Total Dibayar."],
            ["Tipe Pembayaran", "Opsional", "Pilihan tipe kredit: Kredit 1 Hari, Kredit 7 Hari, Kredit 14 Hari, Kredit 30 Hari. Default: Kredit 30 Hari."],
            ["Jatuh Tempo", "Opsional", "Tanggal jatuh tempo tagihan. Format: YYYY-MM-DD. Kosongkan jika ingin dihitung otomatis dari tipe kredit."]
        ];
        const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
        XLSX.utils.book_append_sheet(wb, wsGuide, "Petunjuk Pengisian");

        XLSX.writeFile(wb, filename);
        return;
    } else if (currentImportSection === 'hutang') {
        const headers = [
            "No. PO",
            "Tanggal",
            "Nama Vendor",
            "Total",
            "Total Dibayar",
            "Tanggal Pembayaran Terakhir",
            "Sisa Hutang",
            "Tipe Pembayaran",
            "Jatuh Tempo"
        ];
        const rows = [
            ["PO-2026-05-00101", "2026-05-10", "PT Sumber Minuman Nusantara", 5000000, 2000000, "2026-05-15", 3000000, "Tempo 30 Hari", "2026-06-09"],
            ["PO-2026-05-00102", "2026-05-12", "CV Pangan Makmur", 1500000, 0, "", 1500000, "Tempo 14 Hari", "2026-05-26"]
        ];
        filename = "Template_Import_Hutang_Outstanding.xlsx";

        const wb = XLSX.utils.book_new();
        const wsTemplate = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        XLSX.utils.book_append_sheet(wb, wsTemplate, "Template");

        const guideData = [
            ["PANDUAN PENGISIAN TEMPLATE IMPORT HUTANG OUTSTANDING"],
            [""],
            ["Kolom", "Status", "Keterangan & Aturan Format"],
            ["No. PO", "Opsional", "Nomor PO dari sistem lama (contoh: PO-2026-05-00101). Kosongkan jika ingin nomor di-generate otomatis oleh sistem."],
            ["Tanggal", "Wajib", "Tanggal pembuatan PO. Format: YYYY-MM-DD (contoh: 2026-05-10)."],
            ["Nama Vendor", "Wajib", "Nama vendor yang sudah terdaftar di Master Data Vendor."],
            ["Total", "Wajib", "Total tagihan PO. Format angka murni tanpa titik/koma ribuan (contoh: 5000000)."],
            ["Total Dibayar", "Opsional", "Jumlah yang sudah dicicil/dibayar sebelum migrasi. Boleh 0 atau kosong. Tidak boleh sama atau lebih besar dari Total."],
            ["Tanggal Pembayaran Terakhir", "Opsional", "Tanggal pembayaran saldo awal. Kosongkan jika sama dengan tanggal PO. Format: YYYY-MM-DD."],
            ["Sisa Hutang", "Informasi", "Hanya sebagai referensi/pembanding visual di template. Sistem selalu menghitung ulang: Total - Total Dibayar."],
            ["Tipe Pembayaran", "Opsional", "Pilihan tipe tempo: Tempo 7 Hari, Tempo 14 Hari, Tempo 30 Hari. Default: Tempo 30 Hari."],
            ["Jatuh Tempo", "Opsional", "Tanggal jatuh tempo tagihan. Format: YYYY-MM-DD. Kosongkan jika ingin dihitung otomatis dari tipe tempo."]
        ];
        const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
        XLSX.utils.book_append_sheet(wb, wsGuide, "Petunjuk Pengisian");

        XLSX.writeFile(wb, filename);
        return;
    }

    const data = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, filename);
}

function parseExcelDate(val) {
    if (!val) return '';
    if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    if (typeof val === 'number') {
        const jsDate = new Date(Math.round((val - 25569) * 86400 * 1000));
        const y = jsDate.getUTCFullYear();
        const m = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(jsDate.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.substring(0, 10);
    }
    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
        return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    return str;
}

let parsedInvoiceImportData = null;

function resetImportToInitial() {
    parsedInvoiceImportData = null;
    parsedHutangImportData = null;
    const initialEl = document.getElementById('import-state-initial');
    const previewEl = document.getElementById('import-state-preview');
    const progressEl = document.getElementById('import-state-progress');
    const resultEl = document.getElementById('import-state-result');
    if (initialEl) initialEl.style.display = 'block';
    if (previewEl) previewEl.style.display = 'none';
    if (progressEl) progressEl.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';

    const footer = document.getElementById('import-modal-footer');
    if (footer) {
        footer.style.display = 'flex';
        footer.innerHTML = `
            <button class="btn-toolbar secondary" id="import-btn-cancel" onclick="closeImportModal()">Batal</button>
            <button class="btn-toolbar primary" id="import-btn-submit" onclick="startImportProcess()"
                style="opacity:0.5;cursor:not-allowed;pointer-events:none;">
                <i data-lucide="upload"></i> ${(currentImportSection === 'invoice' || currentImportSection === 'hutang') ? 'Periksa & Preview Data' : 'Proses Import'}
            </button>
        `;
    }
    setImportFile(null);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function previewInvoiceImport(rows, fileName) {
    if (!rows || rows.length === 0) {
        showToast('File Excel tidak berisi data.', 'warning');
        return;
    }

    // Fetch master customers and existing invoices to check uniqueness
    let customersList = [];
    let existingInvoicesList = [];
    try {
        const [custRes, invRes] = await Promise.all([
            fetch('/api/customers', { headers: getAuthHeaders() }),
            fetch('/api/invoices', { headers: getAuthHeaders() })
        ]);
        customersList = await custRes.json();
        existingInvoicesList = await invRes.json();
    } catch (err) {
        console.error('Failed fetching master data for preview:', err);
    }

    const custMap = {};
    customersList.forEach(c => {
        custMap[c.name.toLowerCase().trim()] = c;
        custMap[c.id.toLowerCase().trim()] = c;
    });

    const existingInvIds = new Set(existingInvoicesList.map(i => String(i.id).toLowerCase().trim()));

    const validRows = [];
    const errorRows = [];
    const seenBatchIds = new Set();
    const todayStr = new Date().toISOString().split('T')[0];

    rows.forEach((row, idx) => {
        const rowNum = idx + 2; // header is row 1
        const noInvoice = String(row['No. Invoice'] || row['No Invoice'] || row['Nomor Invoice'] || row['no_invoice'] || row['id'] || '').trim();
        const rawDate = row['Tanggal'] || row['date'] || row['tanggal'] || '';
        const date = parseExcelDate(rawDate) || todayStr;
        const custName = String(row['Nama Customer'] || row['Customer'] || row['Pelanggan'] || row['Nama Pelanggan'] || row['customer'] || '').trim();
        const rawTotal = row['Total'] || row['total'] || row['Total Invoice'] || row['Nilai'] || 0;
        const total = parseFloat(rawTotal) || 0;
        const rawPaid = row['Total Dibayar'] ?? row['total_dibayar'] ?? row['Terbayar'] ?? row['terbayar'] ?? row['Dibayar'] ?? 0;
        const totalDibayar = parseFloat(rawPaid) || 0;
        const rawLastPay = row['Tanggal Pembayaran Terakhir'] || row['tanggal_pembayaran_terakhir'] || row['Tgl Bayar'] || '';
        const lastPaymentDate = parseExcelDate(rawLastPay) || date;
        const ptName = String(row['Tipe Pembayaran'] || row['tipe_pembayaran'] || 'Kredit 30 Hari').trim();
        const rawDue = row['Jatuh Tempo'] || row['jatuh_tempo'] || row['Due Date'] || row['due_date'] || '';
        const dueDate = parseExcelDate(rawDue);

        // Validation 1: Customer
        if (!custName) {
            errorRows.push(`Baris ${rowNum}: Nama customer kosong.`);
            return;
        }
        const matchedCust = custMap[custName.toLowerCase()];
        if (!matchedCust) {
            errorRows.push(`Baris ${rowNum}: Customer "${custName}" tidak terdaftar di sistem.`);
            return;
        }

        // Validation 2: Total
        if (total <= 0) {
            errorRows.push(`Baris ${rowNum}: Total tagihan (${rp(total)}) harus lebih besar dari 0.`);
            return;
        }

        // Validation 3: Total Dibayar < 0
        if (totalDibayar < 0) {
            errorRows.push(`Baris ${rowNum}: Total dibayar tidak boleh negatif.`);
            return;
        }

        // Validation 4: Total Dibayar == Total (Bukan outstanding)
        if (totalDibayar === total) {
            errorRows.push(`Baris ${rowNum}: Total dibayar sama dengan total tagihan (${rp(total)}). Ini bukan outstanding karena sudah lunas.`);
            return;
        }

        // Validation 5: Overpayment (Total Dibayar > Total)
        if (totalDibayar > total) {
            errorRows.push(`Baris ${rowNum}: Total dibayar (${rp(totalDibayar)}) melebihi total tagihan (${rp(total)}). Aturan cicilan: overpayment tidak diizinkan.`);
            return;
        }

        // Validation 6: Future payment date
        if (totalDibayar > 0 && lastPaymentDate > todayStr) {
            errorRows.push(`Baris ${rowNum}: Tanggal pembayaran terakhir (${lastPaymentDate}) tidak boleh di masa depan.`);
            return;
        }

        // Validation 7: Duplicate Invoice No
        if (noInvoice) {
            if (seenBatchIds.has(noInvoice.toLowerCase())) {
                errorRows.push(`Baris ${rowNum}: Nomor invoice "${noInvoice}" duplikat di dalam file ini.`);
                return;
            }
            if (existingInvIds.has(noInvoice.toLowerCase())) {
                errorRows.push(`Baris ${rowNum}: Nomor invoice "${noInvoice}" sudah ada di database.`);
                return;
            }
            seenBatchIds.add(noInvoice.toLowerCase());
        }

        const sisa = Math.max(0, total - totalDibayar);

        validRows.push({
            row_number: rowNum,
            id: noInvoice || null,
            date: date,
            customer_id: matchedCust.id,
            customer_name: matchedCust.name,
            total: total,
            total_dibayar: totalDibayar,
            sisa: sisa,
            last_payment_date: lastPaymentDate,
            payment_type: ptName,
            due_date: dueDate || null
        });
    });

    parsedInvoiceImportData = {
        validRows,
        errorRows,
        fileName
    };

    const totalTagihan = validRows.reduce((sum, r) => sum + r.total, 0);
    const totalTerbayar = validRows.reduce((sum, r) => sum + r.total_dibayar, 0);
    const totalSisa = validRows.reduce((sum, r) => sum + r.sisa, 0);

    // Switch to preview state
    document.getElementById('import-state-initial').style.display = 'none';
    document.getElementById('import-state-preview').style.display = 'block';
    document.getElementById('import-state-progress').style.display = 'none';
    document.getElementById('import-state-result').style.display = 'none';

    document.getElementById('import-preview-filename').textContent = `📄 ${fileName} (${rows.length} total baris)`;
    document.getElementById('import-summary-count').textContent = `${validRows.length} Invoice`;
    document.getElementById('import-summary-total').textContent = rp(totalTagihan);
    document.getElementById('import-summary-paid').textContent = rp(totalTerbayar);
    document.getElementById('import-summary-sisa').textContent = rp(totalSisa);

    // Error box
    const errBox = document.getElementById('import-preview-errors-box');
    const errList = document.getElementById('import-preview-errors-list');
    const errCount = document.getElementById('import-preview-errors-count');
    if (errorRows.length > 0) {
        errBox.style.display = 'block';
        errCount.textContent = `${errorRows.length} Baris Bermasalah (Ditolak):`;
        errList.innerHTML = errorRows.map(e => `<div>• ${e}</div>`).join('');
    } else {
        errBox.style.display = 'none';
    }

    // Preview Table
    const tbody = document.getElementById('import-preview-table-body');
    if (validRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--rose-500);font-weight:600;">Tidak ada baris data yang valid untuk diimpor. Silakan perbaiki file Excel Anda.</td></tr>`;
    } else {
        tbody.innerHTML = validRows.map(r => `
            <tr style="border-bottom:1px solid var(--gray-100);">
                <td style="padding:0.35rem 0.5rem;font-weight:600;color:var(--gray-700);">${r.id || '<em style="color:var(--gray-400);">(Auto)</em>'}</td>
                <td style="padding:0.35rem 0.5rem;">${r.customer_name}</td>
                <td style="padding:0.35rem 0.5rem;color:var(--gray-600);">${r.date}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;font-weight:600;">${rp(r.total)}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;color:var(--emerald-600);">${rp(r.total_dibayar)}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;color:var(--amber-600);font-weight:600;">${rp(r.sisa)}</td>
                <td style="padding:0.35rem 0.5rem;color:var(--gray-600);">${r.due_date || '-'}</td>
            </tr>
        `).join('');
    }

    // Update Footer
    const footer = document.getElementById('import-modal-footer');
    footer.style.display = 'flex';
    footer.innerHTML = `
        <button class="btn-toolbar secondary" onclick="resetImportToInitial()">Ganti File</button>
        <button class="btn-toolbar primary" id="import-btn-confirm" onclick="commitInvoiceImport()"
            ${validRows.length === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
            <i data-lucide="check"></i> Konfirmasi & Simpan (${validRows.length} Invoice)
        </button>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function commitInvoiceImport() {
    if (!parsedInvoiceImportData || !parsedInvoiceImportData.validRows || parsedInvoiceImportData.validRows.length === 0) {
        showToast('Tidak ada data valid untuk diimpor', 'warning');
        return;
    }

    const validRows = parsedInvoiceImportData.validRows;

    // Switch to progress
    document.getElementById('import-state-initial').style.display = 'none';
    document.getElementById('import-state-preview').style.display = 'none';
    document.getElementById('import-state-progress').style.display = 'block';
    document.getElementById('import-state-result').style.display = 'none';
    document.getElementById('import-modal-footer').style.display = 'none';
    document.getElementById('import-progress-text').innerText = `Menyimpan ${validRows.length} invoice outstanding secara transaksional...`;

    try {
        const res = await fetch('/api/invoices/import-outstanding', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ invoices: validRows })
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await res.text();
            throw new Error(`Server mengembalikan respons tidak valid (HTTP ${res.status}). Coba import dengan jumlah baris lebih sedikit. Detail: ${text.substring(0, 200)}`);
        }
        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error || 'Gagal menyimpan import invoice');
        }

        // Show Result
        document.getElementById('import-state-progress').style.display = 'none';
        document.getElementById('import-state-result').style.display = 'block';
        document.getElementById('import-result-success').innerText = `Berhasil mengimpor: ${result.count} invoice outstanding.`;
        document.getElementById('import-result-failed').innerText = parsedInvoiceImportData.errorRows.length > 0 ? `Dilewati (Error): ${parsedInvoiceImportData.errorRows.length} baris.` : '';

        const errList = document.getElementById('import-error-list');
        if (errList) {
            errList.innerHTML = parsedInvoiceImportData.errorRows.map(f => `<div style="margin-bottom:0.25rem;">${f}</div>`).join('');
        }

        const footer = document.getElementById('import-modal-footer');
        footer.style.display = 'flex';
        footer.innerHTML = `
            <button class="btn-toolbar primary" onclick="closeImportAndRefresh()">Tutup & Perbarui Tampilan</button>
        `;

        showToast(`${result.count} invoice outstanding berhasil diimpor!`, 'success');
    } catch (err) {
        console.error('Import commit error:', err);
        showImportError(`Gagal memproses import (Transaksi dibatalkan/Rollback): ${err.message}`);
    }
}

async function previewHutangImport(rows, fileName) {
    if (!rows || rows.length === 0) {
        showToast('File Excel tidak berisi data.', 'warning');
        return;
    }

    let vendorsList = [];
    let existingPurchasesList = [];
    try {
        const [vRes, pRes] = await Promise.all([
            fetch('/api/vendors', { headers: getAuthHeaders() }),
            fetch('/api/purchases?all=true', { headers: getAuthHeaders() })
        ]);
        vendorsList = await vRes.json();
        existingPurchasesList = await pRes.json();
    } catch (err) {
        console.error('Failed fetching master data for preview:', err);
    }

    const vendorMap = {};
    (Array.isArray(vendorsList) ? vendorsList : []).forEach(v => {
        vendorMap[v.name.toLowerCase().trim()] = v;
        vendorMap[v.id.toLowerCase().trim()] = v;
    });

    const existingPoIds = new Set((Array.isArray(existingPurchasesList) ? existingPurchasesList : []).map(p => String(p.id).toLowerCase().trim()));

    const validRows = [];
    const errorRows = [];
    const seenBatchIds = new Set();
    const todayStr = new Date().toISOString().split('T')[0];

    rows.forEach((row, idx) => {
        const rowNum = idx + 2;
        const noPO = String(row['No. PO'] || row['No PO'] || row['Nomor PO'] || row['no_po'] || row['id'] || '').trim();
        const rawDate = row['Tanggal'] || row['date'] || row['tanggal'] || '';
        const date = parseExcelDate(rawDate) || todayStr;
        const vendorName = String(row['Nama Vendor'] || row['Vendor'] || row['Supplier'] || row['Nama Supplier'] || row['vendor'] || '').trim();
        const rawTotal = row['Total'] || row['total'] || row['Total PO'] || row['Nilai'] || 0;
        const total = parseFloat(rawTotal) || 0;
        const rawPaid = row['Total Dibayar'] ?? row['total_dibayar'] ?? row['Terbayar'] ?? row['terbayar'] ?? row['Dibayar'] ?? 0;
        const totalDibayar = parseFloat(rawPaid) || 0;
        const rawLastPay = row['Tanggal Pembayaran Terakhir'] || row['tanggal_pembayaran_terakhir'] || row['Tgl Bayar'] || '';
        const lastPaymentDate = parseExcelDate(rawLastPay) || date;
        const ptName = String(row['Tipe Pembayaran'] || row['tipe_pembayaran'] || 'Tempo 30 Hari').trim();
        const rawDue = row['Jatuh Tempo'] || row['jatuh_tempo'] || row['Due Date'] || row['due_date'] || '';
        const dueDate = parseExcelDate(rawDue);

        if (!vendorName) {
            errorRows.push(`Baris ${rowNum}: Nama vendor kosong.`);
            return;
        }
        const matchedVendor = vendorMap[vendorName.toLowerCase()];
        if (!matchedVendor) {
            errorRows.push(`Baris ${rowNum}: Vendor "${vendorName}" tidak terdaftar di sistem.`);
            return;
        }

        if (total <= 0) {
            errorRows.push(`Baris ${rowNum}: Total tagihan (${rp(total)}) harus lebih besar dari 0.`);
            return;
        }

        if (totalDibayar < 0) {
            errorRows.push(`Baris ${rowNum}: Total dibayar tidak boleh negatif.`);
            return;
        }

        if (totalDibayar === total) {
            errorRows.push(`Baris ${rowNum}: Total dibayar sama dengan total tagihan (${rp(total)}). Ini bukan outstanding karena sudah lunas.`);
            return;
        }

        if (totalDibayar > total) {
            errorRows.push(`Baris ${rowNum}: Total dibayar (${rp(totalDibayar)}) melebihi total tagihan (${rp(total)}). Aturan cicilan: overpayment tidak diizinkan.`);
            return;
        }

        if (totalDibayar > 0 && lastPaymentDate > todayStr) {
            errorRows.push(`Baris ${rowNum}: Tanggal pembayaran terakhir (${lastPaymentDate}) tidak boleh di masa depan.`);
            return;
        }

        if (noPO) {
            if (seenBatchIds.has(noPO.toLowerCase())) {
                errorRows.push(`Baris ${rowNum}: Nomor PO "${noPO}" duplikat di dalam file ini.`);
                return;
            }
            if (existingPoIds.has(noPO.toLowerCase())) {
                errorRows.push(`Baris ${rowNum}: Nomor PO "${noPO}" sudah ada di database.`);
                return;
            }
            seenBatchIds.add(noPO.toLowerCase());
        }

        const sisa = Math.max(0, total - totalDibayar);

        validRows.push({
            row_number: rowNum,
            id: noPO || null,
            date: date,
            vendor_id: matchedVendor.id,
            vendor_name: matchedVendor.name,
            total: total,
            total_dibayar: totalDibayar,
            sisa: sisa,
            last_payment_date: lastPaymentDate,
            payment_type: ptName,
            due_date: dueDate || null
        });
    });

    parsedHutangImportData = {
        validRows,
        errorRows,
        fileName
    };

    const totalTagihan = validRows.reduce((sum, r) => sum + r.total, 0);
    const totalTerbayar = validRows.reduce((sum, r) => sum + r.total_dibayar, 0);
    const totalSisa = validRows.reduce((sum, r) => sum + r.sisa, 0);

    document.getElementById('import-state-initial').style.display = 'none';
    document.getElementById('import-state-preview').style.display = 'block';
    document.getElementById('import-state-progress').style.display = 'none';
    document.getElementById('import-state-result').style.display = 'none';

    document.getElementById('import-preview-filename').textContent = `📄 ${fileName} (${rows.length} total baris)`;
    document.getElementById('import-summary-count').textContent = `${validRows.length} Hutang PO`;
    document.getElementById('import-summary-total').textContent = rp(totalTagihan);
    document.getElementById('import-summary-paid').textContent = rp(totalTerbayar);
    document.getElementById('import-summary-sisa').textContent = rp(totalSisa);

    const errBox = document.getElementById('import-preview-errors-box');
    const errList = document.getElementById('import-preview-errors-list');
    const errCount = document.getElementById('import-preview-errors-count');
    if (errorRows.length > 0) {
        errBox.style.display = 'block';
        errCount.textContent = `${errorRows.length} Baris Bermasalah (Ditolak):`;
        errList.innerHTML = errorRows.map(e => `<div>• ${e}</div>`).join('');
    } else {
        errBox.style.display = 'none';
    }

    const tbody = document.getElementById('import-preview-table-body');
    if (validRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--rose-500);font-weight:600;">Tidak ada baris data yang valid untuk diimpor. Silakan perbaiki file Excel Anda.</td></tr>`;
    } else {
        tbody.innerHTML = validRows.map(r => `
            <tr style="border-bottom:1px solid var(--gray-100);">
                <td style="padding:0.35rem 0.5rem;font-weight:600;color:var(--gray-700);">${r.id || '<em style="color:var(--gray-400);">(Auto)</em>'}</td>
                <td style="padding:0.35rem 0.5rem;">${r.vendor_name}</td>
                <td style="padding:0.35rem 0.5rem;color:var(--gray-600);">${r.date}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;font-weight:600;">${rp(r.total)}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;color:var(--emerald-600);">${rp(r.total_dibayar)}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;color:var(--amber-600);font-weight:600;">${rp(r.sisa)}</td>
                <td style="padding:0.35rem 0.5rem;color:var(--gray-600);">${r.due_date || '-'}</td>
            </tr>
        `).join('');
    }

    const footer = document.getElementById('import-modal-footer');
    footer.style.display = 'flex';
    footer.innerHTML = `
        <button class="btn-toolbar secondary" onclick="resetImportToInitial()">Ganti File</button>
        <button class="btn-toolbar primary" id="import-btn-confirm" onclick="commitHutangImport()"
            ${validRows.length === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
            <i data-lucide="check"></i> Konfirmasi & Simpan (${validRows.length} Hutang)
        </button>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function commitHutangImport() {
    if (!parsedHutangImportData || !parsedHutangImportData.validRows || parsedHutangImportData.validRows.length === 0) {
        showToast('Tidak ada data valid untuk diimpor', 'warning');
        return;
    }

    const validRows = parsedHutangImportData.validRows;

    document.getElementById('import-state-initial').style.display = 'none';
    document.getElementById('import-state-preview').style.display = 'none';
    document.getElementById('import-state-progress').style.display = 'block';
    document.getElementById('import-state-result').style.display = 'none';
    document.getElementById('import-modal-footer').style.display = 'none';
    document.getElementById('import-progress-text').innerText = `Menyimpan ${validRows.length} hutang outstanding secara transaksional...`;

    try {
        const res = await fetch('/api/purchase-orders/import-outstanding', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ purchase_orders: validRows })
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await res.text();
            throw new Error(`Server mengembalikan respons tidak valid (HTTP ${res.status}). Coba import dengan baris lebih sedikit. Detail: ${text.substring(0, 200)}`);
        }
        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error || 'Gagal menyimpan import hutang');
        }

        document.getElementById('import-state-progress').style.display = 'none';
        document.getElementById('import-state-result').style.display = 'block';
        document.getElementById('import-result-success').innerText = `Berhasil mengimpor: ${result.count} hutang outstanding.`;
        document.getElementById('import-result-failed').innerText = parsedHutangImportData.errorRows.length > 0 ? `Dilewati (Error): ${parsedHutangImportData.errorRows.length} baris.` : '';

        const errList = document.getElementById('import-error-list');
        if (errList) {
            errList.innerHTML = parsedHutangImportData.errorRows.map(f => `<div style="margin-bottom:0.25rem;">${f}</div>`).join('');
        }

        const footer = document.getElementById('import-modal-footer');
        footer.style.display = 'flex';
        footer.innerHTML = `
            <button class="btn-toolbar primary" onclick="closeImportAndRefresh()">Tutup & Perbarui Tampilan</button>
        `;

        showToast(`${result.count} hutang outstanding berhasil diimpor!`, 'success');
    } catch (err) {
        console.error('Import commit error:', err);
        showImportError(`Gagal memproses import (Transaksi dibatalkan/Rollback): ${err.message}`);
    }
}

function startImportProcess() {
    if (!selectedImportFile) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet);

            if (currentImportSection === 'invoice') {
                await previewInvoiceImport(rows, selectedImportFile.name);
            } else if (currentImportSection === 'hutang') {
                await previewHutangImport(rows, selectedImportFile.name);
            } else {
                await executeImport(rows);
            }
        } catch (err) {
            showImportError("Gagal membaca file Excel: " + err.message);
        }
    };
    reader.readAsArrayBuffer(selectedImportFile);
}

async function executeImport(rows) {
    let successCount = 0;
    let failedRows = [];

    // Switch states
    document.getElementById('import-state-initial').style.display = 'none';
    document.getElementById('import-state-progress').style.display = 'block';
    document.getElementById('import-state-result').style.display = 'none';
    document.getElementById('import-modal-footer').style.display = 'none';

    try {
        let categoriesMap = {};
        let unitsMap = {};
        let paymentTypesMap = {};
        let vendorsMap = {};
        let customersMap = {};

        // Fetch required master data once before looping
        if (currentImportSection === 'produk') {
            const [catsRes, unitsRes] = await Promise.all([
                fetch('/api/master/product-categories', { headers: getAuthHeaders() }),
                fetch('/api/master/product-units', { headers: getAuthHeaders() })
            ]);
            const cats = await catsRes.json();
            const units = await unitsRes.json();
            cats.forEach(c => categoriesMap[c.name.toLowerCase().trim()] = c.id);
            units.forEach(u => unitsMap[u.name.toLowerCase().trim()] = u.id);
        } else if (currentImportSection === 'pelanggan') {
            const [catsRes, ptsRes] = await Promise.all([
                fetch('/api/master/customer-categories', { headers: getAuthHeaders() }),
                fetch('/api/master/payment-types', { headers: getAuthHeaders() })
            ]);
            const cats = await catsRes.json();
            const pts = await ptsRes.json();
            cats.forEach(c => categoriesMap[c.name.toLowerCase().trim()] = c.id);
            pts.forEach(p => paymentTypesMap[p.name.toLowerCase().trim()] = p.id);
        } else if (currentImportSection === 'vendor') {
            const catsRes = await fetch('/api/master/vendor-categories', { headers: getAuthHeaders() });
            const cats = await catsRes.json();
            cats.forEach(c => categoriesMap[c.name.toLowerCase().trim()] = c.id);
        } else if (currentImportSection === 'pembelian') {
            const [ptRes, vendorsRes] = await Promise.all([
                fetch('/api/master/payment-types', { headers: getAuthHeaders() }),
                fetch('/api/vendors', { headers: getAuthHeaders() })
            ]);
            const pts = await ptRes.json();
            const vends = await vendorsRes.json();
            pts.forEach(p => paymentTypesMap[p.name.toLowerCase().trim()] = p.id);
            vends.forEach(v => vendorsMap[v.name.toLowerCase().trim()] = v.id);
        } else if (currentImportSection === 'invoice') {
            const [ptRes, customersRes] = await Promise.all([
                fetch('/api/master/payment-types', { headers: getAuthHeaders() }),
                fetch('/api/customers', { headers: getAuthHeaders() })
            ]);
            const pts = await ptRes.json();
            const custs = await customersRes.json();
            pts.forEach(p => paymentTypesMap[p.name.toLowerCase().trim()] = p.id);
            custs.forEach(c => customersMap[c.name.toLowerCase().trim()] = c.id);
        }

        const totalRows = rows.length;

        for (let i = 0; i < totalRows; i++) {
            document.getElementById('import-progress-text').innerText = `Mengimpor data... (${i + 1}/${totalRows} baris)`;
            const row = rows[i];
            const rowNum = i + 2;

            try {
                if (currentImportSection === 'produk') {
                    const sku = row['SKU'] ? String(row['SKU']).trim() : '';
                    const name = row['Nama Produk'] || '';
                    const brand = row['Brand/Merk'] !== undefined ? String(row['Brand/Merk']).trim() : '';
                    const catName = row['Kategori'] || '';
                    const cost = parseFloat(row['Harga Beli']) || 0;
                    const price = parseFloat(row['Harga Jual']) || 0;
                    const stock = parseFloat(row['Stok']) || 0;
                    const minStock = parseFloat(row['Stok Minimum']) || 0;
                    const unitName = row['Satuan'] || '';

                    if (!name) throw new Error("Nama produk kosong");
                    if (brand.length > 255) throw new Error("Brand/Merk maksimal 255 karakter");

                    // Dynamic Category Creation
                    let category_id = categoriesMap[catName.toLowerCase().trim()];
                    if (!category_id && catName) {
                        const addCatRes = await fetch('/api/master/product-categories', {
                            method: 'POST',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({ name: catName })
                        });
                        if (addCatRes.ok) {
                            const newCat = await addCatRes.json();
                            category_id = newCat.id;
                            categoriesMap[catName.toLowerCase().trim()] = category_id;
                        }
                    }

                    // Dynamic Unit Creation
                    let unit_id = unitsMap[unitName.toLowerCase().trim()];
                    if (!unit_id && unitName) {
                        const addUnitRes = await fetch('/api/master/product-units', {
                            method: 'POST',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({ name: unitName })
                        });
                        if (addUnitRes.ok) {
                            const newUnit = await addUnitRes.json();
                            unit_id = newUnit.id;
                            unitsMap[unitName.toLowerCase().trim()] = unit_id;
                        }
                    }

                    const existingProd = sku ? PRODUCTS.find(p => p.sku === sku) : null;
                    const method = existingProd ? 'PUT' : 'POST';
                    const endpoint = existingProd ? `/api/products/${existingProd.id}` : '/api/products';

                    const payload = {
                        sku, brand, name, category_id, cost_price: cost, sell_price: price, stock, min_stock: minStock, unit_id
                    };

                    const postRes = await fetch(endpoint, {
                        method: method,
                        headers: getAuthHeaders(),
                        body: JSON.stringify(payload)
                    });
                    if (!postRes.ok) {
                        const err = await postRes.json();
                        throw new Error(err.error || (existingProd ? "Gagal memperbarui produk" : "Gagal menyimpan produk"));
                    }

                } else if (currentImportSection === 'pelanggan') {
                    const name = row['Nama'] || '';
                    const catName = row['Tipe'] || '';
                    const phone = row['Telepon'] || '';
                    const city = row['Kota'] || '';
                    const address = row['Alamat'] || '';
                    const limit = parseFloat(row['Limit Piutang']) || 0;
                    const ptRaw = row['Tipe Pembayaran'] || row['tipe_pembayaran'] || row['Payment Type'] || '';
                    let tipe_pembayaran_id = null;
                    if (ptRaw && typeof ptRaw === 'string') {
                        tipe_pembayaran_id = paymentTypesMap[ptRaw.toLowerCase().trim()] || null;
                    }

                    if (!name) throw new Error("Nama pelanggan kosong");

                    // Dynamic Category Creation
                    let customer_category_id = categoriesMap[catName.toLowerCase().trim()];
                    if (!customer_category_id && catName) {
                        const addCatRes = await fetch('/api/master/customer-categories', {
                            method: 'POST',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({ name: catName })
                        });
                        if (addCatRes.ok) {
                            const newCat = await addCatRes.json();
                            customer_category_id = newCat.id;
                            categoriesMap[catName.toLowerCase().trim()] = customer_category_id;
                        }
                    }

                    const postRes = await fetch('/api/customers', {
                        method: 'POST',
                        headers: getAuthHeaders(),
                        body: JSON.stringify({
                            name, customer_category_id, tipe_pembayaran_id, phone, city, address, credit_lmt: limit
                        })
                    });
                    if (!postRes.ok) {
                        const err = await postRes.json();
                        throw new Error(err.error || "Gagal menyimpan pelanggan");
                    }

                } else if (currentImportSection === 'vendor') {
                    const name = row['Nama'] || '';
                    const catName = row['Kategori'] || '';
                    const phone = row['Telepon'] || '';
                    const city = row['Kota'] || '';
                    const address = row['Alamat'] || '';
                    const idNum = row['No. Identitas'] || '';
                    const bank = row['Bank'] || '';
                    const rekening = row['No. Rekening'] || '';
                    const pemilik = row['Pemilik Rekening'] || '';

                    if (!name) throw new Error("Nama vendor kosong");

                    // Dynamic Category Creation
                    let vendor_category_id = categoriesMap[catName.toLowerCase().trim()];
                    if (!vendor_category_id && catName) {
                        const addCatRes = await fetch('/api/master/vendor-categories', {
                            method: 'POST',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({ name: catName })
                        });
                        if (addCatRes.ok) {
                            const newCat = await addCatRes.json();
                            vendor_category_id = newCat.id;
                            categoriesMap[catName.toLowerCase().trim()] = vendor_category_id;
                        }
                    }

                    const postRes = await fetch('/api/vendors', {
                        method: 'POST',
                        headers: getAuthHeaders(),
                        body: JSON.stringify({
                            name, vendor_category_id, phone, city, address, id_number: idNum, nama_bank: bank, nomor_rek: rekening, pemilik_rek: pemilik
                        })
                    });
                    if (!postRes.ok) {
                        const err = await postRes.json();
                        throw new Error(err.error || "Gagal menyimpan vendor");
                    }

                } else if (currentImportSection === 'pembelian') {
                    const dateVal = row['Tanggal'] || '';
                    const vendorName = row['Nama Vendor'] || '';
                    const total = parseFloat(row['Total']) || 0;
                    const paid = parseFloat(row['Terbayar']) || 0;
                    const ptName = row['Tipe Pembayaran'] || '';
                    const dueDateVal = row['Jatuh Tempo'] || '';

                    if (!vendorName) throw new Error("Nama vendor kosong");

                    const vendor_id = vendorsMap[vendorName.toLowerCase().trim()];
                    if (!vendor_id) throw new Error(`Vendor "${vendorName}" tidak ditemukan`);

                    const payment_type_id = paymentTypesMap[ptName.toLowerCase().trim()] || 'PT-1';

                    const postRes = await fetch('/api/purchases', {
                        method: 'POST',
                        headers: getAuthHeaders(),
                        body: JSON.stringify({
                            vendor_id, date: dateVal, total, paid, payment_type_id, due_date: dueDateVal, items: []
                        })
                    });
                    if (!postRes.ok) {
                        const err = await postRes.json();
                        throw new Error(err.error || "Gagal menyimpan pembelian");
                    }

                } else if (currentImportSection === 'invoice') {
                    const dateVal = row['Tanggal'] || '';
                    const customerName = row['Nama Customer'] || '';
                    const total = parseFloat(row['Total']) || 0;
                    const paid = parseFloat(row['Terbayar']) || 0;
                    const ptName = row['Tipe Pembayaran'] || '';
                    const dueDateVal = row['Jatuh Tempo'] || '';

                    if (!customerName) throw new Error("Nama customer kosong");

                    const customer_id = customersMap[customerName.toLowerCase().trim()];
                    if (!customer_id) throw new Error(`Customer "${customerName}" tidak ditemukan`);

                    const payment_type_id = paymentTypesMap[ptName.toLowerCase().trim()] || 'PT-1';

                    const postRes = await fetch('/api/invoices', {
                        method: 'POST',
                        headers: getAuthHeaders(),
                        body: JSON.stringify({
                            customer_id, date: dateVal, total, paid, payment_type_id, due_date: dueDateVal, items: [], is_import: true
                        })
                    });
                    if (!postRes.ok) {
                        const err = await postRes.json();
                        throw new Error(err.error || "Gagal menyimpan invoice");
                    }
                }

                successCount++;
            } catch (rowErr) {
                console.error(`Error on row ${rowNum}:`, rowErr);
                failedRows.push(`Baris ${rowNum}: ${rowErr.message}`);
            }
        }

        // Show Result State
        document.getElementById('import-state-progress').style.display = 'none';
        document.getElementById('import-state-result').style.display = 'block';

        document.getElementById('import-result-success').innerText = `Berhasil: ${successCount} baris`;
        document.getElementById('import-result-failed').innerText = `Gagal: ${failedRows.length} baris`;

        const errList = document.getElementById('import-error-list');
        if (errList) {
            errList.innerHTML = failedRows.map(f => `<div style="margin-bottom:0.25rem;">${f}</div>`).join('');
        }

        // Show Tutup button
        const footer = document.getElementById('import-modal-footer');
        footer.style.display = 'flex';
        footer.innerHTML = `
            <button class="btn-toolbar primary" onclick="closeImportAndRefresh()">Tutup</button>
        `;

    } catch (globalErr) {
        console.error('Global import error:', globalErr);
        const footer = document.getElementById('import-modal-footer');
        footer.style.display = 'flex';
        footer.innerHTML = `
            <button class="btn-toolbar secondary" id="import-btn-cancel" onclick="closeImportModal()">Batal</button>
            <button class="btn-toolbar primary" id="import-btn-submit" onclick="startImportProcess()">Proses Import</button>
        `;
        showImportError("Gagal memproses import data: " + globalErr.message);
    }
}

function showImportError(msg) {
    document.getElementById('import-state-progress').style.display = 'none';
    document.getElementById('import-state-result').style.display = 'block';
    document.getElementById('import-result-success').innerText = '';
    document.getElementById('import-result-failed').innerText = 'Kesalahan Fatal';
    const errList = document.getElementById('import-error-list');
    if (errList) errList.innerText = msg;
}

async function closeImportAndRefresh() {
    closeImportModal();
    // Refresh table data
    if (currentImportSection === 'produk') {
        await fetchProducts();
        if (typeof renderPOSProducts === 'function') renderPOSProducts();
    } else if (currentImportSection === 'pelanggan') {
        await fetchCustomers();
    } else if (currentImportSection === 'vendor') {
        await fetchVendors();
    } else if (currentImportSection === 'pembelian') {
        await fetchPurchases();
        if (typeof renderHutang === 'function') renderHutang();
    } else if (currentImportSection === 'invoice') {
        if (typeof fetchInvoices === 'function') await fetchInvoices();
        if (typeof fetchPiutang === 'function') await fetchPiutang();
        if (typeof fetchDashboardSummary === 'function') await fetchDashboardSummary();
    } else if (currentImportSection === 'hutang') {
        if (typeof fetchPurchases === 'function') await fetchPurchases();
        if (typeof fetchHutang === 'function') await fetchHutang();
        if (typeof fetchDashboardSummary === 'function') await fetchDashboardSummary();
    }
}

async function exportSection(section) {
    // Export selalu pakai all=true untuk data lengkap (bukan hanya halaman aktif)
    let headers = [];
    let rows = [];
    let filename = "";

    try {
        if (section === 'produk') {
            const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
            const canSeeHpp = role === 'admin' || role === 'owner' || role === 'gudang';
            if (canSeeHpp) {
                headers = ["SKU", "Nama Produk", "Brand/Merk", "Kategori", "Harga Beli", "Harga Jual", "Stok", "Stok Minimum", "Satuan"];
                rows = PRODUCTS.map(p => [p.sku||'', p.name||'', p.brand||'', p.category||'', p.cost||0, p.price||0, p.stock||0, p.minStock||0, p.unit||'']);
            } else {
                headers = ["SKU", "Nama Produk", "Brand/Merk", "Kategori", "Harga Jual", "Stok", "Stok Minimum", "Satuan"];
                rows = PRODUCTS.map(p => [p.sku||'', p.name||'', p.brand||'', p.category||'', p.price||0, p.stock||0, p.minStock||0, p.unit||'']);
            }
            filename = "export_produk.xlsx";
        } else if (section === 'pelanggan') {
            headers = ["Nama", "Tipe", "Telepon", "Kota", "Alamat", "Limit Piutang"];
            rows = CUSTOMERS.map(c => [c.name||'', c.type||'', c.phone||'', c.city||'', c.address||'', c.creditLimit||0]);
            filename = "export_pelanggan.xlsx";
        } else if (section === 'vendor') {
            headers = ["Nama", "Kategori", "Telepon", "Kota", "Alamat", "No. Identitas", "Bank", "No. Rekening", "Pemilik Rekening"];
            rows = VENDORS.map(v => [v.name||'', v.category||'', v.phone||'', v.city||'', v.address||'', v.idNumber||'', v.bank||'', v.rekening||'', v.pemilik||'']);
            filename = "export_vendor.xlsx";
        } else if (section === 'pembelian') {
            const res = await fetch('/api/purchases?all=true', { headers: getAuthHeaders() });
            const data = await res.json();
            headers = ["Tanggal", "Nama Vendor", "Total", "Terbayar", "Tipe Pembayaran", "Jatuh Tempo"];
            rows = (Array.isArray(data) ? data : []).map(p => [p.date||'', p.vendor||'', p.total||0, p.paid||0, p.type||'', p.dueDate||'']);
            filename = "export_pembelian.xlsx";
        } else if (section === 'invoice') {
            const res = await fetch('/api/invoices?all=true', { headers: getAuthHeaders() });
            const data = await res.json();
            headers = ["Tanggal", "Nama Customer", "Total", "Terbayar", "Tipe Pembayaran", "Jatuh Tempo"];
            rows = (Array.isArray(data) ? data : []).map(i => [i.date||'', i.customer||'', i.total||0, i.paid||0, i.type||'', i.dueDate||'']);
            filename = "export_invoice.xlsx";
        }
    } catch (err) {
        console.error('Export failed', err);
        showToast('Gagal export data', 'error');
        return;
    }

    const data = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, filename);
}

// Bind to window for global accessibility
window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.handleImportDrop = handleImportDrop;
window.handleImportFileSelect = handleImportFileSelect;
window.setImportFile = setImportFile;
window.downloadImportTemplate = downloadImportTemplate;
window.startImportProcess = startImportProcess;
window.closeImportAndRefresh = closeImportAndRefresh;
window.resetImportToInitial = resetImportToInitial;
window.commitInvoiceImport = commitInvoiceImport;
window.exportSection = exportSection;

// ---------- Company Settings & Print Invoice ----------
function previewCompanyLogo(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('settings-company-logo-preview').src = e.target.result;
            document.getElementById('settings-company-logo-preview').style.display = 'block';
            document.getElementById('settings-company-logo-base64').value = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function loadCompanyProfile() {
    try {
        const res = await fetch('/api/settings', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Failed to load settings');
        const data = await res.json();

        if (data.company_name) document.getElementById('settings-company-name').value = data.company_name;
        if (data.company_phone) document.getElementById('settings-company-phone').value = data.company_phone;
        if (data.company_email) document.getElementById('settings-company-email').value = data.company_email;
        if (data.company_address) document.getElementById('settings-company-address').value = data.company_address;

        if (data.company_logo) {
            document.getElementById('settings-company-logo-preview').src = data.company_logo;
            document.getElementById('settings-company-logo-preview').style.display = 'block';
            document.getElementById('settings-company-logo-base64').value = data.company_logo;
        } else {
            document.getElementById('settings-company-logo-preview').style.display = 'none';
            document.getElementById('settings-company-logo-base64').value = '';
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal memuat profil bisnis', 'error');
    }
}

async function saveCompanyProfile(e) {
    if (e) e.preventDefault();
    const payload = {
        company_name: document.getElementById('settings-company-name').value,
        company_phone: document.getElementById('settings-company-phone').value,
        company_email: document.getElementById('settings-company-email').value,
        company_address: document.getElementById('settings-company-address').value,
        company_logo: document.getElementById('settings-company-logo-base64').value
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to save settings');
        showToast('Profil bisnis berhasil disimpan', 'success');
        if (typeof loadCompanyProfile === 'function') await loadCompanyProfile();
    } catch (err) {
        console.error(err);
        showToast('Gagal menyimpan profil bisnis', 'error');
    }
}

// Opens invoice print preview in a new tab.
// Must be called synchronously in a click handler to avoid popup blocker.
function printInvoice(id) {
    window.open(`/invoice-print.html?id=${encodeURIComponent(id)}`, '_blank', 'noopener');
}

function closePrintInvoiceView() {
    document.getElementById('print-invoice-view').style.display = 'none';
    document.body.style.overflow = 'auto';
}

window.printNewlyCreatedInvoice = function() {
    const printBtn = document.getElementById('btn-print-new-invoice');
    if (printBtn && printBtn.dataset.invoiceId) {
        // Open in new tab synchronously (must be in click handler to avoid popup blocker).
        // Modal stays open so user can still click "Selesai".
        window.open(`/invoice-print.html?id=${encodeURIComponent(printBtn.dataset.invoiceId)}`, '_blank', 'noopener');
    }
};

// ---------- Customer Fee Report (Admin Only) ----------
async function renderCustomerFeeReport() {
    const startInput = document.getElementById('customerfee-start-date');
    const endInput = document.getElementById('customerfee-end-date');

    if (!startInput || !endInput) return;

    const startDate = startInput.value;
    const endDate = endInput.value;

    if (!startDate || !endDate) {
        showToast('Pilih rentang tanggal terlebih dahulu.', 'error');
        return;
    }

    if (startDate > endDate) {
        showToast('Tanggal awal tidak boleh lebih besar dari tanggal akhir.', 'error');
        return;
    }

    const summaryEl = document.getElementById('customerfee-summary');
    const bodyBulan = document.getElementById('customerfee-body-bulan');
    const bodyProduk = document.getElementById('customerfee-body-produk');

    if (summaryEl) summaryEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--gray-400);">Memuat...</div>';
    if (bodyBulan) bodyBulan.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:var(--gray-400);">Memuat...</td></tr>';
    if (bodyProduk) bodyProduk.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:var(--gray-400);">Memuat...</td></tr>';

    try {
        const res = await fetch(
            `/api/reports/customer-fee?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
            { headers: getAuthHeaders() }
        );
        const json = await res.json();

        if (!json.success) throw new Error(json.error || 'Gagal memuat laporan fee customer');

        const d = json.data;

        // --- Summary Card ---
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem;">
                    <div style="background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1px solid #fcd34d;border-radius:0.75rem;padding:1.25rem;display:flex;flex-direction:column;gap:0.25rem;">
                        <div style="font-size:0.75rem;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:0.3rem;">🔒 Total Beban Fee Customer</div>
                        <div style="font-size:1.75rem;font-weight:800;color:#78350f;">${rp(d.total_fee)}</div>
                        <div style="font-size:0.8rem;color:#a16207;">${startDate} — ${endDate}</div>
                    </div>
                    <div style="background:white;border:1px solid var(--gray-200);border-radius:0.75rem;padding:1.25rem;display:flex;flex-direction:column;gap:0.25rem;">
                        <div style="font-size:0.75rem;color:var(--gray-500);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Periode Aktif</div>
                        <div style="font-size:1.75rem;font-weight:800;color:var(--gray-800);">${d.per_bulan.length}</div>
                        <div style="font-size:0.8rem;color:var(--gray-400);">bulan dengan fee tercatat</div>
                    </div>
                    <div style="background:white;border:1px solid var(--gray-200);border-radius:0.75rem;padding:1.25rem;display:flex;flex-direction:column;gap:0.25rem;">
                        <div style="font-size:0.75rem;color:var(--gray-500);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Produk Terkena Fee</div>
                        <div style="font-size:1.75rem;font-weight:800;color:var(--gray-800);">${d.per_produk.length}</div>
                        <div style="font-size:0.8rem;color:var(--gray-400);">jenis produk berbeda</div>
                    </div>
                </div>
            `;
        }

        // --- Per Bulan Table ---
        if (bodyBulan) {
            if (d.per_bulan.length === 0) {
                bodyBulan.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--gray-400);">Tidak ada fee pada periode ini</td></tr>';
            } else {
                const monthNames = { '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April', '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus', '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember' };
                bodyBulan.innerHTML = d.per_bulan.map(r => {
                    const parts = r.periode.split('-');
                    const label = `${monthNames[parts[1]] || parts[1]} ${parts[0]}`;
                    return `<tr>
                        <td style="font-weight:600;">${label}</td>
                        <td style="text-align:right;color:#92400e;font-weight:700;">${rp(r.total_fee)}</td>
                        <td style="text-align:right;color:var(--gray-500);">${r.jumlah_transaksi}</td>
                    </tr>`;
                }).join('');
            }
        }

        // --- Per Produk Table ---
        if (bodyProduk) {
            if (d.per_produk.length === 0) {
                bodyProduk.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--gray-400);">Tidak ada fee pada periode ini</td></tr>';
            } else {
                bodyProduk.innerHTML = d.per_produk.map((r, i) => `
                    <tr>
                        <td style="font-weight:600;">${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${r.produk}</td>
                        <td style="text-align:right;color:#92400e;font-weight:700;">${rp(r.total_fee)}</td>
                        <td style="text-align:right;color:var(--gray-500);">${r.jumlah_item}</td>
                    </tr>
                `).join('');
            }
        }

        // --- Detail Table ---
        const bodyDetail = document.getElementById('customerfee-body-detail');
        if (bodyDetail) {
            if (!d.detail || d.detail.length === 0) {
                bodyDetail.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--gray-400);">Tidak ada transaksi fee pada periode ini</td></tr>';
            } else {
                bodyDetail.innerHTML = d.detail.map(r => {
                    const feePerQty = r.quantity > 0 ? (r.customer_fee / r.quantity) : r.customer_fee;
                    return `
                        <tr>
                            <td style="white-space:nowrap;">
                                <div style="font-weight:600;color:var(--gray-800);">${r.invoice_id}</div>
                                <div style="font-size:0.75rem;color:var(--gray-400);">${r.date}</div>
                            </td>
                            <td style="font-weight:600;color:var(--indigo-600);">${r.customer_name}</td>
                            <td>${r.product_name}</td>
                            <td style="text-align:center;font-weight:600;">${r.quantity}</td>
                            <td style="text-align:right;color:var(--gray-600);">${rp(feePerQty)}</td>
                            <td style="text-align:right;color:#92400e;font-weight:700;">${rp(r.customer_fee)}</td>
                            <td style="font-size:0.8rem;color:var(--gray-500);">${r.fee_notes || '<span style="color:var(--gray-300);">-</span>'}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

    } catch (err) {
        showToast('Gagal memuat laporan fee: ' + err.message, 'error');
        if (bodyBulan) bodyBulan.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:var(--rose-500);">${err.message}</td></tr>`;
        if (bodyProduk) bodyProduk.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:var(--rose-500);">${err.message}</td></tr>`;
    }
}

// Set default date range for customer fee report (current year)
(function initCustomerFeeDates() {
    const today = new Date();
    const year = today.getFullYear();
    const startEl = document.getElementById('customerfee-start-date');
    const endEl = document.getElementById('customerfee-end-date');
    if (startEl && !startEl.value) startEl.value = `${year}-01-01`;
    if (endEl && !endEl.value) endEl.value = today.toISOString().split('T')[0];
})();

// ==========================================================================
// PRICELIST MODULE — helpers, CRUD, POS integration
// ==========================================================================

let activePricelistId = null;
let currentPricelistDetailId = null;
let pricelistDetailData = null;
let pendingDeactivatePlPayload = null;
let plCsvParsedRows = [];
let addPlAvailableProducts = [];

// ── Helper: populate pricelist dropdown in customer modals ─────────────────
function populateCustomerPricelistDropdown(selectId, selectedId) {
    const el = document.getElementById(selectId);
    if (!el) return;
    const activeLists = (PRICELISTS || []).filter(pl => pl.is_active);
    el.innerHTML = '<option value="">Harga Master (tanpa Special Price)</option>' +
        activeLists.map(pl =>
            `<option value="${pl.id}" ${String(pl.id) === String(selectedId) ? 'selected' : ''}>${pl.nama} (${pl.kode})</option>`
        ).join('');
}

// ── Helper: populate payment type dropdown in customer modals ───────────────
function populateCustomerPaymentTypeDropdown(selectId, selectedId) {
    const el = document.getElementById(selectId);
    if (!el) return;
    const types = Array.isArray(ALL_PAYMENT_TYPES) ? ALL_PAYMENT_TYPES : [];
    el.innerHTML = '<option value="">— Belum diatur (default Kredit 30 Hari) —</option>' +
        types.map(pt =>
            `<option value="${pt.id}" ${String(pt.id) === String(selectedId) ? 'selected' : ''}>${pt.name}</option>`
        ).join('');
}
window.populateCustomerPaymentTypeDropdown = populateCustomerPaymentTypeDropdown;

// ── Helper: apply default payment type per customer in POS / Kasir ──────────
function applyCustomerPaymentTypeDefault(customerOrId) {
    const cust = (typeof customerOrId === 'object' && customerOrId !== null)
        ? customerOrId
        : (CUSTOMERS || []).find(c => String(c.id) === String(customerOrId));

    let targetPaymentTypeId = null;
    if (cust && (cust.tipe_pembayaran_id || cust.payment_type_id || cust.tipePembayaranId)) {
        targetPaymentTypeId = cust.tipe_pembayaran_id || cust.payment_type_id || cust.tipePembayaranId;
    } else {
        // Fallback default "Kredit 30 Hari": cari record master berdasarkan NAMA (bukan hardcode ID).
        const types = Array.isArray(ALL_PAYMENT_TYPES) ? ALL_PAYMENT_TYPES : [];
        const found30 = types.find(p => (p.name || '').trim().toLowerCase() === 'kredit 30 hari')
            || types.find(p => (p.name || '').toLowerCase().includes('kredit 30'))
            || types.find(p => (p.name || '').toLowerCase().startsWith('kredit'));
        if (found30) {
            targetPaymentTypeId = found30.id;
        } else {
            // Cek langsung dari opsi select jika ALL_PAYMENT_TYPES belum siap
            const paySelect = document.getElementById('cart-payment-type');
            if (paySelect) {
                for (let i = 0; i < paySelect.options.length; i++) {
                    if (paySelect.options[i].text.toLowerCase().includes('kredit 30')) {
                        targetPaymentTypeId = paySelect.options[i].value;
                        break;
                    }
                }
            }
        }
    }

    const paySelect = document.getElementById('cart-payment-type');
    if (paySelect && targetPaymentTypeId) {
        let exists = false;
        for (let i = 0; i < paySelect.options.length; i++) {
            if (paySelect.options[i].value === String(targetPaymentTypeId)) {
                exists = true;
                break;
            }
        }
        if (exists) {
            paySelect.value = targetPaymentTypeId;
            selectedCartPaymentTypeId = targetPaymentTypeId;
            paySelect.dispatchEvent(new Event('change'));
        }
    }
}
window.applyCustomerPaymentTypeDefault = applyCustomerPaymentTypeDefault;

// ── handlePOSCustomerChange – fetch effective prices when customer changes ──
async function handlePOSCustomerChange(customerId) {
    const badgeEl = document.getElementById('pos-customer-pricelist-badge');
    const badgeNameEl = document.getElementById('pos-customer-pricelist-name');

    if (!customerId) {
        currentPOSCustomerEffectivePrices = {};
        if (badgeEl) badgeEl.style.display = 'none';
        return;
    }

    try {
        const res = await fetch(`/api/pricelists/effective-prices?customer_id=${encodeURIComponent(customerId)}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Failed to fetch effective prices');
        const data = await res.json();
        const priceList = Array.isArray(data) ? data : (Array.isArray(data.prices) ? data.prices : []);

        currentPOSCustomerEffectivePrices = {};
        priceList.forEach(row => {
            currentPOSCustomerEffectivePrices[row.product_id] = row;
        });

        // Update badge UI
        if (badgeEl && badgeNameEl) {
            const plInfo = data.pricelist;
            if (plInfo && plInfo.is_active) {
                badgeNameEl.textContent = plInfo.nama;
                badgeEl.style.display = 'inline-flex';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        // Recalculate cart prices for non-manual items (Spec 5.3 pt 4)
        if (cart && cart.length > 0) {
            let pricesAdjusted = false;
            cart.forEach(item => {
                if (!item.manual_override) {
                    const eff = currentPOSCustomerEffectivePrices[item.id];
                    const newPrice = eff ? parseFloat(eff.harga_efektif) : parseFloat(item.originalPrice || PRODUCTS.find(p => p.id === item.id)?.price || item.price);
                    if (item.price !== newPrice) {
                        pricesAdjusted = true;
                        item.price = newPrice;
                    }
                    item.sumberHarga = eff ? eff.sumber_harga : 'master';
                    item.pricelistNama = eff ? (eff.pricelist_nama || '') : '';
                }
            });
            renderCart();
            if (pricesAdjusted) {
                showToast('Harga item keranjang disesuaikan dengan Special Price pelanggan.', 'info');
            }
        }
    } catch (err) {
        console.error('handlePOSCustomerChange error:', err);
    }
}

// ── fetchPricelists ─────────────────────────────────────────────────────────
async function fetchPricelists() {
    try {
        const res = await fetch('/api/pricelists', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        PRICELISTS = data.map(pl => ({
            id: pl.id,
            kode: pl.kode,
            nama: pl.nama,
            keterangan: pl.keterangan || '',
            is_active: pl.is_active !== false && pl.is_active != 0,
            total_items: parseInt(pl.total_items) || 0,
            total_customers: parseInt(pl.total_customers) || 0,
            created_at: pl.created_at,
            updated_at: pl.updated_at
        }));
        if (document.getElementById('page-pricelists')?.classList.contains('active')) {
            renderPricelistsTable();
        }
    } catch (err) {
        console.error('fetchPricelists error:', err);
    }
}

// ── renderPricelistsTable ──────────────────────────────────────────────────
function renderPricelistsTable() {
    const tbody = document.getElementById('pricelists-table-body');
    if (!tbody) return;

    const searchVal = (document.getElementById('pricelist-search')?.value || '').toLowerCase().trim();
    const statusVal = document.getElementById('pricelist-status-filter')?.value || 'all';

    let list = PRICELISTS || [];
    if (searchVal) {
        list = list.filter(pl =>
            pl.nama.toLowerCase().includes(searchVal) ||
            pl.kode.toLowerCase().includes(searchVal) ||
            (pl.keterangan && pl.keterangan.toLowerCase().includes(searchVal))
        );
    }
    if (statusVal !== 'all') {
        const isAktif = statusVal === '1';
        list = list.filter(pl => pl.is_active === isAktif);
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--gray-400);">
            <i data-lucide="inbox" style="width:28px;height:28px;margin-bottom:0.5rem;display:inline-block;opacity:0.6;"></i>
            <div>Belum ada Special Price yang sesuai. Klik "Buat Special Price Baru" untuk memulai.</div>
        </td></tr>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    tbody.innerHTML = list.map(pl => `
        <tr style="cursor:pointer;" onclick="openPricelistDetail(${pl.id})">
            <td style="font-weight:600; color:var(--blue-600);">${pl.kode}</td>
            <td style="font-weight:600; color:var(--gray-800);">${pl.nama}</td>
            <td style="color:var(--gray-500); max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pl.keterangan || '<span style="color:var(--gray-300);">—</span>'}</td>
            <td style="text-align:center; font-weight:600;">${pl.total_items}</td>
            <td style="text-align:center; font-weight:600; color:${pl.total_customers > 0 ? 'var(--blue-600)' : 'var(--gray-500)'};">${pl.total_customers}</td>
            <td style="text-align:center;">
                <span class="badge-status ${pl.is_active ? 'aman' : 'bad'}">${pl.is_active ? 'Aktif' : 'Nonaktif'}</span>
            </td>
            <td style="text-align:right; white-space:nowrap;" onclick="event.stopPropagation()">
                <button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;" title="Edit" onclick="openEditPricelistModal(${pl.id})">
                    <i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i>
                </button>
                <button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;" title="Duplikat" onclick="openDuplicatePricelistModal(${pl.id})">
                    <i data-lucide="copy" style="width:13px;height:13px;margin:0;"></i>
                </button>
                <button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem; color:var(--rose-500);" title="Hapus" onclick="deletePricelist(${pl.id}, '${pl.nama.replace(/'/g, "\\'")}', ${pl.total_customers})">
                    <i data-lucide="trash-2" style="width:13px;height:13px;margin:0;"></i>
                </button>
            </td>
        </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

// ── showPricelistView – toggle list / detail ──────────────────────────────
function showPricelistView(view) {
    const listView = document.getElementById('pricelists-list-view');
    const detailView = document.getElementById('pricelists-detail-view');
    if (view === 'list') {
        if (listView) listView.style.display = '';
        if (detailView) detailView.style.display = 'none';
        activePricelistId = null;
        currentPricelistDetailId = null;
        pricelistDetailData = null;
    } else {
        if (listView) listView.style.display = 'none';
        if (detailView) detailView.style.display = '';
    }
}

function closePricelistDetail() {
    showPricelistView('list');
    renderPricelistsTable();
}

// ── openCreatePricelistModal & submitCreatePricelist ────────────────────────
function openCreatePricelistModal() {
    const nameEl = document.getElementById('create-pl-nama');
    const descEl = document.getElementById('create-pl-keterangan');
    if (nameEl) nameEl.value = '';
    if (descEl) descEl.value = '';
    openModal('modal-create-pricelist');
    setTimeout(() => nameEl?.focus(), 100);
}

async function submitCreatePricelist() {
    const nama = document.getElementById('create-pl-nama')?.value.trim();
    const keterangan = document.getElementById('create-pl-keterangan')?.value.trim() || '';
    if (!nama) {
        showToast('Nama Special Price wajib diisi!', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/pricelists', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ nama, keterangan })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-create-pricelist');
            showToast(`Pricelist "${data.data.nama}" (${data.data.kode}) berhasil dibuat!`, 'success');
            await fetchPricelists();
            openPricelistDetail(data.data.id);
        } else {
            showToast(data.error || 'Gagal membuat Special Price', 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

// ── openEditPricelistModal & submitEditPricelist ────────────────────────────
function openEditPricelistModal(id) {
    const pl = PRICELISTS.find(p => p.id == id);
    if (!pl) return;
    document.getElementById('edit-pl-id').value = pl.id;
    document.getElementById('edit-pl-kode-display').value = pl.kode;
    document.getElementById('edit-pl-nama').value = pl.nama;
    document.getElementById('edit-pl-keterangan').value = pl.keterangan || '';
    document.getElementById('edit-pl-status').value = pl.is_active ? '1' : '0';
    openModal('modal-edit-pricelist');
}

async function submitEditPricelist() {
    const id = document.getElementById('edit-pl-id')?.value;
    const nama = document.getElementById('edit-pl-nama')?.value.trim();
    const keterangan = document.getElementById('edit-pl-keterangan')?.value.trim() || '';
    const is_active = parseInt(document.getElementById('edit-pl-status')?.value || '1', 10);

    if (!nama) {
        showToast('Nama Special Price tidak boleh kosong!', 'warning');
        return;
    }

    const pl = PRICELISTS.find(p => p.id == id);
    // Spec 5.1: If turning inactive while used by customers, prompt confirmation modal
    if (is_active === 0 && pl && pl.total_customers > 0) {
        pendingDeactivatePlPayload = { id, nama, keterangan, is_active: 0 };
        document.getElementById('deactivate-pl-id').value = id;
        const msgEl = document.getElementById('deactivate-pl-message');
        if (msgEl) {
            msgEl.innerHTML = `Pricelist <strong>"${pl.nama}"</strong> sedang digunakan oleh <strong>${pl.total_customers} pelanggan</strong>.`;
        }
        closeModal('modal-edit-pricelist');
        openModal('modal-confirm-deactivate-pricelist');
        return;
    }

    await doUpdatePricelist({ id, nama, keterangan, is_active });
}

async function doUpdatePricelist(payload) {
    try {
        const res = await fetch(`/api/pricelists/${payload.id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-edit-pricelist');
            closeModal('modal-confirm-deactivate-pricelist');
            showToast('Special Price berhasil diperbarui!', 'success');
            await fetchPricelists();
            if (activePricelistId == payload.id) {
                openPricelistDetail(payload.id);
            }
        } else {
            showToast(data.error || 'Gagal memperbarui Special Price', 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

async function confirmDeactivatePricelist() {
    if (!pendingDeactivatePlPayload) {
        const id = document.getElementById('deactivate-pl-id')?.value;
        if (!id) return;
        pendingDeactivatePlPayload = { id, is_active: 0 };
    }
    await doUpdatePricelist(pendingDeactivatePlPayload);
    pendingDeactivatePlPayload = null;
}

// ── openDuplicatePricelistModal & submitDuplicatePricelist ─────────────────
function openDuplicatePricelistModal(id) {
    const pl = PRICELISTS.find(p => p.id == id);
    if (!pl) return;
    document.getElementById('duplicate-pl-id').value = pl.id;
    document.getElementById('duplicate-pl-nama').value = `${pl.nama} (Salinan)`;
    openModal('modal-duplicate-pricelist');
    setTimeout(() => document.getElementById('duplicate-pl-nama')?.focus(), 100);
}

async function submitDuplicatePricelist() {
    const id = document.getElementById('duplicate-pl-id')?.value;
    const nama = document.getElementById('duplicate-pl-nama')?.value.trim();
    if (!id) return;
    if (!nama) {
        showToast('Nama Special Price baru wajib diisi!', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/pricelists/${id}/duplicate`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ nama })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-duplicate-pricelist');
            showToast(`Duplikat berhasil: "${data.data.nama}" (${data.data.kode})`, 'success');
            await fetchPricelists();
            openPricelistDetail(data.data.id);
        } else {
            showToast(data.error || 'Gagal menduplikat Special Price', 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

// ── deletePricelist ────────────────────────────────────────────────────────
async function deletePricelist(id, nama, totalCustomers) {
    // Spec R7: Pricelist yang masih dipakai customer tidak boleh dihapus
    if (totalCustomers > 0) {
        showToast(`Tidak dapat dihapus: ${totalCustomers} pelanggan masih menggunakan Special Price ini. Special Price hanya boleh dinonaktifkan.`, 'warning');
        return;
    }
    if (!confirm(`Hapus permanen pricelist "${nama}"?`)) return;

    try {
        const res = await fetch(`/api/pricelists/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        const data = await res.json();
        if (res.status === 409) {
            showToast(data.error || `Tidak bisa dihapus: masih digunakan oleh ${data.total_customers} pelanggan.`, 'error');
            return;
        }
        if (res.ok) {
            showToast('Special Price berhasil dihapus!', 'success');
            await fetchPricelists();
            showPricelistView('list');
        } else {
            showToast(data.error || 'Gagal menghapus Special Price', 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

// ── openPricelistDetail ────────────────────────────────────────────────────
async function openPricelistDetail(id) {
    activePricelistId = id;
    currentPricelistDetailId = id;
    showPricelistView('detail');

    const detailNama = document.getElementById('detail-pl-nama');
    if (detailNama) detailNama.textContent = 'Memuat...';

    try {
        const res = await fetch(`/api/pricelists/${id}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Not found');
        pricelistDetailData = await res.json();
        const pl = pricelistDetailData;

        if (detailNama) detailNama.textContent = pl.nama;
        const kodeEl = document.getElementById('detail-pl-kode');
        if (kodeEl) kodeEl.textContent = pl.kode;

        const statusBadge = document.getElementById('detail-pl-badge-status');
        if (statusBadge) {
            statusBadge.textContent = pl.is_active ? 'Aktif' : 'Nonaktif';
            statusBadge.className = `badge-status ${pl.is_active ? 'aman' : 'bad'}`;
        }

        const ketEl = document.getElementById('detail-pl-keterangan');
        if (ketEl) ketEl.textContent = pl.keterangan || 'Tidak ada keterangan';

        // Stats calculation
        const items = pl.items || [];
        const statItems = document.getElementById('stat-pl-total-items');
        const statCusts = document.getElementById('stat-pl-total-customers');
        const statDiff = document.getElementById('stat-pl-avg-diff');
        if (statItems) statItems.textContent = items.length;
        if (statCusts) statCusts.textContent = pl.total_customers || 0;

        if (statDiff && items.length > 0) {
            const diffs = items.filter(i => parseFloat(i.harga_master) > 0).map(i =>
                ((parseFloat(i.harga) - parseFloat(i.harga_master)) / parseFloat(i.harga_master)) * 100
            );
            const avg = diffs.length > 0 ? (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(1) : 0;
            statDiff.textContent = `${avg > 0 ? '+' : ''}${avg}%`;
            statDiff.style.color = avg < 0 ? 'var(--emerald-600)' : (avg > 0 ? 'var(--rose-500)' : 'var(--gray-600)');
        } else if (statDiff) {
            statDiff.textContent = '0%';
            statDiff.style.color = 'var(--gray-600)';
        }

        renderPricelistItemsTable(items);
    } catch (err) {
        showToast('Gagal memuat detail Special Price', 'error');
        showPricelistView('list');
    }
}

// ── renderPricelistItemsTable ──────────────────────────────────────────────
function renderPricelistItemsTable(items) {
    const tbody = document.getElementById('detail-pl-items-body');
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const showHpp = role === 'admin' || role === 'owner' || role === 'gudang';

    const thHpp = document.getElementById('th-pl-hpp');
    if (thHpp) thHpp.style.display = showHpp ? '' : 'none';
    const thStatusHpp = document.getElementById('th-pl-status-hpp');
    if (thStatusHpp) thStatusHpp.style.display = showHpp ? '' : 'none';

    // Reset check all
    const chkAll = document.getElementById('check-all-pl-items');
    if (chkAll) chkAll.checked = false;
    updatePricelistItemSelection();

    if (!tbody) return;
    if (!items || items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${showHpp ? 10 : 8}" style="text-align:center; padding:2.5rem; color:var(--gray-400);">
            <i data-lucide="package" style="width:28px;height:28px;margin-bottom:0.5rem;display:inline-block;opacity:0.6;"></i>
            <div>Belum ada produk di pricelist ini. Klik <strong>Tambah Produk</strong> atau <strong>Import CSV</strong> untuk mulai.</div>
        </td></tr>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    tbody.innerHTML = items.map(item => {
        const hargaMaster = parseFloat(item.harga_master || 0);
        const hargaKhusus = parseFloat(item.harga || 0);
        const selisihRp = hargaKhusus - hargaMaster;
        const selisihPct = hargaMaster > 0 ? (selisihRp / hargaMaster * 100).toFixed(1) : 0;
        const diffColor = selisihPct < 0 ? 'var(--emerald-600)' : (selisihPct > 0 ? 'var(--rose-500)' : 'var(--gray-400)');
        const hpp = parseFloat(item.hpp || 0);
        const hppWarn = showHpp && hpp > 0 && hargaKhusus < hpp;

        return `<tr data-product-id="${item.product_id}">
            <td style="text-align:center;">
                <input type="checkbox" class="pl-item-chk" value="${item.product_id}" onchange="updatePricelistItemSelection()">
            </td>
            <td style="font-weight:600; color:var(--blue-600); font-size:0.85rem;">${item.sku || '-'}</td>
            <td style="font-weight:600; color:var(--gray-800);">${item.product_name || item.name || '-'}</td>
            <td style="color:var(--gray-500); font-size:0.85rem;">${item.unit || '-'}</td>
            <td style="text-align:right; font-weight:500;">${rp(hargaMaster)}</td>
            <td style="text-align:right; font-weight:500; color:${hppWarn ? 'var(--rose-600)' : 'var(--gray-700)'}; display:${showHpp ? '' : 'none'};">
                ${showHpp ? rp(hpp) : '—'}${hppWarn ? ' ⚠️' : ''}
            </td>
            <td style="text-align:right;">
                <input type="number" class="inline-price-input"
                    value="${formatNumberTrim(hargaKhusus)}"
                    min="0" step="any"
                    onchange="savePricelistItemPrice('${item.product_id}', this.value, this)"
                    style="width:130px; text-align:right; font-weight:600;"
                    title="Ubah harga khusus">
            </td>
            <td style="text-align:right; font-weight:600; color:${diffColor}; font-size:0.85rem;">
                ${selisihRp >= 0 ? '+' : ''}${rp(selisihRp)}<br>
                <span style="font-size:0.75rem;">${selisihPct > 0 ? '+' : ''}${selisihPct}%</span>
            </td>
            <td style="text-align:center; display:${showHpp ? '' : 'none'};">
                ${hppWarn ? '<span class="badge-hpp-warning" style="font-size:0.68rem; padding:0.15rem 0.4rem;">⚠️ Bawah HPP</span>' : '<span style="color:var(--gray-300); font-size:0.8rem;">—</span>'}
            </td>
            <td style="text-align:center;">
                <button class="btn-toolbar secondary" style="padding:0.25rem 0.45rem; color:var(--rose-500);" title="Hapus dari pricelist" onclick="deletePricelistItem('${item.product_id}')">
                    <i data-lucide="x" style="width:13px;height:13px;margin:0;"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// ── savePricelistItemPrice ─────────────────────────────────────────────────
async function savePricelistItemPrice(productId, newPrice, inputEl) {
    const id = activePricelistId;
    if (!id) return;
    const harga = parseFloat(newPrice);
    if (isNaN(harga) || harga <= 0) {
        showToast('Harga harus lebih besar dari 0!', 'warning');
        if (inputEl && pricelistDetailData?.items) {
            const orig = pricelistDetailData.items.find(i => i.product_id === productId);
            if (orig) inputEl.value = orig.harga;
        }
        return;
    }

    try {
        const res = await fetch(`/api/pricelists/${id}/items`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ items: [{ product_id: productId, harga }] })
        });
        if (res.ok) {
            if (pricelistDetailData?.items) {
                const item = pricelistDetailData.items.find(i => i.product_id === productId);
                if (item) item.harga = harga;
            }
            showToast('Harga berhasil disimpan', 'success');
            openPricelistDetail(id);
            fetchPricelists();
        } else {
            const data = await res.json();
            showToast(data.error || 'Gagal menyimpan harga', 'error');
        }
    } catch (err) {
        showToast('Gagal menyimpan harga', 'error');
    }
}

// ── deletePricelistItem ────────────────────────────────────────────────────
async function deletePricelistItem(productId) {
    const id = activePricelistId;
    if (!id) return;
    if (!confirm('Hapus produk ini dari Special Price?')) return;
    try {
        const res = await fetch(`/api/pricelists/${id}/items/${productId}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (res.ok) {
            showToast('Produk dihapus dari Special Price', 'success');
            await openPricelistDetail(id);
            await fetchPricelists();
        } else {
            const data = await res.json();
            showToast(data.error || 'Gagal menghapus produk', 'error');
        }
    } catch (err) {
        showToast('Gagal menghapus produk', 'error');
    }
}

// ── Multi-selection in items table ─────────────────────────────────────────
function toggleSelectAllPricelistItems(checked) {
    document.querySelectorAll('.pl-item-chk').forEach(chk => { chk.checked = checked; });
    updatePricelistItemSelection();
}

function updatePricelistItemSelection() {
    const checked = document.querySelectorAll('.pl-item-chk:checked');
    const countEl = document.getElementById('detail-pl-selected-count');
    const btnEl = document.getElementById('btn-bulk-delete-items');
    if (countEl) {
        countEl.textContent = `${checked.length} dipilih`;
        countEl.style.display = checked.length > 0 ? '' : 'none';
    }
    if (btnEl) btnEl.style.display = checked.length > 0 ? '' : 'none';
}

async function deleteSelectedPricelistItems() {
    const id = activePricelistId;
    const checked = Array.from(document.querySelectorAll('.pl-item-chk:checked')).map(c => c.value);
    if (!checked.length || !id) return;
    if (!confirm(`Hapus ${checked.length} produk terpilih dari Special Price ini?`)) return;

    try {
        for (const productId of checked) {
            await fetch(`/api/pricelists/${id}/items/${productId}`, { method: 'DELETE', headers: getAuthHeaders() });
        }
        showToast(`${checked.length} produk berhasil dihapus`, 'success');
        await openPricelistDetail(id);
        await fetchPricelists();
    } catch (err) {
        showToast('Gagal menghapus beberapa produk', 'error');
    }
}

function filterPricelistItems() {
    const q = (document.getElementById('detail-pl-search')?.value || '').toLowerCase();
    document.querySelectorAll('#detail-pl-items-body tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = q ? (text.includes(q) ? '' : 'none') : '';
    });
}

// ── Modal Add Products to Pricelist ───────────────────────────────────────
function openAddPricelistProductsModal() {
    const id = activePricelistId;
    if (!id) return;
    const existingIds = new Set((pricelistDetailData?.items || []).map(i => i.product_id));

    // Populate category filter
    const catSelect = document.getElementById('add-pl-prod-category');
    if (catSelect) {
        const uniqueCats = Array.from(new Set(PRODUCTS.map(p => p.category).filter(Boolean)));
        catSelect.innerHTML = '<option value="all">Semua Kategori</option>' +
            uniqueCats.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    // Filter available products
    addPlAvailableProducts = PRODUCTS.filter(p => !existingIds.has(p.id));

    const searchInput = document.getElementById('add-pl-prod-search');
    if (searchInput) searchInput.value = '';
    const modeSelect = document.getElementById('add-pl-initial-price-mode');
    if (modeSelect) modeSelect.value = 'master';
    handleInitialPriceModeChange();

    renderAddPricelistProductsList();
    openModal('modal-add-pricelist-products');
}

function handleInitialPriceModeChange() {
    const mode = document.getElementById('add-pl-initial-price-mode')?.value || 'master';
    const percentInp = document.getElementById('add-pl-percent-input');
    const percentLbl = document.getElementById('add-pl-percent-label');
    const showPercent = mode === 'discount' || mode === 'markup';
    if (percentInp) {
        percentInp.style.display = showPercent ? 'inline-block' : 'none';
        if (!percentInp.value) percentInp.value = '10';
    }
    if (percentLbl) percentLbl.style.display = showPercent ? 'inline' : 'none';
    recalculateAddPricelistInitialPrices();
}

function recalculateAddPricelistInitialPrices() {
    const mode = document.getElementById('add-pl-initial-price-mode')?.value || 'master';
    const pct = parseFloat(document.getElementById('add-pl-percent-input')?.value || '10');

    document.querySelectorAll('#add-pl-products-body tr').forEach(row => {
        const pid = row.dataset.productId;
        const prod = PRODUCTS.find(p => p.id === pid);
        if (!prod) return;
        const master = parseFloat(prod.price || 0);
        let initPrice = master;
        if (mode === 'discount') {
            initPrice = Math.max(1, Math.round(master * (1 - pct / 100)));
        } else if (mode === 'markup') {
            initPrice = Math.round(master * (1 + pct / 100));
        }
        const inp = row.querySelector('.add-pl-price-input');
        if (inp) inp.value = initPrice;
    });
}

function renderAddPricelistProductsList() {
    const tbody = document.getElementById('add-pl-products-body');
    if (!tbody) return;

    const q = (document.getElementById('add-pl-prod-search')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('add-pl-prod-category')?.value || 'all';

    let filtered = addPlAvailableProducts;
    if (cat !== 'all') {
        filtered = filtered.filter(p => p.category === cat || p.category_id === cat);
    }
    if (q) {
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q)) ||
            p.id.toLowerCase().includes(q)
        );
    }

    const mode = document.getElementById('add-pl-initial-price-mode')?.value || 'master';
    const pct = parseFloat(document.getElementById('add-pl-percent-input')?.value || '10');

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--gray-400);">Tidak ada produk yang dapat ditambahkan</td></tr>`;
        updateAddPricelistProductsSelection();
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const master = parseFloat(p.price || 0);
        let initPrice = master;
        if (mode === 'discount') initPrice = Math.max(1, Math.round(master * (1 - pct / 100)));
        else if (mode === 'markup') initPrice = Math.round(master * (1 + pct / 100));

        const catName = p.category || '-';

        return `<tr data-product-id="${p.id}">
            <td style="text-align:center;">
                <input type="checkbox" class="add-pl-chk" value="${p.id}" onchange="updateAddPricelistProductsSelection()">
            </td>
            <td style="font-size:0.8rem; color:var(--blue-600); font-weight:600;">${p.sku || p.id}</td>
            <td style="font-weight:600;">${p.name}</td>
            <td style="color:var(--gray-500); font-size:0.85rem;">${catName}</td>
            <td style="text-align:right; font-weight:500;">${rp(master)}</td>
            <td style="text-align:right;">
                <input type="number" class="inline-price-input add-pl-price-input"
                    data-master="${master}"
                    value="${initPrice}" min="1" step="1"
                    style="width:120px; text-align:right;">
            </td>
        </tr>`;
    }).join('');

    const chkAll = document.getElementById('check-all-add-pl-prods');
    if (chkAll) chkAll.checked = false;
    updateAddPricelistProductsSelection();
}

function toggleSelectAllAddPricelistProducts(checked) {
    document.querySelectorAll('.add-pl-chk').forEach(chk => { chk.checked = checked; });
    updateAddPricelistProductsSelection();
}

function updateAddPricelistProductsSelection() {
    const checked = document.querySelectorAll('.add-pl-chk:checked');
    const countEl = document.getElementById('add-pl-selected-count');
    if (countEl) countEl.textContent = `${checked.length} produk dipilih`;
}

async function submitAddPricelistProducts() {
    const id = activePricelistId;
    if (!id) return;
    const checkedRows = Array.from(document.querySelectorAll('.add-pl-chk:checked')).map(chk => chk.closest('tr'));
    if (checkedRows.length === 0) {
        showToast('Pilih minimal 1 produk untuk ditambahkan', 'warning');
        return;
    }

    const items = [];
    for (const row of checkedRows) {
        const prodId = row.dataset.productId;
        const priceInp = row.querySelector('.add-pl-price-input');
        const harga = parseFloat(priceInp?.value || '0');
        if (isNaN(harga) || harga <= 0) {
            showToast(`Harga untuk produk ${prodId} harus lebih besar dari 0`, 'warning');
            return;
        }
        items.push({ product_id: prodId, harga });
    }

    try {
        const res = await fetch(`/api/pricelists/${id}/items`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ items })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-add-pricelist-products');
            showToast(`${items.length} produk berhasil ditambahkan ke Special Price!`, 'success');
            await openPricelistDetail(id);
            await fetchPricelists();
        } else {
            showToast(data.error || 'Gagal menyimpan item ke Special Price', 'error');
        }
    } catch (err) {
        showToast('Gagal menyimpan', 'error');
    }
}

// ── Modal CSV Import ──────────────────────────────────────────────────────
function openPricelistCsvModal() {
    plCsvParsedRows = [];
    const previewContainer = document.getElementById('pl-csv-preview-container');
    const previewBody = document.getElementById('pl-csv-preview-body');
    const fileInp = document.getElementById('pl-csv-file-input');
    const txtArea = document.getElementById('pl-csv-textarea');
    const submitBtn = document.getElementById('btn-submit-csv-items');

    if (previewContainer) previewContainer.style.display = 'none';
    if (previewBody) previewBody.innerHTML = '';
    if (fileInp) fileInp.value = '';
    if (txtArea) txtArea.value = '';
    if (submitBtn) submitBtn.disabled = true;

    openModal('modal-import-pricelist-csv');
}

function downloadPricelistCsvTemplate() {
    const lines = ['kode_produk,harga'];
    const sample = PRODUCTS.slice(0, 5);
    sample.forEach(p => {
        lines.push(`${p.sku || p.id},${Math.round(p.price || 50000)}`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template_pricelist.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handlePricelistCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const txtArea = document.getElementById('pl-csv-textarea');
        if (txtArea) txtArea.value = text;
        parsePricelistCsvText(text);
    };
    reader.readAsText(file);
}

function parsePricelistCsvText(text) {
    if (!text || !text.trim()) {
        document.getElementById('pl-csv-preview-container').style.display = 'none';
        document.getElementById('btn-submit-csv-items').disabled = true;
        plCsvParsedRows = [];
        return;
    }

    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    // Detect delimiter: comma, semicolon, tab
    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes(';') && !firstLine.includes(',')) delimiter = ';';
    else if (firstLine.includes('\t')) delimiter = '\t';

    let startIndex = 0;
    let codeCol = 0;
    let priceCol = 1;

    // Check if line 0 is a header
    const headerCols = firstLine.split(delimiter).map(c => c.replace(/"/g, '').trim().toLowerCase());
    const isHeader = headerCols.some(c => c.includes('kode') || c.includes('sku') || c.includes('product') || c.includes('harga') || c.includes('price'));
    if (isHeader) {
        startIndex = 1;
        const foundCode = headerCols.findIndex(c => c.includes('kode') || c.includes('sku') || c.includes('product') || c === 'id');
        const foundPrice = headerCols.findIndex(c => c.includes('harga') || c.includes('price'));
        if (foundCode !== -1) codeCol = foundCode;
        if (foundPrice !== -1) priceCol = foundPrice;
    }

    const previewBody = document.getElementById('pl-csv-preview-body');
    const validBadge = document.getElementById('pl-csv-valid-badge');
    const invalidBadge = document.getElementById('pl-csv-invalid-badge');
    const submitBtn = document.getElementById('btn-submit-csv-items');

    plCsvParsedRows = [];
    let validCount = 0;
    let invalidCount = 0;
    const htmlRows = [];

    // Map for deduplication (last write wins per Rule 7)
    const dedupMap = new Map();

    for (let i = startIndex; i < lines.length; i++) {
        const rawLine = lines[i];
        const cols = rawLine.split(delimiter).map(c => c.replace(/"/g, '').trim());
        const codeInput = cols[codeCol] || '';
        const priceInput = cols[priceCol] || '';

        const lineNum = i + 1;
        let isValid = true;
        let errorReason = '';
        let matchedProduct = null;

        if (!codeInput) {
            isValid = false;
            errorReason = 'Kode produk kosong';
        } else {
            // Find in PRODUCTS by SKU or ID or Name
            matchedProduct = PRODUCTS.find(p =>
                (p.sku && p.sku.toLowerCase() === codeInput.toLowerCase()) ||
                (p.id && p.id.toLowerCase() === codeInput.toLowerCase()) ||
                p.name.toLowerCase() === codeInput.toLowerCase()
            );
            if (!matchedProduct) {
                isValid = false;
                errorReason = `Produk '${codeInput}' tidak ditemukan di master`;
            }
        }

        const hargaNum = parseFloat(priceInput.replace(/[^\d.-]/g, ''));
        if (isValid) {
            if (isNaN(hargaNum) || hargaNum <= 0) {
                isValid = false;
                errorReason = 'Harga tidak valid (harus angka > 0)';
            }
        }

        if (isValid && matchedProduct) {
            validCount++;
            dedupMap.set(matchedProduct.id, {
                product_id: matchedProduct.id,
                harga: hargaNum,
                name: matchedProduct.name,
                code: codeInput
            });
            htmlRows.push(`
                <tr style="background:#f0fdf4;">
                    <td style="font-size:0.8rem; color:var(--gray-500);">${lineNum}</td>
                    <td style="font-weight:600; font-size:0.85rem;">${codeInput}</td>
                    <td style="font-weight:500;">${matchedProduct.name}</td>
                    <td style="text-align:right; font-weight:600; color:var(--emerald-600);">${rp(hargaNum)}</td>
                    <td><span class="badge-status aman">Valid</span></td>
                </tr>
            `);
        } else {
            invalidCount++;
            htmlRows.push(`
                <tr style="background:#fef2f2;">
                    <td style="font-size:0.8rem; color:var(--gray-500);">${lineNum}</td>
                    <td style="font-weight:600; font-size:0.85rem;">${codeInput || '-'}</td>
                    <td style="color:var(--gray-400);">${matchedProduct?.name || '—'}</td>
                    <td style="text-align:right; color:var(--gray-400);">${priceInput || '—'}</td>
                    <td><span class="badge-status bad" style="font-size:0.75rem;">${errorReason}</span></td>
                </tr>
            `);
        }
    }

    plCsvParsedRows = Array.from(dedupMap.values());

    if (previewBody) previewBody.innerHTML = htmlRows.join('');
    if (validBadge) validBadge.textContent = `${validCount} baris valid (${plCsvParsedRows.length} produk unik)`;
    if (invalidBadge) invalidBadge.textContent = `${invalidCount} baris error`;

    const previewContainer = document.getElementById('pl-csv-preview-container');
    if (previewContainer) previewContainer.style.display = 'block';

    if (submitBtn) {
        submitBtn.disabled = plCsvParsedRows.length === 0;
        submitBtn.innerHTML = `<i data-lucide="check-circle"></i> Simpan ${plCsvParsedRows.length} Item Valid`;
    }
    if (window.lucide) lucide.createIcons();
}

async function submitPricelistCsvItems() {
    const id = activePricelistId;
    if (!id || plCsvParsedRows.length === 0) return;

    const items = plCsvParsedRows.map(r => ({ product_id: r.product_id, harga: r.harga }));

    try {
        const res = await fetch(`/api/pricelists/${id}/items`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ items })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-import-pricelist-csv');
            showToast(`${items.length} produk berhasil diimpor ke Special Price!`, 'success');
            plCsvParsedRows = [];
            await openPricelistDetail(id);
            await fetchPricelists();
        } else {
            showToast(data.error || 'Gagal menyimpan item import', 'error');
        }
    } catch (err) {
        showToast('Gagal mengimpor CSV', 'error');
    }
}

// ── Modal Bulk Percent ─────────────────────────────────────────────────────
function openPricelistBulkPercentModal() {
    const id = activePricelistId;
    if (!id) return;
    const checked = document.querySelectorAll('.pl-item-chk:checked');
    const targetSelect = document.getElementById('bulk-percent-target');
    if (targetSelect) {
        targetSelect.value = checked.length > 0 ? 'selected' : 'all';
    }
    const valInp = document.getElementById('bulk-percent-value');
    if (valInp && !valInp.value) valInp.value = '90';
    openModal('modal-pricelist-bulk-percent');
}

async function applyPricelistBulkPercent() {
    const id = activePricelistId;
    if (!id || !pricelistDetailData?.items?.length) return;

    if (validBadge) validBadge.textContent = `${validCount} baris valid (${plCsvParsedRows.length} produk unik)`;
    if (invalidBadge) invalidBadge.textContent = `${invalidCount} baris error`;


    if (isNaN(pct) || pct <= 0) {
        showToast('Masukkan persentase yang valid (> 0)', 'warning');
        return;
    }

    const checkedIds = new Set(Array.from(document.querySelectorAll('.pl-item-chk:checked')).map(c => c.value));

    let targetItems = pricelistDetailData.items;
    if (target === 'selected') {
        targetItems = targetItems.filter(i => checkedIds.has(i.product_id));
        if (targetItems.length === 0) {
            showToast('Tidak ada produk yang dicentang di tabel', 'warning');
            return;
        }
    }

    const items = targetItems.map(item => {
        const master = parseFloat(item.harga_master || 0);
        let calcPrice = master * (pct / 100);
        if (round > 1) {
            calcPrice = Math.round(calcPrice / round) * round;
        } else {
            calcPrice = Math.round(calcPrice);
        }
        calcPrice = Math.max(1, calcPrice);
        return { product_id: item.product_id, harga: calcPrice };
    });

    try {
        const res = await fetch(`/api/pricelists/${id}/items`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ items })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-pricelist-bulk-percent');
            showToast(`Harga massal berhasil diterapkan ke ${items.length} produk (${pct}% dari master)`, 'success');
            await openPricelistDetail(id);
        } else {
            showToast(data.error || 'Gagal mengubah harga', 'error');
        }
    } catch (err) {
        showToast('Gagal memperbarui harga', 'error');
    }
}

// ── Search & Filter Bindings ───────────────────────────────────────────────
document.getElementById('pricelist-search')?.addEventListener('input', () => renderPricelistsTable());
document.getElementById('pricelist-status-filter')?.addEventListener('change', () => renderPricelistsTable());

// ── Backward-compatibility aliases ─────────────────────────────────────────
window.saveCreatePricelist = submitCreatePricelist;
window.saveEditPricelist = submitEditPricelist;
window.duplicatePricelist = openDuplicatePricelistModal;
window.saveAddPricelistProducts = submitAddPricelistProducts;
window.importPricelistCsv = submitPricelistCsvItems;



// ==========================================================================
// PIUTANG SELECTION & EXPORT PDF (TASK 6)
// ==========================================================================
let selectedPiutangIds = new Set();

function onPiutangCheckboxChange(cb, id) {
    if (cb.checked) {
        selectedPiutangIds.add(String(id));
    } else {
        selectedPiutangIds.delete(String(id));
    }
    updateCheckAllPiutangState();
    updateExportPdfButton();
}

function toggleSelectAllPiutang(masterCheckbox) {
    const isChecked = masterCheckbox.checked;
    const itemCheckboxes = document.querySelectorAll('.check-piutang-item:not(:disabled)');
    itemCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) {
            selectedPiutangIds.add(String(cb.value));
        } else {
            selectedPiutangIds.delete(String(cb.value));
        }
    });
    updateExportPdfButton();
}

function updateCheckAllPiutangState() {
    const masterCheckbox = document.getElementById('check-all-piutang');
    if (!masterCheckbox) return;
    const itemCheckboxes = Array.from(document.querySelectorAll('.check-piutang-item:not(:disabled)'));
    if (itemCheckboxes.length === 0) {
        masterCheckbox.checked = false;
        masterCheckbox.indeterminate = false;
        return;
    }
    const checkedCount = itemCheckboxes.filter(cb => cb.checked).length;
    masterCheckbox.checked = checkedCount === itemCheckboxes.length;
    masterCheckbox.indeterminate = checkedCount > 0 && checkedCount < itemCheckboxes.length;
}

function updateExportPdfButton() {
    const btn = document.getElementById('btn-export-pdf-piutang');
    if (!btn) return;
    const count = selectedPiutangIds.size;
    if (count > 0) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="file-text"></i> Export PDF (${count})`;
    } else {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="file-text"></i> Export PDF`;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function exportPiutangPDF() {
    if (selectedPiutangIds.size === 0) {
        showToast('Pilih minimal satu invoice piutang untuk diekspor ke PDF!', 'warning');
        return;
    }

    const btn = document.getElementById('btn-export-pdf-piutang');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Menyiapkan PDF...`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    try {
        const res = await fetch('/api/finance/receivables/export-pdf', {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: Array.from(selectedPiutangIds) })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast('Gagal membuat PDF: ' + (err.error || 'Terjadi kesalahan'), 'error');
            return;
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const nowStr = new Date().toISOString().slice(0, 10);
        a.download = `Laporan_Piutang_SupplierPro_${nowStr}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        showToast('PDF Laporan Piutang berhasil di-download', 'success');

        // Reset selection after successful export
        selectedPiutangIds.clear();
        updateCheckAllPiutangState();
        updateExportPdfButton();
        const checkboxes = document.querySelectorAll('.check-piutang-item');
        checkboxes.forEach(cb => { cb.checked = false; });
    } catch (err) {
        console.error('Error exporting PDF:', err);
        showToast('Gagal mendownload PDF', 'error');
    } finally {
        if (btn) {
            updateExportPdfButton();
        }
    }
}

// Outstanding Invoice Delete handlers (Task 6)
function confirmDeleteOutstandingInvoice(id, paid) {
    const idInput = document.getElementById('delete-outstanding-id');
    const paidInput = document.getElementById('delete-outstanding-paid');
    const textEl = document.getElementById('delete-outstanding-text');
    const alertEl = document.getElementById('delete-outstanding-alert');
    const alertText = document.getElementById('delete-outstanding-alert-text');

    if (idInput) idInput.value = id;
    if (paidInput) paidInput.value = paid || 0;
    if (textEl) {
        textEl.innerHTML = `Apakah Anda yakin ingin menghapus invoice outstanding <strong>${id}</strong>?`;
    }

    const paidNum = parseFloat(paid || 0);
    if (paidNum > 0) {
        if (alertEl) alertEl.style.display = 'block';
        if (alertText) {
            alertText.innerHTML = `<strong>PERHATIAN:</strong> Invoice ini sudah memiliki pembayaran/cicilan sebesar <strong>${rp(paidNum)}</strong>. Menghapus invoice ini akan membatalkan seluruh catatan cicilan dan membalikkan arus kas terkait!`;
        }
    } else {
        if (alertEl) alertEl.style.display = 'none';
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    openModal('modal-delete-outstanding');
}

async function executeDeleteOutstandingInvoice() {
    const id = document.getElementById('delete-outstanding-id')?.value;
    if (!id) return;

    const btn = document.getElementById('btn-confirm-delete-outstanding');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Menghapus...';
    }

    try {
        const res = await fetch(`/api/finance/receivables/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-delete-outstanding');
            showToast('Invoice outstanding berhasil dihapus', 'success');
            notifyDataChange('invoice_delete');
            selectedPiutangIds.delete(String(id));
            await fetchPiutang();
            if (typeof fetchInvoices === 'function') await fetchInvoices();
        } else {
            showToast('Gagal menghapus: ' + (data.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error('Error deleting outstanding invoice:', err);
        showToast('Gagal menghubungi server', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Ya, Hapus Invoice';
        }
    }
}

// ==========================================================================
// BATCH C: HUTANG SELECTION, EXPORT PDF & DELETE OUTSTANDING (C3, C5)
// ==========================================================================
function onHutangCheckboxChange(cb, id) {
    if (cb.checked) {
        selectedHutangIds.add(String(id));
    } else {
        selectedHutangIds.delete(String(id));
    }
    updateCheckAllHutangState();
    updateExportHutangPdfButton();
}

function toggleSelectAllHutang(masterCheckbox) {
    const isChecked = masterCheckbox.checked;
    const itemCheckboxes = document.querySelectorAll('.check-hutang-item:not(:disabled)');
    itemCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) {
            selectedHutangIds.add(String(cb.value));
        } else {
            selectedHutangIds.delete(String(cb.value));
        }
    });
    updateExportHutangPdfButton();
}

function updateCheckAllHutangState() {
    const masterCheckbox = document.getElementById('check-all-hutang');
    if (!masterCheckbox) return;
    const itemCheckboxes = Array.from(document.querySelectorAll('.check-hutang-item:not(:disabled)'));
    if (itemCheckboxes.length === 0) {
        masterCheckbox.checked = false;
        masterCheckbox.indeterminate = false;
        return;
    }
    const checkedCount = itemCheckboxes.filter(cb => cb.checked).length;
    masterCheckbox.checked = checkedCount === itemCheckboxes.length;
    masterCheckbox.indeterminate = checkedCount > 0 && checkedCount < itemCheckboxes.length;
}

function updateExportHutangPdfButton() {
    const btn = document.getElementById('btn-export-pdf-hutang');
    if (!btn) return;
    const count = selectedHutangIds.size;
    if (count > 0) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="file-text"></i> Export PDF (${count})`;
    } else {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="file-text"></i> Export PDF`;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function exportHutangPDF() {
    if (selectedHutangIds.size === 0) {
        showToast('Pilih minimal satu hutang PO untuk diekspor ke PDF!', 'warning');
        return;
    }

    const btn = document.getElementById('btn-export-pdf-hutang');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Menyiapkan PDF...`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    try {
        const res = await fetch('/api/finance/payables/export-pdf', {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: Array.from(selectedHutangIds) })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast('Gagal membuat PDF: ' + (err.error || 'Terjadi kesalahan'), 'error');
            return;
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const nowStr = new Date().toISOString().slice(0, 10);
        a.download = `Laporan_Hutang_SupplierPro_${nowStr}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        showToast('PDF Laporan Hutang berhasil di-download', 'success');

        selectedHutangIds.clear();
        updateCheckAllHutangState();
        updateExportHutangPdfButton();
        const checkboxes = document.querySelectorAll('.check-hutang-item');
        checkboxes.forEach(cb => { cb.checked = false; });
    } catch (err) {
        console.error('Error exporting PDF:', err);
        showToast('Gagal mendownload PDF', 'error');
    } finally {
        if (btn) {
            updateExportHutangPdfButton();
        }
    }
}

// Outstanding Hutang Delete handlers (C3)
function confirmDeleteOutstandingHutang(id, paid) {
    const idInput = document.getElementById('delete-outstanding-hutang-id');
    const paidInput = document.getElementById('delete-outstanding-hutang-paid');
    const textEl = document.getElementById('delete-outstanding-hutang-text');
    const alertEl = document.getElementById('delete-outstanding-hutang-alert');
    const alertText = document.getElementById('delete-outstanding-hutang-alert-text');

    if (idInput) idInput.value = id;
    if (paidInput) paidInput.value = paid || 0;
    if (textEl) {
        textEl.innerHTML = `Apakah Anda yakin ingin menghapus hutang outstanding <strong>${id}</strong>?`;
    }

    const paidNum = parseFloat(paid || 0);
    if (paidNum > 0) {
        if (alertEl) alertEl.style.display = 'block';
        if (alertText) {
            alertText.innerHTML = `<strong>PERHATIAN:</strong> Hutang ini sudah memiliki pembayaran/cicilan sebesar <strong>${rp(paidNum)}</strong>. Menghapus hutang ini akan membatalkan seluruh catatan cicilan dan membalikkan arus kas terkait!`;
        }
    } else {
        if (alertEl) alertEl.style.display = 'none';
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    openModal('modal-delete-outstanding-hutang');
}

async function executeDeleteOutstandingHutang() {
    const id = document.getElementById('delete-outstanding-hutang-id')?.value;
    if (!id) return;

    const btn = document.getElementById('btn-confirm-delete-outstanding-hutang');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Menghapus...';
    }

    try {
        const res = await fetch(`/api/finance/payables/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-delete-outstanding-hutang');
            showToast('Hutang outstanding berhasil dihapus', 'success');
            notifyDataChange('purchase_delete');
            selectedHutangIds.delete(String(id));
            await fetchHutang();
            if (typeof fetchPurchases === 'function') await fetchPurchases();
        } else {
            showToast('Gagal menghapus: ' + (data.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error('Error deleting outstanding hutang:', err);
        showToast('Gagal menghubungi server', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="trash-2"></i> Ya, Hapus';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

// ==============================================================================
// BATCH B: RETUR & STOCK MOVE MODULE (B1, B2, B3, B4.1, B4.2)
// ==============================================================================

// ---------- B3. Soft-Lock Management ----------
let pendingSoftLockType = null;

function promptSoftLockModal(targetType) {
    pendingSoftLockType = targetType;
    const targetInput = document.getElementById('softlock-target-type');
    if (targetInput) targetInput.value = targetType;

    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const isAdmin = role === 'admin';
    const adminSection = document.getElementById('softlock-admin-koreksi-section');
    const btnKoreksi = document.getElementById('btn-softlock-continue-koreksi');
    const reasonInput = document.getElementById('softlock-koreksi-reason');

    if (adminSection) adminSection.style.display = isAdmin ? 'block' : 'none';
    if (btnKoreksi) btnKoreksi.style.display = isAdmin ? 'inline-block' : 'none';
    if (reasonInput) reasonInput.value = '';

    openModal('modal-softlock-warning');
}

function handleSoftLockOpenReturn() {
    closeModal('modal-softlock-warning');
    if (pendingSoftLockType === 'invoice') {
        openSalesReturnFromEditInvoice();
    } else if (pendingSoftLockType === 'purchase') {
        openPurchaseReturnFromEditPurchase();
    }
}

function handleSoftLockContinueKoreksi() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    if (role !== 'admin') {
        showToast('Hanya admin yang berwenang melanjutkan koreksi salah input!', 'error');
        return;
    }
    const reasonInput = document.getElementById('softlock-koreksi-reason');
    const reason = (reasonInput?.value || '').trim();
    if (reason.length < 10) {
        showToast('Alasan koreksi wajib diisi minimal 10 karakter!', 'warning');
        if (reasonInput) reasonInput.focus();
        return;
    }

    closeModal('modal-softlock-warning');
    if (pendingSoftLockType === 'invoice') {
        saveInvoiceEdits(true, reason);
    } else if (pendingSoftLockType === 'purchase') {
        savePurchase(true, true, reason);
    }
}

// ---------- B1. Retur Penjualan ----------
let currentSalesReturnInvoice = null;
let currentSalesReturnItems = [];

async function openSalesReturnFromEditInvoice() {
    const invId = document.getElementById('edit-invoice-id')?.value;
    if (!invId) return;
    await openSalesReturnModal(invId);
}

async function openSalesReturnModal(invId) {
    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invId)}/returns-form`, { headers: getAuthHeaders() });
        if (!res.ok) {
            showToast('Gagal memuat data retur invoice', 'error');
            return;
        }
        const data = await res.json();
        currentSalesReturnInvoice = data.invoice;
        currentSalesReturnItems = data.items || [];

        // Check if invoice cancelled
        if ((currentSalesReturnInvoice.status || '').toLowerCase() === 'cancel' || (currentSalesReturnInvoice.status || '').toLowerCase() === 'batal') {
            showToast('Invoice yang dibatalkan tidak dapat diretur.', 'warning');
            return;
        }

        // Fill header info
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';

        document.getElementById('sales-return-invoice-id').value = currentSalesReturnInvoice.id;
        document.getElementById('sales-return-inv-number').textContent = currentSalesReturnInvoice.id;
        document.getElementById('sales-return-inv-date').textContent = (currentSalesReturnInvoice.date || '').split('T')[0];
        document.getElementById('sales-return-customer').textContent = currentSalesReturnInvoice.customer_name || '-';
        document.getElementById('sales-return-sisa-piutang').textContent = rp(data.remainingDebt || 0);

        const sisaPiutangContainer = document.getElementById('sales-return-sisa-piutang-container');
        if (sisaPiutangContainer) {
            sisaPiutangContainer.style.display = canSeeFinance ? '' : 'none';
        }

        document.getElementById('sales-return-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('sales-return-reason').value = '';

        // Render items table
        const tbody = document.getElementById('sales-return-items-body');

        if (currentSalesReturnItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1rem; color:var(--gray-400);">Tidak ada item pada invoice ini.</td></tr>';
        } else {
            tbody.innerHTML = currentSalesReturnItems.map((item, idx) => {
                const maxReturn = item.maxReturnable || 0;
                const isAllReturned = maxReturn <= 0;
                return `
                    <tr style="${isAllReturned ? 'opacity: 0.6; background: #fafafa;' : ''}">
                        <td>
                            <strong style="color:var(--gray-800);">${item.product_name}</strong>
                            <div style="font-size:0.75rem; color:var(--gray-400);">${item.product_sku || item.product_id}</div>
                        </td>
                        <td style="text-align:right;">${item.invoice_qty}</td>
                        <td style="text-align:right; color:var(--rose-600);">${item.returned_qty}</td>
                        <td style="text-align:right; font-weight:600; color:var(--emerald-600);">${maxReturn}</td>
                        <td style="text-align:right;">
                            <input type="number" class="form-input sales-ret-qty-input" 
                                style="width: 80px; text-align:right; padding: 0.25rem 0.4rem; font-size: 0.85rem;"
                                min="0" max="${maxReturn}" value="0" 
                                data-idx="${idx}" ${isAllReturned ? 'disabled' : ''}
                                oninput="updateSalesReturnCalc()">
                        </td>
                        <td>
                            <select class="form-input sales-ret-cond-select" style="padding: 0.25rem 0.4rem; font-size: 0.8rem;" data-idx="${idx}" ${isAllReturned ? 'disabled' : ''}>
                                <option value="kembali_ke_stok">Kembali ke Stok</option>
                                <option value="rusak">Rusak / Tidak Kembali</option>
                            </select>
                        </td>
                        <td class="th-sales-return-finance" style="text-align:right; font-weight:600; ${canSeeFinance ? '' : 'display:none;'}">
                            <span id="sales-ret-item-subtotal-${idx}">Rp 0</span>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        updateSalesReturnCalc();
        openModal('modal-sales-return');
    } catch (e) {
        console.error('Error opening sales return modal', e);
        showToast('Error membuka form retur', 'error');
    }
}

function updateSalesReturnCalc() {
    if (!currentSalesReturnInvoice || !currentSalesReturnItems) return;
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';

    let totalGross = 0;
    const qtyInputs = document.querySelectorAll('.sales-ret-qty-input');
    
    qtyInputs.forEach(input => {
        const idx = parseInt(input.dataset.idx, 10);
        const item = currentSalesReturnItems[idx];
        if (!item) return;

        let val = parseFloat(input.value) || 0;
        if (val < 0) val = 0;
        if (val > item.maxReturnable) {
            val = item.maxReturnable;
            input.value = val;
        }

        const price = parseFloat(item.price || 0);
        const itemGross = val * price;
        totalGross += itemGross;

        const subtotalEl = document.getElementById(`sales-ret-item-subtotal-${idx}`);
        if (subtotalEl) subtotalEl.textContent = rp(itemGross);
    });

    // Cek apakah PPN aktif di pengaturan utama sistem
    const isPpnEnabled = (typeof currentPpnEnabled !== 'undefined' && currentPpnEnabled === false) ? false : (currentSalesReturnInvoice.ppn_enabled !== false);

    // Proportional discount and tax from original invoice
    const invSubtotal = parseFloat(currentSalesReturnInvoice.subtotal || 0);
    const invDiscount = parseFloat(currentSalesReturnInvoice.discount || 0);
    const invTax = isPpnEnabled ? parseFloat(currentSalesReturnInvoice.tax || 0) : 0;

    const discRatio = invSubtotal > 0 ? (invDiscount / invSubtotal) : 0;
    const discountPortion = totalGross * discRatio;
    const afterDisc = totalGross - discountPortion;

    const baseForTax = invSubtotal - invDiscount;
    const taxRatio = (isPpnEnabled && baseForTax > 0) ? (invTax / baseForTax) : 0;
    const taxPortion = isPpnEnabled ? (afterDisc * taxRatio) : 0;

    const totalRefund = Math.round(afterDisc + taxPortion);
    const adjTotal = totalRefund - totalGross;

    const remainingDebt = Math.max(0, parseFloat(currentSalesReturnInvoice.total || 0) - parseFloat(currentSalesReturnInvoice.paid_amount || 0) - parseFloat(currentSalesReturnInvoice.return_amount || 0));
    const deductedDebt = Math.min(remainingDebt, totalRefund);
    const depositAmount = Math.max(0, totalRefund - remainingDebt);

    // Update DOM
    const subtotalEl = document.getElementById('sales-return-sum-subtotal');
    const adjEl = document.getElementById('sales-return-sum-adj');
    const totalEl = document.getElementById('sales-return-sum-total');
    const piutangEl = document.getElementById('sales-return-sum-piutang');
    const depositEl = document.getElementById('sales-return-sum-deposit');
    const summaryBox = document.getElementById('sales-return-summary-box');

    if (subtotalEl) subtotalEl.textContent = rp(totalGross);
    if (adjEl) adjEl.textContent = (adjTotal >= 0 ? '+' : '') + rp(adjTotal);
    if (totalEl) totalEl.textContent = rp(totalRefund);
    if (piutangEl) piutangEl.textContent = rp(deductedDebt);
    if (depositEl) depositEl.textContent = rp(depositAmount);

    if (summaryBox) {
        summaryBox.style.display = canSeeFinance ? '' : 'none';
    }
}

async function submitSalesReturn() {
    const invId = document.getElementById('sales-return-invoice-id').value;
    const returnDate = document.getElementById('sales-return-date').value;
    const reason = (document.getElementById('sales-return-reason').value || '').trim();

    if (!reason) {
        showToast('Alasan retur wajib diisi!', 'warning');
        document.getElementById('sales-return-reason').focus();
        return;
    }

    const items = [];
    const qtyInputs = document.querySelectorAll('.sales-ret-qty-input');
    qtyInputs.forEach(input => {
        const idx = parseInt(input.dataset.idx, 10);
        const item = currentSalesReturnItems[idx];
        const qty = parseFloat(input.value) || 0;
        if (qty > 0 && item) {
            const condSelect = document.querySelector(`.sales-ret-cond-select[data-idx="${idx}"]`);
            const condition = condSelect ? condSelect.value : 'kembali_ke_stok';
            items.push({
                product_id: item.product_id,
                qty: qty,
                condition: condition
            });
        }
    });

    if (items.length === 0) {
        showToast('Minimal satu item harus diretur dengan kuantitas > 0!', 'warning');
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-sales-return');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invId)}/returns`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                return_date: returnDate,
                reason: reason,
                items: items
            })
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-sales-return');
            closeModal('modal-edit-invoice');
            showToast(`Retur penjualan berhasil disimpan! (${data.returnId})`, 'success');

            // Dynamic refresh without page reload
            await fetchInvoices();
            await fetchProducts();
            if (typeof fetchPiutang === 'function') await fetchPiutang();
            if (currentPage === 'returns') loadReturnsSales(1);
        } else {
            showToast('Gagal simpan retur: ' + (data.error || 'Terjadi kesalahan server'), 'error');
        }
    } catch (err) {
        console.error('Error submitting sales return', err);
        showToast('Terjadi kesalahan koneksi', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
}

// ---------- B2. Retur Pembelian ----------
let currentPurchaseReturnPO = null;
let currentPurchaseReturnItems = [];

async function openPurchaseReturnFromEditPurchase() {
    const poId = document.getElementById('edit-purchase-id')?.value;
    if (!poId) return;
    await openPurchaseReturnModal(poId);
}

async function openPurchaseReturnModal(poId) {
    try {
        const res = await fetch(`/api/purchases/${encodeURIComponent(poId)}/returns-form`, { headers: getAuthHeaders() });
        if (!res.ok) {
            showToast('Gagal memuat data retur PO', 'error');
            return;
        }
        const data = await res.json();
        currentPurchaseReturnPO = data.purchase;
        currentPurchaseReturnItems = data.items || [];

        // Check if PO cancelled
        if ((currentPurchaseReturnPO.status || '').toLowerCase() === 'batal' || (currentPurchaseReturnPO.status || '').toLowerCase() === 'cancel') {
            showToast('PO yang dibatalkan tidak dapat diretur.', 'warning');
            return;
        }

        // Fill header info
        document.getElementById('purchase-return-po-id').value = currentPurchaseReturnPO.id;
        document.getElementById('purchase-return-po-number').textContent = currentPurchaseReturnPO.id;
        document.getElementById('purchase-return-po-date').textContent = (currentPurchaseReturnPO.date || '').split('T')[0];
        document.getElementById('purchase-return-vendor').textContent = currentPurchaseReturnPO.vendor_name || '-';
        document.getElementById('purchase-return-sisa-hutang').textContent = rp(data.remainingDebt || 0);

        document.getElementById('purchase-return-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('purchase-return-reason').value = '';

        // Render items table
        const tbody = document.getElementById('purchase-return-items-body');
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';

        if (currentPurchaseReturnItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1rem; color:var(--gray-400);">Tidak ada item pada PO ini.</td></tr>';
        } else {
            tbody.innerHTML = currentPurchaseReturnItems.map((item, idx) => {
                const maxReturn = item.maxReturnable || 0;
                const currentStock = parseFloat(item.current_stock || 0);
                const isAllReturned = maxReturn <= 0;
                const stockWarning = currentStock < maxReturn ? `<small style="color:var(--rose-600); display:block;">(Stok hanya ${currentStock})</small>` : '';
                return `
                    <tr style="${isAllReturned ? 'opacity: 0.6; background: #fafafa;' : ''}">
                        <td>
                            <strong style="color:var(--gray-800);">${item.product_name}</strong>
                            <div style="font-size:0.75rem; color:var(--gray-400);">${item.product_sku || item.product_id}</div>
                        </td>
                        <td style="text-align:right;">${item.purchase_qty}</td>
                        <td style="text-align:right; color:var(--rose-600);">${item.returned_qty}</td>
                        <td style="text-align:right; font-weight:500;">${currentStock}</td>
                        <td style="text-align:right; font-weight:600; color:var(--emerald-600);">
                            ${maxReturn}
                            ${stockWarning}
                        </td>
                        <td style="text-align:right;">
                            <input type="number" class="form-input purchase-ret-qty-input" 
                                style="width: 80px; text-align:right; padding: 0.25rem 0.4rem; font-size: 0.85rem;"
                                min="0" max="${maxReturn}" value="0" 
                                data-idx="${idx}" ${isAllReturned ? 'disabled' : ''}
                                oninput="updatePurchaseReturnCalc()">
                        </td>
                        <td class="th-purchase-return-finance" style="text-align:right; font-weight:600; ${canSeeFinance ? '' : 'display:none;'}">
                            <span id="purchase-ret-item-subtotal-${idx}">Rp 0</span>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        updatePurchaseReturnCalc();
        openModal('modal-purchase-return');
    } catch (e) {
        console.error('Error opening purchase return modal', e);
        showToast('Error membuka form retur pembelian', 'error');
    }
}

function updatePurchaseReturnCalc() {
    if (!currentPurchaseReturnPO || !currentPurchaseReturnItems) return;
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';

    // Cek apakah PPN aktif di pengaturan utama sistem
    const isPpnEnabled = (typeof currentPpnEnabled !== 'undefined' && currentPpnEnabled === false) ? false : (currentPurchaseReturnPO.ppn_enabled !== false);

    const poSubtotal = parseFloat(currentPurchaseReturnPO.subtotal || 0);
    const poDiscount = parseFloat(currentPurchaseReturnPO.discount || 0);
    const poTax = isPpnEnabled ? parseFloat(currentPurchaseReturnPO.tax || 0) : 0;

    const discRatio = poSubtotal > 0 ? (poDiscount / poSubtotal) : 0;
    const poDpp = poSubtotal - poDiscount;
    const taxRatio = (isPpnEnabled && poDpp > 0) ? (poTax / poDpp) : 0;

    let totalGross = 0;
    let totalRefund = 0;
    const qtyInputs = document.querySelectorAll('.purchase-ret-qty-input');
    
    qtyInputs.forEach(input => {
        const idx = parseInt(input.dataset.idx, 10);
        const item = currentPurchaseReturnItems[idx];
        if (!item) return;

        let val = parseFloat(input.value) || 0;
        if (val < 0) val = 0;
        if (val > item.maxReturnable) {
            val = item.maxReturnable;
            input.value = val;
        }

        const price = parseFloat(item.cost || item.price || 0);
        const itemGross = val * price;
        totalGross += itemGross;

        const netAfterDisc = itemGross * (1 - discRatio);
        const itemRefund = Math.round(netAfterDisc * (1 + taxRatio));
        totalRefund += itemRefund;

        const subtotalEl = document.getElementById(`purchase-ret-item-subtotal-${idx}`);
        if (subtotalEl) subtotalEl.textContent = rp(itemGross);
    });

    const remainingDebt = Math.max(0, parseFloat(currentPurchaseReturnPO.total || 0) - parseFloat(currentPurchaseReturnPO.paid || 0) - parseFloat(currentPurchaseReturnPO.return_amount || 0));
    const deductedDebt = Math.min(remainingDebt, totalRefund);
    const depositAmount = Math.max(0, totalRefund - remainingDebt);

    // Update DOM
    const totalEl = document.getElementById('purchase-return-sum-total');
    const hutangEl = document.getElementById('purchase-return-sum-hutang');
    const depositEl = document.getElementById('purchase-return-sum-deposit');
    const summaryBox = document.getElementById('purchase-return-summary-box');

    if (totalEl) totalEl.textContent = rp(totalRefund);
    if (hutangEl) hutangEl.textContent = rp(deductedDebt);
    if (depositEl) depositEl.textContent = rp(depositAmount);

    if (summaryBox) {
        summaryBox.style.display = canSeeFinance ? '' : 'none';
    }
}

async function submitPurchaseReturn() {
    const poId = document.getElementById('purchase-return-po-id').value;
    const returnDate = document.getElementById('purchase-return-date').value;
    const reason = (document.getElementById('purchase-return-reason').value || '').trim();

    if (!reason) {
        showToast('Alasan retur pembelian wajib diisi!', 'warning');
        document.getElementById('purchase-return-reason').focus();
        return;
    }

    const items = [];
    const qtyInputs = document.querySelectorAll('.purchase-ret-qty-input');
    qtyInputs.forEach(input => {
        const idx = parseInt(input.dataset.idx, 10);
        const item = currentPurchaseReturnItems[idx];
        const qty = parseFloat(input.value) || 0;
        if (qty > 0 && item) {
            items.push({
                product_id: item.product_id,
                qty: qty
            });
        }
    });

    if (items.length === 0) {
        showToast('Minimal satu item harus diretur dengan kuantitas > 0!', 'warning');
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-purchase-return');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const res = await fetch(`/api/purchases/${encodeURIComponent(poId)}/returns`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                return_date: returnDate,
                reason: reason,
                items: items
            })
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-purchase-return');
            closeModal('modal-edit-purchase');
            showToast(`Retur pembelian berhasil disimpan! (${data.returnId})`, 'success');

            // Dynamic refresh without page reload
            await fetchPurchases();
            await fetchProducts();
            if (typeof renderHutang === 'function') await renderHutang();
            if (currentPage === 'returns') loadReturnsPurchases(1);
        } else {
            showToast('Gagal simpan retur pembelian: ' + (data.error || 'Terjadi kesalahan server'), 'error');
        }
    } catch (err) {
        console.error('Error submitting purchase return', err);
        showToast('Terjadi kesalahan koneksi', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
}

// ---------- B4.1 Halaman Daftar Retur ----------
let currentReturnsTab = 'sales';

function loadReturnsPage() {
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    if (role === 'gudang') {
        switchReturnsTab('purchases');
    } else {
        switchReturnsTab('sales');
    }
}

function switchReturnsTab(tab) {
    currentReturnsTab = tab;
    const btnSales = document.getElementById('tab-btn-returns-sales');
    const btnPurchases = document.getElementById('tab-btn-returns-purchases');
    const contentSales = document.getElementById('returns-sales-content');
    const contentPurchases = document.getElementById('returns-purchases-content');

    if (tab === 'sales') {
        if (btnSales) btnSales.classList.add('active');
        if (btnPurchases) btnPurchases.classList.remove('active');
        if (contentSales) contentSales.style.display = '';
        if (contentPurchases) contentPurchases.style.display = 'none';
        loadReturnsSales(1);
    } else {
        if (btnPurchases) btnPurchases.classList.add('active');
        if (btnSales) btnSales.classList.remove('active');
        if (contentPurchases) contentPurchases.style.display = '';
        if (contentSales) contentSales.style.display = 'none';
        loadReturnsPurchases(1);
    }
}

const debounceReturnsSearch = debounce(() => {
    if (currentReturnsTab === 'sales') {
        loadReturnsSales(1);
    } else {
        loadReturnsPurchases(1);
    }
}, 300);

function resetReturnsFilter() {
    const searchEl = document.getElementById('returns-search');
    const fromEl = document.getElementById('returns-date-from');
    const toEl = document.getElementById('returns-date-to');
    if (searchEl) searchEl.value = '';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    if (currentReturnsTab === 'sales') loadReturnsSales(1);
    else loadReturnsPurchases(1);
}

async function loadReturnsSales(page = 1) {
    const search = document.getElementById('returns-search')?.value || '';
    const from = document.getElementById('returns-date-from')?.value || '';
    const to = document.getElementById('returns-date-to')?.value || '';
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';

    let url = `/api/returns/sales?page=${page}&limit=80`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (from) url += `&startDate=${encodeURIComponent(from)}`;
    if (to) url += `&endDate=${encodeURIComponent(to)}`;

    const tbody = document.getElementById('returns-sales-body');
    const emptyEl = document.getElementById('returns-sales-empty');
    if (!tbody) return;

    try {
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--rose-500);">Gagal memuat data retur penjualan.</td></tr>';
            return;
        }
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};

        if (rows.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            tbody.innerHTML = rows.map(r => {
                const dateStr = (r.return_date || '').split('T')[0];
                const condBadge = r.condition_summary === 'kembali_ke_stok'
                    ? '<span class="badge-status kembali_ke_stok">Kembali ke Stok</span>'
                    : (r.condition_summary === 'rusak' 
                        ? '<span class="badge-status rusak">Rusak</span>' 
                        : `<span class="badge-status opname">${capitalize(r.condition_summary || '-')}</span>`);
                const financeCol = canSeeFinance ? `<td style="text-align:right; font-weight:600;">${rp(r.total_refund || 0)}</td>` : '';
                return `
                    <tr style="cursor: pointer;" onclick="openReturnDetail('sales', '${r.id}')">
                        <td style="font-weight:600; color:var(--amber-700);">${r.id}</td>
                        <td>${dateStr}</td>
                        <td style="color:var(--blue-600); font-weight:500;">${r.invoice_id}</td>
                        <td style="font-weight:600;">${r.customer_name || '-'}</td>
                        <td style="text-align:center;">${r.item_count || 1} item</td>
                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.reason || '-'}</td>
                        <td>${condBadge}</td>
                        ${financeCol}
                    </tr>
                `;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-returns-sales',
            currentPage: page,
            totalItems: pag.total || 0,
            pageSize: 80,
            onPageChange: (p) => loadReturnsSales(p)
        });

        // Hide/show financial table header
        document.querySelectorAll('#returns-sales-table .th-returns-finance').forEach(th => {
            th.style.display = canSeeFinance ? '' : 'none';
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.error('Error fetching sales returns', e);
    }
}

async function loadReturnsPurchases(page = 1) {
    const search = document.getElementById('returns-search')?.value || '';
    const from = document.getElementById('returns-date-from')?.value || '';
    const to = document.getElementById('returns-date-to')?.value || '';
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';

    let url = `/api/returns/purchases?page=${page}&limit=80`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (from) url += `&startDate=${encodeURIComponent(from)}`;
    if (to) url += `&endDate=${encodeURIComponent(to)}`;

    const tbody = document.getElementById('returns-purchases-body');
    const emptyEl = document.getElementById('returns-purchases-empty');
    if (!tbody) return;

    try {
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:var(--rose-500);">Gagal memuat data retur pembelian.</td></tr>';
            return;
        }
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};

        if (rows.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            tbody.innerHTML = rows.map(r => {
                const dateStr = (r.return_date || '').split('T')[0];
                const financeCol = canSeeFinance ? `<td style="text-align:right; font-weight:600;">${rp(r.total_refund || 0)}</td>` : '';
                return `
                    <tr style="cursor: pointer;" onclick="openReturnDetail('purchases', '${r.id}')">
                        <td style="font-weight:600; color:var(--blue-700);">${r.id}</td>
                        <td>${dateStr}</td>
                        <td style="color:var(--blue-600); font-weight:500;">${r.purchase_id}</td>
                        <td style="font-weight:600;">${r.vendor_name || '-'}</td>
                        <td style="text-align:center;">${r.item_count || 1} item</td>
                        <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.reason || '-'}</td>
                        ${financeCol}
                    </tr>
                `;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-returns-purchases',
            currentPage: page,
            totalItems: pag.total || 0,
            pageSize: 80,
            onPageChange: (p) => loadReturnsPurchases(p)
        });

        // Hide/show financial table header
        document.querySelectorAll('#returns-purchases-table .th-returns-finance').forEach(th => {
            th.style.display = canSeeFinance ? '' : 'none';
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.error('Error fetching purchase returns', e);
    }
}

async function openReturnDetail(type, id) {
    try {
        const url = `/api/returns/${type}/${encodeURIComponent(id)}`;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
            showToast('Gagal memuat detail retur', 'error');
            return;
        }
        const data = await res.json();
        const ret = data.return || data || {};
        const items = data.items || [];
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canSeeFinance = role === 'admin' || role === 'finance' || role === 'owner';

        document.getElementById('ret-detail-id').textContent = ret.id || '-';
        document.getElementById('ret-detail-date').textContent = (ret.return_date || ret.date || '').split('T')[0] || '-';
        
        const isSales = type === 'sales';
        document.getElementById('ret-detail-ref-label').textContent = isSales ? 'No. Invoice' : 'No. PO';
        const refId = isSales ? (ret.invoice_id || '-') : (ret.purchase_id || ret.purchase_order_id || '-');
        
        // Link to invoice/PO if role has permission
        const canViewRef = isSales ? (role === 'admin' || role === 'finance' || role === 'kasir') : (role === 'admin' || role === 'finance' || role === 'gudang');
        if (canViewRef && refId !== '-') {
            document.getElementById('ret-detail-ref-id').innerHTML = `<strong style="color:var(--blue-600); cursor:pointer;">${refId}</strong>`;
        } else {
            document.getElementById('ret-detail-ref-id').textContent = refId;
        }

        document.getElementById('ret-detail-party-label').textContent = isSales ? 'Pelanggan' : 'Vendor';
        document.getElementById('ret-detail-party').textContent = (isSales ? (ret.customer_name || ret.customer) : (ret.vendor_name || ret.vendor)) || '-';
        document.getElementById('ret-detail-reason').textContent = ret.reason || '-';
        document.getElementById('ret-detail-creator').textContent = ret.created_by_name || ret.user_name || '-';

        // Render items table
        const tbody = document.getElementById('ret-detail-items-body');
        tbody.innerHTML = items.map((i, idx) => {
            const cond = i.condition || i.condition_type || '';
            const condDisplay = isSales 
                ? (cond === 'rusak' ? '<span class="badge-status rusak">Rusak</span>' : '<span class="badge-status kembali_ke_stok">Kembali ke Stok</span>')
                : '<span class="badge-status kembali_ke_stok">Retur ke Vendor</span>';
            const finCells = canSeeFinance ? `
                <td style="text-align:right;">${rp(i.price || i.cost || 0)}</td>
                <td style="text-align:right; font-weight:600;">${rp(i.subtotal || 0)}</td>
            ` : '';
            const itemQty = i.qty !== undefined ? i.qty : (i.quantity !== undefined ? i.quantity : 0);
            return `
                <tr>
                    <td style="text-align:center;">${idx + 1}</td>
                    <td><strong>${i.product_name || '-'}</strong><br><small style="color:var(--gray-400);">${i.product_code || i.product_sku || i.sku || ''}</small></td>
                    <td style="text-align:right; font-weight:600;">${itemQty}</td>
                    <td>${condDisplay}</td>
                    ${finCells}
                </tr>
            `;
        }).join('');

        // Finance box
        const finBox = document.getElementById('ret-detail-finance-box');
        if (canSeeFinance) {
            if (finBox) finBox.style.display = '';
            document.getElementById('ret-detail-total').textContent = rp(ret.total_refund || 0);
            document.getElementById('ret-detail-debt-label').textContent = isSales ? 'Dipotong ke Piutang:' : 'Dipotong ke Hutang:';
            const deductedDebt = ret.deducted_from_debt !== undefined ? ret.deducted_from_debt : (isSales ? ret.piutang_deduction : ret.hutang_deduction);
            document.getElementById('ret-detail-deducted').textContent = rp(deductedDebt || 0);
            document.getElementById('ret-detail-deposit-label').textContent = isSales ? 'Masuk ke Deposit Pelanggan:' : 'Masuk ke Deposit Vendor:';
            const depositAdded = ret.added_to_deposit !== undefined ? ret.added_to_deposit : (isSales ? ret.customer_deposit_amount : ret.vendor_deposit_amount);
            document.getElementById('ret-detail-deposit').textContent = rp(depositAdded || 0);
        } else {
            if (finBox) finBox.style.display = 'none';
        }

        // Hide/show table header
        document.querySelectorAll('.th-ret-detail-finance').forEach(th => {
            th.style.display = canSeeFinance ? '' : 'none';
        });

        openModal('modal-return-detail');
    } catch (e) {
        console.error('Error opening return detail modal', e);
        showToast('Error membuka detail retur', 'error');
    }
}

// ---------- B4.2 Halaman Stock Move ----------
const debounceStockMovesSearch = debounce(() => {
    loadStockMovesPage(1);
}, 300);

function resetStockMovesFilter() {
    const searchEl = document.getElementById('stock-moves-search');
    const typeEl = document.getElementById('stock-moves-filter-type');
    const fromEl = document.getElementById('stock-moves-date-from');
    const toEl = document.getElementById('stock-moves-date-to');
    if (searchEl) searchEl.value = '';
    if (typeEl) typeEl.value = 'all';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    loadStockMovesPage(1);
}

function formatMoveType(type) {
    const map = {
        stok_awal: 'Stok Awal',
        penjualan: 'Penjualan',
        pembelian: 'Pembelian',
        opname: 'Opname',
        retur_penjualan: 'Retur Jual',
        retur_penjualan_rusak: 'Retur Rusak',
        retur_pembelian: 'Retur Beli',
        cancel_invoice: 'Batal Inv',
        koreksi_edit: 'Koreksi',
        konversi_keluar: 'Konversi Keluar',
        konversi_masuk: 'Konversi Masuk',
        batal_konversi: 'Batal Konversi'
    };
    return map[type] || capitalize(type || '-');
}

async function loadStockMovesPage(page = 1) {
    const search = document.getElementById('stock-moves-search')?.value || '';
    const type = document.getElementById('stock-moves-filter-type')?.value || 'all';
    const from = document.getElementById('stock-moves-date-from')?.value || '';
    const to = document.getElementById('stock-moves-date-to')?.value || '';
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();

    // Spec B4.2: Akses: admin dan gudang
    if (role !== 'admin' && role !== 'gudang') {
        showToast('Akses ditolak: Hanya Admin dan Gudang yang dapat melihat Stock Move.', 'error');
        navigateTo('dashboard');
        return;
    }

    let url = `/api/stock-moves?page=${page}&limit=80`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (type && type !== 'all') url += `&tipe=${encodeURIComponent(type)}`;
    if (from) url += `&date_from=${encodeURIComponent(from)}`;
    if (to) url += `&date_to=${encodeURIComponent(to)}`;

    const tbody = document.getElementById('stock-moves-body');
    const emptyEl = document.getElementById('stock-moves-empty');
    if (!tbody) return;

    try {
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:var(--rose-500);">Gagal memuat data stock moves.</td></tr>';
            return;
        }
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};

        if (rows.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            tbody.innerHTML = rows.map(m => {
                const dateStr = (m.tanggal || '').split('T')[0];
                const moveType = m.tipe || '';
                const typeLabel = formatMoveType(moveType);
                const inQty = parseFloat(m.qtyMasuk || 0);
                const outQty = parseFloat(m.qtyKeluar || 0);
                const inDisplay = inQty > 0 ? `<span style="color:var(--emerald-600); font-weight:600;">+${inQty}</span>` : '<span style="color:var(--gray-300);">-</span>';
                const outDisplay = outQty > 0 ? `<span style="color:var(--rose-600); font-weight:600;">-${outQty}</span>` : '<span style="color:var(--gray-300);">-</span>';

                // Spec B4.2: No. referensi untuk role gudang ditampilkan sebagai teks biasa (tidak bisa diklik).
                let refDisplay = m.refNo || m.refId || '-';
                if (role === 'admin' && (m.refNo || m.refId)) {
                    refDisplay = `<span style="color:var(--blue-600); font-weight:500;">${m.refNo || m.refId}</span>`;
                }

                return `
                    <tr>
                        <td style="font-size:0.82rem; color:var(--gray-500);">${dateStr}</td>
                        <td>
                            <strong>${m.productName || '-'}</strong>
                            <div style="font-size:0.75rem; color:var(--gray-400);">${m.sku || ''}</div>
                        </td>
                        <td><span class="badge-status ${moveType}">${typeLabel}</span></td>
                        <td>${refDisplay}</td>
                        <td style="text-align:right;">${inDisplay}</td>
                        <td style="text-align:right;">${outDisplay}</td>
                        <td style="text-align:right; font-weight:700;">${parseFloat(m.stokSesudah || 0)}</td>
                        <td style="font-size:0.82rem; color:var(--gray-600); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${m.keterangan || '-'}</td>
                        <td style="font-size:0.8rem; color:var(--gray-500);">${m.user || '-'}</td>
                    </tr>
                `;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-stock-moves',
            currentPage: page,
            totalItems: pag.total || 0,
            pageSize: 80,
            onPageChange: (p) => loadStockMovesPage(p)
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.error('Error fetching stock moves', e);
    }
}

// Window attachments for inline HTML onclick/oninput handlers
window.switchReturnsTab = switchReturnsTab;
window.debounceReturnsSearch = debounceReturnsSearch;
window.resetReturnsFilter = resetReturnsFilter;
window.loadReturnsSales = loadReturnsSales;
window.loadReturnsPurchases = loadReturnsPurchases;
window.openReturnDetail = openReturnDetail;
window.debounceStockMovesSearch = debounceStockMovesSearch;
window.resetStockMovesFilter = resetStockMovesFilter;
window.loadStockMovesPage = loadStockMovesPage;
window.openSalesReturnFromEditInvoice = openSalesReturnFromEditInvoice;
window.openSalesReturnModal = openSalesReturnModal;
window.updateSalesReturnCalc = updateSalesReturnCalc;
window.submitSalesReturn = submitSalesReturn;
window.openPurchaseReturnFromEditPurchase = openPurchaseReturnFromEditPurchase;
window.openPurchaseReturnModal = openPurchaseReturnModal;
window.updatePurchaseReturnCalc = updatePurchaseReturnCalc;
window.submitPurchaseReturn = submitPurchaseReturn;
window.handleSoftLockOpenReturn = handleSoftLockOpenReturn;
window.handleSoftLockContinueKoreksi = handleSoftLockContinueKoreksi;
window.renderRecentStockMoves = renderRecentStockMoves;

// Batch C: Window attachments for Hutang Cicilan & Management
window.openHutangPaymentModal = openHutangPaymentModal;
window.fillFullHutangPayment = fillFullHutangPayment;
window.submitHutangPayment = submitHutangPayment;
window.openHutangPaymentHistoryModal = openHutangPaymentHistoryModal;
window.triggerPayFromHutangHistory = triggerPayFromHutangHistory;
window.openVoidHutangPaymentModal = openVoidHutangPaymentModal;
window.submitVoidHutangPayment = submitVoidHutangPayment;
window.onHutangCheckboxChange = onHutangCheckboxChange;
window.toggleSelectAllHutang = toggleSelectAllHutang;
window.exportHutangPDF = exportHutangPDF;
window.confirmDeleteOutstandingHutang = confirmDeleteOutstandingHutang;
window.executeDeleteOutstandingHutang = executeDeleteOutstandingHutang;
window.previewHutangImport = previewHutangImport;
window.commitHutangImport = commitHutangImport;

// =========================================================================
// FITUR: KONVERSI PRODUK (Carton -> Kg / Satuan Lain)
// Akses: Admin & Gudang (Gudang tidak melihat HPP / Nilai)
// =========================================================================

let conversionsCurrentPage = 1;
let conversionsDebounceTimer = null;
let currentActiveConversionDetail = null;
let allProductsForConversion = [];

async function ensureProductsLoadedForConversion() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/products', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data.data || []);
            allProductsForConversion = list.filter(p => p.is_active !== 0 && p.is_active !== false);
        }
    } catch (e) {
        console.error('Error fetching products for conversion:', e);
    }
}

async function loadConversionsPage(page = 1) {
    conversionsCurrentPage = page;
    const search = document.getElementById('conversions-search')?.value || '';
    const status = document.getElementById('conversions-filter-status')?.value || 'all';
    const from = document.getElementById('conversions-date-from')?.value || '';
    const to = document.getElementById('conversions-date-to')?.value || '';
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();

    // Akses: Admin dan Gudang
    if (role !== 'admin' && role !== 'gudang') {
        showToast('Akses ditolak: Hanya Admin dan Gudang yang memiliki akses ke Konversi Produk.', 'error');
        navigateTo('dashboard');
        return;
    }

    const canSeeVal = role === 'admin' || role === 'owner';

    let url = `/api/conversions?page=${page}&limit=80`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (status && status !== 'all') url += `&status=${encodeURIComponent(status)}`;
    if (from) url += `&startDate=${encodeURIComponent(from)}`;
    if (to) url += `&endDate=${encodeURIComponent(to)}`;

    const tbody = document.getElementById('conversions-table-body');
    const emptyEl = document.getElementById('conversions-empty-state');
    if (!tbody) return;

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Gagal memuat data konversi');
        }

        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};

        if (rows.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            tbody.innerHTML = rows.map(c => {
                const dateStr = (c.date || '').split('T')[0];
                const statusLabel = c.status === 'posted' ? 'Posted' : (c.status === 'cancelled' ? 'Dibatalkan' : c.status);
                const statusClass = c.status || 'posted';

                const movedValDisplay = canSeeVal
                    ? (typeof formatRupiah === 'function' ? formatRupiah(c.moved_value || 0) : 'Rp ' + Number(c.moved_value || 0).toLocaleString('id-ID'))
                    : '-';

                return `
                    <tr>
                        <td style="font-weight: 600; color: var(--blue-600); cursor: pointer;" onclick="viewConversionDetail(${c.id})">
                            ${c.number}
                        </td>
                        <td style="font-size: 0.85rem; color: var(--gray-600);">${dateStr}</td>
                        <td>
                            <strong style="color: var(--gray-900);">${c.source_product_name || '-'}</strong>
                            <div style="font-size: 0.78rem; color: var(--gray-500);">${c.source_product_sku || ''}</div>
                            <div style="font-size: 0.85rem; font-weight: 600; color: var(--rose-600); margin-top: 2px;">
                                -${parseFloat(c.source_qty || 0)} ${c.source_unit || ''}
                            </div>
                        </td>
                        <td>
                            <strong style="color: var(--gray-900);">${c.target_product_name || '-'}</strong>
                            <div style="font-size: 0.78rem; color: var(--gray-500);">${c.target_product_sku || ''}</div>
                            <div style="font-size: 0.85rem; font-weight: 600; color: var(--emerald-600); margin-top: 2px;">
                                +${parseFloat(c.target_qty || 0)} ${c.target_unit || ''}
                            </div>
                        </td>
                        <td class="td-conversion-value" style="text-align: right; font-weight: 600; color: var(--gray-800);">
                            ${movedValDisplay}
                        </td>
                        <td style="text-align: center;">
                            <span class="badge-status ${statusClass}">${statusLabel}</span>
                        </td>
                        <td style="font-size: 0.82rem; color: var(--gray-600);">
                            ${c.created_by_name || '-'}
                        </td>
                        <td style="text-align: center;">
                            <button class="btn-action secondary" style="padding: 4px 8px;" onclick="viewConversionDetail(${c.id})" title="Lihat Detail">
                                <i data-lucide="eye" style="width: 15px; height: 15px;"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        renderPagination({
            containerId: 'pagination-conversions',
            currentPage: page,
            totalItems: pag.total || 0,
            pageSize: 80,
            onPageChange: (p) => loadConversionsPage(p)
        });

        applyRoleRestrictions();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.error('Error fetching conversions:', e);
        showToast(e.message, 'error');
    }
}

function debounceConversionsSearch() {
    clearTimeout(conversionsDebounceTimer);
    conversionsDebounceTimer = setTimeout(() => {
        loadConversionsPage(1);
    }, 350);
}

function resetConversionsFilter() {
    const sEl = document.getElementById('conversions-search');
    const stEl = document.getElementById('conversions-filter-status');
    const fromEl = document.getElementById('conversions-date-from');
    const toEl = document.getElementById('conversions-date-to');
    if (sEl) sEl.value = '';
    if (stEl) stEl.value = 'all';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    loadConversionsPage(1);
}

async function openCreateConversionModal() {
    await ensureProductsLoadedForConversion();

    // Reset date to today WITA
    const dateInput = document.getElementById('conv-date');
    if (dateInput) {
        dateInput.value = typeof getTodayWITA === 'function' ? getTodayWITA() : new Date().toISOString().split('T')[0];
    }

    // Populate dropdowns
    const srcSelect = document.getElementById('conv-source-product');
    const tgtSelect = document.getElementById('conv-target-product');

    if (srcSelect && tgtSelect) {
        const optionsHtml = '<option value="">-- Pilih Produk --</option>' +
            allProductsForConversion.map(p => {
                const stockDisplay = parseFloat(p.stock || 0);
                const unitStr = p.unit || p.unit_name || p.unit_id || '';
                return `<option value="${p.id}" data-stock="${stockDisplay}" data-unit="${unitStr}" data-cost="${parseFloat(p.cost_price || 0)}">${p.name} (Stok: ${stockDisplay} ${unitStr})</option>`;
            }).join('');

        srcSelect.innerHTML = optionsHtml;
        tgtSelect.innerHTML = optionsHtml;
    }

    // Reset fields
    const srcQty = document.getElementById('conv-source-qty');
    const tgtQty = document.getElementById('conv-target-qty');
    const notes = document.getElementById('conv-notes');
    if (srcQty) srcQty.value = '';
    if (tgtQty) tgtQty.value = '';
    if (notes) notes.value = '';

    const srcStockDisp = document.getElementById('conv-source-stock-display');
    if (srcStockDisp) srcStockDisp.textContent = 'Stok: -';

    const srcUnitLbl = document.getElementById('conv-source-unit-label');
    const tgtUnitLbl = document.getElementById('conv-target-unit-label');
    if (srcUnitLbl) srcUnitLbl.textContent = 'Satuan';
    if (tgtUnitLbl) tgtUnitLbl.textContent = 'Satuan';

    const warn = document.getElementById('conv-source-stock-warning');
    if (warn) warn.style.display = 'none';

    const ratioBox = document.getElementById('conv-ratio-info-box');
    if (ratioBox) ratioBox.style.display = 'none';

    const adminValText = document.getElementById('conv-admin-value-text');
    if (adminValText) adminValText.textContent = 'Pilih produk sumber & qty untuk melihat estimasi nilai yang dipindah.';

    const btnSave = document.getElementById('btn-save-conversion');
    if (btnSave) btnSave.disabled = false;

    applyRoleRestrictions();
    openModal('modal-create-conversion');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function onConvSourceProductChanged() {
    const srcSelect = document.getElementById('conv-source-product');
    const selectedOpt = srcSelect?.options[srcSelect.selectedIndex];
    const stock = selectedOpt ? parseFloat(selectedOpt.dataset.stock || 0) : 0;
    const unit = selectedOpt ? (selectedOpt.dataset.unit || '-') : '-';

    const stockDisp = document.getElementById('conv-source-stock-display');
    if (stockDisp) {
        stockDisp.textContent = selectedOpt && selectedOpt.value ? `Stok: ${stock} ${unit}` : 'Stok: -';
    }

    const unitLbl = document.getElementById('conv-source-unit-label');
    if (unitLbl) {
        unitLbl.textContent = unit !== '-' ? unit : 'Satuan';
    }

    updateConversionRatioInfo();
}

function onConvTargetProductChanged() {
    const tgtSelect = document.getElementById('conv-target-product');
    const selectedOpt = tgtSelect?.options[tgtSelect.selectedIndex];
    const unit = selectedOpt ? (selectedOpt.dataset.unit || '-') : '-';

    const unitLbl = document.getElementById('conv-target-unit-label');
    if (unitLbl) {
        unitLbl.textContent = unit !== '-' ? unit : 'Satuan';
    }

    updateConversionRatioInfo();
}

function updateConversionRatioInfo() {
    const srcSelect = document.getElementById('conv-source-product');
    const tgtSelect = document.getElementById('conv-target-product');
    const srcQtyInput = document.getElementById('conv-source-qty');
    const tgtQtyInput = document.getElementById('conv-target-qty');
    const warn = document.getElementById('conv-source-stock-warning');
    const btnSave = document.getElementById('btn-save-conversion');

    const srcOpt = srcSelect?.options[srcSelect.selectedIndex];
    const tgtOpt = tgtSelect?.options[tgtSelect.selectedIndex];

    const currentStock = srcOpt ? parseFloat(srcOpt.dataset.stock || 0) : 0;
    const srcCost = srcOpt ? parseFloat(srcOpt.dataset.cost || 0) : 0;
    const srcUnit = srcOpt ? (srcOpt.dataset.unit || 'satuan') : 'satuan';
    const tgtUnit = tgtOpt ? (tgtOpt.dataset.unit || 'satuan') : 'satuan';

    const sQty = parseFloat(srcQtyInput?.value || 0);
    const tQty = parseFloat(tgtQtyInput?.value || 0);

    // Warning stok sumber melebihi stok tersedia
    if (srcOpt && srcOpt.value && sQty > currentStock) {
        if (warn) warn.style.display = 'block';
        if (btnSave) btnSave.disabled = true;
    } else {
        if (warn) warn.style.display = 'none';
        if (btnSave) btnSave.disabled = false;
    }

    // Info rasio kewajaran real-time
    const ratioBox = document.getElementById('conv-ratio-info-box');
    const ratioText = document.getElementById('conv-ratio-info-text');
    if (sQty > 0 && tQty > 0) {
        const ratio = (tQty / sQty).toFixed(4).replace(/\.?0+$/, '');
        if (ratioBox && ratioText) {
            ratioText.innerHTML = `<strong>Info Kewajaran:</strong> Rata-rata 1 ${srcUnit} menghasilkan ≈ <strong>${ratio} ${tgtUnit}</strong> (Hasil: ${tQty} ${tgtUnit} ÷ Sumber: ${sQty} ${srcUnit}).`;
            ratioBox.style.display = 'block';
        }
    } else {
        if (ratioBox) ratioBox.style.display = 'none';
    }

    // Info nilai & HPP (Admin only)
    const adminValText = document.getElementById('conv-admin-value-text');
    if (adminValText) {
        if (srcOpt && srcOpt.value && sQty > 0) {
            const movedVal = srcCost * sQty;
            const hppStr = typeof formatRupiah === 'function' ? formatRupiah(srcCost) : 'Rp ' + srcCost.toLocaleString('id-ID');
            const movedValStr = typeof formatRupiah === 'function' ? formatRupiah(movedVal) : 'Rp ' + movedVal.toLocaleString('id-ID');
            adminValText.innerHTML = `HPP Sumber Snapshot: <strong>${hppStr}</strong> / ${srcUnit} &nbsp;|&nbsp; Total Nilai Dipindah: <strong>${movedValStr}</strong>`;
        } else {
            adminValText.textContent = 'Pilih produk sumber & qty untuk melihat estimasi nilai yang dipindah.';
        }
    }
}

async function submitCreateConversion() {
    const date = document.getElementById('conv-date')?.value;
    const source_product_id = document.getElementById('conv-source-product')?.value;
    const source_qty = parseFloat(document.getElementById('conv-source-qty')?.value || 0);
    const target_product_id = document.getElementById('conv-target-product')?.value;
    const target_qty = parseFloat(document.getElementById('conv-target-qty')?.value || 0);
    const notes = (document.getElementById('conv-notes')?.value || '').trim();

    if (!date) {
        showToast('Tanggal konversi wajib diisi', 'error');
        return;
    }
    if (!source_product_id || !target_product_id) {
        showToast('Pilih produk sumber dan produk tujuan', 'error');
        return;
    }
    if (source_product_id === target_product_id) {
        showToast('Produk sumber dan produk tujuan tidak boleh sama', 'error');
        return;
    }
    if (isNaN(source_qty) || source_qty <= 0) {
        showToast('Qty sumber harus lebih besar dari 0', 'error');
        return;
    }
    if (isNaN(target_qty) || target_qty <= 0) {
        showToast('Qty hasil harus lebih besar dari 0', 'error');
        return;
    }

    const srcOpt = document.getElementById('conv-source-product')?.options[document.getElementById('conv-source-product').selectedIndex];
    const tgtOpt = document.getElementById('conv-target-product')?.options[document.getElementById('conv-target-product').selectedIndex];
    const availableStock = parseFloat(srcOpt?.dataset?.stock || 0);

    if (source_qty > availableStock) {
        showToast(`Stok produk sumber tidak mencukupi (Tersedia: ${availableStock}, Diminta: ${source_qty})`, 'error');
        return;
    }

    const srcName = srcOpt?.text?.split(' (Stok:')[0] || 'Produk Sumber';
    const tgtName = tgtOpt?.text?.split(' (Stok:')[0] || 'Produk Tujuan';
    const srcUnit = srcOpt?.dataset?.unit || '';
    const tgtUnit = tgtOpt?.dataset?.unit || '';

    // Konfirmasi dialog sebelum simpan
    const confirmed = confirm(
        `Konfirmasi Konversi Produk:\n\n` +
        `• Produk Sumber: ${srcName} (${source_qty} ${srcUnit})\n` +
        `• Produk Tujuan: ${tgtName} (${target_qty} ${tgtUnit})\n\n` +
        `Stok sumber akan dikurangi dan stok tujuan akan ditambah secara permanen. Lanjutkan?`
    );
    if (!confirmed) return;

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/conversions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                date,
                source_product_id,
                source_qty,
                target_product_id,
                target_qty,
                notes
            })
        });

        const json = await res.json();
        if (!res.ok) {
            throw new Error(json.error || 'Gagal menyimpan konversi');
        }

        showToast(json.message || 'Konversi produk berhasil disimpan!', 'success');
        closeModal('modal-create-conversion');
        loadConversionsPage(1);

        // Refresh master products in POS/dashboard if needed
        if (typeof fetchProducts === 'function') fetchProducts();
    } catch (e) {
        console.error('Error creating conversion:', e);
        showToast(e.message, 'error');
    }
}

async function viewConversionDetail(id) {
    try {
        const token = localStorage.getItem('token');
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canSeeVal = role === 'admin' || role === 'owner';

        const res = await fetch(`/api/conversions/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Gagal memuat detail konversi');
        }

        const conv = await res.json();
        currentActiveConversionDetail = conv;

        // Set elements
        const numEl = document.getElementById('conv-detail-number');
        const dateEl = document.getElementById('conv-detail-date');
        const badgeEl = document.getElementById('conv-detail-status-badge');
        if (numEl) numEl.textContent = conv.number;
        if (dateEl) dateEl.textContent = `Tanggal: ${conv.date}`;

        if (badgeEl) {
            const statusLabel = conv.status === 'posted' ? 'Posted' : (conv.status === 'cancelled' ? 'Dibatalkan' : conv.status);
            badgeEl.innerHTML = `<span class="badge-status ${conv.status}">${statusLabel}</span>`;
        }

        // Sumber
        const sNameEl = document.getElementById('conv-detail-source-name');
        const sSkuEl = document.getElementById('conv-detail-source-sku');
        const sQtyEl = document.getElementById('conv-detail-source-qty');
        const sHppEl = document.getElementById('conv-detail-source-hpp');
        if (sNameEl) sNameEl.textContent = conv.source_product_name || '-';
        if (sSkuEl) sSkuEl.textContent = `SKU: ${conv.source_product_sku || '-'}`;
        if (sQtyEl) sQtyEl.textContent = `-${parseFloat(conv.source_qty || 0)} ${conv.source_unit || ''}`;
        if (sHppEl) {
            sHppEl.textContent = canSeeVal
                ? `HPP Snapshot: ${typeof formatRupiah === 'function' ? formatRupiah(conv.source_hpp_snapshot || 0) : 'Rp ' + Number(conv.source_hpp_snapshot || 0).toLocaleString('id-ID')}`
                : '';
        }

        // Tujuan
        const tNameEl = document.getElementById('conv-detail-target-name');
        const tSkuEl = document.getElementById('conv-detail-target-sku');
        const tQtyEl = document.getElementById('conv-detail-target-qty');
        const tHppEl = document.getElementById('conv-detail-target-hpp');
        if (tNameEl) tNameEl.textContent = conv.target_product_name || '-';
        if (tSkuEl) tSkuEl.textContent = `SKU: ${conv.target_product_sku || '-'}`;
        if (tQtyEl) tQtyEl.textContent = `+${parseFloat(conv.target_qty || 0)} ${conv.target_unit || ''}`;
        if (tHppEl) {
            tHppEl.textContent = canSeeVal
                ? `HPP Setelah: ${typeof formatRupiah === 'function' ? formatRupiah(conv.target_hpp_after || 0) : 'Rp ' + Number(conv.target_hpp_after || 0).toLocaleString('id-ID')}`
                : '';
        }

        // Rasio & Info Nilai
        const ratioEl = document.getElementById('conv-detail-ratio');
        if (ratioEl) {
            const ratio = (conv.target_qty / conv.source_qty).toFixed(4).replace(/\.?0+$/, '');
            ratioEl.textContent = `1 ${conv.source_unit} ≈ ${ratio} ${conv.target_unit}`;
        }

        const movedValEl = document.getElementById('conv-detail-moved-val');
        if (movedValEl) {
            movedValEl.textContent = canSeeVal
                ? (typeof formatRupiah === 'function' ? formatRupiah(conv.moved_value || 0) : 'Rp ' + Number(conv.moved_value || 0).toLocaleString('id-ID'))
                : '-';
        }

        const targetBeforeEl = document.getElementById('conv-detail-target-before');
        if (targetBeforeEl) {
            targetBeforeEl.textContent = canSeeVal
                ? `Stok: ${parseFloat(conv.target_stock_before || 0)} | HPP: ${typeof formatRupiah === 'function' ? formatRupiah(conv.target_hpp_before || 0) : 'Rp ' + Number(conv.target_hpp_before || 0).toLocaleString('id-ID')}`
                : '-';
        }

        const targetAfterEl = document.getElementById('conv-detail-target-after');
        if (targetAfterEl) {
            targetAfterEl.textContent = canSeeVal
                ? (typeof formatRupiah === 'function' ? formatRupiah(conv.target_hpp_after || 0) : 'Rp ' + Number(conv.target_hpp_after || 0).toLocaleString('id-ID'))
                : '-';
        }

        // Info Pembuat
        const creatorEl = document.getElementById('conv-detail-creator');
        const createdAtEl = document.getElementById('conv-detail-created-at');
        if (creatorEl) creatorEl.textContent = conv.created_by_name || '-';
        if (createdAtEl) createdAtEl.textContent = conv.created_at ? String(conv.created_at).replace('T', ' ').slice(0, 19) : '-';

        // Info Pembatalan
        const cancelSection = document.getElementById('conv-detail-cancelled-section');
        const cancellerEl = document.getElementById('conv-detail-canceller');
        const cancelledAtEl = document.getElementById('conv-detail-cancelled-at');
        const cancelReasonEl = document.getElementById('conv-detail-cancel-reason');
        if (cancelSection) {
            if (conv.status === 'cancelled') {
                cancelSection.style.display = 'block';
                if (cancellerEl) cancellerEl.textContent = conv.cancelled_by_name || '-';
                if (cancelledAtEl) cancelledAtEl.textContent = conv.cancelled_at ? String(conv.cancelled_at).replace('T', ' ').slice(0, 19) : '-';
                if (cancelReasonEl) cancelReasonEl.textContent = conv.cancel_reason || '-';
            } else {
                cancelSection.style.display = 'none';
            }
        }

        // Catatan
        const notesEl = document.getElementById('conv-detail-notes');
        if (notesEl) notesEl.textContent = conv.notes || '-';

        // Tombol Batalkan Konversi (hanya tampil jika status posted)
        const btnCancel = document.getElementById('btn-trigger-cancel-conv');
        if (btnCancel) {
            btnCancel.style.display = (conv.status === 'posted') ? 'inline-flex' : 'none';
        }

        applyRoleRestrictions();
        openModal('modal-detail-conversion');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.error('Error viewing conversion detail:', e);
        showToast(e.message, 'error');
    }
}

function promptCancelConversion() {
    if (!currentActiveConversionDetail) return;
    const targetIdInput = document.getElementById('conv-cancel-target-id');
    if (targetIdInput) targetIdInput.value = currentActiveConversionDetail.id;

    const reasonInput = document.getElementById('conv-cancel-reason-input');
    if (reasonInput) reasonInput.value = '';

    closeModal('modal-detail-conversion');
    openModal('modal-cancel-conversion');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function submitCancelConversion() {
    const reasonInput = document.getElementById('conv-cancel-reason-input');
    const reason = (reasonInput?.value || '').trim();

    if (!reason) {
        showToast('Alasan pembatalan wajib diisi', 'error');
        return;
    }

    if (!currentActiveConversionDetail) {
        showToast('Data konversi tidak valid', 'error');
        return;
    }

    const confirmed = confirm(
        `Konfirmasi Pembatalan Dokumen Konversi:\n\n` +
        `Nomor: ${currentActiveConversionDetail.number}\n` +
        `Alasan: "${reason}"\n\n` +
        `Stok sumber akan dikembalikan dan stok tujuan akan dikurangi. Lanjutkan pembatalan?`
    );
    if (!confirmed) return;

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/conversions/${currentActiveConversionDetail.id}/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ cancel_reason: reason })
        });

        const json = await res.json();
        if (!res.ok) {
            throw new Error(json.error || 'Gagal membatalkan konversi');
        }

        showToast(json.message || 'Konversi berhasil dibatalkan', 'success');
        closeModal('modal-cancel-conversion');
        loadConversionsPage(conversionsCurrentPage);

        // Refresh master products in POS/dashboard if needed
        if (typeof fetchProducts === 'function') fetchProducts();
    } catch (e) {
        console.error('Error cancelling conversion:', e);
        showToast(e.message, 'error');
    }
}

// Window attachments for inline HTML handlers
window.loadConversionsPage = loadConversionsPage;
window.debounceConversionsSearch = debounceConversionsSearch;
window.resetConversionsFilter = resetConversionsFilter;
window.openCreateConversionModal = openCreateConversionModal;
window.onConvSourceProductChanged = onConvSourceProductChanged;
window.onConvTargetProductChanged = onConvTargetProductChanged;
window.updateConversionRatioInfo = updateConversionRatioInfo;
window.submitCreateConversion = submitCreateConversion;
window.viewConversionDetail = viewConversionDetail;
window.promptCancelConversion = promptCancelConversion;
window.submitCancelConversion = submitCancelConversion;

