const express = require('express');
const orderController = require('../controllers/OrderController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const rateLimiter = require('../middleware/rateLimiter');
const env = require('../config/env');
const { User } = require('../domain/User');

const router = express.Router();

// Week 5: a SECOND, per-user bucket specifically for order creation, layered
// on top of the general /api bucket in app.js. This runs AFTER authenticate,
// so it can key by req.user.id — "you personally can create at most N orders
// per minute" is a different (and often stricter) concern than "this IP
// can't flood any endpoint."
//
// Disabled during automated test runs for the same reason as app.js's global
// limiters — see the comment there. The feature itself is covered by
// tests/rateLimiter.test.js against an isolated app instance.
const orderCreateRateLimiter = env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimiter({
      capacity: env.RATE_LIMIT_ORDER_CREATE_CAPACITY,
      refillRatePerSec: env.RATE_LIMIT_ORDER_CREATE_REFILL_PER_SEC,
      keyPrefix: 'ratelimit:order-create',
      keyFn: (req) => req.user?.id || req.ip,
    });

/**
 * @swagger
 * /orders:
 *   post:
 *     summary: Submit a new order for asynchronous processing
 *     description: >
 *       Publishes an order.created event to RabbitMQ and returns immediately
 *       with status PENDING. A Worker process validates and reserves stock
 *       asynchronously, transitioning the order to CONFIRMED or REJECTED.
 *       Poll GET /orders/{id} to observe the outcome.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrderRequest'
 *     responses:
 *       202:
 *         description: Order accepted for asynchronous processing (status PENDING)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 *       400:
 *         description: Validation error (unknown SKU, malformed request)
 *       401:
 *         description: Missing, invalid, or expired access token
 *       403:
 *         description: Authenticated but role not permitted
 *       429:
 *         description: Rate limit exceeded (per-user order creation quota)
 */
router.post(
  '/orders',
  authenticate,
  authorize(User.ROLES.CUSTOMER, User.ROLES.ADMIN),
  orderCreateRateLimiter,
  orderController.create
);

/**
 * @swagger
 * /orders:
 *   get:
 *     summary: List all orders (admin only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of orders
 *       403:
 *         description: Non-admin role attempted access
 */
router.get(
  '/orders',
  authenticate,
  authorize(User.ROLES.ADMIN),
  orderController.listAll
);

/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     summary: Fetch an order by ID
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 *       401:
 *         description: Missing, invalid, or expired access token
 *       404:
 *         description: Order not found
 */
router.get(
  '/orders/:id',
  authenticate,
  authorize(User.ROLES.CUSTOMER, User.ROLES.ADMIN),
  orderController.getById
);

module.exports = router;
