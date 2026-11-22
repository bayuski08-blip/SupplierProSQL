-- ==============================================================
-- Migration: Fitur Konversi Produk (Carton -> Kg / Satuan Lain)
-- File: db/migration_product_conversion_hostinger.sql
-- Versi: HOSTINGER-SAFE (tanpa column-level CHARACTER SET,
--        tanpa FOREIGN KEY agar kompatibel semua versi MySQL/MariaDB)
-- Idempoten: aman dijalankan berkali-kali
-- ==============================================================

-- Langkah 1: Tabel counter konversi (auto-number per tahun)
CREATE TABLE IF NOT EXISTS `conversion_counters` (
  `year` INT NOT NULL,
  `last_number` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Langkah 2: Tabel dokumen konversi produk
CREATE TABLE IF NOT EXISTS `product_conversions` (
  `id`                   INT AUTO_INCREMENT NOT NULL,
  `number`               VARCHAR(50) NOT NULL,
  `date`                 DATE NOT NULL,
  `source_product_id`    VARCHAR(255) NOT NULL,
  `source_qty`           DECIMAL(20,4) NOT NULL,
  `target_product_id`    VARCHAR(255) NOT NULL,
  `target_qty`           DECIMAL(20,4) NOT NULL,
  `source_hpp_snapshot`  DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
  `moved_value`          DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
  `target_stock_before`  DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
  `target_hpp_before`    DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
  `target_hpp_after`     DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
  `notes`                TEXT NULL,
  `status`               VARCHAR(20) NOT NULL DEFAULT 'posted',
  `created_by`           INT NULL,
  `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_by`         INT NULL,
  `cancelled_at`         DATETIME NULL,
  `cancel_reason`        TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pc_number` (`number`),
  KEY `idx_pc_date` (`date`),
  KEY `idx_pc_status` (`status`),
  KEY `idx_pc_source` (`source_product_id`),
  KEY `idx_pc_target` (`target_product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Langkah 3: Tambah prefix setting konversi
INSERT IGNORE INTO `settings` (`key`, `value`) VALUES ('prefix_conversion', 'KNV-{YYYY}-');

