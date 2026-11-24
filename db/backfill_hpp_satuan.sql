-- ============================================================================
-- Backfill: Isi hpp_satuan untuk item invoice lama yang belum punya snapshot
-- File: db/backfill_hpp_satuan.sql
-- Idempoten: aman dijalankan ulang; TIDAK akan menimpa baris dengan hpp_estimasi = 0
-- Catatan: Pastikan db/migration_laporan_penjualan_hpp.sql sudah dijalankan lebih dulu.
-- ============================================================================

-- 1. Backfill hanya baris yang ditandai hpp_estimasi = 1 (atau belum tersinkron dengan snapshot > 0)
--    Baris dengan hpp_estimasi = 0 tidak disentuh sama sekali.
UPDATE invoice_items ii
LEFT JOIN products p ON p.id = ii.product_id
SET
    ii.hpp_satuan = ROUND(COALESCE(NULLIF(ii.cost_price_snapshot, 0), p.cost_price, 0), 2),
    ii.hpp_estimasi = 1
WHERE ii.hpp_estimasi = 1;

-- 2. Ringkasan hasil backfill (untuk verifikasi di phpMyAdmin / CLI)
SELECT
    COUNT(*) AS total_item_invoice,
    SUM(CASE WHEN hpp_estimasi = 0 THEN 1 ELSE 0 END) AS jumlah_snapshot_asli,
    SUM(CASE WHEN hpp_estimasi = 1 THEN 1 ELSE 0 END) AS jumlah_baris_estimasi_backfill,
    SUM(CASE WHEN hpp_satuan = 0 THEN 1 ELSE 0 END) AS jumlah_hpp_nol
FROM invoice_items;
