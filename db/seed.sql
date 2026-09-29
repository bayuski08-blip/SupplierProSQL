-- =============================================
-- Seed Data untuk SupplierPro (MySQL)
-- =============================================

-- Master Data
INSERT IGNORE INTO product_categories (id, name) VALUES 
  ('PC-1', 'Minuman'), 
  ('PC-2', 'Makanan'), 
  ('PC-3', 'Sembako'), 
  ('PC-4', 'Lainnya');

INSERT IGNORE INTO product_units (id, name) VALUES 
  ('PU-1', 'pcs'), 
  ('PU-2', 'box'), 
  ('PU-3', 'botol'), 
  ('PU-4', 'dus'), 
  ('PU-5', 'pack'), 
  ('PU-6', 'sak'), 
  ('PU-7', 'kg'), 
  ('PU-8', 'karton');

INSERT IGNORE INTO customer_categories (id, name) VALUES 
  ('CC-1', 'Reseller'), 
  ('CC-2', 'Warung'), 
  ('CC-3', 'Kafe'), 
  ('CC-4', 'Toko');

INSERT IGNORE INTO vendor_categories (id, name) VALUES 
  ('VC-1', 'Minuman'), 
  ('VC-2', 'Makanan'), 
  ('VC-3', 'Sembako'), 
  ('VC-4', 'Non-Pangan');

INSERT IGNORE INTO payment_types (id, name) VALUES 
  ('PT-1', 'Tunai'), 
  ('PT-2', 'Transfer'),
  ('PT-3', 'Kredit 1 Hari'),
  ('PT-5', 'Kredit 7 Hari'),
  ('PT-6', 'Kredit 14 Hari'),
  ('PT-7', 'Kredit 30 Hari');

INSERT IGNORE INTO cash_categories (id, name, type, is_system) VALUES 
  (1, 'Penjualan', 'IN', 1),
  (2, 'Pelunasan Piutang', 'IN', 1),
  (3, 'Pembelian Stok', 'OUT', 1),
  (4, 'Penyesuaian Stok', 'OUT', 1),
  (5, 'Pelunasan Hutang', 'OUT', 1),
  (6, 'Gaji & Tunjangan', 'OUT', 0),
  (7, 'Sewa', 'OUT', 0),
  (8, 'Operasional', 'OUT', 0),
  (9, 'Marketing', 'OUT', 0),
  (10, 'Pajak', 'OUT', 0),
  (11, 'Pembelian Aset', 'OUT', 0),
  (12, 'Prive Pemilik', 'OUT', 0),
  (13, 'Pengeluaran Lainnya', 'OUT', 0),
  (14, 'Pendapatan Lainnya', 'IN', 0),
  (15, 'Pinjaman Masuk', 'IN', 0),
  (16, 'Setoran Modal', 'IN', 0),
  (17, 'Transfer Antar Kas/Bank', 'BOTH', 0);

-- Users
-- Note: password_hash values below are plain text (auto-upgraded to bcrypt on first login)
-- Passwords: admin=admin123, demo_finance=Finance123, demo_gudang=Gudang123, demo_kasir=Kasir123
INSERT IGNORE INTO users (id, username, name, email, password_hash, role, active) VALUES 
  (1, 'admin', 'Administrator', 'admin@supplierpro.id', 'admin123', 'admin', 1),
  (2, 'bayu', 'bayu', 'bayu@gmail.com', 'bayu', 'admin', 1),
  (3, 'demo_finance', 'Demo Finance', 'finance@supplierpro.id', 'Finance123', 'finance', 1),
  (4, 'demo_gudang', 'Demo Gudang', 'gudang@supplierpro.id', 'Gudang123', 'gudang', 1),
  (5, 'demo_kasir', 'Demo Kasir', 'kasir@supplierpro.id', 'Kasir123', 'kasir', 1);

