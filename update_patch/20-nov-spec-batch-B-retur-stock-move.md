# Spec Batch B — Retur (Penjualan & Pembelian) dan Stock Move

Ikuti **Aturan Umum** di `spec-batch-A-perbaikan-cepat.md` (inspeksi struktur aktual dulu, test di clone DB, validasi di backend, UI ter-update tanpa refresh, laporkan hasil tiap langkah).

**Urutan pengerjaan wajib:** B0 → B1 → B2 → B3 → B4. Retur harus mencatat ke Stock Move sejak awal, jadi fondasinya (B0) dibuat lebih dulu.

---

## B0. Fondasi: Tabel & Helper Stock Move

### Tabel pergerakan stok
Buat tabel (mis. `stock_moves`; verifikasi dulu apakah sudah ada tabel serupa):

- id, product_id, tanggal (datetime), tipe, ref_type, ref_id, ref_no
- qty_masuk, qty_keluar (salah satunya 0)
- qty_sebelum, qty_sesudah (jumlah stok, **bukan nilai uang**)
- keterangan, created_by, created_at

Nilai `tipe` minimal: `penjualan`, `pembelian`, `opname`, `retur_penjualan`, `retur_penjualan_rusak`, `retur_pembelian`, `cancel_invoice`, `koreksi_edit`, `stok_awal`.

**Tabel ini TIDAK menyimpan harga, HPP, nilai, atau nominal apa pun.** Ini sengaja, karena halamannya diakses role gudang.

### Helper terpusat
- Buat satu fungsi (mis. `recordStockMove(conn, {...})`) yang dipanggil **di dalam database transaction yang sama** dengan perubahan stok, agar stok dan catatan pergerakan selalu konsisten.
- Cari **semua** tempat yang mengubah stok produk (pencarian kode untuk update kolom stok) dan pasang helper di sana:
  - buat invoice, edit invoice (koreksi), cancel invoice, hapus invoice
  - simpan PO, edit PO, cancel/hapus PO
  - stock opname
  - tambah produk dengan stok awal / import produk
  - retur (B1, B2)
- Laporkan daftar lengkap titik yang ditemukan. Jangan sampai ada yang terlewat.

### Backfill data lama
- Isi `stock_moves` dari data historis: item invoice, item PO, dan riwayat opname yang sudah ada, urut berdasarkan tanggal. Tandai baris hasil backfill (mis. kolom `is_backfill`).
- Setelah backfill, hitung selisih antara stok produk saat ini dan hasil penjumlahan pergerakan. Jika ada selisih, buat satu baris `stok_awal` per produk sebagai penyeimbang.
- Laporkan produk yang selisihnya tidak wajar (untuk ditinjau manual).
- Jalankan backfill hanya di clone database dulu, lalu sediakan script/migrasi yang aman dijalankan ulang (idempotent).

---

## B1. Retur Penjualan

### Alur UI
- Di **modal Edit Invoice**, tambah tombol **"Retur"**. Klik tombol ini membuka **form retur** (modal kedua).
- **Penting — modal bertumpuk (nested modal):** modal edit invoice sudah berupa modal kecil. Pastikan:
  - modal retur tampil **di atas** (z-index benar), dan modal di belakangnya tidak bisa diklik;
  - scroll halaman terkunci dengan benar dan tidak "bocor" setelah modal ditutup (gunakan penghitung modal terbuka, bukan boolean tunggal);
  - tombol Esc / Tutup hanya menutup modal paling atas;
  - setelah retur berhasil, kedua modal tertutup dan list invoice ter-refresh tanpa reload browser;
  - uji pada invoice dengan 1 item, banyak item, invoice lunas, invoice kredit, dan invoice yang sudah punya cicilan.
- Tombol Retur **tidak tampil** untuk invoice berstatus cancelled.

### Form retur
- Info invoice (nomor, tanggal, pelanggan) tampil sebagai teks baca-saja.
- Daftar item invoice dengan input **qty retur** per item (maks = qty terjual dikurangi qty yang sudah pernah diretur) dan pilihan **Kondisi** per item:
  - **"Kembali ke stok"**
  - **"Rusak / tidak dikembalikan ke stok"**
- Field **Alasan** (wajib) dan **Tanggal retur** (default hari ini).
- Validasi di backend: qty retur ≥ 1 dan tidak melebihi sisa yang bisa diretur; minimal satu item diretur.

### Dampak data (dalam satu database transaction)
- Dokumen retur dengan nomor sendiri (mis. `RTJ-YYYY-MM-NNNNN`, ikuti pola penomoran yang ada) berisi header dan item (produk, qty, kondisi, harga satuan **snapshot** dari invoice asal).
- **Stok:**
  - Kondisi "Kembali ke stok": stok bertambah, catat `stock_moves` tipe `retur_penjualan` (qty masuk).
  - Kondisi "Rusak": stok **tidak** bertambah, catat `stock_moves` tipe `retur_penjualan_rusak` dengan qty 0 dan keterangan jelas, supaya tetap terlacak.
- **Keuangan:** nilai retur dihitung dari harga item di invoice (proporsional terhadap diskon dan PPN invoice asal; **jangan mengubah logika fee**, laporkan bagaimana fee diperlakukan dan hitung nilai retur tanpa mengubah perhitungan fee yang ada).
  - Invoice belum lunas / kredit: nilai retur **mengurangi piutang** (sisa piutang).
  - Jika nilai retur melebihi sisa piutang, atau invoice sudah lunas: selisihnya masuk **deposit pelanggan** (gunakan mekanisme deposit yang sudah ada).
  - HPP/laba: untuk "Kembali ke stok", balikkan HPP sesuai HPP saat invoice. Untuk "Rusak", HPP tidak dibalik. Verifikasi dengan logika weighted average yang ada dan laporkan sebelum menerapkan jika ada ketidakjelasan.
