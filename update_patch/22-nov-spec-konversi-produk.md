# SPEC: Fitur Konversi Produk (Carton → Kg)

## 0. Aturan untuk Antigravity (baca dulu)

- **Jangan berasumsi nama tabel/kolom.** Semua nama di dokumen ini bersifat indikatif. Verifikasi struktur aktual di kode/skema/database, lalu sesuaikan dengan konvensi yang sudah ada.
- **Kerjakan Fase 0 (inspeksi) dan laporkan hasilnya dulu** sebelum menulis kode apa pun. Tunggu konfirmasi.
- **Jangan mengubah logika yang sudah berjalan** (PO, invoice, Special Price, retur, opname). Fitur ini hanya menambah, tidak mengubah perilaku lama.
- Semua operasi stok + HPP harus **atomik** (satu transaksi DB; gagal sebagian = rollback semua).

## 1. Tujuan

Pengguna membeli produk A dalam satuan besar (mis. *Blueberry Carton*) lalu memecahnya menjadi produk B dalam satuan jual (mis. *Blueberry kg*). Dibutuhkan dokumen **Konversi Produk** yang memindahkan stok dan nilai (HPP) dari A ke B.

Keputusan desain (final):
- Dokumen terpisah antara **dua produk berbeda**. Bukan multi-satuan pada satu produk.
- **1 sumber → 1 tujuan** per dokumen.
- Qty hasil diisi manual (hasil timbang). Tidak ada rasio tetap tersimpan di v1.
- Tidak ada edit. Hanya **Batalkan**.

## 2. Fase 0: Inspeksi (wajib, laporkan sebelum coding)

Cek dan laporkan temuan aktual untuk:

1. Tabel produk: kolom stok, HPP rata-rata, satuan, status aktif.
2. Tabel/mekanisme **Stock Move** (mutasi stok): kolom, tipe referensi, cara baris dibuat dari PO/penjualan/retur/opname.
3. Cara **HPP rata-rata tertimbang** dihitung saat barang masuk (PO/penerimaan), termasuk pembulatan dan tipe data.
4. Cara penomoran dokumen yang sudah ada (pola nomor, reset per tahun/bulan, generator).
5. Sistem role/permission: cara membatasi menu per role (admin, gudang, kasir) dan cara menyembunyikan HPP dari role tertentu.
6. Pola reversal yang sudah ada (edit/hapus/retur) untuk stok dan HPP.
7. Pola daftar + pagination dan pola soft-lock/warning stok.
8. Apakah Stock Move sudah punya kolom tipe referensi yang bisa dipakai, atau perlu tipe baru.

## 3. Skema data (indikatif)

Tabel baru `product_conversions`:

| Kolom | Keterangan |
|---|---|
| id, number | Nomor unik, mis. `KNV-YYYY-NNNNN`, ikuti pola penomoran yang ada |
| date | Tanggal konversi |
| source_product_id, source_qty | Produk dan qty yang dipecah |
| target_product_id, target_qty | Produk dan qty hasil |
| source_hpp_snapshot | HPP rata-rata sumber saat posting |
| moved_value | source_hpp_snapshot × source_qty |
| target_stock_before, target_hpp_before | Snapshot stok & HPP tujuan sebelum posting |
| target_hpp_after | HPP tujuan setelah posting |
| notes | Catatan opsional |
| status | `posted` / `cancelled` |
| created_by, created_at | |
| cancelled_by, cancelled_at, cancel_reason | Terisi saat dibatalkan |

Stock Move: setiap konversi menghasilkan **2 baris** (keluar untuk sumber, masuk untuk tujuan) dengan referensi ke nomor konversi. Pembatalan menghasilkan 2 baris pembalik, bukan menghapus baris lama.

## 4. Logika posting

Validasi:
- Sumber ≠ tujuan.
- `source_qty > 0` dan `target_qty > 0`.
- Stok sumber ≥ `source_qty`, jika tidak maka **diblokir** dengan pesan jelas.
- Kunci (lock) baris kedua produk selama transaksi untuk mencegah race condition.

