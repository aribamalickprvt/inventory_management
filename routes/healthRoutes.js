const express = require('express');
const db = require('../config/db');

const router = express.Router();

// Liveness: is the process running at all? Used by Docker/K8s to know whether to restart the container.
router.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness: is the app ready to serve traffic (i.e. can it actually reach the database)?
router.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', db: 'unreachable', error: err.message });
  }
});

module.exports = router;
