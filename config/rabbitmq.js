const amqp = require('amqplib');
const env = require('./env');
const logger = require('./logger');

/**
 * Topology:
 *
 *   orders_exchange (direct) --[order.created]--> order_processing_queue  <-- Worker consumes here
 *
 *   orders_retry_exchange (direct) --[order.retry]--> order_retry_queue
 *     order_retry_queue has NO consumer. Each message carries its own
 *     per-message TTL (set at publish time = exponential backoff delay).
 *     When that TTL expires, the queue's dead-letter-exchange config
 *     automatically re-routes the message back into orders_exchange /
 *     order_processing_queue — i.e. "retry after a delay", built entirely
 *     out of standard RabbitMQ primitives (no delay plugin required).
 *
 *   orders_dlq_exchange (direct) --[order.dead]--> order_dlq
 *     Final resting place once RETRY_MAX_ATTEMPTS is exhausted. Nothing
 *     auto-consumes this — a human (or a future alerting job) inspects it.
 */
const EXCHANGE = 'orders_exchange';
const QUEUE_PROCESSING = 'order_processing_queue';
const ROUTING_KEY_CREATED = 'order.created';

const RETRY_EXCHANGE = 'orders_retry_exchange';
const RETRY_QUEUE = 'order_retry_queue';
const ROUTING_KEY_RETRY = 'order.retry';

const DLQ_EXCHANGE = 'orders_dlq_exchange';
const DLQ_QUEUE = 'order_dlq';
const ROUTING_KEY_DEAD = 'order.dead';

let connection = null;
let channel = null;

async function getChannel() {
  if (channel) return channel;

  connection = await amqp.connect(env.RABBITMQ_URL);
  connection.on('error', (err) => logger.error('rabbitmq_connection_error', { error: err.message }));
  connection.on('close', () => {
    logger.warn('rabbitmq_connection_closed');
    channel = null;
    connection = null;
  });

  channel = await connection.createChannel();
  await setupTopology(channel);
  return channel;
}

async function setupTopology(ch) {
  await ch.assertExchange(EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(QUEUE_PROCESSING, { durable: true });
  await ch.bindQueue(QUEUE_PROCESSING, EXCHANGE, ROUTING_KEY_CREATED);

  await ch.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGE,
      'x-dead-letter-routing-key': ROUTING_KEY_CREATED,
    },
  });
  await ch.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, ROUTING_KEY_RETRY);

  await ch.assertExchange(DLQ_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(DLQ_QUEUE, { durable: true });
  await ch.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, ROUTING_KEY_DEAD);
}

async function closeConnection() {
  if (channel) await channel.close().catch(() => {});
  if (connection) await connection.close().catch(() => {});
  channel = null;
  connection = null;
}

module.exports = {
  getChannel,
  closeConnection,
  EXCHANGE,
  QUEUE_PROCESSING,
  ROUTING_KEY_CREATED,
  RETRY_EXCHANGE,
  RETRY_QUEUE,
  ROUTING_KEY_RETRY,
  DLQ_EXCHANGE,
  DLQ_QUEUE,
  ROUTING_KEY_DEAD,
};
