const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory & Order Management API',
      version: '1.0.0',
      description: 'High-scale distributed backend — Week 1: DDD + layered architecture slice.',
    },
    servers: [{ url: '/api', description: 'API base path' }],
    components: {
      schemas: {
        OrderItemInput: {
          type: 'object',
          required: ['sku', 'quantity'],
          properties: {
            sku: { type: 'string', example: 'SKU-001' },
            quantity: { type: 'integer', example: 2 },
          },
        },
        CreateOrderRequest: {
          type: 'object',
          required: ['customerId', 'items'],
          properties: {
            customerId: { type: 'string', format: 'uuid' },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/OrderItemInput' },
            },
          },
        },
        OrderResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', example: 'CONFIRMED' },
            total: { type: 'string', example: '49.98 USD' },
          },
        },
      },
    },
  },
  apis: ['./routes/*.js'], // reads JSDoc @swagger comments from route files
};

module.exports = swaggerJsdoc(options);
