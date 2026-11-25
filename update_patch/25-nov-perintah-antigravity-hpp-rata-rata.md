# PERINTAH: HPP Master Produk Otomatis (Rata-rata Tertimbang) dari PO dan Konversi Produk

## 0. Aturan (baca dulu)

- **Jangan berasumsi nama tabel/kolom/status.** Verifikasi struktur aktual di kode dan database, lalu ikuti konvensi yang ada.
- **Kerjakan Fase 0 (inspeksi, read-only) dan laporkan dulu.** Jangan ubah apa pun sebelum ada konfirmasi.
- Jangan mengubah perilaku fitur lain (penjualan, retur penjualan, opname, Special Price) di luar yang disebut di sini.
- Semua perubahan stok + HPP harus **atomik** (satu transaksi DB, gagal sebagian = rollback semua) dan memakai **row lock** pada produk yang terlibat.
- **Jangan menjalankan backfill/penulisan ulang HPP historis.** Data lama dibiarkan.

## 1. Tujuan

HPP di **master produk** harus ter-update otomatis, langsung saat stok masuk, memakai **rata-rata tertimbang**, dari dua sumber:

1. **Input pembelian / Purchase Order** (barang masuk).
2. **Konversi Produk** (produk tujuan menerima stok; lihat `spec-konversi-produk.md`).

## 2. Rumus

**Stok masuk** (qty_in dengan biaya satuan unit_cost):

- Jika `stok_lama <= 0`: `hpp_baru = unit_cost`
- Jika tidak: `hpp_baru = (stok_lama × hpp_lama + qty_in × unit_cost) / (stok_lama + qty_in)`

**Pembalikan** (saat dokumen dibatalkan/diedit), dengan `stok_now` dan `hpp_now` saat itu:

- `sisa = stok_now − qty_in`
- Jika `sisa <= 0`: `hpp = hpp_sebelum` (snapshot yang disimpan saat posting)
- Jika tidak: `hpp = (stok_now × hpp_now − qty_in × unit_cost) / sisa`
- Jika `stok_now < qty_in` (stok sudah terpakai): **tolak** dengan pesan jelas.

**Stok keluar** (penjualan, dsb.) **tidak mengubah HPP rata-rata**. Jangan diubah.

`unit_cost`:
- **PO:** harga satuan **setelah diskon, sebelum PPN**. Jika struktur PO berbeda (mis. diskon/biaya tambahan di level dokumen), laporkan dulu di Fase 0 dan usulkan cara yang paling sederhana. Alokasi ongkir/biaya lain tidak termasuk di versi ini.
- **Konversi:** `(HPP rata-rata sumber × qty sumber) / qty hasil`.

## 3. Implementasi: satu helper bersama

Buat **satu fungsi/service terpusat** (nama sesuai konvensi), dipakai oleh PO dan Konversi, supaya rumus tidak terduplikasi:

- `applyIncomingCost(productId, qtyIn, unitCost)` → mengunci produk, menghitung HPP baru, menulis stok + HPP ke master, mengembalikan snapshot `{stok_sebelum, hpp_sebelum, hpp_sesudah}`.
- `reverseIncomingCost(productId, qtyIn, unitCost, hppSebelum)` → pembalikan sesuai aturan di bagian 2.

Snapshot (`stok_sebelum`, `hpp_sebelum`, `hpp_sesudah`) disimpan di dokumen sumber (item PO / dokumen konversi) agar pembalikan akurat. Tambahkan kolom jika belum ada, dengan nama sesuai konvensi.

## 4. Titik integrasi

**A. Purchase Order**
- Panggil helper **pada saat stok benar-benar masuk** (status/aksi yang menambah stok; verifikasi alurnya di Fase 0), bukan saat draft.
- **Edit PO** yang sudah menambah stok = pembalikan item lama + penerapan item baru dalam satu transaksi.
- **Batal/hapus PO** = pembalikan. Jika ditolak karena stok sudah terpakai, tampilkan pesan yang jelas dan jangan ubah data.
- Jika ada **retur pembelian**: laporkan perilakunya sekarang di Fase 0; ikuti logika pembalikan bila relevan, tapi minta konfirmasi dulu.

