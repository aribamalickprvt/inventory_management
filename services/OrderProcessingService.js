const orderRepository = require('../repositories/OrderRepository');
const inventoryRepository = require('../repositories/InventoryRepository');
const { Order } = require('../domain/Order');
const logger = require('../config/logger');

class OrderProcessingService {
  /**
   * Called by the Worker for every order.created event it consumes.
   * Idempotent: RabbitMQ is at-least-once delivery, so the same event can
   * arrive twice (e.g. after a redelivered-but-already-acked edge case, or
   * a retry that raced with a successful first attempt). If the order has
   * already left PENDING, this is a no-op.
   */
  async processOrder(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order) {
      // Could be DB replication lag right after the API's write — treat as
      // transient so the Worker's retry logic gives it another chance.
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status !== Order.STATUS.PENDING) {
      logger.info('order_already_processed', { orderId, correlationId: orderId, currentStatus: order.status });
      return { outcome: 'SKIPPED', status: order.status };
    }

    const shortages = [];
    for (const item of order.lineItems) {
      const inventoryItem = await inventoryRepository.findBySku(item.sku);
      if (!inventoryItem || inventoryItem.quantityAvailable < item.quantity) {
        shortages.push(item.sku);
      }
    }

    const expectedVersion = order.version; // snapshot before any in-memory mutation

    if (shortages.length > 0) {
      order.reject(`Insufficient stock for: ${shortages.join(', ')}`);
      await orderRepository.updateStatus(order.id, order.status, expectedVersion, order.rejectionReason);
      logger.info('order_rejected', { orderId, correlationId: orderId, reason: order.rejectionReason });
      return { outcome: 'REJECTED', reason: order.rejectionReason };
    }

    for (const item of order.lineItems) {
      await inventoryRepository.decrementStock(item.sku, item.quantity);
    }

    order.confirm();
    await orderRepository.updateStatus(order.id, order.status, expectedVersion);
    logger.info('order_confirmed', { orderId, correlationId: orderId });
    return { outcome: 'CONFIRMED' };
  }
}

module.exports = new OrderProcessingService();
