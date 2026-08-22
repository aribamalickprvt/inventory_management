const express = require('express');
const db = require('../config/db');
const redisClient = require('../config/redis');

const router = express.Router();

// Liveness: is the process running at all? Used by Docker/K8s to know whether to restart the container.
router.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness: is the app ready to serve traffic (i.e. can it actually reach the database)?
// Redis is checked and reported but deliberately does NOT affect the status
// code or overall "ok" — the whole point of Week 5's graceful degradation is
// that the API stays functional (and therefore "ready") even if Redis is
// down; rate limiting just fails open in that case. This endpoint reports
// Redis as a diagnostic, not a hard dependency.
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
