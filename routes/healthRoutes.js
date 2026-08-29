const express = require('express');
const db = require('../config/db');
const redisClient = require('../config/redis');

const router = express.Router();

/**
 * @swagger
 * /health/live:
 *   get:
 *     summary: Liveness probe — is the process running at all?
 *     tags: [Health]
 *     description: Used by Docker/Kubernetes to decide whether to restart the container. Never checks dependencies.
 *     responses:
 *       200:
 *         description: Process is alive
 */
router.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * @swagger
 * /health/ready:
 *   get:
 *     summary: Readiness probe — can the app actually serve traffic?
 *     tags: [Health]
 *     description: >
 *       Checks MySQL connectivity (hard dependency — a failure here returns
 *       503). Redis is checked and reported but deliberately does NOT affect
 *       the status code: Week 5's graceful degradation means the API stays
 *       ready and functional even if Redis is down, with rate limiting
 *       failing open. Redis status is a diagnostic field, not a hard gate.
 *     responses:
 *       200:
 *         description: Ready to serve traffic (db connected; redis status reported informationally)
 *       503:
 *         description: Not ready — MySQL is unreachable
 */
router.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');

    let redisStatus = 'connected';
    try {
      await redisClient.ping();
    } catch (err) {
      redisStatus = 'unavailable (rate limiting is failing open)';
    }

    res.status(200).json({ status: 'ok', db: 'connected', redis: redisStatus });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', db: 'unreachable', error: err.message });
  }
});

module.exports = router;
