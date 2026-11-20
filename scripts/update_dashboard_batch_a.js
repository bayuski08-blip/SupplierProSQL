const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'dashboard.js');
let code = fs.readFileSync(filePath, 'utf8');

console.log('Original length:', code.length);

// 1. Add ComboboxSelect class and state variables around line 208
const searchVar = 'let PRODUCTS = [];';
if (!code.includes('class ComboboxSelect')) {
    const comboboxClassCode = `// ==========================================================================
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

                let codeHtml = item.code ? \`<span class="code">\${item.code}</span>\` : '';
                div.innerHTML = \`
                    <span class="label">\${item.label}</span>
                    \${codeHtml}
                \`;

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

        this.dropdown.classList.add('show');
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
`;
    code = code.replace(searchVar, comboboxClassCode + '\n' + searchVar);
    console.log('✓ Injected ComboboxSelect class and variables');
}

// 2. Call initAddPurchaseVendorCombobox in DOMContentLoaded
const domLoadTarget = `initPOSCustomerSearch();\n        initPoProductSearch();`;
if (code.includes(domLoadTarget) && !code.includes('initAddPurchaseVendorCombobox();')) {
    code = code.replace(
        domLoadTarget,
        `initPOSCustomerSearch();\n        initPoProductSearch();\n        initAddPurchaseVendorCombobox();`
    );
    // Also the else branch
    const domLoadElseTarget = `initPOSCustomerSearch();\n    initPoProductSearch();`;
    code = code.replace(
        domLoadElseTarget,
        `initPOSCustomerSearch();\n    initPoProductSearch();\n    initAddPurchaseVendorCombobox();`
    );
    console.log('✓ Wired initAddPurchaseVendorCombobox in DOMContentLoaded');
}

// 3. Update fetchVendors to feed Combobox
const fetchVendorsTarget = `const addVendorEl = document.getElementById('add-purchase-vendor');\n        if (addVendorEl) addVendorEl.innerHTML = vendorOptions;`;
if (code.includes(fetchVendorsTarget)) {
    code = code.replace(
        fetchVendorsTarget,
        `if (window.addPurchaseVendorCombobox) {\n            window.addPurchaseVendorCombobox.setData(\n                VENDORS.map(v => ({ id: v.id, label: v.name, code: v.idNumber || '' }))\n            );\n        }`
    );
    console.log('✓ Updated fetchVendors to set combobox data');
}

// 4. Update openAddPurchaseModal and savePurchase
const openPoVendorTarget = `if (vendorEl) vendorEl.selectedIndex = 0;`;
if (code.includes(openPoVendorTarget)) {
    code = code.replace(
        openPoVendorTarget,
        `if (vendorEl) vendorEl.value = '';\n    if (window.addPurchaseVendorCombobox) window.addPurchaseVendorCombobox.reset();`
    );
    console.log('✓ Updated openAddPurchaseModal to reset combobox');
}

const savePurchaseTarget = `const total = itemsToSave.reduce((s, i) => s + i.total, 0);`;
if (code.includes(savePurchaseTarget)) {
    code = code.replace(
        savePurchaseTarget,
        `const vendorVal = document.getElementById(\`\${prefix}-purchase-vendor\`)?.value || '';\n    if (!vendorVal) {\n        showToast('Pilih vendor terlebih dahulu!', 'warning');\n        return;\n    }\n    const total = itemsToSave.reduce((s, i) => s + i.total, 0);`
    );
    console.log('✓ Added vendor_id validation to savePurchase');
}

// 5. Update renderPoDropdown to filter inactive products
const renderPoListTarget = `const productList = Array.isArray(PRODUCTS) ? PRODUCTS : [];`;
if (code.includes(renderPoListTarget)) {
    code = code.replace(
        renderPoListTarget,
        `const productList = (Array.isArray(PRODUCTS) ? PRODUCTS : []).filter(p => p.is_active !== 0 && p.is_active !== false);`
    );
    console.log('✓ Updated renderPoDropdown to filter inactive products');
}

