# PRD — Project Requirements Document

**SupplierPro** — Mini ERP untuk UMKM Supplier & Distributor Indonesia  
**Last Updated:** 12 Juni 2026  
**Status:** Live — deployed on Railway (Node.js + PostgreSQL)

---

## 1. Overview

**SupplierPro** adalah aplikasi web mini ERP untuk UMKM supplier, distributor kecil, dan grosir di Indonesia. Aplikasi ini menggabungkan dashboard operasional, modul penjualan (kasir/POS), manajemen stok, hutang-piutang, arus kas, serta laporan keuangan dalam satu antarmuka modern berbasis browser.

**Masalah yang diselesaikan:**
- Pencatatan manual di buku/Excel yang rawan salah dan lambat.
- Kesulitan memantau piutang pelanggan dan hutang ke vendor.
- Stok barang tidak sinkron dengan transaksi penjualan/pembelian.
- Tidak ada visibilitas cepat terhadap laba/rugi bulanan.
- Invoice dan pembayaran tempo tidak terdokumentasi dengan baik.
- Proses input data produk/pelanggan yang repetitif tanpa bantuan impor massal.
- Kolaborasi tim kecil (kasir, gudang, finance) tanpa manajemen akses terpusat.

**Tujuan utama:**
- Memberikan alat bantu operasional sehari-hari yang mudah digunakan.
- Meningkatkan profesionalisme pencatatan bisnis UMKM.
- Menyediakan laporan keuangan sederhana (laba rugi, neraca, arus kas, analisis performa) untuk pengambilan keputusan.
- Mendukung manajemen pengguna internal dengan peran berbeda.

---

## 2. Requirements

### 2a. Fungsional
- Dashboard ringkasan bisnis (omzet, piutang, hutang, stok, laba kotor, order hari ini) dengan chart dinamis.
- Modul POS/Kasir untuk transaksi penjualan dengan pencarian pelanggan real-time.
- Manajemen produk & stok: filter kategori, stok opname, impor data via Excel.
- Manajemen pelanggan & vendor: CRUD lengkap dengan limit piutang, kategori, info rekening bank.
- Pencatatan pembelian barang (PO) dari vendor dengan multi-item per PO.
- Modul finance: piutang, hutang, arus kas, laba rugi, neraca, analisis performa.
- Pengaturan prefix ID dan modal pemilik.
- Modul admin untuk mengelola pengguna staf (kasir, admin) beserta hak akses.
- Autentikasi JWT untuk semua API endpoint.

### 2b. Non-fungsional
- UI modern, bersih, B2B-friendly dengan palet warna emerald/blue/indigo.
- Responsif untuk desktop dan tablet.
- Data seed realistis (produk, pelanggan, transaksi khas UMKM Indonesia).
- Format mata uang Rupiah dan istilah lokal (piutang, tempo, reseller).
- Data disimpan di PostgreSQL untuk persistensi penuh.
- JWT-based authentication dengan masa berlaku 24 jam.

---

## 3. Core Features

### 3.1 Dashboard
- **8 ringkasan bisnis:** Omzet total, Piutang berjalan, Hutang vendor, Stok menipis, Laba kotor, Order hari ini, Jumlah pelanggan, Jumlah produk.
- **Chart Tren Penjualan:** Line chart dinamis, bisa pilih 7 hari atau 30 hari terakhir.
- **Chart Komposisi Penjualan:** Donut/pie chart per kategori produk (Minuman, Makanan, Sembako, dll).
- **Widget Low Stock:** Tabel produk yang stoknya di bawah min_stock.

### 3.2 POS / Kasir
- Grid produk dengan filter tab per kategori (dari database `product_categories`).
- Pencarian produk real-time.
- Keranjang belanja: pilih pelanggan via searchable input (ketik nama → fetch hasil → pilih).
- Atur jumlah & harga per item.
- Pilih tipe pembayaran: **Tunai** atau **Tempo** (DP telah dihapus).
- Checkout: kurangi stok otomatis, buat invoice, catat kas masuk jika dibayar, catat piutang jika tempo.

