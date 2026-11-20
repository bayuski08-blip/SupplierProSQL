# Instruksi Perbaikan Fitur PPN (Pajak) — SupplierPro

## 1. Latar Belakang Masalah

Ditemukan 2 masalah terkait PPN:

### Masalah A — Bug perhitungan (root cause)
Di halaman POS, PPN 11% dihitung dan ditampilkan dengan benar di ringkasan cart (Subtotal → Diskon → PPN → Total).
Tapi setelah invoice dibuat & dicetak, hasil print menunjukkan:
- `TAX` = 0
- `SUB TOTAL` = angka yang **sudah termasuk pajak** (bukan subtotal murni)

Contoh: 2 item seharga 115.000 + 68.000 = 183.000 (subtotal asli).
Yang tercetak: SUB TOTAL = 203.130, TAX = 0.
Cek: 183.000 × 1.11 = 203.130 — cocok persis.

**Kesimpulan**: saat proses "Buat Invoice", backend menghitung total-termasuk-pajak dengan benar, tapi:
- Nilai itu **disimpan/ditampilkan ke field `subtotal`**, bukan ke field `total`/`grand_total`.
- Field `tax`/`ppn` tidak diisi (tetap default 0) saat insert ke tabel invoice/transaksi.

Perbaikan ini WAJIB dilakukan dulu, terlepas dari fitur toggle di bawah, karena ini bug data yang salah ke customer.

### Masalah B — Kebutuhan fitur baru
SupplierPro akan dipakai UMKM yang sudah punya badan usaha (wajib PPN/PKP) maupun yang belum (tidak perlu PPN). Maka PPN harus bisa **diaktifkan/dinonaktifkan** per bisnis/client.

---

## 2. Keputusan Desain (Final)

1. Saat toggle PPN diubah, **semua invoice (lama & baru)** mengikuti setting yang berlaku SAAT INI. Tidak ada snapshot per-invoice. Artinya field tax TIDAK BOLEH disimpan sebagai angka fix permanen di record invoice — tax harus dihitung ulang (recalculate) setiap kali invoice ditampilkan/dicetak, berdasarkan setting aktif saat itu.
2. Kalau PPN aktif, persentasenya **selalu ikut `Pajak Default (%)`** dari Pengaturan. Tidak ada override manual per transaksi di halaman POS.
3. Toggle aktif/nonaktif PPN diletakkan di halaman **Pengaturan > Preferensi Invoice**, berdampingan dengan field `Pajak Default (%)` yang sudah ada.
4. **Soft-lock, bukan hard lock**: toggle tetap bisa diubah kapan saja secara teknis. Tapi jika bisnis sudah punya minimal 1 transaksi/invoice tersimpan, saat user coba ubah toggle (baik dari OFF ke ON maupun ON ke OFF), tampilkan modal konfirmasi peringatan sebelum perubahan disimpan:
   > "Bisnis ini sudah punya transaksi. Mengubah pengaturan PPN akan mempengaruhi perhitungan pada SEMUA invoice (termasuk yang sudah dibuat sebelumnya), karena invoice selalu mengikuti pengaturan PPN yang berlaku saat ini. Lanjutkan?"

   Tombol: **Batalkan** (toggle kembali ke posisi semula) / **Lanjutkan** (toggle tersimpan).

   Jika belum ada transaksi sama sekali (masih tahap setup awal), toggle bisa diubah bebas tanpa modal konfirmasi.

---

## 3. Perubahan Database

Tambah kolom baru di tabel business settings (nama tabel menyesuaikan skema yang sudah ada, kemungkinan `business_profile` atau `settings`):

```sql
ALTER TABLE settings ADD COLUMN ppn_enabled BOOLEAN NOT NULL DEFAULT true;
```

Catatan:
- Default `true` supaya client yang sudah aktif PPN sebelumnya tidak berubah perilaku.
- **Cek dulu apakah tabel transaksi/invoice punya kolom `tax` atau `subtotal` yang salah isi** (sesuai Masalah A). Jangan tambah kolom snapshot tax baru — cukup pastikan kolom yang sudah ada (`subtotal`, `tax`/`ppn_amount`, `total`/`grand_total`) diisi dengan nilai yang BENAR saat insert:
  - `subtotal` = jumlah harga item (sebelum diskon/fee/pajak)
  - `tax`/`ppn_amount` = hasil hitung pajak (0 jika PPN nonaktif)
  - `total`/`grand_total` = subtotal - diskon + fee + tax

Jika Railway query editor kena limit karakter, jalankan ALTER TABLE ini terpisah dari query lain.

---

## 4. Perubahan Backend

### 4.1 Endpoint Settings (GET & POST/PUT)
- Tambahkan field `ppn_enabled` ke response GET settings dan payload POST/PUT saat simpan.
- Tambahkan endpoint/field baru untuk cek apakah bisnis sudah punya transaksi, misal `GET /api/transactions/count` yang return `{ count: number }`. Frontend pakai ini untuk menentukan apakah modal konfirmasi perlu ditampilkan (lihat 5.1).

### 4.2 Endpoint Buat Invoice / Transaksi (POST)
Perbaiki logic perhitungan sebelum insert ke DB:

