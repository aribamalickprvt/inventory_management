# Inventory & Order Management API

## Architecture Goals
- **Domain-Driven Design**: business logic lives in `domain/`, isolated from Express and MySQL.
- **Layered architecture**: strict one-way dependency flow, `routes -> controllers -> commands/queries -> repositories -> domain`.
- **Aggregates**: `Order` and `InventoryItem` are separate aggregate roots. They reference each other only by ID (SKU), never by object reference.
<<<<<<< HEAD
- **Event-driven**: order creation is asynchronous — the API publishes, a Worker consumes (see Week 3 below).
- Future weeks layer in: CQRS, Token Bucket rate limiting, Distributed Tracing, Chaos Engineering.
=======
- **Event-driven**: order creation is asynchronous — the API publishes, a Worker consumes (Week 3).
- **CQRS**: writes and reads go through entirely separate paths — a Command handler + MySQL for writes, Query handlers + MongoDB for reads (Week 4).
- Future weeks layer in: Token Bucket rate limiting, Distributed Tracing, Chaos Engineering.
>>>>>>> 7acbccb (CQRS)

## Bounded Contexts
| Context   | Aggregate Root  | Owns                          |
|-----------|-----------------|--------------------------------|
| Ordering  | `Order`         | line items, order status, total |
| Inventory | `InventoryItem` | stock levels, pricing           |
| Auth      | `User`          | credentials, role               |

## Layer Rules
```
routes/       -> HTTP wiring only. No logic.
<<<<<<< HEAD
controllers/  -> req/res parsing + formatting. Calls services.
services/     -> use-case orchestration. Calls repositories + domain.
repositories/ -> raw SQL only. No business rules.
domain/       -> Aggregates, Entities, Value Objects. Pure JS. Never imports express or mysql2.
config/       -> env validation (Zod), DB pool, logger, Swagger spec, RabbitMQ topology.
middleware/   -> cross-cutting concerns (request logging, auth, RBAC).
events/       -> event publishers (API side of the async handoff).
worker/       -> pure, infra-free decision logic used by worker.js (e.g. retry policy).
scripts/      -> one-off ops scripts (DB seeding).
tests/        -> integration + unit tests (Jest + Supertest).
worker.js     -> standalone process: consumes events, processes orders, handles retry/DLQ.
server.js     -> standalone process: the HTTP API.
```

## Operational Tooling (Week 1 post-review additions)
- **`docker-compose.yml`** — brings up API + MySQL + RabbitMQ + Worker together with one command.
- **`config/env.js`** — validates all required environment variables at startup using **Zod**; the process exits immediately with a clear error if config is missing or malformed.
=======
controllers/  -> req/res parsing + formatting. Calls a Command handler (writes) or Query handler (reads).
commands/     -> CQRS write side. Orchestrates domain + write-store repositories (MySQL).
queries/      -> CQRS read side. Reads ONLY from readmodel/ (MongoDB) — never MySQL, never the domain layer.
repositories/ -> raw SQL only (MySQL, write store). No business rules.
readmodel/    -> MongoDB read-store repository + the sync logic that keeps it eventually consistent.
domain/       -> Aggregates, Entities, Value Objects. Pure JS. Never imports express, mysql2, or mongodb.
config/       -> env validation (Zod), DB pool, Mongo client, logger, Swagger spec, RabbitMQ topology.
middleware/   -> cross-cutting concerns (request logging, auth, RBAC).
events/       -> event publishers (API/Worker side of async handoffs — processing AND read-model sync).
worker/       -> pure, infra-free decision logic used by worker.js (e.g. retry policy).
scripts/      -> one-off ops scripts (DB seeding, read-latency benchmark).
tests/        -> integration + unit tests (Jest + Supertest).
worker.js       -> standalone process: consumes order.created, processes orders, handles retry/DLQ.
syncWorker.js   -> standalone process: consumes order snapshots, upserts the MongoDB read store.
server.js       -> standalone process: the HTTP API.
```

## Operational Tooling (Week 1 post-review additions)
- **`docker-compose.yml`** — brings up API + MySQL + RabbitMQ + MongoDB + both Workers together with one command.
- **`config/env.js`** — validates all required environment variables at startup using **Zod**; exits immediately with a clear error if config is missing or malformed.
>>>>>>> 7acbccb (CQRS)
- **`config/logger.js`** — structured JSON logging via **Winston**, replacing `console.log`.
- **`routes/healthRoutes.js`** — `/health/live` and `/health/ready` (checks DB connectivity too).
- **`scripts/seed.js`** — populates `inventory_items` with sample data (`npm run seed`).
- **`config/swagger.js`** + annotated routes — interactive OpenAPI docs served at `/api-docs`.

## Week 2: Auth (OAuth2.0-style) & RBAC

**Token model:**
- **Access tokens** — short-lived JWTs (default 15 min), self-contained, verified with no DB lookup. Carry `sub` (user id) and `role`.
- **Refresh tokens** — opaque random strings (NOT JWTs), stored server-side as a SHA-256 hash only. This is what makes revocation actually possible.
- **Sliding window rotation** — every successful `/auth/refresh` call revokes the token just used and issues a brand-new one with a fresh expiry window.

**RBAC:**
- Two roles: `ADMIN`, `CUSTOMER`.
- `middleware/authenticate.js` verifies the access token, distinguishing `TOKEN_EXPIRED` from `INVALID_TOKEN`.
- `middleware/authorize(...roles)` returns `403 FORBIDDEN` if the role isn't permitted.
- `POST /api/orders` and `GET /api/orders/:id` — any authenticated user.
- `GET /api/orders` (list all) — `ADMIN` only.

**Auth endpoints:**
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create a new user |
| POST | `/api/auth/login` | Exchange credentials for a token pair |
| POST | `/api/auth/refresh` | Rotate a refresh token |
| POST | `/api/auth/logout` | Revoke a refresh token |

## Week 3: Asynchronous Order Processing via RabbitMQ

**Why:** synchronously checking AND reserving stock inside the HTTP request handler doesn't scale — under concurrent load, every order-creation request contends for a lock on the same inventory rows while the client waits. Moving that work off the request path is the entire point of this refactor.

**The flow:**
```
<<<<<<< HEAD
Client -> POST /api/orders -> OrderService validates SKUs exist (cheap, fast-fail)
                            -> Order saved as PENDING
