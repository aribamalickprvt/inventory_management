# Resilience Report

This report documents chaos engineering testing performed against the full distributed stack — deliberately killing individual infrastructure components under load and observing how the system actually behaves, rather than only reasoning about it from the architecture.

**How to reproduce this report's data yourself:**
```bash
docker compose up --build          # bring up the full stack
docker compose exec api npm run seed
npm run chaos-test                 # from your host machine, targeting http://localhost:3000
```
`scripts/chaosTest.js` runs a sustained load of order-creation requests for ~70 seconds while, on a fixed timeline, stopping and restarting Redis, RabbitMQ, and the order-processing Worker via the Docker CLI. It prints a windowed request/status report at the end.

> **Note on this document:** the sections below state what the architecture *predicts* will happen for each scenario, based on the design decisions made in Weeks 1–5 (documented in README.md). The blockquoted "Actual observed results" sub-sections are where you paste your own `chaos-test` output, Docker Desktop screenshots, and Jaeger trace screenshots after running it against your own environment — results will vary slightly by machine, and the whole point of chaos engineering is verifying the prediction against reality, not assuming it.

---

## Methodology

- **Load:** ~3-4 requests/second sustained against `POST /api/orders`, using a real authenticated user.
- **Duration:** ~70 seconds total, covering three independent failure scenarios back to back.
- **Failure injection:** `docker stop <container>` / `docker start <container>` against the exact containers defined in `docker-compose.yml` — this is a hard kill, not a graceful shutdown, which is the more realistic (and less forgiving) failure mode to test against.
- **Observed via:** the chaos script's own HTTP status tracking, plus manual inspection of `docker compose logs <service>`, the RabbitMQ management UI (queue depth), and Jaeger (trace gaps/errors during the outage windows).

---

## Scenario 1: Redis killed (t=10s–20s)

**What was killed:** the `inventory-redis` container, which backs the Week 5 Token Bucket rate limiter.

**Predicted behavior (per design):** `middleware/rateLimiter.js` is built to fail **open** — `config/redis.js` is configured with `maxRetriesPerRequest: 1` and `enableOfflineQueue: false` specifically so a failed Redis command surfaces fast, and the middleware's `catch` block logs a warning (`rate_limiter_fail_open`) and calls `next()` instead of rejecting the request. Order creation should continue succeeding throughout the outage, just without rate-limit enforcement. `GET /health/ready` should report `redis: "unavailable (rate limiting is failing open)"` while still returning `200`.

> **Actual observed results:**
> _Paste your `chaos-test` output for the t=10–20s window here, plus a screenshot of `GET /health/ready` during the outage showing the `redis` field, and a screenshot of the `rate_limiter_fail_open` log lines._

**Recovery:** once Redis restarts, `ioredis`'s background `retryStrategy` reconnects automatically (no restart of the API needed) — the next request after reconnection should show rate limiting enforcing normally again.

> _Paste evidence that requests were allowed throughout, and that enforcement resumed after Redis came back._

---

## Scenario 2: RabbitMQ killed (t=30s–40s)

**What was killed:** the `inventory-rabbitmq` container — the message broker every async handoff in this system depends on (order processing AND read-model sync).

**Predicted behavior (per design):** unlike Redis, **there is no fail-open path for RabbitMQ** in the current architecture. `CreateOrderCommandHandler.handle()` calls `orderEventPublisher.publishOrderCreated()` synchronously as part of the request — if `getChannel()` can't connect or `channel.publish()` throws, that error propagates up and the controller's `catch` block returns a `400`. **This is a genuine, currently-unmitigated gap**, not a hidden strength: order creation should start failing outright for the duration of the outage.

> **Actual observed results:**
> _Paste your `chaos-test` output for the t=30–40s window — expect the success rate to drop sharply. Note the actual HTTP status code(s) returned._

**Recovery:** `config/rabbitmq.js`'s connection has an `on('close', ...)` handler that resets the cached `connection`/`channel` to `null` — so once RabbitMQ's container dies, the next call to `getChannel()` (i.e. the next order-creation request) should detect there's no cached channel and attempt a fresh `amqp.connect()`. This means the API is designed to **self-heal without a process restart** once RabbitMQ comes back — no code needs to be redeployed or restarted.

What's genuinely worth verifying by testing rather than assuming: the exact recovery latency (how many failed requests happen between RabbitMQ coming back up and the API successfully reconnecting?), and whether any in-flight `channel.publish()` call made in the split second between the container dying and the `close` event firing behaves safely (fails cleanly) rather than silently dropping a message.

> **Actual observed results:**
> _Paste evidence of the recovery timing — how many requests failed after RabbitMQ was back up before order creation started succeeding again? Check the `rabbitmq_connection_closed` log line's timestamp against when requests resumed succeeding._

**Identified improvement (for future work):** a more resilient design would decouple "the order is accepted" from "the event is published" — e.g. writing the order to MySQL first (already happens), then treating publish failure as retryable via an outbox pattern (a local `outbox_events` table + a small poller that retries publishing) rather than failing the whole request. This wasn't implemented in the 6-week scope but is the natural next step this chaos test surfaces.

---

## Scenario 3: Order-processing Worker killed (t=50s–60s)

**What was killed:** the `inventory-worker` container — the consumer that checks stock and confirms/rejects orders.

**Predicted behavior (per design):** `CreateOrderCommandHandler` doesn't depend on the Worker being alive — it publishes to RabbitMQ and returns `202 PENDING` regardless. With no consumer running, messages should simply accumulate in `order_processing_queue` (visible in the RabbitMQ management UI's queue depth). Order creation itself should keep succeeding at `202`; the orders themselves should just stay `PENDING` longer than usual.

> **Actual observed results:**
> _Paste your `chaos-test` output for the t=50–60s window — expect the success rate for order CREATION to stay high (this scenario tests processing, not creation). Screenshot the RabbitMQ management UI showing queue depth climbing on `order_processing_queue` during this window._

**Recovery:** once the Worker restarts, it should immediately start draining the backlog that built up — `channel.prefetch(1)` means it processes one message at a time, so full recovery takes roughly `(queue depth at restart) × (processing time per order)`.

> _Paste `docker compose logs worker` output showing `event_received`/`event_processed` log lines rapidly draining the backlog after restart, and note how long it took to reach zero queue depth._

**Why this scenario is the "success story" of the report:** this is exactly the resilience Week 3's async refactor was built for — a downstream processor being temporarily unavailable doesn't take down order creation, it just delays fulfillment, and the system self-heals without manual intervention once the Worker comes back.

---

## Summary Table

| Scenario | Component killed | Requests affected | Auto-recovers? | Severity |
|---|---|---|---|---|
| 1 | Redis | None (fail-open) | Yes | Low — by design |
| 2 | RabbitMQ | Order creation (all of it) | _fill in after testing_ | High — no fallback exists |
| 3 | Order Worker | None (processing delayed, not creation) | Yes | Low — by design |

## Overall Findings

- _Fill in after running the test: which scenario matched the prediction, which didn't, and what surprised you._
- _Note any cascading effects — e.g. did killing RabbitMQ also affect the Sync Worker / read-model consistency, since it shares the same broker?_
- _Note Jaeger trace behavior during outages — do failed requests still produce a (partial) trace, or does the gap in instrumentation itself become a diagnostic clue?_