// 6. Update navigateTo for POS
const navigatePosTarget = `if (typeof populateCustomerSelect === 'function') {\n            populateCustomerSelect(document.getElementById('pos-customer-search')?.value || '');\n        }`;
if (code.includes(navigatePosTarget) && !code.includes('ensureProductsLoadedForPOS().then')) {
    code = code.replace(
        navigatePosTarget,
        `ensureProductsLoadedForPOS().then(() => {\n            renderPOSProducts();\n            if (typeof populateCustomerSelect === 'function') {\n                populateCustomerSelect(document.getElementById('pos-customer-search')?.value || '');\n            }\n        });`
    );
    console.log('✓ Updated navigateTo POS to lazy-load active products');
}

// 7. Update init() to fetch only role-permitted endpoints
const initPromiseTarget = `    // Populate dropdowns and fetch all data from DB
    await populateMasterDropdowns();
    await Promise.all([
        fetchDashboardSummary(),
        fetchProducts(),
        fetchCustomers(),
        fetchPricelists(),
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
    renderHutang();`;

const initPromiseReplacement = `    // Populate dropdowns and fetch role-permitted data from DB (A7: eliminate 403 storm)
    await populateMasterDropdowns();

    const loggedRole = (localStorage.getItem('role') || 'kasir').toLowerCase();
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
            loadInvoicePreferences(),
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
    if (['admin', 'finance'].includes(loggedRole)) {
        renderHutang();
    }`;

if (code.includes(initPromiseTarget)) {
    code = code.replace(initPromiseTarget, initPromiseReplacement);
    console.log('✓ Updated init() for role-based data fetching and rendering');
}

// 8. Rewrite fetchProducts(page) and add product management helpers
const fetchProductsOldStart = 'async function fetchProducts(page) {';
const fetchProductsOldEnd = 'if (window.lucide) lucide.createIcons();\n    } catch (err) {\n        console.error(\'Failed to fetch products\', err);\n    }\n}';

const fetchProductsIdx = code.indexOf(fetchProductsOldStart);
const fetchProductsEndIdx = code.indexOf(fetchProductsOldEnd, fetchProductsIdx);

if (fetchProductsIdx !== -1 && fetchProductsEndIdx !== -1) {
    const fullOldFunc = code.slice(fetchProductsIdx, fetchProductsEndIdx + fetchProductsOldEnd.length);

    const newFetchProductsCode = `async function ensureProductsLoadedForPOS() {
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
    return String(str).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/"/g, '&quot;');
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
            warnText.innerHTML = \`Produk ini masih memiliki stok sebanyak <strong>\${stock}</strong>. Menonaktifkannya akan menyembunyikan produk dari POS, PO, dan transaksi baru.\`;
        }
        if (msgEl) {
            msgEl.innerHTML = \`Apakah Anda yakin ingin menonaktifkan produk <strong>"\${name}"</strong>?\`;
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
        const res = await fetch(\`/api/products/\${id}/status\`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ is_active })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || (is_active ? 'Produk berhasil diaktifkan!' : 'Produk berhasil dinonaktifkan!'), 'success');
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
        msgEl.innerHTML = \`Apakah Anda yakin ingin menghapus produk <strong>"\${name}"</strong>? Tindakan ini tidak dapat dibatalkan.\`;
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
        const res = await fetch(\`/api/products/\${id}\`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Produk berhasil dihapus!', 'success');
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
        const pg = paginationState.products.page;
        let url = '/api/products?page=' + pg + '&limit=' + PAGE_SIZE + '&status=' + encodeURIComponent(statusFilter);
        if (q) url += '&q=' + encodeURIComponent(q);
        if (category && category !== 'all') url += '&category=' + encodeURIComponent(category);

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
            cost: parseFloat(p.cost_price),
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

        const tbody = document.getElementById('products-body');
        if (!tbody) return;
        tbody.innerHTML = rows.map(p => {
            const pr = mapProduct(p);
            CURRENT_PAGE_PRODUCTS.set(String(pr.id), pr);

            const isActive = pr.is_active;
            const stockStatus = pr.stock <= pr.minStock ? 'rendah' : 'aman';
            const stockLabel = pr.stock <= pr.minStock ? 'Rendah' : 'Aman';
            const statusBadge = isActive
                ? \`<span class="badge-status \${stockStatus}">\${stockLabel}</span>\`
                : \`<span class="badge-status nonaktif">Nonaktif</span>\`;

            // A2.2: Tombol toggle status
            const toggleStatusBtn = isActive
                ? \`<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--amber-600);" title="Nonaktifkan Produk" onclick="confirmToggleProductStatus('\${pr.id}', 0, \${pr.stock}, '\${escapeJsString(pr.name)}')">
                    <i data-lucide="eye-off" style="width: 14px; height: 14px; margin: 0;"></i>
                   </button>\`
                : \`<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--emerald-600);" title="Aktifkan Produk" onclick="toggleProductStatus('\${pr.id}', 1)">
                    <i data-lucide="eye" style="width: 14px; height: 14px; margin: 0;"></i>
                   </button>\`;

            // A2.1: Proteksi Delete Produk
            let deleteBtn = '';
            if (pr.has_transactions) {
                deleteBtn = \`<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--gray-400); cursor: not-allowed; opacity: 0.5;" title="Produk sudah memiliki riwayat transaksi, gunakan Nonaktifkan" disabled>
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>\`;
            } else {
                deleteBtn = \`<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--rose-500);" title="Hapus Produk" onclick="confirmDeleteProduct('\${pr.id}', '\${escapeJsString(pr.name)}', \${pr.has_pricelists ? 1 : 0})">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                </button>\`;
            }

            return \`
            <tr style="\${isActive ? '' : 'opacity: 0.75; background: var(--gray-50);'}">
                <td><code style="background:var(--gray-100); padding:2px 6px; border-radius:4px; font-size:0.78rem;">\${pr.sku}</code></td>
                <td style="font-weight:600;">\${pr.name}</td>
                <td>\${pr.category || '-'}</td>
                <td>\${rp(pr.cost)}</td>
                <td style="font-weight:700;">\${rp(pr.price)}</td>
                <td style="font-weight:700;">\${pr.stock}</td>
                <td>\${pr.unit}</td>
                <td>\${pr.minStock}</td>
                <td>\${statusBadge}</td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Produk" onclick="openEditProductModal('\${pr.id}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    <button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; color: var(--blue-600);" title="Stock Opname" onclick="openStockOpnameModal('\${pr.id}')">
                        <i data-lucide="boxes" style="width: 14px; height: 14px; margin: 0;"></i>
                    </button>
                    \${toggleStatusBtn}
                    \${deleteBtn}
                </td>
            </tr>
            \`;
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
}`;

    code = code.replace(fullOldFunc, newFetchProductsCode);
    console.log('✓ Replaced fetchProducts with fast paginated + status filter + protection code');
}

