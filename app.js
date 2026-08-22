require('dotenv').config();
const env = require('./config/env'); // validates env on startup — exits process if invalid

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const requestLogger = require('./middleware/requestLogger');
const rateLimiter = require('./middleware/rateLimiter');

const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const healthRoutes = require('./routes/healthRoutes');

// This file only builds and exports the Express app — it does NOT call
// app.listen(). That lives in server.js. Splitting them apart means test
// files (tests/auth.test.js) can `require('../app')` and drive it with
// supertest, entirely in-memory, without binding a real network port.
const app = express();

app.use(express.json());
app.use(requestLogger);

// Week 5: two rate limit tiers, both fail-open if Redis is unreachable.
// Auth endpoints get a strict, IP-keyed bucket first (brute-force/credential-
// stuffing protection matters most where there's no user identity yet).
// Everything else under /api gets a looser general bucket, also IP-keyed at
// this point in the middleware chain (authenticate() hasn't run yet, so
// req.user isn't set — see orderRoutes.js for a per-USER bucket layered on
// top of this, after authentication, on order creation specifically).
//
// Disabled during automated test runs: the test suites legitimately fire
// many rapid requests from the same loopback address, which isn't
// representative of real abusive traffic and would make unrelated tests
// flaky. The rate limiter's actual behavior is still fully covered by
// tests/rateLimiter.test.js, which builds its own small Express app around
// the same middleware with a deliberately tiny capacity — that's where the
// feature itself is verified, not here.
if (env.NODE_ENV !== 'test') {
  app.use('/api/auth', rateLimiter({
    capacity: env.RATE_LIMIT_AUTH_CAPACITY,
    refillRatePerSec: env.RATE_LIMIT_AUTH_REFILL_PER_SEC,
    keyPrefix: 'ratelimit:auth',
  }));
  app.use('/api', rateLimiter({
    capacity: env.RATE_LIMIT_API_CAPACITY,
    refillRatePerSec: env.RATE_LIMIT_API_REFILL_PER_SEC,
    keyPrefix: 'ratelimit:api',
  }));
}

app.use('/', healthRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', authRoutes);
app.use('/api', orderRoutes);

module.exports = app;
