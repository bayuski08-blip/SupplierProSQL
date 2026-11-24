# Laporan Temuan Investigasi (Fase 0) — Laporan Penjualan & Laba Rugi

> **Status:** Fase 0 selesai (READ-ONLY — belum ada perubahan kode atau database).
> **Database aktual:** `supplierpro` (MySQL/MariaDB, lokal via `.env`).
> **Sumber investigasi:** `SHOW CREATE TABLE`, query data aktual DB, [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js), [dashboard.html](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.html), [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js), dan file migrasi di `db/`.

---

## 0.1 Skema Database Aktual

Aplikasi memiliki **35 tabel** di database `supplierpro`. Berikut tabel yang terkait transaksi, stok, HPP, pembayaran, dan konfigurasi:

| Tabel | Primary Key | Foreign Key / Relasi | Kolom `status` | Kolom Tanggal |
|---|---|---|---|---|
| `sales_invoices` | `id` (`VARCHAR(255)`) | `customer_id → customers(id)`, `payment_type_id → payment_types(id)`, `user_id → users(id)` | `status VARCHAR(255) DEFAULT 'belum'` | `date DATE` (tanggal transaksi/order), `due_date DATE`, `paid_date DATE` *(tidak ada `created_at`)* |
| `invoice_items` | `id` (`VARCHAR(255)`) | `invoice_id → sales_invoices(id)` (`CASCADE`), `product_id → products(id)` (`SET NULL`) | — | — |
| `products` | `id` (`VARCHAR(255)`) | `category_id → product_categories(id)`, `unit_id → product_units(id)` | `is_active TINYINT(1) DEFAULT 1` | — |
| `purchase_orders` | `id` (`VARCHAR(255)`) | `vendor_id → vendors(id)`, `payment_type_id → payment_types(id)`, `user_id → users(id)` | `status VARCHAR(255) DEFAULT 'proses'` | `date DATE`, `due_date DATE`, `paid_date DATE` |
| `purchase_order_items` | `id` (`VARCHAR(255)`) | `purchase_order_id → purchase_orders(id)` (`CASCADE`), `product_id → products(id)` (`SET NULL`) | — | — |
| `sales_returns` | `id` (`VARCHAR(255)`) | `invoice_id → sales_invoices(id)`, `customer_id → customers(id)`, `user_id → users(id)` | — *(semua record aktif)* | `date DATE` (tanggal retur), `created_at DATETIME` |
| `sales_return_items` | `id` (`INT AUTO_INCREMENT`) | `return_id → sales_returns(id)` (`CASCADE`), `product_id → products(id)` | — *(ada `condition_type`: `kembali_ke_stok` / `rusak`)* | — |
| `purchase_returns` | `id` (`VARCHAR(255)`) | `purchase_order_id → purchase_orders(id)`, `vendor_id → vendors(id)`, `user_id → users(id)` | — | `date DATE`, `created_at DATETIME` |
| `purchase_return_items` | `id` (`INT AUTO_INCREMENT`) | `return_id → purchase_returns(id)` (`CASCADE`), `product_id → products(id)` | — | — |
| `stock_moves` | `id` (`INT AUTO_INCREMENT`) | `product_id → products(id)` (`CASCADE`), `created_by → users(id)` | — *(kolom `tipe`)* | `tanggal DATETIME`, `created_at DATETIME` |
| `stock_adjustments` | `id` (`VARCHAR(255)`) | `product_id → products(id)` (`CASCADE`), `user_id → users(id)` | — *(kolom `type`: `'IN'`/`'OUT'`)* | `adjustment_date DATE` |
| `product_conversions` | `id` (`INT AUTO_INCREMENT`) | — *(tanpa FK fisik; `source_product_id`, `target_product_id`, `created_by`, `cancelled_by`)* | `status VARCHAR(20) DEFAULT 'posted'` (`posted`/`cancelled`) | `date DATE`, `created_at DATETIME`, `cancelled_at DATETIME` |
| `proformas` | `pk` (`INT AUTO_INCREMENT`) | `customer_id → customers(id)`, `payment_type_id → payment_types(id)`, `user_id → users(id)`, `diubah_oleh → users(id)`, `invoice_id → sales_invoices(id)` | `status VARCHAR(20)` (`aktif`, `dikonversi`, `dibatalkan`) | `order_date DATE`, `berlaku_hingga DATE`, `created_at DATETIME` |
| `proforma_items` | `id` (`INT AUTO_INCREMENT`) | `proforma_pk → proformas(pk)` (`CASCADE`), `product_id → products(id)` | — | — |
| `sales_invoice_payments` | `id` (`INT AUTO_INCREMENT`) | `invoice_id → sales_invoices(id)`, `void_by → users(id)`, `cash_transaction_id → cash_transactions(id)`, `created_by → users(id)` | `status VARCHAR(20) DEFAULT 'active'` (`active`/`void`) | `payment_date DATE`, `created_at DATETIME`, `void_at DATETIME` |
| `purchase_order_payments` | `id` (`INT AUTO_INCREMENT`) | `purchase_order_id → purchase_orders(id)`, `void_by → users(id)`, `cash_transaction_id → cash_transactions(id)`, `created_by → users(id)` | `status VARCHAR(20) DEFAULT 'active'` | `payment_date DATE`, `created_at DATETIME`, `void_at DATETIME` |
| `customers` | `id` (`VARCHAR(255)`) | `customer_category_id`, `pricelist_id`, `tipe_pembayaran_id` | — *(punya kolom `deposit DECIMAL(20,4)`)* | — |
| `payment_types` | `id` (`VARCHAR(255)`) | — | — | — |
| `cash_transactions` | `id` (`VARCHAR(255)`) | `invoice_id`, `purchase_order_id`, `payment_type_id`, `user_id` | `status VARCHAR(20) DEFAULT 'active'` (`active`/`cancelled`) | `date DATE` |
| `cash_categories` | `id` (`INT AUTO_INCREMENT`) | — | — *(kolom `is_system TINYINT(1)`, `type`: `IN`/`OUT`/`BOTH`)* | — |
| `settings` | `key` (`VARCHAR(255)`) | — | — | — |

