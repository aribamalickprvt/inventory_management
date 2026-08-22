const express = require('express');
const request = require('supertest');
const { randomUUID } = require('crypto');
const rateLimiter = require('../middleware/rateLimiter');
const redisClient = require('../config/redis');

/**
 * These build a small, isolated Express app using the SAME rateLimiter
 * middleware factory the real app uses, but with a tiny deliberately-set
 * capacity and a randomly-generated key prefix — so this suite can't
 * collide with buckets the rest of the test suite (or a live server) is
 * also touching in the same Redis instance.
 */
function buildTestApp({ capacity, refillRatePerSec, keyPrefix }) {
  const app = express();
  app.use(rateLimiter({ capacity, refillRatePerSec, keyPrefix }));
  app.get('/ping', (req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('Token bucket rate limiter', () => {
  test('allows requests up to capacity, then returns 429', async () => {
    const app = buildTestApp({ capacity: 3, refillRatePerSec: 1, keyPrefix: `test:${randomUUID()}` });

    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/ping');
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 200)).toHaveLength(3); // exactly `capacity` allowed
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  test('429 response body has the expected shape', async () => {
    const app = buildTestApp({ capacity: 1, refillRatePerSec: 1, keyPrefix: `test:${randomUUID()}` });

    await request(app).get('/ping'); // consume the only token
    const res = await request(app).get('/ping');

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED');
  });

  test('sets X-RateLimit-* response headers', async () => {
    const app = buildTestApp({ capacity: 5, refillRatePerSec: 1, keyPrefix: `test:${randomUUID()}` });

    const res = await request(app).get('/ping');
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeLessThanOrEqual(5);
  });

  test('refills tokens over time at the configured rate', async () => {
    const app = buildTestApp({ capacity: 2, refillRatePerSec: 2, keyPrefix: `test:${randomUUID()}` }); // 1 token per 500ms

    await request(app).get('/ping');
    await request(app).get('/ping');
    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 600)); // wait for >= 1 token to refill

    const afterRefill = await request(app).get('/ping');
    expect(afterRefill.status).toBe(200);
  });

  test('different identities (key prefixes) get independent buckets', async () => {
    const keyPrefix = `test:${randomUUID()}`;
    const app = express();
    app.use(rateLimiter({
      capacity: 1,
      refillRatePerSec: 1,
      keyPrefix,
      keyFn: (req) => req.headers['x-test-user'], // simulate two different callers
    }));
    app.get('/ping', (req, res) => res.status(200).json({ ok: true }));

    const userA1 = await request(app).get('/ping').set('x-test-user', 'alice');
    const userA2 = await request(app).get('/ping').set('x-test-user', 'alice');
    const userB1 = await request(app).get('/ping').set('x-test-user', 'bob');

    expect(userA1.status).toBe(200);
    expect(userA2.status).toBe(429); // alice's bucket (capacity 1) is now empty
    expect(userB1.status).toBe(200); // bob has his own, untouched bucket
  });

  test('fails open (request still succeeds) when Redis is unreachable', async () => {
    const app = buildTestApp({ capacity: 1, refillRatePerSec: 1, keyPrefix: `test:${randomUUID()}` });

    redisClient.disconnect(); // simulate an outage

    const res = await request(app).get('/ping');
    expect(res.status).toBe(200); // did NOT get rejected just because Redis is down

    redisClient.connect().catch(() => {}); // reconnect for any tests that run after this one
    await new Promise((resolve) => setTimeout(resolve, 300)); // give ioredis a moment to reconnect
  });
});

afterAll(async () => {
  await redisClient.quit().catch(() => {});
});
