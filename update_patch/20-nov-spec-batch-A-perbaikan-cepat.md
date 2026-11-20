# Spec Batch A — Perbaikan Cepat SupplierPro

## Aturan Umum (berlaku untuk Batch A, B, C)

1. **Inspeksi dulu, jangan menebak.** Sebelum mengubah apa pun, baca struktur database dan kode aktual. Verifikasi nama tabel, kolom, route API, dan nama role yang sebenarnya.
2. **Testing hanya di clone database**, jangan di production.
3. **Jangan ubah nama tabel, route API, atau nama file** kecuali disebut eksplisit di spec ini.
4. **Hak akses divalidasi di backend**, bukan hanya disembunyikan di UI. Gunakan sistem **Otoritas Akses** yang sudah ada. Jangan hardcode role di banyak tempat.
5. **UI harus ter-update otomatis** setelah simpan/ubah data, tanpa refresh browser manual.
6. Setelah tiap item selesai, laporkan: file yang diubah, perubahan skema (jika ada), dan cara mengujinya.
7. Pagination maksimal 80 baris untuk halaman list baru.

---

## A1. Card "Stok Menipis" di Dashboard — tampilan frame scroll

- Isi card ditampilkan dalam frame dengan **tinggi tetap (max-height)** dan **scroll vertikal di dalam frame**.
- Header card tetap terlihat (tidak ikut ter-scroll).
- Tinggi keseluruhan card tidak boleh mengubah layout card dashboard lain.
- Produk berstatus **nonaktif** (lihat A2) tidak ikut dihitung di card ini.
- Perubahan UI saja, tidak ada perubahan logika perhitungan stok menipis.

---

## A2. Proteksi Delete Produk + Status Aktif/Nonaktif

### A2.1 Proteksi delete
Tombol delete di setiap baris Daftar Produk:
- Produk **tidak boleh dihapus** jika sudah pernah ada di: item invoice (termasuk invoice berstatus cancelled), item PO, item retur penjualan/pembelian (Batch B), dan item proforma.
- Validasi **wajib di backend** (tolak dengan pesan jelas, mis. "Produk sudah memiliki riwayat transaksi, gunakan Nonaktifkan"). Jangan hanya mengandalkan UI.
- Di UI: tombol delete tetap tampil tetapi **disabled dengan tooltip alasan** untuk produk yang sudah punya transaksi. Tentukan statusnya lewat field/flag di response list, bukan query terpisah per baris.
- Jika produk hanya ada di Special Price (pricelist), baris harga tersebut ikut terhapus bersama produk (tampilkan peringatan di modal konfirmasi).
- Cek juga foreign key di database agar tidak ada error mentah yang sampai ke user.

### A2.2 Nonaktifkan produk
- Tambah kolom status aktif pada tabel produk (mis. `is_active`, default aktif). Verifikasi dulu apakah kolom serupa sudah ada.
- Daftar Produk: tambah **filter Status** dengan opsi *Aktif* (default), *Nonaktif*, *Semua*. Produk nonaktif diberi badge. **Tidak perlu halaman baru.**
- Tambah aksi **Nonaktifkan / Aktifkan** di setiap baris.
- Jika stok produk > 0 saat dinonaktifkan, tampilkan modal peringatan (soft-lock: boleh lanjut setelah konfirmasi).
- Produk nonaktif **tidak muncul** di: grid produk kasir, pencarian produk di modal PO, modal proforma, card stok menipis, dan daftar default stok opname.
- Produk nonaktif tetap tampil di riwayat/laporan/invoice lama, dan bisa diaktifkan kembali kapan saja.

---

## A3. Modal Stok Opname tidak muncul saat data produk banyak

Dilaporkan: di versi published, klik tombol **Stok Opname** di Daftar Produk & Stok tidak memunculkan modal.

**Tahap 1 — Diagnosis (wajib, laporkan sebelum memperbaiki):**
- Buka halaman dengan data produk banyak (clone database, tambah minimal 5.000 produk dummy).
- Cek error di console browser dan respons API saat tombol diklik.
- Periksa apakah modal bergantung pada list produk yang sudah dipaginasi (maks 80 baris) atau merender semua produk sekaligus (DOM berat / request timeout).
- Periksa apakah ada exception JS yang menghentikan pembukaan modal.
- Laporkan penyebab sebenarnya.

**Tahap 2 — Perbaikan (setelah diagnosis):**
- Modal harus **terbuka seketika**, tanpa menunggu seluruh data produk dimuat.
- Jangan render seluruh produk sekaligus. Gunakan pencarian server-side (ketik nama/kode) dan/atau pengambilan data per halaman.
- Uji ulang dengan 5.000+ produk dan pastikan modal terbuka dari kedua halaman (Daftar Produk dan Stock).
- Perilaku opname dan pencatatan hasilnya **tidak berubah**.

---

## A4. Pencarian Vendor di Modal "Buat Purchase Order"

- Ganti dropdown Vendor menjadi **combobox yang bisa diketik** (cari berdasarkan nama dan kode vendor), dengan hasil yang difilter saat mengetik.
- Jika data vendor banyak, gunakan pencarian server-side atau batasi hasil (mis. 20 teratas) dan tampilkan pesan "tidak ditemukan" bila kosong.
- Pertahankan posisi dan tata letak modal PO yang sudah didesain (Tipe Pembayaran di kanan Vendor).
- Buat sebagai **komponen yang bisa dipakai ulang** (akan dipakai juga untuk dropdown pelanggan di kasir jika diminta kemudian).
- Navigasi keyboard dasar: panah atas/bawah, Enter untuk memilih, Esc untuk menutup.

