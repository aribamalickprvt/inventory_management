const Redis = require('ioredis');
const env = require('./env');
const logger = require('./logger');

/**
 * maxRetriesPerRequest: 1 + enableOfflineQueue: false is deliberate: if
 * Redis is down, a command should fail FAST (one attempt, then reject)
 * rather than hang or queue indefinitely waiting for a reconnect. That's
 * what makes graceful degradation possible in middleware/rateLimiter.js —
 * it can only "fail open" quickly if the failure itself arrives quickly.
 *
 * retryStrategy still runs in the background so the client reconnects on
 * its own once Redis comes back — this only affects how fast an
 * in-flight command gives up, not whether the client keeps trying overall.
 */
const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  },
  lazyConnect: false,
});

redisClient.on('error', (err) => {
  logger.warn('redis_connection_error', { error: err.message });
});

redisClient.on('connect', () => {
  logger.info('redis_connected');
});

module.exports = redisClient;