### 3.3 Manajemen Produk & Stok
- Tabel produk dengan kolom: SKU, Nama, Kategori, HPP, Harga Jual, Stok, Satuan, Min Stok, Status.
- Filter kategori produk dari database (dinamis).
- Form tambah/edit produk: pilih kategori & satuan dari master data.
- **Stok Opname:** Input stok aktual → sistem hitung selisih → update stok → catat di `cash_transactions` kategori "Penyesuaian Stok".
- **Import Data:** Unggah file Excel (.xlsx) untuk menambah produk massal; tersedia template CSV untuk diunduh.

### 3.4 Pelanggan
- Tabel pelanggan dengan kolom: ID, Nama, Kategori, Kota, Telepon, Total Belanja, Piutang Berjalan, Limit, Sisa Limit.
- Filter kategori pelanggan dari database (dinamis).
- **Searchable input** untuk pencarian customer (min 2 karakter → fetch `/api/customers/search?q=`).
- CRUD lengkap: tambah, edit, hapus.
- Field: Nama, Kategori (FK), Telepon, Kota, Alamat, Limit Piutang.
- Kalkulasi otomatis: `total_belanja`, `total_piutang_berjalan`, `sisa_limit_piutang` dari agregasi invoice.

### 3.5 Vendor
- Tabel vendor dengan kolom: ID, Nama, Kategori, Kota, Total Pembelian, Saldo Hutang.
- Filter kategori vendor dari database (dinamis).
- CRUD lengkap: tambah, edit, hapus.
- Field: Nama, Kategori (FK), Telepon, Kota, Alamat, No. KTP, Nama Bank, No. Rekening, Pemilik Rekening.

### 3.6 Purchase Order (Pembelian)
- Tabel PO dengan kolom: No. PO, Tanggal, Vendor, Total, Bayar, Metode, Status.
- Status PO: **Selesai / Dalam Proses / Batal**.
- Form tambah PO: pilih vendor, tambah multi-item produk (dengan Qty & Harga Beli dan satuan/UoM).
- Form edit PO: ubah item, harga, status — stok disesuaikan ulang.
- Batalkan PO: stok dikembalikan, kas terkait dihapus.
- Simpan → stok bertambah otomatis, kas keluar tercatat (jika ada uang muka).

### 3.7 Sales Invoice (Penjualan)
- Tabel invoice dengan kolom: No. Invoice, Tanggal, Pelanggan, Total, Bayar, Metode, Status.
- Status invoice: **Lunas / Sebagian / Belum Bayar / Batal**.
- Form tambah invoice via POS (Kasir) atau **Input Invoice Outstanding** (untuk invoice lama yang belum tercatat).
- Form edit invoice: ubah item, harga, customer, status — stok & kas disesuaikan.
- Batalkan invoice: stok dikembalikan, kas terkait dihapus.

### 3.8 Finance — Piutang
- Tabel semua invoice yang belum Lunas atau Batal.
- Input pembayaran piutang → update status invoice, catat kas masuk kategori "Pelunasan Piutang".

### 3.9 Finance — Hutang
- Tabel semua PO yang belum Selesai atau Batal.
- Input pelunasan hutang → update PO, catat kas keluar kategori "Pembelian Stok".
- Resolusi nama metode pembayaran dari tabel `payment_types` (bukan hardcode).

### 3.10 Finance — Arus Kas
- Tabel semua transaksi kas (masuk & keluar).
- Kategori otomatis: Penjualan, Pelunasan Piutang, Pembelian Stok, Penyesuaian Stok.
- Kategori manual: Operasional, Gaji, Sewa, Lainnya.
- Tambah transaksi kas manual dengan pilihan kategori dari `cash_categories`.
- Edit transaksi manual (tidak bisa edit transaksi otomatis dari invoice/PO).
- Batalkan transaksi (soft-delete ke status `cancelled`) — dengan reversal: invoice/PO paid_amount dikurangi kembali; stok dikembalikan untuk opname.
- Indikator `isManual` untuk membedakan transaksi otomatis vs manual.

