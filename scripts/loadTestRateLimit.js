// Run with: npm run loadtest
//   or:     node scripts/loadTestRateLimit.js <url> <method> <totalRequests> <concurrency>
//
// Fires a burst of requests at an endpoint and reports the status code
// breakdown — empirically verifies the Token Bucket lets a burst up to
// `capacity` through, then starts returning 429 once the bucket is empty.
// Uses Node's built-in fetch (Node 18+) — no extra dependency needed.

const url = process.argv[2] || 'http://localhost:3000/health/live';
const method = (process.argv[3] || 'GET').toUpperCase();
const totalRequests = Number(process.argv[4]) || 40;
const concurrency = Number(process.argv[5]) || 10;

// Dummy body used only when method is POST (e.g. against /api/auth/login) —
// the point is to exercise the rate limiter, not to authenticate successfully.
const dummyBody = JSON.stringify({ email: 'loadtest@example.com', password: 'wrong-password' });

async function fireRequest(index) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? dummyBody : undefined,
    });
    return { index, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { index, status: 'ERROR', ms: Date.now() - t0, error: err.message };
  }
}

async function run() {
  console.log(`\nLoad testing: ${method} ${url}`);
  console.log(`Total requests: ${totalRequests}, concurrency: ${concurrency}\n`);

  const results = [];
  for (let batchStart = 0; batchStart < totalRequests; batchStart += concurrency) {
    const batchSize = Math.min(concurrency, totalRequests - batchStart);
    const batch = Array.from({ length: batchSize }, (_, i) => fireRequest(batchStart + i));
    results.push(...(await Promise.all(batch)));
  }

  const statusCounts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('Status code breakdown:');
  console.table(statusCounts);

  const allowed = (statusCounts[200] || 0) + (statusCounts[202] || 0) + (statusCounts[401] || 0);
  const limited = statusCounts[429] || 0;

  console.log(`\n${allowed} requests got through to the application, ${limited} were rate-limited (429).`);
  if (limited > 0) {
    console.log('Rate limiting is active — the token bucket is enforcing its capacity.');
    console.log('This is a good moment to check the Jaeger UI (http://localhost:16686) for traces of the allowed requests.');
  } else {
    console.log('No requests were rate-limited. Try increasing --totalRequests, or lowering the relevant');
    console.log('RATE_LIMIT_*_CAPACITY value in .env and restarting the server, then re-run this script.');
  }
  console.log('');
}

run();
