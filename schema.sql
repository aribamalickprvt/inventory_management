-- Aggregate: Order (root: orders)
CREATE TABLE orders (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  status ENUM('DRAFT', 'PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  rejection_reason VARCHAR(500) NULL,      -- set by the Worker if stock can't cover the order
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

-- Week 2: Auth — Entity: User
CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,     -- bcrypt hash, never plaintext
  role ENUM('ADMIN', 'CUSTOMER') NOT NULL DEFAULT 'CUSTOMER',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Week 2: Auth — sliding-window refresh tokens
-- token_hash stores SHA-256(token), never the raw token — DB leak != token leak.
CREATE TABLE refresh_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
