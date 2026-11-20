# SPEC: Fitur Pricelist (Harga Khusus per Customer)

Target: SupplierPro (repo `SupplierProSQL`, lalu di-sync ke repo klien)
Stack: Node.js + Express, MySQL, vanilla HTML/CSS/JS, JWT

---

## 0. WAJIB DILAKUKAN PERTAMA: VERIFIKASI SKEMA

Dokumen ini memakai nama tabel/kolom **placeholder**. Sebelum mengubah apa pun:

1. Baca skema aktual (`supplierpro.csv` / `SHOW CREATE TABLE`) dan catat nama sebenarnya untuk:
   - tabel produk dan kolom harga jual master (di spec ini: `products.harga_jual`)
   - tabel customer (di spec ini: `customers`)
   - tabel invoice dan invoice item, serta kolom harga per item
   - kolom HPP / rata-rata tertimbang pada produk (untuk peringatan di bawah HPP)
   - kolom kode/SKU produk (untuk import CSV)
2. Cek **tipe PK** tabel produk dan customer (`INT` atau lainnya) dan **samakan tipe FK** di tabel baru.
3. Cek bagaimana kode tampilan lain dibuat (contoh `P000001`, `INV-2026-...`) dan ikuti pola yang sama untuk kode pricelist.
4. Cek nama role yang ada (admin/owner/kasir, dst.) dan bagaimana middleware otorisasi dipakai di route lain.
5. Jika ada nama yang berbeda dari spec ini, **pakai nama aktual** dan sebutkan penyesuaiannya di ringkasan akhir.

Semua pengujian dilakukan di **database hasil clone, bukan production**.

---

## 1. Ringkasan Fitur

- Sebuah customer bisa di-set ke **satu** pricelist (opsional).
- Jika customer punya pricelist: untuk produk yang **ada** di pricelist, harga default memakai harga pricelist. Untuk produk yang **tidak ada** di pricelist, pakai harga master produk.
- Jika customer tidak punya pricelist (atau pricelist nonaktif): semua produk pakai harga master (perilaku lama, tidak berubah).
- Harga hanya per produk. Tidak ada multi-satuan, harga bertingkat, atau masa berlaku di V1.
- Pricelist hanya untuk **penjualan (invoice / proforma)**. Tidak berlaku untuk Purchase Order.

---

## 2. Aturan Bisnis

| # | Aturan |
|---|--------|
| R1 | Harga efektif = `pricelist_items.harga` jika ada, selain itu `products.harga_jual` |
| R2 | Pricelist nonaktif diperlakukan seperti customer tanpa pricelist (fallback ke master) |
| R3 | Harga di keranjang tetap bisa diedit manual per item (perilaku desktop dan mobile tidak berubah). Pricelist hanya menentukan harga **default** |
| R4 | Harga item disimpan (snapshot) di invoice item seperti sekarang. Perubahan pricelist/master **tidak boleh** mengubah invoice yang sudah ada |
| R5 | Harga pricelist harus > 0. Untuk tidak memberi harga khusus, hapus produk dari pricelist |
| R6 | Satu produk hanya boleh muncul sekali per pricelist |
| R7 | Pricelist yang masih dipakai customer **tidak boleh dihapus permanen**; hanya boleh dinonaktifkan |
| R8 | Peringatan harga di bawah HPP bersifat **soft** (peringatan saja, tidak memblokir) |
| R9 | Harga pricelist diperlakukan sama dengan harga master terkait PPN (ikuti cara master saat ini; jangan ubah logika PPN) |

---

## 3. Migrasi Database

Buat skrip migrasi **idempotent** (aman dijalankan berulang, karena akan dijalankan di beberapa klien). Contoh: `migrations/add-pricelist.js` atau `.sql`, mengikuti konvensi folder migrasi yang sudah ada.

```sql
CREATE TABLE IF NOT EXISTS pricelists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(20) NOT NULL UNIQUE,        -- contoh: PL000001, ikuti pola kode lain
  nama VARCHAR(100) NOT NULL,
  keterangan VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pricelist_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pricelist_id INT NOT NULL,
  product_id INT NOT NULL,                 -- samakan tipe dengan PK tabel produk
  harga DECIMAL(15,2) NOT NULL,            -- samakan presisi dengan kolom harga master
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pricelist_product (pricelist_id, product_id),
  KEY idx_pricelist_items_product (product_id),
  CONSTRAINT fk_pli_pricelist FOREIGN KEY (pricelist_id) REFERENCES pricelists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pli_product   FOREIGN KEY (product_id)   REFERENCES products(id)   ON DELETE CASCADE
);
```

