-- =====================================================================
-- Migration: Tabel hpp_adjustment_log untuk Audit Log Penyesuaian HPP
-- Dibuat: 2026-11-25
-- Versi: 1.0
-- Catatan: Idempoten - aman dijalankan lebih dari sekali
-- =====================================================================

-- Buat tabel hpp_adjustment_log jika belum ada
CREATE TABLE IF NOT EXISTS hpp_adjustment_log (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id      VARCHAR(50)    NOT NULL COMMENT 'ID unik per aksi edit (semua baris satu edit share batch_id)',
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id       INT            NULL     COMMENT 'User yang melakukan perubahan',
  alasan        TEXT           NOT NULL COMMENT 'Alasan perubahan HPP',
  produk_id     VARCHAR(255)   NOT NULL COMMENT 'ID produk yang terdampak',
  jenis_dokumen VARCHAR(50)    NOT NULL COMMENT 'invoice_item | product_conversion | purchase_order | product_master',
  dokumen_id    VARCHAR(255)   NOT NULL COMMENT 'ID dokumen terdampak',
  field         VARCHAR(100)   NOT NULL COMMENT 'hpp_satuan | cost_price_snapshot | source_hpp_snapshot | cost_price | target_hpp_after dsb',
  nilai_lama    DECIMAL(20,4)  NULL     COMMENT 'Nilai field sebelum perubahan',
  nilai_baru    DECIMAL(20,4)  NULL     COMMENT 'Nilai field sesudah perubahan',
  INDEX idx_batch      (batch_id),
  INDEX idx_produk     (produk_id),
  INDEX idx_dokumen    (jenis_dokumen, dokumen_id),
  INDEX idx_created    (created_at),
  INDEX idx_user       (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Log audit setiap perubahan nilai HPP akibat edit harga PO';
