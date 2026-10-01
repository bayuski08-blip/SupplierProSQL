-- Migrasi: Tambah field npwp_name dan npwp_address ke tabel customers
-- Dibuat: 2026-10-01
-- Dijalankan di: development (via auto-migrasi server.js)
-- Untuk production: jalankan script ini via phpMyAdmin atau MySQL CLI
--
-- Script ini idempotent — aman dijalankan ulang (ADD COLUMN IF NOT EXISTS)
-- AMAN untuk tabel yang sudah berisi data: ADD COLUMN NULL tidak memodifikasi baris lama.

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS npwp_name    VARCHAR(255) NULL AFTER npwp,
    ADD COLUMN IF NOT EXISTS npwp_address TEXT         NULL AFTER npwp_name;

-- -----------------------------------------------------------------------
-- ALTERNATIF: Jika MySQL/MariaDB tidak mendukung ADD COLUMN IF NOT EXISTS
-- (misalnya MySQL < 8.0.3 atau MariaDB < 10.3.3), gunakan blok berikut:
-- -----------------------------------------------------------------------
-- -- Tambah npwp_name jika belum ada
-- SET @col_exists = (
--     SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME   = 'customers'
--       AND COLUMN_NAME  = 'npwp_name'
-- );
-- SET @sql = IF(@col_exists = 0,
--     'ALTER TABLE customers ADD COLUMN npwp_name VARCHAR(255) NULL AFTER npwp',
--     'SELECT 1'
-- );
-- PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--
-- -- Tambah npwp_address jika belum ada
-- SET @col_exists2 = (
--     SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME   = 'customers'
--       AND COLUMN_NAME  = 'npwp_address'
-- );
-- SET @sql2 = IF(@col_exists2 = 0,
--     'ALTER TABLE customers ADD COLUMN npwp_address TEXT NULL AFTER npwp_name',
--     'SELECT 1'
-- );
-- PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
