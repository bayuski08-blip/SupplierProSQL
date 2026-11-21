const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filePath = path.join(__dirname, '..', 'dashboard.js');
let code = fs.readFileSync(filePath, 'utf8');

console.log('Original code length:', code.length);

// 1. Add top-level state variables
const authCheckAnchor = `// Auth check\nif (!localStorage.getItem('token')) {\n    window.location.href = 'login.html';\n}`;
const stateVars = `// Auth check
if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

// BATCH C: State Variables
let selectedHutangIds = new Set();
let _voidPurchaseId = null;
let _voidPurchasePaymentId = null;
let _currentHutangPO = null;
let parsedHutangImportData = null;`;

if (!code.includes(authCheckAnchor)) throw new Error('Anchor 1 not found');
code = code.replace(authCheckAnchor, stateVars);

// 2. ROLE_PERMISSIONS: finance no hutang, gudang has hutang
const oldRoles = `    finance: ['dashboard', 'invoices', 'piutang', 'hutang', 'cashflow', 'profitloss', 'balance', 'reports', 'returns'],
    gudang: ['dashboard', 'products', 'purchases', 'vendors', 'stock-moves', 'returns'],`;
const newRoles = `    finance: ['dashboard', 'invoices', 'piutang', 'cashflow', 'profitloss', 'balance', 'reports', 'returns'],
    gudang: ['dashboard', 'products', 'purchases', 'vendors', 'hutang', 'stock-moves', 'returns'],`;

if (!code.includes(oldRoles)) throw new Error('Anchor 2 not found');
code = code.replace(oldRoles, newRoles);

// 3. applyRoleRestrictions: btn-import-hutang
const oldImportRestr = `    const btnImportPiutang = document.getElementById('btn-import-piutang');
    if (btnImportPiutang) btnImportPiutang.style.display = canImportInvoice ? '' : 'none';`;
const newImportRestr = `    const btnImportPiutang = document.getElementById('btn-import-piutang');
    if (btnImportPiutang) btnImportPiutang.style.display = canImportInvoice ? '' : 'none';

    // Control visibility of hutang import buttons: only Admin & Gudang (C6)
    const canImportHutang = role === 'admin' || role === 'gudang';
    const btnImportHutang = document.getElementById('btn-import-hutang');
    if (btnImportHutang) btnImportHutang.style.display = canImportHutang ? '' : 'none';`;

if (!code.includes(oldImportRestr)) throw new Error('Anchor 3 not found');
code = code.replace(oldImportRestr, newImportRestr);

// 4. renderSummaryCards: Total Hutang separated to Admin & Gudang
const oldSummCards = `    // Omzet & Keuangan: Admin & Finance saja
    if (role === 'admin' || role === 'finance') {
        cards.push({ label: 'Omzet Bulan Ini', value: rpShort(totalOmzet), trend: 'Total penjualan', trendDir: 'up', icon: 'trending-up', color: 'blue' });
        cards.push({ label: 'Total Piutang', value: rpShort(totalPiutang), trend: totalPiutang > 0 ? 'Belum terbayar' : 'Semua lunas', trendDir: totalPiutang > 0 ? 'down' : 'up', icon: 'hand-coins', color: 'amber' });
        cards.push({ label: 'Total Hutang', value: rpShort(totalHutang), trend: totalHutang > 0 ? 'Ke vendor' : 'Semua lunas', trendDir: totalHutang > 0 ? 'down' : 'up', icon: 'landmark', color: 'rose' });
        cards.push({ label: 'Laba Kotor', value: rpShort(labaKotor), trend: labaKotor >= 0 ? 'Revenue - HPP' : 'Rugi', trendDir: labaKotor >= 0 ? 'up' : 'down', icon: 'wallet', color: 'emerald' });
    }`;

