const { z } = require('zod');

const envSchema = z.object({
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Week 2: Auth
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Week 3: Event-driven order processing
  RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL is required').default('amqp://guest:guest@localhost:5672'),
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().nonnegative().default(5),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(2000),

  // Week 4: CQRS read store
  MONGO_URL: z.string().min(1, 'MONGO_URL is required').default('mongodb://localhost:27017'),
  MONGO_DB_NAME: z.string().min(1).default('inventory_order_readmodel'),

  // Week 5: Rate limiting
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').default('redis://localhost:6379'),
  RATE_LIMIT_API_CAPACITY: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_API_REFILL_PER_SEC: z.coerce.number().positive().default(5),
  RATE_LIMIT_AUTH_CAPACITY: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_AUTH_REFILL_PER_SEC: z.coerce.number().positive().default(1),
  RATE_LIMIT_ORDER_CREATE_CAPACITY: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_ORDER_CREATE_REFILL_PER_SEC: z.coerce.number().positive().default(2),

  // Week 5: Distributed tracing
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().min(1).default('http://localhost:4318'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1); // fail fast — never start the server with bad config
  }

  return result.data;
}

module.exports = loadEnv();
