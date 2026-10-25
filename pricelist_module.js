// ==========================================================================
// PRICELIST MODULE — helpers, CRUD, POS integration
// ==========================================================================

// ── Helper: populate pricelist dropdown in customer modals ─────────────────
function populateCustomerPricelistDropdown(selectId, selectedId) {
    const el = document.getElementById(selectId);
    if (!el) return;
    el.innerHTML = '<option value="">— Tidak Ada (Harga Standar) —</option>' +
        PRICELISTS.filter(pl => pl.is_active).map(pl =>
            `<option value="${pl.id}" ${pl.id == selectedId ? 'selected' : ''}>${pl.nama} (${pl.kode})</option>`
        ).join('');
}

// ── handlePOSCustomerChange – fetch effective prices when customer changes ──
async function handlePOSCustomerChange(customerId) {
    const badgeEl = document.getElementById('pos-customer-pricelist-badge');
    if (!customerId) {
        currentPOSCustomerEffectivePrices = {};
        if (badgeEl) badgeEl.innerHTML = '';
        return;
    }
    try {
        const res = await fetch(`/api/pricelists/effective-prices?customer_id=${encodeURIComponent(customerId)}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Failed to fetch effective prices');
        const data = await res.json();
        currentPOSCustomerEffectivePrices = {};
        data.forEach(row => {
            currentPOSCustomerEffectivePrices[row.product_id] = row;
        });
        // Update badge
        const cust = CUSTOMERS.find(c => c.id === customerId);
        if (badgeEl) {
            if (cust && cust.pricelistName) {
                badgeEl.innerHTML = `<span class="badge-pricelist-source" style="font-size:0.75rem; padding:0.2rem 0.5rem;">🏷️ ${cust.pricelistName}</span>`;
            } else {
                badgeEl.innerHTML = '<span style="font-size:0.75rem; color:var(--gray-400);">Harga Standar</span>';
            }
        }
        // Recalculate cart prices for non-manual items (Rule 5.3 pt4)
        cart.forEach(item => {
            if (!item.manual_override) {
                const eff = currentPOSCustomerEffectivePrices[item.id];
                if (eff) {
                    item.price = parseFloat(eff.harga_efektif);
                    item.sumberHarga = eff.sumber_harga;
                    item.pricelistNama = eff.pricelist_nama || '';
                } else {
                    item.price = item.originalPrice || parseFloat(PRODUCTS.find(p => p.id === item.id)?.price || item.price);
                    item.sumberHarga = 'master';
                    item.pricelistNama = '';
                }
            }
        });
        renderCart();
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
            deskripsi: pl.deskripsi || '',
            is_active: pl.is_active !== false && pl.is_active != 0,
            total_items: parseInt(pl.total_items) || 0,
            total_customers: parseInt(pl.total_customers) || 0,
            created_at: pl.created_at
        }));
        if (document.getElementById('page-pricelists')?.classList.contains('active')) {
            renderPricelistsTable();
        }
    } catch (err) {
        console.error('fetchPricelists error:', err);
    }
}

// ── renderPricelistsTable ──────────────────────────────────────────────────
function renderPricelistsTable(filter) {
    if (filter === undefined) filter = document.getElementById('pricelist-search')?.value || '';
    const statusFilter = document.getElementById('pricelist-status-filter')?.value || 'all';
    const tbody = document.getElementById('pricelists-table-body');
    if (!tbody) return;

    let list = PRICELISTS;
    if (filter) {
        const q = filter.toLowerCase();
        list = list.filter(pl => pl.nama.toLowerCase().includes(q) || pl.kode.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
        list = list.filter(pl => (statusFilter === '1') === pl.is_active);
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--gray-400);">Belum ada daftar harga. Klik "Buat Pricelist Baru" untuk memulai.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(pl => `
        <tr style="cursor:pointer;" onclick="openPricelistDetail(${pl.id})">
            <td style="font-weight:600; color:var(--blue-600);">${pl.kode}</td>
            <td style="font-weight:600;">${pl.nama}</td>
            <td>${pl.deskripsi || '<span style="color:var(--gray-300);">—</span>'}</td>
            <td style="text-align:center; font-weight:600;">${pl.total_items}</td>
            <td style="text-align:center; font-weight:600;">${pl.total_customers}</td>
            <td style="text-align:center;">
                <span class="badge-status ${pl.is_active ? 'aman' : 'bad'}">${pl.is_active ? 'Aktif' : 'Nonaktif'}</span>
            </td>
            <td style="text-align:right; white-space:nowrap;" onclick="event.stopPropagation()">
                <button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;" title="Edit" onclick="openEditPricelistModal(${pl.id})">
                    <i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i>
                </button>
                <button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;" title="Duplikat" onclick="duplicatePricelist(${pl.id})">
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

// ── showPricelistView – toggle list/detail ─────────────────────────────────
let activePricelistId = null;

function showPricelistView(view) {
    const listView = document.getElementById('pricelists-list-view');
    const detailView = document.getElementById('pricelists-detail-view');
    if (view === 'list') {
        if (listView) listView.style.display = '';
        if (detailView) detailView.style.display = 'none';
        activePricelistId = null;
        currentPricelistDetailId = null;
    } else {
        if (listView) listView.style.display = 'none';
        if (detailView) detailView.style.display = '';
    }
}

function closePricelistDetail() {
    showPricelistView('list');
    renderPricelistsTable();
}

// ── openCreatePricelistModal ───────────────────────────────────────────────
function openCreatePricelistModal() {
    const nameEl = document.getElementById('create-pricelist-name');
    const descEl = document.getElementById('create-pricelist-deskripsi');
    if (nameEl) nameEl.value = '';
    if (descEl) descEl.value = '';
    openModal('modal-create-pricelist');
}

async function saveCreatePricelist() {
    const nama = document.getElementById('create-pricelist-name')?.value.trim();
    const deskripsi = document.getElementById('create-pricelist-deskripsi')?.value.trim() || '';
    if (!nama) { showToast('Nama pricelist wajib diisi!', 'warning'); return; }
    try {
        const res = await fetch('/api/pricelists', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ nama, deskripsi })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-create-pricelist');
            showToast(`Pricelist "${data.nama}" (${data.kode}) berhasil dibuat!`, 'success');
            await fetchPricelists();
            openPricelistDetail(data.id);
        } else {
            showToast('Error: ' + (data.error || 'Gagal membuat pricelist'), 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

// ── openEditPricelistModal ─────────────────────────────────────────────────
function openEditPricelistModal(id) {
    const pl = PRICELISTS.find(p => p.id == id);
    if (!pl) return;
    const idEl = document.getElementById('edit-pricelist-id');
    const nameEl = document.getElementById('edit-pricelist-name');
    const descEl = document.getElementById('edit-pricelist-deskripsi');
    const activeEl = document.getElementById('edit-pricelist-aktif');
    if (idEl) idEl.value = pl.id;
    if (nameEl) nameEl.value = pl.nama;
    if (descEl) descEl.value = pl.deskripsi || '';
    if (activeEl) activeEl.checked = pl.is_active;
    openModal('modal-edit-pricelist');
}

async function saveEditPricelist() {
    const id = document.getElementById('edit-pricelist-id')?.value;
    const nama = document.getElementById('edit-pricelist-name')?.value.trim();
    const deskripsi = document.getElementById('edit-pricelist-deskripsi')?.value.trim() || '';
    const is_active = document.getElementById('edit-pricelist-aktif')?.checked ? 1 : 0;
    if (!nama) { showToast('Nama pricelist wajib diisi!', 'warning'); return; }
    try {
        const res = await fetch(`/api/pricelists/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ nama, deskripsi, is_active })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-edit-pricelist');
            showToast('Pricelist berhasil diperbarui!', 'success');
            await fetchPricelists();
            if (activePricelistId == id) openPricelistDetail(id);
        } else {
            showToast('Error: ' + (data.error || 'Gagal memperbarui'), 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

// ── deletePricelist ────────────────────────────────────────────────────────
async function deletePricelist(id, nama, totalCustomers) {
    if (!confirm(`Hapus pricelist "${nama}"?`)) return;
    try {
        const res = await fetch(`/api/pricelists/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        const data = await res.json();
        if (res.status === 409) {
            showToast(`Tidak bisa dihapus: ${data.total_customers} pelanggan masih menggunakan pricelist ini. Cabut pricelist dari pelanggan terlebih dahulu.`, 'error');
            return;
        }
        if (res.ok) {
            showToast('Pricelist berhasil dihapus!', 'success');
            await fetchPricelists();
            showPricelistView('list');
        } else {
            showToast('Error: ' + (data.error || 'Gagal menghapus'), 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

// ── duplicatePricelist ─────────────────────────────────────────────────────
async function duplicatePricelist(id) {
    const pl = PRICELISTS.find(p => p.id == id);
    if (!pl) return;
    if (!confirm(`Duplikat pricelist "${pl.nama}"?`)) return;
    try {
        const res = await fetch(`/api/pricelists/${id}/duplicate`, { method: 'POST', headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok) {
            showToast(`Duplikat berhasil: "${data.nama}" (${data.kode})`, 'success');
            await fetchPricelists();
        } else {
            showToast('Error: ' + (data.error || 'Gagal menduplikat'), 'error');
        }
    } catch (err) {
        showToast('Gagal menghubungi server', 'error');
    }
}

function openDuplicatePricelistModal(id) { duplicatePricelist(id); }

// ── Pricelist Detail View ──────────────────────────────────────────────────
let currentPricelistDetailId = null;
let pricelistDetailData = null;

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
        if (ketEl) ketEl.textContent = pl.deskripsi || '';

        // Stats
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
            statDiff.style.color = avg < 0 ? 'var(--emerald-600)' : avg > 0 ? 'var(--rose-500)' : 'var(--gray-500)';
        } else if (statDiff) {
            statDiff.textContent = '0%';
        }

        renderPricelistItemsTable(items);
    } catch (err) {
        showToast('Gagal memuat detail pricelist', 'error');
        showPricelistView('list');
    }
}

// ── renderPricelistItemsTable ──────────────────────────────────────────────
function renderPricelistItemsTable(items) {
    const tbody = document.getElementById('detail-pl-items-body');
    const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
    const showHpp = role === 'admin' || role === 'owner';

    // Hide HPP column for non-admins
    const thHpp = document.getElementById('th-pl-hpp');
    if (thHpp) thHpp.style.display = showHpp ? '' : 'none';

    if (!tbody) return;
    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:2rem; color:var(--gray-400);">Belum ada produk. Klik "Tambah Produk" untuk mulai mengisi pricelist.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(item => {
        const hargaMaster = parseFloat(item.harga_master || 0);
        const hargaKhusus = parseFloat(item.harga || 0);
        const selisihRp = hargaKhusus - hargaMaster;
        const selisihPct = hargaMaster > 0 ? (selisihRp / hargaMaster * 100).toFixed(1) : 0;
        const diffColor = selisihPct < 0 ? 'var(--emerald-600)' : selisihPct > 0 ? 'var(--rose-500)' : 'var(--gray-400)';
        const hpp = parseFloat(item.hpp || item.cost_price || 0);
        const hppWarn = showHpp && hpp > 0 && hargaKhusus < hpp;

        return `<tr data-product-id="${item.product_id}">
            <td style="text-align:center;">
                <input type="checkbox" class="pl-item-chk" value="${item.product_id}" onchange="updatePricelistItemSelection()">
            </td>
            <td style="font-weight:600; color:var(--blue-600); font-size:0.8rem;">${item.sku || '-'}</td>
            <td style="font-weight:600;">${item.product_name || item.nama}</td>
            <td style="color:var(--gray-500); font-size:0.85rem;">${item.unit || item.satuan || '-'}</td>
            <td style="text-align:right; font-weight:500;">${rp(hargaMaster)}</td>
            <td style="text-align:right; font-weight:500; color:${hppWarn ? 'var(--rose-500)' : 'var(--gray-700)'}; display:${showHpp ? '' : 'none'};">
                ${showHpp ? rp(hpp) : '—'}${hppWarn ? ' ⚠️' : ''}
            </td>
            <td style="text-align:right;">
                <input type="number" class="inline-price-input"
                    value="${hargaKhusus}"
                    min="1" step="1"
                    onchange="savePricelistItemPrice('${item.product_id}', this.value, this)"
                    style="width:110px; text-align:right;"
                    title="Edit harga khusus">
            </td>
            <td style="text-align:right; font-weight:600; color:${diffColor};">
                ${selisihRp >= 0 ? '+' : ''}${rp(selisihRp)}<br>
                <span style="font-size:0.7rem;">${selisihPct > 0 ? '+' : ''}${selisihPct}%</span>
            </td>
            <td style="text-align:center;">
                ${hppWarn ? '<span class="badge-hpp-warning" style="font-size:0.65rem;">⚠️ Bawah HPP</span>' : '<span style="color:var(--gray-300); font-size:0.75rem;">—</span>'}
            </td>
            <td style="text-align:center;">
                <button class="btn-toolbar secondary" style="padding:0.2rem 0.4rem; color:var(--rose-500);" title="Hapus" onclick="deletePricelistItem('${item.product_id}')">
                    <i data-lucide="x" style="width:12px;height:12px;margin:0;"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// ── Bulk item selection helpers ────────────────────────────────────────────
function toggleSelectAllPricelistItems(checked) {
    document.querySelectorAll('.pl-item-chk').forEach(chk => { chk.checked = checked; });
    updatePricelistItemSelection();
}

function updatePricelistItemSelection() {
    const checked = document.querySelectorAll('.pl-item-chk:checked');
    const countEl = document.getElementById('detail-pl-selected-count');
    const btnEl = document.getElementById('btn-bulk-delete-items');
    if (countEl) { countEl.textContent = `${checked.length} dipilih`; countEl.style.display = checked.length > 0 ? '' : 'none'; }
    if (btnEl) btnEl.style.display = checked.length > 0 ? '' : 'none';
}

async function deleteSelectedPricelistItems() {
    const id = activePricelistId;
    const checked = Array.from(document.querySelectorAll('.pl-item-chk:checked')).map(c => c.value);
    if (!checked.length || !id) return;
    if (!confirm(`Hapus ${checked.length} produk dari pricelist ini?`)) return;
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

// ── Filter items ──────────────────────────────────────────────────────────
function filterPricelistItems() {
    const q = (document.getElementById('detail-pl-search')?.value || '').toLowerCase();
    document.querySelectorAll('#detail-pl-items-body tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = q ? (text.includes(q) ? '' : 'none') : '';
    });
}

// ── savePricelistItemPrice – inline edit ──────────────────────────────────
async function savePricelistItemPrice(productId, newPrice, inputEl) {
    const id = activePricelistId;
    if (!id) return;
    const harga = parseFloat(newPrice);
    if (isNaN(harga) || harga <= 0) {
        showToast('Harga harus > 0', 'warning');
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
            await fetchPricelists();
        } else {
            const data = await res.json();
            showToast('Error: ' + (data.error || 'Gagal menyimpan'), 'error');
        }
    } catch (err) {
        showToast('Gagal menyimpan harga', 'error');
    }
}

// ── deletePricelistItem ────────────────────────────────────────────────────
async function deletePricelistItem(productId) {
    const id = activePricelistId;
    if (!id) return;
    if (!confirm('Hapus produk ini dari pricelist?')) return;
    try {
        const res = await fetch(`/api/pricelists/${id}/items/${productId}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (res.ok) {
            showToast('Produk dihapus dari pricelist', 'success');
            await openPricelistDetail(id);
            await fetchPricelists();
        } else {
            const data = await res.json();
            showToast('Error: ' + (data.error || 'Gagal menghapus'), 'error');
        }
    } catch (err) {
        showToast('Gagal menghapus produk', 'error');
    }
}

// ── Modal Add Products to Pricelist ───────────────────────────────────────
function openAddPricelistProductsModal() {
    const id = activePricelistId;
    if (!id) return;
    const existingIds = new Set((pricelistDetailData?.items || []).map(i => i.product_id));
    const container = document.getElementById('pricelist-add-products-list');
    if (!container) { openModal('modal-add-pricelist-products'); return; }

    const available = PRODUCTS.filter(p => !existingIds.has(p.id));
    if (available.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--gray-400);">Semua produk sudah ada di pricelist ini.</div>';
    } else {
        container.innerHTML = available.map(p => `
            <label style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid var(--gray-100); cursor:pointer;">
                <input type="checkbox" class="pricelist-add-product-chk" value="${p.id}" data-price="${p.price}" style="accent-color:var(--blue-600);">
                <span style="flex:1; font-weight:500; font-size:0.875rem;">${p.name}</span>
                <span style="font-size:0.75rem; color:var(--gray-500);">${rp(p.price)}</span>
                <input type="number" class="inline-price-input pricelist-add-price-input" data-product="${p.id}"
                    value="${p.price}" min="1" step="1"
                    style="width:100px; display:none;"
                    placeholder="Harga khusus">
            </label>
        `).join('');
        // Show price input when checkbox checked
        container.querySelectorAll('.pricelist-add-product-chk').forEach(chk => {
            chk.addEventListener('change', () => {
                const inp = container.querySelector(`.pricelist-add-price-input[data-product="${chk.value}"]`);
                if (inp) inp.style.display = chk.checked ? 'inline-block' : 'none';
            });
        });
    }
    openModal('modal-add-pricelist-products');
}

async function saveAddPricelistProducts() {
    const id = activePricelistId;
    if (!id) return;
    const container = document.getElementById('pricelist-add-products-list');
    const checked = container?.querySelectorAll('.pricelist-add-product-chk:checked') || [];
    if (checked.length === 0) { showToast('Pilih minimal 1 produk', 'warning'); return; }

    const items = Array.from(checked).map(chk => {
        const inp = container.querySelector(`.pricelist-add-price-input[data-product="${chk.value}"]`);
        const harga = parseFloat(inp?.value) || parseFloat(chk.dataset.price) || 0;
        return { product_id: chk.value, harga };
    });
    if (items.some(i => i.harga <= 0)) { showToast('Semua harga harus > 0', 'warning'); return; }

    try {
        const res = await fetch(`/api/pricelists/${id}/items`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ items })
        });
        if (res.ok) {
            closeModal('modal-add-pricelist-products');
            showToast(`${items.length} produk berhasil ditambahkan ke pricelist`, 'success');
            await openPricelistDetail(id);
            await fetchPricelists();
        } else {
            const data = await res.json();
            showToast('Error: ' + (data.error || 'Gagal menyimpan'), 'error');
        }
    } catch (err) {
        showToast('Gagal menyimpan', 'error');
    }
}

// ── Bulk % Adjustment ─────────────────────────────────────────────────────
function openPricelistBulkPercentModal() {
    const pctEl = document.getElementById('bulk-percent-value');
    if (pctEl) pctEl.value = '';
    openModal('modal-pricelist-bulk-percent');
}

async function savePricelistBulkPercent() {
    const id = activePricelistId;
    if (!id || !pricelistDetailData?.items?.length) return;
    const pctEl = document.getElementById('bulk-percent-value');
    const modeEl = document.getElementById('bulk-percent-mode');
    const pct = parseFloat(pctEl?.value);
    const mode = modeEl?.value || 'increase';
    if (isNaN(pct) || pct <= 0) { showToast('Masukkan persentase yang valid', 'warning'); return; }

    const items = pricelistDetailData.items.map(item => {
        let harga = parseFloat(item.harga);
        if (mode === 'increase') harga = Math.ceil(harga * (1 + pct / 100));
        else harga = Math.max(1, Math.ceil(harga * (1 - pct / 100)));
        return { product_id: item.product_id, harga };
    });

    try {
        const res = await fetch(`/api/pricelists/${id}/items`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ items })
        });
        if (res.ok) {
            closeModal('modal-pricelist-bulk-percent');
            showToast(`Harga diperbarui ${mode === 'increase' ? 'naik' : 'turun'} ${pct}%`, 'success');
            await openPricelistDetail(id);
        } else {
            const data = await res.json();
            showToast('Error: ' + (data.error || 'Gagal'), 'error');
        }
    } catch (err) {
        showToast('Gagal memperbarui harga', 'error');
    }
}

