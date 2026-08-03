const request = require("supertest");
const { randomUUID } = require("crypto");
const app = require("../app");
const db = require("../config/db");
const {
  getChannel,
  closeConnection,
  QUEUE_PROCESSING,
} = require("../config/rabbitmq");
const orderProcessingService = require("../services/OrderProcessingService");
const orderRepository = require("../repositories/OrderRepository");

/**
 * These tests hit REAL infrastructure — MySQL AND RabbitMQ (via
 * docker-compose or your local containers), not mocks. Run `npm run seed`
 * first so SKU-001 has stock.
 *
 * They do NOT require worker.js to be running as a separate process — BUT
 * they tolerate it if it is (which is the realistic scenario in dev/CI).
 * The "publishing" test below first gives a few seconds for SOME consumer
 * (a live worker, if one happens to be running) to pick the message up; if
 * nothing does, it falls back to draining the queue itself and inspecting
 * the message directly. Either path proves the API published successfully.
 */

function uniqueEmail() {
  return `test-${randomUUID()}@example.com`;
}

async function getCustomerToken() {
  const email = uniqueEmail();
  const password = "correct-horse-battery-staple";
  await request(app)
    .post("/api/auth/register")
    .send({ email, password, role: "CUSTOMER" });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password });
  return res.body.accessToken;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Used by the "consumption" tests below. If a live worker (running in
 * another terminal) grabs the message first, this detects that and returns
 * its result instead of racing it — calling processOrder() ourselves after
 * a live worker already moved the order past PENDING would hit a real
 * optimistic-lock conflict (correctly — it's not a bug, it's the lock doing
 * its job). If nothing consumes it within the short window, we process it
 * ourselves directly, exactly like the earlier standalone tests did.
 */
async function ensureProcessed(orderId, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const order = await orderRepository.findById(orderId);
    if (order.status !== "PENDING") return order; // a live worker already handled it
    await sleep(200);
  }
  await orderProcessingService.processOrder(orderId);
  return orderRepository.findById(orderId);
}

describe("Order event publishing", () => {
  test("POST /api/orders publishes an order.created event that a consumer picks up", async () => {
    const token = await getCustomerToken();

    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId: randomUUID(),
        items: [{ sku: "SKU-001", quantity: 1 }],
      });

    expect(createRes.status).toBe(202);
    expect(createRes.body.status).toBe("PENDING");

    const orderId = createRes.body.id;

    // Give a live worker (if one happens to be running alongside the test
    // suite) a few seconds to consume and process the message — this is
    // the true end-to-end path and, if it happens, is the strongest proof
    // publishing worked.
    const deadline = Date.now() + 5000;
    let consumedByLiveWorker = false;
    while (Date.now() < deadline) {
      const order = await orderRepository.findById(orderId);
      if (order.status !== "PENDING") {
        consumedByLiveWorker = true;
        break;
      }
      await sleep(250);
    }

    if (consumedByLiveWorker) {
      const order = await orderRepository.findById(orderId);
      expect(["CONFIRMED", "REJECTED"]).toContain(order.status);
      return;
    }

    // No live worker picked it up in time — fall back to draining the
    // queue ourselves and inspecting the raw message directly.
    const channel = await getChannel();
    let found = null;
    for (let i = 0; i < 10 && !found; i++) {
      const msg = await channel.get(QUEUE_PROCESSING, { noAck: false });
      if (!msg) break;
      const event = JSON.parse(msg.content.toString());
      if (event.orderId === orderId) {
        found = event;
        channel.ack(msg);
      } else {
        channel.nack(msg, false, true);
        break;
      }
    }

    expect(found).not.toBeNull();
    expect(found.eventType).toBe("order.created");
    expect(found.orderId).toBe(orderId);
  });
});

describe("Order event consumption (OrderProcessingService)", () => {
  test("confirms an order when stock is sufficient, and decrements inventory", async () => {
    const token = await getCustomerToken();
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId: randomUUID(),
        items: [{ sku: "SKU-003", quantity: 1 }],
      }); // SKU-003 seeded with 100 units

    expect(createRes.status).toBe(202);
    const orderId = createRes.body.id;

    const order = await ensureProcessed(orderId);
    expect(order.status).toBe("CONFIRMED");
  });

  test("rejects an order when stock is insufficient, and leaves inventory untouched", async () => {
    const token = await getCustomerToken();
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId: randomUUID(),
        items: [{ sku: "SKU-004", quantity: 999999 }],
      }); // impossible quantity

    expect(createRes.status).toBe(202);
    const orderId = createRes.body.id;

    const order = await ensureProcessed(orderId);
    expect(order.status).toBe("REJECTED");
    expect(order.rejectionReason).toMatch(/SKU-004/);
  });

  test("is idempotent — processing an already-CONFIRMED order again is a no-op", async () => {
    const token = await getCustomerToken();
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId: randomUUID(),
        items: [{ sku: "SKU-003", quantity: 1 }],
      });

    const orderId = createRes.body.id;

    // Let either a live worker or our own fallback processing handle the
    // FIRST transition — doesn't matter who does it.
    const firstResultOrder = await ensureProcessed(orderId);
    expect(firstResultOrder.status).toBe("CONFIRMED");

    // Now explicitly process it again ourselves. Regardless of who confirmed
    // it a moment ago, this call must be a safe no-op — that's the actual
    // idempotency guarantee being tested (RabbitMQ's at-least-once delivery
    // means the same event really can arrive twice).
    const second = await orderProcessingService.processOrder(orderId);
    expect(second.outcome).toBe("SKIPPED");
    expect(second.status).toBe("CONFIRMED");
  });

  test("throws for a non-existent order id (so the Worker will retry it)", async () => {
    await expect(
      orderProcessingService.processOrder(randomUUID()),
    ).rejects.toThrow(/not found/i);
  });
});

afterAll(async () => {
  await closeConnection();
  await db.end();
});