**B. Konversi Produk**
- Saat posting: stok sumber berkurang (HPP sumber tidak berubah), lalu panggil helper untuk produk tujuan dengan `qtyIn = qty hasil` dan `unitCost = moved_value / qty hasil`.
- Saat pembatalan: stok sumber kembali, panggil `reverseIncomingCost` untuk produk tujuan.
- Detail form, penomoran, dan Stock Move mengikuti `spec-konversi-produk.md`.

## 5. Revisi akses (menggantikan spec-konversi-produk.md bagian 6 dan uji no. 8)

- **Role gudang BOLEH melihat HPP/nilai** di form PO, form Konversi, daftar, dan detail, karena gudang yang menginput pembelian dan melakukan konversi.
- **Role kasir tetap TIDAK boleh** melihat HPP atau harga beli.
- Hak buat/batal Konversi tetap: admin dan gudang. Kasir tanpa akses.
- Gunakan mekanisme permission pusat yang sudah ada. Jangan membuat pengecualian ad hoc per halaman.

## 6. Fase 0: Inspeksi (read-only, laporkan)

1. Tabel produk: kolom stok, kolom HPP, **tipe data dan presisi** kolom HPP (jika integer/tanpa desimal, usulkan DECIMAL berpresisi cukup dan laporkan dulu sebelum migrasi).
2. Apakah sudah ada logika update HPP saat PO sekarang? Bagaimana cara kerjanya (rata-rata, harga terakhir, manual)?
3. Alur status PO: kapan stok bertambah (draft/diterima/posted), serta mekanisme edit, batal, hapus.
4. Struktur harga di PO: harga satuan, diskon, PPN, biaya tambahan; di level item atau dokumen.
5. Ada/tidaknya retur pembelian dan efeknya pada stok/HPP.
6. Cara invoice penjualan mengambil HPP (snapshot per item) dan pastikan tidak terdampak perubahan ini.
7. Apakah HPP di master produk bisa diedit manual dari UI, dan apakah import produk menulis HPP.
8. Pola transaksi DB dan row lock yang sudah dipakai di kode.
9. Pola permission untuk menyembunyikan HPP per role.

Laporkan temuan, hal yang berbeda dari asumsi dokumen ini, dan rencana perubahan (file + migrasi). **Tunggu persetujuan sebelum implementasi.**

## 7. Kriteria uji

Angka berikut dihitung dengan rumus di bagian 2 (sesuaikan dengan pembulatan sistem).

1. Stok 10 @ 10.000, PO masuk 5 @ 13.000 → stok 15, **HPP 11.000**.
2. Stok 0 (atau negatif), PO masuk 5 @ 13.000 → **HPP 13.000**.
3. Lanjutan no. 1: batalkan PO tersebut → stok 10, **HPP kembali 10.000**.
4. Edit PO (qty 5 → 8, harga 13.000 → 12.000) pada stok awal 10 @ 10.000 → HPP sama dengan hasil PO baru langsung, tanpa sisa dari versi lama.
5. Batalkan PO ketika sebagian stok sudah terjual hingga stok < qty PO → ditolak, data tidak berubah.
6. Penjualan tidak mengubah HPP master produk.
7. Konversi 10 carton (@ 500.000) → 48 kg, stok kg 0 → **HPP kg 104.166,67**.
8. Konversi 10 carton (@ 500.000) → 48 kg, stok kg 20 @ 100.000 → stok kg 68, **HPP kg ≈ 102.941,18**.
9. Batalkan konversi no. 8 (stok hasil utuh) → stok dan HPP kg kembali (20 @ 100.000); stok carton kembali 10.
10. Batalkan konversi setelah sebagian kg terjual → ditolak.
11. Error di tengah proses (simulasi) → tidak ada perubahan stok/HPP parsial.
12. Gudang melihat HPP di PO dan Konversi; kasir tidak melihat HPP di mana pun.
13. Invoice penjualan lama dan snapshot HPP per item tidak berubah.

## 8. Format laporan balik

1. Hasil Fase 0 (aktual vs asumsi).
2. Rencana perubahan dan migrasi.
3. Setelah disetujui dan diimplementasi: ringkasan hasil uji per nomor di bagian 7.
