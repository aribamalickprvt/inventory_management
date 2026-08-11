const { randomUUID } = require('crypto');
const { Order } = require('../domain/Order');
const Money = require('../domain/valueObjects/Money');
const orderRepository = require('../repositories/OrderRepository');
const inventoryRepository = require('../repositories/InventoryRepository');
const orderEventPublisher = require('../events/OrderEventPublisher');
const readModelSyncPublisher = require('../events/ReadModelSyncPublisher');

/**
 * CQRS: Command side. Writes go through the domain and the write store
 * (MySQL) exactly as in Weeks 1-3 — CQRS changes how READS work, not how
 * writes work. This class replaces the old OrderService.createOrder().
 *
 * After a successful write, TWO independent events fire:
 *   1. order.created           -> Week 3 processing pipeline (stock
 *      check/reservation), consumed by worker.js.
 *   2. a read-model snapshot   -> Week 4 sync pipeline that keeps the
 *      separate Read Store eventually consistent, consumed by syncWorker.js.
 * They're deliberately independent — the processing pipeline doesn't know
 * the read store exists, and the sync pipeline doesn't know or care about
 * stock levels. Each does exactly one job.
 */
class CreateOrderCommandHandler {
  async handle({ customerId, items }) {
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
    await readModelSyncPublisher.publishOrderSnapshot(order);

    return order; // status is PENDING — the Worker decides CONFIRMED vs REJECTED
  }
}

module.exports = new CreateOrderCommandHandler();
