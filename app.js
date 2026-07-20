require('dotenv').config();
const env = require('./config/env'); // validates env on startup — exits process if invalid

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const logger = require('./config/logger');
const requestLogger = require('./middleware/requestLogger');

const orderRoutes = require('./routes/orderRoutes');
const healthRoutes = require('./routes/healthRoutes');

const app = express();

app.use(express.json());
app.use(requestLogger);

app.use('/', healthRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', orderRoutes);

app.listen(env.PORT, () => {
  logger.info('server_started', { port: env.PORT, env: env.NODE_ENV });
});

module.exports = app;
