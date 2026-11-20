# Rencana Implementasi Fitur "Customer Fee" — SupplierPro

## Konteks & Tujuan
SupplierPro perlu fitur baru: **fee internal per item** yang diinput manual saat membuat transaksi penjualan. Fee ini **tidak boleh terlihat oleh customer** (tidak muncul di proforma invoice), tapi berpengaruh ke laporan laba rugi sebagai **beban operasional terpisah** (bukan pengurang harga jual/gross margin). Fee hanya bisa dilihat oleh role **admin**.

> **Instruksi untuk Antigravity**: Sebelum membuat perubahan apa pun, tolong cek dulu skema tabel yang sudah ada (`sales`, `sales_items`/`transaction_items`, `products`, `users`, dan query/service yang menghasilkan laporan laba rugi serta proforma invoice). Sesuaikan nama kolom/tabel di rencana ini dengan yang ada di source code — rencana di bawah adalah blueprint logika, bukan nama kolom final.

---

## 1. Logika Bisnis Inti

- Harga jual produk (misal produk A = Rp 8.000) **tidak berubah** dan tetap seperti itu di semua tampilan customer.
- Saat admin membuat transaksi penjualan, ada **kolom input fee** per baris item (bukan per transaksi keseluruhan). Nilainya **manual/custom**, diinput bebas oleh user, tidak ada rumus otomatis.
- Fee **tidak mengurangi** harga jual yang tercantum di proforma invoice — customer tetap lihat Rp 8.000.
- Fee **tidak mengurangi gross profit/margin kotor**. Fee dicatat sebagai **Beban Operasional (Operating Expense)** terpisah di laporan laba rugi, bukan sebagai pengurang COGS atau revenue.
- Perlu laporan breakdown "**Total Fee per Periode**" secara terpisah, hanya bisa diakses admin.
- Kolom fee dan seluruh data terkait fee **hanya boleh terlihat oleh role admin** — baik di form input, response API, maupun laporan.

### Struktur Laporan Laba Rugi (setelah perubahan)
```
Total Penjualan (Revenue)              xxx
- HPP (COGS)                           xxx
= Laba Kotor (Gross Profit)            xxx      <- TIDAK terpengaruh fee
- Beban Operasional
    - Beban Fee Customer               xxx      <- fee masuk di sini (baris baru)
    - Beban operasional lain           xxx
= Laba Bersih (Net Profit)             xxx
```

---

## 2. Perubahan Skema Database (untuk dicek & disesuaikan Antigravity)

Tambahkan kolom fee di tabel item transaksi penjualan (nama tabel menyesuaikan skema aktual, kemungkinan `sales_items` atau `transaction_items`):

```sql
ALTER TABLE sales_items
ADD COLUMN customer_fee NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE sales_items
ADD COLUMN fee_notes VARCHAR(255);
```

Catatan:
- Cukup kolom langsung di tabel item transaksi (tidak perlu tabel terpisah), karena fee sifatnya satu nilai custom per baris item, diinput sekali saat transaksi dibuat.
- Pastikan migration dijalankan dengan aman di data production yang sudah ada (default 0 supaya data lama tidak error).
- Jika Railway query editor membatasi panjang script, pecah migration jadi beberapa statement terpisah.

---

## 3. Perubahan di Layer Backend (API)

### 3.1 Endpoint create/update transaksi penjualan
- Terima input `customer_fee` per item pada payload create/update transaksi.
- Validasi: `customer_fee` harus numerik, >= 0, dan **hanya diterima/diproses jika request berasal dari user dengan role admin**. Jika non-admin mengirim field ini, abaikan/reject.

### 3.2 Endpoint GET data transaksi (untuk ditampilkan di UI/list)
- **Wajib strip field `customer_fee` dan `fee_notes` dari response** jika `req.user.role !== 'admin'`. Ini harus dilakukan di level backend/API, bukan cuma disembunyikan di frontend, supaya tidak bisa dilihat lewat network tab / direct API call.

