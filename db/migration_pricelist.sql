-- =============================================
-- Migration: Fitur Pricelist (Harga Khusus per Customer)
-- File: db/migration_pricelist.sql
-- Idempoten: aman dijalankan berkali-kali
-- =============================================

-- 1. Buat tabel master pricelist
CREATE TABLE IF NOT EXISTS pricelists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(20) NOT NULL UNIQUE,
  nama VARCHAR(100) NOT NULL,
  keterangan VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Buat tabel item pricelist
CREATE TABLE IF NOT EXISTS pricelist_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pricelist_id INT NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  harga DECIMAL(20,4) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pricelist_product (pricelist_id, product_id),
  KEY idx_pricelist_items_product (product_id),
  CONSTRAINT fk_pli_pricelist FOREIGN KEY (pricelist_id) REFERENCES pricelists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pli_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 3. Tambah kolom pricelist_id ke tabel customers jika belum ada (aman dan kompatibel dengan semua versi MySQL)
DROP PROCEDURE IF EXISTS sp_add_customer_pricelist;
DELIMITER $$
CREATE PROCEDURE sp_add_customer_pricelist()
BEGIN
  IF NOT EXISTS (
    SELECT * FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'customers' 
      AND COLUMN_NAME = 'pricelist_id'
  ) THEN
    ALTER TABLE customers
      ADD COLUMN pricelist_id INT NULL AFTER customer_category_id,
      ADD CONSTRAINT fk_customers_pricelist
        FOREIGN KEY (pricelist_id) REFERENCES pricelists(id) ON DELETE SET NULL;
  END IF;
END $$
DELIMITER ;
CALL sp_add_customer_pricelist();
DROP PROCEDURE IF EXISTS sp_add_customer_pricelist;

-- 4. Prefix setting untuk kode pricelist (default: PL)
INSERT IGNORE INTO settings (`key`, value) VALUES ('prefix_pricelist', 'PL');