**Selisih terhadap contoh nama di spec:**
1. Nama tabel transaksi penjualan adalah `sales_invoices` (bukan `invoices`) dan detail itemnya adalah `invoice_items` (bukan `sales_items`/`transaction_items`).
2. **Tidak ada tabel terpisah** untuk beban operasional maupun fee customer:
   - Beban operasional dicatat di `cash_transactions` (`type = 'OUT'`, `invoice_id IS NULL`, `purchase_order_id IS NULL`, `category` bukan `cash_categories.is_system = 1`).
   - Fee customer disimpan langsung di `invoice_items.customer_fee` (`DECIMAL(20,4)`) dan `invoice_items.fee_notes` (`TEXT`).
3. `invoice_items` **sudah memiliki kolom `cost_price_snapshot DECIMAL(20,4) DEFAULT 0.0000`** (ditambahkan oleh auto-migrasi startup di [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L4279)). Belum ada kolom `hpp_satuan` dan `hpp_estimasi`.
4. **Index yang belum ada:** `sales_invoices` belum memiliki index pada kolom `date` maupun `status` (hanya `PRIMARY`, `customer_id`, `payment_type_id`, `user_id`, `idx_is_outstanding_import`).

**Nilai `status` aktual di `sales_invoices`:**
- `Lunas` (82 invoice)
- `Belum Lunas` (1.246 invoice)
- `Sebagian` (16 invoice)
- `Belum Bayar` (1 invoice — berasal dari `POST /api/invoices/manual`)
- `Cancel` (7 invoice)
- `Batal` (5 invoice)
- *(Kode juga mengecualikan `'Dibatalkan'` sebagai status legacy).*

**Kolom tanggal transaksi:**
- `sales_invoices.date` (`DATE`) adalah **tanggal transaksi (Tanggal Order)** yang diinput di kasir/modal/import. Tidak ada `created_at` pada `sales_invoices`.
- `sales_returns.date` (`DATE`) adalah tanggal retur, sedangkan `sales_returns.created_at` (`DATETIME`) hanya timestamp pembuatan record.

---

## 0.2 Cara HPP Dihitung Sekarang

1. **Kolom HPP rata-rata produk:** `products.cost_price` (`DECIMAL(20,4) DEFAULT 0.0000`).
2. **Titik pembaruan `products.cost_price` (weighted average):**
   - **Penerimaan PO (`POST /api/purchases`, [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L6147-L6159)):** Sudah memakai rata-rata tertimbang:
     `newCost = ((currentStock * currentCost) + (qty * cost)) / (currentStock + qty)` jika `currentStock > 0 && (currentStock + qty) > 0`, selain itu `cost`. *(Catatan: `cost` memakai harga beli item sebelum diskon/PPN header PO).*
   - **Retur Pembelian (`POST /api/purchases/:id/returns`, [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L9194-L9201)):** Mengurangi `stock` dan menghitung balik rata-rata tertimbang: `((curStock * curCost) - (qty * origCost)) / nextStock`.
   - **Retur Penjualan (`POST /api/invoices/:id/returns`, [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L8729-L8738)):** Untuk `condition_type === 'kembali_ke_stok'`, menambah `stock` dan memperbarui `products.cost_price` dengan rata-rata tertimbang memakai `sales_return_items.cost_price_snapshot`.
   - **Konversi Produk (`POST /api/conversions`, [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L9955-L9971)):** `moved_value = source_hpp * source_qty`; `cost_price` produk sumber tetap, `cost_price` produk tujuan di-update dengan rata-rata tertimbang. Pembatalan (`POST /api/conversions/:id/cancel`) membalikkan stok dan `cost_price` tujuan.
   - **Edit/Tambah Produk manual (`POST /api/products`, `PUT /api/products/:id`):** Bisa mengubah `cost_price` langsung jika `role` tidak dibatasi HPP.
3. **Celah weighted average pada Edit & Cancel PO:**
   - **`PUT /api/purchases/:id` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L6324-L6375)):** Hanya membalikkan `stock` (`stock - oldQty`, lalu `stock + newQty`), **TIDAK** membalikkan atau menghitung ulang `products.cost_price`!
   - **`PUT /api/purchases/:id/cancel` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L6416-L6435)):** Mengurangi `stock` (`stock - item.quantity`), **TIDAK** membalikkan `products.cost_price`!
4. **Kolom HPP di `invoice_items`:**
   - Sudah ada `cost_price_snapshot DECIMAL(20,4) DEFAULT 0.0000`, namun belum ada kolom `hpp_estimasi`.

---

## 0.3 Endpoint & Kode Laporan yang Ada

### Daftar Endpoint Laporan & Dashboard

