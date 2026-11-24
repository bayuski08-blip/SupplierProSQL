-- ============================================================================
-- Migration: Batch B (Hostinger-Safe) — Retur Penjualan/Pembelian & Stock Move
-- File: db/migration_batch_b_hostinger.sql
-- Kompatibel: MySQL 5.7/8.0 & MariaDB (phpMyAdmin Hostinger)
-- Collation: utf8mb4_unicode_ci (selaras dengan db/schema.sql & sales_invoices)
-- Tanpa FOREIGN KEY agar aman terhadap perbedaan engine/collation di Hostinger
-- Idempoten: aman dijalankan berkali-kali
-- ============================================================================

-- 1. Tabel stock_moves
CREATE TABLE IF NOT EXISTS stock_moves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL,
  tanggal DATETIME NOT NULL,
  tipe VARCHAR(50) NOT NULL,
  ref_type VARCHAR(50) NULL,
  ref_id VARCHAR(255) NULL,
  ref_no VARCHAR(255) NULL,
  qty_masuk DECIMAL(20,4) NOT NULL DEFAULT 0,
  qty_keluar DECIMAL(20,4) NOT NULL DEFAULT 0,
  qty_sebelum DECIMAL(20,4) NOT NULL DEFAULT 0,
  qty_sesudah DECIMAL(20,4) NOT NULL DEFAULT 0,
  keterangan TEXT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_backfill TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_stock_moves_product (product_id),
  INDEX idx_stock_moves_tanggal (tanggal),
  INDEX idx_stock_moves_tipe (tipe),
  INDEX idx_stock_moves_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Counter Penomoran Retur
CREATE TABLE IF NOT EXISTS return_counters (
  year INT NOT NULL PRIMARY KEY,
  last_sales_number INT NOT NULL DEFAULT 0,
  last_purchase_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tabel Retur Penjualan (Header & Items)
CREATE TABLE IF NOT EXISTS sales_returns (
  id VARCHAR(255) PRIMARY KEY,
  invoice_id VARCHAR(255) NOT NULL,
  customer_id VARCHAR(255) NULL,
  date DATE NOT NULL,
  total_refund DECIMAL(20,4) NOT NULL DEFAULT 0,
  piutang_deduction DECIMAL(20,4) NOT NULL DEFAULT 0,
  customer_deposit_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  user_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sr_invoice (invoice_id),
  INDEX idx_sr_customer (customer_id),
  INDEX idx_sr_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  quantity DECIMAL(20,4) NOT NULL,
  condition_type VARCHAR(50) NOT NULL,
  price DECIMAL(20,4) NOT NULL,
  cost_price_snapshot DECIMAL(20,4) NOT NULL DEFAULT 0,
  subtotal DECIMAL(20,4) NOT NULL DEFAULT 0,
  refund_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  INDEX idx_sri_return (return_id),
  INDEX idx_sri_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tabel Retur Pembelian (Header & Items)
CREATE TABLE IF NOT EXISTS purchase_returns (
  id VARCHAR(255) PRIMARY KEY,
  purchase_order_id VARCHAR(255) NOT NULL,
  vendor_id VARCHAR(255) NULL,
  date DATE NOT NULL,
  total_refund DECIMAL(20,4) NOT NULL DEFAULT 0,
  hutang_deduction DECIMAL(20,4) NOT NULL DEFAULT 0,
  vendor_deposit_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  user_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pr_po (purchase_order_id),
  INDEX idx_pr_vendor (vendor_id),
  INDEX idx_pr_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  quantity DECIMAL(20,4) NOT NULL,
  cost DECIMAL(20,4) NOT NULL,
  subtotal DECIMAL(20,4) NOT NULL DEFAULT 0,
  refund_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  INDEX idx_pri_return (return_id),
  INDEX idx_pri_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Kolom pendukung deposit & return_amount (idempoten)
SET @col_cust_dep = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'deposit');
SET @sql_cust_dep = IF(@col_cust_dep = 0, 'ALTER TABLE customers ADD COLUMN deposit DECIMAL(20,4) NOT NULL DEFAULT 0', 'SELECT "customers.deposit already exists"');
PREPARE stmt_cust_dep FROM @sql_cust_dep; EXECUTE stmt_cust_dep; DEALLOCATE PREPARE stmt_cust_dep;

SET @col_vend_dep = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendors' AND COLUMN_NAME = 'deposit');
SET @sql_vend_dep = IF(@col_vend_dep = 0, 'ALTER TABLE vendors ADD COLUMN deposit DECIMAL(20,4) NOT NULL DEFAULT 0', 'SELECT "vendors.deposit already exists"');
PREPARE stmt_vend_dep FROM @sql_vend_dep; EXECUTE stmt_vend_dep; DEALLOCATE PREPARE stmt_vend_dep;

SET @col_si_ret = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_invoices' AND COLUMN_NAME = 'return_amount');
SET @sql_si_ret = IF(@col_si_ret = 0, 'ALTER TABLE sales_invoices ADD COLUMN return_amount DECIMAL(20,4) NOT NULL DEFAULT 0', 'SELECT "sales_invoices.return_amount already exists"');
PREPARE stmt_si_ret FROM @sql_si_ret; EXECUTE stmt_si_ret; DEALLOCATE PREPARE stmt_si_ret;

SET @col_po_ret = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'return_amount');
SET @sql_po_ret = IF(@col_po_ret = 0, 'ALTER TABLE purchase_orders ADD COLUMN return_amount DECIMAL(20,4) NOT NULL DEFAULT 0', 'SELECT "purchase_orders.return_amount already exists"');
PREPARE stmt_po_ret FROM @sql_po_ret; EXECUTE stmt_po_ret; DEALLOCATE PREPARE stmt_po_ret;