const newSummCards = `    // Omzet & Keuangan: Admin & Finance saja
    if (role === 'admin' || role === 'finance') {
        cards.push({ label: 'Omzet Bulan Ini', value: rpShort(totalOmzet), trend: 'Total penjualan', trendDir: 'up', icon: 'trending-up', color: 'blue' });
        cards.push({ label: 'Total Piutang', value: rpShort(totalPiutang), trend: totalPiutang > 0 ? 'Belum terbayar' : 'Semua lunas', trendDir: totalPiutang > 0 ? 'down' : 'up', icon: 'hand-coins', color: 'amber' });
        cards.push({ label: 'Laba Kotor', value: rpShort(labaKotor), trend: labaKotor >= 0 ? 'Revenue - HPP' : 'Rugi', trendDir: labaKotor >= 0 ? 'up' : 'down', icon: 'wallet', color: 'emerald' });
    }

    // Total Hutang: Admin & Gudang saja (C6 / A7: sesuai izin halaman Hutang)
    if (role === 'admin' || role === 'gudang') {
        cards.push({ label: 'Total Hutang', value: rpShort(totalHutang), trend: totalHutang > 0 ? 'Ke vendor' : 'Semua lunas', trendDir: totalHutang > 0 ? 'down' : 'up', icon: 'landmark', color: 'rose' });
    }`;

if (!code.includes(oldSummCards)) throw new Error('Anchor 4 not found');
code = code.replace(oldSummCards, newSummCards);

// 5. fetchHutang replacement
const oldFetchHutang = `async function fetchHutang(page) {
    try {
        if (page !== undefined) paginationState.hutang.page = page;
        const q = document.getElementById('hutang-search')?.value || '';
        const status = document.getElementById('hutang-status-filter')?.value || 'all';
        const pg = paginationState.hutang.page;
        let url = '/api/finance/payables?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (status && status !== 'all') url += '&status=' + encodeURIComponent(status);

        const res = await fetch(url, { headers: getAuthHeaders() });
        const json = await res.json();
        const rows = json.data || [];
        const pag = json.pagination || {};
        const summary = json.summary || {};
        paginationState.hutang.total = pag.total || 0;
        paginationState.hutang.totalPages = pag.totalPages || 1;

        // Summary cards
        const summEl = document.getElementById('hutang-summary');
        if (summEl) {
            const totalDebt = parseFloat(summary.total_debt || 0);
            const vendorsWithDebt = parseInt(summary.vendors_with_debt || 0);
            const vendorsLunas = parseInt(summary.vendors_lunas || 0);
            summEl.innerHTML = \`
            <div class="finance-summary-card highlight">
                <div class="fs-value">\${rp(totalDebt)}</div>
                <div class="fs-label">Total Hutang</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value">\${vendorsWithDebt}</div>
                <div class="fs-label">Vendor Belum Lunas</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value">\${vendorsLunas}</div>
                <div class="fs-label">Vendor Lunas</div>
            </div>\`;
        }

        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        const canPay = role === 'admin' || role === 'finance';
        const canEditPO = role === 'admin' || role === 'finance' || role === 'gudang';

        const tbody = document.getElementById('hutang-body');
        if (!tbody) return;
        tbody.innerHTML = rows.map(p => {
            const sisa = p.total - p.paid;
            const st = sisa > 0 ? 'belum' : 'lunas';
            const payBtn = (canPay && sisa > 0) ? \`<button class="btn-toolbar primary" style="padding:0.3rem 0.65rem; font-size:0.75rem; margin-right:0.25rem;" onclick="openHutangPaymentModal('\${p.id}', \${sisa})">Bayar</button>\` : '';
            const editBtn = canEditPO ? \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" title="Edit PO" onclick="openEditPurchaseModal('\${p.id}')"><i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i></button>\` : '';
            return \`
            <tr>
                <td style="font-weight:600; color: var(--blue-600);">\${p.id}</td>
                <td>\${p.vendor}</td>
                <td style="font-weight:700;">\${rp(p.total)}</td>
                <td>\${rp(p.paid)}</td>
                <td style="font-weight:700; color: \${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">\${rp(sisa)}</td>
                <td>\${p.dueDate || p.date || '-'}</td>
                <td>\${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.paidDate || '-')}</td>
                <td>\${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.type || '-')}</td>
                <td><span class="badge-status \${st}">\${sisa > 0 ? 'Belum Lunas' : 'Lunas'}</span></td>
                <td style="text-align:right; white-space:nowrap;">\${payBtn}\${editBtn}</td>
            </tr>\`;
        }).join('');

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
}`;