### 3.11 Laporan Laba Rugi
- Filter bulan & tahun (dinamis, bukan hardcode).
- Komponen: Penjualan Kotor → Diskon → Penjualan Bersih → HPP → Laba Kotor → Beban Operasional (per kategori) → Laba Operasional → Penyesuaian Stok → Pendapatan Lain-lain → **Laba Bersih**.
- Export PDF (print browser).

### 3.12 Laporan Neraca
- Filter bulan & tahun (dinamis).
- Komponen Aset: Kas & Bank, Piutang Usaha, Persediaan Barang.
- Komponen Liabilitas: Hutang Usaha.
- Komponen Ekuitas: Modal Pemilik (dari `settings`), Laba Ditahan.
- Indikator **Balanced** (Total Aset = Total Liabilitas + Ekuitas).
- Export PDF.

### 3.13 Laporan Analisis Performa
- Filter bulan & tahun (dinamis).
- Metrik: Rata-rata penjualan/hari, Rata-rata nilai/invoice, Jumlah invoice, Margin kotor (%), Retensi pelanggan (%).
- Top 5 Produk Terlaris (by nilai).
- Top 5 Pelanggan Teratas (by total belanja).
- Export PDF.

### 3.14 Pengaturan
- Konfigurasi prefix ID: Produk, Pelanggan, Vendor, Kas, PO, Invoice.
- Konfigurasi Modal Pemilik (untuk neraca).
- Manajemen master data: kategori produk, satuan produk, kategori pelanggan, kategori vendor, tipe pembayaran (CRUD).

### 3.15 Manajemen Pengguna
- Tabel user dengan kolom: Username, Nama, Email, Role, Status.
- Role: **admin** atau **kasir**.
- CRUD: tambah, edit, nonaktifkan (soft-delete: `active = false`).
- Autentikasi login via username + password (plain text di DB untuk demo).

---

## 4. User Flow

1. **Login:** Buka `/login` → masukkan username/password → dapatkan JWT token (berlaku 24 jam).
2. **Dashboard:** Lihat ringkasan bisnis dan chart tren penjualan/komposisi.
3. **Admin setup produk:** Tambah produk satu per satu atau import Excel. Atur kategori & satuan.
4. **Stok Opname:** Buka produk → klik Stok Opname → input stok fisik aktual → sistem catat selisih.
5. **Kasir:** Buka halaman Kasir → pilih produk dari grid → ketik nama pelanggan di searchable input → pilih → atur qty → pilih metode pembayaran → Buat Invoice.
6. **Pembelian (PO):** Pilih vendor → tambah item produk (multi-baris) → simpan → stok bertambah, hutang tercatat.
7. **Finance Piutang:** Lihat daftar invoice belum lunas → klik Bayar → input jumlah → status diupdate.
8. **Finance Hutang:** Lihat PO belum selesai → klik Bayar → input jumlah → status diupdate.
9. **Arus Kas:** Monitor semua mutasi kas → tambah pengeluaran manual (Gaji, Sewa, dll.) → batalkan jika perlu.
10. **Laporan:** Buka Laba Rugi / Neraca / Analisis Performa → pilih bulan & tahun → lihat data → export PDF.
11. **Admin:** Tambah user baru dari halaman Pengaturan → atur role (admin/kasir).

---

## 5. Architecture

Aplikasi menggunakan arsitektur **monolith sederhana** dengan Node.js + Express sebagai backend, PostgreSQL sebagai database, dan Vanilla HTML/CSS/JS sebagai frontend (tanpa framework JS).

```mermaid
flowchart TD
    Browser[Browser: Vanilla HTML/CSS/JS]
    Server[Node.js + Express Server]
    API[REST API /api/*]
    DB[(PostgreSQL — Railway)]
    JWT[JWT Middleware]

    Browser -->|HTTP Fetch + Bearer Token| API
    API --> JWT
    JWT -->|Authenticated| DB
    Server --> Browser
    API --> DB
```

**Catatan arsitektur:**
- Semua HTML/JS/CSS dilayani sebagai static files dari Express (`express.static`).
- Setiap request API wajib menyertakan header `Authorization: Bearer <token>`.
- ID untuk semua entitas di-generate otomatis dengan `generateNextId()` berdasarkan prefix dari `settings` table.
- Transaksi database menggunakan `BEGIN/COMMIT/ROLLBACK` untuk atomicity.
- File upload (Excel) diproses di frontend dengan library `XLSX.js`, lalu dikirim sebagai JSON ke API.

