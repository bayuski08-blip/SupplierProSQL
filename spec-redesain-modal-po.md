# Spec: Redesain Modal "Buat Purchase Order"

Perubahan ini hanya pada tampilan (layout) dan cara menambah produk di modal Buat Purchase Order. Logika bisnis PO tidak boleh berubah.

## Langkah 0: verifikasi dulu sebelum mengubah apa pun

Jangan mengandalkan nama di spec ini. Periksa kode dan database yang sebenarnya, lalu laporkan temuanmu sebelum mulai mengedit:

1. Temukan file frontend yang merender modal "Buat Purchase Order" (HTML, JS, dan CSS-nya). Cek juga apakah modal yang sama dipakai untuk edit PO.
2. Temukan fungsi yang saat ini menangani dropdown "Pilih Produk..." dan tombol "Tambah Item", serta fungsi yang menghitung Total Item dan Grand Total.
3. Cek nama sebenarnya dari field produk: nama, stok, dan harga beli yang dipakai flow tambah item saat ini. Pakai field yang sama, jangan membuat field baru.
4. Cek endpoint yang dipakai untuk memuat daftar produk di modal ini dan apakah daftarnya sudah ada di memori frontend.
5. Cek nama sebenarnya dari label dan tombol footer modal (Batal, Simpan, dan sejenisnya).

## Yang TIDAK boleh berubah

- Logika perhitungan: subtotal, Total Item, Grand Total, dan perhitungan PPN/diskon jika ada.
- Perilaku simpan PO: stok selalu bertambah, dan tipe Kredit otomatis membuat hutang.
- Payload dan endpoint yang dikirim saat menyimpan PO.
- Sumber data dropdown Vendor dan Tipe Pembayaran (tetap dari master data yang sekarang).
- Penomoran PO otomatis dan field Tanggal.
- Tampilan desktop halaman lain. Perubahan hanya di modal ini.

## 1. Perubahan layout bagian atas

Susunan baru, dua kolom sama lebar:

- Baris 1: **No. PO (Otomatis)** di kiri, **Tanggal** di kanan (tidak berubah).
- Baris 2: **Vendor** di kiri, **Tipe Pembayaran** di kanan.

Tipe Pembayaran dipindah dari bagian bawah modal ke kanan dropdown Vendor. Hapus kolom Tipe Pembayaran di posisi lamanya. Nilai default dan isi opsinya tetap sama seperti sekarang.

## 2. Perubahan Daftar Item

### Header dan tabel

- Judul "Daftar Item" berdiri sendiri di atas tabel. Hapus dropdown "Pilih Produk..." dan tombol "Tambah Item" dari baris judul.
- Kolom tabel: **Produk | Qty | Harga Beli | Subtotal | (aksi hapus)**.
- Tiap baris item punya ikon hapus di kolom paling kanan. Klik menghapus baris itu dan Total Item serta Grand Total dihitung ulang.
- Qty dan Harga Beli tetap bisa diedit di baris, seperti perilaku sekarang. Subtotal dihitung ulang saat keduanya berubah.
- Kolom Subtotal rata kanan.

### Baris tambah produk di bawah tabel

Satu baris terakhir di dalam tabel (setelah baris item terakhir) berisi **kolom pencarian produk**:

- Berupa input teks dengan ikon cari di kiri.
- Placeholder: `Ketik nama produk untuk menambah...`
- Lebar maksimal sekitar 360px, rata kiri.
- Jika belum ada item, tabel menampilkan baris pencarian ini saja. Teks "Belum ada item." boleh ditampilkan di atasnya.

### Perilaku pencarian (autocomplete)