=======
Client -> POST /api/orders -> CreateOrderCommandHandler validates SKUs exist (cheap, fast-fail)
                            -> Order saved as PENDING (MySQL, write store)
>>>>>>> 7acbccb (CQRS)
                            -> order.created event published to RabbitMQ
                            -> 202 Accepted returned immediately (does NOT wait for stock check)

Worker  -> consumes order.created from order_processing_queue
        -> checks real stock availability for every line item
        -> if sufficient: atomically decrements inventory, order -> CONFIRMED
        -> if insufficient: order -> REJECTED (with a reason)
<<<<<<< HEAD

Client  -> GET /api/orders/{id} -> polls to see PENDING / CONFIRMED / REJECTED
```

**Topology** (`config/rabbitmq.js`, shared by both API and Worker):
| Exchange | Queue | Purpose |
|---|---|---|
| `orders_exchange` | `order_processing_queue` | Main queue — Worker consumes here |
| `orders_retry_exchange` | `order_retry_queue` | Holding queue — per-message TTL implements the backoff delay, then dead-letters back into `orders_exchange` |
| `orders_dlq_exchange` | `order_dlq` | Final resting place after retries are exhausted — inspected manually |

**Retry / backoff / DLQ** (`worker/retryPolicy.js` + `worker.js`):
- On processing failure, the Worker doesn't requeue-and-immediately-retry — it publishes a **delayed copy** into `order_retry_queue` with `expiration` (per-message TTL) set to `RETRY_BASE_DELAY_MS * 2^retryCount` — i.e. exponential backoff (2s, 4s, 8s, 16s, 32s by default).
- The retry queue itself has no consumer; its `x-dead-letter-exchange` config automatically routes the message back into the main queue once its TTL expires — no application-level timers needed.
- After `RETRY_MAX_ATTEMPTS` (default 5), the message is published to the DLQ instead of retried again, and the failure is logged as `event_dead_lettered`.
- The retry decision itself (`decideRetry()`) is a **pure function** with zero I/O, deliberately extracted from `worker.js` so it's unit-testable without any RabbitMQ or DB connection.

**Idempotency:** RabbitMQ is at-least-once delivery, so the same event can be processed twice (redelivery after a crash, a retry racing a success). `OrderProcessingService.processOrder()` checks the order is still `PENDING` before acting — if it's already `CONFIRMED`/`REJECTED`, processing is skipped and logged as `order_already_processed`.

**Structured logging across the full event lifecycle** — every stage is logged as JSON with `orderId` doubling as a correlation ID, so the whole journey of one order is greppable by that single value:
`event_published` (API) → `event_received` → `event_processed` / `event_processing_failed` → `event_retry_scheduled` (if applicable) → `event_dead_lettered` (if all retries exhausted) → `order_confirmed` / `order_rejected` / `order_already_processed`.

**Running the Worker:**
```bash
npm run worker        # or npm run worker:dev for auto-restart
```
Via Docker Compose, the `worker` service starts automatically alongside `api`.

**Testing:**
=======
```

