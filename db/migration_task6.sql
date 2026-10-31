-- ==============================================================
-- Migration: Task 6 Update SupplierPro (Aman dijalankan di phpMyAdmin)
-- Modul: Penanda Invoice Outstanding Import & Status Cancel
-- ==============================================================

-- 1. Tambah kolom is_outstanding_import jika belum ada
SET @col_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'sales_invoices' 
      AND COLUMN_NAME = 'is_outstanding_import'
);

SET @stmt = IF(@col_exists = 0, 
    'ALTER TABLE sales_invoices ADD COLUMN is_outstanding_import TINYINT(1) NOT NULL DEFAULT 0 AFTER user_id', 
    'SELECT "Column is_outstanding_import already exists"');
PREPARE exec_stmt FROM @stmt;
EXECUTE exec_stmt;
DEALLOCATE PREPARE exec_stmt;

-- 2. Tambah index untuk performa filter piutang & status import
SET @idx_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'sales_invoices' 
      AND INDEX_NAME = 'idx_is_outstanding_import'
);

SET @stmt_idx = IF(@idx_exists = 0,
    'ALTER TABLE sales_invoices ADD INDEX idx_is_outstanding_import (is_outstanding_import)',
    'SELECT "Index idx_is_outstanding_import already exists"');
PREPARE exec_stmt_idx FROM @stmt_idx;
EXECUTE exec_stmt_idx;
DEALLOCATE PREPARE exec_stmt_idx;

-- 3. Backfill data historis: tandai semua invoice yang tidak memiliki item produk (hasil import outstanding / manual)
UPDATE sales_invoices si
LEFT JOIN (
    SELECT DISTINCT invoice_id FROM invoice_items
) ii ON si.id = ii.invoice_id
SET si.is_outstanding_import = 1
WHERE ii.invoice_id IS NULL AND si.is_outstanding_import = 0;