---

## 6. Database Schema

### 6.1 Master Tables

```sql
product_categories (id VARCHAR PK, name VARCHAR)
product_units      (id VARCHAR PK, name VARCHAR)
customer_categories(id VARCHAR PK, name VARCHAR)
vendor_categories  (id VARCHAR PK, name VARCHAR)
payment_types      (id VARCHAR PK, name VARCHAR)
```

**Seed data payment_types:** `PT-1=Tunai`, `PT-2=Tempo`, `PT-4=Transfer`  
*(PT-3/DP telah dihapus)*

```sql
cash_categories (
  id       SERIAL PK,
  name     VARCHAR NOT NULL,
  type     VARCHAR CHECK (IN, OUT, BOTH),
  is_system BOOLEAN DEFAULT false
)
```

**Seed data cash_categories:**
| name | type | is_system |
|---|---|---|
| Penjualan | IN | true |
| Pelunasan Piutang | IN | true |
| Pembelian Stok | OUT | true |
| Penyesuaian Stok | OUT | true |
| Operasional | OUT | false |
| Gaji | OUT | false |
| Sewa | OUT | false |
| Lainnya | BOTH | false |

---

### 6.2 Core Tables

```sql
users (
  id            SERIAL PK,
  username      VARCHAR UNIQUE NOT NULL,
  name          VARCHAR,
  email         VARCHAR,
  password_hash VARCHAR NOT NULL,
  role          VARCHAR DEFAULT 'kasir',   -- admin | kasir
  active        BOOLEAN DEFAULT true
)

products (
  id          VARCHAR PK,
  sku         VARCHAR,
  name        VARCHAR NOT NULL,
  category_id VARCHAR FK → product_categories,
  cost_price  NUMERIC DEFAULT 0,
  sell_price  NUMERIC DEFAULT 0,
  stock       NUMERIC DEFAULT 0,
  min_stock   NUMERIC DEFAULT 0,
  unit_id     VARCHAR FK → product_units
)

customers (
  id                   VARCHAR PK,
  name                 VARCHAR NOT NULL,
  customer_category_id VARCHAR FK → customer_categories,
  phone                VARCHAR,
  city                 VARCHAR,
  address              TEXT,
  credit_lmt           NUMERIC DEFAULT 0
)

vendors (
  id                 VARCHAR PK,
  name               VARCHAR NOT NULL,
  vendor_category_id VARCHAR FK → vendor_categories,
  phone              VARCHAR,
  city               VARCHAR,
  address            TEXT,
  id_number          VARCHAR,    -- No. KTP / NIB
  nama_bank          VARCHAR,
  nomor_rek          VARCHAR,
  pemilik_rek        VARCHAR
)
```

---

### 6.3 Transaction Tables