const newFetchHutang = `async function fetchHutang(page) {
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
            summEl.innerHTML = \`
            <div class="finance-summary-card highlight">
                <div class="fs-value">\${rp(totalDebt)}</div>
                <div class="fs-label">Total Hutang</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value">\${vendorsWithDebt}</div>
                <div class="fs-label">Vendor Belum Lunas</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value">\${vendorsLunas}</div>
                <div class="fs-label">Vendor Lunas</div>
            </div>
            <div class="finance-summary-card">
                <div class="fs-value" style="color:var(--rose-600);">\${overdueCount}</div>
                <div class="fs-label">Lewat Jatuh Tempo</div>
            </div>\`;
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

            const checkboxHtml = \`<td style="text-align: center; width: 36px;">
                <input type="checkbox" class="check-hutang-item" value="\${p.id}" \${isChecked ? 'checked' : ''} onchange="onHutangCheckboxChange(this, '\${p.id}')">
            </td>\`;

            let actionButtons = '';
            if (canManageHutang) {
                const histBtn = \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" title="Riwayat Cicilan & Bayar" onclick="openHutangPaymentHistoryModal('\${p.id}')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>\`;
                const deleteBtn = p.isOutstandingImport
                    ? \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;color:var(--rose-500);" title="Hapus Hutang Outstanding" onclick="confirmDeleteOutstandingHutang('\${p.id}', \${p.paid || 0})"><i data-lucide="trash-2" style="width:13px;height:13px;margin:0;"></i></button>\`
                    : '';
                const editBtn = (!p.isOutstandingImport && (role === 'admin' || role === 'gudang'))
                    ? \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;" title="Edit PO" onclick="openEditPurchaseModal('\${p.id}')"><i data-lucide="edit-2" style="width:13px;height:13px;margin:0;"></i></button>\`
                    : '';
                actionButtons = \`\${histBtn}\${deleteBtn}\${editBtn}\`;
            } else {
                actionButtons = '<span style="color:var(--gray-400);font-size:0.8rem;">Lihat Saja</span>';
            }

            const stClass = sisa > 0 ? (parseFloat(p.paid) > 0 ? 'sebagian' : 'belum') : 'lunas';
            const stLabel = sisa > 0 ? (parseFloat(p.paid) > 0 ? 'Sebagian' : 'Belum Lunas') : 'Lunas';

            return \`
            <tr>
                \${checkboxHtml}
                <td style="font-weight:600; color: var(--blue-600);">\${p.id}</td>
                <td>\${p.vendor}</td>
                <td style="font-weight:700;">\${rp(p.total)}</td>
                <td>\${rp(p.paid)}</td>
                <td style="font-weight:700; color: \${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">\${rp(sisa)}</td>
                <td>\${p.dueDate || p.date || '-'}\${overdueBadge}</td>
                <td>\${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.paidDate || '-')}</td>
                <td>\${sisa > 0 && parseFloat(p.paid) === 0 ? '-' : (p.type || '-')}</td>
                <td><span class="badge-status \${stClass}">\${stLabel}</span></td>
                <td style="text-align:right; white-space:nowrap;">\${actionButtons}</td>
            </tr>\`;
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
}`;

if (!code.includes(oldFetchHutang)) throw new Error('Anchor 5 not found');
code = code.replace(oldFetchHutang, newFetchHutang);

// 6. init() renderHutang role condition
const oldInitHutang = `    if (['admin', 'finance'].includes(loggedRole)) {
        renderHutang();
    }`;
const newInitHutang = `    if (['admin', 'gudang'].includes(loggedRole)) {
        renderHutang();
    }`;

if (!code.includes(oldInitHutang)) throw new Error('Anchor 6 not found');
code = code.replace(oldInitHutang, newInitHutang);

// 7. window.cancelPurchase
const oldCancelPO = `window.cancelPurchase = (id) => {
    cancelPurchaseId = id;
    document.getElementById('modal-cancel-purchase').querySelector('strong').textContent = id;
    openModal('modal-cancel-purchase');
};`;

