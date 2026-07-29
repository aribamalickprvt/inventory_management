const express = require("express");
const orderController = require("../controllers/OrderController");
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const { User } = require("../domain/User");

const router = express.Router();

/**
 * @swagger
 * /orders:
 *   post:
 *     summary: Create and confirm a new order
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
 *       201:
 *         description: Order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 *       400:
 *         description: Validation error (unknown SKU, insufficient stock, etc.)
 *       401:
 *         description: Missing, invalid, or expired access token
 *       403:
 *         description: Authenticated but role not permitted
 */
router.post(
  "/orders",
  authenticate,
  authorize(User.ROLES.CUSTOMER, User.ROLES.ADMIN),
  orderController.create,
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
  "/orders",
  authenticate,
  authorize(User.ROLES.ADMIN),
  orderController.listAll,
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
  "/orders/:id",
  authenticate,
  authorize(User.ROLES.CUSTOMER, User.ROLES.ADMIN),
  orderController.getById,
);

module.exports = router;
