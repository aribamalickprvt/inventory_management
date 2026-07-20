const db = require('../config/db');
class InventoryRepository {
  async findBySku(sku) {
    const [rows] = await db.query('SELECT * FROM inventory_items WHERE sku = ?', [sku]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      sku: row.sku,
      quantityAvailable: row.quantity_available,
      priceDollars: row.price_cents / 100,
      currency: row.currency,
      version: row.version,
    };
  }
}

module.exports = new InventoryRepository();
