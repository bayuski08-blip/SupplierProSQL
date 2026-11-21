-- ==============================================================
-- Migration: Batch C - Pembayaran Hutang (Cicilan Bertahap)
-- File: db/migration_batch_c.sql
-- Collation: utf8mb4_unicode_ci (aligned with master tables)
-- Idempoten: aman dijalankan berkali-kali di production & clone
-- ==============================================================

-- 1. Buat tabel counter pembayaran PO (atomic counter per tahun)
CREATE TABLE IF NOT EXISTS purchase_payment_counters (
  year INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Buat tabel pencatatan pembayaran cicilan hutang PO (purchase_order_payments)
CREATE TABLE IF NOT EXISTS purchase_order_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_no VARCHAR(50) UNIQUE NOT NULL,
  purchase_order_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(20,4) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  notes TEXT DEFAULT NULL,
  is_down_payment TINYINT(1) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  void_reason TEXT DEFAULT NULL,
  void_by INT DEFAULT NULL,
  void_at DATETIME DEFAULT NULL,
  cash_transaction_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_po_id (purchase_order_id),
  INDEX idx_payment_date (payment_date),
  INDEX idx_status (status),
  CONSTRAINT fk_pop_purchase_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pop_void_by FOREIGN KEY (void_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pop_cash_tx FOREIGN KEY (cash_transaction_id) REFERENCES cash_transactions(id) ON DELETE SET NULL,
  CONSTRAINT fk_pop_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Setting prefix default untuk nomor bukti pembayaran hutang PO
INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_purchase_payment', 'POP-{YYYY}-{MM}-');

-- 4. Tambah kolom is_outstanding_import pada purchase_orders jika belum ada
SET @po_col_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'purchase_orders' 
      AND COLUMN_NAME = 'is_outstanding_import'
);

SET @po_stmt = IF(@po_col_exists = 0, 
    'ALTER TABLE purchase_orders ADD COLUMN is_outstanding_import TINYINT(1) NOT NULL DEFAULT 0 AFTER user_id', 
    'SELECT "Column is_outstanding_import already exists"');
PREPARE exec_stmt FROM @po_stmt;
EXECUTE exec_stmt;
DEALLOCATE PREPARE exec_stmt;

-- 5. Tambah index is_outstanding_import pada purchase_orders jika belum ada
SET @po_idx_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'purchase_orders' 
      AND INDEX_NAME = 'idx_po_is_outstanding_import'
);

SET @po_stmt_idx = IF(@po_idx_exists = 0,
    'ALTER TABLE purchase_orders ADD INDEX idx_po_is_outstanding_import (is_outstanding_import)',
    'SELECT "Index idx_po_is_outstanding_import already exists"');
PREPARE exec_stmt_idx FROM @po_stmt_idx;
EXECUTE exec_stmt_idx;
DEALLOCATE PREPARE exec_stmt_idx;

-- 6. Backfill penanda outstanding import untuk PO tanpa item
UPDATE purchase_orders po
LEFT JOIN (
    SELECT DISTINCT purchase_order_id FROM purchase_order_items
) poi ON po.id = poi.purchase_order_id
SET po.is_outstanding_import = 1
WHERE poi.purchase_order_id IS NULL AND po.is_outstanding_import = 0;
