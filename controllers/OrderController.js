const orderService = require("../services/OrderService");

class OrderController {
  async create(req, res) {
    try {
      const { customerId, items } = req.body;
      const order = await orderService.createOrder({ customerId, items });
      res.status(201).json({
        id: order.id,
        status: order.status,
        total: order.total.toString(),
        lineItems: order.lineItems.map((i) => ({
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
      const order = await orderService.getOrder(req.params.id);
      res.json({
        id: order.id,
        status: order.status,
        total: order.total.toString(),
      });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }

  async listAll(req, res) {
    try {
      const orders = await orderService.listOrders();
      res.json(orders);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new OrderController();
