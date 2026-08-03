const request = require('supertest');
const { randomUUID } = require('crypto');
const app = require('../app');
const db = require('../config/db');

/**
 * These are true integration tests — they hit a real MySQL database (the
 * one defined in .env / docker-compose), not a mock. Run `npm run seed`
 * first so SKU-001 exists for the order-creation tests.
 *
 * Each test registers its own uniquely-emailed user to avoid collisions
 * between test runs.
 */

function uniqueEmail() {
  return `test-${randomUUID()}@example.com`;
}

describe('Auth flow', () => {
  const password = 'correct-horse-battery-staple';
  let email;

  beforeEach(() => {
    email = uniqueEmail();
  });

  test('POST /api/auth/register creates a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password, role: 'CUSTOMER' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(res.body.role).toBe('CUSTOMER');
    expect(res.body.passwordHash).toBeUndefined(); // never leak the hash
  });

  test('POST /api/auth/register rejects a duplicate email', async () => {
    await request(app).post('/api/auth/register').send({ email, password });
    const res = await request(app).post('/api/auth/register').send({ email, password });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('POST /api/auth/register rejects a short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'short' });

    expect(res.status).toBe(400);
  });

  test('POST /api/auth/login issues an access + refresh token pair', async () => {
    await request(app).post('/api/auth/register').send({ email, password });
    const res = await request(app).post('/api/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.tokenType).toBe('Bearer');
  });

  test('POST /api/auth/login rejects wrong password', async () => {
    await request(app).post('/api/auth/register').send({ email, password });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  test('POST /api/auth/login rejects unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail(), password });

    expect(res.status).toBe(401);
  });

  test('POST /api/auth/refresh rotates the refresh token and issues a new pair', async () => {
    await request(app).post('/api/auth/register').send({ email, password });
    const loginRes = await request(app).post('/api/auth/login').send({ email, password });
    const oldRefreshToken = loginRes.body.refreshToken;

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refreshToken).toBeDefined();
    expect(refreshRes.body.refreshToken).not.toBe(oldRefreshToken); // rotated

    // sliding window: the OLD token must now be dead (single use)
    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefreshToken });
    expect(reuseRes.status).toBe(401);
  });

  test('POST /api/auth/refresh rejects an invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });

    expect(res.status).toBe(401);
  });

  test('POST /api/auth/logout revokes the refresh token', async () => {
    await request(app).post('/api/auth/register').send({ email, password });
    const loginRes = await request(app).post('/api/auth/login').send({ email, password });
    const refreshToken = loginRes.body.refreshToken;

    const logoutRes = await request(app).post('/api/auth/logout').send({ refreshToken });
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});

describe('RBAC on order routes', () => {
  const password = 'correct-horse-battery-staple';

  async function registerAndLogin(role) {
    const email = uniqueEmail();
    await request(app).post('/api/auth/register').send({ email, password, role });
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return res.body.accessToken;
  }

  test('POST /api/orders without a token is rejected', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: randomUUID(), items: [{ sku: 'SKU-001', quantity: 1 }] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('MISSING_TOKEN');
  });

  test('POST /api/orders with a valid CUSTOMER token succeeds', async () => {
    const token = await registerAndLogin('CUSTOMER');

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: randomUUID(), items: [{ sku: 'SKU-001', quantity: 1 }] });

    // 202 if seeded stock exists (order accepted for async processing),
    // 400 if not seeded (unknown SKU) — either way, NOT a 401/403, proving
    // authentication + authorization both passed.
    expect([202, 400]).toContain(res.status);
  });

  test('GET /api/orders (admin-only) is forbidden for a CUSTOMER token', async () => {
    const token = await registerAndLogin('CUSTOMER');

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  test('GET /api/orders (admin-only) succeeds for an ADMIN token', async () => {
    const token = await registerAndLogin('ADMIN');

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('A malformed/garbage access token is rejected as invalid', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', 'Bearer this.is.garbage');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_TOKEN');
  });
});

// Runs once, after every test in this file (both describe blocks) has finished —
// NOT after just one describe block. Closing the pool too early was the bug:
// it was previously inside the first describe(), which killed the DB connection
// before the second describe()'s tests could run.
afterAll(async () => {
  await db.end();
});
