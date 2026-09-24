/**
 * Seeds a demo world so the simulation console has something to show:
 * three users, funded accounts in two currencies, and some traffic.
 *
 *   BASE_URL=http://localhost:3000 MONGO_URI=... node scripts/seed-demo.mjs
 *
 * MONGO_URI is only used to grant the admin role, which has no HTTP route.
 */
import { MongoClient } from 'mongodb';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
// directConnection bypasses replica-set discovery. The set advertises
// itself as `mongo:27017`, which only resolves inside the Docker network,
// so a host-side driver must talk to the node directly.
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ledger?directConnection=true';
const PASSWORD = process.env.DEMO_PASSWORD || 'Sup3rStrong!Pass';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${payload?.error?.message ?? ''}`);
  }
  return payload.data;
}

async function ensureUser(email, name) {
  try {
    await call('POST', '/auth/register', { body: { email, password: PASSWORD, name } });
    console.log(`  registered ${email}`);
  } catch (err) {
    if (!String(err.message).includes('409')) throw err;
    console.log(`  ${email} already exists`);
  }
  return call('POST', '/auth/login', { body: { email, password: PASSWORD } });
}

async function ensureAccount(session, { accountType, currency, nickname }) {
  const existing = await call('GET', '/accounts', { token: session.accessToken });
  const match = existing.find(
    (a) => a.accountType === accountType && a.currency === currency && a.status !== 'CLOSED'
  );
  if (match) return match;

  const account = await call('POST', '/accounts', {
    token: session.accessToken,
    body: { accountType, currency },
  });
  await call('PATCH', `/accounts/${account._id}`, {
    token: session.accessToken,
    body: { metadata: { nickname } },
  });
  console.log(`  opened ${accountType} ${currency} ${account.accountNumber} for ${session.user.email}`);
  return account;
}

async function main() {
  console.log(`Seeding ${BASE}`);

  const alice = await ensureUser('alice@example.com', 'Alice Nair');
  const bob = await ensureUser('bob@example.com', 'Bob Menon');
  const admin = await ensureUser('admin@example.com', 'Bank Admin');

  // ADMIN cannot be granted over HTTP by design, so it goes straight to the
  // database. The same connection marks the demo users verified, so the console
  // opens clean instead of nagging - register your own user to exercise the
  // verification flow.
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const users = client.db().collection('users');
  await users.updateOne(
    { email: 'admin@example.com' },
    { $addToSet: { roles: 'ADMIN' }, $inc: { tokenVersion: 1 } }
  );
  await users.updateMany(
    { email: { $in: ['alice@example.com', 'bob@example.com', 'admin@example.com'] } },
    { $set: { emailVerified: true } }
  );
  await client.close();

  // The role change invalidated the session above, so sign in again.
  const adminSession = await call('POST', '/auth/login', {
    body: { email: 'admin@example.com', password: PASSWORD },
  });
  console.log(`  admin roles: ${adminSession.user.roles.join(', ')}`);
  void admin;

  const aliceSavings = await ensureAccount(alice, {
    accountType: 'SAVINGS',
    currency: 'INR',
    nickname: 'Rainy day',
  });
  const aliceWallet = await ensureAccount(alice, {
    accountType: 'WALLET',
    currency: 'INR',
    nickname: 'Spending',
  });
  const aliceUsd = await ensureAccount(alice, {
    accountType: 'CURRENT',
    currency: 'USD',
    nickname: 'Travel (USD)',
  });
  const bobSavings = await ensureAccount(bob, {
    accountType: 'SAVINGS',
    currency: 'INR',
    nickname: 'Bob savings',
  });

  const fund = async (session, accountId, amount, reference) =>
    call('POST', '/transactions/deposit', {
      token: session.accessToken,
      body: { accountId, amount, reference },
    });

  await fund(alice, aliceSavings._id, 2_500_00, 'Salary');
  await fund(alice, aliceWallet._id, 300_00, 'Wallet top-up');
  await fund(alice, aliceUsd._id, 450_00, 'Forex purchase');
  await fund(bob, bobSavings._id, 1_200_00, 'Salary');
  console.log('  funded accounts');

  const traffic = [
    [alice, aliceSavings._id, aliceWallet._id, 250_00, 'Move to spending'],
    [alice, aliceSavings._id, bobSavings._id, 480_00, 'Rent share'],
    [bob, bobSavings._id, aliceSavings._id, 120_00, 'Dinner'],
    [alice, aliceWallet._id, bobSavings._id, 75_00, 'Concert ticket'],
  ];

  for (const [session, from, to, amount, reference] of traffic) {
    await call('POST', '/transactions', {
      token: session.accessToken,
      body: { fromAccount: from, toAccount: to, amount, reference },
    });
  }

  await call('POST', '/transactions/withdraw', {
    token: bob.accessToken,
    body: { accountId: bobSavings._id, amount: 200_00, reference: 'ATM' },
  });
  console.log('  created transfers and a withdrawal');

  const verify = await call('GET', '/ledger/verify', { token: adminSession.accessToken });
  console.log(
    `\nLedger check: debits ${verify.totalDebits} vs credits ${verify.totalCredits} → ${
      verify.balanced ? 'balanced' : 'NOT BALANCED'
    }`
  );

  console.log('\nSign in at the console with:');
  console.log(`  alice@example.com / ${PASSWORD}`);
  console.log(`  bob@example.com   / ${PASSWORD}`);
  console.log(`  admin@example.com / ${PASSWORD}   (ADMIN)`);
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
