/**
 * End-to-end API test suite.
 *
 * Exercises every route of the Ledger API and asserts the security properties
 * that matter for a banking system: ownership, replay protection, balance
 * integrity and the double-entry invariant.
 *
 * Usage:  BASE_URL=http://localhost:3000 MONGO_URI=... node tests/api.e2e.mjs
 */
import { MongoClient } from 'mongodb';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
// directConnection bypasses replica-set discovery. The set advertises
// itself as `mongo:27017`, which only resolves inside the Docker network,
// so a host-side driver must talk to the node directly.
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ledger?directConnection=true';

let passed = 0;
let failed = 0;
const failures = [];
let group = '';

const colors = { green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };

function section(name) {
  group = name;
  console.log(`\n${colors.bold}── ${name} ${colors.reset}`);
}

function check(name, condition, info) {
  if (condition) {
    passed += 1;
    console.log(`  ${colors.green}PASS${colors.reset} ${name}`);
  } else {
    failed += 1;
    failures.push(`${group} → ${name}`);
    console.log(
      `  ${colors.red}FAIL${colors.reset} ${name}${info ? `\n       ${colors.dim}${JSON.stringify(info)}${colors.reset}` : ''}`
    );
  }
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: res.status, body: payload, headers: res.headers };
}

const unique = () => Math.random().toString(36).slice(2, 10);

async function promoteToAdmin(email) {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  await db
    .collection('users')
    .updateOne({ email: email.toLowerCase() }, { $addToSet: { roles: 'ADMIN' }, $inc: { tokenVersion: 1 } });
  await client.close();
}

