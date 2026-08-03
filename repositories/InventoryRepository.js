const db = require('../config/db');

/**
 * InventoryRepository — separate aggregate from Order.
 * Orders reference inventory by SKU id only, never by object reference.
 */
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
  /**
   * Week 3: called only by the Worker, never by the API directly — this is
   * exactly the operation that moving to async unblocks: the HTTP response
   * no longer waits on it, and it's safe under concurrent orders because the
   * WHERE clause re-checks quantity_available atomically inside the UPDATE
   * itself (no separate read-then-write race window).
   */
  async decrementStock(sku, quantity) {
    const [result] = await db.query(
      `UPDATE inventory_items
       SET quantity_available = quantity_available - ?, version = version + 1
       WHERE sku = ? AND quantity_available >= ?`,
      [quantity, sku, quantity]
    );
    if (result.affectedRows === 0) {
      throw new Error(`Could not reserve stock for SKU ${sku} — insufficient quantity or concurrent update`);
    }
  }
}

module.exports = new InventoryRepository();
