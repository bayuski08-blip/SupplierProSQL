# Spec: Laporan Penjualan & Laba Rugi (Harian / Bulanan / Per Invoice)

> **Untuk:** Antigravity
> **Proyek:** SupplierPro (Node.js + Express, MySQL, vanilla HTML/CSS/JS, JWT)
> **Prioritas:** Tinggi. Laporan Laba Rugi saat ini menampilkan angka yang salah.

---

## 0. ATURAN WAJIB (baca dulu)

1. **JANGAN langsung mengubah kode atau database.** Kerjakan **Fase 0 (investigasi, read-only)** dulu, lalu tulis laporan temuan ke file `temuan-laporan-laba.md`. **Berhenti dan tunggu konfirmasi** sebelum lanjut ke Fase 1.
2. **Nama tabel, kolom, dan status di dokumen ini hanya contoh.** Verifikasi semuanya terhadap skema database dan kode yang sebenarnya. Kalau berbeda, **ikuti yang aktual** dan catat selisihnya di laporan temuan.
3. **Semua simulasi dan testing dilakukan di database hasil clone, bukan production.** Migrasi harus idempotent (aman dijalankan ulang) dan disediakan sebagai file SQL terpisah, supaya bisa dijalankan manual lewat phpMyAdmin di Hostinger.
4. **Jangan ubah logika perhitungan Fee Customer.** Fee sudah termasuk di total invoice dan harus tetap seperti sekarang. Cukup dokumentasikan bagaimana fee berinteraksi dengan laporan ini (lihat 0.6).
5. **HPP tidak boleh terlihat oleh role kasir dan gudang**, baik di UI maupun di response API (sanitasi di sisi server, bukan hanya disembunyikan di frontend).
6. Jangan menyentuh `.env`, jangan commit secret. Tampilan desktop dan mobile yang sudah ada tidak boleh rusak.
7. **Menu dan endpoint Laporan Penjualan hanya boleh diakses role `admin` (administrator).** Role lain (finance, kasir, gudang) tidak melihat menunya dan mendapat **403** bila memanggil endpoint-nya langsung.

---

## 1. Latar Belakang Masalah

Temuan dari screenshot aplikasi saat ini (periode November 2026):

| # | Temuan | Dampak |
|---|---|---|
| 1 | Menu **Laba Rugi** memakai **Total Pembelian** (Rp 17.487.500) sebagai HPP. Penjualan bersih hanya Rp 6.799.305. | Laba Kotor = **-Rp 10.688.195**; kartu dashboard "Margin Rata-Rata" = **-157,2%**. Pembelian menambah persediaan, bukan beban. HPP yang benar adalah harga pokok **barang yang terjual**. |
| 2 | Tidak ada HPP per invoice / per item invoice. | Laba per invoice, per hari, dan per bulan tidak bisa dihitung konsisten. |
| 3 | Invoice dengan label "Ada Retur" (mis. INV-2026-11-00090), tetapi baris "Dikurangi: Retur & Diskon" menampilkan `Rp -0`. | Retur tampaknya tidak masuk ke laporan. Format `-0` juga bug tampilan. |
| 4 | Ada banyak invoice berstatus **Cancel** (mis. 00083, 00087, 00088). Belum jelas apakah dikecualikan dari "Penjualan Kotor" dan "Dari 43 invoice bulan ini". | Penjualan dan jumlah invoice bisa terlalu besar. |
| 5 | Nomor invoice tidak urut terhadap tanggal (00089/00090 bertanggal 21 Nov, tetapi 00084 bertanggal 5 Nov, 00083 bertanggal 3 Nov). | Laporan harus dikelompokkan memakai **tanggal transaksi**, bukan `created_at` atau nomor invoice. |
| 6 | "Rata-rata Penjualan/Hari" (Rp 227rb) tampaknya = penjualan ÷ 30 (jumlah hari kalender bulan itu). | Untuk bulan berjalan, angkanya menyesatkan. |

---

## 2. FASE 0: Investigasi (READ-ONLY)

Jalankan semua pengecekan di bawah ini, lalu tulis hasilnya ke `temuan-laporan-laba.md` dengan struktur yang sama (nomor 0.1 dst.).

