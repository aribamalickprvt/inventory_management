require('dotenv').config();
const env = require('./config/env');
const logger = require('./config/logger');
const {
  getChannel,
  closeConnection,
  QUEUE_PROCESSING,
  RETRY_EXCHANGE,
  ROUTING_KEY_RETRY,
  DLQ_EXCHANGE,
  ROUTING_KEY_DEAD,
} = require('./config/rabbitmq');
const orderProcessingService = require('./services/OrderProcessingService');
const { decideRetry } = require('./worker/retryPolicy');

async function handleMessage(channel, msg) {
  if (!msg) return;

  let event;
  try {
    event = JSON.parse(msg.content.toString());
  } catch (err) {
    logger.error('event_parse_failed', { error: err.message, raw: msg.content.toString() });
    channel.ack(msg); // malformed — nothing sensible to retry, drop it
    return;
  }

  const retryCount = msg.properties.headers?.['x-retry-count'] || 0;

  logger.info('event_received', {
    eventType: event.eventType,
    eventId: event.eventId,
    correlationId: event.orderId,
    orderId: event.orderId,
    retryCount,
  });

  try {
    const result = await orderProcessingService.processOrder(event.orderId);
    logger.info('event_processed', {
      eventId: event.eventId,
      correlationId: event.orderId,
      orderId: event.orderId,
      outcome: result.outcome,
      retryCount,
    });
    channel.ack(msg);
  } catch (err) {
    logger.error('event_processing_failed', {
      eventId: event.eventId,
      correlationId: event.orderId,
      orderId: event.orderId,
      error: err.message,
      retryCount,
    });
    await handleFailure(channel, msg, event, retryCount, err);
  }
}

async function handleFailure(channel, msg, event, retryCount, err) {
  const decision = decideRetry({
    retryCount,
    maxAttempts: env.RETRY_MAX_ATTEMPTS,
    baseDelayMs: env.RETRY_BASE_DELAY_MS,
  });

  if (decision.action === 'DEAD_LETTER') {
    channel.publish(
      DLQ_EXCHANGE,
      ROUTING_KEY_DEAD,
      Buffer.from(JSON.stringify({ ...event, lastError: err.message, failedAttempts: retryCount })),
      { persistent: true, contentType: 'application/json' }
    );
    logger.error('event_dead_lettered', {
      eventId: event.eventId,
      correlationId: event.orderId,
      orderId: event.orderId,
      attempts: retryCount,
      error: err.message,
    });
    channel.ack(msg); // remove from the main queue — it now lives in the DLQ
    return;
  }

  // RETRY: publish a delayed copy into the retry queue, then ack the original.
  // The retry queue's per-message TTL (`expiration`) + its dead-letter config
  // (see config/rabbitmq.js) is what makes the delay happen — no timers here.
  channel.publish(
    RETRY_EXCHANGE,
    ROUTING_KEY_RETRY,
    Buffer.from(JSON.stringify(event)),
    {
      persistent: true,
      contentType: 'application/json',
      expiration: String(decision.delayMs),
      headers: { 'x-retry-count': decision.nextRetryCount },
    }
  );
  logger.warn('event_retry_scheduled', {
    eventId: event.eventId,
    correlationId: event.orderId,
    orderId: event.orderId,
    nextRetryCount: decision.nextRetryCount,
    delayMs: decision.delayMs,
  });
  channel.ack(msg);
}

async function start() {
  const channel = await getChannel();
  await channel.prefetch(1); // one message at a time — simple, predictable backpressure
  logger.info('worker_started', { queue: QUEUE_PROCESSING });
  channel.consume(QUEUE_PROCESSING, (msg) => handleMessage(channel, msg));
}

async function shutdown(signal) {
  logger.info('worker_shutting_down', { signal });
  await closeConnection();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.error('worker_startup_failed', { error: err.message });
  process.exit(1);
});