-- Products
INSERT IGNORE INTO products (id, sku, brand, name, category_id, cost_price, sell_price, stock, min_stock, unit_id) VALUES 
  ('P000001', 'MNM-001', NULL, 'Kopi Arabica 250g', 'PC-1', 45000, 68000, 118, 20, 'PU-5'),
  ('P000002', 'MKN-001', 'Indomie', 'Mie Instan Goreng (dus)', 'PC-2', 92000, 115000, 35, 10, 'PU-4');

-- Customers
INSERT IGNORE INTO customers (id, name, customer_category_id, phone, city, address, credit_lmt) VALUES 
  ('C000001', 'Toko Berkah Jaya', 'CC-1', '089696469991', 'Kota Denpasar', 'Jl. Sunia Negara No. 33', 10000000),
  ('C000002', 'Warung Sari Rasa', 'CC-2', '085936103383', 'denpasar', 'Jl. Sunia Negara No. 33, Pemogan', 2000000);

-- Vendors
INSERT IGNORE INTO vendors (id, name, vendor_category_id, phone, city, address, id_number, nama_bank, nomor_rek, pemilik_rek) VALUES 
  ('V000001', 'PT Sumber Minuman Nusantara', 'VC-1', '089696469991', 'Kota Denpasar', 'Jl. Sunia Negara No. 33', '3171011234567890', 'BCA', '1234567890', 'PT Sumber Minuman Nusantara'),
  ('V000002', 'CV Pangan Makmur', 'VC-3', '03177789012', 'Gianyar', 'Jl. Cokroaminoto, Gg. Pucuk Sari 9', '3578022345678901', 'Mandiri', '0987654321', 'CV Pangan Makmur');

-- Sales Invoices
INSERT IGNORE INTO sales_invoices (id, date, customer_id, subtotal, discount, tax, total, paid_amount, due_date, payment_type_id, status, user_id) VALUES 
  ('INV-2026-06-000001', '2026-06-12T03:04:20.117Z', 'C000001', 1040000, 0, 114400, 1154400, 1154400, '', 'PT-1', 'Lunas', NULL),
  ('INV-2026-06-000002', '2026-06-12T03:04:33.271Z', 'C000002', 366000, 0, 40260, 406260, 406260, '', 'PT-2', 'Lunas', NULL),
  ('INV-2026-06-000003', '2026-06-12T03:04:44.635Z', 'C000001', 1098000, 0, 120780, 1218780, 1218780, '', 'PT-7', 'Lunas', NULL),
  ('INV-2026-06-000004', '2026-06-12T03:25:55.936Z', 'C000001', 183000, 0, 20130, 203130, 203130, '', 'PT-1', 'Lunas', NULL),
  ('INV-2026-06-000005', '2026-06-12T03:32:02.936Z', 'C000001', 183000, 0, 20130, 203130, 203130, '', 'PT-1', 'Lunas', 1),
  ('INV-2026-06-000006', '2026-06-12T03:47:37.630Z', 'C000001', 183000, 0, 20130, 203130, 203130, '', 'PT-1', 'Lunas', 1),
  ('INV-2026-06-000007', '2026-06-12T03:47:44.195Z', 'C000002', 183000, 0, 20130, 203130, 203130, '', 'PT-7', 'Lunas', 1),
  ('INV-2026-06-000008', '2026-06-12T06:56:49.632Z', 'C000001', 150000, 0, 0, 150000, 150000, '', 'PT-2', 'Lunas', 1),
  ('INV-2026-06-000009', '2026-06-12T06:56:55.414Z', 'C000001', 150000, 0, 0, 150000, 150000, '', 'PT-2', 'Lunas', 1),
  ('INV-2026-06-000010', '2026-06-12T08:09:01.374Z', 'C000001', 115000, 0, 0, 115000, 115000, '2026-06-30', 'PT-1', 'Lunas', 1),
  ('INV-2026-06-000011', '2026-06-12T08:15:00.413Z', 'C000001', 27750, 0, 0, 27750, 27750, '2026-06-30', 'PT-1', 'Lunas', 1),
  ('INV-2026-06-000012', '2026-06-12T08:19:05.792Z', 'C000001', 50000, 0, 0, 50000, 50000, '', 'PT-2', 'Lunas', 1),
  ('INV-2026-06-000013', '2026-06-12T08:19:06.130Z', 'C000001', 75000, 0, 0, 75000, 0, '2026-07-12', 'PT-7', 'Belum Bayar', 1),
  ('INV-2026-06-000014', '2026-06-12T08:24:46.805Z', 'C000001', 50000, 0, 0, 50000, 50000, '', 'PT-1', 'Lunas', 1),
  ('INV-2026-06-000015', '2026-06-12T08:24:46.933Z', 'C000001', 50000, 0, 0, 50000, 50000, '', 'PT-2', 'Lunas', 1),
  ('INV-2026-06-000016', '2026-06-12T08:24:46.954Z', 'C000001', 50000, 0, 0, 50000, 0, '2026-07-30', 'PT-7', 'Belum Bayar', 1);