### 0.1 Skema database aktual
- Jalankan `SHOW CREATE TABLE` untuk semua tabel yang terkait transaksi dan stok. Minimal: invoice (header), item invoice, produk, PO (header dan item), retur (penjualan dan pembelian), stock move / mutasi stok, konversi produk, proforma, pembayaran/cicilan piutang, deposit customer, tipe pembayaran, tabel beban operasional (jika ada), dan tabel fee customer.
- Laporkan: nama tabel, nama kolom, tipe data, PK/FK, dan kolom `status`. **Daftar semua nilai status invoice yang ada** (mis. lunas, belum lunas, cancel, dan lainnya).
- Laporkan kolom **tanggal** mana yang dipakai sebagai tanggal transaksi (tanggal order yang diinput di kasir) dan mana yang hanya timestamp pembuatan.

### 0.2 Cara HPP dihitung sekarang
- Apakah produk punya kolom harga pokok/HPP rata-rata? Di mana dan kapan nilainya diperbarui (saat penerimaan PO? saat edit/hapus PO?).
- Audit sebelumnya merencanakan **weighted average (rata-rata tertimbang)** untuk HPP/COGS. Cek apakah sudah terimplementasi atau belum, dan apakah sudah benar setelah edit/delete/cancel PO.
- Apakah ada kolom HPP/harga beli di tabel item invoice saat ini? (Kemungkinan tidak ada.)

### 0.3 Endpoint & kode laporan yang ada
- Temukan endpoint dan query untuk: halaman **Laba Rugi**, halaman **Laporan**, dan kartu dashboard (rata-rata penjualan/hari, rata-rata nilai invoice, margin rata-rata, customer retention, produk terlaris, pelanggan teratas).
- Untuk setiap query, laporkan: filter status apa yang dipakai (apakah invoice Cancel dikecualikan?), kolom tanggal yang dipakai, dan bagaimana retur serta diskon dihitung.

### 0.4 Alur yang mengubah nilai invoice atau stok
Petakan semua titik kode di mana item invoice dibuat, diubah, atau dibatalkan, karena di sinilah HPP snapshot harus dijaga konsisten:
- Buat invoice dari kasir (desktop dan mobile)
- Edit invoice (qty dikurangi / item dihapus)
- Cancel invoice
- Retur penjualan (kembali ke stok vs rusak)
- Import invoice outstanding (template import)
- Proforma → "Jadikan Invoice"
- Konversi produk (apakah mengubah HPP produk target?)
- Stock opname

### 0.5 Data eksisting
- Hitung jumlah invoice dan item invoice yang sudah ada (total, dan per status).
- Berapa invoice hasil **import outstanding** (tidak punya info HPP asli)?
- Apakah ada produk dengan HPP = 0 atau NULL?

### 0.6 PPN, diskon, fee, retur
- Bagaimana PPN disimpan di invoice (subtotal/DPP, PPN, total)? Apakah penjualan di laporan saat ini sudah termasuk PPN?
- Bagaimana diskon disimpan (per item atau per invoice)?
- Bagaimana Fee Customer disimpan, dan apakah fee sudah masuk ke total invoice? **Jangan diubah**, cukup jelaskan apakah fee menjadi bagian dari omzet atau bukan dalam laporan sekarang.
- Bagaimana retur disimpan (tabel, relasi ke invoice dan item, status, nilai)?

### 0.7 Akses & role
- Role apa saja yang ada (nama persis role administrator di database/JWT), dan bagaimana middleware pembatasan akses serta sanitasi response dipasang (terutama untuk HPP).
- Role apa saja yang saat ini boleh membuka halaman **Laba Rugi** dan **Laporan** yang sudah ada. Jangan diubah, cukup dilaporkan.

### 0.8 Rencana
Di akhir `temuan-laporan-laba.md`, tulis **rencana implementasi konkret** (nama kolom final, file yang akan diubah, urutan langkah, risiko) dan **daftar pertanyaan** bila ada yang ambigu. Lalu **BERHENTI dan tunggu konfirmasi**.

---

## 3. FASE 1: HPP Snapshot per Item Invoice

> Lakukan hanya setelah Fase 0 disetujui.

### 3.1 Perubahan skema
Tambahkan di tabel item invoice (nama aktual hasil Fase 0):

| Kolom | Tipe | Keterangan |
|---|---|---|
| `hpp_satuan` | `DECIMAL(18,2) NOT NULL DEFAULT 0` | HPP rata-rata tertimbang per unit **pada saat invoice dibuat**. |
| `hpp_estimasi` | `TINYINT(1) NOT NULL DEFAULT 0` | `1` jika nilai berasal dari backfill/estimasi (bukan snapshot asli). |

Migrasi dalam file SQL terpisah, idempotent (cek kolom sudah ada sebelum `ALTER`).

