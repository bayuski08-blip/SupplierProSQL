// Function to format Rupiah
function rp(amount) {
    if (amount === undefined || amount === null) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
}

// Function to get Auth Headers
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return {
        'Authorization': `Bearer ${token}`
    };
}

// Toast
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.background = type === 'error' ? '#ef4444' : (type === 'success' ? '#10b981' : '#3b82f6');
    toast.style.color = 'white';
    toast.style.padding = '1rem';
    toast.style.borderRadius = '0.5rem';
    toast.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
    toast.style.marginBottom = '0.5rem';
    
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    
    toast.innerHTML = `<div style="display: flex; align-items: center; gap: 0.5rem;"><i data-lucide="${icon}"></i> <span>${message}</span></div>`;
    toastContainer.appendChild(toast);
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Handle close button
function closePrintTab() {
    window.close();
    // Fallback if browser prevents script from closing window
    setTimeout(() => {
        window.location.href = 'dashboard.html';
    }, 300);
}

// Timezone-safe date formatting to DD/MM/YYYY (never instantiate Date object)
function formatDate(ds) {
    if (!ds) return '-';
    const clean = String(ds).split('T')[0].split(' ')[0];
    const p = clean.split('-');
    if (p.length < 3) return ds;
    return `${p[2]}/${p[1]}/${p[0]}`;
}

/**
 * Deterministic pagination algorithm for Epson LQ-590 continuous form (24.13 x 13.97 cm).
 * Distributes items across pages respecting height capacities:
 * - C_SINGLE: max items if invoice fits entirely on 1 page (includes full header, totals & signatures)
 * - C_P1: max items on Page 1 of multi-page (full header + items + "Bersambung", no totals/signatures)
 * - C_MID: max items on intermediate page (compact header + items + "Bersambung")
 * - C_LAST: max items on last page (compact header + items + totals & signatures)
 * Guarantees every page, especially the last page, has at least 1 item alongside totals.
 */
function paginateItems(items, config = {}) {
    const C_SINGLE = config.C_SINGLE || 9;
    const C_P1 = config.C_P1 || 12;
    const C_MID = config.C_MID || 16;
    const C_LAST = config.C_LAST || 12;

    const totalItems = items.length;
    if (totalItems === 0) return [[]];
    if (totalItems <= C_SINGLE) return [items];

    let K;
    if (totalItems <= C_P1 + C_LAST) {
        K = 2;
    } else {
        K = 2 + Math.ceil((totalItems - C_P1 - C_LAST) / C_MID);
    }

    const pages = [];
    let itemIndex = 0;

    for (let p = 1; p <= K; p++) {
        if (p === K) {
            pages.push(items.slice(itemIndex));
            break;
        }

        const maxCap = (p === 1) ? C_P1 : C_MID;
        const remainingPagesAfterThis = K - p;
        const minNeededForLater = remainingPagesAfterThis * 1;
        const maxCapacityLater = (remainingPagesAfterThis - 1) * C_MID + C_LAST;
        const remainingItemsNow = totalItems - itemIndex;

        const minToTake = Math.max(1, remainingItemsNow - maxCapacityLater);
        const maxToTake = Math.min(maxCap, remainingItemsNow - minNeededForLater);
        const take = Math.max(minToTake, maxToTake);

        pages.push(items.slice(itemIndex, itemIndex + take));
        itemIndex += take;
    }

    return pages;
}