**Topology** (`config/rabbitmq.js`, shared by API and both Workers):
| Exchange | Queue | Purpose |
|---|---|---|
| `orders_exchange` | `order_processing_queue` | Main queue — `worker.js` consumes here |
| `orders_retry_exchange` | `order_retry_queue` | Holding queue — per-message TTL implements the backoff delay, then dead-letters back into `orders_exchange` |
| `orders_dlq_exchange` | `order_dlq` | Final resting place after retries are exhausted — inspected manually |
| `order_sync_exchange` (fanout) | `order_readmodel_sync_queue` | Week 4 — `syncWorker.js` consumes here (see below) |

**Retry / backoff / DLQ** (`worker/retryPolicy.js` + `worker.js`):
- On processing failure, the Worker publishes a **delayed copy** into `order_retry_queue` with `expiration` (per-message TTL) set to `RETRY_BASE_DELAY_MS * 2^retryCount` — exponential backoff (2s, 4s, 8s, 16s, 32s by default).
- The retry queue has no consumer; its `x-dead-letter-exchange` config routes the message back into the main queue once its TTL expires — no application-level timers needed.
- After `RETRY_MAX_ATTEMPTS` (default 5), the message goes to the DLQ instead, logged as `event_dead_lettered`.
- `decideRetry()` is a **pure function**, zero I/O, unit-tested without any RabbitMQ or DB connection.

**Idempotency:** RabbitMQ is at-least-once delivery. `OrderProcessingService.processOrder()` checks the order is still `PENDING` before acting — if already `CONFIRMED`/`REJECTED`, it's skipped and logged as `order_already_processed`.

**Running the Worker:** `npm run worker` (or `npm run worker:dev`). Via Compose, the `worker` service starts automatically.

## Week 4: CQRS + a Separate Read Store (MongoDB)

**Why CQRS:** the write path (creating an order, checking domain invariants, running a transaction across two tables) and the read path (fetch a single order, list recent orders) have completely different performance profiles. Forcing both through the same normalized MySQL schema means every read pays for joins and aggregate reconstruction it doesn't need. Splitting them lets each side be optimized independently — writes stay strongly consistent in MySQL; reads become fast, denormalized document fetches from MongoDB.

**Why MongoDB over Elasticsearch:** for this scope, a denormalized document store is enough — there's no full-text search requirement, just "fetch one order fast" and "list recent orders." MongoDB's driver and local setup are simpler than standing up an Elasticsearch cluster, and the document model maps directly onto the flattened order snapshot. Elasticsearch would be the better call if this system later needed full-text/faceted search across orders.

**The full picture:**
```
Command side (writes, MySQL — unchanged from Week 3):
  POST /api/orders -> CreateOrderCommandHandler -> Order aggregate -> MySQL
                    -> publishes order.created (Week 3 processing pipeline)
                    -> publishes a read-model snapshot (Week 4 sync pipeline)

  Worker (worker.js) confirms/rejects the order in MySQL
                    -> publishes an updated read-model snapshot after each transition

Sync pipeline (keeps the read store eventually consistent):
  order_sync_exchange (fanout) -> order_readmodel_sync_queue -> syncWorker.js
                                -> OrderReadModelSyncService.syncSnapshot()
                                -> upserts into MongoDB (orders_read collection)

Query side (reads, MongoDB — new in Week 4):
  GET /api/orders/:id -> GetOrderQueryHandler  -> MongoDB, single document fetch
  GET /api/orders     -> ListOrdersQueryHandler -> MongoDB, single collection scan
```

**Command handler:** `commands/CreateOrderCommandHandler.js` — this is what `OrderService.createOrder()` used to be. Same domain rules, same MySQL write, now additionally fires a read-model snapshot event.

**Query handlers:** `queries/GetOrderQueryHandler.js` and `queries/ListOrdersQueryHandler.js` — thin wrappers around `readmodel/OrderReadModelRepository.js`. They never import anything from `repositories/`, `domain/`, or touch MySQL at all.

**Eventual consistency, explicitly:** immediately after `POST /api/orders` returns `202`, the read store may not have caught up yet — the sync event is still in flight over RabbitMQ. A `GET /api/orders/:id` called in that same instant can legitimately return `404` or a stale status for a brief window. This is expected CQRS behavior, not a bug — clients should poll `GET /api/orders/:id` until the status they want appears. In practice the lag is milliseconds under normal load.

