# Spec: Pembayaran Cicilan Bertahap (Invoice Kredit)

## 0. Aturan Kerja (wajib dibaca dulu)

1. **Jangan asumsikan nama tabel/kolom.** Semua nama tabel, kolom, dan relasi di dokumen ini bersifat konseptual. Verifikasi nama aktual di database dan kode sebelum menulis apa pun.
2. **Jangan menulis kode atau migrasi sebelum laporan inspeksi (Bagian 1) disetujui.**
3. **Semua simulasi dan testing dijalankan di database klon, bukan production.**
4. **Logika fee per item, PPN (dihitung setelah diskon), dan HPP tidak boleh berubah.** Cicilan hanya bekerja di atas total invoice yang sudah final.
5. Gunakan pola yang sudah ada: PK `INT AUTO_INCREMENT` + nomor referensi sebagai kolom display terpisah, soft-lock dengan modal konfirmasi (bukan hard lock), dan pembersihan field sensitif berdasarkan role di sisi backend.

---

## 1. Langkah Awal: Inspeksi (laporkan hasilnya, lalu tunggu persetujuan)

Periksa dan laporkan ringkas:

- [ ] Struktur tabel invoice (header dan item), termasuk kolom total, status, tipe pembayaran, jatuh tempo, dan relasi ke customer.
- [ ] Tabel tipe pembayaran (Tunai, Transfer, Kredit 1/7/14/30 Hari): struktur, dan bagaimana jatuh tempo dihitung dari tipe Kredit saat ini.
- [ ] Apakah sudah ada pelacakan pembayaran untuk invoice Kredit (status lunas/belum, kolom dibayar, dsb.).
- [ ] **Modul cash management**: tabel yang dipakai, dan bagaimana invoice Tunai/Transfer/Kredit saat ini diposting ke kas/bank. Pastikan tidak ada risiko pencatatan ganda saat pembayaran cicilan dicatat.
- [ ] Logika reversal edit/delete invoice yang sudah ada (stok, HPP, kas), agar integrasi dengan pembayaran konsisten.
- [ ] Sistem role dan middleware otorisasi (role administrator dan finance).
- [ ] Pola penomoran dokumen yang ada (contoh `INV-YYYY-MM-NNNNN`) untuk dijadikan acuan nomor bukti pembayaran.
- [ ] Pola soft-lock modal yang sudah dipakai (contoh toggle PPN) agar bisa dipakai ulang.
- [ ] Halaman daftar invoice dan laporan yang menampilkan status pembayaran.

Dari hasil inspeksi, ajukan: **skema tabel perubahan, migrasi, dan rencana implementasi bertahap.** 

---

## 2. Ringkasan Fitur

Invoice bertipe **Kredit** dapat dibayar **bertahap dan bebas**: pelanggan boleh membayar kapan saja dan berapa saja, sisa tagihan berkurang setiap pembayaran, sampai lunas. Jatuh tempo tetap ditampilkan.

Fitur ini adalah **tambahan di atas tipe Kredit yang sudah ada**, bukan tipe pembayaran baru. Tidak ada jadwal termin tetap.

## 3. Aturan Bisnis

| Aturan | Ketentuan |
|---|---|
| Model pembayaran | Bebas: tanggal dan nominal ditentukan saat pembayaran dicatat |
| DP | Opsional. Bisa diisi saat membuat invoice Kredit. Diperlakukan sebagai **pembayaran pertama** di tabel pembayaran yang sama (ditandai sebagai DP), bukan logika terpisah |
| Denda / bunga | Tidak ada |
| Overpayment | Tidak boleh. Satu pembayaran tidak boleh melebihi **sisa tagihan** invoice. Nominal harus > 0 |
| Sisa tagihan | `total invoice - total pembayaran aktif` (tidak termasuk yang di-void). **Dihitung, bukan disimpan sebagai angka terpisah yang bisa tidak sinkron** (atau jika disimpan untuk performa, wajib dihitung ulang dalam transaksi yang sama dengan setiap perubahan pembayaran) |
| Status invoice | **Belum Lunas** (sisa > 0), **Lunas** (sisa = 0) |
| Penanda keterlambatan | Jika sisa > 0 dan tanggal sudah melewati jatuh tempo, tampilkan penanda **Lewat Jatuh Tempo**. Hanya penanda tampilan, tanpa denda |
| Tanggal pembayaran | Default hari ini, tidak boleh di masa depan |
| Pembatalan pembayaran | Pembayaran salah di-**void** (status batal + alasan + siapa + kapan), **bukan dihapus permanen** |
| Pembulatan | Semua nominal dalam Rupiah bulat; validasi tidak boleh menyisakan pecahan |

## 4. Hak Akses

- Mencatat pembayaran, void pembayaran, dan melihat monitoring piutang: **hanya Administrator dan Finance**.
- Pembatasan wajib diterapkan **di backend (middleware/endpoint)**, bukan hanya disembunyikan di UI.
- Role lain tetap dapat melihat invoice seperti sekarang, tanpa kontrol cicilan.

## 5. Alur Fitur