| Endpoint | File & Baris | Filter Status | Kolom Tanggal | Penanganan Retur & Diskon |
|---|---|---|---|---|
| `GET /api/laporan/laba-rugi` | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L4674-L4834) (`renderProfitLoss` di [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L2206-L2350)) | `status NOT IN ('Batal', 'Dibatalkan', 'Cancel')` | `DATE(date)` (bulan berjalan) | **Bug 1:** `kotor = SUM(total)` (sudah termasuk PPN dan sudah dikurangi diskon), lalu dikurangi `diskon` lagi (double-deduct!). **Bug 2:** `sales_returns` tidak pernah di-query. **Bug 3:** Frontend mengirim `-d.pendapatan.diskon` (`-0`) sehingga tampil `Rp -0`. |
| `GET /api/laporan/performa` | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L4948-L5073) (`renderReports` di [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L2458-L2569)) | `status NOT IN ('Dibatalkan', 'Batal', 'Cancel')` | `DATE(date)` (bulan berjalan) | Tidak mengurangi retur. Memakai `SUM(total)` (termasuk PPN). `rata_hari = totalPenjualan / days_in_month` (selalu dibagi jumlah hari kalender penuh, mis. 30 untuk November meski bulan berjalan). `margin` memakai `(totalPenjualan - totalHPP) / totalPenjualan * 100` (HPP tidak dikurangi HPP retur kembali ke stok). |
| `GET /api/dashboard/summary` | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L1290-L1384) (`renderSummaryCards` di [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L1141-L1206)) | `status NOT IN ('Batal', 'Cancel', 'Dibatalkan')` | **Tanpa filter tanggal** (seluruh waktu, padahal kartu berlabel *"Omzet Bulan Ini"*) | Tidak mengurangi retur. `grossProfit = revenue - hpp`, di mana `hpp` masih memakai `SUM(ii.quantity * p.cost_price)` (harga pokok master terkini, **bukan** snapshot!). `receivables` sudah mengurangi `COALESCE(return_amount, 0)`. |
| `GET /api/dashboard/sales-trend` | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L1386-L1445) | `status NOT IN ('Dibatalkan', 'Batal', 'Cancel')` | `DATE(date) >= DATE_SUB(CURDATE(), INTERVAL ? - 1 DAY)` | Memakai `SUM(total)` (termasuk PPN), tanpa pengurangan retur. |
| `GET /api/dashboard/sales-composition` | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L1447-L1475) | `status NOT IN ('Dibatalkan', 'Batal', 'Cancel')` | `DATE(si.date) >= DATE_SUB(...)` | Memakai `SUM(ii.quantity * ii.price)` (DPP sebelum diskon/PPN), tanpa pengurangan retur. |
| `GET /api/finance/reports/profit-loss` *(legacy)* | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L6955-L6987) | `status NOT IN ('Batal', 'Cancel', 'Dibatalkan')` | Tanpa filter tanggal | Memakai `SUM(total)` dan `SUM(ii.quantity * p.cost_price)` (bukan snapshot), tanpa retur dan tanpa fee. |
| `GET /api/reports/insights` *(legacy)* | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L7015-L7045) | `status NOT IN ('Batal', 'Cancel', 'Dibatalkan')` | Tanpa filter tanggal | Top 5 produk (`ii.quantity * ii.price`) & pelanggan (`si.total`), tanpa pengurangan retur. |
| `runDailyReconciliation()` | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L7306-L7463) | `status NOT IN ('Batal', 'Dibatalkan', 'Cancel')` | `DATE(date) BETWEEN startDate AND endDate` | Laba Rugi internal rekonsiliasi belum mengurangi retur dan belum memasukkan `bebanFeeCustomer`. |
| `GET /api/reports/customer-fee` | [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L7196-L7289) | `status NOT IN ('Batal', 'Dibatalkan', 'Cancel')` | `DATE(si.date) BETWEEN ? AND ?` | Khusus admin; menjumlahkan `ii.customer_fee`. |

### Penjelasan Angka Screenshot November 2026 (Diverifikasi di DB Aktual)

Hasil query langsung terhadap database untuk `2026-11-01` s.d. `2026-11-30`:
- Total baris di `sales_invoices`: **49** (`43` aktif + `6` berstatus `Cancel` yaitu `00071, 00073, 00075, 00083, 00087, 00088`). Status `Cancel` **sudah** dikecualikan dari `43 invoice` dan `Penjualan Bersih = Rp 6.799.305`.
- `Penjualan Bersih = Rp 6.799.305` = `SUM(sales_invoices.total)` (terdiri dari DPP/subtotal `Rp 6.125.500` + PPN 11% `Rp 673.805`).
- **Mengapa HPP tampil `Rp 17.487.500`?**
  1. Di kode backend saat ini ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L4717)), query HPP **sudah tidak lagi** mengambil `purchase_orders`, melainkan `SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price_snapshot, 0), p.cost_price))` — tetapi label di [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L2273) masih tertulis `"Total Pembelian / HPP"`.
  2. Angka `Rp 17.487.500` muncul karena **data uji `INV-TEST-18ITEMS`** (`date = 2026-11-13`, `status = Lunas`) memiliki 18 baris item dengan total `SUM(quantity * cost_price_snapshot) = Rp 13.680.000` (`SUM(quantity * price) = Rp 17.100.000`), sementara header `sales_invoices.subtotal`-nya hanya tercatat `Rp 1.800.000` (`total = Rp 1.998.000`). Selain itu ada beberapa invoice test November (`00070, 00072, 00074, 00082, 00085, 00086`) dengan `price = 50.000` tetapi `cost_price_snapshot = 65.000`.
- **Mengapa `INV-2026-11-00090` berlabel `"Ada Retur"` namun Laba Rugi menampilkan `Rp -0`?**
  - `INV-2026-11-00090` (`2026-11-21`) memang punya retur `RTJ-2026-11-00001` (`sales_returns.total_refund = Rp 510.600`, item `Anchovies 600 Gr` qty `1`, `price = Rp 460.000`, `condition_type = 'kembali_ke_stok'`, `cost_price_snapshot = Rp 36.000`), dan `sales_invoices.return_amount = 510600`.
  - Namun `GET /api/laporan/laba-rugi` hanya menjumlahkan `sales_invoices.discount` (`0`) dan **tidak pernah membaca `sales_returns`**, lalu frontend mengirim `-0` ke `rp(-0)` sehingga tercetak `Rp -0`.
- **Mengapa "Rata-rata Penjualan/Hari" = Rp 227rb?**
  - `6.799.305 / 30 hari kalender Nov = 226.643,5` (~Rp 227rb).

---

## 0.4 Alur yang Mengubah Nilai Invoice atau Stok

