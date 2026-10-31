const fs = require('fs');

const htmlPath = 'c:/Vibes Coding/SupplierProSQL/dashboard.html';
let content = fs.readFileSync(htmlPath, 'utf8');

// 1. Remove #add-purchase-paid
const paidGroupRegex = /<div class="form-group">\s*<label>Jumlah Bayar \(Rp\)<\/label>\s*<input type="number" id="add-purchase-paid" class="form-input" placeholder="0">\s*<\/div>/;
if (paidGroupRegex.test(content)) {
  content = content.replace(paidGroupRegex, '');
  console.log('1. Removed #add-purchase-paid successfully');
} else {
  console.log('1. Warning: #add-purchase-paid not found');
}

// 2. Add #invoice-payment-type-filter after #invoice-status-filter
const invoiceFilterTarget = `</select>
                        </div>
                        <div class="page-toolbar-right">
                            <button class="btn-toolbar secondary" id="btn-import-invoice"`;
const invoiceFilterReplacement = `</select>
                            <select class="filter-select" id="invoice-payment-type-filter" onchange="renderInvoices()">
                                <option value="all">Semua Tipe</option>
                            </select>
                        </div>
                        <div class="page-toolbar-right">
                            <button class="btn-toolbar secondary" id="btn-import-invoice"`;

if (content.includes(invoiceFilterTarget)) {
  content = content.replace(invoiceFilterTarget, invoiceFilterReplacement);
  console.log('2. Added #invoice-payment-type-filter successfully');
} else {
  // Try CRLF
  const targetCRLF = invoiceFilterTarget.replace(/\n/g, '\r\n');
  const replCRLF = invoiceFilterReplacement.replace(/\n/g, '\r\n');
  if (content.includes(targetCRLF)) {
    content = content.replace(targetCRLF, replCRLF);
    console.log('2. Added #invoice-payment-type-filter successfully (CRLF)');
  } else {
    console.log('2. Warning: invoice filter target not found');
  }
}

// 3. Add #btn-export-pdf-piutang before #btn-import-piutang
const piutangExportTarget = `<button class="btn-toolbar secondary" id="btn-import-piutang"`;
const piutangExportReplacement = `<button class="btn-toolbar secondary" id="btn-export-pdf-piutang" disabled onclick="exportPiutangPDF()">
                                <i data-lucide="file-text"></i> Export PDF
                            </button>
                            <button class="btn-toolbar secondary" id="btn-import-piutang"`;

if (content.includes(piutangExportTarget)) {
  content = content.replace(piutangExportTarget, piutangExportReplacement);
  console.log('3. Added #btn-export-pdf-piutang successfully');
} else {
  console.log('3. Warning: piutang export target not found');
}

// 4. Add checkbox in piutang table header
const piutangThTarget = `<thead>\n                                <tr>\n                                    <th>Invoice</th>`;
const piutangThTargetCRLF = `<thead>\r\n                                <tr>\r\n                                    <th>Invoice</th>`;
const piutangThReplacement = `<thead>\n                                <tr>\n                                    <th style="width: 36px; text-align: center;"><input type="checkbox" id="check-all-piutang" onchange="toggleSelectAllPiutang(this)"></th>\n                                    <th>Invoice</th>`;
const piutangThReplacementCRLF = `<thead>\r\n                                <tr>\r\n                                    <th style="width: 36px; text-align: center;"><input type="checkbox" id="check-all-piutang" onchange="toggleSelectAllPiutang(this)"></th>\r\n                                    <th>Invoice</th>`;

if (content.includes(piutangThTarget)) {
  content = content.replace(piutangThTarget, piutangThReplacement);
  console.log('4. Added piutang table header checkbox successfully');
} else if (content.includes(piutangThTargetCRLF)) {
  content = content.replace(piutangThTargetCRLF, piutangThReplacementCRLF);
  console.log('4. Added piutang table header checkbox successfully (CRLF)');
} else {
  console.log('4. Warning: piutang table header target not found');
}

// 5. Update cancel button in modal-edit-invoice
const cancelBtnTarget = `<i data-lucide="x-circle"></i> Batalkan Invoice`;
const cancelBtnReplacement = `<i data-lucide="x-circle"></i> Cancel Invoice`;
if (content.includes(cancelBtnTarget)) {
  content = content.replace(cancelBtnTarget, cancelBtnReplacement);
  console.log('5. Renamed cancel button to Cancel Invoice');
}

// 6. Add #modal-delete-outstanding before closing </body>
const deleteModalHtml = `
    <!-- Modal Delete Outstanding Invoice -->
    <div class="modal-overlay" id="modal-delete-outstanding">
        <div class="modal" style="max-width: 450px;">
            <div class="modal-header">
                <h3>Hapus Invoice Outstanding</h3>
                <button class="modal-close" onclick="closeModal('modal-delete-outstanding')"><i data-lucide="x"></i></button>
            </div>
            <div class="modal-body">
                <input type="hidden" id="delete-outstanding-id">
                <input type="hidden" id="delete-outstanding-paid">
                <p id="delete-outstanding-text" style="color: var(--gray-700); margin-bottom: 1rem;">
                    Apakah Anda yakin ingin menghapus invoice outstanding ini?
                </p>
                <div id="delete-outstanding-alert" style="display: none; margin-bottom: 1rem; font-size: 0.875rem; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; padding: 0.75rem; border-radius: 0.5rem; line-height: 1.4;">
                    <i data-lucide="alert-triangle" style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 0.25rem;"></i>
                    <span id="delete-outstanding-alert-text"></span>
                </div>
                <p style="font-size: 0.825rem; color: var(--gray-500); background: var(--gray-50); padding: 0.5rem 0.75rem; border-radius: 0.375rem; border: 1px solid var(--gray-200);">
                    <i data-lucide="info" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 0.25rem;"></i>
                    Penghapusan invoice outstanding tidak mengubah stok master produk.
                </p>
            </div>
            <div class="modal-footer">
                <button class="btn-toolbar secondary" onclick="closeModal('modal-delete-outstanding')">Batal</button>
                <button class="btn-toolbar primary" id="btn-confirm-delete-outstanding" style="background: #e11d48; color: white; border-color: #e11d48;" onclick="executeDeleteOutstandingInvoice()">
                    <i data-lucide="trash-2"></i> Ya, Hapus
                </button>
            </div>
        </div>
    </div>
`;

if (!content.includes('id="modal-delete-outstanding"')) {
  content = content.replace('</body>', deleteModalHtml + '\n</body>');
  console.log('6. Added modal-delete-outstanding successfully');
}

fs.writeFileSync(htmlPath, content, 'utf8');
console.log('Finished patching dashboard.html');