// Render paginated invoice into the container
function renderInvoice(data, ppnEnabled) {
    const comp = data.company || {};
    const customer = data.customer || {};
    const inv = data.invoice || {};
    const items = data.items || [];

    const storeName = comp.name || 'Nama Bisnis';
    const customerName = customer.name || 'Pelanggan Umum';
    const invoiceId = inv.id || '-';
    const invoiceDateStr = formatDate(inv.date);
    const invoiceDueDateStr = formatDate(inv.due_date);
    const paymentTypeName = inv.payment_type_name || 'Tunai';
    const isTempo = paymentTypeName.toLowerCase().includes('tempo');

    const pages = paginateItems(items, {
        C_SINGLE: 9,
        C_P1: 12,
        C_MID: 16,
        C_LAST: 12
    });

    const totalPages = pages.length;
    const isSinglePage = (totalPages === 1);

    const container = document.getElementById('print-pages-container');
    if (!container) return;

    let globalItemNo = 1;
    let htmlOutput = '';

    pages.forEach((pageItems, pageIdx) => {
        const pageNum = pageIdx + 1;
        const isFirstPage = (pageNum === 1);
        const isLastPage = (pageNum === totalPages);

        // 1. Header
        let headerHtml = '';
        if (isFirstPage) {
            // Full header
            const logoHtml = comp.logo
                ? `<img src="${comp.logo}" style="max-height: 80px; max-width: 100%; display: block; margin: 0 auto;">`
                : '';

            const dueDateRowHtml = isTempo ? `
                <tr id="print-row-due-date">
                    <td style="font-weight: bold; padding: 0.12rem 0;">Jatuh Tempo</td>
                    <td style="padding: 0.12rem 0;">: <span style="display: inline-block; width: calc(100% - 15px); border-bottom: 1px solid #000; min-height: 1rem;">${invoiceDueDateStr}</span></td>
                </tr>` : '';

            headerHtml = `
            <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.4rem;">
                <!-- Kiri: Logo -->
                <div style="flex: 0 0 15%; text-align: center;">
                    ${logoHtml}
                </div>
                <!-- Tengah: Toko & Alamat -->
                <div class="invoice-header-info" style="flex: 0 0 45%;">
                    <h2 style="margin: 0 0 0.25rem 0; font-size: 2.6rem; color: #000; font-weight: bold; line-height: 1.1; word-break: break-word;">${storeName}</h2>
                    <table style="border: none; border-collapse: collapse; margin-bottom: 0;">
                        <tr>
                            <td style="font-weight: bold; padding: 0.1rem 0.5rem 0.1rem 0; white-space: nowrap; vertical-align: top;">Alamat</td>
                            <td style="vertical-align: top; padding: 0.1rem 0;">: <span>${comp.address || '-'}</span></td>
                        </tr>
                        <tr>
                            <td style="font-weight: bold; padding: 0.1rem 0.5rem 0.1rem 0; white-space: nowrap;">Email</td>
                            <td style="padding: 0.1rem 0;">: <span>${comp.email || '-'}</span></td>
                        </tr>
                        <tr>
                            <td style="font-weight: bold; padding: 0.1rem 0.5rem 0.1rem 0; white-space: nowrap;">Tlp</td>
                            <td style="padding: 0.1rem 0;">: <span>${comp.phone || '-'}</span></td>
                        </tr>
                    </table>
                </div>
                <!-- Kanan: Customer & Info Invoice -->
                <div class="invoice-header-info" style="flex: 0 0 40%; padding-top: 0.25rem;">
                    <table style="border: none; width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="font-weight: bold; padding: 0.12rem 0; width: 110px;">Nama Customer</td>
                            <td style="padding: 0.12rem 0;">: <span style="display: inline-block; width: calc(100% - 15px); border-bottom: 1px solid #000; min-height: 1rem;">${customerName}</span></td>
                        </tr>
                        <tr>
                            <td style="font-weight: bold; padding: 0.12rem 0;">Alamat Customer</td>
                            <td style="padding: 0.12rem 0;">: <span style="display: inline-block; width: calc(100% - 15px); border-bottom: 1px solid #000; min-height: 1rem;">${customer.address || '-'}</span></td>
                        </tr>
                        <tr>
                            <td style="font-weight: bold; padding: 0.12rem 0;">Tanggal</td>
                            <td style="padding: 0.12rem 0;">: <span style="display: inline-block; width: calc(100% - 15px); border-bottom: 1px solid #000; min-height: 1rem;">${invoiceDateStr}</span></td>
                        </tr>
                        <tr>
                            <td style="font-weight: bold; padding: 0.12rem 0;">No. Invoice</td>
                            <td style="padding: 0.12rem 0;">: <span style="display: inline-block; width: calc(100% - 15px); border-bottom: 1px solid #000; min-height: 1rem;">${invoiceId}</span></td>
                        </tr>
                        ${dueDateRowHtml}
                        <tr>
                            <td style="font-weight: bold; padding: 0.12rem 0;">Payment</td>
                            <td style="padding: 0.12rem 0;">: <span style="display: inline-block; width: calc(100% - 15px); border-bottom: 1px solid #000; min-height: 1rem;">${paymentTypeName}</span></td>
                        </tr>
                    </table>
                </div>
            </div>`;
        } else {
            // Continuation pages: compact header strip + continuation line
            headerHtml = `
            <div class="invoice-compact-header-wrap">
                <div class="invoice-compact-strip">
                    ${storeName} | ${invoiceId} | ${customerName} | ${invoiceDateStr}
                </div>
                <div class="invoice-continuation-note">
                    Lanjutan ${invoiceId} (dari halaman sebelumnya)
                </div>
            </div>`;
        }

        // 2. Table rows
        const rowsHtml = pageItems.map(it => {
            const rowNo = globalItemNo++;
            return `
            <tr>
                <td style="text-align: center;">${rowNo}</td>
                <td style="text-align: left;">${it.product_name || '-'}</td>
                <td style="text-align: center;">${it.unit_name || '-'}</td>
                <td style="text-align: center;">${it.quantity}</td>
                <td style="text-align: right;">${rp(it.price).replace('Rp', '').trim()}</td>
                <td style="text-align: right;">${rp(it.total).replace('Rp', '').trim()}</td>
            </tr>`;
        }).join('');

        // 3. "Bersambung" notice (only on pages that are not last)
        let bersambungHtml = '';
        if (!isLastPage) {
            bersambungHtml = `
            <div class="invoice-bersambung">
                Bersambung ke halaman berikutnya &rarr;
            </div>`;
        }

        // 4. Bottom block (signatures + totals ONLY on last page)
        let bottomHtml = '';
        if (isLastPage) {
            const taxRowHtml = ppnEnabled ? `
                <tr>
                    <td style="padding: 0.15rem 0; font-weight: bold;">TAX</td>
                    <td style="text-align: right; padding-left: 0.5rem; white-space: nowrap;">${rp(inv.tax).replace('Rp', '').trim()}</td>
                </tr>` : '';

            bottomHtml = `
            <div class="invoice-bottom" style="display: flex; justify-content: space-between; align-items: flex-start; color: #000; margin-top: 0.35rem;">
                <!-- Signatures -->
                <div class="invoice-signatures" style="display: flex; gap: 2rem; font-size: 0.875rem;">
                    <div style="text-align: center;">
                        <div style="margin-bottom: 2.5rem;">Regards,</div>
                        <div>(__________________)</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="margin-bottom: 2.5rem;">Driver,</div>
                        <div>(__________________)</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="margin-bottom: 2.5rem;">Customer,</div>
                        <div>(__________________)</div>
                    </div>
                </div>

                <!-- Totals -->
                <div class="invoice-totals" style="min-width: 210px; max-width: 230px; flex-shrink: 0; font-size: 0.875rem;">
                    <table style="width: 100%; border-collapse: collapse; border: none;">
                        <tr>
                            <td style="padding: 0.15rem 0; font-weight: bold;">SUB TOTAL</td>
                            <td style="text-align: right; padding-left: 0.5rem; white-space: nowrap;">${rp(inv.subtotal).replace('Rp', '').trim()}</td>
                        </tr>
                        ${taxRowHtml}
                        <tr>
                            <td style="padding: 0.35rem 0; font-weight: bold; font-size: 1rem; border-top: 2px solid #000;">GRAND TOTAL</td>
                            <td style="text-align: right; font-weight: bold; font-size: 1rem; border-top: 2px solid #000; padding-left: 0.5rem; white-space: nowrap;">${rp(inv.total).replace('Rp', '').trim()}</td>
                        </tr>
                    </table>
                </div>
            </div>`;
        }

        // 5. Footer
        const footerRight = isSinglePage ? '' : `Hal. ${pageNum} dari ${totalPages}`;
        const footerHtml = `
        <div class="invoice-page-footer">
            <div>${invoiceId}</div>
            <div>${footerRight}</div>
        </div>`;

        // Assemble page
        htmlOutput += `
        <div class="invoice-page ${isLastPage ? 'is-last-page' : ''}">
            ${headerHtml}
            <table class="invoice-items-table">
                <thead>
                    <tr>
                        <th style="text-align: center; width: 5%;">No.</th>
                        <th style="text-align: left; width: 36%;">Produk</th>
                        <th style="text-align: center; width: 12%;">Satuan</th>
                        <th style="text-align: center; width: 8%;">Qty</th>
                        <th style="text-align: right; width: 19%;">Harga</th>
                        <th style="text-align: right; width: 20%;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            ${bersambungHtml}
            ${bottomHtml}
            ${footerHtml}
        </div>`;
    });

    container.innerHTML = htmlOutput;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Main Logic
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = 'index.html';
            return;
        }

        if (typeof lucide !== 'undefined') lucide.createIcons();

        const urlParams = new URLSearchParams(window.location.search);
        const invoiceId = urlParams.get('id');

        if (!invoiceId) {
            showToast('ID Invoice tidak ditemukan', 'error');
            return;
        }

        try {
            const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/print-data`, { headers: getAuthHeaders() });
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    window.location.href = 'index.html';
                    return;
                }
                throw new Error('Failed to load print data');
            }
            const data = await res.json();

            // PPN status
            let ppnEnabled = (data.invoice.ppn_enabled === true || data.invoice.ppn_enabled === 'true');
            if (data.invoice.ppn_enabled === undefined) {
                try {
                    const settingsRes = await fetch('/api/settings', { headers: getAuthHeaders() });
                    if (settingsRes.ok) {
                        const settingsData = await settingsRes.json();
                        ppnEnabled = settingsData.ppn_enabled !== 'false' && settingsData.ppn_enabled !== false;
                    }
                } catch(e) {}
            }

            renderInvoice(data, ppnEnabled);
        } catch (err) {
            console.error(err);
            showToast('Gagal menyiapkan print data', 'error');
            const container = document.getElementById('print-pages-container');
            if (container) {
                container.innerHTML = '<div style="text-align: center; padding: 3rem; color: #ef4444;">Gagal memuat invoice. Silakan coba lagi.</div>';
            }
        }
    });
}

// Export functions for unit testing in node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { rp, formatDate, paginateItems, renderInvoice };
}