| # | Alur | Titik Kode | Perilaku HPP / Snapshot Saat Ini | Masalah / Gap untuk Fase 1 |
|---|---|---|---|---|
| 1 | **Buat invoice dari kasir** (desktop & mobile memakai form/handler yang sama: `#page-pos` → `#btn-checkout`) | [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L2918-L3047) → `POST /api/invoices` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L2917-L3083)) | Mengambil `products.cost_price` saat insert ke `invoice_items.cost_price_snapshot`. | Sudah benar, tinggal sinkronkan/tambahkan ke kolom final (`hpp_satuan`, `hpp_estimasi = 0`). |
| 2 | **Edit invoice** | `openEditInvoiceModal` / `saveInvoiceEdits` ([dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L6832-L7067)) → `PUT /api/invoices/:id` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L6609-L6863)) | **Menghapus seluruh `invoice_items` lalu `INSERT` ulang semua item menggunakan `products.cost_price` terbaru** ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L6826-L6845)). | **BUG KRITIS:** Item lama yang sudah ada kehilangan snapshot HPP lamanya (tertimpa HPP produk terkini) dan nilai `hpp_estimasi` ikut hilang jika tidak dipreservasi! |
| 3 | **Cancel invoice** | `cancelInvoice` / `confirmCancelInvoice` ([dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L7071-L7127)) → `PUT /api/invoices/:id/cancel` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L6865-L6933)) | Set `status = 'Cancel'`, kembalikan stok (kecuali `is_outstanding_import`), void pembayaran, cancel kas. `invoice_items` tetap tersimpan. | Status menjadi `'Cancel'`. Pastikan semua laporan konsisten mengecualikan `LOWER(status) NOT IN ('batal', 'dibatalkan', 'cancel')`. |
| 4 | **Retur penjualan** | `POST /api/invoices/:id/returns` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L8555-L8789)) | Menyalin `orig.cost_price_snapshot` ke `sales_return_items.cost_price_snapshot`. Jika `kembali_ke_stok`: stok bertambah & `products.cost_price` dihitung ulang weighted average. Jika `rusak`: stok tidak bertambah, dicatat `retur_penjualan_rusak` di `stock_moves`. | Laporan Laba Rugi / Penjualan belum mengurangi nilai penjualan & HPP dari retur (`kembali_ke_stok` mengurangi HPP laporan, `rusak` **tidak** mengurangi HPP laporan). |
| 5 | **Import invoice outstanding** | `POST /api/invoices/import-outstanding` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L3118-L3291)), `POST /api/invoices/manual` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L3087-L3110)), dan `POST /api/invoices` dengan `is_import: true` ([dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L9883-L9908)) | Insert ke `sales_invoices` dengan `is_outstanding_import = 1` dan **0 baris di `invoice_items`** (template import hanya berisi header invoice: No, Tanggal, Customer, Total, Terbayar, Tipe, Jatuh Tempo). | **PENTING:** Karena tidak ada baris di `invoice_items`, laporan Per Invoice / HPP tidak bisa membaca `hpp_estimasi` dari `invoice_items` untuk 1.246 invoice ini! Invoice outstanding import harus tetap tampil di laporan dengan `HPP = 0` dan penandaan estimasi dari `si.is_outstanding_import = 1` (atau `EXISTS` item `hpp_estimasi = 1`). |
| 6 | **Proforma → "Jadikan Invoice"** | `POST /api/proformas/:pk/convert` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L8199-L8425)) | Snapshot `cost_price_snapshot` diambil dari `products.cost_price` **saat konversi menjadi invoice** ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L8369-L8375)), bukan dari `proforma_items.cost_price_snapshot`. | Sudah sesuai aturan 3.2! Tinggal tambahkan pengisian `hpp_satuan` dan `hpp_estimasi = 0`. |
| 7 | **Konversi produk** | `POST /api/conversions` & `POST /api/conversions/:id/cancel` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L9894-L10173)) | Mengubah `products.cost_price` produk tujuan via weighted average (`moved_value / target_qty` atau gabungan stok lama). Produk sumber HPP-nya tetap. | Sudah sesuai; invoice yang dibuat setelah konversi otomatis memakai `products.cost_price` terbaru. |
| 8 | **Stock opname** | `POST /api/stock-adjust` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L1821-L1882)) & `POST /api/products/:id/stock-adjustment` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L7048-L7100)) | Mengubah `products.stock`; tidak mengubah `products.cost_price`. `POST /api/stock-adjust` membuat record `cash_transactions` kategori `'Penyesuaian Stok'` (`amount = |diff| * cost_price`). | Tidak memengaruhi snapshot item invoice. |

---

## 0.5 Data Eksisting

Hasil query pada database `supplierpro` saat ini:

- **Total `sales_invoices`:** **1.357** invoice (rentang tanggal `2019-11-02` s.d. `2026-11-21`).
  - `Belum Lunas`: **1.246** (`Rp 2.005.818.225`)
  - `Lunas`: **82** (`Rp 13.806.190`)
  - `Sebagian`: **16** (`Rp 22.445.090`)
  - `Cancel`: **7** (`Rp 472.305`)
  - `Batal`: **5** (`Rp 1.056.720`)
  - `Belum Bayar`: **1** (`Rp 75.000`)
- **Invoice hasil import outstanding (`is_outstanding_import = 1`):** **1.246** invoice (seluruhnya memiliki **0 baris** di `invoice_items`). Invoice reguler (`is_outstanding_import = 0`): **111** invoice.
- **Total `invoice_items`:** **187** baris (seluruhnya milik 111 invoice reguler):
  - `186` baris sudah memiliki `cost_price_snapshot > 0`.
  - `1` baris (`INV-2026-10-00020`, `product_id = NULL`) memiliki `cost_price_snapshot = 0`.
  - `0` baris bernilai `NULL`.
- **Produk (`products`):** **211** produk:
  - `210` produk memiliki `cost_price > 0`.
  - `1` produk uji (`TEST-B-1795216632406` — *"Produk Uji Batch B"*) memiliki `cost_price = NULL`.
  - `0` produk memiliki `cost_price = 0`.
