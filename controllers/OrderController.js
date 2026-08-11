const createOrderCommandHandler = require('../commands/CreateOrderCommandHandler');
const getOrderQueryHandler = require('../queries/GetOrderQueryHandler');
const listOrdersQueryHandler = require('../queries/ListOrdersQueryHandler');

/**
 * CQRS at the controller boundary: writes go to a Command handler, reads go
 * to Query handlers. Neither knows the other exists.
 */
class OrderController {
  async create(req, res) {
    try {
      const { customerId, items } = req.body;
      const order = await createOrderCommandHandler.handle({ customerId, items });
      // 202, not 201 — the order has been ACCEPTED for processing, not yet
      // confirmed. The Worker decides CONFIRMED vs REJECTED asynchronously.
      res.status(202).json({
        id: order.id,
        status: order.status,
        estimatedTotal: order.total.toString(),
        lineItems: order.lineItems.map(i => ({
          sku: i.sku,
          quantity: i.quantity,
          lineTotal: i.lineTotal.toString(),
        })),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async getById(req, res) {
    try {
      const doc = await getOrderQueryHandler.handle(req.params.id);
      res.json({
        id: doc.orderId,
        status: doc.status,
        total: doc.total,
        rejectionReason: doc.rejectionReason,
      });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }

  async listAll(req, res) {
    try {
      const docs = await listOrdersQueryHandler.handle();
      res.json(docs.map(d => ({ id: d.orderId, customerId: d.customerId, status: d.status })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new OrderController();