- Saat user mengetik, daftar hasil muncul di bawah input dan menyaring sesuai keyword.
- Pencocokan: tidak membedakan huruf besar/kecil, dan mencocokkan keyword di bagian mana pun dari nama produk (bukan hanya awalan).
- Bagian nama yang cocok di-highlight di hasil.
- Tiap hasil menampilkan nama produk di kiri, dan di kanan stok serta harga beli (format: `Stok 14 · Rp 92.000`). Pakai field stok dan harga beli yang diverifikasi di Langkah 0. Untuk harga beli, gunakan sumber yang sama dengan yang dipakai dropdown lama saat mengisi harga otomatis.
- Batasi hasil yang ditampilkan maksimal 8 item, dengan area daftar yang bisa di-scroll jika perlu. Bagian bawah daftar menampilkan jumlah hasil dan petunjuk keyboard: `N hasil · ↑↓ pilih · Enter tambah`.
- Jika tidak ada yang cocok, tampilkan `Produk tidak ditemukan`.
- Daftar harus tampil sebagai dropdown yang menimpa (overlay) di atas konten di bawahnya, tidak memotong atau mendorong modal. Pastikan tidak terpotong oleh `overflow` modal atau tabel.
- Cari di sisi frontend dari daftar produk yang sudah dimuat jika daftarnya sudah ada di memori (lihat Langkah 0 poin 4). Tambahkan debounce sekitar 150ms. Jika daftar produk tidak dimuat penuh di frontend (misalnya sudah dipaginasi), laporkan dulu sebelum memutuskan memakai pencarian lewat API.

### Interaksi

- Mouse: klik hasil untuk menambah.
- Keyboard: ↑ dan ↓ memindah sorotan, Enter menambah item yang disorot, Esc menutup daftar. Hasil pertama otomatis tersorot saat daftar muncul.
- Setelah produk dipilih:
  - Baris baru muncul di tabel dengan Qty = 1 dan Harga Beli terisi otomatis (default dari produk).
  - Input pencarian dikosongkan dan fokus tetap di sana, supaya user bisa langsung mengetik produk berikutnya.
  - Total Item dan Grand Total dihitung ulang.
- **Produk yang sudah ada di tabel:** jangan buat baris ganda. Tambahkan Qty baris yang sudah ada sebanyak 1. Beri highlight singkat pada baris itu supaya user tahu yang bertambah.
- Klik di luar area pencarian menutup daftar.

## 3. Area total

- Total Item dan Grand Total berada di kanan bawah tabel, selebar sekitar 50% dari lebar konten, rata kanan.
- Gaya: kartu abu-abu muda, Grand Total tebal dengan warna aksen.
- Nilai dan rumusnya tetap memakai logika yang sudah ada.

## 4. Footer modal

- Pertahankan tombol footer yang sudah ada saat ini beserta labelnya (hasil Langkah 0 poin 5), ditempatkan rata kanan dengan garis pemisah di atasnya.
- Jika saat ini belum ada tombol Batal, tambahkan Batal (menutup modal) di samping tombol simpan.

## 5. Responsif

- Di layar sempit, dua kolom pada baris Vendor dan Tipe Pembayaran boleh menumpuk jadi satu kolom.
- Tabel item boleh di-scroll horizontal di dalam wadahnya sendiri, tanpa membuat body modal scroll ke samping.
- Dropdown hasil pencarian tidak boleh melebihi lebar layar.

## Kriteria selesai (cek sebelum melapor)

- [ ] Tipe Pembayaran sejajar di kanan Vendor, dan posisi lamanya sudah dihapus.
- [ ] Dropdown "Pilih Produk..." dan tombol "Tambah Item" di baris judul sudah hilang.
- [ ] Baris pencarian produk ada di bawah tabel dan mencari berdasarkan keyword di bagian mana pun dari nama produk.
- [ ] Hasil menampilkan stok dan harga beli, dengan highlight pada bagian yang cocok.
- [ ] Navigasi keyboard (↑ ↓ Enter Esc) dan klik mouse berfungsi.
- [ ] Setelah memilih produk, baris baru muncul, input kosong, dan fokus tetap di input.
- [ ] Produk yang sama menambah Qty, tidak membuat baris ganda.
- [ ] Ikon hapus per baris berfungsi dan total terhitung ulang.
- [ ] Total Item dan Grand Total sama dengan hasil sebelum perubahan untuk data yang sama.
- [ ] Menyimpan PO tetap menambah stok, dan Kredit tetap membuat hutang.
- [ ] Modal tidak memerlukan refresh browser untuk menampilkan produk yang baru ditambahkan.

## Aturan pengujian

Uji semua skenario di atas pada database hasil kloning, bukan database produksi.

## Format laporan

Setelah selesai, laporkan:
1. Daftar file yang diubah.
2. Hasil verifikasi Langkah 0 (nama field dan sumber data yang dipakai).
3. Hal yang berbeda dari spec ini beserta alasannya.