const newCancelPO = `window.cancelPurchase = (id) => {
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
    if (textEl) textEl.innerHTML = \`Apakah Anda yakin ingin membatalkan Purchase Order <strong>\${id}</strong>?\`;
    if (paid > 0) {
        if (alertEl) alertEl.style.display = 'block';
        if (alertText) alertText.innerHTML = \`<strong>PERHATIAN:</strong> PO ini sudah memiliki riwayat cicilan/pembayaran sebesar <strong>\${rp(paid)}</strong>. Membatalkan PO ini akan membatalkan seluruh catatan cicilan dan membalikkan arus kas terkait!\`;
    } else {
        if (alertEl) alertEl.style.display = 'none';
    }
    openModal('modal-cancel-purchase');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};`;

if (!code.includes(oldCancelPO)) throw new Error('Anchor 7 not found');
code = code.replace(oldCancelPO, newCancelPO);

// 8. openHutangPaymentModal + fillFullHutangPayment + submitHutangPayment
const oldOpenHutangPay = `// FIX: helper to open hutang payment modal with correct PO id pre-filled
function openHutangPaymentModal(poId, sisa) {
    const typeEl = document.getElementById('payment-type');
    const refEl = document.getElementById('payment-ref-id');
    const amtEl = document.getElementById('payment-amount');
    if (typeEl) typeEl.value = 'payable';
    if (refEl) refEl.value = poId;
    if (amtEl) amtEl.value = sisa || '';
    openModal('modal-payment');
}`;

const newOpenHutangPay = `// BATCH C: Dedicated Hutang Payment Modal & Logic
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
        const res = await fetch(\`/api/purchase-orders/\${encodeURIComponent(poId)}/payments\`, {
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
}`;

if (!code.includes(oldOpenHutangPay)) throw new Error('Anchor 8 not found');
code = code.replace(oldOpenHutangPay, newOpenHutangPay);

// 9. Hutang Payment History & Void Modals Logic (after submitVoidPayment)
const oldSubmitVoid = `async function submitVoidPayment() {
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
}`;

const newHutangHistoryAndVoid = `${oldSubmitVoid}

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
                    ? '<button class="btn-toolbar secondary" style="padding:0.2rem 0.4rem;font-size:0.72rem;color:var(--rose-600);" title="Void Pembayaran" onclick="openVoidHutangPaymentModal(' + p.id + \",'\" + p.paymentNo + \"',\" + p.amount + \",'\" + p.date + \"')\"><i data-lucide=\\"trash-2\\" style=\\"width:12px;height:12px;margin:0;\\"></i></button>\"
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
}`;

if (!code.includes(oldSubmitVoid)) throw new Error('Anchor 9 not found');
code = code.replace(oldSubmitVoid, newHutangHistoryAndVoid);

// 10. Import Outstanding: sectionTitles & openImportModal & downloadImportTemplate & resetImportToInitial
const oldSectionTitles = `const sectionTitles = {
    'produk': 'Produk',
    'pelanggan': 'Pelanggan',
    'vendor': 'Vendor',
    'pembelian': 'Pembelian',
    'invoice': 'Invoice'
};`;

const newSectionTitles = `const sectionTitles = {
    'produk': 'Produk',
    'pelanggan': 'Pelanggan',
    'vendor': 'Vendor',
    'pembelian': 'Pembelian',
    'invoice': 'Invoice',
    'hutang': 'Hutang Outstanding'
};`;

if (!code.includes(oldSectionTitles)) throw new Error('Anchor 10 not found');
code = code.replace(oldSectionTitles, newSectionTitles);

const oldOpenImport = `function openImportModal(section) {
    if (section === 'invoice') {
        const role = (localStorage.getItem('role') || 'kasir').toLowerCase();
        if (role !== 'admin' && role !== 'finance') {
            showToast('Akses ditolak: Hanya role Administrator dan Finance yang dapat mengimpor invoice outstanding.', 'error');
            return;
        }
    }
    currentImportSection = section;
    selectedImportFile = null;
    parsedInvoiceImportData = null;

    // Set Title
    const titleEl = document.getElementById('import-modal-title');
    if (titleEl) {
        titleEl.innerText = section === 'invoice' ? 'Import Invoice Outstanding' : \`Import Data \${sectionTitles[section] || section}\`;
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
    footer.innerHTML = \`
        <button class="btn-toolbar secondary" id="import-btn-cancel" onclick="closeImportModal()">Batal</button>
        <button class="btn-toolbar primary" id="import-btn-submit" onclick="startImportProcess()"
            style="opacity:0.5;cursor:not-allowed;pointer-events:none;">
            <i data-lucide="upload"></i> \${section === 'invoice' ? 'Periksa & Preview Data' : 'Proses Import'}
        </button>
    \`;

    setImportFile(null);

    // Show modal
    openModal('modal-import-unified');
}`;