```sql
sales_invoices (
  id               VARCHAR PK,
  date             VARCHAR,
  customer_id      VARCHAR FK → customers ON DELETE SET NULL,
  subtotal         NUMERIC DEFAULT 0,
  discount         NUMERIC DEFAULT 0,
  tax              NUMERIC DEFAULT 0,
  total            NUMERIC DEFAULT 0,
  paid_amount      NUMERIC DEFAULT 0,
  due_date         VARCHAR,
  payment_type_id  VARCHAR FK → payment_types ON DELETE SET NULL,
  payment_method   VARCHAR,
  status           VARCHAR DEFAULT 'belum',   -- Lunas | Sebagian | Belum Bayar | Batal
  user_id          INTEGER FK → users ON DELETE SET NULL
)

invoice_items (
  id         VARCHAR PK,
  invoice_id VARCHAR FK → sales_invoices ON DELETE CASCADE,
  product_id VARCHAR FK → products ON DELETE SET NULL,
  quantity   NUMERIC NOT NULL,
  price      NUMERIC NOT NULL
)

purchase_orders (
  id               VARCHAR PK,
  date             VARCHAR,
  vendor_id        VARCHAR FK → vendors ON DELETE SET NULL,
  total            NUMERIC DEFAULT 0,
  paid_amount      NUMERIC DEFAULT 0,
  due_date         VARCHAR,
  payment_type_id  VARCHAR FK → payment_types ON DELETE SET NULL,
  status           VARCHAR DEFAULT 'proses',  -- Selesai | Dalam Proses | Batal
  user_id          INTEGER FK → users ON DELETE SET NULL
)

purchase_order_items (
  id                  VARCHAR PK,
  purchase_order_id   VARCHAR FK → purchase_orders ON DELETE CASCADE,
  product_id          VARCHAR FK → products ON DELETE SET NULL,
  quantity            NUMERIC NOT NULL,
  cost                NUMERIC NOT NULL
)

cash_transactions (
  id                  VARCHAR PK,
  date                DATE DEFAULT CURRENT_DATE,
  type                VARCHAR CHECK (IN | OUT),
  category            VARCHAR,
  description         TEXT,
  amount              NUMERIC NOT NULL,
  method              VARCHAR,
  invoice_id          VARCHAR FK → sales_invoices ON DELETE SET NULL,
  purchase_order_id   VARCHAR FK → purchase_orders ON DELETE SET NULL,
  payment_type_id     VARCHAR FK → payment_types ON DELETE SET NULL,
  user_id             INTEGER FK → users ON DELETE SET NULL,
  status              VARCHAR DEFAULT 'active'   -- active | cancelled
)

stock_adjustments (
  id              VARCHAR PK,
  product_id      VARCHAR FK → products ON DELETE CASCADE,
  type            VARCHAR CHECK (IN | OUT),
  quantity        NUMERIC NOT NULL,
  reason          TEXT,
  adjustment_date DATE DEFAULT CURRENT_DATE,
  user_id         INTEGER FK → users ON DELETE SET NULL
)
```

---

### 6.4 Config Table

```sql
settings (
  key   VARCHAR PK,
  value TEXT
)
```

**Default settings:**
| key | default value |
|---|---|
| prefix_product | P |
| prefix_customer | C |
| prefix_vendor | V |
| prefix_cash_transaction | CT |
| prefix_purchase | PO-{YYYY}-{MM}- |
| prefix_sales | INV-{YYYY}-{MM}- |
| modal_pemilik | 0 |

---

### 6.5 Entity Relationship Diagram

