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
 * Add N days to a YYYY-MM-DD string without Date timezone issues.
 * Returns DD/MM/YYYY string.
 */
function addDaysToDateStr(dateStr, days) {
    if (!dateStr || dateStr === '-') return '-';
    const clean = String(dateStr).split('T')[0].split(' ')[0];
    const parts = clean.split('-');
    if (parts.length < 3) return '-';
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    // Use UTC to avoid DST shift
    const ms = Date.UTC(y, m, d + days);
    const dt = new Date(ms);
    const ry = dt.getUTCFullYear();
    const rm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const rd = String(dt.getUTCDate()).padStart(2, '0');
    return `${rd}/${rm}/${ry}`;
}

/**
 * Deterministic pagination algorithm for Epson LQ-590 continuous form (24.13 x 13.97 cm).
 * Layout "Opsi C": header lebih ringkas (kiri: logo+perusahaan, kanan: customer saja),
 * info invoice di satu baris teks, tanda tangan lebih pendek → kapasitas naik.
 * - C_SINGLE: max items if invoice fits entirely on 1 page (includes full header, totals & signatures)
 * - C_P1: max items on Page 1 of multi-page (full header + items + "Bersambung", no totals/signatures)
 * - C_MID: max items on intermediate page (compact header + items + "Bersambung")
 * - C_LAST: max items on last page (compact header + items + totals & signatures)
 * Guarantees every page, especially the last page, has at least 1 item alongside totals.
 */