Perhitungan:
- `moved_value = source_hpp × source_qty`
- Stok sumber berkurang `source_qty`. **HPP sumber tidak berubah.**
- Stok tujuan bertambah `target_qty`.
- HPP tujuan baru (rata-rata tertimbang):
  - Jika stok tujuan sebelumnya 0: `moved_value / target_qty`
  - Jika tidak: `(stok_t × hpp_t + moved_value) / (stok_t + target_qty)`
- Pakai pembulatan dan tipe data yang sama dengan logika HPP PO yang sudah ada.

## 5. Pembatalan

- Hanya konversi berstatus `posted` yang bisa dibatalkan. Wajib isi alasan.
- **Diblokir** bila stok tujuan saat ini < `target_qty` (artinya sebagian sudah terjual). Pesan: stok hasil konversi sudah terpakai sebagian.
- Efek: stok sumber `+ source_qty`, stok tujuan `− target_qty`.
- HPP tujuan: balikkan rata-rata tertimbang.
  - Jika sisa stok tujuan setelah pengurangan = 0: pakai `target_hpp_before`.
  - Jika tidak: `(stok_now × hpp_now − moved_value) / (stok_now − target_qty)`.
- Status berubah ke `cancelled`. Data tetap tersimpan dan tampil di daftar.

## 6. UI

**Menu baru: Konversi Produk**
- **Daftar:** kolom nomor, tanggal, sumber → tujuan, qty keluar → qty masuk, status, pembuat. Pagination 80 baris, urut terbaru.
- **Form buat:** tanggal, produk sumber, qty sumber (tampilkan stok tersedia), produk tujuan, qty hasil, catatan.
- Info kewajaran di form: tampilkan "rata-rata X per satuan sumber" (qty hasil ÷ qty sumber). Hanya informasi, tidak memvalidasi.
- **Detail:** semua field + tombol Batalkan (jika `posted`).
- Konfirmasi sebelum simpan dan sebelum batalkan.

**Akses**
- Admin dan gudang: buat dan batalkan.
- Kasir, Finance: tidak punya akses menu.
- **Gudang tidak melihat HPP/nilai** di form, daftar, maupun detail (qty saja). Perhitungan HPP tetap berjalan di backend.

**Stock Move:** tampil sebagai dua baris berpasangan dengan referensi nomor konversi. Qty saja.

**Arus Kas:** tidak terpengaruh (tidak ada perpindahan uang).


## 7. Kriteria uji (acceptance)

1. Stok carton 10 @ HPP 500.000, stok kg 0. Konversi 10 carton → 48 kg: stok carton 0, stok kg 48, HPP kg = 104.166,67 (sesuai pembulatan sistem).
2. Konversi dengan stok kg awal > 0: HPP kg menjadi rata-rata tertimbang yang benar.
3. Konversi dengan qty sumber > stok: ditolak.
4. Sumber = tujuan: ditolak.
5. Batalkan konversi yang stok hasilnya utuh: stok dan HPP kembali seperti sebelum konversi.
6. Batalkan setelah sebagian kg terjual: ditolak dengan pesan jelas.
7. Stock Move menampilkan 2 baris saat posting dan 2 baris pembalik saat batal.
8. Role gudang tidak melihat HPP/nilai di halaman konversi; kasir tidak melihat menu.
9. Gagal di tengah proses (simulasi error): tidak ada perubahan stok parsial.
10. Fitur lama (PO, penjualan, retur, opname) berperilaku sama seperti sebelumnya.

## 8. Format laporan balik

1. Hasil inspeksi Fase 0 (nama tabel/kolom aktual, temuan penting, hal yang berbeda dari asumsi spec).
2. Rencana perubahan: file yang akan diubah/dibuat, skema migrasi.
3. Setelah disetujui: implementasi, lalu ringkasan hasil uji per poin di bagian 8.