```mermaid
erDiagram
    USERS {
        int id PK
        string username
        string name
        string email
        string password_hash
        string role "admin | kasir"
        boolean active
    }

    PRODUCT_CATEGORIES { string id PK; string name }
    PRODUCT_UNITS      { string id PK; string name }
    CUSTOMER_CATEGORIES{ string id PK; string name }
    VENDOR_CATEGORIES  { string id PK; string name }
    PAYMENT_TYPES      { string id PK; string name }
    CASH_CATEGORIES    { int id PK; string name; string type; boolean is_system }
    SETTINGS           { string key PK; string value }

    PRODUCTS {
        string id PK
        string sku
        string name
        string category_id FK
        float cost_price
        float sell_price
        float stock
        float min_stock
        string unit_id FK
    }

    CUSTOMERS {
        string id PK
        string name
        string customer_category_id FK
        string phone
        string city
        string address
        float credit_lmt
    }

    VENDORS {
        string id PK
        string name
        string vendor_category_id FK
        string phone
        string city
        string address
        string id_number
        string nama_bank
        string nomor_rek
        string pemilik_rek
    }

    SALES_INVOICES {
        string id PK
        string date
        string customer_id FK
        float subtotal
        float discount
        float tax
        float total
        float paid_amount
        string due_date
        string payment_type_id FK
        string payment_method
        string status "Lunas|Sebagian|Belum Bayar|Batal"
        int user_id FK
    }

    INVOICE_ITEMS {
        string id PK
        string invoice_id FK
        string product_id FK
        float quantity
        float price
    }

    PURCHASE_ORDERS {
        string id PK
        string date
        string vendor_id FK
        float total
        float paid_amount
        string due_date
        string payment_type_id FK
        string status "Selesai|Dalam Proses|Batal"
        int user_id FK
    }

    PURCHASE_ORDER_ITEMS {
        string id PK
        string purchase_order_id FK
        string product_id FK
        float quantity
        float cost
    }

    CASH_TRANSACTIONS {
        string id PK
        date date
        string type "IN|OUT"
        string category
        text description
        float amount
        string method
        string invoice_id FK
        string purchase_order_id FK
        string payment_type_id FK
        int user_id FK
        string status "active|cancelled"
    }

    STOCK_ADJUSTMENTS {
        string id PK
        string product_id FK
        string type "IN|OUT"
        float quantity
        text reason
        date adjustment_date
        int user_id FK
    }

    PRODUCTS       }o--|| PRODUCT_CATEGORIES  : "category_id"
    PRODUCTS       }o--|| PRODUCT_UNITS        : "unit_id"
    CUSTOMERS      }o--|| CUSTOMER_CATEGORIES  : "customer_category_id"
    VENDORS        }o--|| VENDOR_CATEGORIES    : "vendor_category_id"
    CUSTOMERS      ||--o{ SALES_INVOICES       : "membeli"
    SALES_INVOICES ||--o{ INVOICE_ITEMS        : "berisi"
    PRODUCTS       ||--o{ INVOICE_ITEMS        : "ada di"
    VENDORS        ||--o{ PURCHASE_ORDERS      : "menyuplai"
    PURCHASE_ORDERS||--o{ PURCHASE_ORDER_ITEMS : "berisi"
    PRODUCTS       ||--o{ PURCHASE_ORDER_ITEMS : "ada di"
    PRODUCTS       ||--o{ STOCK_ADJUSTMENTS    : "disesuaikan"
    USERS          ||--o{ STOCK_ADJUSTMENTS    : "mencatat"
    USERS          ||--o{ SALES_INVOICES       : "membuat"
    USERS          ||--o{ PURCHASE_ORDERS      : "membuat"
    USERS          ||--o{ CASH_TRANSACTIONS    : "mencatat"
    SALES_INVOICES }o--o{ CASH_TRANSACTIONS    : "invoice_id"
    PURCHASE_ORDERS}o--o{ CASH_TRANSACTIONS    : "purchase_order_id"
    PAYMENT_TYPES  ||--o{ SALES_INVOICES       : "digunakan"
    PAYMENT_TYPES  ||--o{ PURCHASE_ORDERS      : "digunakan"
    PAYMENT_TYPES  ||--o{ CASH_TRANSACTIONS    : "digunakan"
```

---

## 7. API Endpoints

Semua endpoint (kecuali `/api/auth/login`) menggunakan middleware `authenticateToken` (JWT Bearer).

### 7.1 Auth
| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | `/api/auth/login` | Login → kembalikan JWT token |

### 7.2 Master Data
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/master/product-categories` | List kategori produk |
| GET | `/api/master/product-units` | List satuan produk |
| GET | `/api/master/customer-categories` | List kategori pelanggan |
| GET | `/api/master/vendor-categories` | List kategori vendor |
| GET | `/api/master/payment-types` | List tipe pembayaran (Tunai, Tempo, Transfer) |
| POST | `/api/master/:type` | Tambah entry master data |
| PUT | `/api/master/:type/:id` | Edit entry master data |
| DELETE | `/api/master/:type/:id` | Hapus entry master data |
| GET | `/api/cash-categories` | List kategori arus kas (opsional filter `?type=IN|OUT`) |

### 7.3 Settings
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/settings` | Ambil semua settings sebagai key-value map |
| POST | `/api/settings` | Upsert satu atau banyak settings |

### 7.4 Dashboard
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/dashboard/summary` | 8 metrik ringkasan bisnis |
| GET | `/api/dashboard/sales-trend` | Tren penjualan `?days=7|30` |
| GET | `/api/dashboard/sales-composition` | Komposisi penjualan per kategori `?days=30` |

### 7.5 Products
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/products` | List semua produk (dengan JOIN kategori & satuan) |
| POST | `/api/products` | Tambah produk baru |
| PUT | `/api/products/:id` | Edit produk |
| DELETE | `/api/products/:id` | Hapus produk |
| POST | `/api/stock-adjust` | Stock opname — update stok & catat cash transaction |
| POST | `/api/products/:id/stock-adjustment` | Stock adjustment detail (catat ke `stock_adjustments`) |

