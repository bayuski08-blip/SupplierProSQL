-- ============================================================
-- Migration: Batch B — Retur (Penjualan & Pembelian) & Stock Move
-- Collation aligned with existing tables: utf8mb4_general_ci
-- ============================================================

-- 1. Tabel stock_moves (TIDAK menyimpan harga/HPP/nilai/nominal)
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
  INDEX idx_stock_moves_ref (ref_type, ref_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 2. Counter Penomoran Retur
CREATE TABLE IF NOT EXISTS return_counters (
  year INT NOT NULL PRIMARY KEY,
  last_sales_number INT NOT NULL DEFAULT 0,
  last_purchase_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
  INDEX idx_sr_date (date),
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS sales_return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  quantity DECIMAL(20,4) NOT NULL,
  condition_type VARCHAR(50) NOT NULL, -- 'kembali_ke_stok' / 'rusak'
  price DECIMAL(20,4) NOT NULL,
  cost_price_snapshot DECIMAL(20,4) NOT NULL DEFAULT 0,
  subtotal DECIMAL(20,4) NOT NULL DEFAULT 0,
  refund_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  INDEX idx_sri_return (return_id),
  INDEX idx_sri_product (product_id),
  FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
  INDEX idx_pr_date (date),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  quantity DECIMAL(20,4) NOT NULL,
  cost DECIMAL(20,4) NOT NULL,
  subtotal DECIMAL(20,4) NOT NULL DEFAULT 0,
  refund_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  INDEX idx_pri_return (return_id),
  INDEX idx_pri_product (product_id),
  FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