-- Invoice Items
INSERT IGNORE INTO invoice_items (id, invoice_id, product_id, quantity, price, cost_price_snapshot, customer_fee, fee_notes) VALUES 
  ('1781233460234426', 'INV-2026-06-000001', 'P000002', 4, 200000, 92000, 0, NULL),
  ('1781233460235666', 'INV-2026-06-000001', 'P000001', 3, 80000, 45000, 0, NULL),
  ('1781233473403588', 'INV-2026-06-000002', 'P000001', 2, 68000, 45000, 0, NULL),
  ('1781233473408577', 'INV-2026-06-000002', 'P000002', 2, 115000, 92000, 0, NULL),
  ('1781233484871552', 'INV-2026-06-000003', 'P000002', 6, 115000, 92000, 0, NULL),
  ('1781233484872991', 'INV-2026-06-000003', 'P000001', 6, 68000, 45000, 0, NULL),
  ('1781234756093527', 'INV-2026-06-000004', 'P000002', 1, 115000, 92000, 0, NULL),
  ('1781234756094132', 'INV-2026-06-000004', 'P000001', 1, 68000, 45000, 0, NULL),
  ('178123512295557', 'INV-2026-06-000005', 'P000002', 1, 115000, 92000, 0, NULL),
  ('1781235122957836', 'INV-2026-06-000005', 'P000001', 1, 68000, 45000, 0, NULL),
  ('1781236057740891', 'INV-2026-06-000006', 'P000002', 1, 115000, 92000, 0, NULL),
  ('1781236057742992', 'INV-2026-06-000006', 'P000001', 1, 68000, 45000, 0, NULL),
  ('1781236064199476', 'INV-2026-06-000007', 'P000001', 1, 68000, 45000, 0, NULL),
  ('1781236064202728', 'INV-2026-06-000007', 'P000002', 1, 115000, 92000, 0, NULL),
  ('1781247409747737', 'INV-2026-06-000008', 'P000001', 2, 75000, 45000, 0, NULL),
  ('1781247415418150', 'INV-2026-06-000009', 'P000001', 2, 75000, 45000, 0, NULL),
  ('1781251741493198', 'INV-2026-06-000010', 'P000002', 1, 115000, 92000, 0, NULL),
  ('1781252100598115', 'INV-2026-06-000011', 'P000002', 1, 27750, 92000, 0, NULL),
  ('1781252346082551', 'INV-2026-06-000012', 'P000002', 1, 50000, 92000, 0, NULL),
  ('1781252346142449', 'INV-2026-06-000013', 'P000002', 1, 75000, 92000, 0, NULL),
  ('1781252686907370', 'INV-2026-06-000014', 'P000002', 1, 50000, 92000, 0, NULL),
  ('1781252686938772', 'INV-2026-06-000015', 'P000002', 1, 50000, 92000, 0, NULL),
  ('178125268695975', 'INV-2026-06-000016', 'P000002', 1, 50000, 92000, 0, NULL);