const newOpenImport = `function openImportModal(section) {
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
        titleEl.innerText = section === 'invoice' ? 'Import Invoice Outstanding' : (section === 'hutang' ? 'Import Hutang Outstanding' : \`Import Data \${sectionTitles[section] || section}\`);
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
    footer.innerHTML = \`
        <button class="btn-toolbar secondary" id="import-btn-cancel" onclick="closeImportModal()">Batal</button>
        <button class="btn-toolbar primary" id="import-btn-submit" onclick="startImportProcess()"
            style="opacity:0.5;cursor:not-allowed;pointer-events:none;">
            <i data-lucide="upload"></i> \${(section === 'invoice' || section === 'hutang') ? 'Periksa & Preview Data' : 'Proses Import'}
        </button>
    \`;

    setImportFile(null);

    // Show modal
    openModal('modal-import-unified');
}`;

if (!code.includes(oldOpenImport)) throw new Error('Anchor 11 not found');
code = code.replace(oldOpenImport, newOpenImport);

// 11. setImportFile button text
code = code.replaceAll(`\${currentImportSection === 'invoice' ? 'Periksa & Preview Data' : 'Proses Import'}`, `\${(currentImportSection === 'invoice' || currentImportSection === 'hutang') ? 'Periksa & Preview Data' : 'Proses Import'}`);

// 12. downloadImportTemplate for hutang
const oldInvoiceTpl = `        XLSX.writeFile(wb, filename);
        return;
    }

    const data = [headers, ...rows];`;

const newHutangTpl = `        XLSX.writeFile(wb, filename);
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

    const data = [headers, ...rows];`;

if (!code.includes(oldInvoiceTpl)) throw new Error('Anchor 12 not found');
code = code.replace(oldInvoiceTpl, newHutangTpl);

// 13. resetImportToInitial
const oldResetImport = `function resetImportToInitial() {
    parsedInvoiceImportData = null;`;
const newResetImport = `function resetImportToInitial() {
    parsedInvoiceImportData = null;
    parsedHutangImportData = null;`;

if (!code.includes(oldResetImport)) throw new Error('Anchor 13 not found');
code = code.replace(oldResetImport, newResetImport);

// 14. previewHutangImport & commitHutangImport + startImportProcess
const oldStartImport = `function startImportProcess() {
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
            } else {
                await executeImport(rows);
            }
        } catch (err) {
            showImportError("Gagal membaca file Excel: " + err.message);
        }
    };
    reader.readAsArrayBuffer(selectedImportFile);
}`;

