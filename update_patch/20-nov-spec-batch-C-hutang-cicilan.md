# Spec Batch C — Pembayaran Hutang (Disamakan dengan Piutang)

Ikuti **Aturan Umum** di `spec-batch-A-perbaikan-cepat.md`.

**Tujuan:** proses pembayaran hutang dibuat **sama proper dan seragam** dengan proses pembayaran piutang (cicilan bertahap). Pendekatannya adalah **mencerminkan implementasi piutang**, bukan merancang ulang.

## Langkah 0 — Inspeksi (wajib, laporkan ringkasannya dulu)

Pelajari implementasi pembayaran piutang yang sudah ada dan laporkan:
- tabel dan relasi untuk pembayaran cicilan piutang (termasuk penomoran seperti `PAY-YYYY-MM-NNNNN`);
- alur modal cicilan (tombol ikon garis tiga): field, validasi, riwayat pembayaran;
- bagaimana pembayaran dicatat ke Arus Kas dan kategorinya;
- soft-lock saat edit/hapus invoice yang sudah ada pembayaran;
- template import piutang outstanding dan perubahannya untuk cicilan;
- fitur export PDF piutang terpilih (checkbox);
- bagaimana data pembayaran lama (sebelum fitur cicilan) diperlakukan/dimigrasi.

Lalu periksa kondisi hutang saat ini (tabel hutang, alur tombol "Bayar", data pembayaran lama) dan laporkan perbedaannya.

## C1. Pembayaran cicilan hutang

Replikasi perilaku piutang untuk hutang:
- Tombol ikon garis tiga di setiap baris hutang membuka **modal pembayaran cicilan** dengan riwayat pembayaran.
- Pembayaran **bebas** (kapan saja, nominal berapa saja), sisa hutang ditampilkan, tanggal jatuh tempo tetap ditampilkan.
- Total pembayaran **tidak boleh melebihi** sisa hutang. Validasi di backend.
- Tanpa denda keterlambatan.
- Tabel pembayaran hutang terpisah dengan penomoran sendiri yang mengikuti pola piutang (mis. prefix berbeda agar tidak bentrok).
- Setiap pembayaran dicatat sebagai **kas keluar** di Arus Kas (mis. kategori "Pelunasan Hutang") mengikuti pola piutang.
- Status hutang otomatis menjadi lunas ketika sisa = 0.
- **Sembunyikan tombol "Bayar" lama** (seperti piutang). Modal cicilan menjadi satu-satunya jalur pembayaran.
- Migrasi data pembayaran hutang lama: ikuti pendekatan yang dipakai saat migrasi piutang. Jalankan di clone DB dulu dan laporkan hasilnya.

## C2. Soft-lock pada PO yang sudah ada pembayaran

- Edit atau hapus PO yang hutangnya sudah memiliki pembayaran: tampilkan **modal peringatan soft-lock** (sama polanya dengan invoice piutang).
- Koordinasikan dengan Batch B: pengurangan qty/penghapusan item PO diarahkan ke Retur Pembelian.

## C3. Tombol Delete hutang

- Hanya untuk hutang hasil **import outstanding**, bukan hutang yang terbentuk dari PO.
- Validasi di backend, tombol di UI mengikuti. Jika sudah ada pembayaran, tampilkan modal peringatan sebelum menghapus.

## C4. Template import hutang outstanding

- Sesuaikan template import hutang outstanding agar mendukung pembayaran cicilan, **mengikuti perubahan yang sama seperti template piutang outstanding** (mis. kolom total, sudah dibayar, sisa, jatuh tempo).
- Sertakan validasi baris dan pesan error yang jelas. Perbarui template yang bisa diunduh.

## C5. Export PDF hutang terpilih

- Tambah **checkbox di sisi kiri nomor PO/hutang** pada halaman Hutang, plus tombol **Export PDF** untuk hutang yang dipilih saja. Cerminkan fitur export piutang terpilih (tata letak PDF, nama file, kolom disesuaikan untuk hutang: vendor, no. PO, total, dibayar, sisa, jatuh tempo).

## C6. Hak akses halaman Hutang

> **KONFIRMASI DIPERLUKAN:** sesuai instruksi pemilik, akses halaman Hutang adalah **admin dan gudang**. Role lain (termasuk finance dan kasir) tidak bisa mengakses.

- Tetapkan lewat **Otoritas Akses** (satu tempat konfigurasi, jangan hardcode tersebar). Jika nanti diubah, cukup ubah konfigurasi.
- Validasi akses di backend untuk semua endpoint hutang, termasuk modal cicilan, delete, export PDF, dan template import.
- Card Hutang di dashboard hanya tampil untuk role yang punya akses ke halaman ini (lihat Batch A7).
- Pastikan role tanpa akses tidak melihat error toast apa pun (tidak ada pemanggilan API hutang dari halaman lain untuk role tersebut).

## Checklist Pengujian (di clone DB)
- Bayar cicilan beberapa kali → riwayat, sisa, dan Arus Kas (kas keluar) benar; status lunas otomatis.
- Pembayaran melebihi sisa ditolak.
- Delete hutang PO ditolak; delete hutang outstanding berhasil (dengan peringatan jika ada pembayaran).
- Edit/hapus PO yang sudah ada pembayaran → soft-lock muncul.
- Import template hutang outstanding yang baru berhasil, termasuk baris yang salah.
- Export PDF hutang terpilih menghasilkan dokumen benar.
- Login sebagai admin dan gudang → akses sesuai. Login sebagai finance dan kasir → tidak ada akses, tidak ada error toast.
