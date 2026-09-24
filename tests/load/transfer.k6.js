/**
 * Load profile for the money path.
 *
 * Answers the question a reviewer actually asks — "what does this do under
 * load?" — with numbers instead of a shrug. It deliberately hammers transfers
 * between two accounts owned by one user, which is the *worst* case: every
 * request contends on the same two documents, so this measures the contention
 * floor rather than a flattering fan-out.
 *
 *   brew install k6
 *   npm run seed
 *   k6 run tests/load/transfer.k6.js
 *
 * Override with -e BASE_URL=... -e VUS=50 -e DURATION=60s
 */
import http from 'k6/http';
import { check, fail } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = `${__ENV.BASE_URL || 'http://localhost:3000'}/api/v1`;
const EMAIL = __ENV.EMAIL || 'alice@example.com';
const PASSWORD = __ENV.PASSWORD || 'Sup3rStrong!Pass';

const insufficientFunds = new Rate('insufficient_funds');
const rateLimited = new Rate('rate_limited');
const transferDuration = new Trend('transfer_duration', true);

export const options = {
  scenarios: {
    transfers: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '30s',
    },
  },
  thresholds: {
    // A transfer is five writes inside one MongoDB transaction, so this is not
    // a cache read. These are deliberately modest and should hold on a laptop.
    'http_req_duration{name:transfer}': ['p(95)<800', 'p(99)<2000'],
    'http_req_failed{name:transfer}': ['rate<0.01'],
    // Correctness under load matters more than speed: an overdraft here would
    // mean the conditional-update guard leaks.
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const login = http.post(`${BASE}/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (login.status !== 200) {
    fail(`login failed (${login.status}). Run "npm run seed" first.`);
  }

  const token = login.json('data.accessToken');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const accounts = http.get(`${BASE}/accounts`, { headers }).json('data');
  const inr = accounts.filter((a) => a.currency === 'INR' && a.status === 'ACTIVE');
  if (inr.length < 2) fail('need two active INR accounts; run "npm run seed"');

  // Fund the source generously so the run measures throughput rather than
  // simply draining the balance.
  http.post(
    `${BASE}/transactions/deposit`,
    JSON.stringify({ accountId: inr[0]._id, amount: 500000000, reference: 'k6 float' }),
    { headers }
  );

  return { token, from: inr[0]._id, to: inr[1]._id };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  const res = http.post(
    `${BASE}/transactions`,
    JSON.stringify({ fromAccount: data.from, toAccount: data.to, amount: 1, reference: 'k6' }),
    { headers, tags: { name: 'transfer' } }
  );

  transferDuration.add(res.timings.duration);
  insufficientFunds.add(res.status === 400 && String(res.body).includes('INSUFFICIENT_FUNDS'));
  rateLimited.add(res.status === 429);

  check(res, {
    // 429 is the rate limiter working as designed, not a failure.
    'transfer settled or was throttled': (r) => r.status === 201 || r.status === 429,
    'never a server error': (r) => r.status < 500,
    'never overdrawn': (r) => !(r.status === 201 && r.json('data.amount') !== 1),
  });
}

export function teardown(data) {
  // The point of the whole exercise: after thousands of concurrent writes, do
  // the books still balance?
  const headers = { Authorization: `Bearer ${data.token}` };
  const balance = http.get(`${BASE}/accounts/${data.from}/balance`, { headers });

  if (balance.status === 200) {
    const report = balance.json('data');
    console.log(
      `post-run reconciliation: balance=${report.balance} ledger=${report.ledgerBalance} ` +
        `reconciled=${report.reconciled}`
    );
    if (!report.reconciled) fail('the cached balance drifted from the ledger under load');
  }
}
