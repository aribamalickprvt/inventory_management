# Inventory & Order Management API

## Architecture Goals
- **Domain-Driven Design**: business logic lives in `domain/`, isolated from Express and MySQL.
- **Layered architecture**: strict one-way dependency flow, `routes -> controllers -> services -> repositories -> domain`.
- **Aggregates**: `Order` and `InventoryItem` are separate aggregate roots. They reference each other only by ID (SKU), never by object reference.
- **Event-driven**: order creation is asynchronous — the API publishes, a Worker consumes (see Week 3 below).
- Future weeks layer in: CQRS, Token Bucket rate limiting, Distributed Tracing, Chaos Engineering.

## Bounded Contexts
| Context   | Aggregate Root  | Owns                          |
|-----------|-----------------|--------------------------------|
| Ordering  | `Order`         | line items, order status, total |
| Inventory | `InventoryItem` | stock levels, pricing           |
| Auth      | `User`          | credentials, role               |

## Layer Rules
```
routes/       -> HTTP wiring only. No logic.
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
Client -> POST /api/orders -> OrderService validates SKUs exist (cheap, fast-fail)
                            -> Order saved as PENDING
                            -> order.created event published to RabbitMQ
                            -> 202 Accepted returned immediately (does NOT wait for stock check)

Worker  -> consumes order.created from order_processing_queue
        -> checks real stock availability for every line item
        -> if sufficient: atomically decrements inventory, order -> CONFIRMED
        -> if insufficient: order -> REJECTED (with a reason)

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
```bash
npm test
```
- `tests/auth.test.js` — Week 2 auth + RBAC integration suite.
- `tests/retryPolicy.test.js` — pure unit tests for exponential backoff decision logic (no infra required).
- `tests/orderEvents.test.js` — integration tests: verifies a real message lands on the queue after order creation, and verifies `OrderProcessingService` correctly confirms/rejects/skips against a real database.

RabbitMQ's management UI is available at `http://localhost:15672` (guest/guest) when running via Docker Compose — useful for watching queues fill and drain live while testing.

## Setup: Docker Compose (recommended)
```bash
cp .env.example .env    # edit DB_PASSWORD, JWT_ACCESS_SECRET, etc.
docker compose up --build
docker compose exec api npm run seed
```
API at `http://localhost:3000`, docs at `http://localhost:3000/api-docs`, RabbitMQ UI at `http://localhost:15672`.

## Endpoints
- `POST /api/auth/register` / `login` / `refresh` / `logout`
- `POST /api/orders` — submit an order for async processing → `202 Accepted`, status `PENDING`
- `GET /api/orders/:id` — fetch an order's current status (poll until `CONFIRMED`/`REJECTED`)
- `GET /api/orders` — list all orders (**admin only**)
- `GET /health/live` / `GET /health/ready`
- `GET /api-docs` — interactive Swagger UI
