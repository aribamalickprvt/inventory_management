const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory & Order Management API',
      version: '1.0.0',
      description: 'High-scale distributed backend — Week 1: DDD + layered architecture. Week 2: OAuth2.0-style auth + RBAC. Week 3: async order processing via RabbitMQ. Week 4: CQRS — reads served from a MongoDB read store, eventually consistent with the MySQL write store. Week 5: Redis-backed Token Bucket rate limiting + OpenTelemetry/Jaeger distributed tracing.',
    },
    servers: [{ url: '/api', description: 'API base path' }],
    tags: [
      { name: 'Auth', description: 'Registration, login, token refresh, and logout' },
      { name: 'Orders', description: 'Order creation (async) and lookup via the CQRS read store' },
      { name: 'Health', description: 'Liveness and readiness probes' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token issued by POST /api/auth/login or /api/auth/refresh',
        },
      },
      schemas: {
        RateLimitedResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'RATE_LIMITED' },
            message: { type: 'string', example: 'Too many requests — please slow down and try again shortly.' },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, example: 'at-least-8-chars' },
            role: { type: 'string', enum: ['ADMIN', 'CUSTOMER'], default: 'CUSTOMER' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        TokenResponse: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            tokenType: { type: 'string', example: 'Bearer' },
            expiresIn: { type: 'string', example: '15m' },
            role: { type: 'string', example: 'CUSTOMER' },
          },
        },
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
            status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'], example: 'PENDING' },
            total: { type: 'string', example: '49.98 USD' },
            rejectionReason: { type: 'string', nullable: true, example: null },
          },
        },
      },
    },
  },
  apis: ['./routes/*.js'], // reads JSDoc @swagger comments from route files
};

module.exports = swaggerJsdoc(options);
