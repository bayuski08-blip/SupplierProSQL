-- =============================================
-- Migration: Tambah kolom paid_date untuk Piutang & Hutang
-- Aman dijalankan di MySQL (phpMyAdmin Hostinger)
-- Idempoten: aman dijalankan 2x jika MySQL versi 8.0+
-- (Jika versi lebih lama, hapus klausa 'IF NOT EXISTS' jika error)
-- =============================================

-- 1. Tambah kolom untuk Piutang (Sales Invoices)
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS paid_date DATE DEFAULT NULL;

-- 2. Tambah kolom untuk Hutang (Purchase Orders)
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_date DATE DEFAULT NULL;

-- =============================================
-- Catatan:
-- - Kolom ini digunakan untuk mencatat tanggal pelunasan (status menjadi Lunas/Selesai).
-- - Data lama (sebelum fitur ini ada) akan tetap NULL secara default.
