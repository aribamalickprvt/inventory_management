const { MongoClient } = require('mongodb');
const env = require('./env');
const logger = require('./logger');

let client = null;
let db = null;

async function getDb() {
  if (db) return db;
  client = new MongoClient(env.MONGO_URL);
  await client.connect();
  db = client.db(env.MONGO_DB_NAME);
  logger.info('mongo_connected', { database: env.MONGO_DB_NAME });
  return db;
}

async function closeMongo() {
  if (client) await client.close().catch(() => {});
  client = null;
  db = null;
}

module.exports = { getDb, closeMongo };