### 3.2 Aturan pengisian snapshot
- **Buat invoice:** isi `hpp_satuan` dari HPP rata-rata produk saat itu (sumber sesuai 0.2). Snapshot tidak berubah walau HPP produk berubah kemudian.
- **Edit invoice:** item yang sudah ada **mempertahankan** `hpp_satuan` lamanya. Item baru yang ditambahkan mengambil HPP saat itu. Qty dikurangi atau item dihapus sehingga stok kembali: perhitungan stok/HPP produk tetap konsisten dengan logika reversal yang sudah ada.
- **Cancel invoice:** data tetap tersimpan, status menjadi cancel. Invoice cancel dikecualikan dari semua laporan.
- **Retur penjualan:** retur memakai `hpp_satuan` dari item invoice asalnya. Barang **kembali ke stok** → HPP ikut berkurang dari laporan. Barang **rusak** → HPP **tidak** dikembalikan (menjadi kerugian, dilaporkan terpisah bila memungkinkan).
- **Proforma → Jadikan Invoice:** snapshot diambil **saat dikonversi menjadi invoice**, bukan saat proforma dibuat.
- **Import invoice outstanding:** isi dengan HPP produk saat ini dan set `hpp_estimasi = 1`. Jika produk tidak ditemukan atau HPP kosong, isi 0 dan tetap tandai `hpp_estimasi = 1`.

### 3.3 Backfill data lama
- Untuk semua item invoice lama: `hpp_satuan` = HPP produk saat ini, `hpp_estimasi = 1`.
- Sediakan script backfill terpisah, bisa dijalankan ulang tanpa menimpa baris yang sudah `hpp_estimasi = 0`.
- Laporkan jumlah baris yang di-backfill dan jumlah yang HPP-nya 0.

---

## 4. FASE 2: Perbaiki Laba Rugi & Dashboard

### 4.1 Rumus yang benar

```
Penjualan Kotor   = Σ (qty × harga)                      -- invoice status ≠ cancel, tanggal transaksi dalam periode
Diskon            = Σ diskon
Retur (nilai)     = Σ nilai retur penjualan pada periode
Penjualan Bersih  = Penjualan Kotor − Diskon − Retur
HPP (terjual)     = Σ (qty × hpp_satuan) − HPP dari retur yang kembali ke stok
Laba Kotor        = Penjualan Bersih − HPP
Laba Bersih       = Laba Kotor − Beban Operasional
Margin %          = Laba Kotor ÷ Penjualan Bersih × 100   (jika penjualan bersih = 0, tampilkan "-")
```

- Gunakan basis **DPP (tanpa PPN)** untuk penjualan di laporan. Jika hasil 0.6 menunjukkan perlu pendekatan lain, jelaskan di temuan sebelum mengubah.
- **Pembelian tidak boleh lagi menjadi HPP** di Laba Rugi. Pembelian tetap tercatat di persediaan/neraca dan di laporan pembelian.
- Hanya invoice dengan status **bukan cancel** yang dihitung.
- Pengelompokan periode memakai **tanggal transaksi**.

### 4.2 Perbaikan terkait
- Format angka: `Rp -0` harus tampil `Rp 0`.
- Baris "Dikurangi: Retur & Diskon" harus benar-benar memuat nilai retur dan diskon (perbaiki penyebab invoice 00090 "Ada Retur" tetapi nilainya 0).
- **Rata-rata Penjualan/Hari:** untuk bulan berjalan, bagi dengan jumlah hari yang sudah lewat dalam bulan itu. Untuk bulan yang sudah selesai, bagi dengan jumlah hari kalender bulan tersebut. Pada Laporan Penjualan dengan rentang tanggal, bagi dengan jumlah hari dalam rentang (dibatasi sampai hari ini bila rentang melewati hari ini). Tambahkan tooltip atau keterangan kecil agar jelas.
- **Margin Rata-Rata** pada dashboard memakai rumus Laba Kotor ÷ Penjualan Bersih dari 4.1.
- Pastikan "Jumlah invoice" dan "Rata-rata Nilai Invoice" tidak menghitung invoice Cancel.
- Kartu dashboard yang menampilkan HPP/laba mengikuti aturan role dashboard yang sudah ada (admin dan finance), tidak diubah. Pembatasan admin-saja hanya berlaku untuk menu dan endpoint Laporan Penjualan. Kasir tidak boleh melihat omzet maupun HPP (sesuai aturan role yang sudah ada), tanpa menampilkan error toast.

---

## 5. FASE 3: Menu "Laporan Penjualan" Baru

Menu baru di grup **Keuangan** atau **Lainnya** (tentukan sesuai struktur sidebar yang ada). **Akses: role admin saja.**