- Retur tidak mengubah invoice asli (invoice tetap utuh sebagai catatan), tetapi di tampilan invoice tampilkan penanda/ringkasan bahwa ada retur.

---

## B2. Retur Pembelian

- Di **modal Edit PO** dan sebagai aksi di baris list Pembelian, tambah tombol **"Retur"**, dengan perilaku modal bertumpuk yang sama seperti B1.
- Form: item PO dengan qty retur (maks = qty dibeli dikurangi qty yang sudah diretur), alasan (wajib), tanggal retur.
- **Interpretasi kondisi:** barang retur pembelian selalu **keluar dari stok** (kembali ke vendor). Pilihan "kembali ke stok / rusak" tidak berlaku untuk pembelian. Validasi stok mencukupi sebelum menyimpan.
- Dokumen retur dengan nomor sendiri (mis. `RTB-YYYY-MM-NNNNN`).
- **Stok:** berkurang, catat `stock_moves` tipe `retur_pembelian` (qty keluar).
- **Keuangan:**
  - PO belum lunas / ada hutang: nilai retur **mengurangi hutang**.
  - Jika nilai retur melebihi sisa hutang, atau PO sudah lunas: selisih dicatat sebagai **deposit vendor** (cerminkan mekanisme deposit pelanggan yang sudah ada; laporkan struktur yang dipakai sebelum membuatnya). Jangan membuat entri kas otomatis.
- Retur pembelian ikut mengoreksi perhitungan HPP weighted average sesuai logika yang ada. Verifikasi dan laporkan.

---

## B3. Soft-Lock pada Edit Invoice dan Edit PO

Saat user mengurangi qty atau menghapus item pada invoice/PO yang sudah berjalan (sudah memengaruhi stok):

- Tampilkan **modal peringatan** yang menjelaskan bahwa pengurangan qty/penghapusan item seharusnya dicatat sebagai retur. Dua pilihan:
  1. **"Buka Form Retur"** (disarankan)
  2. **"Lanjutkan sebagai Koreksi Salah Input"** — hanya untuk admin dan wajib mengisi alasan. Stok tetap dikembalikan seperti sekarang, tetapi dicatat di `stock_moves` dengan tipe `koreksi_edit` beserta alasannya.
- Role selain admin hanya melihat pilihan 1.
- Penambahan qty / penambahan item tidak terkena soft-lock.
- Tombol Cancel invoice yang sudah ada tidak berubah (tipe `cancel_invoice` di Stock Move).

---

## B4. Halaman Daftar Retur dan Halaman Stock Move

### B4.1 Daftar Retur
- Satu menu sidebar **"Retur"** (letakkan di grup transaksi) dengan dua tab: **Retur Penjualan** dan **Retur Pembelian**.
- Kolom: no. retur, tanggal, no. referensi (invoice/PO), pelanggan/vendor, jumlah item, alasan, status kondisi (kembali ke stok / rusak), dan nilai retur.
- **Kolom nilai/nominal hanya tampil untuk role yang punya akses data keuangan.** Sanitasi di respons API backend (jangan dikirim ke role lain), bukan hanya disembunyikan di UI.
- Klik baris menampilkan detail retur. Filter tanggal dan pencarian nomor. Pagination 80 baris.
- Daftarkan menu dan izin baru ke **Otoritas Akses**. Default: mengikuti izin edit invoice (penjualan) dan izin PO (pembelian).

### B4.2 Stock Move
- Menu sidebar **"Stock Move"** (letakkan dekat Produk & Stok). Fokus: **monitoring qty barang keluar-masuk saja**.
- **Berbeda dari Arus Kas.** Halaman ini **tidak boleh** menampilkan atau mengirim data keuangan: tidak ada harga, HPP, nilai, nominal, saldo kas, dan sebagainya.
- Kolom: tanggal, produk (nama + kode), tipe (badge), no. referensi, qty masuk, qty keluar, stok sesudah, keterangan, user.
  - "Stok sesudah" adalah **jumlah stok**, bukan saldo uang.
  - No. referensi untuk role gudang ditampilkan sebagai **teks biasa (tidak bisa diklik)**, karena halaman invoice/PO bisa di luar izin mereka. Untuk role yang berhak, boleh berupa link.
  - Nama pelanggan/vendor boleh ditampilkan di kolom keterangan.
- Filter: rentang tanggal, produk (pencarian), tipe (penjualan, pembelian, opname, retur, koreksi, cancel). Pagination 80 baris, urut terbaru dulu.
- **Respons API harus disanitasi di backend**, tidak ada field keuangan sama sekali.
- **Akses: admin dan gudang.** Daftarkan ke Otoritas Akses sehingga bisa diatur kemudian.
- Tambahkan card **"Stock Move terbaru"** (10 baris terakhir, tanpa data keuangan) ke dashboard role admin dan gudang (lihat tabel di Batch A7).

---

## Checklist Pengujian (di clone DB)
- Jual produk → muncul di Stock Move (keluar) dan stok berkurang.
- Beli (PO) → muncul (masuk).
- Opname naik dan turun → muncul dengan stok sebelum/sesudah benar.
- Retur penjualan "kembali ke stok" dan "rusak" → stok, Stock Move, piutang/deposit benar.
- Retur pembelian → stok turun, hutang/deposit vendor benar.
- Edit invoice/PO kurangi qty → soft-lock muncul; non-admin tidak bisa memilih koreksi.
- Login sebagai gudang → Stock Move terbuka, tidak ada data uang di respons API (cek Network tab), tidak ada error toast.
- Modal bertumpuk: Esc, scroll, dan refresh list berfungsi normal.
