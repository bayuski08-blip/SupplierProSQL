-- =============================================
-- Migration: Proforma Invoice Tables
-- File: db/migration_proforma.sql
-- Idempotent: safe to run multiple times
-- =============================================

-- Tabel counter untuk nomor proforma (terpisah dari invoice_counters)
CREATE TABLE IF NOT EXISTS proforma_counters (
  year INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tabel utama proforma
CREATE TABLE IF NOT EXISTS proformas (
  -- PK internal (INT AUTO_INCREMENT, mengikuti pola hybrid seperti sales_invoice_payments)
  pk INT AUTO_INCREMENT PRIMARY KEY,
  -- Nomor tampilan: PF-YYYY-NNNNN (tahun dari tanggal order proforma, reset per tahun)
  proforma_no VARCHAR(20) NOT NULL UNIQUE,
  -- Relasi
  customer_id VARCHAR(255) DEFAULT NULL,
  -- Tanggal order proforma: tipe DATE (sama dengan sales_invoices.date)
  -- Diisi dari input user, TIDAK dari CURRENT_DATE/NOW()
  -- created_at (DATETIME) terpisah untuk waktu insert record
  order_date DATE NOT NULL,
  berlaku_hingga DATE NOT NULL,
  -- Tipe pembayaran (sebagai syarat pembayaran tampilan, bukan settlement)
  payment_type_id VARCHAR(255) DEFAULT NULL,
  -- Snapshot kalkulasi saat proforma dibuat
  subtotal DECIMAL(20,4) DEFAULT 0,
  discount DECIMAL(20,4) DEFAULT 0,
  ppn_rate DECIMAL(5,2) DEFAULT 0,       -- snapshot tarif PPN saat dibuat (%)
  ppn_amount DECIMAL(20,4) DEFAULT 0,    -- snapshot nilai PPN
  ppn_enabled TINYINT(1) DEFAULT 0,      -- snapshot status PPN
  total DECIMAL(20,4) DEFAULT 0,
  -- Status: aktif | dikonversi | dibatalkan
  -- "Kedaluwarsa" diturunkan (computed): aktif AND berlaku_hingga < CURDATE()
  status VARCHAR(20) NOT NULL DEFAULT 'aktif',
  revisi INT NOT NULL DEFAULT 0,
  diubah_pada DATETIME NULL,
  diubah_oleh INT(11) DEFAULT NULL,
  sumber ENUM('manual','dari_invoice') NOT NULL DEFAULT 'manual',
  alasan_pembatalan TEXT DEFAULT NULL,
  -- Audit
  user_id INT(11) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Konversi: terisi saat dikonversi ke invoice
  invoice_id VARCHAR(255) DEFAULT NULL,
  -- Foreign keys
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_type_id) REFERENCES payment_types(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (diubah_oleh) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL,
  -- Indexes
  INDEX idx_proforma_customer (customer_id),
  INDEX idx_proforma_status (status),
  INDEX idx_proforma_order_date (order_date),
  INDEX idx_proforma_berlaku (berlaku_hingga),
  UNIQUE KEY uk_proforma_invoice_id (invoice_id),
  CHECK (status IN ('aktif', 'dikonversi', 'dibatalkan'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tabel item proforma (mengikuti pola invoice_items)
CREATE TABLE IF NOT EXISTS proforma_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  proforma_pk INT NOT NULL,
  product_id VARCHAR(255) DEFAULT NULL,
  -- Snapshot nama produk saat proforma dibuat
  product_name_snapshot VARCHAR(255) NOT NULL,
  unit_name_snapshot VARCHAR(50) DEFAULT '-',
  quantity DECIMAL(20,4) NOT NULL,
  -- Snapshot harga saat proforma dibuat
  price DECIMAL(20,4) NOT NULL,
  subtotal_item DECIMAL(20,4) NOT NULL,
  -- Fee: field internal (sama dengan invoice_items, TIDAK ditampilkan di cetakan)
  customer_fee DECIMAL(20,4) DEFAULT 0,
  fee_notes TEXT DEFAULT NULL,
  -- cost_price_snapshot untuk keperluan analisis margin (tidak ditampilkan)
  cost_price_snapshot DECIMAL(20,4) DEFAULT 0,
  FOREIGN KEY (proforma_pk) REFERENCES proformas(pk) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_proforma_items_pk (proforma_pk)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Konstanta masa berlaku proforma default (dalam tabel settings)
-- Jalankan hanya jika belum ada
INSERT IGNORE INTO settings (`key`, value) VALUES ('proforma_berlaku_hari', '7');
