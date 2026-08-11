// Run with: npm run benchmark  (or: node scripts/benchmarkReadLatency.js [sampleSize])
//
// Compares single-order read latency between:
//   - the write store (MySQL, OrderRepository.findById — two queries +
//     domain object reconstruction)
//   - the read store  (MongoDB, OrderReadModelRepository.findById — one
//     document fetch, already denormalized)
//
// Create a realistic number of orders via the API first (small samples are
// noisy and dominated by connection overhead rather than actual query cost).
require('dotenv').config();
const db = require('../config/db');
const orderRepository = require('../repositories/OrderRepository');
const orderReadModelRepository = require('../readmodel/OrderReadModelRepository');
const { closeMongo } = require('../config/mongo');
const logger = require('../config/logger');

const SAMPLE_SIZE = Number(process.argv[2]) || 20;

function stats(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    minMs: Number(sorted[0].toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    avgMs: Number((sum / sorted.length).toFixed(2)),
    p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
  };
}

async function run() {
  const [rows] = await db.query(
    'SELECT id FROM orders ORDER BY created_at DESC LIMIT ?',
    [SAMPLE_SIZE]
  );

  if (rows.length === 0) {
    console.log('No orders found. Create some via POST /api/orders first, then re-run this benchmark.');
    await db.end();
    await closeMongo();
    return;
  }

  const writeStoreSamples = [];
  const readStoreSamples = [];

  for (const row of rows) {
    const t0 = process.hrtime.bigint();
    await orderRepository.findById(row.id); // MySQL: 2 queries + aggregate reconstruction
    const t1 = process.hrtime.bigint();
    writeStoreSamples.push(Number(t1 - t0) / 1e6);

    const t2 = process.hrtime.bigint();
    await orderReadModelRepository.findById(row.id); // MongoDB: 1 document fetch
    const t3 = process.hrtime.bigint();
    readStoreSamples.push(Number(t3 - t2) / 1e6);
  }

  const writeStats = stats(writeStoreSamples);
  const readStats = stats(readStoreSamples);

  console.log('\n=== Read Latency Benchmark: Write Store (MySQL) vs Read Store (MongoDB) ===');
  console.log(`Sample size: ${rows.length} orders\n`);
  console.table({
    'Write store (MySQL)': writeStats,
    'Read store (MongoDB)': readStats,
  });

  if (readStats.avgMs > 0) {
    const speedup = (writeStats.avgMs / readStats.avgMs).toFixed(2);
    console.log(`\nRead store averaged ${speedup}x faster than the write store for single-order lookups.`);
  }
  console.log('Note: results depend heavily on local machine load and sample size — run with a larger');
  console.log('sample (e.g. `node scripts/benchmarkReadLatency.js 100`) and record results in README.md.\n');

  await db.end();
  await closeMongo();
}

run().catch((err) => {
  logger.error('benchmark_failed', { error: err.message });
  process.exit(1);
});
