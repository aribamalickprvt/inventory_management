const request = require('supertest');
const { randomUUID } = require('crypto');
const app = require('../app');
const db = require('../config/db');
const { closeConnection: closeRabbit } = require('../config/rabbitmq');
const { closeMongo } = require('../config/mongo');
const orderReadModelSyncService = require('../readmodel/OrderReadModelSyncService');
const orderReadModelRepository = require('../readmodel/OrderReadModelRepository');

/**
 * These tests exercise the Week 4 CQRS read path: GET /api/orders/:id and
 * GET /api/orders now read exclusively from MongoDB (the read store), kept
 * eventually consistent by syncWorker.js. Like tests/orderEvents.test.js,
 * these tolerate a live sync-worker running concurrently — they poll for
 * the read model to appear rather than assuming a fixed timing.
 */

function uniqueEmail() {
  return `test-${randomUUID()}@example.com`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getToken(role) {
  const email = uniqueEmail();
  const password = 'correct-horse-battery-staple';
  await request(app).post('/api/auth/register').send({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken;
}

async function waitForReadModel(orderId, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const doc = await orderReadModelRepository.findById(orderId);
    if (doc) return doc;
    await sleep(200);
  }
  return null;
}

describe('CQRS read model sync', () => {
  test('GET /api/orders/:id eventually reflects the order via the read store', async () => {
    const token = await getToken('CUSTOMER');
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: randomUUID(), items: [{ sku: 'SKU-001', quantity: 1 }] });

    expect(createRes.status).toBe(202);
    const orderId = createRes.body.id;

    const doc = await waitForReadModel(orderId);
    expect(doc).not.toBeNull();
    expect(doc.orderId).toBe(orderId);
    expect(['PENDING', 'CONFIRMED', 'REJECTED']).toContain(doc.status);

    const getRes = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(orderId);
  });

  test('GET /api/orders/:id returns 404 for an order that has never been synced', async () => {
    const token = await getToken('CUSTOMER');
    const res = await request(app)
      .get(`/api/orders/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('OrderReadModelSyncService.syncSnapshot upserts idempotently — last write wins', async () => {
    const orderId = randomUUID();
    const baseSnapshot = {
      orderId,
      customerId: randomUUID(),
      status: 'PENDING',
      total: '10.00 USD',
      rejectionReason: null,
      lineItems: [],
      updatedAt: new Date().toISOString(),
    };

    await orderReadModelSyncService.syncSnapshot(baseSnapshot);
    await orderReadModelSyncService.syncSnapshot({ ...baseSnapshot, status: 'CONFIRMED' }); // simulates redelivery / a later update

    const doc = await orderReadModelRepository.findById(orderId);
    expect(doc.status).toBe('CONFIRMED');
  });

  test('GET /api/orders (list, admin only) reads from the read store', async () => {
    const customerToken = await getToken('CUSTOMER');
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ customerId: randomUUID(), items: [{ sku: 'SKU-001', quantity: 1 }] });

    const adminToken = await getToken('ADMIN');
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

afterAll(async () => {
  await closeRabbit();
  await closeMongo();
  await db.end();
});
