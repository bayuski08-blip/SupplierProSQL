-- ============================================================================
-- Migration: Snapshot HPP pada purchase_order_items (PO HPP Rata-rata)
-- File: db/migration_po_hpp_snapshot.sql
-- Kompatibel: MySQL 5.7/8.0 & MariaDB (lokal & phpMyAdmin Hostinger)
-- Idempoten: aman dijalankan berkali-kali, TANPA backfill data historis
-- ============================================================================

SET @col_poi_sb = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_items' AND COLUMN_NAME = 'stock_before'
);
SET @sql_poi_sb = IF(@col_poi_sb = 0,
  'ALTER TABLE purchase_order_items ADD COLUMN stock_before DECIMAL(20,4) NULL',
  'SELECT "purchase_order_items.stock_before exists"');
PREPARE stmt_poi_sb FROM @sql_poi_sb; EXECUTE stmt_poi_sb; DEALLOCATE PREPARE stmt_poi_sb;

SET @col_poi_hb = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_items' AND COLUMN_NAME = 'hpp_before'
);
SET @sql_poi_hb = IF(@col_poi_hb = 0,
  'ALTER TABLE purchase_order_items ADD COLUMN hpp_before DECIMAL(20,4) NULL',
  'SELECT "purchase_order_items.hpp_before exists"');
PREPARE stmt_poi_hb FROM @sql_poi_hb; EXECUTE stmt_poi_hb; DEALLOCATE PREPARE stmt_poi_hb;

SET @col_poi_ha = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_items' AND COLUMN_NAME = 'hpp_after'
);
SET @sql_poi_ha = IF(@col_poi_ha = 0,
  'ALTER TABLE purchase_order_items ADD COLUMN hpp_after DECIMAL(20,4) NULL',
  'SELECT "purchase_order_items.hpp_after exists"');
PREPARE stmt_poi_ha FROM @sql_poi_ha; EXECUTE stmt_poi_ha; DEALLOCATE PREPARE stmt_poi_ha;
