require('dotenv').config();
require('./tracing').start('inventory-sync-worker'); // must run before anything else is required

const logger = require('./config/logger');
const { getChannel, closeConnection, SYNC_QUEUE } = require('./config/rabbitmq');
const { closeMongo } = require('./config/mongo');
const orderReadModelSyncService = require('./readmodel/OrderReadModelSyncService');
const { runInPropagatedContext } = require('./config/otelContext');

async function handleMessage(channel, msg) {
  if (!msg) return;

  let snapshot;
  try {
    snapshot = JSON.parse(msg.content.toString());
  } catch (err) {
    logger.error('sync_event_parse_failed', { error: err.message });
    channel.ack(msg); // malformed — nothing sensible to retry
    return;
  }

  await runInPropagatedContext(
    'inventory-sync-worker',
    'sync order read model',
    msg.properties.headers,
    async (span) => {
      span.setAttribute('order.id', snapshot.orderId);
      span.setAttribute('order.status', snapshot.status);

      logger.info('sync_event_received', {
        correlationId: snapshot.orderId,
        orderId: snapshot.orderId,
        status: snapshot.status,
      });

      try {
        await orderReadModelSyncService.syncSnapshot(snapshot);
        channel.ack(msg);
      } catch (err) {
        // Mongo's replaceOne(_id, ..., {upsert:true}) is naturally idempotent —
        // applying the same snapshot twice is harmless. That means, unlike the
        // Week 3 order-processing Worker (which must never double-decrement
        // stock), a simple requeue-and-retry is completely safe here. A full
        // exponential-backoff + DLQ pipeline would be solving a problem this
        // step doesn't actually have.
        span.recordException(err);
        logger.error('sync_event_failed', {
          correlationId: snapshot.orderId,
          orderId: snapshot.orderId,
          error: err.message,
        });
        channel.nack(msg, false, true); // requeue
      }
    }
  );
}

async function start() {
  const channel = await getChannel();
  await channel.prefetch(5);
  logger.info('sync_worker_started', { queue: SYNC_QUEUE });
  channel.consume(SYNC_QUEUE, (msg) => handleMessage(channel, msg));
}

async function shutdown(signal) {
  logger.info('sync_worker_shutting_down', { signal });
  await closeConnection();
  await closeMongo();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.error('sync_worker_startup_failed', { error: err.message });
  process.exit(1);
});