Menambah kolom ke customer: `ADD COLUMN IF NOT EXISTS` tidak dijamin didukung di semua versi MySQL. **Cek dulu via `information_schema.COLUMNS`**, baru jalankan `ALTER` jika kolom belum ada:

```sql
ALTER TABLE customers
  ADD COLUMN pricelist_id INT NULL,
  ADD CONSTRAINT fk_customers_pricelist
    FOREIGN KEY (pricelist_id) REFERENCES pricelists(id) ON DELETE SET NULL;
```

Catatan:
- Tidak ada perubahan pada tabel invoice dan invoice item.
- Semua customer lama otomatis `pricelist_id = NULL`, jadi perilaku lama tidak berubah.
- Pastikan nama tabel `products`/`customers` dan tipe PK disesuaikan dengan skema aktual.

---

## 4. Backend

### 4.1 Fungsi inti (satu sumber kebenaran)

Buat satu helper di service layer, misalnya `getEffectivePrices(customerId, productIds = null)`, yang dipakai oleh semua endpoint dan halaman penjualan:

```sql
SELECT p.id AS product_id,
       p.harga_jual AS harga_master,
       pi.harga AS harga_pricelist,
       COALESCE(pi.harga, p.harga_jual) AS harga_efektif,
       CASE WHEN pi.harga IS NOT NULL THEN 'pricelist' ELSE 'master' END AS sumber_harga
FROM products p
LEFT JOIN customers c ON c.id = :customer_id
LEFT JOIN pricelists pl ON pl.id = c.pricelist_id AND pl.is_active = 1
LEFT JOIN pricelist_items pi ON pi.pricelist_id = pl.id AND pi.product_id = p.id
-- tambahkan filter produk aktif / productIds sesuai kebutuhan
```

Pastikan hanya memakai query terparameter (hindari SQL injection).

### 4.2 Endpoint baru

Prefix mengikuti konvensi route yang sudah ada (contoh `/api/pricelists`). Semua endpoint di bawah butuh JWT. Pengelolaan (POST/PUT/DELETE/import) **hanya untuk role admin/owner**; GET daftar ringan boleh untuk role yang butuh memilih pricelist di form customer.

| Method | Path | Fungsi |
|--------|------|--------|
| GET | `/api/pricelists` | Daftar pricelist + jumlah produk + jumlah customer pemakai. Filter `?aktif=1` |
| POST | `/api/pricelists` | Buat pricelist (`nama`, `keterangan`); `kode` digenerate otomatis |
| GET | `/api/pricelists/:id` | Detail + item. Tiap item menyertakan `harga_master` dan `hpp` untuk perbandingan |
| PUT | `/api/pricelists/:id` | Ubah `nama`, `keterangan`, `is_active` |
| DELETE | `/api/pricelists/:id` | Hapus. Jika dipakai customer: tolak dengan `409` dan sebutkan jumlah customer |
| POST | `/api/pricelists/:id/duplicate` | Duplikat pricelist beserta itemnya (nama baru) |
| PUT | `/api/pricelists/:id/items` | **Bulk upsert** `[{product_id, harga}]` dalam satu transaksi (dipakai input massal dan import CSV) |
| DELETE | `/api/pricelists/:id/items/:productId` | Hapus satu produk dari pricelist |
| GET | `/api/pricelists/effective-prices?customer_id=` | Mengembalikan harga efektif semua produk untuk customer (memanggil helper 4.1) |

Jika halaman penjualan saat ini mengambil produk dari endpoint produk yang sudah ada, **lebih baik perluas endpoint itu** dengan parameter opsional `customer_id` (respons tambahan: `harga_efektif`, `sumber_harga`) dan tetap kompatibel ke belakang bila parameter tidak dikirim.

### 4.3 Validasi