// 9. Refactor openEditProductModal, openStockOpnameModal, submitStockOpname, and deleteProduct
const oldEditModalStart = 'function openEditProductModal(id) {';
const oldDeleteProdEnd = 'showToast(\'Gagal menghapus produk\', \'error\');\n    }\n}';
const editModalIdx = code.indexOf(oldEditModalStart);
const deleteProdEndIdx = code.indexOf(oldDeleteProdEnd, editModalIdx);

if (editModalIdx !== -1 && deleteProdEndIdx !== -1) {
    const oldSection = code.slice(editModalIdx, deleteProdEndIdx + oldDeleteProdEnd.length);

    const newSection = `async function openEditProductModal(id) {
    let p = CURRENT_PAGE_PRODUCTS.get(String(id));
    if (!p) {
        try {
            const res = await fetch(\`/api/products/\${id}\`, { headers: getAuthHeaders() });
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
    document.getElementById('edit-product-cost').value = p.cost;
    document.getElementById('edit-product-price').value = p.price;
    document.getElementById('edit-product-stock').value = p.stock;
    document.getElementById('edit-product-minstock').value = p.minStock;
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
            const res = await fetch(\`/api/products/\${id}\`, { headers: getAuthHeaders() });
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
    if (stockEl) stockEl.value = p.stock !== undefined ? p.stock : 0;
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
}`;

    code = code.replace(oldSection, newSection);
    console.log('✓ Replaced openStockOpnameModal and deleteProduct with instant & protected implementations');
}

