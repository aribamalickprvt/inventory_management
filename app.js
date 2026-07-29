require('dotenv').config();
require('./config/env'); // validates env on startup — exits process if invalid

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const requestLogger = require('./middleware/requestLogger');

const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const healthRoutes = require('./routes/healthRoutes');

// This file only builds and exports the Express app — it does NOT call
// app.listen(). That lives in server.js. Splitting them apart means test
// files (tests/auth.test.js) can `require('../app')` and drive it with
// supertest, entirely in-memory, without binding a real network port.
const app = express();

app.use(express.json());
app.use(requestLogger);

app.use('/', healthRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', authRoutes);
app.use('/api', orderRoutes);

module.exports = app;