- **Anomali data test eksisting (perlu diperhatikan saat cross-check):**
  - `INV-TEST-18ITEMS` (`2026-11-13`), `INV-TEST-35ITEMS` (`2026-10-29`), dan `INV-2026-10-00005` (`2026-10-14`) memiliki nilai `sales_invoices.subtotal` yang jauh berbeda dengan `SUM(ii.quantity * ii.price)` di `invoice_items` (karena di-seed langsung untuk uji pagination/print). Jika agregasi laporan penjualan menghitung `Penjualan Kotor` dari `SUM(ii.quantity * ii.price)` vs `SUM(si.subtotal)`, kedua angka tersebut akan berbeda pada 3 invoice test itu.

---

## 0.6 PPN, Diskon, Fee Customer, dan Retur

1. **PPN (Pajak Pertambahan Nilai):**
   - Dikendalikan secara global oleh `settings`: `ppn_enabled = 'true'` dan `pajak_default = '11'`.
   - Pada `sales_invoices`, disimpan terpisah:
     - `subtotal` = Σ (`quantity * price`) *(sebelum diskon dan pajak)*
     - `discount` = diskon header
     - `tax` = `ROUND((subtotal - discount) * (pajak_default / 100))` jika `ppn_enabled` aktif, atau `0`
     - `total` = `subtotal - discount + tax`
   - **Laporan saat ini masih memakai `sales_invoices.total` (sudah termasuk PPN).** Sesuai Spec 4.1, laporan penjualan & laba rugi harus memakai **basis DPP (tanpa PPN)**, yaitu `subtotal` (kotor) dan `subtotal - discount` (sebelum retur).
   - *Catatan:* `1.246` invoice hasil import outstanding memiliki `tax = 0` dan `subtotal = total`.
2. **Diskon:**
   - Disimpan di level header (`sales_invoices.discount`). Saat ini belum ada kolom diskon per item di `invoice_items`, dan di DB semua invoice memiliki `discount = 0`.
3. **Fee Customer:**
   - Disimpan di `invoice_items.customer_fee` (`DECIMAL(20,4) DEFAULT 0`) dan `fee_notes`.
   - **Fakta aktual di kode & DB:** Pada `POST /api/invoices` ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L2955-L2965)) dan di data aktual (mis. `INV-2026-11-00070`: qty 2 × 50.000 = `subtotal 100.000`, `tax 11.000`, `total 111.000`, `customer_fee 3.000`), `customer_fee` **tidak ditambahkan ke `subtotal` maupun `total` invoice**, dan di laporan Laba Rugi ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L4746-L4760)) masuk sebagai baris **`Beban Fee Customer`** di bagian **Beban Operasional** (bukan bagian dari omzet dan tidak mengurangi Laba Kotor).
   - Sesuai Aturan Wajib #4, logika `customer_fee` dan cara kerjanya dengan Laba Rugi (**di Beban Operasional, di bawah Laba Kotor**) tidak akan diubah.
4. **Retur Penjualan:**
   - Disimpan di `sales_returns` (header: `id`, `invoice_id`, `customer_id`, `date`, `total_refund`, `piutang_deduction`, `customer_deposit_amount`, `reason`) dan `sales_return_items` (`return_id`, `product_id`, `quantity`, `condition_type`, `price`, `cost_price_snapshot`, `subtotal`, `refund_amount`).
   - **Penting untuk basis DPP:** Pada `sales_return_items`, `subtotal = price * quantity` (sebelum diskon invoice & sebelum PPN), sedangkan `refund_amount = subtotal * (1 - discountRatio) * (1 + taxRatio)` (sudah termasuk PPN!).
   - Maka untuk konsistensi **basis DPP (tanpa PPN)** pada Rumus 4.1:
     - **Nilai Retur (DPP)** = `SUM(sri.subtotal * (1 - CASE WHEN si.subtotal > 0 THEN si.discount / si.subtotal ELSE 0 END))` (atau `sri.refund_amount / (1 + taxRatio)` jika PPN berlaku). Untuk `RTJ-2026-11-00001` (`INV-2026-11-00090`, diskon 0, PPN 11%), nilai retur DPP = **Rp 460.000** (sedangkan `total_refund` termasuk PPN = Rp 510.600).
     - **HPP Retur kembali ke stok** = `SUM(CASE WHEN sri.condition_type = 'kembali_ke_stok' THEN sri.quantity * COALESCE(NULLIF(sri.cost_price_snapshot, 0), ...) ELSE 0 END)`.
     - **HPP Retur rusak** = `SUM(CASE WHEN sri.condition_type = 'rusak' THEN sri.quantity * ... ELSE 0 END)` → **tidak** dikurangkan dari HPP terjual (tetap menjadi beban HPP; dapat ditampilkan sebagai info/baris kerugian retur rusak bila dibutuhkan).
   - Tanggal pengelompokan retur: memakai `sales_returns.date` pada periode laporan.

---

## 0.7 Akses & Role

1. **Role yang ada di tabel `users`:**
   - `admin` (3 user aktif, termasuk `superadmin`)
   - `finance` (1 user aktif)
   - `gudang` (1 user aktif)
   - `kasir` (1 user aktif)
   - *(Sebagian kode menyebut `'owner'` secara defensif, namun tidak ada user dengan role `'owner'` di database).*