Satu halaman dengan **filter rentang tanggal** yang dinamis. Pengguna memilih rentang dan cara pengelompokan, bukan berpindah antar tab yang terkunci ke harian atau bulanan.

### 5.1 Filter (berlaku untuk seluruh halaman)

| Filter | Keterangan |
|---|---|
| Rentang tanggal | **Dari** dan **Sampai** (date picker). Tanggal "Sampai" bersifat **inklusif** (sampai 23:59:59). |
| Preset cepat | Hari Ini, 7 Hari Terakhir, **Bulan Ini (default)**, Bulan Lalu, Tahun Ini, Kustom |
| Kelompokkan | **Per Hari**, **Per Bulan**, **Per Invoice** (segmented control) |
| Filter tambahan | Pelanggan, Tipe Pembayaran, Status. Tersedia di semua pengelompokan, dan ikut memengaruhi total serta export. |

Validasi:
- "Dari" tidak boleh lebih besar dari "Sampai".
- Per Hari: maksimal 366 hari. Per Bulan: maksimal 60 bulan. Per Invoice: tanpa batas rentang, tetapi dipaginasi. Jika batas terlampaui, tampilkan pesan yang jelas (jangan error diam-diam).
- Tombol **Tampilkan** menjalankan query. Jangan memuat ulang otomatis di setiap perubahan input.

### 5.2 Ringkasan (kartu di atas tabel)
Untuk rentang dan filter yang dipilih: **Penjualan Bersih**, **HPP**, **Laba Kotor**, **Margin %**, **Jumlah Invoice**, **Rata-rata Nilai Invoice**.

### 5.3 Tabel hasil

**Per Hari** dan **Per Bulan** memakai kolom yang sama (satu baris per tanggal atau per bulan):

| Kolom | Keterangan |
|---|---|
| Tanggal / Bulan | Tanggal transaksi (atau bulan) |
| Jml Invoice | Tidak termasuk Cancel |
| Penjualan Kotor | |
| Diskon | |
| Retur | |
| Penjualan Bersih | |
| HPP | |
| Laba Kotor | |
| Margin % | |

- Baris **total** di bawah tabel.
- Pada **Per Bulan**, bulan di tepi rentang hanya memuat tanggal yang masuk rentang (mis. rentang 15 Okt sampai 20 Nov: Oktober hanya 15 sampai 31). Beri label "(sebagian)" pada baris tersebut.
- **Drill-down:** klik baris tanggal → tampilkan invoice pada tanggal itu (Per Invoice). Klik baris bulan → tampilkan Per Hari untuk bulan itu, dibatasi rentang yang dipilih. Filter lain tetap terbawa.

**Per Invoice** (Laba per Invoice):
- Kolom: No. Invoice, Tanggal, Pelanggan, Penjualan Bersih, HPP, Laba, Margin %, Tipe Pembayaran, Status.
- Tandai invoice yang HPP-nya estimasi (`hpp_estimasi = 1`) dengan label kecil "HPP estimasi" dan tooltip penjelasan.
- Invoice dengan margin negatif diberi warna merah, secara visual tetap tidak mengganggu.
- Maksimal **80 baris per halaman** dengan pagination bila data lebih dari 80.
- Urut default: nomor invoice terbaru di atas.

### 5.4 Fitur umum
- Tombol **Export PDF** dan **Export Excel (CSV/XLSX)** sesuai tampilan yang aktif (rentang tanggal, pengelompokan, dan filter yang sedang dipakai). Header export mencantumkan rentang tanggal.
- Format angka rupiah konsisten dengan halaman lain (font dan format sama seperti list Transaksi / Invoice).
- Tampilan **mobile** tabel harus bisa discroll horizontal tanpa merusak layout.

### 5.5 Opsional di list Transaksi / Invoice
Tambahkan kolom **Laba** (dan margin) pada list Transaksi / Invoice, **hanya terlihat oleh admin**. Kolom ini tidak boleh ada di response API untuk role lain.

---

## 6. API (usulan, sesuaikan dengan konvensi route yang ada)

```
GET /api/laporan/penjualan/ringkasan?from=YYYY-MM-DD&to=YYYY-MM-DD&customer_id=&payment_type_id=&status=
GET /api/laporan/penjualan?group=day|month|invoice&from=YYYY-MM-DD&to=YYYY-MM-DD&customer_id=&payment_type_id=&status=&page=&limit=80
GET /api/laporan/laba-rugi?bulan=MM&tahun=YYYY        -- perbaikan endpoint yang ada (akses tidak diubah)
```

