-- =============================================
-- Migration: invoice_counters + format baru INV-YYYY-MM-NNNNN
-- Aman dijalankan di MySQL (phpMyAdmin Hostinger)
-- Idempoten: aman dijalankan 2x
-- =============================================

-- 1. Buat tabel counter per-tahun jika belum ada
CREATE TABLE IF NOT EXISTS invoice_counters (
  year INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);

-- 2. Pastikan kolom id di sales_invoices cukup panjang untuk format baru
--    Format: INV-2026-09-00001 = 17 karakter
--    VARCHAR(255) sudah cukup, tapi jika ada yang pakai VARCHAR(50) atau lebih kecil, jalankan ini:
-- ALTER TABLE sales_invoices MODIFY COLUMN id VARCHAR(255) NOT NULL;

-- Catatan:
-- - Tabel sales_invoices sudah punya id VARCHAR(255) PRIMARY KEY (cukup)
-- - Tidak ada data yang dihapus atau dimodifikasi
-- - Invoice lama dengan format lama (INV/2026/09/000001) tetap ada dan tidak disentuh
-- - Counter dimulai dari 0, jadi invoice pertama setelah migrasi adalah ...00001
-- - Reset counter per tahun: saat tahun berganti, baris baru otomatis dibuat dengan last_number=1
-- =============================================
