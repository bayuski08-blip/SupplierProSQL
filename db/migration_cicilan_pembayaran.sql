-- =============================================
-- Migration: Pembayaran Cicilan Bertahap (Invoice Kredit)
-- File: db/migration_cicilan_pembayaran.sql
-- Idempoten: aman dijalankan berkali-kali
-- =============================================

-- 1. Buat tabel counter pembayaran invoice (atomic counter per tahun)
CREATE TABLE IF NOT EXISTS payment_counters (
  year INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);

-- 2. Buat tabel pencatatan pembayaran cicilan invoice (sales_invoice_payments)
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
  INDEX idx_status (status),
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  FOREIGN KEY (void_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (cash_transaction_id) REFERENCES cash_transactions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Setting prefix default untuk nomor bukti pembayaran jika belum ada
INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_payment', 'PAY-{YYYY}-{MM}-');
