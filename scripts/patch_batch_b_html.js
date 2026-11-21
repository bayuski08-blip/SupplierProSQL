const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'dashboard.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Backup original
fs.writeFileSync(htmlPath + '.bak_batch_b', html, 'utf8');
console.log('Backup created at dashboard.html.bak_batch_b');

// =========================================================================
// 1. Sidebar Nav Items
// =========================================================================
// Add Stock Move right under Products
const navProductsTarget = `<div class="nav-item" data-page="products" id="nav-products">
                        <i data-lucide="package-search"></i> Produk & Stok
                    </div>`;

const navStockMoveItem = `<div class="nav-item" data-page="products" id="nav-products">
                        <i data-lucide="package-search"></i> Produk & Stok
                    </div>
                    <div class="nav-item" data-page="stock-moves" id="nav-stock-moves">
                        <i data-lucide="boxes"></i> Stock Move
                    </div>`;

if (!html.includes('id="nav-stock-moves"')) {
  html = html.replace(navProductsTarget, navStockMoveItem);
  console.log('1. Added Stock Move to sidebar nav.');
}

// Add Retur right under Invoices
const navInvoicesTarget = `<div class="nav-item" data-page="invoices" id="nav-invoices">
                        <i data-lucide="file-text"></i> Transaksi / Invoice
                    </div>`;

const navReturnsItem = `<div class="nav-item" data-page="invoices" id="nav-invoices">
                        <i data-lucide="file-text"></i> Transaksi / Invoice
                    </div>
                    <div class="nav-item" data-page="returns" id="nav-returns">
                        <i data-lucide="rotate-ccw"></i> Retur
                    </div>`;

if (!html.includes('id="nav-returns"')) {
  html = html.replace(navInvoicesTarget, navReturnsItem);
  console.log('2. Added Retur to sidebar nav.');
}

// =========================================================================
// 2. Dashboard Card "Stock Move Terbaru"
// =========================================================================
const dashCardTarget = `<div class="dash-card" id="dash-card-low-stock">`;

const dashCardRecentStockMove = `<!-- Card Stock Move Terbaru (Admin & Gudang) -->
                        <div class="dash-card" id="dash-card-recent-stock-moves" style="display: none;">
                            <div class="dash-card-header">
                                <span class="dash-card-title">Stock Move Terbaru</span>
                                <button class="dash-card-action" onclick="navigateTo('stock-moves')">Lihat Semua</button>
                            </div>
                            <div class="dash-card-body" style="padding: 0; max-height: 290px; overflow-y: auto;">
                                <table class="data-table" id="recent-stock-moves-table">
                                    <thead>
                                        <tr>
                                            <th>Waktu</th>
                                            <th>Produk</th>
                                            <th>Tipe</th>
                                            <th>Ref</th>
                                            <th>Masuk</th>
                                            <th>Keluar</th>
                                            <th>Sisa</th>
                                        </tr>
                                    </thead>
                                    <tbody id="recent-stock-moves-body">
                                        <!-- Rendered by JS -->
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="dash-card" id="dash-card-low-stock">`;

if (!html.includes('id="dash-card-recent-stock-moves"')) {
  html = html.replace(dashCardTarget, dashCardRecentStockMove);
  console.log('3. Added Stock Move Terbaru card to dashboard.');
}

// =========================================================================
// 3. Add Page Sections: #page-returns and #page-stock-moves
// =========================================================================
const pageSectionsTarget = `            </div><!-- /content-area -->`;