### 7.6 Customers
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/customers` | List semua pelanggan (dengan kalkulasi piutang & total belanja) |
| GET | `/api/customers/search` | Cari pelanggan `?q=keyword` (ILIKE, limit 20) |
| GET | `/api/customers/:id` | Detail satu pelanggan |
| POST | `/api/customers` | Tambah pelanggan |
| PUT | `/api/customers/:id` | Edit pelanggan |
| DELETE | `/api/customers/:id` | Hapus pelanggan |

### 7.7 Vendors
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/vendors` | List semua vendor (dengan total pembelian & outstanding debt) |
| POST | `/api/vendors` | Tambah vendor |
| PUT | `/api/vendors/:id` | Edit vendor |
| DELETE | `/api/vendors/:id` | Hapus vendor |

### 7.8 Sales Invoices
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/invoices` | List semua invoice (JOIN customer & payment_type) |
| GET | `/api/invoices/:id/items` | Detail item-item invoice |
| POST | `/api/invoices` | Buat invoice baru dari POS (kurangi stok, catat kas) |
| POST | `/api/invoices/manual` | Input invoice outstanding manual (tanpa item produk) |
| PUT | `/api/invoices/:id` | Edit invoice (re-adjust stok & kas) |
| PUT | `/api/invoices/:id/cancel` | Batalkan invoice (kembalikan stok, hapus kas terkait) |

### 7.9 Purchase Orders
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/purchases` | List semua PO (JOIN vendor & payment_type) |
| GET | `/api/purchases/:id/items` | Detail item-item PO |
| POST | `/api/purchases` | Buat PO baru (tambah stok, catat kas jika ada DP) |
| PUT | `/api/purchases/:id` | Edit PO (re-adjust stok & kas) |
| PUT | `/api/purchases/:id/cancel` | Batalkan PO (kembalikan stok, hapus kas terkait) |

### 7.10 Finance — Piutang & Hutang
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/finance/receivables` | Invoice yang belum Lunas / Batal |
| POST | `/api/finance/receivables/:id/pay` | Bayar piutang → update invoice, catat kas masuk |
| GET | `/api/finance/payables` | PO yang belum Selesai / Batal |
| POST | `/api/finance/payables/:id/pay` | Bayar hutang → update PO, catat kas keluar |

### 7.11 Finance — Arus Kas
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/finance/cash-flow` | List semua transaksi kas (termasuk status & isManual) |
| POST | `/api/finance/cash-flow` | Tambah transaksi kas manual |
| PUT | `/api/finance/cash-flow/:id` | Edit transaksi manual (otomatis tidak bisa diedit) |
| PATCH | `/api/finance/cash-flow/:id/cancel` | Batalkan transaksi (soft-delete + reversal) |
| GET | `/api/finance/cashflow` | *(legacy)* List semua transaksi kas |
| POST | `/api/finance/cashflow` | *(legacy)* Tambah transaksi kas |

### 7.12 Laporan
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/laporan/laba-rugi` | Laporan Laba Rugi `?bulan=M&tahun=YYYY` |
| GET | `/api/laporan/neraca` | Laporan Neraca `?bulan=M&tahun=YYYY` |
| GET | `/api/laporan/performa` | Analisis Performa `?bulan=M&tahun=YYYY` |
| GET | `/api/finance/reports/profit-loss` | *(legacy)* Laporan laba-rugi kumulatif |
| GET | `/api/finance/reports/balance-sheet` | *(legacy)* Neraca kumulatif |
| GET | `/api/reports/insights` | Insights: top produk & top pelanggan (kumulatif) |

### 7.13 Users
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/users` | List semua user |
| POST | `/api/users` | Tambah user |
| PUT | `/api/users/:id` | Edit user (nama, email, role, active) |
| DELETE | `/api/users/:id` | Nonaktifkan user (`active = false`) |

---

## 8. Business Rules

