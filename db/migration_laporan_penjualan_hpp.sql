-- ============================================================================
-- Migration: HPP Snapshot per Item Invoice & Index Laporan Penjualan
-- File: db/migration_laporan_penjualan_hpp.sql
-- Kompatibel: MySQL 5.7/8.0 & MariaDB (aman dijalankan via phpMyAdmin Hostinger)
-- Idempoten: aman dijalankan berkali-kali tanpa error atau menimpa data
-- ============================================================================

-- 1. Tambah kolom hpp_satuan pada invoice_items jika belum ada
SET @col_hpp_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'invoice_items'
      AND COLUMN_NAME = 'hpp_satuan'
);

SET @stmt_hpp = IF(@col_hpp_exists = 0,
    'ALTER TABLE invoice_items ADD COLUMN hpp_satuan DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER cost_price_snapshot',
    'SELECT "Column hpp_satuan already exists"');
PREPARE exec_hpp FROM @stmt_hpp;
EXECUTE exec_hpp;
DEALLOCATE PREPARE exec_hpp;

-- 2. Tambah kolom hpp_estimasi pada invoice_items jika belum ada
SET @col_est_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'invoice_items'
      AND COLUMN_NAME = 'hpp_estimasi'
);

SET @stmt_est = IF(@col_est_exists = 0,
    'ALTER TABLE invoice_items ADD COLUMN hpp_estimasi TINYINT(1) NOT NULL DEFAULT 0 AFTER hpp_satuan',
    'SELECT "Column hpp_estimasi already exists"');
PREPARE exec_est FROM @stmt_est;
EXECUTE exec_est;
DEALLOCATE PREPARE exec_est;

-- 3. Inisialisasi awal baris eksisting hanya saat kolom hpp_estimasi baru ditambahkan:
--    - Baris lama yang sudah punya cost_price_snapshot > 0 disalin ke hpp_satuan dengan hpp_estimasi = 0
--    - Baris lama yang belum punya snapshot (0/NULL) ditandai hpp_estimasi = 1 agar diisi oleh script backfill
SET @stmt_init = IF(@col_est_exists = 0,
    'UPDATE invoice_items SET hpp_satuan = ROUND(COALESCE(cost_price_snapshot, 0), 2), hpp_estimasi = CASE WHEN COALESCE(cost_price_snapshot, 0) > 0 THEN 0 ELSE 1 END',
    'SELECT "Initial snapshot sync skipped (already migrated)"');
PREPARE exec_init FROM @stmt_init;
EXECUTE exec_init;
DEALLOCATE PREPARE exec_init;

-- 4. Tambah index pada sales_invoices(date, status) untuk mempercepat agregasi laporan
SET @idx_si_ds_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sales_invoices'
      AND INDEX_NAME = 'idx_si_date_status'
);

SET @stmt_idx_ds = IF(@idx_si_ds_exists = 0,
    'ALTER TABLE sales_invoices ADD INDEX idx_si_date_status (date, status)',
    'SELECT "Index idx_si_date_status already exists"');
PREPARE exec_idx_ds FROM @stmt_idx_ds;
EXECUTE exec_idx_ds;
DEALLOCATE PREPARE exec_idx_ds;

-- 5. Tambah index pada sales_invoices(status) jika belum ada
SET @idx_si_st_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sales_invoices'
      AND INDEX_NAME = 'idx_si_status'
);

SET @stmt_idx_st = IF(@idx_si_st_exists = 0,
    'ALTER TABLE sales_invoices ADD INDEX idx_si_status (status)',
    'SELECT "Index idx_si_status already exists"');
PREPARE exec_idx_st FROM @stmt_idx_st;
EXECUTE exec_idx_st;
DEALLOCATE PREPARE exec_idx_st;