const pageSectionsContent = `                <!-- ============================================================
                 PAGE: DAFTAR RETUR (B4.1)
                 ============================================================ -->
                <section class="page-section" id="page-returns">
                    <div class="page-toolbar" style="flex-wrap: wrap; gap: 0.75rem;">
                        <div class="page-toolbar-left" style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                            <div class="tab-filters" id="returns-tabs">
                                <button class="tab-filter active" id="tab-btn-returns-sales" onclick="switchReturnsTab('sales')">Retur Penjualan</button>
                                <button class="tab-filter" id="tab-btn-returns-purchases" onclick="switchReturnsTab('purchases')">Retur Pembelian</button>
                            </div>
                            <div class="toolbar-search">
                                <i data-lucide="search"></i>
                                <input type="text" placeholder="Cari no. retur, no. ref, nama..." id="returns-search" oninput="debounceReturnsSearch()">
                            </div>
                        </div>
                        <div class="page-toolbar-right" style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem;">
                                <span>Dari:</span>
                                <input type="date" id="returns-date-from" class="form-input" style="padding: 0.35rem 0.5rem; font-size: 0.85rem;" onchange="loadReturnsCurrentTab()">
                                <span>s/d</span>
                                <input type="date" id="returns-date-to" class="form-input" style="padding: 0.35rem 0.5rem; font-size: 0.85rem;" onchange="loadReturnsCurrentTab()">
                            </div>
                            <button class="btn-toolbar secondary" onclick="resetReturnsFilter()">
                                <i data-lucide="rotate-ccw"></i> Reset
                            </button>
                        </div>
                    </div>

                    <!-- Tab Content: Retur Penjualan -->
                    <div id="returns-sales-content">
                        <div class="data-table-wrapper">
                            <table class="data-table" id="returns-sales-table">
                                <thead>
                                    <tr>
                                        <th>No. Retur</th>
                                        <th>Tanggal</th>
                                        <th>No. Invoice</th>
                                        <th>Pelanggan</th>
                                        <th style="text-align: center;">Item</th>
                                        <th>Alasan</th>
                                        <th>Kondisi</th>
                                        <th class="th-returns-finance" style="text-align: right;">Nilai Retur</th>
                                        <th style="text-align: right;">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody id="returns-sales-body">
                                    <!-- Rendered by JS -->
                                </tbody>
                            </table>
                        </div>
                        <div class="empty-state" id="returns-sales-empty" style="display:none;">
                            <i data-lucide="rotate-ccw"></i>
                            <p>Belum ada data retur penjualan.</p>
                        </div>
                        <div id="pagination-returns-sales" class="pagination-container"></div>
                    </div>

                    <!-- Tab Content: Retur Pembelian -->
                    <div id="returns-purchases-content" style="display: none;">
                        <div class="data-table-wrapper">
                            <table class="data-table" id="returns-purchases-table">
                                <thead>
                                    <tr>
                                        <th>No. Retur</th>
                                        <th>Tanggal</th>
                                        <th>No. PO</th>
                                        <th>Vendor</th>
                                        <th style="text-align: center;">Item</th>
                                        <th>Alasan</th>
                                        <th class="th-returns-finance" style="text-align: right;">Nilai Retur</th>
                                        <th style="text-align: right;">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody id="returns-purchases-body">
                                    <!-- Rendered by JS -->
                                </tbody>
                            </table>
                        </div>
                        <div class="empty-state" id="returns-purchases-empty" style="display:none;">
                            <i data-lucide="rotate-ccw"></i>
                            <p>Belum ada data retur pembelian.</p>
                        </div>
                        <div id="pagination-returns-purchases" class="pagination-container"></div>
                    </div>
                </section>

                <!-- ============================================================
                 PAGE: STOCK MOVE (B4.2)
                 ============================================================ -->
                <section class="page-section" id="page-stock-moves">
                    <div class="page-toolbar" style="flex-wrap: wrap; gap: 0.75rem;">
                        <div class="page-toolbar-left" style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                            <div class="toolbar-search">
                                <i data-lucide="search"></i>
                                <input type="text" placeholder="Cari nama produk, SKU, ref..." id="stock-moves-search" oninput="debounceStockMovesSearch()">
                            </div>
                            <select id="stock-moves-filter-type" class="form-input" style="padding: 0.45rem 0.75rem; font-size: 0.85rem;" onchange="loadStockMoves(1)">
                                <option value="all">Semua Tipe</option>
                                <option value="penjualan">Penjualan</option>
                                <option value="pembelian">Pembelian</option>
                                <option value="opname">Opname</option>
                                <option value="retur_penjualan">Retur Penjualan</option>
                                <option value="retur_penjualan_rusak">Retur Rusak</option>
                                <option value="retur_pembelian">Retur Pembelian</option>
                                <option value="cancel_invoice">Cancel Invoice</option>
                                <option value="koreksi_edit">Koreksi Edit</option>
                                <option value="stok_awal">Stok Awal</option>
                            </select>
                        </div>
                        <div class="page-toolbar-right" style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem;">
                                <span>Dari:</span>
                                <input type="date" id="stock-moves-date-from" class="form-input" style="padding: 0.35rem 0.5rem; font-size: 0.85rem;" onchange="loadStockMoves(1)">
                                <span>s/d</span>
                                <input type="date" id="stock-moves-date-to" class="form-input" style="padding: 0.35rem 0.5rem; font-size: 0.85rem;" onchange="loadStockMoves(1)">
                            </div>
                            <button class="btn-toolbar secondary" onclick="resetStockMovesFilter()">
                                <i data-lucide="rotate-ccw"></i> Reset
                            </button>
                        </div>
                    </div>

                    <div class="data-table-wrapper">
                        <table class="data-table" id="stock-moves-table">
                            <thead>
                                <tr>
                                    <th>Tanggal & Waktu</th>
                                    <th>Produk</th>
                                    <th>Tipe</th>
                                    <th>No. Referensi</th>
                                    <th style="text-align: right;">Qty Masuk</th>
                                    <th style="text-align: right;">Qty Keluar</th>
                                    <th style="text-align: right;">Stok Sesudah</th>
                                    <th>Keterangan</th>
                                    <th>Petugas</th>
                                </tr>
                            </thead>
                            <tbody id="stock-moves-body">
                                <!-- Rendered by JS -->
                            </tbody>
                        </table>
                    </div>
                    <div class="empty-state" id="stock-moves-empty" style="display:none;">
                        <i data-lucide="boxes"></i>
                        <p>Belum ada data pergerakan stok.</p>
                    </div>
                    <div id="pagination-stock-moves" class="pagination-container"></div>
                </section>
            </div><!-- /content-area -->`;

