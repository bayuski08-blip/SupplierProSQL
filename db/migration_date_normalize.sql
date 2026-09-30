-- =============================================
-- Migration Step 1: Normalisasi Data Tanggal
-- Tabel: sales_invoices & purchase_orders
-- Kolom: date, due_date
-- 
-- Tujuan: Konversi semua nilai ke format YYYY-MM-DD
--         (atau NULL) agar siap untuk ALTER ke tipe DATE.
-- 
-- Jalankan: Development ONLY (production masih kosong)
-- Aman dijalankan ulang: Ya (idempoten karena UPDATE hanya
--   memengaruhi baris yang masih berformat lama)
-- 
-- Hasil audit sebelum migrasi ini:
--   sales_invoices.date  : 21 baris ISO timestamp, 1 baris YYYY-MM-DD
--   sales_invoices.due_date : 4 baris YYYY-MM-DD, 17 baris '' (kosong)
--   purchase_orders.date    : 9 baris YYYY-MM-DD (sudah bersih)
--   purchase_orders.due_date: 2 baris YYYY-MM-DD, 7 baris '' (kosong)
--   Format DD/MM/YYYY       : TIDAK DITEMUKAN (tidak perlu STR_TO_DATE)
--   Foreign keys pada kolom ini: TIDAK ADA
-- =============================================

-- -------------------------------------------------
-- 1. sales_invoices.date
--    Masalah: ISO 8601 timestamp (mis. '2026-09-28T05:50:15.528Z')
--    Penanganan: Ambil 10 karakter pertama (YYYY-MM-DD)
--    Baris dengan format sudah benar tidak terpengaruh
-- -------------------------------------------------
UPDATE sales_invoices
SET `date` = LEFT(`date`, 10)
WHERE `date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   OR `date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}';

-- Verifikasi: hasilnya harus 0
-- SELECT COUNT(*) FROM sales_invoices WHERE `date` LIKE '%T%' OR `date` LIKE '% %';


-- -------------------------------------------------
-- 2. sales_invoices.due_date
--    Masalah: 17 baris berisi string kosong ''
--    Keputusan: konversi ke NULL
-- -------------------------------------------------
UPDATE sales_invoices
SET due_date = NULL
WHERE due_date = '' OR due_date IS NULL;

-- Verifikasi: hasilnya harus 0
-- SELECT COUNT(*) FROM sales_invoices WHERE due_date = '';


-- -------------------------------------------------
-- 3. purchase_orders.date
--    Audit: sudah semua YYYY-MM-DD, tidak perlu update
-- -------------------------------------------------


-- -------------------------------------------------
-- 4. purchase_orders.due_date
--    Masalah: 7 baris berisi string kosong ''
--    Keputusan: konversi ke NULL
-- -------------------------------------------------
UPDATE purchase_orders
SET due_date = NULL
WHERE due_date = '' OR due_date IS NULL;

-- Verifikasi: hasilnya harus 0
-- SELECT COUNT(*) FROM purchase_orders WHERE due_date = '';


-- -------------------------------------------------
-- Verifikasi akhir sebelum lanjut ke Step 2:
-- -------------------------------------------------
-- SELECT DISTINCT `date` FROM sales_invoices ORDER BY `date`;
-- SELECT DISTINCT due_date FROM sales_invoices ORDER BY due_date;
-- SELECT DISTINCT `date`, due_date FROM purchase_orders ORDER BY `date`;
