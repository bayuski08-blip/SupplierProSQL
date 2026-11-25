-- ============================================================================
-- Migration: Batch C (Hostinger-Safe) — Pembayaran Hutang PO (Cicilan Bertahap)
-- File: db/migration_batch_c_hostinger.sql
-- Kompatibel: MySQL 5.7/8.0 & MariaDB (phpMyAdmin Hostinger)
-- Collation: utf8mb4_unicode_ci
-- Tanpa FOREIGN KEY agar aman terhadap perbedaan collation/engine di Hostinger
-- Idempoten: aman dijalankan berkali-kali
-- ============================================================================

-- 1. Tabel counter nomor bukti pembayaran hutang PO
CREATE TABLE IF NOT EXISTS purchase_payment_counters (
  year INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabel pencatatan pembayaran cicilan hutang PO
CREATE TABLE IF NOT EXISTS purchase_order_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_no VARCHAR(50) UNIQUE NOT NULL,
  purchase_order_id VARCHAR(255) NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(20,4) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  notes TEXT DEFAULT NULL,
  is_down_payment TINYINT(1) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  void_reason TEXT DEFAULT NULL,
  void_by INT DEFAULT NULL,
  void_at DATETIME DEFAULT NULL,
  cash_transaction_id VARCHAR(255) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_po_id (purchase_order_id),
  INDEX idx_payment_date (payment_date),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tabel counter & cicilan piutang invoice (jika ikut terlewat saat startup)
CREATE TABLE IF NOT EXISTS payment_counters (
  year INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_invoice_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_no VARCHAR(50) UNIQUE NOT NULL,
  invoice_id VARCHAR(255) NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(20,4) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  notes TEXT DEFAULT NULL,
  is_down_payment TINYINT(1) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  void_reason TEXT DEFAULT NULL,
  void_by INT DEFAULT NULL,
  void_at DATETIME DEFAULT NULL,
  cash_transaction_id VARCHAR(255) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invoice_id (invoice_id),
  INDEX idx_payment_date (payment_date),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Setting prefix default
INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_purchase_payment', 'POP-{YYYY}-{MM}-');
INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_payment', 'PAY-{YYYY}-{MM}-');

-- 5. Kolom tambahan pada purchase_orders & sales_invoices (idempoten MySQL 5.7/8.0 & MariaDB)
SET @col_po_sub = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'subtotal');
SET @sql_po_sub = IF(@col_po_sub = 0, 'ALTER TABLE purchase_orders ADD COLUMN subtotal DECIMAL(20,4) DEFAULT 0', 'SELECT "purchase_orders.subtotal exists"');
PREPARE s1 FROM @sql_po_sub; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @col_po_disc = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'discount');
SET @sql_po_disc = IF(@col_po_disc = 0, 'ALTER TABLE purchase_orders ADD COLUMN discount DECIMAL(20,4) DEFAULT 0', 'SELECT "purchase_orders.discount exists"');
PREPARE s2 FROM @sql_po_disc; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @col_po_tax = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'tax');
SET @sql_po_tax = IF(@col_po_tax = 0, 'ALTER TABLE purchase_orders ADD COLUMN tax DECIMAL(20,4) DEFAULT 0', 'SELECT "purchase_orders.tax exists"');
PREPARE s3 FROM @sql_po_tax; EXECUTE s3; DEALLOCATE PREPARE s3;

SET @col_po_pd = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'paid_date');
SET @sql_po_pd = IF(@col_po_pd = 0, 'ALTER TABLE purchase_orders ADD COLUMN paid_date DATE DEFAULT NULL', 'SELECT "purchase_orders.paid_date exists"');
PREPARE s4 FROM @sql_po_pd; EXECUTE s4; DEALLOCATE PREPARE s4;

SET @col_po_imp = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'is_outstanding_import');
SET @sql_po_imp = IF(@col_po_imp = 0, 'ALTER TABLE purchase_orders ADD COLUMN is_outstanding_import TINYINT(1) NOT NULL DEFAULT 0', 'SELECT "purchase_orders.is_outstanding_import exists"');
PREPARE s5 FROM @sql_po_imp; EXECUTE s5; DEALLOCATE PREPARE s5;

SET @col_si_pd = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_invoices' AND COLUMN_NAME = 'paid_date');
SET @sql_si_pd = IF(@col_si_pd = 0, 'ALTER TABLE sales_invoices ADD COLUMN paid_date DATE DEFAULT NULL', 'SELECT "sales_invoices.paid_date exists"');
PREPARE s6 FROM @sql_si_pd; EXECUTE s6; DEALLOCATE PREPARE s6;

SET @col_si_imp = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_invoices' AND COLUMN_NAME = 'is_outstanding_import');
SET @sql_si_imp = IF(@col_si_imp = 0, 'ALTER TABLE sales_invoices ADD COLUMN is_outstanding_import TINYINT(1) NOT NULL DEFAULT 0', 'SELECT "sales_invoices.is_outstanding_import exists"');
PREPARE s7 FROM @sql_si_imp; EXECUTE s7; DEALLOCATE PREPARE s7;

-- 6. Backfill penanda outstanding import untuk PO tanpa item
UPDATE purchase_orders po
LEFT JOIN (
    SELECT DISTINCT purchase_order_id FROM purchase_order_items
) poi ON po.id = poi.purchase_order_id
SET po.is_outstanding_import = 1
WHERE poi.purchase_order_id IS NULL AND po.is_outstanding_import = 0;
