-- =============================================
-- SupplierPro Database Schema (MySQL)
-- =============================================

-- Master Tables
CREATE TABLE IF NOT EXISTS product_categories (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS product_units (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_categories (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS vendor_categories (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_types (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

-- Core Tables
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'kasir',
  active TINYINT(1) DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(255) PRIMARY KEY,
  sku VARCHAR(255),
  brand VARCHAR(255) DEFAULT NULL,
  name VARCHAR(255) NOT NULL,
  category_id VARCHAR(255),
  cost_price DECIMAL(20,4) DEFAULT 0,
  sell_price DECIMAL(20,4) DEFAULT 0,
  stock DECIMAL(20,4) DEFAULT 0,
  min_stock DECIMAL(20,4) DEFAULT 0,
  unit_id VARCHAR(255),
  FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (unit_id) REFERENCES product_units(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  customer_category_id VARCHAR(255),
  phone VARCHAR(255),
  city VARCHAR(255),
  address TEXT,
  credit_lmt DECIMAL(20,4) DEFAULT 0,
  ktp VARCHAR(50) DEFAULT NULL,
  npwp VARCHAR(50) DEFAULT NULL,
  nib VARCHAR(30) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  no_hp_2 VARCHAR(30) DEFAULT NULL,
  FOREIGN KEY (customer_category_id) REFERENCES customer_categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  vendor_category_id VARCHAR(255),
  phone VARCHAR(255),
  city VARCHAR(255),
  address TEXT,
  id_number VARCHAR(255),
  nama_bank VARCHAR(255),
  nomor_rek VARCHAR(255),
  pemilik_rek VARCHAR(255),
  FOREIGN KEY (vendor_category_id) REFERENCES vendor_categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id VARCHAR(255) PRIMARY KEY,
  product_id VARCHAR(255),
  type VARCHAR(10) NOT NULL,
  quantity DECIMAL(20,4) NOT NULL,
  reason TEXT,
  adjustment_date DATE DEFAULT (CURRENT_DATE),
  user_id INT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (type IN ('IN', 'OUT'))
);

CREATE TABLE IF NOT EXISTS sales_invoices (
  id VARCHAR(255) PRIMARY KEY,
  date DATE,
  customer_id VARCHAR(255),
  subtotal DECIMAL(20,4) DEFAULT 0,
  discount DECIMAL(20,4) DEFAULT 0,
  tax DECIMAL(20,4) DEFAULT 0,
  total DECIMAL(20,4) DEFAULT 0,
  paid_amount DECIMAL(20,4) DEFAULT 0,
  due_date DATE DEFAULT NULL,
  paid_date DATE DEFAULT NULL,
  payment_type_id VARCHAR(255),
  status VARCHAR(255) DEFAULT 'belum',
  user_id INT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_type_id) REFERENCES payment_types(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id VARCHAR(255) PRIMARY KEY,
  invoice_id VARCHAR(255),
  product_id VARCHAR(255),
  quantity DECIMAL(20,4) NOT NULL,
  price DECIMAL(20,4) NOT NULL,
  cost_price_snapshot DECIMAL(20,4) DEFAULT 0,
  customer_fee DECIMAL(20,4) DEFAULT 0,
  fee_notes TEXT,
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id VARCHAR(255) PRIMARY KEY,
  date DATE,
  vendor_id VARCHAR(255),
  subtotal DECIMAL(20,4) DEFAULT 0,
  discount DECIMAL(20,4) DEFAULT 0,
  tax DECIMAL(20,4) DEFAULT 0,
  total DECIMAL(20,4) DEFAULT 0,
  paid_amount DECIMAL(20,4) DEFAULT 0,
  due_date DATE DEFAULT NULL,
  paid_date DATE DEFAULT NULL,
  payment_type_id VARCHAR(255),
  status VARCHAR(255) DEFAULT 'proses',
  user_id INT,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_type_id) REFERENCES payment_types(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id VARCHAR(255) PRIMARY KEY,
  purchase_order_id VARCHAR(255),
  product_id VARCHAR(255),
  quantity DECIMAL(20,4) NOT NULL,
  cost DECIMAL(20,4) NOT NULL,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id VARCHAR(255) PRIMARY KEY,
  date DATE DEFAULT (CURRENT_DATE),
  type VARCHAR(10) NOT NULL,
  category VARCHAR(255),
  description TEXT,
  amount DECIMAL(20,4) NOT NULL,
  method VARCHAR(255),
  invoice_id VARCHAR(255),
  purchase_order_id VARCHAR(255),
  payment_type_id VARCHAR(255),
  user_id INT,
  status VARCHAR(20) DEFAULT 'active',
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_type_id) REFERENCES payment_types(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (type IN ('IN', 'OUT'))
);

CREATE TABLE IF NOT EXISTS invoice_counters (
  year INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(255) PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS cash_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(10) DEFAULT 'BOTH',
  is_system TINYINT(1) DEFAULT 0,
  CHECK (type IN ('IN', 'OUT', 'BOTH'))
);