-- Purchase Orders
INSERT IGNORE INTO purchase_orders (id, date, vendor_id, subtotal, discount, tax, total, paid_amount, due_date, payment_type_id, status, user_id) VALUES 
  ('PO-2026-06-000001', '2026-06-12', 'V000002', 500000, 0, 0, 500000, 500000, '', 'PT-1', 'Selesai', NULL),
  ('PO-2026-06-000002', '2026-06-12', 'V000001', 225000, 0, 0, 225000, 225000, '', 'PT-1', 'Selesai', NULL),
  ('PO-2026-06-000003', '2026-06-12', 'V000002', 92000, 0, 0, 92000, 92000, '', 'PT-7', 'Selesai', 1),
  ('PO-2026-06-000004', '2026-06-12', 'V000001', 45000, 0, 0, 45000, 45000, '', 'PT-1', 'Selesai', 1),
  ('PO-2026-06-000005', '2026-06-12', 'V000002', 45000, 0, 0, 45000, 45000, '', 'PT-7', 'Selesai', 1),
  ('PO-2026-06-000006', '2026-06-12', 'V000002', 92000, 0, 0, 92000, 92000, '', 'PT-7', 'Selesai', 1),
  ('PO-2026-06-000007', '2026-06-12', 'V000002', 137000, 0, 0, 137000, 137000, '', 'PT-7', 'Selesai', 1),
  ('PO-2026-06-000008', '2026-06-12', 'V000001', 50000, 0, 0, 50000, 50000, '2026-06-12', 'PT-1', 'Selesai', 1),
  ('PO-2026-06-000009', '2026-06-12', 'V000001', 75000, 0, 0, 75000, 75000, '2026-06-12', 'PT-1', 'Selesai', 1);

-- Purchase Order Items
INSERT IGNORE INTO purchase_order_items (id, purchase_order_id, product_id, quantity, cost) VALUES 
  ('POI-1781234357678275', 'PO-2026-06-000001', 'P000002', 10, 50000),
  ('POI-1781234503771832', 'PO-2026-06-000002', 'P000001', 5, 45000),
  ('POI-1781235154108204', 'PO-2026-06-000003', 'P000002', 1, 92000),
  ('POI-1781235554629178', 'PO-2026-06-000004', 'P000001', 1, 45000),
  ('POI-1781235566224290', 'PO-2026-06-000005', 'P000001', 1, 45000),
  ('POI-1781235609176104', 'PO-2026-06-000006', 'P000002', 1, 92000),
  ('POI-1781236025018401', 'PO-2026-06-000007', 'P000002', 1, 92000),
  ('POI-1781236025021116', 'PO-2026-06-000007', 'P000001', 1, 45000),
  ('POI-1781249284847299', 'PO-2026-06-000008', 'P000001', 2, 25000),
  ('POI-1781249318202564', 'PO-2026-06-000009', 'P000001', 3, 25000);

