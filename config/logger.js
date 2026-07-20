const winston = require('winston');
const env = require('./env');

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json() // structured JSON output 
  ),
  defaultMeta: { service: 'inventory-order-api' },
  transports: [
    new winston.transports.Console(),
  ],
});

module.exports = logger;