if (!html.includes('id="page-returns"')) {
  html = html.replace(pageSectionsTarget, pageSectionsContent);
  console.log('4. Added page sections #page-returns and #page-stock-moves.');
}

// =========================================================================
// 4. Button "Retur" in modal-edit-invoice
// =========================================================================
const editInvoiceCancelBtn = `<button class="btn-toolbar danger"
                        onclick="cancelInvoice()">
                        <i data-lucide="x-circle"></i> Cancel Invoice
                    </button>`;

const editInvoiceButtons = `<button class="btn-toolbar danger" id="btn-edit-invoice-cancel"
                        onclick="cancelInvoice()">
                        <i data-lucide="x-circle"></i> Cancel Invoice
                    </button>
                    <button class="btn-toolbar warning" id="btn-edit-invoice-return" style="background: #f59e0b; color: white; border: none; margin-left: 0.5rem;"
                        onclick="openSalesReturnFromEditInvoice()">
                        <i data-lucide="rotate-ccw"></i> Retur
                    </button>`;

if (!html.includes('id="btn-edit-invoice-return"')) {
  html = html.replace(editInvoiceCancelBtn, editInvoiceButtons);
  console.log('5. Added Retur button to modal-edit-invoice.');
}

// =========================================================================
// 5. Button "Retur" in modal-edit-purchase
// =========================================================================
const editPurchaseCancelBtn = `<button class="btn-toolbar primary"
                        style="background: var(--rose-600); border-color: var(--rose-600); color: white;"
                        onclick="cancelPurchaseFromEdit()">
                        <i data-lucide="x-circle"></i> Batalkan PO
                    </button>`;

const editPurchaseButtons = `<button class="btn-toolbar primary"
                        style="background: var(--rose-600); border-color: var(--rose-600); color: white;"
                        onclick="cancelPurchaseFromEdit()">
                        <i data-lucide="x-circle"></i> Batalkan PO
                    </button>
                    <button class="btn-toolbar warning" id="btn-edit-purchase-return"
                        style="background: #f59e0b; border-color: #f59e0b; color: white; margin-left: 0.5rem;"
                        onclick="openPurchaseReturnFromEditPurchase()">
                        <i data-lucide="rotate-ccw"></i> Retur
                    </button>`;

if (!html.includes('id="btn-edit-purchase-return"')) {
  html = html.replace(editPurchaseCancelBtn, editPurchaseButtons);
  console.log('6. Added Retur button to modal-edit-purchase.');
}

// =========================================================================
// 6. Modals: modal-sales-return, modal-purchase-return, modal-softlock-warning, modal-return-detail
// =========================================================================
const modalsAppendTarget = `    <!-- Modal Konfirmasi Perpanjang Proforma (Item 4) -->`;