-- Cash Transactions
INSERT IGNORE INTO cash_transactions (id, date, type, category, description, amount, method, invoice_id, purchase_order_id, payment_type_id, user_id, status) VALUES 
  ('CT000001', '2026-06-11', 'IN', 'Penjualan', 'DP/Pembayaran Invoice INV-2026-06-000001', 1154400, 'Tunai', 'INV-2026-06-000001', NULL, 'PT-1', NULL, 'active'),
  ('CT000002', '2026-06-11', 'IN', 'Penjualan', 'DP/Pembayaran Invoice INV-2026-06-000002', 406260, 'Transfer Bank', 'INV-2026-06-000002', NULL, 'PT-2', NULL, 'active'),
  ('CT000003', '2026-06-11', 'IN', 'Pendapatan', 'Pelunasan/Cicilan Invoice INV-2026-06-000003', 1218780, 'Transfer Bank', 'INV-2026-06-000003', NULL, NULL, NULL, 'active'),
  ('CT000004', '2026-06-11', 'OUT', 'Pembelian Stok', 'Bayar PO PO-2026-06-000002', 225000, 'Tunai', NULL, 'PO-2026-06-000002', 'PT-1', NULL, 'active'),
  ('CT000005', '2026-06-11', 'OUT', 'Pembelian Stok', 'Bayar Cicilan PO PO-2026-06-000001', 500000, 'PT-1', NULL, 'PO-2026-06-000001', NULL, NULL, 'active'),
  ('CT000006', '2026-06-11', 'IN', 'Penjualan', 'DP/Pembayaran Invoice INV-2026-06-000004', 203130, 'Tunai', 'INV-2026-06-000004', NULL, 'PT-1', NULL, 'active'),
  ('CT000007', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000005', 203130, 'Tunai', 'INV-2026-06-000005', NULL, 'PT-1', 1, 'active'),
  ('CT000008', '2026-06-11', 'OUT', 'Pembelian Stok', 'Pelunasan PO PO-2026-06-000003', 92000, 'PT-1', NULL, 'PO-2026-06-000003', NULL, 1, 'active'),
  ('CT000009', '2026-06-11', 'OUT', 'Pembelian Stok', 'Bayar PO PO-2026-06-000004', 45000, 'Tunai', NULL, 'PO-2026-06-000004', 'PT-1', 1, 'active'),
  ('CT000010', '2026-06-11', 'OUT', 'Pembelian Stok', 'Pelunasan PO PO-2026-06-000005', 45000, 'PT-1', NULL, 'PO-2026-06-000005', NULL, 1, 'active'),
  ('CT000011', '2026-06-11', 'OUT', 'Pembelian Stok', 'Pelunasan PO PO-2026-06-000006', 92000, 'PT-1', NULL, 'PO-2026-06-000006', NULL, 1, 'active'),
  ('CT000012', '2026-06-11', 'OUT', 'Pembelian Stok', 'Pelunasan PO PO-2026-06-000007', 137000, 'Tunai', NULL, 'PO-2026-06-000007', NULL, 1, 'active'),
  ('CT000013', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000006', 203130, 'Tunai', 'INV-2026-06-000006', NULL, 'PT-1', 1, 'active'),
  ('CT000014', '2026-06-11', 'IN', 'Pelunasan Piutang', 'Pelunasan Invoice INV-2026-06-000007', 203130, 'Transfer Bank', 'INV-2026-06-000007', NULL, NULL, 1, 'active'),
  ('CT000015', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000008', 150000, 'Transfer', 'INV-2026-06-000008', NULL, 'PT-2', 1, 'active'),
  ('CT000016', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000009', 150000, 'Transfer', 'INV-2026-06-000009', NULL, 'PT-2', 1, 'active'),
  ('CT000017', '2026-06-11', 'OUT', 'Pembelian Stok', 'Bayar PO-2026-06-000008', 50000, 'Tunai', NULL, 'PO-2026-06-000008', 'PT-1', 1, 'active'),
  ('CT000018', '2026-06-11', 'OUT', 'Pembelian Stok', 'Bayar PO PO-2026-06-000009 (Edit)', 75000, 'Tunai', NULL, 'PO-2026-06-000009', 'PT-1', 1, 'active'),
  ('CT000019', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000010', 115000, 'Tunai', 'INV-2026-06-000010', NULL, 'PT-1', 1, 'active'),
  ('CT000020', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000011', 27750, 'Tunai', 'INV-2026-06-000011', NULL, 'PT-1', 1, 'active'),
  ('CT000021', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000012', 50000, 'Transfer', 'INV-2026-06-000012', NULL, 'PT-2', 1, 'active'),
  ('CT000022', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000014', 50000, 'Tunai', 'INV-2026-06-000014', NULL, 'PT-1', 1, 'active'),
  ('CT000023', '2026-06-11', 'IN', 'Penjualan', 'Pembayaran Invoice INV-2026-06-000015', 50000, 'Transfer', 'INV-2026-06-000015', NULL, 'PT-2', 1, 'active');

-- Settings
INSERT IGNORE INTO settings (`key`, value) VALUES 
  ('modal_pemilik', '0'),
  ('prefix_cash_transaction', 'CT'),
  ('prefix_customer', 'C'),
  ('prefix_product', 'P'),
  ('prefix_purchase', 'PO-{YYYY}-{MM}-'),
  ('prefix_sales', 'INV-{YYYY}-{MM}-'),
  ('prefix_vendor', 'V'),
  ('ppn_enabled', 'true'),
  ('pajak_default', '11');