Contoh helper:
```javascript
function sanitizeSalesData(salesItems, userRole) {
  if (userRole === 'admin') return salesItems;
  return salesItems.map(({ customer_fee, fee_notes, ...rest }) => rest);
}
```

### 3.3 Generator Proforma Invoice
- Cek ulang query/template yang generate proforma invoice (PDF/HTML) — pastikan `customer_fee` **tidak pernah diambil/di-query** pada proses ini sama sekali (bukan cuma disembunyikan lewat CSS/hidden field). Ini poin krusial karena harga jual yang tampil ke customer tidak boleh terpengaruh atau bocor data fee.

### 3.4 Endpoint baru: Laporan Total Fee per Periode
- Endpoint khusus admin, contoh: `GET /api/reports/customer-fee?start_date=...&end_date=...`
- Middleware wajib cek role admin sebelum proses query.

Query contoh (breakdown per bulan):
```sql
SELECT
  DATE_TRUNC('month', s.transaction_date) AS periode,
  SUM(si.customer_fee) AS total_fee,
  COUNT(DISTINCT s.id) AS jumlah_transaksi
FROM sales_items si
JOIN sales s ON s.id = si.sales_id
WHERE s.transaction_date BETWEEN :start_date AND :end_date
GROUP BY DATE_TRUNC('month', s.transaction_date)
ORDER BY periode;
```

Query contoh (breakdown per produk, opsional tapi berguna):
```sql
SELECT
  p.name AS produk,
  SUM(si.customer_fee) AS total_fee,
  COUNT(*) AS jumlah_item
FROM sales_items si
JOIN products p ON p.id = si.product_id
JOIN sales s ON s.id = si.sales_id
WHERE s.transaction_date BETWEEN :start_date AND :end_date
GROUP BY p.name
ORDER BY total_fee DESC;
```

### 3.5 Perubahan di Query/Service Laporan Laba Rugi
- Cek query laba rugi yang sudah ada saat ini.
- Tambahkan agregasi total fee sebagai baris baru di bagian **Beban Operasional**, terpisah dari HPP/COGS:

```sql
SELECT SUM(si.customer_fee) AS total_beban_fee
FROM sales_items si
JOIN sales s ON s.id = si.sales_id
WHERE s.transaction_date BETWEEN :start_date AND :end_date;
```

- Pastikan nilai ini **tidak** ikut dikurangkan di perhitungan Gross Profit, tapi dijumlahkan ke total Operating Expense sebelum menghasilkan Net Profit.
- Jika sudah ada tabel `expenses` manual terpisah, "Beban Fee Customer" ini perlu ditampilkan sebagai baris tersendiri yang sumber datanya dari `sales_items`, bukan dari input manual expense — jangan sampai tercampur/dobel hitung.

---

## 4. Perubahan di Layer Frontend (UI)

### 4.1 Form Input Transaksi Penjualan
- Tambah kolom input "Fee" di setiap baris item produk (sejajar dengan qty, harga, subtotal, dll).
- **Kolom ini hanya dirender jika role user = admin** (cek role di frontend untuk UX, tapi backend tetap jadi validasi utama — lihat poin 3.2).
- Non-admin: form tetap tampil normal tanpa kolom fee sama sekali (bukan disabled/hidden via CSS, tapi memang tidak di-render).

### 4.2 Tampilan Detail/List Transaksi
- Kolom fee hanya muncul di tabel/detail transaksi untuk role admin.

### 4.3 Proforma Invoice (customer-facing)
- Pastikan tidak ada perubahan tampilan sama sekali di sisi ini — harga produk tetap seperti biasa, tanpa jejak fee.

### 4.4 Halaman Laporan Baru: "Total Fee per Periode"
- Menu/halaman baru, hanya muncul di navigasi untuk role admin.
- Tampilkan breakdown per bulan (dan opsional per produk), dengan filter rentang tanggal.

### 4.5 Laporan Laba Rugi (existing)
- Update tampilan agar baris "Beban Fee Customer" muncul di bagian Beban Operasional.

---

## 5. Optimasi Layout Halaman Order / Kasir (POS)

