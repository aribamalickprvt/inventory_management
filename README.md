# Inventory & Order Management API

## Architecture Goals
- **Domain-Driven Design**: business logic lives in `domain/`, isolated from Express and MySQL.
- **Layered architecture**: strict one-way dependency flow, `routes -> controllers -> services -> repositories -> domain`.
- **Aggregates**: `Order` and `InventoryItem` are separate aggregate roots. They reference each other only by ID (SKU), never by object reference.
- Future weeks layer in: Event-Driven Architecture (Kafka/RabbitMQ), CQRS, Token Bucket rate limiting, Distributed Tracing.

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
config/       -> env validation (Zod), DB pool, logger, Swagger spec.
middleware/   -> cross-cutting concerns (request logging, auth, RBAC).
scripts/      -> one-off ops scripts (DB seeding).
tests/        -> integration tests (Jest + Supertest).
```

## Operational Tooling (Week 1 post-review additions)
- **`docker-compose.yml`** — brings up the API + MySQL together with one command.
- **`config/env.js`** — validates all required environment variables at startup using **Zod**; the process exits immediately with a clear error if config is missing or malformed.
- **`config/logger.js`** — structured JSON logging via **Winston**, replacing `console.log`.
- **`routes/healthRoutes.js`** — `/health/live` and `/health/ready` (checks DB connectivity too).
- **`scripts/seed.js`** — populates `inventory_items` with sample data (`npm run seed`).
- **`config/swagger.js`** + annotated routes — interactive OpenAPI docs served at `/api-docs`.

## Week 2: Auth (OAuth2.0-style) & RBAC

**Token model:**
- **Access tokens** — short-lived JWTs (default 15 min), self-contained, verified with no DB lookup. Carry `sub` (user id) and `role`.
- **Refresh tokens** — opaque random strings (NOT JWTs), stored server-side as a SHA-256 hash only. This is what makes revocation actually possible — a JWT refresh token can't be invalidated before its natural expiry without a denylist; an opaque, DB-backed token can be revoked instantly.
- **Sliding window rotation** — every successful `/auth/refresh` call revokes the token just used and issues a brand-new refresh token with a fresh expiry window. An active user is never forced to log out; a stolen-but-unused token has a hard ceiling; and reuse of an already-rotated token is rejected outright (a strong signal of token theft).

**RBAC:**
- Two roles: `ADMIN`, `CUSTOMER`.
- `middleware/authenticate.js` verifies the access token and attaches `req.user = { id, role }`. Distinguishes `TOKEN_EXPIRED` (client should call `/auth/refresh`) from `INVALID_TOKEN` (client must re-login).
- `middleware/authorize(...roles)` checks `req.user.role` against an allow-list, returning `403 FORBIDDEN` if the role isn't permitted.
- `POST /api/orders` and `GET /api/orders/:id` — any authenticated user (`CUSTOMER` or `ADMIN`).
- `GET /api/orders` (list all) — `ADMIN` only, demonstrating role-restricted access.

**Auth endpoints:**
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create a new user (bcrypt-hashed password, 12 salt rounds) |
| POST | `/api/auth/login` | Exchange credentials for an access + refresh token pair |
| POST | `/api/auth/refresh` | Rotate a valid refresh token for a new pair |
| POST | `/api/auth/logout` | Revoke a refresh token |

**Testing:**
```bash
npm test
```
Runs the Jest + Supertest integration suite (`tests/auth.test.js`) against a real MySQL instance — covers registration, login, refresh rotation + reuse rejection, logout/revocation, and RBAC enforcement (missing token, invalid token, wrong role, correct role).

## Setup — Option A: Docker Compose (recommended)
```bash
cp .env.example .env    # edit DB_PASSWORD, JWT_ACCESS_SECRET, etc.
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
- `POST /api/auth/register` / `login` / `refresh` / `logout`
- `POST /api/orders` — create + confirm an order (any authenticated user)
- `GET /api/orders/:id` — fetch an order (any authenticated user)
- `GET /api/orders` — list all orders (**admin only**)
- `GET /health/live` / `GET /health/ready`
- `GET /api-docs` — interactive Swagger UI (includes a "Bearer Auth" login button)
