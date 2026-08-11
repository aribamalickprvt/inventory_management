const { getDb } = require('../config/mongo');

const COLLECTION = 'orders_read';

/**
 * CQRS: this is the ONLY repository the Query side is allowed to touch.
 * Documents here are denormalized — status, total, and line items all live
 * on one document, no joins needed. That's the entire performance case for
 * separating reads from writes: MySQL's OrderRepository.findById() has to
 * run two queries and reconstruct a domain aggregate; this is one document
 * fetch by _id.
 */
class OrderReadModelRepository {
  async upsert(snapshot) {
    const db = await getDb();
    await db.collection(COLLECTION).replaceOne(
      { _id: snapshot.orderId },
      { _id: snapshot.orderId, ...snapshot },
      { upsert: true }
    );
  }

  async findById(orderId) {
    const db = await getDb();
    return db.collection(COLLECTION).findOne({ _id: orderId });
  }

  async findAll({ limit = 50 } = {}) {
    const db = await getDb();
    return db
      .collection(COLLECTION)
      .find({})
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  }
}

module.exports = new OrderReadModelRepository();