- `harga` harus angka > 0 (R5). Tolak dengan pesan jelas.
- `product_id` harus ada; duplikat dalam satu request: ambil nilai terakhir.
- Nama pricelist wajib diisi dan unik (case-insensitive) di antara pricelist yang ada.
- Pada pembuatan/ubah customer: `pricelist_id` boleh `NULL` atau id pricelist yang valid (aktif).
- Endpoint **pembuatan invoice tidak berubah**: harga per item tetap diterima dari klien seperti sekarang (R3, R4).

### 4.4 Hak akses dan sanitasi

- Role selain admin/owner tidak boleh membuka menu atau endpoint kelola pricelist.
- Ikuti pola sanitasi respons berbasis role yang sudah ada: bila ada role yang tidak boleh melihat HPP, field `hpp` **jangan** dikirim ke role itu.

---

## 5. Frontend

### 5.1 Menu baru: Pricelist (admin/owner)

**Halaman daftar:** tabel kode, nama, jumlah produk, jumlah customer, status (aktif/nonaktif), tombol Detail/Duplikat/Nonaktifkan/Hapus. Tombol "Buat Pricelist".

**Halaman/modal detail pricelist:**
- Header: nama, keterangan, status.
- Tabel item: Kode Produk | Nama | Harga Master | **Harga Pricelist (editable)** | Selisih (Rp dan %) | Aksi hapus.
- Baris dengan harga pricelist di bawah HPP diberi tanda peringatan visual (soft).
- Tombol **Tambah Produk** (modal pencarian produk dengan checkbox, multi-pilih; produk yang sudah ada di pricelist tidak ditampilkan atau ditandai).
- Tombol **Import CSV**: unggah/tempel CSV dengan kolom `kode_produk,harga`. Parse di frontend, tampilkan **preview** (baris valid, baris error beserta alasan: produk tidak ditemukan, harga tidak valid), lalu kirim yang valid lewat endpoint bulk upsert. Sediakan template CSV yang bisa diunduh.
- Aksi massal opsional: "Set harga terpilih = X% dari harga master".
- Hapus pricelist yang dipakai: tampilkan pesan bahwa hanya bisa dinonaktifkan dan sebutkan jumlah customer terdampak (dari `409`).
- Menonaktifkan pricelist yang dipakai customer: tampilkan **modal konfirmasi** berisi jumlah customer terdampak (customer tersebut akan kembali memakai harga master).

### 5.2 Form Customer (tambah/edit)

- Tambah dropdown **Pricelist** (opsional): opsi pertama "Harga Master (tanpa pricelist)", lalu daftar pricelist aktif.
- Di daftar customer, tampilkan kolom/badge nama pricelist jika ada.

### 5.3 Halaman Penjualan (dashboard.html, penjualan): DESKTOP dan MOBILE

Perilaku yang sama berlaku di kedua tampilan:

1. Setelah customer dipilih, ambil harga efektif (4.2). Harga default item di keranjang = `harga_efektif`.
2. Tampilkan badge kecil nama pricelist di dekat customer yang dipilih, dan penanda halus pada item yang harganya berasal dari pricelist (`sumber_harga = 'pricelist'`).
3. Harga per item tetap editable. Saat staf mengedit harga manual, set flag `manual_override = true` pada item tersebut.
4. **Ganti customer saat keranjang sudah berisi:** hitung ulang harga semua item **yang `manual_override`-nya false** dengan harga efektif customer baru. Item yang sudah diedit manual dibiarkan. Tampilkan notifikasi singkat bahwa harga disesuaikan.
5. Jika harga di keranjang (hasil edit manual atau bukan) di bawah HPP, tampilkan peringatan visual non-blocking pada item tersebut.
6. Customer yang dipilih selalu customer terdaftar (tidak ada "Umum"), sehingga resolusi harga selalu terdefinisi.
7. **Jangan ubah** logika fee per item, perhitungan PPN, diskon, tipe pembayaran, dan penyimpanan invoice. Mereka cukup membaca harga item di keranjang seperti sekarang.
8. Desain mobile yang sedang dibangun (sticky cart bar, bottom-sheet, grid 2 kolom) tidak boleh berubah selain penambahan badge/penanda di atas. Perubahan layout tetap hanya untuk mobile dan desktop tidak terpengaruh.

### 5.4 Edit Invoice

