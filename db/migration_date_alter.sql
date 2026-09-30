-- =============================================
-- Migration Step 2: ALTER Tipe Kolom ke DATE
-- Tabel: sales_invoices & purchase_orders
-- Kolom: date, due_date (VARCHAR -> DATE)
-- 
-- PRASYARAT: Jalankan migration_date_normalize.sql lebih dulu
--            dan verifikasi hasilnya sebelum menjalankan ini.
-- 
-- Development: Jalankan SETELAH migration_date_normalize.sql
-- Production : Jalankan LANGSUNG tanpa step normalize
--              (tabel production masih kosong, tidak ada data)
-- 
-- Idempoten: Ya — cek tipe kolom saat ini sebelum ALTER.
--   Jika kolom sudah DATE, ALTER ini aman dijalankan ulang
--   (MySQL menerima MODIFY COLUMN ke tipe yang sama tanpa error).
-- =============================================

-- Cek tipe kolom saat ini (opsional, untuk konfirmasi manual):
-- SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_SCHEMA = DATABASE()
--   AND TABLE_NAME IN ('sales_invoices', 'purchase_orders')
--   AND COLUMN_NAME IN ('date', 'due_date');


-- -------------------------------------------------
-- ALTER: sales_invoices
-- -------------------------------------------------
ALTER TABLE sales_invoices
  MODIFY COLUMN `date`     DATE NULL,
  MODIFY COLUMN `due_date` DATE NULL;

-- Verifikasi:
-- DESCRIBE sales_invoices;
-- Kolom 'date' dan 'due_date' harus menunjukkan Type: date


-- -------------------------------------------------
-- ALTER: purchase_orders
-- -------------------------------------------------
ALTER TABLE purchase_orders
  MODIFY COLUMN `date`     DATE NULL,
  MODIFY COLUMN `due_date` DATE NULL;

-- Verifikasi:
-- DESCRIBE purchase_orders;
-- Kolom 'date' dan 'due_date' harus menunjukkan Type: date


-- =============================================
-- Catatan penting setelah ALTER:
-- - Kolom 'date' di sales_invoices yang sebelumnya menyimpan ISO
--   timestamp (mis. '2026-06-12T03:04:20.117Z') sudah dinormalisasi
--   ke '2026-06-12' di step 1 — MySQL akan menerimanya sebagai DATE.
-- - String '' (kosong) sudah diubah ke NULL di step 1 — MySQL tidak
--   bisa menyimpan '' di kolom DATE, tapi NULL valid karena NULLABLE.
-- - Kolom paid_date sudah DATE sejak awal — tidak terpengaruh.
-- - Tidak ada foreign key pada kolom date/due_date — ALTER aman.
-- =============================================