### 8.1 Tipe Pembayaran
- Hanya **Tunai**, **Tempo**, dan **Transfer** yang aktif (PT-1, PT-2, PT-4).
- PT-3 (DP) telah **dihapus** dari sistem — endpoint `/api/invoices/manual` menolak PT-3.
- Nama metode pembayaran di cash_transactions selalu di-resolve dari tabel `payment_types` via DB lookup (tidak hardcode).

### 8.2 Status Invoice
| Status | Kondisi |
|---|---|
| Lunas | paid_amount >= total |
| Sebagian | paid_amount > 0 AND paid_amount < total |
| Belum Bayar | paid_amount = 0 |
| Batal | Invoice dibatalkan manual |

### 8.3 Status Purchase Order
| Status | Kondisi |
|---|---|
| Selesai | paid_amount >= total |
| Dalam Proses | paid_amount < total |
| Batal | PO dibatalkan manual |

### 8.4 Kategori Cash Transaction (Otomatis)
| Sumber | Tipe | Kategori |
|---|---|---|
| Invoice baru (lunas) | IN | Penjualan |
| Invoice baru (sebagian) | IN | Pelunasan Piutang |
| Bayar piutang | IN | Pelunasan Piutang |
| PO baru (ada bayar) | OUT | Pembelian Stok |
| Bayar hutang PO | OUT | Pembelian Stok |
| Stok opname (stok naik) | IN | Penyesuaian Stok |
| Stok opname (stok turun) | OUT | Penyesuaian Stok |

### 8.5 Status Cash Transaction
- `active` — transaksi valid, dihitung di laporan & neraca.
- `cancelled` — transaksi dibatalkan (soft-delete); tidak dihitung di laporan; reversal otomatis dijalankan.

### 8.6 Traceability (user_id)
- Kolom `user_id` dicatat di: `sales_invoices`, `purchase_orders`, `cash_transactions`, `stock_adjustments`.
- Referensi ke tabel `users(id)` dengan `ON DELETE SET NULL`.

### 8.7 ID Generation
- Format: `{PREFIX}{YYYYY}{MM}{NNNNNN}` tergantung konfigurasi prefix di `settings`.
- Prefix mendukung placeholder: `{YYYY}`, `{YY}`, `{MM}`.
- Contoh invoice: `INV-2026-06-000001`.
- Semua ID di-generate melalui fungsi `generateNextId()` yang query existing IDs dan increment.

### 8.8 Stok Opname Reversal
- Saat transaksi kas kategori "Penyesuaian Stok" dibatalkan, sistem membaca deskripsi transaksi (`Stock Opname: [ID] NAMA | Sebelum: X → Sesudah: Y`) dan membalik perubahan stok secara otomatis.

---

## 9. Tech Stack

| Layer | Teknologi |
|---|---|
| **Backend** | Node.js v18+ + Express.js |
| **Database** | PostgreSQL (hosted di Railway) |
| **ORM / Query** | Raw SQL via `pg` (node-postgres) |
| **Auth** | JWT (`jsonwebtoken`) — Bearer token, 24h expiry |
| **Frontend** | Vanilla HTML5 + CSS3 + JavaScript (ES6+) |
| **UI Icons** | Lucide Icons |
| **Charts** | Chart.js (dashboard charts) |
| **File Handling** | XLSX.js (client-side Excel parsing untuk import produk) |
| **PDF Export** | Browser `window.print()` + print CSS |
| **Hosting App** | Railway (Node.js) |
| **Hosting DB** | Railway PostgreSQL |
| **Version Control** | Git + GitHub |

**Konfigurasi Database:**
```
DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/supplierpro
```
Fallback ke `postgresql://postgres:T34m1tb4l1@localhost:5432/supplierpro` untuk development lokal.

**Server Port:** 3000 (default)

---

## 10. Deployment

1. Push ke GitHub.
2. Railway auto-deploy dari branch `main`.
3. Environment variable `DATABASE_URL` di-set di Railway dashboard.
4. Database di-inisialisasi dengan `db/schema.sql` lalu `db/seed.sql`.
5. Migration incremental via `db/migration.sql`.