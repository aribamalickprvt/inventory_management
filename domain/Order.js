const Money = require('./valueObjects/Money');

/**
 * OrderLineItem - Entity (has identity, but lifecycle is owned by Order)
 */
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
 *
 * Week 3 lifecycle (async):
 *   DRAFT   -> line items are being assembled (API request handling)
 *   PENDING -> submitted, order.created event published, awaiting the Worker
 *   CONFIRMED -> Worker verified + reserved stock successfully
 *   REJECTED  -> Worker found insufficient stock (see rejectionReason)
 *   CANCELLED -> manual cancellation (unrelated to the async pipeline)
 *
 * Invariants enforced here, not in controllers/services:
 *   - Cannot be empty when submitted
 *   - Cannot add items once no longer DRAFT
 *   - Can only be confirmed/rejected from PENDING (the Worker's job)
 */
class Order {
  static STATUS = {
    DRAFT: 'DRAFT',
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    REJECTED: 'REJECTED',
    CANCELLED: 'CANCELLED',
  };

  constructor({ id, customerId, status = Order.STATUS.DRAFT, version = 1, rejectionReason = null }) {
    this.id = id;
    this.customerId = customerId;
    this.status = status;
    this.lineItems = [];
    this.version = version; // optimistic locking
    this.rejectionReason = rejectionReason;
  }

  addLineItem({ id, sku, quantity, unitPrice }) {
    if (this.status !== Order.STATUS.DRAFT) {
      throw new Error('Cannot modify an order once it has been submitted');
    }
    this.lineItems.push(new OrderLineItem({ id, sku, quantity, unitPrice }));
  }

  /** DRAFT -> PENDING. Called by OrderService right before the event is published. */
  submit() {
    if (this.status !== Order.STATUS.DRAFT) {
      throw new Error('Only a draft order can be submitted');
    }
    if (this.lineItems.length === 0) {
      throw new Error('Cannot submit an order with no line items');
    }
    this.status = Order.STATUS.PENDING;
  }

  /** PENDING -> CONFIRMED. Called by the Worker after stock is successfully reserved. */
  confirm() {
    if (this.status !== Order.STATUS.PENDING) {
      throw new Error('Only a pending order can be confirmed');
    }
    this.status = Order.STATUS.CONFIRMED;
  }

  /** PENDING -> REJECTED. Called by the Worker when stock cannot cover the order. */
  reject(reason) {
    if (this.status !== Order.STATUS.PENDING) {
      throw new Error('Only a pending order can be rejected');
    }
    this.status = Order.STATUS.REJECTED;
    this.rejectionReason = reason;
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