- Harga item yang tersimpan **tidak** dihitung ulang otomatis (R4).
- Jika alur edit invoice mengizinkan penggantian customer: setelah customer diganti, tampilkan konfirmasi "Terapkan harga pricelist customer baru?" Jika ya, terapkan aturan seperti 5.3 poin 4. Jika tidak, harga tersimpan tetap.
- Cek alur ini terhadap logika reversal edit/delete invoice yang sudah ada agar stok dan HPP tidak terpengaruh. Perubahan harga tidak boleh mengubah kuantitas atau HPP.

### 5.5 Proforma

- Gunakan mekanisme harga efektif yang sama dengan invoice.

---

## 6. Yang TIDAK Boleh Berubah

- Skema dan logika invoice, invoice item, fee, PPN, diskon, HPP/rata-rata tertimbang, stok.
- Purchase Order dan penerimaan barang.
- Cetak invoice (format dot matrix, penomoran INV).
- Perilaku customer tanpa pricelist.
- Layout desktop penjualan.

---

## 7. Edge Case yang Harus Ditangani

- Customer punya pricelist yang kosong (tanpa item): semua produk pakai harga master.
- Pricelist dinonaktifkan atau customer dilepas dari pricelist: harga kembali ke master untuk transaksi **berikutnya**; invoice lama tidak berubah.
- Produk dihapus atau dinonaktifkan: item pricelist ikut terhapus (cascade) atau produk tidak tampil sesuai aturan produk nonaktif yang sudah ada. Ikuti perilaku yang berlaku di sistem.
- Harga master berubah setelah pricelist dibuat: harga pricelist **tidak** ikut berubah. Kolom Selisih di UI pricelist yang menunjukkannya.
- Import CSV dengan kode produk ganda, produk tidak ditemukan, atau harga non-numerik/≤ 0: ditampilkan di preview, tidak membuat seluruh proses gagal.
- Dua pengguna mengedit pricelist yang sama: last-write-wins sudah cukup untuk V1.

---

## 8. Checklist Pengujian (di database clone)

1. Migrasi dijalankan dua kali berturut-turut tanpa error (idempotent).
2. Customer tanpa pricelist: harga semua produk = master (regresi, tidak berubah).
3. Customer dengan pricelist: produk di pricelist = harga pricelist; produk di luar pricelist = harga master.
4. Pricelist dinonaktifkan: customer terkait kembali ke harga master.
5. Edit harga manual di keranjang lalu ganti customer: item manual tidak berubah, item lain dihitung ulang.
6. Invoice dibuat dari harga pricelist, lalu harga pricelist diubah: invoice lama tidak berubah.
7. Total, PPN, fee, dan HPP pada invoice dengan harga pricelist dihitung benar (bandingkan dengan perhitungan manual untuk satu sampel).
8. Hapus pricelist yang dipakai customer: ditolak dengan pesan jumlah customer.
9. Import CSV: campuran baris valid dan tidak valid, preview benar, hanya baris valid yang tersimpan.
10. Role non-admin tidak bisa mengakses menu dan endpoint kelola pricelist; field HPP tidak bocor ke role yang tidak berhak.
11. Tampilan mobile dan desktop halaman penjualan: badge pricelist muncul, layout lain tidak berubah.
12. Cetak invoice dan proforma dengan harga pricelist tampil normal.

---

## 9. Urutan Pengerjaan (kerjakan bertahap dan konfirmasi di tiap tahap)

1. **Verifikasi skema** (bagian 0) dan laporkan nama tabel/kolom aktual.
2. **Migrasi** + uji di database clone.
3. **Backend**: helper harga efektif, endpoint CRUD pricelist, bulk upsert, perluasan endpoint produk dengan `customer_id`.
4. **Frontend kelola pricelist** + dropdown di form customer.
5. **Integrasi halaman penjualan** (desktop dulu, lalu mobile) termasuk logika ganti customer dan peringatan di bawah HPP.
6. **Import CSV**.
7. **Edit invoice dan proforma** (5.4, 5.5).
8. Jalankan checklist pengujian (bagian 8).

## 10. Hasil Akhir yang Diharapkan

- Daftar file yang diubah/ditambah.
- Skrip migrasi dan cara menjalankannya di server Hostinger (via SSH atau phpMyAdmin), termasuk langkah restart app.
- Daftar penyesuaian nama tabel/kolom terhadap spec ini.
- Hasil checklist pengujian.
