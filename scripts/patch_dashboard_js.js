const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'dashboard.js');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. savePurchase: ensure paid is 0 for new Kredit PO
const target1 = `    const paidInput = parseFloat(document.getElementById(\`\${prefix}-purchase-paid\`)?.value || 0);
    // Jika bukan kredit (Tunai/Transfer), paid otomatis = total (Lunas)
    const paid = isKredit ? paidInput : total;`;

const replace1 = `    const paidInput = parseFloat(document.getElementById(\`\${prefix}-purchase-paid\`)?.value || 0);
    // Jika bukan kredit (Tunai/Transfer), paid otomatis = total (Lunas). Untuk PO baru kredit, bayar = 0 (belum lunas)
    const paid = isKredit ? (isEdit ? paidInput : 0) : total;`;

if (content.includes(target1)) {
    content = content.replace(target1, replace1);
    console.log('✓ Patched savePurchase (paid calculation)');
} else {
    console.log('! Target 1 not found or already patched');
}

// 2. fetchInvoices: add payment_type_id filter
const target2 = `        if (page !== undefined) paginationState.invoices.page = page;
        const q = document.getElementById('invoice-search')?.value || '';
        const status = document.getElementById('invoice-status-filter')?.value || 'all';
        const pg = paginationState.invoices.page;
        let url = '/api/invoices?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (status && status !== 'all') url += '&status=' + encodeURIComponent(status);`;

const replace2 = `        if (page !== undefined) paginationState.invoices.page = page;
        const q = document.getElementById('invoice-search')?.value || '';
        const status = document.getElementById('invoice-status-filter')?.value || 'all';
        const paymentTypeId = document.getElementById('invoice-payment-type-filter')?.value || 'all';
        const pg = paginationState.invoices.page;
        let url = '/api/invoices?page=' + pg + '&limit=' + PAGE_SIZE;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (status && status !== 'all') url += '&status=' + encodeURIComponent(status);
        if (paymentTypeId && paymentTypeId !== 'all') url += '&payment_type_id=' + encodeURIComponent(paymentTypeId);`;

if (content.includes(target2)) {
    content = content.replace(target2, replace2);
    console.log('✓ Patched fetchInvoices (payment_type_id query param)');
} else {
    console.log('! Target 2 not found or already patched');
}

// 3. fetchInvoices: disable edit & bayar buttons if cancelled
const target3 = `                        \${canEdit ? \`<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Invoice" onclick="openEditInvoiceModal('\${inv.id}')">
                            <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                        </button>\` : ''}
                        \${statusLower !== 'lunas' && statusLower !== 'batal' ? \`<button class="btn-toolbar primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="openPiutangPaymentModal('\${inv.id}', \${sisa})">Bayar</button>\` : ''}`;

const replace3 = `                        \${canEdit && statusLower !== 'batal' && statusLower !== 'cancel' ? \`<button class="btn-toolbar secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" title="Edit Invoice" onclick="openEditInvoiceModal('\${inv.id}')">
                            <i data-lucide="edit-2" style="width: 14px; height: 14px; margin: 0;"></i>
                        </button>\` : ''}
                        \${statusLower !== 'lunas' && statusLower !== 'batal' && statusLower !== 'cancel' ? \`<button class="btn-toolbar primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="openPiutangPaymentModal('\${inv.id}', \${sisa})">Bayar</button>\` : ''}`;

if (content.includes(target3)) {
    content = content.replace(target3, replace3);
    console.log('✓ Patched fetchInvoices (cancelled invoice buttons)');
} else {
    console.log('! Target 3 not found or already patched');
}

// 4. openEditInvoiceModal: prevent editing cancelled invoice
const target4 = `async function openEditInvoiceModal(id) {
    const inv = INVOICES.find(x => x.id === id);
    if (!inv) return;

    document.getElementById('edit-invoice-id').value = inv.id;`;

const replace4 = `async function openEditInvoiceModal(id) {
    const inv = INVOICES.find(x => x.id === id);
    if (!inv) return;

    const statusLower = (inv.status || '').toLowerCase();
    if (statusLower === 'cancel' || statusLower === 'batal') {
        showToast('Invoice yang sudah dibatalkan tidak dapat diedit atau dibatalkan lagi.', 'warning');
        return;
    }

    document.getElementById('edit-invoice-id').value = inv.id;`;

if (content.includes(target4)) {
    content = content.replace(target4, replace4);
    console.log('✓ Patched openEditInvoiceModal (guard against cancelled)');
} else {
    console.log('! Target 4 not found or already patched');
}

// 5. cancelInvoice & confirmCancelInvoice: fallback ID and refresh piutang
const target5 = `async function cancelInvoice(id) {
    cancelInvoiceId = id;
    const inv = INVOICES.find(x => x.id === id);`;

const replace5 = `async function cancelInvoice(id) {
    if (!id) {
        id = document.getElementById('edit-invoice-id')?.value;
    }
    if (!id) return;
    cancelInvoiceId = id;
    const inv = INVOICES.find(x => x.id === id);`;

