
require('dotenv').config();
const db = require('../config/db');
const logger = require('../config/logger');

const sampleInventory = [
  { sku: 'SKU-001', name: 'Wireless Mouse', qty: 50, priceCents: 2499 },
  { sku: 'SKU-002', name: 'Mechanical Keyboard', qty: 30, priceCents: 8999 },
  { sku: 'SKU-003', name: 'USB-C Hub', qty: 100, priceCents: 3499 },
  { sku: 'SKU-004', name: '27" Monitor', qty: 15, priceCents: 24999 },
];

async function seed() {
  try {
    for (const item of sampleInventory) {
      await db.query(
        `INSERT INTO inventory_items (sku, product_name, quantity_available, price_cents, currency)
         VALUES (?, ?, ?, ?, 'USD')
         ON DUPLICATE KEY UPDATE
           product_name = VALUES(product_name),
           quantity_available = VALUES(quantity_available),
           price_cents = VALUES(price_cents)`,
        [item.sku, item.name, item.qty, item.priceCents]
      );
    }
    logger.info('seed_complete', { itemsSeeded: sampleInventory.length });
    process.exit(0);
  } catch (err) {
    logger.error('seed_failed', { error: err.message });
    process.exit(1);
  }
}

seed();