2. **Akses halaman Laba Rugi & Laporan saat ini:**
   - Backend `GET /api/laporan/laba-rugi`, `GET /api/laporan/neraca`, `GET /api/laporan/performa`, `GET /api/finance/reports/profit-loss`, `GET /api/reports/insights`: `authorizeRoles('admin', 'finance')`.
   - Frontend `ROLE_PERMISSIONS` ([dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L670-L675)): `profitloss`, `balance`, `reports` hanya terbuka untuk `admin` dan `finance`. (`admin` juga punya `customerfee`).
   - Frontend `renderReports()` ([dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js#L2461)) memiliki guard `['admin', 'finance', 'owner', 'kasir']`, namun `kasir` tidak memiliki `reports` di `ROLE_PERMISSIONS` dan backend menolak `kasir` dengan `403`.
3. **Middleware & sanitasi HPP saat ini — TEMUAN PENTING:**
   - Middleware: `authenticateToken` + `authorizeRoles(...)` di [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L844-L870).
   - Sanitasi HPP terpusat di [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L876-L914):
     ```js
     const HPP_RESTRICTED_ROLES = ['kasir'];
     ```
     **`gudang` BELUM masuk `HPP_RESTRICTED_ROLES`!**
   - Akibatnya, saat ini role **`gudang` masih menerima HPP** di:
     - `GET /api/products` & `GET /api/products/:id` (`cost_price`, `totalStockValue`)
     - `GET /api/purchases/:id/items` (`p.cost_price`)
     - Frontend `dashboard.js` baris `728, 4675, 4846, 9991, 10756` (`canSeeHpp = role === 'admin' || role === 'owner' || role === 'gudang'`) menampilkan kolom HPP, input Edit HPP, dan export Harga Beli ke `gudang`!
     - Sebaliknya, pada modul baru Konversi Produk (`GET /api/conversions`, [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js#L9798)), `gudang` sudah diblokir dari melihat HPP/nilai.
   - Sesuai Aturan Wajib #5, di Fase 1/2 `HPP_RESTRICTED_ROLES` harus menjadi `['kasir', 'gudang']`, seluruh endpoint yang mengembalikan field HPP harus men-strip-nya untuk `kasir` & `gudang`, dan `dashboard.js` harus menghapus `'gudang'` dari `canSeeHpp` (catatan: input harga beli item saat `gudang` membuat PO perlu dipastikan kebutuhannya — lihat bagian 0.8 Pertanyaan #4).

---

## 0.8 Rencana Implementasi Konkret & Daftar Pertanyaan

### Rencana Implementasi

1. **Keputusan Skema Kolom Snapshot (Fase 1):**
   - `invoice_items` saat ini sudah memakai `cost_price_snapshot` (diisi saat `POST /api/invoices`, `PUT /api/invoices/:id`, `POST /api/proformas/:pk/convert`, dan dibaca `laba-rugi`, `performa`, `sales_returns`).
   - Sesuai Spec 3.1, kita dapat menambahkan `hpp_satuan DECIMAL(18,2) NOT NULL DEFAULT 0` dan `hpp_estimasi TINYINT(1) NOT NULL DEFAULT 0` di `invoice_items`, sekaligus **menjaga sinkron** dengan `cost_price_snapshot` (atau mengisi `hpp_satuan` dari `cost_price_snapshot` saat backfill untuk baris yang sudah punya snapshot asli dan menandai `hpp_estimasi = 0` jika memang snapshot asli, atau `1` untuk backfill dari `products.cost_price` / baris tanpa snapshot).
   - Menambahkan index idempotent pada `sales_invoices(date, status)` dan `sales_returns(date)` untuk performa agregasi SQL Laporan Penjualan.
   - Menyediakan 2 file SQL terpisah & idempotent di `db/` (siap dijalankan di phpMyAdmin Hostinger):
     - `db/migration_laporan_penjualan_hpp.sql` (menambah `hpp_satuan`, `hpp_estimasi`, dan index).
     - `db/backfill_hpp_satuan.sql` (backfill aman, tidak menimpa baris dengan `hpp_estimasi = 0`).

2. **Perbaikan Alur Snapshot & Proteksi HPP (Fase 1):**
   - [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js):
     - `POST /api/invoices` & `POST /api/proformas/:pk/convert`: isi `hpp_satuan` (dan `cost_price_snapshot`) dari `products.cost_price` saat itu, `hpp_estimasi = 0`.
     - `PUT /api/invoices/:id`: **perbaiki bug overwrite!** Simpan map `{ product_id -> { hpp_satuan, cost_price_snapshot, hpp_estimasi } }` dari `invoice_items` lama sebelum `DELETE`; item yang sudah ada **mempertahankan** `hpp_satuan` & `hpp_estimasi` lamanya; item yang baru ditambahkan mengambil `products.cost_price` saat itu (`hpp_estimasi = 0`).
     - `POST /api/invoices/:id/returns`: baca `COALESCE(NULLIF(orig.hpp_satuan, 0), orig.cost_price_snapshot)` untuk `sales_return_items.cost_price_snapshot`.
     - `HPP_RESTRICTED_ROLES = ['kasir', 'gudang']`, strip `hpp_satuan`, `hpp_estimasi`, `cost_price`, `cost_price_snapshot`, `hpp`, `total_stock_value` di `stripHppFields()`, serta di `/api/pricelists/...`, `/api/invoices/:id/items`, `/api/purchases/:id/items`, `/api/proformas/:pk/items`.
     - Perbaiki `PUT /api/purchases/:id` dan `PUT /api/purchases/:id/cancel` agar konsisten atau dicatat risikonya (lihat Pertanyaan #5).
   - [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js): ubah `canSeeHpp` agar hanya `admin` (dan `owner`), tidak lagi `gudang`.

3. **Perbaikan Laba Rugi, Dashboard, & Performa (Fase 2):**
   - [server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js):
     - Buat helper agregasi SQL terpusat (atau query konsisten) berbasis **DPP (tanpa PPN)** dan **status aktif (`LOWER(si.status) NOT IN ('batal', 'dibatalkan', 'cancel')`)**:
       - `Penjualan Kotor` = `SUM(si.subtotal)` *(atau `SUM(ii.quantity * ii.price)` — perlu konfirmasi untuk 3 invoice test yang selisih, lihat Pertanyaan #1)*
       - `Diskon` = `SUM(si.discount)`
       - `Retur (nilai DPP)` = `SUM(sri.subtotal * (1 - CASE WHEN si.subtotal > 0 THEN si.discount / si.subtotal ELSE 0 END))` pada periode `sr.date` (untuk invoice non-cancel)
       - `Penjualan Bersih` = `Penjualan Kotor - Diskon - Retur`
       - `HPP Terjual` = `SUM(ii.quantity * COALESCE(NULLIF(ii.hpp_satuan, 0), ii.cost_price_snapshot, 0))` − `SUM(CASE WHEN sri.condition_type = 'kembali_ke_stok' THEN sri.quantity * sri.cost_price_snapshot ELSE 0 END)`
       - `Laba Kotor` = `Penjualan Bersih - HPP Terjual`
     - Perbaiki `GET /api/laporan/laba-rugi` (retur + diskon terhitung benar, basis DPP, tanpa double-deduct diskon, HPP tidak lagi dilabeli pembelian, retur rusak bisa dilaporkan sebagai catatan terpisah/info).
     - Perbaiki `GET /api/laporan/performa`:
       - `rata_hari`: untuk bulan berjalan bagi dengan hari yang sudah lewat (`DAY(CURDATE())` WITA); untuk bulan lampau bagi dengan jumlah hari kalender bulan itu.
       - `margin`: pakai `Laba Kotor / Penjualan Bersih * 100` (return `null` jika `Penjualan Bersih = 0` agar UI tampil `"-"`).
       - `rata_invoice` & `jumlah_invoice`: exclude cancel, pakai Penjualan Bersih (DPP) atau subtotal sesuai konfirmasi.
     - Perbaiki `GET /api/dashboard/summary` (filter bulan berjalan jika labelnya *"Omzet Bulan Ini"*, pakai snapshot HPP + kurangi retur kembali ke stok, tetap izinkan `admin` & `finance` dan sembunyikan dari `kasir` & `gudang`).
     - Perbaiki `GET /api/finance/reports/profit-loss` & `runDailyReconciliation()` agar konsisten.
   - [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js):
     - Perbaiki bug `Rp -0` (normalisasi `-0 → 0` di `rp()` dan `fmtAmt()`).
     - Ubah label `"Total Pembelian / HPP"` menjadi `"Harga Pokok Penjualan (HPP)"`.
     - Pisahkan atau tampilkan rincian `Diskon` dan `Retur Penjualan` secara jelas di Laba Rugi.
     - Tampilkan `"-"` untuk margin saat penjualan bersih = 0, serta tambahkan tooltip/keterangan kecil pada `"Rata-rata Penjualan/Hari"`.

4. **Menu & Fitur "Laporan Penjualan" Baru (Fase 3 — Admin Only):**
   - **Backend ([server.js](file:///c:/Vibes%20Coding/SupplierProSQL/server.js)):**
     - `GET /api/laporan/penjualan/ringkasan` — `authenticateToken`, `authorizeRoles('admin')`.
     - `GET /api/laporan/penjualan` — `authenticateToken`, `authorizeRoles('admin')`, mendukung `group=day|month|invoice`, `from`, `to` (validasi `from <= to`, maks 366 hari untuk `day`, maks 60 bulan untuk `month`), `customer_id`, `payment_type_id`, `status`, `page`, `limit=80`.
     - `GET /api/laporan/penjualan/export-pdf` (memakai `pdfkit` yang sudah terpasang di `package.json`).
     - Opsional 5.5: pada `GET /api/invoices`, jika `role === 'admin'`, hitung `hpp`, `laba`, `margin_pct`, `hpp_estimasi` per invoice (jangan kirim field ini ke role lain!).
   - **Frontend ([dashboard.html](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.html), [dashboard.js](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.js), [dashboard.css](file:///c:/Vibes%20Coding/SupplierProSQL/dashboard.css)):**
     - Tambah item menu `Laporan Penjualan` (`data-page="sales-report"`) di grup **Keuangan** (bersama Laba Rugi, Neraca, Fee Customer), dan masukkan `'sales-report'` **hanya** ke `ROLE_PERMISSIONS.admin`.
     - Buat `<section id="page-sales-report">` dengan:
       - Preset rentang tanggal (Hari Ini, 7 Hari Terakhir, **Bulan Ini (default)**, Bulan Lalu, Tahun Ini, Kustom) + date picker Dari/Sampai + segmented control **Per Hari / Per Bulan / Per Invoice** + filter Pelanggan, Tipe Pembayaran, Status + tombol **Tampilkan** (tidak auto-reload).
       - 6 kartu ringkasan: Penjualan Bersih, HPP, Laba Kotor, Margin %, Jumlah Invoice, Rata-rata Nilai Invoice.
       - Tabel hasil sesuai pengelompokan + baris Total, label `(sebagian)` untuk bulan tepi pada Per Bulan, **drill-down** klik tanggal → Per Invoice tanggal tsb, klik bulan → Per Hari bulan tsb (terbatas rentang aktif).
       - Per Invoice: label `"HPP estimasi"` + tooltip untuk `hpp_estimasi = 1` / `is_outstanding_import = 1`, highlight merah halus untuk margin negatif, pagination maksimal 80 baris, urut nomor invoice terbaru.
       - Tombol Export Excel (`.xlsx` via `XLSX` SheetJS) & Export PDF (via endpoint `pdfkit`), serta wrapper scroll horizontal untuk mobile.
       - Opsional 5.5: kolom **Laba** & Margin di `#page-invoices` khusus role `admin`.

### Risiko yang Perlu Diperhatikan

1. **1.246 Invoice Outstanding Import tanpa `invoice_items`:** Karena tidak punya baris di `invoice_items`, nilai penjualannya hanya ada di `sales_invoices.subtotal`/`total` dengan HPP = 0. Jika rumus `Penjualan Kotor` mengambil `SUM(ii.quantity * ii.price)` dari `invoice_items`, maka 1.246 invoice ini akan **hilang** dari laporan penjualan. Jika mengambil `SUM(si.subtotal)` dari `sales_invoices`, seluruh 1.246 invoice ikut terhitung namun `HPP = 0` dan `Margin = 100%` (ditandai `"HPP estimasi"`).
2. **3 Invoice Test (`INV-TEST-18ITEMS`, `INV-TEST-35ITEMS`, `INV-2026-10-00005`):** Header `sales_invoices.subtotal` tidak sama dengan `SUM(ii.quantity * ii.price)`. Pada `INV-TEST-18ITEMS` (Nov 2026), `subtotal` = Rp 1.800.000 sedangkan `SUM(qty * price)` = Rp 17.100.000 dan `SUM(qty * hpp)` = Rp 13.680.000! Ini menyebabkan Laba Kotor Nov 2026 tetap negatif jika `subtotal` header (Rp 1,8 jt) dibandingkan dengan HPP 18 item (Rp 13,68 jt).
3. **Retur lintas periode (cross-period):** Jika invoice bertanggal bulan X dan diretur pada bulan Y, rumus 4.1 menghitung Penjualan Kotor berdasarkan `si.date` dan Retur berdasarkan `sr.date`. Untuk laporan **Per Invoice**, apakah retur mengurangi angka invoice asalnya tanpa memandang tanggal retur, atau hanya retur dalam rentang tanggal? Ini memengaruhi cross-check Σ Per Invoice = Σ Per Hari = Σ Per Bulan.

---

### Daftar Pertanyaan untuk Konfirmasi Sebelum Lanjut ke Fase 1

1. **Sumber nilai `Penjualan Kotor` (header vs item) & data uji `INV-TEST-*`:**
   - Pada database saat ini ada 1.246 invoice outstanding import (tidak punya `invoice_items`) dan 3 invoice test (`INV-TEST-18ITEMS`, `INV-TEST-35ITEMS`, `INV-2026-10-00005`) yang `sales_invoices.subtotal`-nya berbeda dengan `SUM(ii.quantity * ii.price)`.
   - Apakah `Penjualan Kotor` pada seluruh laporan diambil dari **`sales_invoices.subtotal`** (agar invoice outstanding import ikut terhitung dan 100% cocok antara header & Laba Rugi)? Dan apakah `INV-TEST-18ITEMS` memang data uji yang sengaja dibuat seperti itu (tidak perlu diubah di DB)?
2. **Nama kolom snapshot (`cost_price_snapshot` vs `hpp_satuan`):**
   - `invoice_items` sudah mempunyai kolom `cost_price_snapshot` (terisi pada 186 dari 187 baris). Apakah kita tetap menambahkan kolom baru `hpp_satuan` dan `hpp_estimasi` sesuai Spec 3.1 (lalu menyalin nilai `cost_price_snapshot` ke `hpp_satuan` saat migrasi/backfill), serta menjaga keduanya sinkron di kode baru?
   - Untuk 186 baris yang sudah punya `cost_price_snapshot > 0` (dari snapshot saat transaksi dibuat), apakah `hpp_estimasi` di-set `0` (snapshot asli) atau `1` (backfill)? Dan untuk 1.246 invoice outstanding import (yang tidak memiliki `invoice_items`), apakah di tampilan **Per Invoice** ditandai `"HPP estimasi"` dengan HPP = `Rp 0`?
3. **Akses `gudang` terhadap Harga Beli PO vs HPP Produk:**
   - Sesuai Aturan Wajib #5, HPP tidak boleh terlihat oleh `kasir` dan `gudang` (di UI dan API). Namun saat ini role `gudang` adalah pembuat/pengelola **Pembelian (PO)** (`POST /api/purchases`, `PUT /api/purchases/:id`, `GET /api/purchases`).
   - Saat memblokir `products.cost_price` (HPP) dari `gudang` di `GET /api/products` dan UI Produk/Special Price/Konversi, apakah `gudang` tetap boleh menginput **harga beli pada form PO** (atau apakah form PO untuk `gudang` juga tidak boleh menampilkan harga/total)?
4. **Tanggal retur pada cross-check Per Invoice vs Per Hari/Bulan:**
   - Jika terjadi retur di tanggal berbeda dari tanggal invoice (mis. invoice 28 Okt, retur 2 Nov), pada tampilan **Per Invoice** (ketika rentang 1–30 Nov dipilih), apakah retur dicatat pada tanggal retur (mengurangi `Retur` di hari/bulan 2 Nov) sementara di **Per Invoice** tetap menampilkan invoice sesuai filter `si.date`? *(Catatan: jika ada retur lintas bulan/rentang, Σ laba pada Per Invoice berdasarkan `si.date` tidak akan sama persis dengan Laba Kotor periode yang memakai `sr.date` — mohon konfirmasi preferensi Anda: pakai `sr.date` di ringkasan/harian/bulanan & tampilkan total retur invoice di Per Invoice, atau batasi retur berdasarkan `sr.date` juga).*
5. **Sinkronisasi HPP pada Edit/Cancel PO (`PUT /api/purchases/:id` & `/cancel`):**
   - Saat ini edit/cancel PO membalikkan stok tanpa membalikkan `products.cost_price`. Apakah perbaikan logika reversal HPP pada edit/cancel PO ikut dikerjakan di Fase 1, atau di luar cakupan spec ini?
6. **Opsional 5.5 (Kolom Laba di Transaksi / Invoice):**
   - Apakah fitur opsional 5.5 (menambahkan kolom **Laba & Margin** di menu `Transaksi / Invoice` khusus `admin`) ingin ikut diimplementasikan di Fase 3?

---

> **Berhenti di Fase 0.** Menunggu konfirmasi Anda atas temuan dan pertanyaan di atas sebelum membuat file migrasi SQL maupun mengubah kode aplikasi.