if (content.includes(target5)) {
    content = content.replace(target5, replace5);
    console.log('✓ Patched cancelInvoice (fallback ID)');
} else {
    console.log('! Target 5 not found or already patched');
}

const target5b = `            showToast('Invoice berhasil dibatalkan. Stok telah dikembalikan.', 'success');
            await fetchInvoices();
            await fetchProducts();
            renderPOSProducts();`;

const replace5b = `            showToast('Invoice berhasil dibatalkan. Stok telah dikembalikan.', 'success');
            await fetchInvoices();
            if (typeof fetchPiutang === 'function') await fetchPiutang();
            await fetchProducts();
            renderPOSProducts();`;

if (content.includes(target5b)) {
    content = content.replace(target5b, replace5b);
    console.log('✓ Patched confirmCancelInvoice (refresh piutang)');
} else {
    console.log('! Target 5b not found or already patched');
}

// 6. populateMasterDropdowns: populate invoice-payment-type-filter
const target6 = `        await fetchAndFill('/api/master/payment-types', ['cart-payment-type', 'add-purchase-payment-type', 'edit-purchase-payment-type', 'edit-invoice-payment-type', 'payment-method', 'manual-invoice-payment-type'], 'id', 'name');`;

const replace6 = `        const paymentTypes = await fetchAndFill('/api/master/payment-types', ['cart-payment-type', 'add-purchase-payment-type', 'edit-purchase-payment-type', 'edit-invoice-payment-type', 'payment-method', 'manual-invoice-payment-type'], 'id', 'name');

        // Populate Payment Type Filter in Invoices Page (Requirement 5)
        const invPayFilter = document.getElementById('invoice-payment-type-filter');
        if (invPayFilter && Array.isArray(paymentTypes)) {
            invPayFilter.innerHTML = '<option value="all">Semua Tipe</option>' + paymentTypes.map(p => \`<option value="\${p.id}">\${p.name}</option>\`).join('');
        }`;

if (content.includes(target6)) {
    content = content.replace(target6, replace6);
    console.log('✓ Patched populateMasterDropdowns (invoice-payment-type-filter)');
} else {
    console.log('! Target 6 not found or already patched');
}

// 7. fetchPiutang: render checkbox and delete button for outstanding invoices
const target7 = `        tbody.innerHTML = rows.map(inv => {
            const sisa = inv.total - inv.paid;
            const isOverdue = sisa > 0 && inv.dueDate && inv.dueDate < today;
            const statusLower = (inv.status || '').toLowerCase();
            const overdueBadge = isOverdue
                ? '<span class="badge-status overdue" style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;padding:2px 7px;margin-left:4px;vertical-align:middle;"><i data-lucide=\\"clock\\" style=\\"width:11px;height:11px;\\"></i> Lewat JT</span>'
                : '';
            let actionButtons;
            if (canPayOrVoid) {
                const bayarBtn = statusLower !== 'lunas'
                    ? \`<button class="btn-toolbar primary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="openPiutangPaymentModal('\${inv.id}', \${sisa})">Bayar</button>\`
                    : '<span style="color:var(--gray-400);font-size:0.8rem;">Lunas</span>';
                actionButtons = \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-right:0.25rem;" title="Riwayat Cicilan" onclick="openPaymentHistoryModal('\${inv.id}')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>\${bayarBtn}\`;
            } else {
                actionButtons = '<span style="color:var(--gray-400);font-size:0.8rem;">Lihat Saja</span>';
            }
            return \`
            <tr>
                <td style="font-weight:600; color:var(--blue-600);">\${inv.id}</td>
                <td>\${inv.customer || '-'}</td>
                <td style="font-weight:700;">\${rp(inv.total)}</td>
                <td>\${rp(inv.paid)}</td>
                <td style="font-weight:700; color:\${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">\${rp(sisa)}</td>
                <td>\${inv.dueDate || '-'}\${overdueBadge}</td>
                <td>\${statusLower.includes('belum') ? '-' : (inv.paidDate || '-')}</td>
                <td>\${statusLower.includes('belum') ? '-' : (inv.type || '-')}</td>
                <td><span class="badge-status \${statusLower.includes('belum') ? 'belum' : statusLower.replace(/\\s+/g, '-')}">\${capitalize(inv.status)}</span></td>
                <td style="text-align:right; white-space:nowrap;">\${actionButtons}</td>
            </tr>\`;
        }).join('');`;

