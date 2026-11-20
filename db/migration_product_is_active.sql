-- Migration: Add is_active column to products
ALTER TABLE products ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER unit_id;
CREATE INDEX idx_products_is_active ON products(is_active);