async function run() {
  const suffix = unique();
  const PASSWORD = 'Sup3rStrong!Pass';

  const alice = { email: `alice.${suffix}@example.com`, password: PASSWORD, name: 'Alice' };
  const bob = { email: `bob.${suffix}@example.com`, password: PASSWORD, name: 'Bob' };
  const admin = { email: `admin.${suffix}@example.com`, password: PASSWORD, name: 'Admin' };

  // ───────────────────────── health ─────────────────────────
  section('Health & readiness');
  {
    const health = await call('GET', '/health');
    check(
      'GET /health returns 200 healthy',
      health.status === 200 && health.body.status === 'healthy',
      health.body
    );

    const ready = await call('GET', '/ready');
    check(
      'GET /ready reports mongodb and redis up',
      ready.status === 200 && ready.body.checks.mongodb && ready.body.checks.redis,
      ready.body
    );

    const missing = await call('GET', '/api/v1/does-not-exist');
    check(
      'unknown route returns a structured 404',
      missing.status === 404 && missing.body.error.code === 'ROUTE_NOT_FOUND',
      missing.body
    );

    check('every response carries an X-Request-Id', Boolean(health.headers.get('X-Request-Id')));
  }

  // ───────────────────────── auth ─────────────────────────
  section('POST /api/v1/auth/register');
  {
    const weak = await call('POST', '/api/v1/auth/register', {
      body: { email: `weak.${suffix}@example.com`, password: 'short' },
    });
    check('rejects a weak password', weak.status === 400, weak.body);

    const badEmail = await call('POST', '/api/v1/auth/register', {
      body: { email: 'not-an-email', password: PASSWORD },
    });
    check('rejects a malformed email', badEmail.status === 400, badEmail.body);

    const injection = await call('POST', '/api/v1/auth/register', {
      body: { email: { $ne: null }, password: PASSWORD },
    });
    check('rejects a NoSQL operator object as email', injection.status === 400, injection.body);

    const noSymbol = await call('POST', '/api/v1/auth/register', {
      body: { email: `nosym.${suffix}@example.com`, password: 'abcdefghij1A' },
    });
    check('rejects a password with no symbol', noSymbol.status === 400, noSymbol.body);

    const created = await call('POST', '/api/v1/auth/register', { body: alice });
    check('registers a new user', created.status === 201 && created.body.data.userId, created.body);
    check(
      'registration never returns the password hash',
      !JSON.stringify(created.body).includes('passwordHash')
    );
    alice.id = created.body?.data?.userId;
    alice.verification = created.body?.data?.verification;

    check('a new user starts unverified', created.body?.data?.emailVerified === false, created.body?.data);
    check(
      'mocked mail hands back a verification link',
      alice.verification?.delivery === 'mock' &&
        /\/verify-email\?token=/.test(alice.verification?.link ?? ''),
      alice.verification
    );

    const dup = await call('POST', '/api/v1/auth/register', { body: alice });
    check('rejects a duplicate email with 409', dup.status === 409, dup.body);

    const dupCase = await call('POST', '/api/v1/auth/register', {
      body: { ...alice, email: alice.email.toUpperCase() },
    });
    check('rejects the same email in a different case', dupCase.status === 409, dupCase.body);

    const bobCreated = await call('POST', '/api/v1/auth/register', { body: bob });
    bob.id = bobCreated.body?.data?.userId;
    const adminCreated = await call('POST', '/api/v1/auth/register', { body: admin });
    admin.id = adminCreated.body?.data?.userId;
    check('registers the other test users', Boolean(bob.id && admin.id));
  }

  section('POST /api/v1/auth/login');
  {
    const wrong = await call('POST', '/api/v1/auth/login', {
      body: { email: alice.email, password: 'Wrong!Password1' },
    });
    check('rejects a wrong password with 401', wrong.status === 401, wrong.body);
    check(
      'does not reveal whether the email exists',
      wrong.body?.error?.message === 'Invalid credentials',
      wrong.body
    );

    const unknown = await call('POST', '/api/v1/auth/login', {
      body: { email: `ghost.${suffix}@example.com`, password: PASSWORD },
    });
    check(
      'unknown user returns the same error as a wrong password',
      unknown.status === 401 && unknown.body.error.message === 'Invalid credentials',
      unknown.body
    );

    const ok = await call('POST', '/api/v1/auth/login', {
      body: { email: alice.email, password: alice.password },
    });
    check(
      'logs in and returns an access and refresh token',
      ok.status === 200 && ok.body.data.accessToken && ok.body.data.refreshToken,
      ok.body
    );
    alice.token = ok.body?.data?.accessToken;
    alice.refresh = ok.body?.data?.refreshToken;

    const bobLogin = await call('POST', '/api/v1/auth/login', {
      body: { email: bob.email, password: bob.password },
    });
    bob.token = bobLogin.body?.data?.accessToken;
    bob.refresh = bobLogin.body?.data?.refreshToken;

    await promoteToAdmin(admin.email);
    const adminLogin = await call('POST', '/api/v1/auth/login', {
      body: { email: admin.email, password: admin.password },
    });
    admin.token = adminLogin.body?.data?.accessToken;
    check(
      'the promoted user logs in holding the ADMIN role',
      adminLogin.body?.data?.user?.roles?.includes('ADMIN'),
      adminLogin.body?.data?.user
    );
  }

  section('GET /api/v1/auth/me');
  {
    const anon = await call('GET', '/api/v1/auth/me');
    check('requires a token', anon.status === 401, anon.body);

    const garbage = await call('GET', '/api/v1/auth/me', { token: 'not.a.jwt' });
    check('rejects a malformed token', garbage.status === 401, garbage.body);

    const forged = await call('GET', '/api/v1/auth/me', {
      // alg:none token for alice, signed with nothing.
      token: `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: alice.id, typ: 'access', roles: ['ADMIN'] })).toString('base64url')}.`,
    });
    check('rejects an alg:none forged token', forged.status === 401, forged.body);

    const mine = await call('GET', '/api/v1/auth/me', { token: alice.token });
    check(
      'returns the caller profile',
      mine.status === 200 && mine.body.data.email === alice.email,
      mine.body
    );
    check('profile omits the password hash', !JSON.stringify(mine.body).includes('passwordHash'));
  }

  section('POST /api/v1/auth/refresh');
  {
    const asRefresh = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: alice.token } });
    check('an access token cannot be replayed as a refresh token', asRefresh.status === 401, asRefresh.body);

    const rotated = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: alice.refresh } });
    check(
      'rotates the refresh token',
      rotated.status === 200 && rotated.body.data.refreshToken !== alice.refresh,
      rotated.body
    );
    const oldRefresh = alice.refresh;
    alice.refresh = rotated.body?.data?.refreshToken;
    alice.token = rotated.body?.data?.accessToken || alice.token;

    const replay = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: oldRefresh } });
    check('re-using a consumed refresh token is rejected', replay.status === 401, replay.body);

    // The reuse above revoked every session for alice, so she logs in again.
    const relogin = await call('POST', '/api/v1/auth/login', {
      body: { email: alice.email, password: alice.password },
    });
    alice.token = relogin.body?.data?.accessToken;
    alice.refresh = relogin.body?.data?.refreshToken;
    check('token reuse forced a re-login', relogin.status === 200, relogin.body);
  }

  section('Email verification');
  {
    const tokenOf = (link) => decodeURIComponent(String(link).split('token=')[1] ?? '');

    const empty = await call('POST', '/api/v1/auth/verify-email', { body: { token: '' } });
    check('rejects an empty token', empty.status === 400, empty.body);

    const garbage = await call('POST', '/api/v1/auth/verify-email', { body: { token: 'not-a-real-token' } });
    check('rejects an unknown token', garbage.status === 400, garbage.body);

    const injection = await call('POST', '/api/v1/auth/verify-email', { body: { token: { $ne: null } } });
    check('rejects an operator object as a token', injection.status === 400, injection.body);

    const beforeVerify = await call('GET', '/api/v1/auth/me', { token: alice.token });
    check(
      'profile reports the address as unverified',
      beforeVerify.body?.data?.emailVerified === false,
      beforeVerify.body?.data
    );

    const verified = await call('POST', '/api/v1/auth/verify-email', {
      body: { token: tokenOf(alice.verification?.link) },
    });
    check(
      'verifies with the issued token',
      verified.status === 200 && verified.body.data.verified === true,
      verified.body
    );

    const afterVerify = await call('GET', '/api/v1/auth/me', { token: alice.token });
    check(
      'profile now reports the address as verified',
      afterVerify.body?.data?.emailVerified === true,
      afterVerify.body?.data
    );

    const replay = await call('POST', '/api/v1/auth/verify-email', {
      body: { token: tokenOf(alice.verification?.link) },
    });
    check('a verification token is single-use', replay.status === 400, replay.body);

    const resendUnknown = await call('POST', '/api/v1/auth/resend-verification', {
      body: { email: `nobody.${suffix}@example.com` },
    });
    check(
      'resend for an unknown address still returns 200 (no enumeration)',
      resendUnknown.status === 200,
      resendUnknown.body
    );
    check(
      'resend for an unknown address returns no link',
      !resendUnknown.body?.data?.verification,
      resendUnknown.body?.data
    );

    const resendVerified = await call('POST', '/api/v1/auth/resend-verification', {
      body: { email: alice.email },
    });
    check(
      'resend for an already-verified address returns no link',
      resendVerified.status === 200 && !resendVerified.body?.data?.verification,
      resendVerified.body?.data
    );

    // A fresh user proves resend issues a working link and supersedes the old one.
    const rotator = { email: `rotate.${suffix}@example.com`, password: PASSWORD };
    const first = await call('POST', '/api/v1/auth/register', { body: rotator });
    const reissued = await call('POST', '/api/v1/auth/resend-verification', {
      body: { email: rotator.email },
    });
    check('resend issues a new link', Boolean(reissued.body?.data?.verification?.link), reissued.body?.data);
    check(
      'the re-issued link differs from the first',
      reissued.body?.data?.verification?.link !== first.body?.data?.verification?.link
    );

    const supersededToken = tokenOf(first.body?.data?.verification?.link);
    const superseded = await call('POST', '/api/v1/auth/verify-email', { body: { token: supersededToken } });
    check('the superseded link no longer works', superseded.status === 400, superseded.body);

    const fresh = await call('POST', '/api/v1/auth/verify-email', {
      body: { token: tokenOf(reissued.body?.data?.verification?.link) },
    });
    check('the newest link works', fresh.status === 200, fresh.body);
  }

  // ───────────────────────── accounts ─────────────────────────
  section('POST /api/v1/accounts');
  {
    const anon = await call('POST', '/api/v1/accounts', { body: { accountType: 'SAVINGS' } });
    check('requires authentication', anon.status === 401, anon.body);

    const badType = await call('POST', '/api/v1/accounts', {
      token: alice.token,
      body: { accountType: 'MATTRESS' },
    });
    check('rejects an unknown account type', badType.status === 400, badType.body);

    const badCurrency = await call('POST', '/api/v1/accounts', {
      token: alice.token,
      body: { accountType: 'SAVINGS', currency: 'XYZ' },
    });
    check('rejects an unsupported currency', badCurrency.status === 400, badCurrency.body);

    const created = await call('POST', '/api/v1/accounts', {
      token: alice.token,
      body: { accountType: 'SAVINGS', currency: 'INR' },
    });
    check('opens an account', created.status === 201 && created.body.data._id, created.body);
    check(
      'the account number is server-generated',
      /^\d{16}$/.test(created.body?.data?.accountNumber || ''),
      created.body?.data
    );
    alice.account = created.body?.data?._id;

    const minted = await call('POST', '/api/v1/accounts', {
      token: alice.token,
      body: {
        accountType: 'WALLET',
        currency: 'INR',
        balance: 999999999,
        availableBalance: 999999999,
        status: 'ACTIVE',
      },
    });
    check(
      'a client-supplied opening balance is ignored (no money minting)',
      minted.status === 201 && minted.body.data.balance === 0 && minted.body.data.availableBalance === 0,
      minted.body?.data
    );
    alice.wallet = minted.body?.data?._id;

    const forOther = await call('POST', '/api/v1/accounts', {
      token: alice.token,
      body: { accountType: 'SAVINGS', userId: bob.id },
    });
    check('a non-admin cannot open an account for someone else', forOther.status === 403, forOther.body);

    const usd = await call('POST', '/api/v1/accounts', {
      token: alice.token,
      body: { accountType: 'CURRENT', currency: 'USD' },
    });
    alice.usdAccount = usd.body?.data?._id;

    const bobAccount = await call('POST', '/api/v1/accounts', {
      token: bob.token,
      body: { accountType: 'SAVINGS', currency: 'INR' },
    });
    bob.account = bobAccount.body?.data?._id;
    check('the second user also gets an account', bobAccount.status === 201, bobAccount.body);

    const adminAccount = await call('POST', '/api/v1/accounts', {
      token: admin.token,
      body: { accountType: 'CURRENT', currency: 'INR' },
    });
    admin.account = adminAccount.body?.data?._id;
  }

  section('GET /api/v1/accounts');
  {
    const mine = await call('GET', '/api/v1/accounts', { token: alice.token });
    check(
      'lists only the caller accounts',
      mine.status === 200 && mine.body.data.every((a) => a.userId === alice.id),
      mine.body?.data?.map((a) => a.userId)
    );

    const one = await call('GET', `/api/v1/accounts/${alice.account}`, { token: alice.token });
    check('returns an owned account', one.status === 200 && one.body.data._id === alice.account, one.body);

    const theirs = await call('GET', `/api/v1/accounts/${bob.account}`, { token: alice.token });
    check("another user's account is not readable (IDOR blocked)", theirs.status === 404, theirs.body);

    const asAdmin = await call('GET', `/api/v1/accounts/${bob.account}`, { token: admin.token });
    check('an admin can read any account', asAdmin.status === 200, asAdmin.body);

    const badId = await call('GET', '/api/v1/accounts/not-an-id', { token: alice.token });
    check('rejects a malformed account id', badId.status === 400, badId.body);

    const otherList = await call('GET', `/api/v1/accounts/user/${bob.id}`, { token: alice.token });
    check("cannot list another user's accounts", otherList.status === 403, otherList.body);

    const ownList = await call('GET', `/api/v1/accounts/user/${alice.id}`, { token: alice.token });
    check('can list own accounts by user id', ownList.status === 200, ownList.body);

    const huge = await call('GET', '/api/v1/accounts?limit=100000', { token: alice.token });
    check('an out-of-range page size is rejected', huge.status === 400, huge.body);
  }

  section('PATCH /api/v1/accounts/:id');
  {
    const meta = await call('PATCH', `/api/v1/accounts/${alice.account}`, {
      token: alice.token,
      body: { metadata: { nickname: 'Rainy day' } },
    });
    check(
      'updates metadata',
      meta.status === 200 && meta.body.data.metadata.nickname === 'Rainy day',
      meta.body
    );

    const tamper = await call('PATCH', `/api/v1/accounts/${alice.account}`, {
      token: alice.token,
      body: { balance: 500000, availableBalance: 500000, status: 'ACTIVE' },
    });
    check(
      'a balance sent to PATCH is ignored (mass assignment blocked)',
      tamper.status === 200 && tamper.body.data.balance === 0,
      tamper.body?.data
    );

    const theirs = await call('PATCH', `/api/v1/accounts/${bob.account}`, {
      token: alice.token,
      body: { metadata: {} },
    });
    check("cannot patch another user's account", theirs.status === 404, theirs.body);
  }

  // ───────────────────────── money ─────────────────────────
  section('POST /api/v1/transactions/deposit');
  {
    const anon = await call('POST', '/api/v1/transactions/deposit', {
      body: { accountId: alice.account, amount: 100 },
    });
    check('requires authentication', anon.status === 401, anon.body);

    for (const [label, amount] of [
      ['zero', 0],
      ['negative', -5000],
      ['fractional', 10.5],
      ['string', '1000'],
      ['NaN', 'abc'],
      ['huge', 1e18],
    ]) {
      const res = await call('POST', '/api/v1/transactions/deposit', {
        token: alice.token,
        body: { accountId: alice.account, amount },
      });
      check(`rejects a ${label} amount`, res.status === 400, { amount, status: res.status, body: res.body });
    }

    const ok = await call('POST', '/api/v1/transactions/deposit', {
      token: alice.token,
      body: { accountId: alice.account, amount: 500_00, reference: 'Opening funding' },
    });
    check(
      'deposits 500.00 INR',
      ok.status === 201 && ok.body.data.amount === 50000 && ok.body.data.status === 'COMPLETED',
      ok.body
    );

    const balance = await call('GET', `/api/v1/accounts/${alice.account}/balance`, { token: alice.token });
    check('the balance reflects the deposit', balance.body?.data?.balance === 50000, balance.body?.data);
    check(
      'the cached balance matches the ledger',
      balance.body?.data?.reconciled === true,
      balance.body?.data
    );

    const theirs = await call('POST', '/api/v1/transactions/deposit', {
      token: alice.token,
      body: { accountId: bob.account, amount: 10000 },
    });
    check("cannot deposit into another user's account", theirs.status === 404, theirs.body);

    // Fund the others for the transfer tests.
    await call('POST', '/api/v1/transactions/deposit', {
      token: bob.token,
      body: { accountId: bob.account, amount: 200_00 },
    });
    await call('POST', '/api/v1/transactions/deposit', {
      token: alice.token,
      body: { accountId: alice.usdAccount, amount: 100_00 },
    });
  }

  section('POST /api/v1/transactions (transfer)');
  {
    const self = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { fromAccount: alice.account, toAccount: alice.account, amount: 1000 },
    });
    check('rejects a transfer to the same account', self.status === 400, self.body);

    const crossCurrency = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { fromAccount: alice.usdAccount, toAccount: alice.account, amount: 1000 },
    });
    check('rejects a cross-currency transfer', crossCurrency.status === 400, crossCurrency.body);

    const notMine = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { fromAccount: bob.account, toAccount: alice.account, amount: 1000 },
    });
    check("cannot spend from another user's account", notMine.status === 404, notMine.body);

    const overdraft = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { fromAccount: alice.account, toAccount: bob.account, amount: 999_999_00 },
    });
    check(
      'rejects an overdraft',
      overdraft.status === 400 && overdraft.body.error.code === 'INSUFFICIENT_FUNDS',
      overdraft.body
    );

    const missingDest = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { fromAccount: alice.account, toAccount: '507f1f77bcf86cd799439011', amount: 1000 },
    });
    check('rejects an unknown destination account', missingDest.status === 404, missingDest.body);

    const ok = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { fromAccount: alice.account, toAccount: bob.account, amount: 120_00, reference: 'Dinner' },
    });
    check('transfers 120.00 INR', ok.status === 201 && ok.body.data.status === 'COMPLETED', ok.body);
    alice.transferId = ok.body?.data?._id;

    const from = await call('GET', `/api/v1/accounts/${alice.account}/balance`, { token: alice.token });
    const to = await call('GET', `/api/v1/accounts/${bob.account}/balance`, { token: bob.token });
    check('the sender was debited', from.body?.data?.balance === 38000, from.body?.data);
    check('the receiver was credited', to.body?.data?.balance === 32000, to.body?.data);
    check(
      'both sides stay reconciled with the ledger',
      from.body?.data?.reconciled === true && to.body?.data?.reconciled === true
    );
  }

  section('Idempotency');
  {
    const key = `key-${unique()}`;
    const body = {
      fromAccount: alice.account,
      toAccount: bob.account,
      amount: 25_00,
      reference: 'Idempotent',
    };

    const first = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body,
      headers: { 'X-Idempotency-Key': key },
    });
    check('the first request succeeds', first.status === 201, first.body);

    const replay = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body,
      headers: { 'X-Idempotency-Key': key },
    });
    check('a replay returns the same transaction', replay.body?.data?._id === first.body?.data?._id, {
      first: first.body?.data?._id,
      replay: replay.body?.data?._id,
    });

    const balance = await call('GET', `/api/v1/accounts/${alice.account}/balance`, { token: alice.token });
    check('the money moved exactly once', balance.body?.data?.balance === 35500, balance.body?.data);

    const differentBody = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { ...body, amount: 999_00 },
      headers: { 'X-Idempotency-Key': key },
    });
    check(
      'the same key with a different payload is rejected',
      differentBody.status === 409,
      differentBody.body
    );

    const bobReuse = await call('POST', '/api/v1/transactions', {
      token: bob.token,
      body: { fromAccount: bob.account, toAccount: alice.account, amount: 100 },
      headers: { 'X-Idempotency-Key': key },
    });
    check(
      "another user's identical key is not a cache hit (keys are per-user)",
      bobReuse.status === 201 && bobReuse.body?.data?._id !== first.body?.data?._id,
      bobReuse.body
    );

    const badKey = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body,
      headers: { 'X-Idempotency-Key': 'has spaces and #' },
    });
    check('a malformed idempotency key is rejected', badKey.status === 400, badKey.body);

    // Ten simultaneous identical requests must move the money once.
    const raceKey = `race-${unique()}`;
    const raceBody = { fromAccount: alice.account, toAccount: bob.account, amount: 10_00 };
    const before = (await call('GET', `/api/v1/accounts/${alice.account}/balance`, { token: alice.token }))
      .body.data.balance;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call('POST', '/api/v1/transactions', {
          token: alice.token,
          body: raceBody,
          headers: { 'X-Idempotency-Key': raceKey },
        })
      )
    );
    const after = (await call('GET', `/api/v1/accounts/${alice.account}/balance`, { token: alice.token }))
      .body.data.balance;
    const created = results.filter((r) => r.status === 201).length;
    check('10 concurrent identical requests debit the account once', before - after === 1000, {
      before,
      after,
      statuses: results.map((r) => r.status),
    });
    check(
      'concurrent duplicates are either replayed or refused, never double-spent',
      created >= 1 && results.every((r) => [201, 409].includes(r.status)),
      results.map((r) => r.status)
    );
  }

  section('Concurrency without an idempotency key');
  {
    // Alice tries to spend her whole balance five times at once. Only as many
    // as the balance covers may succeed.
    const balanceBefore = (
      await call('GET', `/api/v1/accounts/${alice.account}/balance`, { token: alice.token })
    ).body.data.balance;
    const chunk = Math.floor(balanceBefore / 2);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('POST', '/api/v1/transactions', {
          token: alice.token,
          body: { fromAccount: alice.account, toAccount: bob.account, amount: chunk },
        })
      )
    );
    const ok = results.filter((r) => r.status === 201).length;
    const balanceAfter = (
      await call('GET', `/api/v1/accounts/${alice.account}/balance`, { token: alice.token })
    ).body.data.balance;

    check('concurrent spends cannot overdraw the account', balanceAfter >= 0, {
      balanceBefore,
      balanceAfter,
      ok,
    });
    check(
      'the debited total matches the transfers that succeeded',
      balanceBefore - balanceAfter === ok * chunk,
      { balanceBefore, balanceAfter, ok, chunk }
    );
  }

  section('POST /api/v1/transactions/withdraw');
  {
    const tooMuch = await call('POST', '/api/v1/transactions/withdraw', {
      token: bob.token,
      body: { accountId: bob.account, amount: 999_999_00 },
    });
    check('rejects a withdrawal above the balance', tooMuch.status === 400, tooMuch.body);

    const before = (await call('GET', `/api/v1/accounts/${bob.account}/balance`, { token: bob.token })).body
      .data.balance;
    const ok = await call('POST', '/api/v1/transactions/withdraw', {
      token: bob.token,
      body: { accountId: bob.account, amount: 50_00 },
    });
    check('withdraws 50.00 INR', ok.status === 201 && ok.body.data.type === 'WITHDRAWAL', ok.body);

    const after = (await call('GET', `/api/v1/accounts/${bob.account}/balance`, { token: bob.token })).body
      .data.balance;
    check('the withdrawal reduced the balance by exactly the amount', before - after === 5000, {
      before,
      after,
    });
  }

  section('Holds (authorize / capture / void)');
  {
    const balanceOf = async (id, who) =>
      (await call('GET', `/api/v1/accounts/${id}/balance`, { token: who.token })).body.data;

    // Fund the section rather than depending on whatever the concurrency tests
    // above happened to leave behind.
    await call('POST', '/api/v1/transactions/deposit', {
      token: alice.token,
      body: { accountId: alice.account, amount: 1000_00, reference: 'Hold section float' },
    });

    const before = await balanceOf(alice.account, alice);

    const held = await call('POST', '/api/v1/transactions/authorize', {
      token: alice.token,
      body: { fromAccount: alice.account, toAccount: bob.account, amount: 40_00, reference: 'Hold test' },
    });
    check('places a hold', held.status === 201 && held.body.data.status === 'PENDING', held.body);
    const holdId = held.body?.data?._id;

    const afterHold = await balanceOf(alice.account, alice);
    check('a hold reserves availableBalance', before.availableBalance - afterHold.availableBalance === 4000, {
      before: before.availableBalance,
      after: afterHold.availableBalance,
    });
    check('a hold does not move the ledger balance', afterHold.balance === before.balance, {
      before: before.balance,
      after: afterHold.balance,
    });
    check('a hold keeps the account reconciled', afterHold.reconciled === true, afterHold);

    const legs = await call('GET', `/api/v1/ledger/transactions/${holdId}`, { token: alice.token });
    check('a hold writes no ledger entries', legs.body?.data?.length === 0, legs.body);

    const stillBalanced = await call('GET', '/api/v1/ledger/verify', { token: admin.token });
    check(
      'an outstanding hold does not unbalance the books',
      stillBalanced.body?.data?.balanced === true,
      stillBalanced.body?.data
    );

    // Reserving more than remains available must fail.
    const greedy = await call('POST', '/api/v1/transactions/authorize', {
      token: alice.token,
      body: { fromAccount: alice.account, toAccount: bob.account, amount: afterHold.availableBalance + 100 },
    });
    check('cannot reserve more than is available', greedy.status === 400, greedy.body);

    const notMine = await call('POST', '/api/v1/transactions/authorize', {
      token: bob.token,
      body: { fromAccount: alice.account, toAccount: bob.account, amount: 100 },
    });
    check("cannot place a hold on someone else's account", notMine.status === 404, notMine.body);

    // ── void ──
    const voidable = await call('POST', '/api/v1/transactions/authorize', {
      token: alice.token,
      body: { fromAccount: alice.account, toAccount: bob.account, amount: 15_00 },
    });
    const beforeVoid = await balanceOf(alice.account, alice);
    const voided = await call('POST', `/api/v1/transactions/${voidable.body.data._id}/void`, {
      token: alice.token,
      body: { reason: 'Changed my mind' },
    });
    check('voids a hold', voided.status === 200 && voided.body.data.status === 'CANCELLED', voided.body);

    const afterVoid = await balanceOf(alice.account, alice);
    check(
      'voiding returns the reservation',
      afterVoid.availableBalance - beforeVoid.availableBalance === 1500,
      { before: beforeVoid.availableBalance, after: afterVoid.availableBalance }
    );
    check('voiding never touched the ledger balance', afterVoid.balance === beforeVoid.balance);

    const reVoid = await call('POST', `/api/v1/transactions/${voidable.body.data._id}/void`, {
      token: alice.token,
    });
    check('a voided hold cannot be voided again', reVoid.status === 409, reVoid.body);

    const captureVoided = await call('POST', `/api/v1/transactions/${voidable.body.data._id}/capture`, {
      token: alice.token,
    });
    check('a voided hold cannot be captured', captureVoided.status === 409, captureVoided.body);

    // ── capture ──
    const bobBefore = await balanceOf(bob.account, bob);
    const captured = await call('POST', `/api/v1/transactions/${holdId}/capture`, { token: alice.token });
    check(
      'captures a hold',
      captured.status === 200 && captured.body.data.status === 'COMPLETED',
      captured.body
    );

    const afterCapture = await balanceOf(alice.account, alice);
    const bobAfter = await balanceOf(bob.account, bob);

    check('capturing moves the ledger balance', before.balance - afterCapture.balance === 4000, {
      before: before.balance,
      after: afterCapture.balance,
    });
    // Capture consumes the reservation rather than returning it, so the
    // available balance must not move on capture.
    check(
      'capturing consumes the reservation instead of returning it',
      afterCapture.availableBalance === afterVoid.availableBalance,
      { beforeCapture: afterVoid.availableBalance, afterCapture: afterCapture.availableBalance }
    );

    // With every hold now settled or released, the two balances must agree
    // again. Any gap here would be a reservation that leaked.
    check(
      'no reservation leaked once all holds are resolved',
      afterCapture.balance === afterCapture.availableBalance,
      { balance: afterCapture.balance, available: afterCapture.availableBalance }
    );
    check('the receiver was credited', bobAfter.balance - bobBefore.balance === 4000, {
      before: bobBefore.balance,
      after: bobAfter.balance,
    });
    check(
      'both sides reconcile after capture',
      afterCapture.reconciled === true && bobAfter.reconciled === true
    );

    const capturedLegs = await call('GET', `/api/v1/ledger/transactions/${holdId}`, { token: alice.token });
    check(
      'capturing writes both ledger entries',
      capturedLegs.body?.data?.length === 2,
      capturedLegs.body?.data?.length
    );

    const reCapture = await call('POST', `/api/v1/transactions/${holdId}/capture`, { token: alice.token });
    check('a captured hold cannot be captured twice', reCapture.status === 409, reCapture.body);

    const finalVerify = await call('GET', '/api/v1/ledger/verify', { token: admin.token });
    check(
      'the books still balance after capture and void',
      finalVerify.body?.data?.balanced === true,
      finalVerify.body?.data
    );
  }

  section('Frozen and closed accounts');
  {
    const freeze = await call('POST', `/api/v1/accounts/${alice.wallet}/freeze`, { token: alice.token });
    check(
      'an owner can freeze their account',
      freeze.status === 200 && freeze.body.data.status === 'FROZEN',
      freeze.body
    );

    const intoFrozen = await call('POST', '/api/v1/transactions', {
      token: bob.token,
      body: { fromAccount: bob.account, toAccount: alice.wallet, amount: 100 },
    });
    check('a frozen account cannot receive money', intoFrozen.status === 409, intoFrozen.body);

    const depositFrozen = await call('POST', '/api/v1/transactions/deposit', {
      token: alice.token,
      body: { accountId: alice.wallet, amount: 100 },
    });
    check('a frozen account cannot be deposited into', depositFrozen.status === 409, depositFrozen.body);

    const selfUnfreeze = await call('POST', `/api/v1/accounts/${alice.wallet}/unfreeze`, {
      token: alice.token,
    });
    check('a user cannot unfreeze their own account', selfUnfreeze.status === 403, selfUnfreeze.body);

    const adminUnfreeze = await call('POST', `/api/v1/accounts/${alice.wallet}/unfreeze`, {
      token: admin.token,
    });
    check(
      'an admin can unfreeze it',
      adminUnfreeze.status === 200 && adminUnfreeze.body.data.status === 'ACTIVE',
      adminUnfreeze.body
    );

    const closeFunded = await call('DELETE', `/api/v1/accounts/${bob.account}`, { token: bob.token });
    check('an account with a balance cannot be closed', closeFunded.status === 409, closeFunded.body);

    const closeEmpty = await call('DELETE', `/api/v1/accounts/${alice.wallet}`, { token: alice.token });
    check(
      'an empty account can be closed',
      closeEmpty.status === 200 && closeEmpty.body.data.status === 'CLOSED',
      closeEmpty.body
    );

    const useClosed = await call('POST', '/api/v1/transactions/deposit', {
      token: alice.token,
      body: { accountId: alice.wallet, amount: 100 },
    });
    check('a closed account cannot be used', useClosed.status === 409, useClosed.body);
  }

  section('GET /api/v1/transactions');
  {
    const mine = await call('GET', `/api/v1/transactions/${alice.transferId}`, { token: alice.token });
    check('the initiator can read the transaction', mine.status === 200, mine.body);

    const counterparty = await call('GET', `/api/v1/transactions/${alice.transferId}`, { token: bob.token });
    check('the counterparty can read it too', counterparty.status === 200, counterparty.body);

    const adminRead = await call('GET', `/api/v1/transactions/${alice.transferId}`, { token: admin.token });
    check('an admin can read it', adminRead.status === 200, adminRead.body);

    const stranger = await call('GET', `/api/v1/transactions/${alice.transferId}`, {
      token: admin.token ? undefined : undefined,
    });
    check('an anonymous caller cannot', stranger.status === 401, stranger.body);

    const list = await call('GET', `/api/v1/transactions/account/${alice.account}?limit=5`, {
      token: alice.token,
    });
    check(
      'lists transactions for an owned account',
      list.status === 200 && Array.isArray(list.body.data),
      list.body
    );
    check('honours the page size', (list.body?.data?.length ?? 99) <= 5, list.body?.pagination);

    const theirs = await call('GET', `/api/v1/transactions/account/${bob.account}`, { token: alice.token });
    check("cannot list another user's transactions", theirs.status === 404, theirs.body);
  }

  section('POST /api/v1/transactions/:id/reverse');
  {
    const asUser = await call('POST', `/api/v1/transactions/${alice.transferId}/reverse`, {
      token: alice.token,
      body: { reason: 'oops' },
    });
    check('a normal user cannot reverse a transaction', asUser.status === 403, asUser.body);

    const bobBefore = (await call('GET', `/api/v1/accounts/${bob.account}/balance`, { token: bob.token }))
      .body.data.balance;
    const reversed = await call('POST', `/api/v1/transactions/${alice.transferId}/reverse`, {
      token: admin.token,
      body: { reason: 'Disputed' },
    });
    check('an admin can reverse it', reversed.status === 201, reversed.body);

    const bobAfter = (await call('GET', `/api/v1/accounts/${bob.account}/balance`, { token: bob.token })).body
      .data.balance;
    check('the reversal moved the money back', bobBefore - bobAfter === 12000, { bobBefore, bobAfter });

    const original = await call('GET', `/api/v1/transactions/${alice.transferId}`, { token: admin.token });
    check(
      'the original is marked REVERSED, not deleted',
      original.body?.data?.status === 'REVERSED',
      original.body?.data
    );

    const again = await call('POST', `/api/v1/transactions/${alice.transferId}/reverse`, {
      token: admin.token,
    });
    check('a transaction cannot be reversed twice', again.status === 409, again.body);
  }

  section('GET /api/v1/admin/audit-logs');
  {
    const asUser = await call('GET', '/api/v1/admin/audit-logs', { token: alice.token });
    check('a normal user cannot read the audit log', asUser.status === 403, asUser.body);

    const anon = await call('GET', '/api/v1/admin/audit-logs');
    check('the audit log requires authentication', anon.status === 401, anon.body);

    const logs = await call('GET', '/api/v1/admin/audit-logs', { token: admin.token });
    check('an admin can read the audit log', logs.status === 200 && Array.isArray(logs.body.data), logs.body);

    // The reversal performed earlier must have left a trail.
    const reversal = (logs.body?.data ?? []).find(
      (entry) => entry.action === 'TRANSACTION_REVERSED' && entry.targetId === alice.transferId
    );
    check('the reversal was recorded', Boolean(reversal), logs.body?.data?.slice(0, 3));
    check('the entry names the operator', reversal?.actorEmail === admin.email, reversal);
    check('the entry keeps the reason', reversal?.reason === 'Disputed', reversal);
    check('the entry carries the request id', Boolean(reversal?.requestId), reversal);

    // The unfreeze an admin performed on Alice's wallet must be there too.
    const unfroze = (logs.body?.data ?? []).find((entry) => entry.action === 'ACCOUNT_UNFROZEN');
    check("an admin unfreezing someone else's account is recorded", Boolean(unfroze), unfroze);
  }

  section('GET /api/v1/ledger');
  {
    const anon = await call('GET', `/api/v1/ledger/accounts/${alice.account}`);
    check('the ledger requires authentication', anon.status === 401, anon.body);

    const mine = await call('GET', `/api/v1/ledger/accounts/${alice.account}`, { token: alice.token });
    check(
      'returns journal entries for an owned account',
      mine.status === 200 && mine.body.data.length > 0,
      mine.body?.pagination
    );
    check(
      'entries record the balance after each movement',
      mine.body?.data?.every((e) => typeof e.balanceAfter === 'number'),
      mine.body?.data?.[0]
    );

    const theirs = await call('GET', `/api/v1/ledger/accounts/${bob.account}`, { token: alice.token });
    check("cannot read another user's ledger", theirs.status === 404, theirs.body);

    const byTxn = await call('GET', `/api/v1/ledger/transactions/${alice.transferId}`, {
      token: alice.token,
    });
    check(
      'returns both legs of a transaction',
      byTxn.status === 200 && byTxn.body.data.length === 2,
      byTxn.body?.data?.length
    );
    const legs = byTxn.body?.data ?? [];
    check(
      'the two legs are a matching debit and credit',
      legs.length === 2 &&
        legs[0].amount === legs[1].amount &&
        new Set(legs.map((l) => l.entryType)).size === 2,
      legs
    );

    const reconcile = await call('GET', `/api/v1/ledger/accounts/${alice.account}/reconcile`, {
      token: alice.token,
    });
    check(
      'per-account reconciliation passes',
      reconcile.body?.data?.reconciled === true,
      reconcile.body?.data
    );

    const verifyAsUser = await call('GET', '/api/v1/ledger/verify', { token: alice.token });
    check(
      'only an admin can run the system-wide verification',
      verifyAsUser.status === 403,
      verifyAsUser.body
    );

    const verify = await call('GET', '/api/v1/ledger/verify', { token: admin.token });
    check(
      'total debits equal total credits across the whole ledger',
      verify.status === 200 && verify.body.data.balanced === true,
      verify.body?.data
    );
  }

  section('POST /api/v1/auth/logout & change-password');
  {
    const logout = await call('POST', '/api/v1/auth/logout', {
      token: bob.token,
      body: { refreshToken: bob.refresh },
    });
    check('logs out', logout.status === 200, logout.body);

    const afterLogout = await call('GET', '/api/v1/auth/me', { token: bob.token });
    check('the access token is revoked immediately', afterLogout.status === 401, afterLogout.body);

    const refreshAfterLogout = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: bob.refresh },
    });
    check('the refresh token is revoked too', refreshAfterLogout.status === 401, refreshAfterLogout.body);

    const relogin = await call('POST', '/api/v1/auth/login', {
      body: { email: bob.email, password: bob.password },
    });
    bob.token = relogin.body?.data?.accessToken;

    const weak = await call('POST', '/api/v1/auth/change-password', {
      token: bob.token,
      body: { currentPassword: bob.password, newPassword: 'weak' },
    });
    check('rejects a weak new password', weak.status === 400, weak.body);

    const wrongCurrent = await call('POST', '/api/v1/auth/change-password', {
      token: bob.token,
      body: { currentPassword: 'Nope!Nope!1', newPassword: 'An0ther!Strong1' },
    });
    check('rejects a wrong current password', wrongCurrent.status === 401, wrongCurrent.body);

    const changed = await call('POST', '/api/v1/auth/change-password', {
      token: bob.token,
      body: { currentPassword: bob.password, newPassword: 'An0ther!Strong1' },
    });
    check('changes the password', changed.status === 200, changed.body);

    const oldToken = await call('GET', '/api/v1/auth/me', { token: bob.token });
    check('every session dies with the old password', oldToken.status === 401, oldToken.body);

    const oldPassword = await call('POST', '/api/v1/auth/login', {
      body: { email: bob.email, password: bob.password },
    });
    check('the old password no longer works', oldPassword.status === 401, oldPassword.body);

    const newPassword = await call('POST', '/api/v1/auth/login', {
      body: { email: bob.email, password: 'An0ther!Strong1' },
    });
    check('the new password works', newPassword.status === 200, newPassword.body);
  }

  section('Hardening');
  {
    const health = await call('GET', '/health');
    check('X-Powered-By is not advertised', !health.headers.get('X-Powered-By'));
    check('helmet sets X-Content-Type-Options', health.headers.get('X-Content-Type-Options') === 'nosniff');
    check('helmet sets HSTS', Boolean(health.headers.get('Strict-Transport-Security')));

    const malformed = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    check('malformed JSON returns 400, not a stack trace', malformed.status === 400);

    const oversized = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(200_000) }),
    });
    check(
      'an oversized body is rejected',
      oversized.status === 413 || oversized.status === 400,
      oversized.status
    );

    const injection = await call('POST', '/api/v1/transactions', {
      token: alice.token,
      body: { fromAccount: { $ne: null }, toAccount: bob.account, amount: 100 },
    });
    check('a NoSQL operator object in an id field is rejected', injection.status === 400, injection.body);

    const errorShape = await call('GET', '/api/v1/accounts/not-an-id', { token: alice.token });
    check(
      'errors share one shape with a code and a requestId',
      errorShape.body?.success === false && errorShape.body?.error?.code && errorShape.body?.error?.requestId,
      errorShape.body
    );
  }

  // ───────────────────────── summary ─────────────────────────
  console.log(`\n${colors.bold}${passed} passed, ${failed} failed${colors.reset}`);
  if (failures.length > 0) {
    console.log(`\n${colors.red}Failures:${colors.reset}`);
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