// ── CSV Import ─────────────────────────────────────────────────────────────
let csvPreviewData = [];

function openPricelistCsvModal() {
    csvPreviewData = [];
    const previewEl = document.getElementById('csv-import-preview');
    const errorEl = document.getElementById('csv-import-errors');
    const fileEl = document.getElementById('csv-import-file');
    if (previewEl) previewEl.innerHTML = '';
    if (errorEl) errorEl.innerHTML = '';
    if (fileEl) fileEl.value = '';
    openModal('modal-import-pricelist-csv');
}

function downloadPricelistCsvTemplate() {
    const rows = ['product_id,product_name,harga_master,harga_khusus'];
    PRODUCTS.slice(0, 5).forEach(p => rows.push(`${p.id},"${p.name}",${p.price},${p.price}`));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'template_pricelist.csv'; a.click();
    URL.revokeObjectURL(url);
}

function handlePricelistCsvUpload(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => parsePricelistCsv(e.target.result);
    reader.readAsText(file);
}

function parsePricelistCsv(text) {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { showToast('File CSV kosong atau tidak valid', 'warning'); return; }
    const headers = lines[0].toLowerCase().split(',').map(h => h.replace(/"/g, '').trim());
    const pidIdx = headers.indexOf('product_id');
    const priceIdx = headers.indexOf('harga_khusus');
    if (pidIdx === -1 || priceIdx === -1) {
        showToast('CSV harus memiliki kolom product_id dan harga_khusus', 'warning');
        return;
    }
    csvPreviewData = [];
    const errors = [];
    lines.slice(1).forEach((line, i) => {
        const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
        const product_id = cols[pidIdx];
        const harga = parseFloat(cols[priceIdx]);
        const product = PRODUCTS.find(p => p.id === product_id);
        if (!product_id) return;
        if (!product) { errors.push(`Baris ${i+2}: Produk "${product_id}" tidak ditemukan`); return; }
        if (isNaN(harga) || harga <= 0) { errors.push(`Baris ${i+2}: Harga tidak valid untuk "${product_id}"`); return; }
        csvPreviewData.push({ product_id, product_name: product.name, harga_master: product.price, harga });
    });
    const previewEl = document.getElementById('csv-import-preview');
    const errorEl = document.getElementById('csv-import-errors');
    if (errorEl) errorEl.innerHTML = errors.length ? `<div style="color:var(--rose-500); font-size:0.8rem; margin-bottom:0.5rem;">${errors.join('<br>')}</div>` : '';
    if (previewEl) {
        if (csvPreviewData.length === 0) {
            previewEl.innerHTML = '<div style="color:var(--gray-400); text-align:center; padding:1rem;">Tidak ada data valid</div>';
        } else {
            previewEl.innerHTML = `
                <div style="font-size:0.8rem; color:var(--gray-500); margin-bottom:0.5rem;">${csvPreviewData.length} produk siap diimpor</div>
                <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
                    <thead><tr style="border-bottom:2px solid var(--gray-200);">
                        <th style="text-align:left; padding:0.25rem;">Produk</th>
                        <th style="text-align:right; padding:0.25rem;">Harga Master</th>
                        <th style="text-align:right; padding:0.25rem;">Harga Khusus</th>
                    </tr></thead>
                    <tbody>${csvPreviewData.map(row => `
                        <tr style="border-bottom:1px solid var(--gray-100);">
                            <td style="padding:0.25rem;">${row.product_name}</td>
                            <td style="text-align:right; padding:0.25rem; color:var(--gray-500);">${rp(row.harga_master)}</td>
                            <td style="text-align:right; padding:0.25rem; font-weight:600;">${rp(row.harga)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
        }
    }
}

async function importPricelistCsv() {
    const id = activePricelistId;
    if (!id || csvPreviewData.length === 0) { showToast('Tidak ada data untuk diimpor', 'warning'); return; }
    try {
        const res = await fetch(`/api/pricelists/${id}/items`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ items: csvPreviewData.map(r => ({ product_id: r.product_id, harga: r.harga })) })
        });
        if (res.ok) {
            closeModal('modal-import-pricelist-csv');
            showToast(`${csvPreviewData.length} produk berhasil diimpor`, 'success');
            csvPreviewData = [];
            await openPricelistDetail(id);
            await fetchPricelists();
        } else {
            const data = await res.json();
            showToast('Error: ' + (data.error || 'Gagal impor'), 'error');
        }
    } catch (err) {
        showToast('Gagal mengimpor CSV', 'error');
    }
}

// ── Search + filter bindings ───────────────────────────────────────────────
document.getElementById('pricelist-search')?.addEventListener('input', () => renderPricelistsTable());
document.getElementById('pricelist-status-filter')?.addEventListener('change', () => renderPricelistsTable());
