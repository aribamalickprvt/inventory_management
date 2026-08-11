const orderReadModelRepository = require('../readmodel/OrderReadModelRepository');

/**
 * CQRS: Query side. This NEVER touches MySQL, the write-side repositories,
 * or the domain layer — it reads exclusively from the read store, which is
 * kept eventually consistent by syncWorker.js. This is the entire
 * performance point of CQRS: no aggregate reconstruction, no joins, just a
 * document fetch.
 *
 * Eventual consistency caveat: immediately after POST /api/orders returns,
 * the read store may not have caught up yet (the sync event is still in
 * flight). A GET right away can legitimately 404 or show a stale status for
 * a brief window — that's expected, not a bug. Clients should poll.
 */
class GetOrderQueryHandler {
  async handle(orderId) {
    const doc = await orderReadModelRepository.findById(orderId);
    if (!doc) throw new Error('Order not found (or read model has not synced yet)');
    return doc;
  }
}

module.exports = new GetOrderQueryHandler();