```js
// Ambil setting terbaru dari DB, JANGAN pakai nilai dari frontend untuk keputusan ppn_enabled
const settings = await getBusinessSettings();

const subtotal = items.reduce((sum, item) => sum + (item.harga * item.qty), 0);
const diskon = req.body.diskon || 0;
const fee = req.body.fee || 0;

const taxAmount = settings.ppn_enabled
  ? Math.round((subtotal - diskon + fee) * (settings.pajak_default / 100))
  : 0;

const total = subtotal - diskon + fee + taxAmount;

// Simpan ke DB dengan field yang benar:
// subtotal -> subtotal (bukan total!)
// tax -> taxAmount
// total -> total
```

**Perhatikan**: pastikan tidak ada kode lama yang menimpa `subtotal` dengan nilai `total`. Ini kemungkinan besar penyebab Masalah A.

### 4.3 Endpoint Get Invoice (untuk ditampilkan/print)
Karena keputusan desain #1 (invoice ikut setting terkini, bukan snapshot), endpoint yang mengembalikan data invoice untuk print HARUS **menghitung ulang tax** berdasarkan setting aktif saat ini, bukan sekadar membaca `tax` yang tersimpan di record lama:

```js
const invoice = await getInvoiceById(id);
const settings = await getBusinessSettings();

const recalculatedTax = settings.ppn_enabled
  ? Math.round((invoice.subtotal - invoice.diskon + invoice.fee) * (settings.pajak_default / 100))
  : 0;

const recalculatedTotal = invoice.subtotal - invoice.diskon + invoice.fee + recalculatedTax;

// Gunakan recalculatedTax & recalculatedTotal saat render/print,
// JANGAN pakai nilai lama yang tersimpan di record invoice untuk field ini.
```

---

## 5. Perubahan Frontend

### 5.1 Halaman Pengaturan (Preferensi Invoice)
Tambahkan toggle/checkbox di dekat field "Pajak Default (%)":

```
[✓] Aktifkan PPN
    Pajak Default (%): [11]
```

- Saat toggle OFF: field "Pajak Default (%)" bisa di-disable (abu-abu) tapi nilai tetap tersimpan (supaya kalau diaktifkan lagi nanti, angkanya tidak hilang).
- Simpan `ppn_enabled` bersamaan dengan field lain saat tombol "Simpan" ditekan.
- **Logic soft-lock**: saat halaman Pengaturan load, panggil `GET /api/transactions/count`.
  - Jika `count === 0`: toggle berfungsi normal, tidak ada modal apapun.
  - Jika `count > 0`: setiap kali user mengubah posisi toggle (klik switch), tampilkan modal konfirmasi (lihat isi pesan di bagian 2, poin 4) SEBELUM perubahan disimpan ke state form.
    - Klik "Batalkan" → toggle kembali ke posisi sebelumnya, modal tutup, tidak ada perubahan.
    - Klik "Lanjutkan" → toggle berubah ke posisi baru, modal tutup, user masih perlu klik "Simpan" seperti biasa untuk commit ke database (perilaku sama seperti field lain di form ini).

### 5.2 Halaman POS/Kasir
- Ambil `ppn_enabled` dari settings saat halaman load.
- Jika `ppn_enabled = false`:
  - **Sembunyikan baris "PPN (11%)"** di ringkasan cart sepenuhnya (jangan tampilkan "PPN (0%)" atau "Rp 0" — langsung hilangkan barisnya).
  - Total = Subtotal - Diskon + Fee.
- Jika `ppn_enabled = true`:
  - Tampilkan baris PPN seperti sekarang, dengan persentase dari `Pajak Default (%)`.

### 5.3 Halaman Print/Proforma Invoice
- Sama seperti POS: jika `ppn_enabled = false` di setting SAAT INVOICE DIBUKA/PRINT, baris "TAX" tidak ditampilkan sama sekali (bukan ditampilkan sebagai 0).
- Jika `ppn_enabled = true`, tampilkan baris TAX dengan nilai yang sudah di-recalculate sesuai poin 4.3.
- Pastikan label "SUB TOTAL" benar-benar subtotal murni (sebelum pajak), bukan total-termasuk-pajak seperti bug sebelumnya.

---

## 6. Test Case yang Harus Dicek Setelah Perbaikan

| # | Skenario | Expected Result |
|---|----------|------------------|
| 1 | PPN aktif, buat invoice 2 item (115.000 + 68.000) | SUB TOTAL = 183.000, TAX = 20.130 (11%), GRAND TOTAL = 203.130 |
| 2 | PPN nonaktif, buat invoice sama | SUB TOTAL = 183.000, tidak ada baris TAX, GRAND TOTAL = 183.000 |
| 3 | Invoice lama (dibuat saat PPN aktif) dibuka lagi setelah PPN dinonaktifkan | Baris TAX hilang, GRAND TOTAL ikut turun (tanpa pajak) — sesuai keputusan desain #1 |
| 4 | Toggle PPN di Pengaturan diaktifkan lagi | Nilai `Pajak Default (%)` yang sebelumnya tersimpan tetap muncul (tidak reset ke 0) |
| 5 | Halaman POS dengan PPN nonaktif | Baris "PPN" tidak muncul sama sekali di ringkasan cart, bukan tampil sebagai Rp 0 |

---

## 7. Catatan Tambahan
- Karena Masalah A adalah bug pre-existing yang sudah mempengaruhi invoice client yang sudah live, sebaiknya setelah fix, cek beberapa invoice lama di database production untuk pastikan tidak ada data yang salah tersimpan secara permanen ke laporan/rekap keuangan lain (kalau ada fitur laporan yang tarik dari `subtotal`/`total` invoice ini).