const newHutangImportFns = `async function previewHutangImport(rows, fileName) {
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
            errorRows.push(\`Baris \${rowNum}: Nama vendor kosong.\`);
            return;
        }
        const matchedVendor = vendorMap[vendorName.toLowerCase()];
        if (!matchedVendor) {
            errorRows.push(\`Baris \${rowNum}: Vendor "\${vendorName}" tidak terdaftar di sistem.\`);
            return;
        }

        if (total <= 0) {
            errorRows.push(\`Baris \${rowNum}: Total tagihan (\${rp(total)}) harus lebih besar dari 0.\`);
            return;
        }

        if (totalDibayar < 0) {
            errorRows.push(\`Baris \${rowNum}: Total dibayar tidak boleh negatif.\`);
            return;
        }

        if (totalDibayar === total) {
            errorRows.push(\`Baris \${rowNum}: Total dibayar sama dengan total tagihan (\${rp(total)}). Ini bukan outstanding karena sudah lunas.\`);
            return;
        }

        if (totalDibayar > total) {
            errorRows.push(\`Baris \${rowNum}: Total dibayar (\${rp(totalDibayar)}) melebihi total tagihan (\${rp(total)}). Aturan cicilan: overpayment tidak diizinkan.\`);
            return;
        }

        if (totalDibayar > 0 && lastPaymentDate > todayStr) {
            errorRows.push(\`Baris \${rowNum}: Tanggal pembayaran terakhir (\${lastPaymentDate}) tidak boleh di masa depan.\`);
            return;
        }

        if (noPO) {
            if (seenBatchIds.has(noPO.toLowerCase())) {
                errorRows.push(\`Baris \${rowNum}: Nomor PO "\${noPO}" duplikat di dalam file ini.\`);
                return;
            }
            if (existingPoIds.has(noPO.toLowerCase())) {
                errorRows.push(\`Baris \${rowNum}: Nomor PO "\${noPO}" sudah ada di database.\`);
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

    document.getElementById('import-preview-filename').textContent = \`📄 \${fileName} (\${rows.length} total baris)\`;
    document.getElementById('import-summary-count').textContent = \`\${validRows.length} Hutang PO\`;
    document.getElementById('import-summary-total').textContent = rp(totalTagihan);
    document.getElementById('import-summary-paid').textContent = rp(totalTerbayar);
    document.getElementById('import-summary-sisa').textContent = rp(totalSisa);

    const errBox = document.getElementById('import-preview-errors-box');
    const errList = document.getElementById('import-preview-errors-list');
    const errCount = document.getElementById('import-preview-errors-count');
    if (errorRows.length > 0) {
        errBox.style.display = 'block';
        errCount.textContent = \`\${errorRows.length} Baris Bermasalah (Ditolak):\`;
        errList.innerHTML = errorRows.map(e => \`<div>• \${e}</div>\`).join('');
    } else {
        errBox.style.display = 'none';
    }

    const tbody = document.getElementById('import-preview-table-body');
    if (validRows.length === 0) {
        tbody.innerHTML = \`<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--rose-500);font-weight:600;">Tidak ada baris data yang valid untuk diimpor. Silakan perbaiki file Excel Anda.</td></tr>\`;
    } else {
        tbody.innerHTML = validRows.map(r => \`
            <tr style="border-bottom:1px solid var(--gray-100);">
                <td style="padding:0.35rem 0.5rem;font-weight:600;color:var(--gray-700);">\${r.id || '<em style="color:var(--gray-400);">(Auto)</em>'}</td>
                <td style="padding:0.35rem 0.5rem;">\${r.vendor_name}</td>
                <td style="padding:0.35rem 0.5rem;color:var(--gray-600);">\${r.date}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;font-weight:600;">\${rp(r.total)}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;color:var(--emerald-600);">\${rp(r.total_dibayar)}</td>
                <td style="padding:0.35rem 0.5rem;text-align:right;color:var(--amber-600);font-weight:600;">\${rp(r.sisa)}</td>
                <td style="padding:0.35rem 0.5rem;color:var(--gray-600);">\${r.due_date || '-'}</td>
            </tr>
        \`).join('');
    }

    const footer = document.getElementById('import-modal-footer');
    footer.style.display = 'flex';
    footer.innerHTML = \`
        <button class="btn-toolbar secondary" onclick="resetImportToInitial()">Ganti File</button>
        <button class="btn-toolbar primary" id="import-btn-confirm" onclick="commitHutangImport()"
            \${validRows.length === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
            <i data-lucide="check"></i> Konfirmasi & Simpan (\${validRows.length} Hutang)
        </button>
    \`;
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
    document.getElementById('import-progress-text').innerText = \`Menyimpan \${validRows.length} hutang outstanding secara transaksional...\`;

    try {
        const res = await fetch('/api/purchase-orders/import-outstanding', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ purchase_orders: validRows })
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await res.text();
            throw new Error(\`Server mengembalikan respons tidak valid (HTTP \${res.status}). Coba import dengan baris lebih sedikit. Detail: \${text.substring(0, 200)}\`);
        }
        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error || 'Gagal menyimpan import hutang');
        }

        document.getElementById('import-state-progress').style.display = 'none';
        document.getElementById('import-state-result').style.display = 'block';
        document.getElementById('import-result-success').innerText = \`Berhasil mengimpor: \${result.count} hutang outstanding.\`;
        document.getElementById('import-result-failed').innerText = parsedHutangImportData.errorRows.length > 0 ? \`Dilewati (Error): \${parsedHutangImportData.errorRows.length} baris.\` : '';

        const errList = document.getElementById('import-error-list');
        if (errList) {
            errList.innerHTML = parsedHutangImportData.errorRows.map(f => \`<div style="margin-bottom:0.25rem;">\${f}</div>\`).join('');
        }

        const footer = document.getElementById('import-modal-footer');
        footer.style.display = 'flex';
        footer.innerHTML = \`
            <button class="btn-toolbar primary" onclick="closeImportAndRefresh()">Tutup & Perbarui Tampilan</button>
        \`;

        showToast(\`\${result.count} hutang outstanding berhasil diimpor!\`, 'success');
    } catch (err) {
        console.error('Import commit error:', err);
        showImportError(\`Gagal memproses import (Transaksi dibatalkan/Rollback): \${err.message}\`);
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
}`;

