const { randomUUID } = require('crypto');
const { Order } = require('../domain/Order');
const Money = require('../domain/valueObjects/Money');
const orderRepository = require('../repositories/OrderRepository');
const inventoryRepository = require('../repositories/InventoryRepository');
const orderEventPublisher = require('../events/OrderEventPublisher');

/**
 * OrderService
 * Owns the use-case orchestration: load aggregate(s), call domain methods,
 * persist. No SQL here, no req/res here.
 *
 * Week 3: order creation is now asynchronous. This method does the CHEAP,
 * fast-fail validation synchronously (does the SKU exist at all? — a client
 * input error, worth rejecting immediately) but deliberately does NOT check
 * or reserve *quantity* here. That's the expensive, contention-prone part
 * under real concurrent load, and it's deferred to the Worker so the HTTP
 * response never blocks on it.
 */
class OrderService {
  async createOrder({ customerId, items }) {
    const order = new Order({ id: randomUUID(), customerId });

    for (const { sku, quantity } of items) {
      const inventoryItem = await inventoryRepository.findBySku(sku);
      if (!inventoryItem) throw new Error(`Unknown SKU: ${sku}`);

      order.addLineItem({
        id: randomUUID(),
        sku,
        quantity,
        unitPrice: Money.fromDollars(inventoryItem.priceDollars, inventoryItem.currency),
      });
    }

    order.submit(); // DRAFT -> PENDING
    await orderRepository.save(order);
    await orderEventPublisher.publishOrderCreated({ orderId: order.id });

    return order; // status is PENDING — the Worker decides CONFIRMED vs REJECTED
  }

  async getOrder(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new Error('Order not found');
    return order;
  }

  async listOrders() {
    return orderRepository.findAll();
  }
}

module.exports = new OrderService();
