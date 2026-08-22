require('dotenv').config();
require('./tracing').start('inventory-api'); // MUST run before ./app is required — see tracing.js

const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');

app.listen(env.PORT, () => {
  logger.info('server_started', { port: env.PORT, env: env.NODE_ENV });
});