// 10. Update fetchPiutang: remove bayarBtn
const piutangBayarTarget = `            if (canPayOrVoid) {
                const bayarBtn = statusLower !== 'lunas'
                    ? \`<button class="btn-toolbar primary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="openPiutangPaymentModal('\${inv.id}', \${sisa})">Bayar</button>\`
                    : '<span style="color:var(--gray-400);font-size:0.8rem;">Lunas</span>';
                
                // Requirement 2: Tombol Delete HANYA untuk invoice import outstanding
                const deleteBtn = inv.isOutstandingImport
                    ? \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;color:var(--rose-500);" title="Hapus Invoice Outstanding" onclick="confirmDeleteOutstandingInvoice('\${inv.id}', \${inv.paid || 0})"><i data-lucide="trash-2" style="width:13px;height:13px;margin:0;"></i></button>\`
                    : '';

                actionButtons = \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-right:0.25rem;" title="Riwayat Cicilan" onclick="openPaymentHistoryModal('\${inv.id}')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>\${bayarBtn}\${deleteBtn}\`;
            }`;

const piutangBayarReplacement = `            if (canPayOrVoid) {
                // A6: Sembunyikan tombol "Bayar" di setiap baris, sisakan tombol cicilan/riwayat bayar 3 garis
                const deleteBtn = inv.isOutstandingImport
                    ? \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;color:var(--rose-500);" title="Hapus Invoice Outstanding" onclick="confirmDeleteOutstandingInvoice('\${inv.id}', \${inv.paid || 0})"><i data-lucide="trash-2" style="width:13px;height:13px;margin:0;"></i></button>\`
                    : '';

                actionButtons = \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" title="Riwayat Cicilan & Bayar" onclick="openPaymentHistoryModal('\${inv.id}')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>\${deleteBtn}\`;
            }`;

if (code.includes(piutangBayarTarget)) {
    code = code.replace(piutangBayarTarget, piutangBayarReplacement);
    console.log('✓ Removed "Bayar" button from Piutang rows, keeping 3-line installment history button');
}

// 11. Replace remaining user-facing "pricelist" text with "Special Price" (A5)
const textReplacements = [
    ["karena pricelist mungkin berbeda", "karena Special Price mungkin berbeda"],
    ["Harga Master (tanpa pricelist)", "Harga Master (tanpa Special Price)"],
    ["dengan pricelist pelanggan.", "dengan Special Price pelanggan."],
    ['Belum ada pricelist yang sesuai. Klik "Buat Pricelist Baru" untuk memulai.', 'Belum ada Special Price yang sesuai. Klik "Buat Special Price Baru" untuk memulai.'],
    ["Nama pricelist wajib diisi!", "Nama Special Price wajib diisi!"],
    ["Gagal membuat pricelist", "Gagal membuat Special Price"],
    ["Nama pricelist tidak boleh kosong!", "Nama Special Price tidak boleh kosong!"],
    ["Pricelist berhasil diperbarui!", "Special Price berhasil diperbarui!"],
    ["Gagal memperbarui pricelist", "Gagal memperbarui Special Price"],
    ["Nama pricelist baru wajib diisi!", "Nama Special Price baru wajib diisi!"],
    ["Gagal menduplikat pricelist", "Gagal menduplikat Special Price"],
    ["pelanggan masih menggunakan pricelist ini. Pricelist hanya boleh dinonaktifkan.", "pelanggan masih menggunakan Special Price ini. Special Price hanya boleh dinonaktifkan."],
    ["Pricelist berhasil dihapus!", "Special Price berhasil dihapus!"],
    ["Gagal menghapus pricelist", "Gagal menghapus Special Price"],
    ["Gagal memuat detail pricelist", "Gagal memuat detail Special Price"],
    ["Hapus produk ini dari pricelist?", "Hapus produk ini dari Special Price?"],
    ["Produk dihapus dari pricelist", "Produk dihapus dari Special Price"],
    ["produk terpilih dari pricelist ini?", "produk terpilih dari Special Price ini?"],
    ["produk berhasil ditambahkan ke pricelist!", "produk berhasil ditambahkan ke Special Price!"],
    ["Gagal menyimpan item ke pricelist", "Gagal menyimpan item ke Special Price"],
    ["produk berhasil diimpor ke pricelist!", "produk berhasil diimpor ke Special Price!"]
];

textReplacements.forEach(([from, to]) => {
    if (code.includes(from)) {
        code = code.split(from).join(to);
        console.log(`✓ Renamed user-facing text: "${from}" -> "${to}"`);
    }
});

fs.writeFileSync(filePath, code, 'utf8');
console.log('Successfully updated dashboard.js. New length:', code.length);

