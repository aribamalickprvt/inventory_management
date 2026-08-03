const { randomUUID } = require('crypto');
const { getChannel, EXCHANGE, ROUTING_KEY_CREATED } = require('../config/rabbitmq');
const logger = require('../config/logger');

class OrderEventPublisher {
  async publishOrderCreated({ orderId }) {
    const channel = await getChannel();
    const event = {
      eventId: randomUUID(),
      eventType: 'order.created',
      orderId,
      occurredAt: new Date().toISOString(),
    };

    channel.publish(
      EXCHANGE,
      ROUTING_KEY_CREATED,
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true, // survives a RabbitMQ restart — matches the queue's durable: true
        contentType: 'application/json',
        headers: { 'x-retry-count': 0 },
      }
    );

    // orderId doubles as the correlation ID across every log line for this
    // order's lifecycle — API publish, Worker receive, retry, DLQ, all
    // greppable by the same value.
    logger.info('event_published', {
      eventType: event.eventType,
      eventId: event.eventId,
      correlationId: orderId,
      orderId,
    });

    return event;
  }
}

module.exports = new OrderEventPublisher();
