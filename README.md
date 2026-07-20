# Inventory & Order Management API

## Architecture Goals
- **Domain-Driven Design**: business logic lives in `domain/`, isolated from Express and MySQL.
- **Layered architecture**: strict one-way dependency flow, `routes -> controllers -> services -> repositories -> domain`.
- **Aggregates**: `Order` and `InventoryItem` are separate aggregate roots. They reference each other only by ID (SKU), never by object reference.
- Future weeks layer in: OAuth2.0, Event-Driven Architecture (Kafka/RabbitMQ), CQRS, Token Bucket rate limiting, Distributed Tracing.

## Bounded Contexts
| Context   | Aggregate Root  | Owns                          |
|-----------|-----------------|--------------------------------|
| Ordering  | `Order`         | line items, order status, total |
| Inventory | `InventoryItem` | stock levels, pricing           |

## Layer Rules
```
routes/       -> HTTP wiring only. No logic.
controllers/  -> req/res parsing + formatting. Calls services.
services/     -> use-case orchestration. Calls repositories + domain.
repositories/ -> raw SQL only. No business rules.
domain/       -> Aggregates, Entities, Value Objects. Pure JS. Never imports express or mysql2.
config/       -> env validation (Zod), DB pool, logger, Swagger spec.
middleware/   -> cross-cutting concerns (request logging).
scripts/      -> one-off ops scripts (DB seeding).
```

## Operational Tooling (added post-review)
- **`docker-compose.yml`** — brings up the API + MySQL together with one command.
- **`config/env.js`** — validates all required environment variables at startup using **Zod**; the process exits immediately with a clear error if config is missing or malformed, instead of silently connecting with wrong defaults.
- **`config/logger.js`** — structured JSON logging via **Winston**, replacing `console.log`. Every HTTP request is logged with method, path, status code, and duration (see `middleware/requestLogger.js`).
- **`routes/healthRoutes.js`** — `/health/live` (process is running) and `/health/ready` (process + DB both reachable) endpoints, used by Docker/Kubernetes to know when the service is safe to route traffic to.
- **`scripts/seed.js`** — populates `inventory_items` with sample data (`npm run seed`), so a fresh clone is testable immediately.
- **`config/swagger.js`** + annotated routes — interactive OpenAPI docs served at `/api-docs`.

## Setup — Option A: Docker Compose (recommended)
```bash
cp .env.example .env    # edit DB_PASSWORD etc.
docker compose up --build
docker compose exec api npm run seed
```
API available at `http://localhost:3000`, docs at `http://localhost:3000/api-docs`.

## Setup — Option B: Manual (existing MySQL container)
```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

## Endpoints
- `POST /api/orders` — create + confirm an order, validates stock
- `GET /api/orders/:id` — fetch an order
- `GET /health/live` — liveness probe
- `GET /health/ready` — readiness probe (checks DB connectivity)
- `GET /api-docs` — interactive Swagger UI
