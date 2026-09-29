-- Migrasi: Tambah field baru ke tabel customers
-- Dibuat: 2026-09-29
-- Dijalankan di: development (via auto-migrasi server.js)
-- Untuk production: jalankan script ini via phpMyAdmin atau MySQL CLI
--
-- Script ini idempotent — aman dijalankan ulang (ADD COLUMN IF NOT EXISTS)

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS ktp     VARCHAR(50)  NULL AFTER credit_lmt,
    ADD COLUMN IF NOT EXISTS npwp    VARCHAR(50)  NULL AFTER ktp,
    ADD COLUMN IF NOT EXISTS nib     VARCHAR(30)  NULL AFTER npwp,
    ADD COLUMN IF NOT EXISTS email   VARCHAR(255) NULL AFTER nib,
    ADD COLUMN IF NOT EXISTS no_hp_2 VARCHAR(30)  NULL AFTER email;
