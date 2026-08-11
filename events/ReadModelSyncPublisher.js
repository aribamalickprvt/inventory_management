const { getChannel, SYNC_EXCHANGE } = require('../config/rabbitmq');
const logger = require('../config/logger');

/**
 * Called from two places: CreateOrderCommandHandler (after saving PENDING),
 * and OrderProcessingService (after CONFIRMED/REJECTED). Every order state
 * change gets broadcast here, independently of the Week 3 processing
 * pipeline — this publisher has no idea whether stock was reserved, only
 * that "the order looks like this now, keep the read store in sync."
 */
class ReadModelSyncPublisher {
  async publishOrderSnapshot(order) {
    const channel = await getChannel();

    const snapshot = {
      orderId: order.id,
      customerId: order.customerId,
      status: order.status,
      total: order.total.toString(),
      rejectionReason: order.rejectionReason,
      lineItems: order.lineItems.map(item => ({
        sku: item.sku,
        quantity: item.quantity,
        lineTotal: item.lineTotal.toString(),
      })),
      updatedAt: new Date().toISOString(),
    };

    channel.publish(
      SYNC_EXCHANGE,
      '', // fanout — routing key is ignored
      Buffer.from(JSON.stringify(snapshot)),
      { persistent: true, contentType: 'application/json' }
    );

    logger.info('readmodel_sync_event_published', {
      correlationId: order.id,
      orderId: order.id,
      status: order.status,
    });

    return snapshot;
  }
}

module.exports = new ReadModelSyncPublisher();