const newModalsContent = `    <!-- ============================================================
     MODAL: RETUR PENJUALAN (B1)
     ============================================================ -->
    <div class="modal-overlay" id="modal-sales-return">
        <div class="modal" style="max-width: 860px;">
            <div class="modal-header">
                <h3><i data-lucide="rotate-ccw" style="width:20px;height:20px;display:inline-block;vertical-align:middle;margin-right:6px;color:#f59e0b;"></i> Form Retur Penjualan</h3>
                <button class="modal-close" onclick="closeModal('modal-sales-return')">&times;</button>
            </div>
            <div class="modal-body">
                <input type="hidden" id="sales-return-invoice-id">

                <!-- Header Info (Read-only) -->
                <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 6px; padding: 0.85rem 1rem; margin-bottom: 1rem;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
                        <div>
                            <span style="color: var(--gray-500); display: block;">No. Invoice:</span>
                            <span id="sales-return-inv-id" style="font-weight: 700; color: var(--blue-600); font-size: 0.95rem;">-</span>
                        </div>
                        <div>
                            <span style="color: var(--gray-500); display: block;">Tanggal Transaksi:</span>
                            <span id="sales-return-inv-date" style="font-weight: 600;">-</span>
                        </div>
                        <div>
                            <span style="color: var(--gray-500); display: block;">Pelanggan:</span>
                            <span id="sales-return-inv-customer" style="font-weight: 600;">-</span>
                        </div>
                        <div>
                            <span style="color: var(--gray-500); display: block;">Status / Sisa Piutang:</span>
                            <span id="sales-return-inv-status">-</span> &bull; <span id="sales-return-inv-sisa" style="font-weight: 700; color: var(--rose-600);">-</span>
                        </div>
                    </div>
                </div>

                <!-- Items Table -->
                <div style="margin-bottom: 1rem;">
                    <label style="font-weight: 600; font-size: 0.875rem; margin-bottom: 0.5rem; display: block;">Pilih Item yang Diretur:</label>
                    <div style="background: white; border: 1px solid var(--gray-200); border-radius: 6px; overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                            <thead style="background: var(--gray-50); border-bottom: 1px solid var(--gray-200);">
                                <tr>
                                    <th style="padding: 0.6rem 0.75rem; text-align: left;">Produk</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 70px;">Beli</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 85px;">Sdh Retur</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 70px;">Sisa</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: center; width: 110px;">Qty Retur</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: left; width: 170px;">Kondisi</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 130px;">Estimasi Nilai</th>
                                </tr>
                            </thead>
                            <tbody id="sales-return-items-body">
                                <!-- Filled by JS -->
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Form Inputs -->
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Tanggal Retur <span style="color: red;">*</span></label>
                        <input type="date" id="sales-return-date" class="form-input">
                    </div>
                    <div class="form-group" style="flex: 2;">
                        <label>Alasan Retur <span style="color: red;">*</span></label>
                        <input type="text" id="sales-return-reason" class="form-input" placeholder="Wajib mengisi alasan pengembalian barang...">
                    </div>
                </div>

                <!-- Financial Calculation Summary Box -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.85rem 1rem; margin-top: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <span style="font-weight: 600; color: var(--gray-700);">Total Estimasi Nilai Retur:</span>
                        <span id="sales-return-calc-total" style="font-weight: 700; font-size: 1.15rem; color: var(--blue-600);">Rp 0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--gray-600); border-top: 1px dashed #cbd5e1; padding-top: 0.4rem;">
                        <span>Alokasi Potong Sisa Piutang:</span>
                        <span id="sales-return-calc-piutang" style="font-weight: 600;">Rp 0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--gray-600); margin-top: 0.25rem;">
                        <span>Masuk ke Saldo Deposit Pelanggan:</span>
                        <span id="sales-return-calc-deposit" style="font-weight: 600; color: #059669;">Rp 0</span>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="justify-content: flex-end; gap: 0.5rem;">
                <button class="btn-toolbar secondary" onclick="closeModal('modal-sales-return')">Batal</button>
                <button class="btn-toolbar primary" id="btn-submit-sales-return" onclick="submitSalesReturn()">
                    <i data-lucide="check"></i> Simpan Retur
                </button>
            </div>
        </div>
    </div>

    <!-- ============================================================
     MODAL: RETUR PEMBELIAN (B2)
     ============================================================ -->
    <div class="modal-overlay" id="modal-purchase-return">
        <div class="modal" style="max-width: 860px;">
            <div class="modal-header">
                <h3><i data-lucide="rotate-ccw" style="width:20px;height:20px;display:inline-block;vertical-align:middle;margin-right:6px;color:#f59e0b;"></i> Form Retur Pembelian</h3>
                <button class="modal-close" onclick="closeModal('modal-purchase-return')">&times;</button>
            </div>
            <div class="modal-body">
                <input type="hidden" id="purchase-return-po-id">

                <!-- Header Info (Read-only) -->
                <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 6px; padding: 0.85rem 1rem; margin-bottom: 1rem;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
                        <div>
                            <span style="color: var(--gray-500); display: block;">No. Purchase Order:</span>
                            <span id="purchase-return-po-id-display" style="font-weight: 700; color: var(--blue-600); font-size: 0.95rem;">-</span>
                        </div>
                        <div>
                            <span style="color: var(--gray-500); display: block;">Tanggal PO:</span>
                            <span id="purchase-return-po-date" style="font-weight: 600;">-</span>
                        </div>
                        <div>
                            <span style="color: var(--gray-500); display: block;">Vendor:</span>
                            <span id="purchase-return-po-vendor" style="font-weight: 600;">-</span>
                        </div>
                        <div>
                            <span style="color: var(--gray-500); display: block;">Status / Sisa Hutang:</span>
                            <span id="purchase-return-po-status">-</span> &bull; <span id="purchase-return-po-sisa" style="font-weight: 700; color: var(--rose-600);">-</span>
                        </div>
                    </div>
                </div>

                <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; font-size: 0.82rem; color: #92400e;">
                    <i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></i>
                    Barang retur pembelian selalu <strong>keluar dari stok</strong> untuk dikembalikan ke vendor. Pastikan stok fisik tersedia.
                </div>

                <!-- Items Table -->
                <div style="margin-bottom: 1rem;">
                    <label style="font-weight: 600; font-size: 0.875rem; margin-bottom: 0.5rem; display: block;">Pilih Item yang Diretur:</label>
                    <div style="background: white; border: 1px solid var(--gray-200); border-radius: 6px; overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                            <thead style="background: var(--gray-50); border-bottom: 1px solid var(--gray-200);">
                                <tr>
                                    <th style="padding: 0.6rem 0.75rem; text-align: left;">Produk</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 70px;">Beli</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 85px;">Sdh Retur</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 70px;">Sisa</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: center; width: 110px;">Qty Retur</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 140px;">Estimasi Nilai</th>
                                </tr>
                            </thead>
                            <tbody id="purchase-return-items-body">
                                <!-- Filled by JS -->
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Form Inputs -->
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Tanggal Retur <span style="color: red;">*</span></label>
                        <input type="date" id="purchase-return-date" class="form-input">
                    </div>
                    <div class="form-group" style="flex: 2;">
                        <label>Alasan Retur <span style="color: red;">*</span></label>
                        <input type="text" id="purchase-return-reason" class="form-input" placeholder="Wajib mengisi alasan pengembalian barang ke vendor...">
                    </div>
                </div>

                <!-- Financial Summary Box -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.85rem 1rem; margin-top: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <span style="font-weight: 600; color: var(--gray-700);">Total Estimasi Nilai Retur:</span>
                        <span id="purchase-return-calc-total" style="font-weight: 700; font-size: 1.15rem; color: var(--blue-600);">Rp 0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--gray-600); border-top: 1px dashed #cbd5e1; padding-top: 0.4rem;">
                        <span>Alokasi Potong Sisa Hutang:</span>
                        <span id="purchase-return-calc-hutang" style="font-weight: 600;">Rp 0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--gray-600); margin-top: 0.25rem;">
                        <span>Masuk ke Saldo Deposit Vendor:</span>
                        <span id="purchase-return-calc-deposit" style="font-weight: 600; color: #059669;">Rp 0</span>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="justify-content: flex-end; gap: 0.5rem;">
                <button class="btn-toolbar secondary" onclick="closeModal('modal-purchase-return')">Batal</button>
                <button class="btn-toolbar primary" id="btn-submit-purchase-return" onclick="submitPurchaseReturn()">
                    <i data-lucide="check"></i> Simpan Retur
                </button>
            </div>
        </div>
    </div>

    <!-- ============================================================
     MODAL: SOFT-LOCK PERINGATAN (B3)
     ============================================================ -->
    <div class="modal-overlay" id="modal-softlock-warning">
        <div class="modal" style="max-width: 480px;">
            <div class="modal-header">
                <h3 style="color: #b45309;"><i data-lucide="alert-triangle" style="width:20px;height:20px;display:inline-block;vertical-align:middle;margin-right:6px;color:#d97706;"></i> Perhatian: Pengurangan Item</h3>
                <button class="modal-close" onclick="closeModal('modal-softlock-warning')">&times;</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 0.75rem; color: var(--gray-700); font-size: 0.9rem; line-height: 1.45;">
                    Pengurangan jumlah atau penghapusan item pada transaksi yang sudah berjalan seharusnya dicatat sebagai <strong>Retur</strong> agar mutasi stok dan kartu stok tercatat akurat.
                </p>

                <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1.25rem;">
                    <!-- Option 1: Buka Form Retur (Semua Role) -->
                    <button class="btn-toolbar primary" id="btn-softlock-open-return" style="width: 100%; justify-content: center; padding: 0.75rem; font-size: 0.92rem;">
                        <i data-lucide="rotate-ccw"></i> Buka Form Retur (Disarankan)
                    </button>

                    <!-- Option 2: Lanjutkan sebagai Koreksi Salah Input (Hanya Admin) -->
                    <div id="softlock-admin-section" style="border-top: 1px dashed var(--gray-300); padding-top: 0.85rem; display: none;">
                        <label style="font-weight: 600; font-size: 0.82rem; margin-bottom: 0.35rem; display: block; color: var(--gray-700);">
                            Koreksi Salah Input (Admin Only):
                        </label>
                        <textarea id="softlock-correction-reason" class="form-input" rows="2" placeholder="Wajib mengisi alasan koreksi salah input..."></textarea>
                        <button class="btn-toolbar secondary" id="btn-softlock-proceed-correction" style="width: 100%; justify-content: center; margin-top: 0.5rem; background: #fffbeb; border-color: #fde68a; color: #b45309; font-weight: 600;">
                            <i data-lucide="alert-triangle"></i> Lanjutkan sebagai Koreksi Salah Input
                        </button>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="justify-content: flex-end;">
                <button class="btn-toolbar secondary" onclick="closeModal('modal-softlock-warning')">Batal</button>
            </div>
        </div>
    </div>

    <!-- ============================================================
     MODAL: DETAIL RETUR (B4.1)
     ============================================================ -->
    <div class="modal-overlay" id="modal-return-detail">
        <div class="modal" style="max-width: 720px;">
            <div class="modal-header">
                <h3 id="modal-return-detail-title">Detail Retur</h3>
                <button class="modal-close" onclick="closeModal('modal-return-detail')">&times;</button>
            </div>
            <div class="modal-body">
                <div id="modal-return-detail-header" style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 6px; padding: 0.85rem 1rem; margin-bottom: 1rem; font-size: 0.85rem;">
                    <!-- Filled by JS -->
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="font-weight: 600; font-size: 0.875rem; margin-bottom: 0.5rem; display: block;">Daftar Item Retur:</label>
                    <div style="background: white; border: 1px solid var(--gray-200); border-radius: 6px; overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                            <thead style="background: var(--gray-50); border-bottom: 1px solid var(--gray-200);">
                                <tr>
                                    <th style="padding: 0.6rem 0.75rem; text-align: left;">Produk</th>
                                    <th style="padding: 0.6rem 0.75rem; text-align: right; width: 80px;">Qty</th>
                                    <th id="th-return-detail-condition" style="padding: 0.6rem 0.75rem; text-align: left; width: 140px;">Kondisi</th>
                                    <th class="th-returns-finance" style="padding: 0.6rem 0.75rem; text-align: right; width: 140px;">Nilai Retur</th>
                                </tr>
                            </thead>
                            <tbody id="modal-return-detail-items-body">
                                <!-- Filled by JS -->
                            </tbody>
                        </table>
                    </div>
                </div>
                <div id="modal-return-detail-finance-box" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.85rem 1rem;">
                    <!-- Filled by JS if authorized -->
                </div>
            </div>
            <div class="modal-footer" style="justify-content: flex-end;">
                <button class="btn-toolbar secondary" onclick="closeModal('modal-return-detail')">Tutup</button>
            </div>
        </div>
    </div>

    <!-- Modal Konfirmasi Perpanjang Proforma (Item 4) -->`;

if (!html.includes('id="modal-sales-return"')) {
  html = html.replace(modalsAppendTarget, newModalsContent);
  console.log('7. Added modals: modal-sales-return, modal-purchase-return, modal-softlock-warning, modal-return-detail.');
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Finished updating dashboard.html!');

