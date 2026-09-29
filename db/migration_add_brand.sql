-- Migration script: Add brand column to products table
-- Idempotent: aman dijalankan berulang kali
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(255) DEFAULT NULL AFTER sku;
