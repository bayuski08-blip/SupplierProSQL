-- ============================================================================
-- Migration: Tipe Pembayaran Default per Pelanggan
-- File: db/migration_customer_default_payment_type.sql
-- Tujuan: Menambahkan kolom tipe_pembayaran_id pada tabel customers
--         dengan FOREIGN KEY ke payment_types(id) ON DELETE SET NULL.
-- Idempoten & Kompatibel: Aman dijalankan di phpMyAdmin, MySQL CLI, maupun MariaDB.
-- ============================================================================

-- 1. Tambah kolom tipe_pembayaran_id (NULLABLE, default NULL) jika belum ada
ALTER TABLE `customers`
  ADD COLUMN IF NOT EXISTS `tipe_pembayaran_id` VARCHAR(255) NULL DEFAULT NULL AFTER `pricelist_id`;

-- 2. Tambah foreign key fk_customers_tipe_pembayaran jika belum ada
SET @fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customers'
    AND CONSTRAINT_NAME = 'fk_customers_tipe_pembayaran'
);

SET @fk_sql = IF(@fk_exists = 0,
  'ALTER TABLE `customers` ADD CONSTRAINT `fk_customers_tipe_pembayaran` FOREIGN KEY (`tipe_pembayaran_id`) REFERENCES `payment_types` (`id`) ON DELETE SET NULL',
  'SELECT "Foreign key fk_customers_tipe_pembayaran already exists" AS message'
);

PREPARE stmt FROM @fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
