const db = require('../config/db');
const { Order, OrderLineItem } = require('../domain/Order');
const Money = require('../domain/valueObjects/Money');
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
}

module.exports = new OrderRepository();