function paginateItems(items, config = {}) {
    const C_SINGLE = config.C_SINGLE || 10;
    const C_P1 = config.C_P1 || 13;
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
function renderInvoice(data, ppnEnabled, isProforma = false) {
    const comp = data.company || {};
    const customer = data.customer || {};
    const inv = isProforma ? (data.proforma || {}) : (data.invoice || {});
    const items = data.items || [];

    const storeName = comp.name || 'Nama Bisnis';
    const customerName = customer.name || 'Pelanggan Umum';
    const invoiceId = isProforma ? (inv.proforma_no || '-') : (inv.id || '-');
    const revisiSuffix = (isProforma && inv.revisi && Number(inv.revisi) > 0) ? ` (Rev. ${inv.revisi})` : '';
    const invoiceIdDisplay = `${invoiceId}${revisiSuffix}`;
    const invoiceDateStr = formatDate(isProforma ? inv.order_date : inv.date);
    const berlakuHinggaStr = formatDate(inv.berlaku_hingga);
    const paymentTypeName = inv.payment_type_name || 'Tunai';

    // Hitung jatuh tempo: tampilkan hanya jika tipe kredit (ada "hari" dalam nama)
    // Untuk invoice: ambil dari due_date yg sudah dihitung server
    // Untuk proforma: hitung dari order_date + hari kredit (kalau ada)
    let dueDateDisplay = '–';
    if (!isProforma) {
        // Invoice: due_date sudah ada di data dari server (saat Kredit)
        const rawDue = inv.due_date;
        if (rawDue && rawDue !== '-') {
            dueDateDisplay = formatDate(rawDue);
        } else {
            // Fallback: hitung dari nama payment type jika berformat "Kredit X Hari"
            const kredMatch = paymentTypeName.match(/kredit\s+(\d+)\s+hari/i);
            if (kredMatch && kredMatch[1]) {
                const rawDate = isProforma ? inv.order_date : inv.date;
                dueDateDisplay = addDaysToDateStr(String(rawDate).split('T')[0], parseInt(kredMatch[1], 10));
            }
        }
    } else {
        // Proforma: cek jika syarat pembayaran kredit
        const kredMatch = paymentTypeName.match(/kredit\s+(\d+)\s+hari/i);
        if (kredMatch && kredMatch[1]) {
            const rawDate = inv.order_date;
            dueDateDisplay = addDaysToDateStr(String(rawDate || '').split('T')[0], parseInt(kredMatch[1], 10));
        }
    }

    const pages = paginateItems(items, {
        C_SINGLE: 10,
        C_P1: 13,
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

        // ─── 1. HEADER ───────────────────────────────────────────────────────
        let headerHtml = '';
        if (isFirstPage) {
            // Logo diperkecil ~15% dari versi lama (max-height: 80px → 68px)
            const logoHtml = comp.logo
                ? `<img src="${comp.logo}" style="max-height: 68px; max-width: 100%; display: block; margin: 0 auto;">`
                : `<div style="width:60px;height:60px;border:1.5pt solid #000;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:9pt;color:#000;margin:0 auto;text-align:center;line-height:1.2;">${(storeName.match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase()}</div>`;

            const proformaBadge = isProforma ? `
                <div style="text-align:center; margin-bottom: 3pt;">
                    <span style="text-align:center; font-size:11pt; font-weight:bold; letter-spacing:1px; color:#000; border:2pt solid #000; display:inline-block; padding:1pt 8pt;">PROFORMA INVOICE</span>
                </div>` : '';

            // Blok kiri: logo + perusahaan (flex, sejajar vertikal)
            const leftBlockHtml = `
            <div style="flex: 0 0 55%; display: flex; align-items: flex-start; gap: 8pt;">
                <div style="flex-shrink: 0; width: 68pt; display: flex; align-items: center;">
                    ${logoHtml}
                </div>
                <div class="invoice-header-info" style="flex: 1; min-width: 0;">
                    ${proformaBadge}
                    <div style="font-size: 15pt; font-weight: bold; color: #000; line-height: 1.1; margin-bottom: 2pt; word-break: break-word;">${storeName}</div>
                    <table style="border: none; border-collapse: collapse;">
                        <tr>
                            <td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; vertical-align: top; font-size: 8.5pt;">Alamat</td>
                            <td style="vertical-align: top; padding: 0.5pt 0; font-size: 8.5pt;">: <span>${comp.address || '-'}</span></td>
                        </tr>
                        <tr>
                            <td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt;">Email</td>
                            <td style="padding: 0.5pt 0; font-size: 8.5pt;">: <span>${comp.email || '-'}</span></td>
                        </tr>
                        <tr>
                            <td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt;">Tlp</td>
                            <td style="padding: 0.5pt 0; font-size: 8.5pt;">: <span>${comp.phone || '-'}</span></td>
                        </tr>
                    </table>
                </div>
            </div>`;

            // Blok kanan: nama customer + alamat saja (maks 2 baris)
            // Proforma tambah baris "Berlaku Hingga" dan "Ref. Invoice"
            const berlakuRowHtml = (isProforma && inv.sumber !== 'dari_invoice') ? `
                <tr>
                    <td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt;">Berlaku Hingga</td>
                    <td style="padding: 0.5pt 0; font-size: 8.5pt;">: ${berlakuHinggaStr}</td>
                </tr>` : '';

            const refInvoiceRowHtml = (isProforma && inv.invoice_id) ? `
                <tr>
                    <td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt;">Ref. Invoice</td>
                    <td style="padding: 0.5pt 0; font-size: 8.5pt;">: ${inv.invoice_id}</td>
                </tr>` : '';

            const rightBlockHtml = `
            <div class="invoice-header-info" style="flex: 0 0 44%; padding-top: 2pt;">
                <table style="border: none; width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; font-size: 8.5pt; width: 100pt;">Nama Customer</td>
                        <td style="padding: 0.5pt 0; font-size: 8.5pt; word-break: break-word;">: ${customerName}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold; padding: 0.5pt 4pt 0.5pt 0; white-space: nowrap; vertical-align: top; font-size: 8.5pt;">Alamat Customer : </td>
                        <td style="padding: 0.5pt 0; font-size: 8.5pt; vertical-align: top; word-break: break-word; max-width: 160pt; overflow: hidden;">${customer.address || '-'}</td>
                    </tr>
                    ${berlakuRowHtml}
                    ${refInvoiceRowHtml}
                </table>
            </div>`;

            headerHtml = `
            <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 3pt; border-bottom: 1.5pt solid #000; padding-bottom: 4pt;">
                ${leftBlockHtml}
                ${rightBlockHtml}
            </div>`;

        } else {
            // Halaman lanjutan: compact header strip
            headerHtml = `
            <div class="invoice-compact-header-wrap">
                <div class="invoice-compact-strip">
                    ${isProforma ? 'PROFORMA | ' : ''}${storeName} | ${invoiceId} | ${customerName} | ${invoiceDateStr}
                </div>
                <div class="invoice-continuation-note">
                    Lanjutan ${invoiceId} (dari halaman sebelumnya)
                </div>
            </div>`;
        }

        // ─── 2. BARIS INFO INVOICE (hanya halaman pertama) ───────────────────
        let infoRowHtml = '';
        if (isFirstPage) {
            // Satu baris teks: tanpa tabel, tanpa kotak, tanpa garis, tanpa background
            // Jatuh Tempo selalu ada (slot tetap); tampilkan "–" jika bukan kredit
            const labelStyle = 'font-weight: bold;';
            const sepStyle = 'margin-right: 14pt;';
            infoRowHtml = `
            <div style="font-size: 8.5pt; color: #000; margin-bottom: 3pt; line-height: 1.4;">
                <span style="${labelStyle}">No. ${isProforma ? 'Proforma' : 'Invoice'}</span> : ${invoiceIdDisplay}<span style="${sepStyle}"></span>
                &nbsp;&nbsp;&nbsp;&nbsp;<span style="${labelStyle}">Tanggal</span> : ${invoiceDateStr}<span style="${sepStyle}"></span>
                &nbsp;&nbsp;&nbsp;&nbsp;<span style="${labelStyle}">${isProforma ? 'Syarat Pembayaran' : 'Payment'}</span> : ${paymentTypeName}<span style="${sepStyle}"></span>
                &nbsp;&nbsp;&nbsp;&nbsp;<span style="${labelStyle}">Jatuh Tempo</span> : ${dueDateDisplay}
            </div>`;
        }

        // ─── 3. BARIS TABEL PRODUK ───────────────────────────────────────────
        const rowsHtml = pageItems.map(it => {
            const rowNo = globalItemNo++;
            const productName = it.product_name || '-';
            return `
            <tr>
                <td style="text-align: center;">${rowNo}</td>
                <td style="text-align: left; white-space: normal; word-break: break-word; font-size: 8pt; line-height: 1.25;">${productName}</td>
                <td style="text-align: center;">${it.unit_name || '-'}</td>
                <td style="text-align: center;">${it.quantity}</td>
                <td style="text-align: right;">${rp(it.price).replace('Rp', '').trim()}</td>
                <td style="text-align: right;">${rp(it.total).replace('Rp', '').trim()}</td>
            </tr>`;
        }).join('');

        // ─── 4. "Bersambung" (bukan halaman terakhir) ────────────────────────
        let bersambungHtml = '';
        if (!isLastPage) {
            bersambungHtml = `
            <div class="invoice-bersambung">
                Bersambung ke halaman berikutnya &rarr;
            </div>`;
        }

        // ─── 5. FOOTER BAWAH (tanda tangan + total — hanya halaman terakhir) ─
        let bottomHtml = '';
        if (isLastPage) {
            // --- Komponen total ---
            const subtotal = parseFloat(inv.subtotal || 0);
            const diskon = parseFloat(inv.discount || 0);
            const taxAmt = ppnEnabled ? parseFloat(inv.tax || inv.ppn_amount || 0) : 0;
            const hasExtras = diskon > 0 || (ppnEnabled && taxAmt > 0);

            // SUB TOTAL hanya tampil kalau ada komponen lain (diskon / ppn)
            const subTotalRowHtml = hasExtras ? `
                <tr>
                    <td style="padding: 1.5pt 0; font-weight: bold; font-size: 8.5pt;">SUB TOTAL</td>
                    <td style="text-align: right; padding-left: 6pt; white-space: nowrap; font-size: 8.5pt;">${rp(subtotal).replace('Rp', '').trim()}</td>
                </tr>` : '';

            const diskonRowHtml = diskon > 0 ? `
                <tr>
                    <td style="padding: 1.5pt 0; font-weight: bold; font-size: 8.5pt;">DISKON</td>
                    <td style="text-align: right; padding-left: 6pt; white-space: nowrap; font-size: 8.5pt;">(${rp(diskon).replace('Rp', '').trim()})</td>
                </tr>` : '';

            const taxRowHtml = (ppnEnabled && taxAmt > 0) ? `
                <tr>
                    <td style="padding: 1.5pt 0; font-weight: bold; font-size: 8.5pt;">TAX${isProforma && inv.ppn_rate ? ` (${inv.ppn_rate}%)` : ''}</td>
                    <td style="text-align: right; padding-left: 6pt; white-space: nowrap; font-size: 8.5pt;">${rp(taxAmt).replace('Rp', '').trim()}</td>
                </tr>` : '';

            // Grand total TANPA garis di atasnya
            const grandTotalHtml = `
                <tr>
                    <td style="padding: 2pt 0 1.5pt; font-weight: bold; font-size: 10pt;">GRAND TOTAL</td>
                    <td style="text-align: right; font-weight: bold; font-size: 10pt; padding-left: 6pt; white-space: nowrap;">${rp(inv.total).replace('Rp', '').trim()}</td>
                </tr>`;

            // Tanda tangan: Proforma = Hormat kami + Customer, Invoice = Regards + Driver + Customer
            // Ruang tanda tangan dikurangi ~30% (margin-bottom: 2.5rem → 1.75rem, ≈ 1.2in → 0.84in)
            const signaturesHtml = isProforma ? `
                <div class="invoice-signatures" style="display: flex; gap: 2rem; font-size: 8.5pt;">
                    <div style="text-align: center;">
                        <div style="margin-bottom: 1.75rem;">Hormat kami,</div>
                        <div>(__________________)</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="margin-bottom: 1.75rem;">Customer,</div>
                        <div>(__________________)</div>
                    </div>
                </div>
            ` : `
                <div class="invoice-signatures" style="display: flex; gap: 1.5rem; font-size: 8.5pt;">
                    <div style="text-align: center;">
                        <div style="margin-bottom: 1.75rem;">Regards,</div>
                        <div>(__________________)</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="margin-bottom: 1.75rem;">Driver,</div>
                        <div>(__________________)</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="margin-bottom: 1.75rem;">Customer,</div>
                        <div>(__________________)</div>
                    </div>
                </div>
            `;

            const footerNoteHtml = isProforma ? `
                <div style="font-size: 7.5pt; font-style: italic; color: #444; text-align: center; margin-top: 3pt; border-top: 1pt dashed #aaa; padding-top: 2pt;">
                    Dokumen ini bukan bukti penagihan atau pembayaran.
                </div>
            ` : '';

            bottomHtml = `
            <div class="invoice-bottom" style="display: flex; justify-content: space-between; align-items: flex-end; color: #000; margin-top: 4pt;">
                <!-- Signatures -->
                ${signaturesHtml}

                <!-- Totals (kanan) -->
                <div class="invoice-totals" style="min-width: 190pt; max-width: 210pt; flex-shrink: 0; font-size: 8.5pt; align-self: flex-end;">
                    <table style="width: 100%; border-collapse: collapse; border: none;">
                        ${subTotalRowHtml}
                        ${diskonRowHtml}
                        ${taxRowHtml}
                        ${grandTotalHtml}
                    </table>
                </div>
            </div>
            ${footerNoteHtml}`;
        }

        // ─── 6. FOOTER HALAMAN (nomor halaman) ───────────────────────────────
        // Nomor invoice dihapus dari pojok kiri bawah (sudah ada di baris info)
        // Halaman tunggal: tidak tampilkan "Hal. 1 dari 1"
        const footerRight = isSinglePage ? '' : `Hal. ${pageNum} dari ${totalPages}`;
        const footerLeft = isSinglePage ? '' : invoiceId;
        const footerHtml = (footerLeft || footerRight) ? `
        <div class="invoice-page-footer">
            <div>${footerLeft}</div>
            <div>${footerRight}</div>
        </div>` : '';

        // ─── 7. RAKIT HALAMAN ─────────────────────────────────────────────────
        htmlOutput += `
        <div class="invoice-page ${isLastPage ? 'is-last-page' : ''}">
            ${headerHtml}
            ${infoRowHtml}
            <table class="invoice-items-table">
                <thead>
                    <tr>
                        <th style="text-align: center; width: 4%;">No.</th>
                        <th style="text-align: left; width: 44%;">Produk</th>
                        <th style="text-align: center; width: 10%;">Satuan</th>
                        <th style="text-align: center; width: 7%;">Qty</th>
                        <th style="text-align: right; width: 17%;">Harga</th>
                        <th style="text-align: right; width: 18%;">Total</th>
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
        const isProforma = urlParams.get('type') === 'proforma' || urlParams.has('pk');
        const entityId = isProforma ? (urlParams.get('pk') || urlParams.get('id')) : urlParams.get('id');

        if (!entityId) {
            showToast(isProforma ? 'PK Proforma tidak ditemukan' : 'ID Invoice tidak ditemukan', 'error');
            return;
        }

        try {
            const endpoint = isProforma
                ? `/api/proformas/${encodeURIComponent(entityId)}/print-data`
                : `/api/invoices/${encodeURIComponent(entityId)}/print-data`;
            const res = await fetch(endpoint, { headers: getAuthHeaders() });
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    window.location.href = 'index.html';
                    return;
                }
                let errDetail = `Status ${res.status}`;
                try {
                    const errJson = await res.json();
                    if (errJson.error) errDetail = errJson.error;
                } catch (_) { }
                throw new Error(errDetail);
            }
            const data = await res.json();

            if (isProforma) {
                document.title = `Proforma ${data.proforma?.proforma_no || ''} - SupplierPro`;
            } else {
                document.title = `Invoice ${data.invoice?.id || ''} - SupplierPro`;
            }

            // PPN status
            let ppnEnabled = isProforma
                ? (data.proforma.ppn_enabled === true || data.proforma.ppn_enabled === 'true' || data.proforma.ppn_enabled === 1)
                : (data.invoice.ppn_enabled === true || data.invoice.ppn_enabled === 'true');
            if (!isProforma && data.invoice.ppn_enabled === undefined) {
                try {
                    const settingsRes = await fetch('/api/settings', { headers: getAuthHeaders() });
                    if (settingsRes.ok) {
                        const settingsData = await settingsRes.json();
                        ppnEnabled = settingsData.ppn_enabled !== 'false' && settingsData.ppn_enabled !== false;
                    }
                } catch (e) { }
            }

            renderInvoice(data, ppnEnabled, isProforma);
        } catch (err) {
            console.error('[Print Data] Error:', err);
            const docName = isProforma ? 'proforma' : 'invoice';
            showToast(`Gagal memuat ${docName}: ${err.message}`, 'error');
            const container = document.getElementById('print-pages-container');
            if (container) {
                container.innerHTML = `<div style="text-align: center; padding: 3rem; color: #ef4444;">Gagal memuat ${docName}: ${err.message}. Silakan coba lagi.</div>`;
            }
        }
    });
}

// Export functions for unit testing in node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { rp, formatDate, addDaysToDateStr, paginateItems, renderInvoice };
}
