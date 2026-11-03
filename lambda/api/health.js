'use strict';

// GET /health for status.dliu.com (contract: dliu-com/status HEALTH.md). Anonymous and read only: one cheap read per
// dependency, and nothing about the site's content, names or counts in the reply. The handler is given no request data.
const CHECK_TIMEOUT_MS = 2000;
const SLOW_MS = 1000;
// Not a travel plan id (those are 8 digits) and not a file key, so these reads never touch a real plan.
const HEALTH_KEY = 'health-check';

// Keys match /docs/health (web/info.js) and /docs/health.md; test/health.test.js keeps the three in sync.
const FUNCTIONS = Object.freeze([
  { key: 'trips', name: 'Travel plan storage' },
  { key: 'files', name: 'Attachment storage' },
  { key: 'signin', name: 'Microsoft sign-in settings' },
]);
const RANK = { pass: 0, warn: 1, fail: 2 };

async function run(probe, clock) {
  const started = clock();
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(probe),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), CHECK_TIMEOUT_MS);
      }),
    ]);
    return clock() - started > SLOW_MS ? { status: 'warn', output: 'slow' } : { status: 'pass' };
  } catch (error) {
    return { status: 'fail', output: error.timeout ? 'timeout' : 'read failed' };
  } finally {
    clearTimeout(timer);
  }
}

function probesFor({ store, files, getConfig }) {
  return {
    // One consistent GetItem of a key that never holds a travel plan.
    trips: () => store.getTrip(HEALTH_KEY),
    // One HeadObject of a fixed key that holds no file: "not found" proves the bucket answers.
    files: () => files.reachable(HEALTH_KEY),
    // The sign-in settings the app already loads (cached 5 minutes); Microsoft itself is not called.
    signin: async () => {
      const config = await getConfig();
      if (!config.tenantId || !config.clientId || !config.clientSecret) throw new Error('incomplete');
    },
  };
}

async function health({ probes, now = Date.now, clock = () => performance.now() }) {
  const functions = await Promise.all(FUNCTIONS.map(async ({ key, name }) => ({ key, name, ...(await run(probes[key], clock)) })));
  const status = functions.reduce((worst, f) => (RANK[f.status] > RANK[worst] ? f.status : worst), 'pass');
  return {
    statusCode: status === 'fail' ? 503 : 200,
    headers: {
      'content-type': 'application/health+json',
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
    },
    body: JSON.stringify({ status, time: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'), functions }),
  };
}

module.exports = { CHECK_TIMEOUT_MS, FUNCTIONS, HEALTH_KEY, SLOW_MS, health, probesFor };