1. **Buat invoice**: pilih tipe Kredit. Opsional isi DP. Jatuh tempo dihitung dari tenor Kredit seperti sekarang.
2. **Catat pembayaran** (Admin/Finance): dari daftar invoice atau detail invoice. Input tanggal, nominal, metode (Tunai/Transfer), dan catatan. Sistem memvalidasi nominal <= sisa tagihan, menyimpan pembayaran dengan nomor bukti, lalu memperbarui sisa tagihan dan status.
3. **Void pembayaran** (Admin/Finance): wajib isi alasan. Sisa tagihan dan status dihitung ulang, dan posting kas dibalik.
4. **Monitoring**: daftar piutang dengan sisa tagihan, jatuh tempo, penanda Lewat Jatuh Tempo, dan ringkasan per pelanggan. Dapat difilter berdasarkan pelanggan dan status.

> Pencetakan bukti pembayaran **di luar lingkup** fitur ini.

## 6. Integrasi Cash Management

- Setiap pembayaran aktif harus tercatat ke modul kas/bank mengikuti pola posting yang sudah ada (hasil inspeksi Bagian 1).
- Void pembayaran harus membuat **reversal** di kas, bukan menghapus entri.
- Cek khusus: pastikan invoice Kredit tidak sudah memposting kas saat dibuat. Jika ya, hindari pencatatan ganda dan laporkan temuannya.

## 7. Soft-lock: Edit / Hapus Invoice yang Sudah Punya Pembayaran

- Saat user mengedit atau menghapus invoice Kredit yang sudah memiliki pembayaran aktif, tampilkan **modal peringatan** yang menjelaskan dampaknya (jumlah pembayaran, total dibayar). Setelah konfirmasi eksplisit, lanjutkan sesuai logika reversal yang sudah ada.
- Usulan perilaku (konfirmasi sebelum implementasi):
  - Edit yang membuat total invoice **lebih kecil dari total pembayaran aktif** ditolak dengan pesan jelas.
  - Hapus invoice: pembayaran aktif di-void otomatis (alasan: invoice dihapus) beserta reversal kas, dalam satu transaksi database.
- Gunakan komponen/pola modal yang sama dengan soft-lock yang sudah ada.

## 8. Struktur Data (konseptual, final setelah inspeksi)

Tabel pembayaran invoice, minimal berisi:

- PK `INT AUTO_INCREMENT` + nomor bukti pembayaran sebagai kolom display (format mengikuti pola penomoran yang ada, mis. `PAY-YYYY-MM-NNNNN`)
- relasi ke invoice dan ke user pencatat
- tanggal, nominal, metode, catatan, penanda DP
- status (aktif / void), alasan void, user dan waktu void
- relasi ke entri kas bila skema kas membutuhkannya

Pilih nama tabel/kolom yang konsisten dengan konvensi skema existing. Sertakan migrasi yang aman dijalankan ulang (idempotent) dan rencana rollback.

## 9. Titik Rawan

- Keselarasan sisa tagihan: satu sumber kebenaran, dihitung dalam transaksi database.
- Race condition: dua pembayaran bersamaan pada invoice yang sama tidak boleh melewati sisa tagihan (gunakan transaksi + row lock).
- Void pembayaran pada invoice yang sebelumnya Lunas: status kembali ke Belum Lunas.
- Invoice lama (sebelum fitur ini): tentukan perlakuan data existing (mis. invoice Kredit lama dianggap tanpa pembayaran) dan laporkan di rencana migrasi.

## 10. Kriteria Penerimaan (diuji di database klon)

- [ ] Invoice Kredit tanpa DP: sisa = total, status Belum Lunas, jatuh tempo tampil.
- [ ] Invoice Kredit dengan DP: DP tercatat sebagai pembayaran pertama, sisa benar.
- [ ] Beberapa pembayaran bebas (nominal dan tanggal berbeda) mengurangi sisa dengan benar sampai Lunas.
- [ ] Pembayaran > sisa tagihan ditolak; nominal 0 atau negatif ditolak.
- [ ] Void pembayaran: sisa dan status dihitung ulang, entri kas dibalik, jejak tetap ada.
- [ ] Lewat Jatuh Tempo muncul hanya jika sisa > 0 dan tanggal melewati jatuh tempo; tidak ada denda.
- [ ] Role selain Administrator/Finance ditolak di backend saat mencatat/void pembayaran (uji langsung ke endpoint).
- [ ] Edit/hapus invoice berpembayaran memunculkan modal soft-lock dan berperilaku sesuai Bagian 7.
- [ ] Total fee, PPN, dan HPP invoice tidak berubah oleh fitur ini.
- [ ] Monitoring piutang menampilkan data yang sesuai dan konsisten dengan total pembayaran.

## 11. Di Luar Lingkup

Denda/bunga, jadwal termin tetap, cicilan untuk PO supplier (hutang), pencetakan bukti pembayaran, dan notifikasi jatuh tempo otomatis.

## 12. Output yang Diminta dari Antigravity

1. Laporan inspeksi (Bagian 1) dan usulan skema/migrasi, lalu **berhenti dan tunggu persetujuan**.
2. Setelah disetujui: implementasi bertahap (migrasi, backend + validasi + otorisasi, integrasi kas, UI, monitoring), dengan ringkasan perubahan per tahap.
3. Hasil pengujian sesuai Bagian 10 di database klon.
