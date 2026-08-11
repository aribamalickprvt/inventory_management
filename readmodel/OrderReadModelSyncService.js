const orderReadModelRepository = require('./OrderReadModelRepository');
const logger = require('../config/logger');

/**
 * The actual "apply this snapshot to the read store" logic, deliberately
 * separated from syncWorker.js's RabbitMQ plumbing — mirrors the Week 3
 * pattern where OrderProcessingService.processOrder() is the function both
 * worker.js AND tests call directly, rather than tests needing a live
 * consumer loop running.
 */
class OrderReadModelSyncService {
  async syncSnapshot(snapshot) {
    await orderReadModelRepository.upsert(snapshot);
    logger.info('readmodel_synced', {
      correlationId: snapshot.orderId,
      orderId: snapshot.orderId,
      status: snapshot.status,
    });
  }
}

module.exports = new OrderReadModelSyncService();
