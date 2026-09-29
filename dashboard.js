// ==========================================================================
// SupplierPro Dashboard — JavaScript
// ==========================================================================

// Auth check
if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

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
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
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

function rpShort(n) {
    if (n >= 1_000_000_000) return 'Rp ' + (n / 1_000_000_000).toFixed(1) + 'M';
    if (n >= 1_000_000) return 'Rp ' + (n / 1_000_000).toFixed(1) + 'jt';
    if (n >= 1_000) return 'Rp ' + (n / 1_000).toFixed(0) + 'rb';
    return rp(n);
}

// ---------- Dynamic Data ----------
let PRODUCTS = [];
let CUSTOMERS = [];
let VENDORS = [];

let INVOICES = [];
let PURCHASES = [];
let CASH_TRANSACTIONS = [];
let USERS = [];

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
};

// ---------- Role Based Access Control (RBAC) ----------
const ROLE_PERMISSIONS = {
    admin: ['dashboard', 'pos', 'products', 'customers', 'vendors', 'purchases', 'invoices', 'piutang', 'hutang', 'cashflow', 'profitloss', 'balance', 'reports', 'settings', 'roles', 'master-data', 'customerfee'],
    finance: ['dashboard', 'piutang', 'hutang', 'cashflow', 'profitloss', 'balance', 'reports'],
    gudang: ['dashboard', 'products', 'purchases', 'vendors'],
    kasir: ['dashboard', 'pos', 'customers', 'invoices', 'piutang']
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
        showToast('Akses ditolak: Anda tidak memiliki wewenang untuk halaman ini.', 'error');
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

    if (page === 'settings') {
        loadCompanyProfile();
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

// ---------- Modal Helpers ----------
function openModal(id) {
    document.getElementById(id).classList.add('active');
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
    document.getElementById(id).classList.remove('active');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
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
        console.error('Failed to fetch dashboard summary', err);
    }
}

async function fetchSalesTrend(days = 7) {
    try {
        const res = await fetch(`/api/dashboard/sales-trend?days=${days}`, { headers: getAuthHeaders() });
        if (res.ok) {
            SALES_CHART_DATA = await res.json();
        }
    } catch (err) {
        console.error('Failed to fetch sales trend', err);
    }
}

async function fetchSalesComposition(days = 30) {
    try {
        const res = await fetch(`/api/dashboard/sales-composition?days=${days}`, { headers: getAuthHeaders() });
        if (res.ok) {
            DONUT_DATA = await res.json();
        }
    } catch (err) {
        console.error('Failed to fetch sales composition', err);
    }
}

let currentTrendDays = 7;
let currentCompositionDays = 30;

async function refreshCharts() {
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
    try {
        const res = await fetch('/api/finance/reconciliation-status', { headers: getAuthHeaders() });
        if (res.ok) {
            const data = await res.json();
            const alertEl = document.getElementById('reconciliation-alert');
            const alertText = document.getElementById('reconciliation-alert-text');
            if (data.success && data.status && !data.status.balanced) {
                alertText.innerHTML = `Ditemukan ketidaksesuaian data keuangan pada pencatatan otomatis harian. Masalah:<br/>` + 
                    data.status.issues.map(issue => `• ${issue}`).join('<br/>') +
                    `<br/><span style="font-weight: 600; margin-top: 0.5rem; display: inline-block;">Silakan periksa laporan keuangan dan log transaksi cash flow.</span>`;
                alertEl.style.display = 'block';
                if (window.lucide) window.lucide.createIcons();
            } else {
                alertEl.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('Failed to fetch reconciliation status', err);
    }
}

function renderDashboard() {
    checkReconciliationStatus();
    renderSummaryCards();
    renderSalesChart();
    renderDonutChart();
    renderRecentTransactions();
    renderLowStock();
}

function renderSummaryCards() {
    // Prioritize fetched API summary, fallback to computed values from loaded arrays
    const totalOmzet = DASHBOARD_SUMMARY?.revenue ?? INVOICES.filter(i => i.status.toLowerCase() !== 'batal').reduce((s, i) => s + i.total, 0);
    const totalPiutang = DASHBOARD_SUMMARY?.receivables ?? INVOICES.filter(i => i.status.toLowerCase() !== 'lunas' && i.status.toLowerCase() !== 'batal').reduce((s, i) => s + (i.total - i.paid), 0);
    const totalHutang = DASHBOARD_SUMMARY?.payables ?? PURCHASES.filter(p => p.status.toLowerCase() !== 'selesai' && p.status.toLowerCase() !== 'batal').reduce((s, p) => s + (p.total - p.paid), 0);
    const lowStockCount = DASHBOARD_SUMMARY?.lowStockCount ?? PRODUCTS.filter(p => p.stock <= p.minStock).length;
    const labaKotor = DASHBOARD_SUMMARY?.grossProfit ?? (totalOmzet * 0.28);
    const ordersToday = DASHBOARD_SUMMARY?.ordersToday ?? (() => {
        const today = new Date().toISOString().split('T')[0];
        return INVOICES.filter(i => (i.date || '').startsWith(today) && i.status.toLowerCase() !== 'batal').length;
    })();
    const activeCustomers = DASHBOARD_SUMMARY?.customerCount ?? CUSTOMERS.length;
    const totalProducts = DASHBOARD_SUMMARY?.productCount ?? PRODUCTS.length;

    const cards = [
        { label: 'Omzet Bulan Ini', value: rpShort(totalOmzet), trend: 'Total penjualan', trendDir: 'up', icon: 'trending-up', color: 'blue' },
        { label: 'Total Piutang', value: rpShort(totalPiutang), trend: totalPiutang > 0 ? 'Belum terbayar' : 'Semua lunas', trendDir: totalPiutang > 0 ? 'down' : 'up', icon: 'hand-coins', color: 'amber' },
        { label: 'Total Hutang', value: rpShort(totalHutang), trend: totalHutang > 0 ? 'Ke vendor' : 'Semua lunas', trendDir: totalHutang > 0 ? 'down' : 'up', icon: 'landmark', color: 'rose' },
        { label: 'Stok Menipis', value: lowStockCount + ' produk', trend: lowStockCount > 0 ? 'Perlu restock' : 'Stok aman', trendDir: lowStockCount > 0 ? 'down' : 'up', icon: 'alert-triangle', color: 'orange' },
        { label: 'Laba Kotor', value: rpShort(labaKotor), trend: labaKotor >= 0 ? 'Revenue - HPP' : 'Rugi', trendDir: labaKotor >= 0 ? 'up' : 'down', icon: 'wallet', color: 'emerald' },
        { label: 'Order Hari Ini', value: ordersToday + ' transaksi', trend: 'Hari ini', trendDir: 'up', icon: 'shopping-cart', color: 'indigo' },
        { label: 'Pelanggan Aktif', value: activeCustomers + ' pelanggan', trend: 'Terdaftar', trendDir: 'up', icon: 'users', color: 'violet' },
        { label: 'Produk Terdaftar', value: totalProducts + ' produk', trend: 'Katalog', trendDir: 'up', icon: 'package', color: 'cyan' },
    ];

    const grid = document.getElementById('summary-grid');
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
    const tbody = document.getElementById('recent-transactions-body');
    tbody.innerHTML = INVOICES.slice(0, 5).map(inv => `
        <tr>
            <td style="font-weight:600; color: var(--blue-600);">${inv.id}</td>
            <td>${inv.customer}</td>
            <td style="font-weight:600;">${rp(inv.total)}</td>
            <td><span class="badge-status ${inv.status}">${capitalize(inv.status)}</span></td>
        </tr>
    `).join('');
}

function renderLowStock() {
    const lowStock = PRODUCTS.filter(p => p.stock <= p.minStock);
    const tbody = document.getElementById('low-stock-body');
    tbody.innerHTML = lowStock.map(p => `
        <tr>
            <td style="font-weight: 600;">${p.name}</td>
            <td style="font-weight: 700; color: var(--rose-500);">${p.stock}</td>
            <td>${p.minStock}</td>
            <td><span class="badge-status rendah">Rendah</span></td>
        </tr>
    `).join('');

    if (lowStock.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--gray-400); padding:2rem;">Semua stok aman ✓</td></tr>';
    }
}

// ---------- Products Page ----------
function renderProducts(filter = '', category = '') {
    const tbody = document.getElementById('products-body');
    let filtered = PRODUCTS;
    if (filter) {
        const q = filter.toLowerCase();
        filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    if (category && category !== 'all') {
        filtered = filtered.filter(p => p.category === category);
    }

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

// Search & filter bindings for products
document.getElementById('product-search')?.addEventListener('input', (e) => {
    renderProducts(e.target.value, document.getElementById('product-category-filter').value);
});
document.getElementById('product-category-filter')?.addEventListener('change', (e) => {
    renderProducts(document.getElementById('product-search').value, e.target.value);
});

// ---------- Customers Page ----------
let customerViewMode = 'kanban';

function renderCustomers(filter = '', type = '') {
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
                <td style="font-weight:600;">${c.name}</td>
                <td><span class="badge-status aman">${c.type}</span></td>
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
        `}).join('');
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

document.getElementById('customer-search')?.addEventListener('input', (e) => {
    renderCustomers(e.target.value, document.getElementById('customer-type-filter').value);
});
document.getElementById('customer-type-filter')?.addEventListener('change', (e) => {
    renderCustomers(document.getElementById('customer-search').value, e.target.value);
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
                    <div class="entity-type">${v.category} • ${v.city}</div>
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
                    <span class="entity-detail-value" style="color: ${v.debt > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'}; font-weight:700;">${v.debt > 0 ? rp(v.debt) : 'Lunas ✓'}</span>
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
                <td style="font-weight:700; color: ${v.debt > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">${v.debt > 0 ? rp(v.debt) : 'Lunas ✓'}</td>
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

document.getElementById('vendor-search')?.addEventListener('input', (e) => {
    renderVendors(e.target.value);
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
function renderPiutang(filter = '') {
    if (!filter || typeof filter !== 'string') {
        const sel = document.getElementById('piutang-status-filter');
        filter = sel ? sel.value : 'all';
    }
    // Summary
    const piutangInvoices = INVOICES.filter(i => !['lunas', 'batal'].includes(i.status.toLowerCase()));
    const totalPiutang = piutangInvoices.reduce((s, i) => s + (i.total - i.paid), 0);
    // Backend stores 'Belum Bayar' (not 'belum') — match with includes() to handle both formats
    const belumBayar = INVOICES.filter(i => i.status.toLowerCase().includes('belum')).reduce((s, i) => s + i.total, 0);
    const sebagian = INVOICES.filter(i => i.status.toLowerCase() === 'sebagian').reduce((s, i) => s + (i.total - i.paid), 0);

    document.getElementById('piutang-summary').innerHTML = `
        <div class="finance-summary-card highlight">
            <div class="fs-value">${rp(totalPiutang)}</div>
            <div class="fs-label">Total Piutang</div>
        </div>
        <div class="finance-summary-card">
            <div class="fs-value" style="color: var(--rose-500);">${rp(belumBayar)}</div>
            <div class="fs-label">Belum Dibayar</div>
        </div>
        <div class="finance-summary-card">
            <div class="fs-value" style="color: var(--amber-500);">${rp(sebagian)}</div>
            <div class="fs-label">Dibayar Sebagian</div>
        </div>
    `;

    // Table
    const tbody = document.getElementById('piutang-body');
    // Hide 'batal' (cancelled) invoices by default
    let filtered = INVOICES.filter(i => i.status.toLowerCase() !== 'batal');

    if (filter && filter !== 'all') {
        filtered = filtered.filter(i => {
            if (filter === 'belum bayar' || filter === 'belum') {
                return i.status.toLowerCase().includes('belum');
            }
            return i.status.toLowerCase() === filter;
        });
    }
    const searchEl = document.getElementById('piutang-search');
    if (searchEl && searchEl.value) {
        const q = searchEl.value.toLowerCase();
        filtered = filtered.filter(i =>
            i.id.toLowerCase().includes(q) ||
            (i.customer && i.customer.toLowerCase().includes(q))
        );
    }

    tbody.innerHTML = filtered.map(inv => {
        const sisa = inv.total - inv.paid;
        return `
            <tr>
                <td style="font-weight:600; color: var(--blue-600);">${inv.id}</td>
                <td>${inv.customer}</td>
                <td style="font-weight:700;">${rp(inv.total)}</td>
                <td>${rp(inv.paid)}</td>
                <td style="font-weight:700; color: ${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'}">${rp(sisa)}</td>
                <td>${inv.dueDate || '-'}</td>
                <td>${inv.status.toLowerCase().includes('belum') ? '-' : (inv.paidDate || '-')}</td>
                <td>${inv.status.toLowerCase().includes('belum') ? '-' : (inv.type || '-')}</td>
                <td><span class="badge-status ${inv.status.toLowerCase().includes('belum') ? 'belum' : inv.status.toLowerCase().replace(/\s+/g, '-')}">${capitalize(inv.status)}</span></td>
                <td>${inv.status.toLowerCase() !== 'lunas' ? `<button class="btn-toolbar primary" style="padding:0.3rem 0.65rem; font-size:0.75rem;" onclick="openPiutangPaymentModal('${inv.id}', ${sisa})">Input Bayar</button>` : '—'}</td>
            </tr>
        `;
    }).join('');
}

// ---------- Hutang Page ----------
function renderHutang(filter = '') {
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

    tbody.innerHTML = purchaseData.map(p => {
        const sisa = p.total - p.paid;
        const st = sisa > 0 ? 'belum' : 'lunas';
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
                <td>${sisa > 0 ? `<button class="btn-toolbar primary" style="padding:0.3rem 0.65rem; font-size:0.75rem;" onclick="openHutangPaymentModal('${p.id}', ${sisa})">Bayar</button>` : '—'}</td>
            </tr>
        `;
    }).join('');
}

// ---------- Cash Flow Page ----------
function renderCashFlow(filter = '') {
    // Untuk summary, hanya hitung transaksi aktif
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
            <td><span class="badge-status ${t.type.toLowerCase()}">${t.type === 'IN' ? '↑ Masuk' : '↓ Keluar'}</span></td>
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
    let filtered = PRODUCTS;
    if (searchTerm) {
        const q = searchTerm.toLowerCase();
        filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
    }
    if (category && category !== 'all') {
        filtered = filtered.filter(p => p.category === category);
    }

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

    const existing = cart.find(c => c.id === productId);
    if (existing) {
        existing.qty += 1;
    } else {
        // Initialize with fee fields
        cart.push({ ...product, qty: 1, fee: 0, feeNotes: '' });
    }
    renderCart();
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
                    <div class="cart-item-name">${item.emoji} ${item.name}</div>
                    <div class="cart-item-price-edit" style="display:flex; align-items:center; gap:0.25rem;">
                        <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                        <input type="number" value="${item.price}" onchange="updateCartPrice('${item.id}', this.value)" style="width:70px; padding:0.1rem 0.25rem; font-size:0.875rem; border:1px solid var(--gray-200); border-radius:0.25rem;" />
                        <span style="font-size:0.75rem; color:var(--gray-500);">/ ${item.unit}</span>
                    </div>
                </div>
                <div class="cart-item-qty">
                    <button class="cart-qty-btn" onclick="updateCartQty('${item.id}', -1)">−</button>
                    <span class="cart-qty-val">${item.qty}</span>
                    <button class="cart-qty-btn" onclick="updateCartQty('${item.id}', 1)">+</button>
                </div>
                <div class="cart-item-total">${rp(item.price * item.qty)}</div>
                <button class="cart-item-remove" onclick="removeFromCart('${item.id}')"><i data-lucide="trash-2"></i></button>
            </div>
            ${isAdmin ? `
            <div class="cart-item-fee-row">
                <span class="cart-item-fee-label">🔒 Fee (Rp)</span>
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
            renderCart();
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
    const ppnAmount = subtotal * (currentPpnRate / 100);
    const total = subtotal + ppnAmount;

    // Tempo/credit: no upfront payment; all other methods (Tunai, Transfer, etc.) = full paid
    const paid = isTempo ? 0 : total;

    console.log(`[Checkout] payment_type_id=${payment_type_id} | name=${payTypeName} | isTempo=${isTempo} | paid=${paid} | total=${total}`);

    const payload = {
        customer_id: customerId,
        total: total,
        paid: paid,
        payment_type_id: payment_type_id,
        due_date: calculateDueDate(getPaymentTypeName(paymentTypeSelect), new Date().toISOString()),
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

            cart = [];
            document.getElementById('pos-customer-id').value = '';
            document.getElementById('pos-customer-search').value = '';
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

// Populate customer select in POS
function populateCustomerSelect(filter = '') {
    const dropdown = document.getElementById('pos-customer-dropdown');
    if (!dropdown) return;

    let filtered = CUSTOMERS;
    if (filter) {
        const q = filter.toLowerCase();
        filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 0.75rem; color: var(--gray-400); text-align: center; font-size: 0.875rem;">Pelanggan tidak ditemukan</div>';
        return;
    }

    dropdown.innerHTML = filtered.map(c => `
        <div class="customer-dropdown-item" data-id="${c.id}" data-name="${c.name}" style="padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--gray-100); display: flex; flex-direction: column; transition: background-color 0.2s;">
            <span style="font-weight: 500; font-size: 0.875rem;">${c.name}</span>
            <span style="font-size: 0.75rem; color: var(--gray-500);">${c.type} • ${c.phone}</span>
        </div>
    `).join('');

    // Add click listeners to items
    dropdown.querySelectorAll('.customer-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            document.getElementById('pos-customer-search').value = name;
            document.getElementById('pos-customer-id').value = id;
            dropdown.style.display = 'none';
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
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('pos-customer-search');
    const dropdown = document.getElementById('pos-customer-dropdown');
    const toggle = document.getElementById('pos-customer-dropdown-toggle');

    if (searchInput && dropdown) {
        searchInput.addEventListener('focus', () => {
            populateCustomerSelect(searchInput.value);
            dropdown.style.display = 'block';
        });

        searchInput.addEventListener('input', (e) => {
            populateCustomerSelect(e.target.value);
            dropdown.style.display = 'block';
            document.getElementById('pos-customer-id').value = '';
        });

        toggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            } else {
                populateCustomerSelect(searchInput.value);
                dropdown.style.display = 'block';
                searchInput.focus();
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.customer-search-wrapper')) {
                dropdown.style.display = 'none';
            }
        });
    }
});

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
                case 'cashflow': renderCashFlow(filter); break;
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

function calculateDueDate(paymentTypeName, transactionDateStr) {
    if (!paymentTypeName) return '';
    const nameLower = paymentTypeName.toLowerCase();
    // Match both: 'Kredit X Hari' (Indonesian) and 'Credit X Hari' (English)
    const isCredit = nameLower.includes('kredit') || nameLower.includes('credit');
    if (!isCredit) return '';
    const match = paymentTypeName.match(/(kredit|credit)\s+(\d+)\s+hari/i);
    if (match && match[2]) {
        const days = parseInt(match[2], 10);
        const date = new Date(transactionDateStr);
        if (!isNaN(date.getTime())) {
            date.setDate(date.getDate() + days);
            return date.toISOString().split('T')[0];
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

    // Populate dropdowns and fetch all data from DB
    await populateMasterDropdowns();
    await Promise.all([
        fetchDashboardSummary(),
        fetchProducts(),
        fetchCustomers(),
        fetchVendors(),
        fetchPurchases(),
        fetchInvoices(),
        fetchCashTransactions(),
        fetchUsers(),
        loadPrefixSettings(),
        loadInvoicePreferences(),
        loadLandingDemoSetting()
    ]);

    // Re-render dashboard with real DB data
    renderDashboard();
    renderInvoices();
    renderPiutang();
    renderHutang();

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
    'Content-Type': 'application/json'
});

async function fetchProducts() {
    try {
        const res = await fetch('/api/products', { headers: getAuthHeaders() });
        const data = await res.json();
        PRODUCTS = data.map(p => ({
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
            emoji: '📦'
        }));
        renderProducts(document.getElementById('product-search')?.value, document.getElementById('product-category-filter')?.value);
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
            await fetchProducts();
        } else {
            const err = await res.json();
            showToast('Error: ' + (err.error || 'Gagal menyimpan produk'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
}

function openEditProductModal(id) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    document.getElementById('edit-product-id').value = p.id;
    const brandEl = document.getElementById('edit-product-brand');
    if (brandEl) brandEl.value = p.brand || '';
    document.getElementById('edit-product-name').value = p.name;
    document.getElementById('edit-product-sku').value = p.sku;
    // FIX: set category select — try both category_id and category name
    const catEl = document.getElementById('edit-product-category');
    if (catEl) {
        // Try setting by value (which is the name from master)
        catEl.value = p.category || '';
        if (!catEl.value && p.category_id) catEl.value = p.category_id;
    }
    document.getElementById('edit-product-cost').value = p.cost;
    document.getElementById('edit-product-price').value = p.price;
    document.getElementById('edit-product-stock').value = p.stock;
    document.getElementById('edit-product-minstock').value = p.minStock;
    const unitEl = document.getElementById('edit-product-unit');
    if (unitEl) unitEl.value = p.unit_id || p.unit || '';
    openModal('modal-edit-product');
}

// ==========================================================================
// STOCK OPNAME
// ==========================================================================
let stockOpnameProductId = null;

function openStockOpnameModal(id) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    stockOpnameProductId = p.id;
    const nameEl = document.querySelector('#modal-stock-opname .form-group:nth-child(1) input');
    const stockEl = document.querySelector('#modal-stock-opname .form-row .form-group:first-child input');
    const actualEl = document.querySelector('#modal-stock-opname .form-row .form-group:last-child input');
    const noteEl = document.querySelector('#modal-stock-opname textarea');
    if (nameEl) nameEl.value = p.name;
    if (stockEl) stockEl.value = p.stock;
    if (actualEl) actualEl.value = '';
    if (noteEl) noteEl.value = '';
    openModal('modal-stock-opname');
}

async function submitStockOpname() {
    if (!stockOpnameProductId) return;
    const actualEl = document.querySelector('#modal-stock-opname .form-row .form-group:last-child input');
    const noteEl = document.querySelector('#modal-stock-opname textarea');
    const actual = parseInt(actualEl ? actualEl.value : '');
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
            stockOpnameProductId = null;
            await fetchProducts();
        } else {
            const err = await res.json();
            showToast('Gagal: ' + (err.error || 'Terjadi kesalahan'), 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
}

async function deleteProduct(id) {
    if (!confirm('Yakin ingin menghapus produk ini?')) return;
    try {
        const res = await fetch(`/api/products/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            fetchProducts();
        } else {
            alert('Gagal menghapus produk');
        }
    } catch (err) {
        console.error(err);
    }
}

async function fetchCustomers() {
    try {
        const res = await fetch('/api/customers', { headers: getAuthHeaders() });
        const data = await res.json();
        CUSTOMERS = data.map(c => ({
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
            color: 'blue'
        }));
        renderCustomers(document.getElementById('customer-search')?.value, document.getElementById('customer-type-filter')?.value);
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
        nib: document.getElementById(`${prefix}-customer-nib`)?.value.trim() || null,
        email: email || null,
        no_hp_2: document.getElementById(`${prefix}-customer-no-hp-2`)?.value.trim() || null
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
            fetchCustomers();
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
    const fields = ['name', 'city', 'phone', 'limit', 'no-hp-2', 'email', 'ktp', 'npwp', 'nib'];
    fields.forEach(f => {
        const el = document.getElementById(`add-customer-${f}`);
        if (el) el.value = '';
    });
    const addrEl = document.getElementById('add-customer-address');
    if (addrEl) addrEl.value = '';
    const typeEl = document.getElementById('add-customer-type');
    if (typeEl) typeEl.selectedIndex = 0;
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
    const nibEl = document.getElementById('edit-customer-nib');
    if (nibEl) nibEl.value = c.nib || '';
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
    const nibEl = document.getElementById('detail-customer-nib');
    if (nibEl) nibEl.textContent = c.nib || '-';

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
            fetchCustomers();
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

async function fetchVendors() {
    try {
        const res = await fetch('/api/vendors', { headers: getAuthHeaders() });
        const data = await res.json();
        VENDORS = data.map(v => ({
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
        }));

        // Populate vendor dropdowns in PO modals
        const vendorOptions = '<option value="" disabled selected>- Pilih Vendor -</option>' +
            VENDORS.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
        const addVendorEl = document.getElementById('add-purchase-vendor');
        if (addVendorEl) addVendorEl.innerHTML = vendorOptions;
        const editVendorEl = document.getElementById('edit-purchase-vendor');
        if (editVendorEl) editVendorEl.innerHTML = vendorOptions;

        renderVendors(document.getElementById('vendor-search')?.value);
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
            fetchVendors();
        } else {
            const err = await res.json();
            alert('Error: ' + err.error);
        }
    } catch (err) {
        console.error(err);
        alert('Gagal menyimpan vendor');
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
            fetchVendors();
        } else {
            alert('Gagal menghapus vendor');
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================================================
// PURCHASE ORDERS — CRUD
// ==========================================================================

async function fetchPurchases() {
    try {
        const res = await fetch(`/api/purchases?_t=${Date.now()}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok || data.error) {
            showToast('Gagal memuat data purchase, coba lagi.', 'error');
            return;
        }
        PURCHASES = data;
        renderPurchases();
    } catch (err) {
        console.error('Failed to fetch purchases', err);
        showToast('Gagal memuat data purchase, coba lagi.', 'error');
    }
}

let addPurchaseItems = [];

function renderAddPurchaseItems() {
    const container = document.getElementById('add-purchase-items-container');
    if (!container) return;

    container.innerHTML = '';
    let subtotal = 0;

    addPurchaseItems.forEach((item, index) => {
        const product = PRODUCTS.find(p => p.id === item.product_id) || { name: item.product_id, unit: 'pcs' };
        const itemTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0);
        subtotal += itemTotal;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 0.5rem;">
                <div style="font-weight: 500; color: var(--gray-900);">${product.name}</div>
            </td>
            <td style="padding: 0.5rem; text-align: center; white-space: nowrap;">
                <input type="number" min="1" value="${item.quantity}" onchange="updateAddPurchaseItemQty(${index}, this.value)" style="width: 60px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: center;">
                <span style="font-size: 0.8rem; color: var(--gray-500); margin-left: 0.25rem;">${product.unit || 'pcs'}</span>
            </td>
            <td style="padding: 0.5rem; text-align: right;">
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.25rem;">
                    <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                    <input type="number" value="${item.price}" onchange="updateAddPurchaseItemPrice(${index}, this.value)" style="width: 80px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: right;">
                </div>
            </td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: var(--gray-900);">
                ${rp(itemTotal)}
            </td>
            <td style="padding: 0.5rem; text-align: center;">
                <button type="button" onclick="removeAddPurchaseItem(${index})" style="color: var(--rose-500); background: none; border: none; cursor: pointer; padding: 0.25rem;">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </td>
        `;
        container.appendChild(tr);
    });

    if (addPurchaseItems.length === 0) {
        container.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 1rem; color: var(--gray-500);">Belum ada item.</td></tr>`;
    }

    document.getElementById('add-purchase-subtotal-display').textContent = rp(subtotal);
    document.getElementById('add-purchase-total-display').textContent = rp(subtotal);

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.addAddPurchaseItem = () => {
    const select = document.getElementById('add-purchase-product-select');
    if (!select || !select.value) return;

    const prod = PRODUCTS.find(p => p.id === select.value);
    if (!prod) return;

    const existing = addPurchaseItems.find(i => i.product_id === prod.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        addPurchaseItems.push({
            product_id: prod.id,
            quantity: 1,
            price: prod.cost || prod.price || 0
        });
    }
    renderAddPurchaseItems();
};

window.removeAddPurchaseItem = (index) => {
    addPurchaseItems.splice(index, 1);
    renderAddPurchaseItems();
};

window.updateAddPurchaseItemQty = (index, val) => {
    const qty = parseInt(val);
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
    // Reset all fields
    const vendorEl = document.getElementById('add-purchase-vendor');
    const dateEl = document.getElementById('add-purchase-date');
    const paidEl = document.getElementById('add-purchase-paid');
    const ptEl = document.getElementById('add-purchase-payment-type');
    const selectEl = document.getElementById('add-purchase-product-select');

    if (vendorEl) vendorEl.selectedIndex = 0;
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    if (paidEl) paidEl.value = '';
    if (ptEl) ptEl.selectedIndex = 0;

    // Populate product select if not populated yet
    if (selectEl && selectEl.options.length <= 1) {
        const productOptions = PRODUCTS.map(p => `<option value="${p.id}">${p.name} (Stok: ${p.stock})</option>`).join('');
        selectEl.innerHTML = `<option value="" disabled selected>Pilih Produk...</option>${productOptions}`;
    }

    onPurchasePaymentTypeChange('add');

    addPurchaseItems = [];
    renderAddPurchaseItems();
    openModal('modal-add-purchase');
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
                <input type="number" min="1" value="${item.quantity}" onchange="updateEditPurchaseItemQty(${index}, this.value)" style="width: 60px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: center;">
                <span style="font-size: 0.8rem; color: var(--gray-500); margin-left: 0.25rem;">${product.unit || 'pcs'}</span>
            </td>
            <td style="padding: 0.5rem; text-align: right;">
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.25rem;">
                    <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                    <input type="number" value="${itemPrice}" onchange="updateEditPurchaseItemPrice(${index}, this.value)" style="width: 80px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: right;">
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
    const qty = parseInt(val);
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
    const container = document.getElementById('edit-purchase-items-container');
    if (container) container.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem; color: var(--gray-400);">Memuat data item...</td></tr>';

    try {
        const res = await fetch(`/api/purchases/${encodeURIComponent(id)}/items?_t=${Date.now()}`, { headers: getAuthHeaders() });
        if (res.ok) {
            editPurchaseItems = await res.json();
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

async function savePurchase(isEdit) {
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

    const total = itemsToSave.reduce((s, i) => s + i.total, 0);

    let dueDate = document.getElementById(`${prefix}-purchase-due-date`)?.value || '';
    if (!dueDate) {
        dueDate = calculateDueDate(getPaymentTypeName(document.getElementById(`${prefix}-purchase-payment-type`)), document.getElementById(`${prefix}-purchase-date`)?.value);
    }

    const payTypeName = getPaymentTypeName(document.getElementById(`${prefix}-purchase-payment-type`)).toLowerCase();
    const isKredit = payTypeName.includes('kredit') || payTypeName.includes('credit');
    const paidInput = parseFloat(document.getElementById(`${prefix}-purchase-paid`)?.value || 0);
    // Jika bukan kredit (Tunai/Transfer), paid otomatis = total (Lunas)
    const paid = isKredit ? paidInput : total;

    const payload = {
        vendor_id: document.getElementById(`${prefix}-purchase-vendor`)?.value || '',
        date: document.getElementById(`${prefix}-purchase-date`)?.value || '',
        total: total,
        paid: paid,
        payment_type_id: document.getElementById(`${prefix}-purchase-payment-type`)?.value || '',
        due_date: dueDate,
        items: itemsToSave
    };

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

async function fetchInvoices() {
    try {
        // FIX: correct endpoint is /api/invoices not /api/sales; cache buster prevents stale data after checkout
        const res = await fetch(`/api/invoices?_t=${Date.now()}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok || data.error) {
            showToast('Gagal memuat data invoice, coba lagi.', 'error');
            return;
        }
        INVOICES = data;
        renderInvoices();
        renderPiutang();
        renderSummaryCards();
        renderRecentTransactions();
        refreshCharts();
    } catch (err) {
        console.error('Failed to fetch invoices', err);
        showToast('Gagal memuat data invoice, coba lagi.', 'error');
    }
}

let editInvoiceItems = [];

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
                <input type="number" min="1" value="${item.quantity}" onchange="updateEditInvoiceItemQty(${index}, this.value)" style="width: 60px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: center;">
            </td>
            <td style="padding: 0.5rem; text-align: right;">
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.25rem;">
                    <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                    <input type="number" value="${item.price}" onchange="updateEditInvoiceItemPrice(${index}, this.value)" style="width: 80px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: 0.25rem; text-align: right;">
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
            </td>` : '<td></td>'}
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

    const ppn = subtotal * 0.11;
    const grandTotal = subtotal + ppn;

    document.getElementById('edit-invoice-subtotal').textContent = rp(subtotal);
    document.getElementById('edit-invoice-ppn').textContent = rp(ppn);
    document.getElementById('edit-invoice-total').textContent = rp(grandTotal);

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.addEditInvoiceItem = () => {
    const select = document.getElementById('edit-invoice-product-select');
    if (!select || !select.value) return;

    const prod = PRODUCTS.find(p => p.id === select.value);
    if (!prod) return;

    const existing = editInvoiceItems.find(i => i.product_id === prod.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        editInvoiceItems.push({
            product_id: prod.id,
            quantity: 1,
            price: prod.price
        });
    }
    renderEditInvoiceItems();
};

window.removeEditInvoiceItem = (index) => {
    editInvoiceItems.splice(index, 1);
    renderEditInvoiceItems();
};

window.updateEditInvoiceItemQty = (index, val) => {
    const qty = parseInt(val);
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

async function openEditInvoiceModal(id) {
    const inv = INVOICES.find(x => x.id === id);
    if (!inv) return;

    document.getElementById('edit-invoice-id').value = inv.id;
    document.getElementById('edit-invoice-number-display').value = inv.id;
    document.getElementById('edit-invoice-date').value = inv.date || '';
    document.getElementById('edit-invoice-customer-display').value = inv.customer || '';

    const statusEl = document.getElementById('edit-invoice-status');
    if (statusEl) {
        const statusLower = (inv.status || '').toLowerCase();
        statusEl.value = statusLower === 'lunas' ? 'lunas' : (statusLower === 'sebagian' ? 'sebagian' : 'belum');
    }

    // Populate product select
    const select = document.getElementById('edit-invoice-product-select');
    if (select) {
        select.innerHTML = '<option value="" disabled selected>- Pilih Produk -</option>' +
            PRODUCTS.map(p => `<option value="${p.id}">${p.name} (${rp(p.price)})</option>`).join('');
    }

    // Reset items and show loading
    editInvoiceItems = [];
    const container = document.getElementById('edit-invoice-items-container');
    if (container) container.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem; color: var(--gray-400);">Memuat data item...</td></tr>';

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/items`, { headers: getAuthHeaders() });
        if (res.ok) {
            editInvoiceItems = await res.json();
        } else {
            console.warn('Failed to load invoice items, status:', res.status);
        }
    } catch (err) {
        console.error('Failed to load invoice items', err);
    }
    // Always render — will show 'Belum ada item' if array empty
    renderEditInvoiceItems();

    openModal('modal-edit-invoice');
}

async function saveInvoiceEdits() {
    const id = document.getElementById('edit-invoice-id').value;
    if (!id) return;

    const date = document.getElementById('edit-invoice-date').value;
    const status = document.getElementById('edit-invoice-status').value;

    const inv = INVOICES.find(x => x.id === id);
    const customer_id = inv ? inv.customerId : null;

    const subtotal = editInvoiceItems.reduce((s, i) => s + (parseFloat(i.price) * parseInt(i.quantity)), 0);
    const total = subtotal * 1.11; // including 11% tax

    // Determine paid amount based on old paid amount. If it was fully paid, should we adjust paid amount?
    // Let's assume paid_amount stays the same unless it exceeds new total.
    let paid_amount = inv ? inv.paid : 0;
    if (status === 'lunas') {
        paid_amount = total;
    } else if (status === 'belum') {
        paid_amount = 0;
    } else {
        if (paid_amount > total) paid_amount = total;
    }

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                date,
                status,
                customer_id,
                total,
                paid_amount,
                payment_type_id: inv ? inv.paymentTypeId : 'PT-1',
                items: editInvoiceItems
            })
        });
        if (res.ok) {
            closeModal('modal-edit-invoice');
            showToast('Invoice berhasil diperbarui!', 'success');
            await fetchInvoices();
            await fetchProducts(); // stock changed
        } else {
            let errMsg = 'Gagal menyimpan invoice';
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (e) {
                if (res.status === 401 || res.status === 403) errMsg = 'Sesi habis, silakan login ulang.';
                else errMsg = `Error ${res.status} dari server.`;
            }
            showToast('Error: ' + errMsg, 'error');
            if (res.status === 401 || res.status === 403) setTimeout(() => window.location.reload(), 1500);
        }
    } catch (err) {
        console.error(err);
        showToast('Gagal menghubungi server', 'error');
    }
}

let cancelInvoiceId = null;

async function cancelInvoice(id) {
    cancelInvoiceId = id;
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
            await fetchInvoices();
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
            await fetchPurchases();
            await fetchProducts();
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
    document.getElementById('modal-cancel-purchase').querySelector('strong').textContent = id;
    openModal('modal-cancel-purchase');
};

window.cancelPurchaseFromEdit = () => {
    const id = document.getElementById('edit-purchase-id')?.value;
    if (id) {
        window.cancelPurchase(id);
    }
};// ==========================================================================
// CASH FLOW — CRUD
// ==========================================================================

async function fetchCashTransactions() {
    try {
        const res = await fetch('/api/finance/cash-flow', { headers: getAuthHeaders() });
        const data = await res.json();
        CASH_TRANSACTIONS = data;
        renderCashFlow();
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
            fetchCashTransactions();
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
            fetchCashTransactions();
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
            fetchCashTransactions();
            fetchInvoices();
            fetchPurchases();
        } else {
            const err = await res.json();
            showToast('Error: ' + err.error, 'error');
        }
    } catch (err) {
        showToast('Gagal membatalkan transaksi', 'error');
    }
}


// FIX: helper to open hutang payment modal with correct PO id pre-filled
function openHutangPaymentModal(poId, sisa) {
    const typeEl = document.getElementById('payment-type');
    const refEl = document.getElementById('payment-ref-id');
    const amtEl = document.getElementById('payment-amount');
    if (typeEl) typeEl.value = 'payable';
    if (refEl) refEl.value = poId;
    if (amtEl) amtEl.value = sisa || '';
    openModal('modal-payment');
}

// FIX: helper to open piutang payment modal with correct invoice id pre-filled
function openPiutangPaymentModal(invoiceId, sisa) {
    const typeEl = document.getElementById('payment-type');
    const refEl = document.getElementById('payment-ref-id');
    const amtEl = document.getElementById('payment-amount');
    if (typeEl) typeEl.value = 'receivable';
    if (refEl) refEl.value = invoiceId;
    if (amtEl) amtEl.value = sisa || '';
    openModal('modal-payment');
}

async function submitPayment() {
    const typeEl = document.getElementById('payment-type');
    const isReceivable = typeEl ? typeEl.value === 'receivable' : false;
    const id = document.getElementById('payment-ref-id').value;
    const amount = document.getElementById('payment-amount').value;
    const methodEl = document.getElementById('payment-method');
    const method = methodEl ? methodEl.value : 'Transfer Bank';

    if (!id || !amount || parseFloat(amount) <= 0) {
        showToast('ID dan jumlah pembayaran wajib diisi!', 'warning');
        return;
    }

    // FIX: use correct endpoints
    const url = isReceivable
        ? `/api/finance/receivables/${encodeURIComponent(id)}/pay`
        : `/api/finance/payables/${encodeURIComponent(id)}/pay`;

    let paymentSuccess = false;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ amount: parseFloat(amount), payment_type_id: method })
        });
        if (res.ok) {
            paymentSuccess = true;
            closeModal('modal-payment');
            showToast('Pembayaran berhasil dicatat!', 'success');
        } else {
            let errMsg = 'Gagal memproses pembayaran';
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (e) {
                if (res.status === 401 || res.status === 403) errMsg = 'Sesi habis, silakan login ulang.';
                else errMsg = `Error ${res.status} dari server.`;
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
    document.getElementById('staff-password').value = ''; // Leave empty if no change
    document.getElementById('staff-email').value = u.email || '';
    document.getElementById('staff-role').value = u.role;
    document.getElementById('staff-status').value = u.active ? 'true' : 'false';
    openModal('modal-add-staff');
}

function openAddStaffModal() {
    document.getElementById('modal-add-staff').querySelector('h3').textContent = 'Tambah Staff';
    document.getElementById('staff-id').value = '';
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-username').value = '';
    document.getElementById('staff-username').disabled = false;
    document.getElementById('staff-password').value = '';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-role').value = 'kasir';
    document.getElementById('staff-status').value = 'true';
    openModal('modal-add-staff');
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
            fetchUsers();
        } else {
            const err = await res.json();
            alert('Error: ' + err.error);
        }
    } catch (err) {
        console.error(err);
        alert('Gagal menyimpan staff');
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
            fetchUsers();
        } else {
            const err = await res.json();
            alert('Gagal menghapus: ' + err.error);
        }
    } catch (err) {
        console.error(err);
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
        await fetchAndFill('/api/master/payment-types', ['cart-payment-type', 'add-purchase-payment-type', 'edit-purchase-payment-type', 'edit-invoice-payment-type', 'payment-method', 'manual-invoice-payment-type'], 'id', 'name');

        // Restore cart payment type from frontend state variable
        const cartPaymentTypeSelect = document.getElementById('cart-payment-type');
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
            fetchMasterData();
            populateMasterDropdowns(); // refresh all dropdowns after master change
        } else {
            alert('Gagal menyimpan: ' + (result.error || 'Error tidak diketahui'));
        }
    } catch (err) {
        alert('Error: ' + err.message);
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
            fetchMasterData();
        } else {
            alert('Gagal menghapus: ' + (result.error || 'Error tidak diketahui'));
        }
    } catch (err) {
        alert('Error: ' + err.message);
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
let currentPpnEnabled = true;
let transactionCount = 0;
let pendingPpnToggleState = true;

async function loadInvoicePreferences() {
    try {
        const [resSet, resCount] = await Promise.all([
            fetch('/api/settings', { headers: getAuthHeaders() }),
            fetch('/api/transactions/count', { headers: getAuthHeaders() })
        ]);

        if (resSet.ok) {
            const settings = await resSet.json();
            currentPpnEnabled = settings.ppn_enabled !== 'false';
            currentPpnRate = parseFloat(settings.pajak_default || 11);
            
            const ppnCheck = document.getElementById('settings-ppn-enabled');
            if (ppnCheck) ppnCheck.checked = currentPpnEnabled;
            
            const ppnInput = document.getElementById('settings-ppn');
            if (ppnInput) {
                ppnInput.value = currentPpnRate;
                ppnInput.disabled = !currentPpnEnabled;
            }
        }

        if (resCount.ok) {
            const countData = await resCount.json();
            transactionCount = parseInt(countData.count || 0, 10);
            console.log('Loaded transaction count for PPN toggle:', transactionCount);
        }
        
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

            if (productEl) productEl.value = settings.prefix_product ?? 'P';
            if (customerEl) customerEl.value = settings.prefix_customer ?? 'C';
            if (vendorEl) vendorEl.value = settings.prefix_vendor ?? 'V';
            if (cashTxEl) cashTxEl.value = settings.prefix_cash_transaction ?? 'CT';
            if (purchaseEl) purchaseEl.value = settings.prefix_purchase ?? 'PO/{YYYY}/{MM}/';
            if (salesEl) salesEl.value = settings.prefix_sales ?? 'INV/{YYYY}/{MM}/';
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
        prefix_sales: document.getElementById('settings-prefix-sales')?.value || 'INV/{YYYY}/{MM}/'
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Pengaturan prefix penomoran berhasil disimpan!', 'success');
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
            fetchInvoices();
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
    'invoice': 'Invoice'
};

function openImportModal(section) {
    currentImportSection = section;
    selectedImportFile = null;

    // Set Title
    const titleEl = document.getElementById('import-modal-title');
    if (titleEl) titleEl.innerText = `Import Data ${sectionTitles[section] || section}`;

    // Reset Dropzone & Input
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.value = '';

    // Reset Modal States
    document.getElementById('import-state-initial').style.display = 'block';
    document.getElementById('import-state-progress').style.display = 'none';
    document.getElementById('import-state-result').style.display = 'none';

    // Show normal footer buttons
    const footer = document.getElementById('import-modal-footer');
    footer.style.display = 'flex';
    footer.innerHTML = `
        <button class="btn-toolbar secondary" id="import-btn-cancel" onclick="closeImportModal()">Batal</button>
        <button class="btn-toolbar primary" id="import-btn-submit" onclick="startImportProcess()"
            style="opacity:0.5;cursor:not-allowed;pointer-events:none;">
            <i data-lucide="upload"></i> Proses Import
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
        }
    } else {
        if (contentDiv) {
            contentDiv.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;font-weight:600;color:var(--gray-800);">
                    <span>📄 ${file.name}</span>
                    <button onclick="event.stopPropagation(); setImportFile(null);" style="background:transparent;border:none;color:var(--rose-500);font-size:1.2rem;cursor:pointer;font-weight:bold;padding:0 0.25rem;">×</button>
                </div>
            `;
        }
        if (btnSubmit) {
            btnSubmit.style.opacity = '1';
            btnSubmit.style.cursor = 'pointer';
            btnSubmit.style.pointerEvents = 'auto';
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
        headers = ["Nama", "Tipe", "Telepon", "Kota", "Alamat", "Limit Piutang"];
        rows = [
            ["Toko Berkah Jaya", "Reseller", "089696469991", "Kota Denpasar", "Jl. Sunia Negara No. 33", 10000000],
            ["Warung Sari Rasa", "Warung", "085936103383", "Denpasar", "Jl. Sunia Negara No. 33 Pemogan", 2000000]
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
        headers = ["Tanggal", "Nama Customer", "Total", "Terbayar", "Tipe Pembayaran", "Jatuh Tempo"];
        rows = [
            ["2026-06-12", "Toko Berkah Jaya", 1154400, 1154400, "Tunai", "2026-06-12"],
            ["2026-06-12", "Warung Sari Rasa", 406260, 406260, "Transfer", "2026-06-12"]
        ];
        filename = "sample_invoice.xlsx";
    }

    const data = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, filename);
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
            await executeImport(rows);
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
            const catsRes = await fetch('/api/master/customer-categories', { headers: getAuthHeaders() });
            const cats = await catsRes.json();
            cats.forEach(c => categoriesMap[c.name.toLowerCase().trim()] = c.id);
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
                            name, customer_category_id, phone, city, address, credit_lmt: limit
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

function closeImportAndRefresh() {
    closeImportModal();
    // Refresh table data
    if (currentImportSection === 'produk') {
        fetchProducts();
    } else if (currentImportSection === 'pelanggan') {
        fetchCustomers();
    } else if (currentImportSection === 'vendor') {
        fetchVendors();
    } else if (currentImportSection === 'pembelian') {
        fetchPurchases();
    } else if (currentImportSection === 'invoice') {
        fetchInvoices();
    }
}

function exportSection(section) {
    let headers = [];
    let rows = [];
    let filename = "";

    if (section === 'produk') {
        headers = ["SKU", "Nama Produk", "Brand/Merk", "Kategori", "Harga Beli", "Harga Jual", "Stok", "Stok Minimum", "Satuan"];
        rows = PRODUCTS.map(p => [
            p.sku || '',
            p.name || '',
            p.brand || '',
            p.category || '',
            p.cost || 0,
            p.price || 0,
            p.stock || 0,
            p.minStock || 0,
            p.unit || ''
        ]);
        filename = "export_produk.xlsx";
    } else if (section === 'pelanggan') {
        headers = ["Nama", "Tipe", "Telepon", "Kota", "Alamat", "Limit Piutang"];
        rows = CUSTOMERS.map(c => [
            c.name || '',
            c.type || '',
            c.phone || '',
            c.city || '',
            c.address || '',
            c.creditLimit || 0
        ]);
        filename = "export_pelanggan.xlsx";
    } else if (section === 'vendor') {
        headers = ["Nama", "Kategori", "Telepon", "Kota", "Alamat", "No. Identitas", "Bank", "No. Rekening", "Pemilik Rekening"];
        rows = VENDORS.map(v => [
            v.name || '',
            v.category || '',
            v.phone || '',
            v.city || '',
            v.address || '',
            v.idNumber || '',
            v.bank || '',
            v.rekening || '',
            v.pemilik || ''
        ]);
        filename = "export_vendor.xlsx";
    } else if (section === 'pembelian') {
        headers = ["Tanggal", "Nama Vendor", "Total", "Terbayar", "Tipe Pembayaran", "Jatuh Tempo"];
        rows = PURCHASES.map(p => [
            p.date || '',
            p.vendor || '',
            p.total || 0,
            p.paid || 0,
            p.type || '',
            p.dueDate || ''
        ]);
        filename = "export_pembelian.xlsx";
    } else if (section === 'invoice') {
        headers = ["Tanggal", "Nama Customer", "Total", "Terbayar", "Tipe Pembayaran", "Jatuh Tempo"];
        rows = INVOICES.map(i => [
            i.date || '',
            i.customer || '',
            i.total || 0,
            i.paid || 0,
            i.type || '',
            i.dueDate || ''
        ]);
        filename = "export_invoice.xlsx";
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