---

## A5. Ganti kata "Pricelist" menjadi "Special Price"

- Ubah **hanya teks yang terlihat user**: label menu sidebar, judul halaman, tombol, header tabel, label field di form pelanggan, pesan toast/validasi, dan teks di PDF/print bila ada.
- **Jangan ubah** nama tabel, nama kolom, route API, nama file, atau variabel.
- Lakukan pencarian menyeluruh pada seluruh file frontend dan template untuk kata "pricelist" / "Pricelist" / "price list" yang tampil ke user.

---

## A6. Halaman Piutang

1. **Sembunyikan tombol "Bayar"** di setiap baris. Tombol dengan ikon garis tiga (input cicilan) tetap menjadi satu-satunya jalur pembayaran. Sembunyikan di UI saja; endpoint backend lama tidak dihapus kecuali tidak dipakai di tempat lain (laporkan).
2. **Aturan tombol Delete piutang:** hanya boleh untuk piutang yang berasal dari **import outstanding**, bukan piutang yang terbentuk dari transaksi penjualan (POS/kasir).
   - Validasi **wajib di backend**. Tolak dengan pesan jelas jika piutang berasal dari transaksi penjualan.
   - Di UI: tombol hanya tampil/aktif untuk piutang outstanding.
   - Identifikasi asal piutang lewat field sumber yang sudah ada. Verifikasi dulu bagaimana outstanding ditandai.
   - Jika piutang outstanding sudah memiliki pembayaran cicilan, gunakan modal peringatan soft-lock sebelum menghapus.

---

## A7. Dashboard per Role

### Masalah
Saat login dengan role tertentu (mis. **gudang**) muncul toast "gagal menampilkan data transaksi". Dugaan: dashboard memanggil semua endpoint untuk semua role, lalu endpoint yang tidak diizinkan menolak dengan 403.

### Aturan
- **Admin: tidak ada perubahan**, tetap bisa mengakses semua.
- Setiap card dashboard hanya dirender **dan hanya memanggil API-nya** jika role punya izin ke data sumbernya (turunkan dari Otoritas Akses, bukan hardcode terpisah).
- Respons 403 pada widget dashboard **tidak boleh memunculkan toast error**. Jika role tidak berhak, card tidak dirender.
- Backend tetap menolak akses tidak sah (jangan longgarkan izin).
- Uji login dengan **setiap role** (admin, finance, kasir, gudang) dan pastikan **tidak ada notifikasi error** serta tidak ada request 403 di Network tab saat dashboard dimuat.

### Pembagian card (inspeksi dulu card yang benar-benar ada, lalu petakan ke aturan ini)

| Jenis card | Admin | Finance | Kasir | Gudang |
|---|---|---|---|---|
| Total omset / ringkasan penjualan total | ✓ | ✓ | ✗ | ✗ |
| Laba / rugi | ✓ | ✓ | ✗ | ✗ |
| Nilai stok / HPP | ✓ | ✓ | ✗ | ✗ |
| Piutang | ✓ | ✓ | ✗ | ✗ |
| Hutang | ✓ | sesuai izin halaman Hutang (lihat Batch C) | ✗ | sesuai izin halaman Hutang (lihat Batch C) |
| Kas / saldo / arus kas | ✓ | ✓ | ✗ | ✗ |
| Jumlah transaksi hari ini & invoice terbaru (tanpa total omset) | ✓ | ✓ | ✓ | ✗ |
| Stok menipis | ✓ | ✓ | ✓ | ✓ |
| PO / pembelian terbaru (qty, tanpa nilai uang) | ✓ | ✓ | ✗ | ✓ |
| Stock Move terbaru (ditambahkan di Batch B) | ✓ | ✗ | ✗ | ✓ |

Catatan:
- Untuk kasir: jangan tampilkan agregat omset total di card mana pun (termasuk tooltip atau grafik).
- Untuk gudang: jangan tampilkan nominal uang di card mana pun, kecuali card Hutang jika halaman Hutang diizinkan untuknya (Batch C).
- Jika ada card yang tidak masuk tabel di atas, laporkan dan usulkan penempatannya sebelum menerapkan.

---

## A8. Diagnosis Saja — Halaman Arus Kas (JANGAN diperbaiki tanpa laporan)

Di halaman Arus Kas terlihat **Total Kas Masuk = Rp 0** dan **Total Kas Keluar = Rp 0**, padahal daftar di bawahnya berisi banyak transaksi masuk dan keluar, dan Saldo Bersih Rp 12.793.940.

- Selidiki dari mana angka ringkasan dihitung (filter periode, query, atau bug).
- Catat juga bahwa entri **Stock Opname (kategori "Penyesuaian Stok")** tampil sebagai tipe **Keluar** di Arus Kas padahal bukan kas fisik. Jelaskan apakah ini disengaja (mis. untuk Laba Rugi) dan apakah memengaruhi Saldo Bersih.
- **Hanya laporkan temuan.** Jangan mengubah perilaku sebelum ada persetujuan.
