const db = require('../config/db');
const { Order, OrderLineItem } = require('../domain/Order');
const Money = require('../domain/valueObjects/Money');

/**
 * OrderRepository
 * Rule: this layer only knows SQL. It never validates business rules —
 * that's the domain layer's job. It just persists/reconstructs aggregates.
 */
class OrderRepository {
  async findById(orderId) {
    const [orderRows] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (orderRows.length === 0) return null;

    const [lineRows] = await db.query(
      'SELECT * FROM order_line_items WHERE order_id = ?',
      [orderId]
    );

    const orderRow = orderRows[0];
    const order = new Order({
      id: orderRow.id,
      customerId: orderRow.customer_id,
      status: orderRow.status,
      version: orderRow.version,
      rejectionReason: orderRow.rejection_reason,
    });

    for (const row of lineRows) {
      order.lineItems.push(
        new OrderLineItem({
          id: row.id,
          sku: row.sku,
          quantity: row.quantity,
          unitPrice: new Money(row.unit_price_cents, row.currency),
        })
      );
    }
    return order;
  }

  // Note: there is deliberately no findAll() here anymore. Week 4 moved
  // listing to ListOrdersQueryHandler, which reads from the denormalized
  // read store (readmodel/OrderReadModelRepository) instead of MySQL — the
  // whole point of CQRS is that the write store no longer serves list/read
  // traffic at all.

  async save(order) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // New orders always get a plain INSERT (fresh UUID each time, so no conflict).
      const [result] = await conn.query(
        `INSERT INTO orders (id, customer_id, status, version)
         VALUES (?, ?, ?, ?)`,
        [order.id, order.customerId, order.status, order.version]
      );

      for (const item of order.lineItems) {
        await conn.query(
          `INSERT IGNORE INTO order_line_items
             (id, order_id, sku, quantity, unit_price_cents, currency)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [item.id, order.id, item.sku, item.quantity, item.unitPrice.amountInCents, item.unitPrice.currency]
        );
      }

      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Week 3: real optimistic-locking UPDATE, the piece Week 1 deferred.
   * The WHERE clause checks BOTH id and the version the caller last read.
   * If another process (a duplicate worker delivery, a concurrent retry)
   * already moved this order forward, affectedRows comes back 0 — we throw,
   * and the Worker's retry/backoff logic treats that as a transient failure.
   */
  async updateStatus(orderId, status, expectedVersion, rejectionReason = null) {
    const [result] = await db.query(
      `UPDATE orders
       SET status = ?, rejection_reason = ?, version = version + 1
       WHERE id = ? AND version = ?`,
      [status, rejectionReason, orderId, expectedVersion]
    );
    if (result.affectedRows === 0) {
      throw new Error(
        `Optimistic lock conflict: order ${orderId} was not at expected version ${expectedVersion}`
      );
    }
  }
}

module.exports = new OrderRepository();