**Why the sync worker doesn't need retry/backoff/DLQ like `worker.js` does:** MongoDB's `replaceOne(_id, ..., { upsert: true })` is naturally idempotent — applying the same snapshot twice (or out of order, since only the latest write matters) is harmless. `worker.js`, by contrast, decrements real inventory — an operation that is NOT safe to blindly retry without care, which is why it has the full exponential-backoff/DLQ machinery. `syncWorker.js` just requeues (`nack(msg, false, true)`) on failure — simpler, and correctly matched to a simpler problem.

**Running the Sync Worker:** `npm run sync-worker` (or `npm run sync-worker:dev`). Via Compose, the `sync-worker` service starts automatically.

**Performance benchmark:**
```bash
npm run benchmark              # samples the 20 most recent orders
npm run benchmark -- 100       # or specify a sample size
```
Compares `OrderRepository.findById()` (MySQL: two queries + aggregate reconstruction) against `OrderReadModelRepository.findById()` (MongoDB: one document fetch) for the same set of order IDs, and prints min/max/avg/p95 latency for each plus a computed speedup ratio.

> **Results are environment-dependent — run this yourself and record what you see.** Create a realistic number of orders first (small samples are noisy and dominated by connection overhead rather than actual query cost). Suggested table to fill in after running:
>
> | Store | Avg (ms) | p95 (ms) | Min (ms) | Max (ms) |
> |---|---|---|---|---|
> | Write store (MySQL) | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
> | Read store (MongoDB) | _fill in_ | _fill in_ | _fill in_ | _fill in_ |

## Testing
>>>>>>> 7acbccb (CQRS)
```bash
npm test
```
- `tests/auth.test.js` — Week 2 auth + RBAC integration suite.
- `tests/retryPolicy.test.js` — pure unit tests for exponential backoff decision logic (no infra required).
<<<<<<< HEAD
- `tests/orderEvents.test.js` — integration tests: verifies a real message lands on the queue after order creation, and verifies `OrderProcessingService` correctly confirms/rejects/skips against a real database.
=======
- `tests/orderEvents.test.js` — Week 3: verifies event publishing + `OrderProcessingService` consumption logic against real infra.
- `tests/cqrs.test.js` — Week 4: verifies the read-model sync pipeline and that `GET` endpoints correctly read from MongoDB.

All integration test files are written to tolerate a **live worker/sync-worker running concurrently** — they poll for the expected end state rather than assuming they're the only consumer, since that's the realistic scenario in dev and CI.

RabbitMQ's management UI is available at `http://localhost:15672` (guest/guest) when running via Docker Compose — useful for watching queues fill and drain live while testing.
>>>>>>> 7acbccb (CQRS)

RabbitMQ's management UI is available at `http://localhost:15672` (guest/guest) when running via Docker Compose — useful for watching queues fill and drain live while testing.

## Setup: Docker Compose (recommended)
```bash
cp .env.example .env    # edit DB_PASSWORD, JWT_ACCESS_SECRET, etc.
docker compose up --build
docker compose exec api npm run seed
```
<<<<<<< HEAD
API at `http://localhost:3000`, docs at `http://localhost:3000/api-docs`, RabbitMQ UI at `http://localhost:15672`.

## Endpoints
- `POST /api/auth/register` / `login` / `refresh` / `logout`
- `POST /api/orders` — submit an order for async processing → `202 Accepted`, status `PENDING`
- `GET /api/orders/:id` — fetch an order's current status (poll until `CONFIRMED`/`REJECTED`)
- `GET /api/orders` — list all orders (**admin only**)
=======
API at `http://localhost:3000`, docs at `http://localhost:3000/api-docs`, RabbitMQ UI at `http://localhost:15672`, MongoDB at `localhost:27017`.

## Setup — Option B: Manual (existing MySQL + RabbitMQ + MongoDB containers)
```bash
npm install
cp .env.example .env
npm run seed
npm run dev              # terminal 1: the API
npm run worker            # terminal 2: the order-processing Worker
npm run sync-worker        # terminal 3: the read-model Sync Worker
```

## Endpoints
- `POST /api/auth/register` / `login` / `refresh` / `logout`
- `POST /api/orders` — submit an order for async processing → `202 Accepted`, status `PENDING` (write store)
- `GET /api/orders/:id` — fetch an order's current status from the **read store** (poll until `CONFIRMED`/`REJECTED`)
- `GET /api/orders` — list all orders from the **read store** (**admin only**)
>>>>>>> 7acbccb (CQRS)
- `GET /health/live` / `GET /health/ready`
- `GET /api-docs` — interactive Swagger UI