- Endpoint **laporan penjualan** dilindungi JWT + pemeriksaan role **admin saja** (selain admin: 403). Pemeriksaan dilakukan di server, bukan hanya menyembunyikan menu.
- Agregasi dilakukan di SQL (bukan di JS) agar cepat. Pastikan ada index pada kolom tanggal transaksi dan status invoice bila belum ada.
- Parameter divalidasi: format tanggal, `from <= to`, batas rentang sesuai 5.1. Nilai `group` selain yang diizinkan ditolak (400).
- Filter tanggal memakai kondisi inklusif yang aman terhadap tipe kolom (mis. `tanggal >= from AND tanggal < to + 1 hari`).

---

## 7. Skenario Uji (di database clone)

Siapkan data uji kecil lalu hitung manual, dan bandingkan dengan hasil laporan:

1. **Dasar:** 1 produk dibeli 10 unit @ Rp 1.000 (HPP 1.000). Jual 4 unit @ Rp 1.500 → Penjualan 6.000, HPP 4.000, Laba 2.000, Margin 33,3%.
2. **HPP berubah:** beli lagi 10 unit @ Rp 1.200 → HPP rata-rata baru 1.100. Invoice lama **tetap** memakai HPP 1.000, invoice baru memakai 1.100.
3. **Cancel:** invoice di-cancel → hilang dari semua laporan dan jumlah invoice; stok kembali.
4. **Edit qty dikurangi:** HPP dan laba invoice menyesuaikan, stok sinkron.
5. **Retur kembali ke stok:** penjualan bersih dan HPP berkurang proporsional.
6. **Retur rusak:** penjualan bersih berkurang, HPP **tidak** dikembalikan.
7. **Invoice backdate:** invoice bernomor besar dengan tanggal lebih lama muncul pada tanggal yang benar di laporan harian.
8. **Invoice outstanding import:** muncul dengan label "HPP estimasi".
9. **Diskon dan PPN:** hasil sesuai basis DPP yang disepakati.
10. **Bulan tanpa penjualan:** margin tampil "-", tidak error pembagian nol.
11. **Role:** hanya admin yang melihat menu dan data Laporan Penjualan serta kolom Laba di list invoice. Finance, kasir, dan gudang tidak melihat menunya, dan pemanggilan endpoint langsung mengembalikan 403. Kasir dan gudang tetap tidak melihat HPP di UI maupun response API.
12. **Cross-check:** Σ laba semua invoice pada Per Invoice = Σ Per Hari = Σ Per Bulan = Laba Kotor di Laba Rugi untuk periode yang sama.
13. **Rentang tanggal:** rentang satu hari; rentang lintas bulan (mis. 15 Okt sampai 20 Nov, bulan tepi berlabel sebagian); tanggal "Sampai" inklusif (invoice jam 23:30 pada tanggal akhir ikut terhitung); `from > to` ditolak; batas 366 hari (Per Hari) dan 60 bulan (Per Bulan) berfungsi; filter pelanggan dan tipe pembayaran memengaruhi kartu ringkasan, tabel, dan export.

---

## 8. Kriteria Selesai

- [ ] `temuan-laporan-laba.md` dibuat dan disetujui sebelum perubahan apa pun.
- [ ] Kolom `hpp_satuan` dan `hpp_estimasi` ada, migrasi dan backfill idempotent tersedia sebagai file SQL.
- [ ] Semua alur di 3.2 menjaga snapshot HPP dengan benar.
- [ ] Laba Rugi tidak lagi memakai total pembelian sebagai HPP; margin dashboard wajar.
- [ ] Bug `Rp -0` dan retur tidak terbaca sudah diperbaiki.
- [ ] Invoice Cancel tidak ikut dalam laporan mana pun.
- [ ] Menu Laporan Penjualan berfungsi dengan filter rentang tanggal (preset + kustom), pengelompokan Per Hari / Per Bulan / Per Invoice, kartu ringkasan, drill-down, pagination 80 baris, dan export.
- [ ] Menu dan endpoint Laporan Penjualan **hanya untuk admin** (role lain mendapat 403).
- [ ] HPP/laba tersembunyi dari kasir dan gudang di level API.
- [ ] Semua skenario uji di Bagian 7 lulus di database clone.
- [ ] Tidak ada perubahan pada logika Fee Customer.

---

## 9. Output yang Diharapkan dari Antigravity

1. `temuan-laporan-laba.md` (Fase 0), lalu berhenti untuk konfirmasi.
2. Setelah disetujui: file migrasi SQL, script backfill, perubahan kode, dan ringkasan perubahan per file.
3. Hasil pengujian skenario Bagian 7 (tabel lulus/gagal beserta angka aktual vs. harapan).