### Masalah saat ini
Layout POS sekarang membagi ruang tidak seimbang — kolom daftar produk jauh lebih lebar dibanding kolom keranjang. Setelah field fee ditambahkan per item (plus qty stepper, harga, subtotal, tombol hapus), kolom keranjang yang sempit ini jadi terlalu padat dan menyulitkan input.

### Solusi: Ubah rasio grid jadi 50:50
- Ubah proporsi layout dari rasio lebar-sempit yang sekarang menjadi **50:50** antara kolom "Daftar produk" dan kolom "Keranjang".
- Kolom daftar produk: grid card produk tetap bisa 2 kolom (menyesuaikan lebar baru, card sedikit lebih ramping tapi masih proporsional).
- Kolom keranjang: dengan ruang lebih lebar, tiap baris item punya cukup ruang untuk menampilkan qty stepper, harga satuan, subtotal, tombol hapus, **dan** input fee tanpa terasa sesak.

### Struktur baris item di keranjang (dengan ruang baru)
Per item di keranjang menampilkan:
1. Nama produk + tombol hapus (baris atas)
2. Qty stepper (-/+) dan subtotal harga (baris tengah)
3. Input fee — **hanya render untuk role admin**, ditandai ikon gembok/label kecil "Fee (admin)" agar jelas ini data internal, dengan style berbeda (misal background warna warning-tint) supaya admin sadar ini bukan field biasa

### Catatan implementasi frontend
- Perubahan ini murni di level CSS/grid (`grid-template-columns`), tidak mengubah struktur data atau alur state — jadi risiko regresi kecil.
- Pastikan tetap responsive: di layar sempit (tablet/mobile jika didukung), kolom bisa stack vertikal (produk di atas, keranjang di bawah) alih-alih dipaksa 50:50.
- Komponen input fee di baris item mengikuti aturan role-based visibility yang sudah dijelaskan di bagian 4.1 — non-admin tidak melihat field ini sama sekali (bukan disabled, tapi memang tidak dirender), sehingga baris item untuk non-admin tetap ringkas seperti sebelumnya.

---

## 6. Checklist Keamanan & Validasi (Penting)

- [ ] Field `customer_fee` tidak pernah dikirim ke response API untuk role non-admin.
- [ ] Field `customer_fee` tidak pernah muncul di query/generator proforma invoice.
- [ ] Endpoint laporan fee dilindungi middleware role admin.
- [ ] Validasi input fee: numerik, tidak negatif.
- [ ] Migration DB aman untuk data existing (default 0, tidak breaking).
- [ ] Perhitungan Gross Profit di laporan laba rugi **tidak berubah** setelah fitur ini ditambahkan (fee tidak boleh ikut mengurangi gross margin).
- [ ] Total Beban Operasional di laporan laba rugi bertambah sesuai total fee pada periode terkait, tidak dobel hitung dengan expense manual lain.

---

## 7. Saran Urutan Pengerjaan

1. Cek & konfirmasi skema tabel `sales`/`sales_items` yang sekarang.
2. Migration: tambah kolom `customer_fee` (dan `fee_notes` jika perlu).
3. Backend: update endpoint create/update transaksi penjualan (terima input fee + validasi role).
4. Backend: sanitasi response API untuk role non-admin.
5. Backend: pastikan generator proforma invoice tidak menyertakan fee.
6. Backend: endpoint laporan "Total Fee per Periode" (khusus admin).
7. Backend: update query laporan laba rugi (tambah baris Beban Fee Customer).
8. Frontend: ubah layout grid halaman Order/Kasir jadi 50:50 (kolom produk vs keranjang).
9. Frontend: tambah kolom input fee di baris item keranjang (conditional admin only), memanfaatkan ruang baru dari layout 50:50.
10. Frontend: halaman laporan Total Fee per Periode.
11. Frontend: update tampilan laporan laba rugi.
12. Testing end-to-end: coba login sebagai non-admin, pastikan fee benar-benar tidak terlihat di semua tempat (form, API response mentah, proforma invoice, laporan), dan cek layout tetap responsive di layar sempit.
