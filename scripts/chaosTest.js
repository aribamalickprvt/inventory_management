// Run with: npm run chaos-test
//
// Runs a continuous load generator against POST /api/orders while, on a
// fixed timeline, stopping and restarting containers (Redis, RabbitMQ, the
// Worker) via the Docker CLI — the classic chaos engineering pattern of
// deliberately injecting failure and observing what actually happens,
// rather than reasoning about it from the architecture alone.
//
// Requires: Docker running, the full stack up (docker compose up, or the
// equivalent manually-run containers), and a registered+logged-in test user
// (this script logs in its own throwaway user automatically).
//
// Prints a running summary and a final report — copy the terminal output
// (or screenshot it) into RESILIENCE.md as your evidence.

const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const execAsync = promisify(exec);

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const TOTAL_DURATION_SEC = Number(process.argv[3]) || 70;
const REQUEST_INTERVAL_MS = 300; // ~3-4 requests/sec sustained load

// Container names — must match `container_name:` in docker-compose.yml
const CONTAINERS = {
  redis: 'inventory-redis',
  rabbitmq: 'inventory-rabbitmq',
  worker: 'inventory-worker',
};

// Chaos timeline: [atSecond, action, target, label]
const TIMELINE = [
  [10, 'stop', 'redis', 'Killing Redis — expect rate limiting to fail OPEN, requests keep succeeding'],
  [20, 'start', 'redis', 'Restarting Redis — rate limiting should resume enforcing'],
  [30, 'stop', 'rabbitmq', 'Killing RabbitMQ — expect order creation to start FAILING (no fallback exists yet)'],
  [40, 'start', 'rabbitmq', 'Restarting RabbitMQ — order creation should recover'],
  [50, 'stop', 'worker', 'Killing the order-processing Worker — orders should pile up as PENDING'],
  [60, 'start', 'worker', 'Restarting the Worker — it should drain the backlog that built up'],
];

let accessToken = null;
const results = []; // { tSec, status, ms }
const events = []; // { tSec, label }

function log(msg) {
  const t = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[t=${t}s] ${msg}`);
}

async function dockerAction(action, containerKey) {
  const containerName = CONTAINERS[containerKey];
  try {
    await execAsync(`docker ${action} ${containerName}`);
    return true;
  } catch (err) {
    log(`  !! docker ${action} ${containerName} FAILED: ${err.message.split('\n')[0]}`);
    return false;
  }
}

async function loginThrowawayUser() {
  const email = `chaos-${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';

  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role: 'CUSTOMER' }),
  });

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    throw new Error(`Could not log in throwaway test user (status ${loginRes.status}) — is the API running?`);
  }
  const body = await loginRes.json();
  return body.accessToken;
}

async function fireOrderRequest() {
  const tSec = (Date.now() - startTime) / 1000;
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        customerId: crypto.randomUUID(),
        items: [{ sku: 'SKU-001', quantity: 1 }],
      }),
    });
    results.push({ tSec, status: res.status, ms: Date.now() - t0 });
  } catch (err) {
    results.push({ tSec, status: 'ERROR', ms: Date.now() - t0, error: err.message });
  }
}

let startTime;

async function run() {
  console.log('=== Chaos Engineering Test ===');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Duration: ${TOTAL_DURATION_SEC}s`);
  console.log('Timeline:');
  for (const [atSec, action, target, label] of TIMELINE) {
    console.log(`  t=${atSec}s: ${action} ${CONTAINERS[target]} — ${label}`);
  }
  console.log('');

  accessToken = await loginThrowawayUser();
  console.log('Logged in throwaway test user. Starting load...\n');

  startTime = Date.now();

  const loadInterval = setInterval(fireOrderRequest, REQUEST_INTERVAL_MS);

  const timers = TIMELINE.map(([atSec, action, target, label]) =>
    setTimeout(async () => {
      log(`>>> ${label}`);
      events.push({ tSec: atSec, label });
      await dockerAction(action, target);
    }, atSec * 1000)
  );

  await new Promise((resolve) => setTimeout(resolve, TOTAL_DURATION_SEC * 1000));
  clearInterval(loadInterval);
  timers.forEach(clearTimeout);

  printReport();
}

function printReport() {
  console.log('\n\n=== Chaos Test Report ===\n');

  // Bucket results into 5-second windows for a readable timeline
  const windowSize = 5;
  const windows = {};
  for (const r of results) {
    const w = Math.floor(r.tSec / windowSize) * windowSize;
    if (!windows[w]) windows[w] = { total: 0, success: 0, failed: 0, statuses: {} };
    windows[w].total++;
    windows[w].statuses[r.status] = (windows[w].statuses[r.status] || 0) + 1;
    if (r.status === 202 || r.status === 200) windows[w].success++;
    else windows[w].failed++;
  }

  console.log('Requests per 5-second window (status breakdown):');
  const sortedWindows = Object.keys(windows).map(Number).sort((a, b) => a - b);
  for (const w of sortedWindows) {
    const stats = windows[w];
    const marker = events.find((e) => e.tSec >= w && e.tSec < w + windowSize);
    const eventNote = marker ? `  <-- ${marker.label}` : '';
    console.log(
      `  t=${w}-${w + windowSize}s: ${stats.success} ok, ${stats.failed} failed  [${JSON.stringify(stats.statuses)}]${eventNote}`
    );
  }

  const totalRequests = results.length;
  const totalSuccess = results.filter((r) => r.status === 202 || r.status === 200).length;
  const totalFailed = totalRequests - totalSuccess;

  console.log(`\nTotals: ${totalRequests} requests sent, ${totalSuccess} succeeded, ${totalFailed} failed.`);
  console.log('\nCopy this output (or a screenshot) into RESILIENCE.md as evidence for each scenario.');
  console.log('Also check: Jaeger (http://localhost:16686) for traces during the outage windows,');
  console.log('and `docker compose logs worker` for backlog-draining behavior after the Worker restart.\n');
}

run().catch((err) => {
  console.error('Chaos test failed to run:', err.message);
  process.exit(1);
});
