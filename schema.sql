-- Aggregate: Order (root: orders)
CREATE TABLE orders (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  status ENUM('DRAFT', 'CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,          -- optimistic locking
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Entity within Order aggregate (owned lifecycle, no independent existence)
CREATE TABLE order_line_items (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  sku VARCHAR(64) NOT NULL,                -- reference by ID only, no FK to inventory_items
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Aggregate: Inventory (root: inventory_items) — separate bounded context
CREATE TABLE inventory_items (
  sku VARCHAR(64) PRIMARY KEY,
  product_name VARCHAR(255) NOT NULL,
  quantity_available INT NOT NULL DEFAULT 0,
  price_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  version INT NOT NULL DEFAULT 1
);
