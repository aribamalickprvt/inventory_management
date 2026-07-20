const Money = require('./valueObjects/Money');

 
 //OrderLineItem - Entity (has identity, but lifecycle is owned by Order)
 
class OrderLineItem {
  constructor({ id, sku, quantity, unitPrice }) {
    if (quantity <= 0) throw new Error('Quantity must be positive');
    this.id = id;
    this.sku = sku; // reference by ID only — never a live InventoryItem object
    this.quantity = quantity;
    this.unitPrice = unitPrice; // Money value object
  }

  get lineTotal() {
    return this.unitPrice.multiply(this.quantity);
  }
}

/**
 * Order - Aggregate Root
 * Invariants enforced here, not in controllers/services:
 *   - Cannot be empty
 *   - Cannot add items once CONFIRMED
 *   - Total is always derived, never set directly
 */
class Order {
  static STATUS = {
    DRAFT: 'DRAFT',
    CONFIRMED: 'CONFIRMED',
    CANCELLED: 'CANCELLED',
  };

  constructor({ id, customerId, status = Order.STATUS.DRAFT, version = 1 }) {
    this.id = id;
    this.customerId = customerId;
    this.status = status;
    this.lineItems = [];
    this.version = version; // optimistic locking — needed later for CQRS/concurrency
  }

  addLineItem({ id, sku, quantity, unitPrice }) {
    if (this.status !== Order.STATUS.DRAFT) {
      throw new Error('Cannot modify a confirmed or cancelled order');
    }
    this.lineItems.push(new OrderLineItem({ id, sku, quantity, unitPrice }));
  }

  confirm() {
    if (this.lineItems.length === 0) {
      throw new Error('Cannot confirm an order with no line items');
    }
    this.status = Order.STATUS.CONFIRMED;
  }

  cancel() {
    if (this.status === Order.STATUS.CONFIRMED) {
      throw new Error('Cannot cancel a confirmed order without a compensating event');
    }
    this.status = Order.STATUS.CANCELLED;
  }

  get total() {
    return this.lineItems.reduce(
      (sum, item) => sum.add(item.lineTotal),
      Money.zero(this.lineItems[0]?.unitPrice.currency || 'USD')
    );
  }
}

module.exports = { Order, OrderLineItem };
