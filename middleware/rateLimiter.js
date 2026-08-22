const redisClient = require('../config/redis');
const logger = require('../config/logger');

/**
 * Token Bucket, implemented from scratch as a single atomic Redis Lua
 * script — NOT a rate-limiting library. Running the whole
 * read-refill-consume-write cycle as one EVAL is what makes this safe
 * under concurrent requests: two requests hitting the same bucket at the
 * same instant can't both read "3 tokens left" and both proceed, because
 * Redis executes Lua scripts atomically (single-threaded, no interleaving).
 * A naive GET-then-SET in application code would have exactly that race.
 *
 * Algorithm: each bucket has a capacity and a refill rate (tokens/second).
 * On every request, first "top up" the bucket based on how much time has
 * passed since it was last touched (capped at capacity), then attempt to
 * spend one token. If there's a token, allow the request; if not, reject.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'timestamp')
local tokens = tonumber(bucket[1])
local last_timestamp = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last_timestamp = now
end

local elapsed_ms = math.max(0, now - last_timestamp)
local refill = (elapsed_ms / 1000) * refill_rate
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'timestamp', now)
-- bucket is idle-expired well after it could possibly be full again, so we
-- don't leak keys for identities that stop making requests
redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)

return { allowed, tokens }
`;

/**
 * @param {object} options
 * @param {number} options.capacity - max tokens the bucket can hold (burst size)
 * @param {number} options.refillRatePerSec - tokens added back per second
 * @param {string} options.keyPrefix - namespaces buckets (e.g. 'ratelimit:api')
 * @param {(req) => string} [options.keyFn] - how to identify the caller;
 *        defaults to authenticated user id if present, else IP address
 */
function rateLimiter({ capacity, refillRatePerSec, keyPrefix, keyFn }) {
  const resolveKey = keyFn || ((req) => req.user?.id || req.ip);

  return async function rateLimiterMiddleware(req, res, next) {
    const identity = resolveKey(req);
    const key = `${keyPrefix}:${identity}`;

    try {
      const now = Date.now();
      const [allowed, remaining] = await redisClient.eval(
        TOKEN_BUCKET_SCRIPT,
        1,
        key,
        capacity,
        refillRatePerSec,
        now,
        1
      );

      res.setHeader('X-RateLimit-Limit', capacity);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, Math.floor(remaining)));

      if (!allowed) {
        logger.warn('rate_limit_exceeded', { identity, keyPrefix });
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: 'Too many requests — please slow down and try again shortly.',
        });
      }

      next();
    } catch (err) {
      // Graceful degradation: Redis being down should never take the whole
      // API down with it. Fail OPEN — let the request through — rather than
      // fail closed and reject every request because an unrelated piece of
      // infrastructure is unavailable. The tradeoff (temporarily unlimited
      // traffic during a Redis outage) is deliberate and logged loudly so
      // it's visible in monitoring rather than silently swallowed.
      logger.warn('rate_limiter_fail_open', { error: err.message, identity, keyPrefix });
      next();
    }
  };
}

module.exports = rateLimiter;