if (!code.includes(oldStartImport)) throw new Error('Anchor 14 not found');
code = code.replace(oldStartImport, newHutangImportFns);

// 15. closeImportAndRefresh
const oldCloseRefresh = `    } else if (currentImportSection === 'invoice') {
        if (typeof fetchInvoices === 'function') await fetchInvoices();
        if (typeof fetchPiutang === 'function') await fetchPiutang();
        if (typeof fetchDashboardSummary === 'function') await fetchDashboardSummary();
    }
}`;

const newCloseRefresh = `    } else if (currentImportSection === 'invoice') {
        if (typeof fetchInvoices === 'function') await fetchInvoices();
        if (typeof fetchPiutang === 'function') await fetchPiutang();
        if (typeof fetchDashboardSummary === 'function') await fetchDashboardSummary();
    } else if (currentImportSection === 'hutang') {
        if (typeof fetchPurchases === 'function') await fetchPurchases();
        if (typeof fetchHutang === 'function') await fetchHutang();
        if (typeof fetchDashboardSummary === 'function') await fetchDashboardSummary();
    }
}`;

if (!code.includes(oldCloseRefresh)) throw new Error('Anchor 15 not found');
code = code.replace(oldCloseRefresh, newCloseRefresh);

// 16. Selection, Export PDF & Delete Outstanding handlers (insert before BATCH B section)
const batchBAnchor = `// ==============================================================================
// BATCH B: RETUR & STOCK MOVE MODULE (B1, B2, B3, B4.1, B4.2)
// ==============================================================================`;

const hutangSelectionFns = `// ==========================================================================
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
        btn.innerHTML = \`<i data-lucide="file-text"></i> Export PDF (\${count})\`;
    } else {
        btn.disabled = true;
        btn.innerHTML = \`<i data-lucide="file-text"></i> Export PDF\`;
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
        btn.innerHTML = \`<i data-lucide="loader" class="animate-spin"></i> Menyiapkan PDF...\`;
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
        a.download = \`Laporan_Hutang_SupplierPro_\${nowStr}.pdf\`;
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
        textEl.innerHTML = \`Apakah Anda yakin ingin menghapus hutang outstanding <strong>\${id}</strong>?\`;
    }

    const paidNum = parseFloat(paid || 0);
    if (paidNum > 0) {
        if (alertEl) alertEl.style.display = 'block';
        if (alertText) {
            alertText.innerHTML = \`<strong>PERHATIAN:</strong> Hutang ini sudah memiliki pembayaran/cicilan sebesar <strong>\${rp(paidNum)}</strong>. Menghapus hutang ini akan membatalkan seluruh catatan cicilan dan membalikkan arus kas terkait!\`;
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
        const res = await fetch(\`/api/finance/payables/\${encodeURIComponent(id)}\`, {
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

${batchBAnchor}`;

if (!code.includes(batchBAnchor)) throw new Error('Anchor 16 not found');
code = code.replace(batchBAnchor, hutangSelectionFns);

// 17. Window attachments at the very end
const windowBindings = `
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
`;

code = code.trimEnd() + '\n' + windowBindings;

// Test parse with VM Script
try {
    new vm.Script(code);
    console.log('✅ VM Script parse test PASSED! No syntax/redeclaration error.');
} catch (e) {
    console.error('❌ VM Script parse FAILED:', e);
    process.exit(1);
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('✅ dashboard.js successfully patched! New length:', code.length);

