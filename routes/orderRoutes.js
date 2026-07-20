const express = require('express');
const orderController = require('../controllers/OrderController');

const router = express.Router();

/**
 * @swagger
 * /orders:
 *   post:
 *     summary: Create and confirm a new order
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
 */
router.post('/orders', orderController.create);

/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     summary: Fetch an order by ID
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
 *       404:
 *         description: Order not found
 */
router.get('/orders/:id', orderController.getById);

module.exports = router;