const replace7 = `        tbody.innerHTML = rows.map(inv => {
            const sisa = inv.total - inv.paid;
            const isOverdue = sisa > 0 && inv.dueDate && inv.dueDate < today;
            const statusLower = (inv.status || '').toLowerCase();
            const overdueBadge = isOverdue
                ? '<span class="badge-status overdue" style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;padding:2px 7px;margin-left:4px;vertical-align:middle;"><i data-lucide=\\"clock\\" style=\\"width:11px;height:11px;\\"></i> Lewat JT</span>'
                : '';
            let actionButtons;
            if (canPayOrVoid) {
                const bayarBtn = statusLower !== 'lunas'
                    ? \`<button class="btn-toolbar primary" style="padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="openPiutangPaymentModal('\${inv.id}', \${sisa})">Bayar</button>\`
                    : '<span style="color:var(--gray-400);font-size:0.8rem;">Lunas</span>';
                
                // Requirement 2: Tombol Delete HANYA untuk invoice import outstanding
                const deleteBtn = inv.isOutstandingImport
                    ? \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-left:0.25rem;color:var(--rose-500);" title="Hapus Invoice Outstanding" onclick="confirmDeleteOutstandingInvoice('\${inv.id}', \${inv.paid || 0})"><i data-lucide="trash-2" style="width:13px;height:13px;margin:0;"></i></button>\`
                    : '';

                actionButtons = \`<button class="btn-toolbar secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;margin-right:0.25rem;" title="Riwayat Cicilan" onclick="openPaymentHistoryModal('\${inv.id}')"><i data-lucide="list" style="width:13px;height:13px;margin:0;"></i></button>\${bayarBtn}\${deleteBtn}\`;
            } else {
                actionButtons = '<span style="color:var(--gray-400);font-size:0.8rem;">Lihat Saja</span>';
            }

            // Requirement 6: Checkbox di sisi kiri invoice
            const isCancel = statusLower === 'cancel' || statusLower === 'batal';
            const isChecked = selectedPiutangIds.has(String(inv.id));
            const checkboxHtml = \`<td style="text-align: center; width: 36px;">
                <input type="checkbox" class="check-piutang-item" value="\${inv.id}" \${isCancel ? 'disabled' : ''} \${isChecked ? 'checked' : ''} onchange="onPiutangCheckboxChange(this, '\${inv.id}')">
            </td>\`;

            return \`
            <tr>
                \${checkboxHtml}
                <td style="font-weight:600; color:var(--blue-600);">\${inv.id}</td>
                <td>\${inv.customer || '-'}</td>
                <td style="font-weight:700;">\${rp(inv.total)}</td>
                <td>\${rp(inv.paid)}</td>
                <td style="font-weight:700; color:\${sisa > 0 ? 'var(--rose-500)' : 'var(--emerald-500)'};">\${rp(sisa)}</td>
                <td>\${inv.dueDate || '-'}\${overdueBadge}</td>
                <td>\${statusLower.includes('belum') ? '-' : (inv.paidDate || '-')}</td>
                <td>\${statusLower.includes('belum') ? '-' : (inv.type || '-')}</td>
                <td><span class="badge-status \${statusLower.includes('belum') ? 'belum' : statusLower.replace(/\\s+/g, '-')}">\${capitalize(inv.status)}</span></td>
                <td style="text-align:right; white-space:nowrap;">\${actionButtons}</td>
            </tr>\`;
        }).join('');

        updateCheckAllPiutangState();
        updateExportPdfButton();`;

if (content.includes(target7)) {
    content = content.replace(target7, replace7);
    console.log('✓ Patched fetchPiutang (checkbox + delete button)');
} else {
    console.log('! Target 7 not found or already patched');
}

// 8. Add Piutang Checkbox & Outstanding Delete helper functions
const helpersMarker = `// ==========================================================================
// PIUTANG SELECTION & EXPORT PDF (TASK 6)
// ==========================================================================`;

if (!content.includes(helpersMarker)) {
    const helpersCode = `
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
        btn.innerHTML = \`<i data-lucide="file-text"></i> Export PDF (\${count})\`;
    } else {
        btn.disabled = true;
        btn.innerHTML = \`<i data-lucide="file-text"></i> Export PDF\`;
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
        btn.innerHTML = \`<i data-lucide="loader" class="animate-spin"></i> Menyiapkan PDF...\`;
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
        a.download = \`Laporan_Piutang_SupplierPro_\${nowStr}.pdf\`;
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
        textEl.innerHTML = \`Apakah Anda yakin ingin menghapus invoice outstanding <strong>\${id}</strong>?\`;
    }

    const paidNum = parseFloat(paid || 0);
    if (paidNum > 0) {
        if (alertEl) alertEl.style.display = 'block';
        if (alertText) {
            alertText.innerHTML = \`<strong>PERHATIAN:</strong> Invoice ini sudah memiliki pembayaran/cicilan sebesar <strong>\${rp(paidNum)}</strong>. Menghapus invoice ini akan membatalkan seluruh catatan cicilan dan membalikkan arus kas terkait!\`;
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
        const res = await fetch(\`/api/finance/receivables/\${encodeURIComponent(id)}\`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-delete-outstanding');
            showToast('Invoice outstanding berhasil dihapus', 'success');
            selectedPiutangIds.delete(String(id));
            await fetchPiutang();
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
`;
    content += helpersCode;
    console.log('✓ Appended Piutang Selection, Export PDF, and Outstanding Delete helpers');
}

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Done writing dashboard.js!');

