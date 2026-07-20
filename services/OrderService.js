const { randomUUID } = require('crypto');
const { Order } = require('../domain/Order');
const Money = require('../domain/valueObjects/Money');
const orderRepository = require('../repositories/OrderRepository');
const inventoryRepository = require('../repositories/InventoryRepository');
 
class OrderService {
  async createOrder({ customerId, items }) {
    const order = new Order({ id: randomUUID(), customerId });

    for (const { sku, quantity } of items) {
      const inventoryItem = await inventoryRepository.findBySku(sku);
      if (!inventoryItem) throw new Error(`Unknown SKU: ${sku}`);
      if (inventoryItem.quantityAvailable < quantity) {
        throw new Error(`Insufficient stock for SKU ${sku}`);
      }

      order.addLineItem({
        id: randomUUID(),
        sku,
        quantity,
        unitPrice: Money.fromDollars(inventoryItem.priceDollars, inventoryItem.currency),
      });
    }

    order.confirm();
    await orderRepository.save(order);

    //  this is where an OrderConfirmed event gets published
    // to RabbitMQ/Kafka instead of directly decrementing inventory here.
    return order;
  }

  async getOrder(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new Error('Order not found');
    return order;
  }
}

module.exports = new OrderService();
