# Ledger API

A double-entry banking ledger API in TypeScript: Express 5, MongoDB (replica
set, multi-document transactions), Redis (rate limiting, idempotency, token
revocation).

Every rupee that moves produces a balanced pair of journal entries, and the
system can prove at any moment that total debits equal total credits.

- **API reference:** [`docs/api-reference.md`](docs/api-reference.md)
- **Security model:** [`docs/security.md`](docs/security.md)

---

## Quick start

```bash
# 1. infrastructure (MongoDB single-node replica set + Redis)
npm run infra:up

# 2. environment
cp .env.example .env
# set JWT_SECRET and JWT_REFRESH_SECRET:
#   openssl rand -hex 32

# 3. run
npm install
npm run dev          # tsc-watch + restart

# 4. test everything
npm run test:e2e     # 124 end-to-end checks against a running server
```

Run the whole thing in containers instead:

```bash
npm run stack:up     # mongo + redis + api
npm run stack:logs
```

> **MongoDB must be a replica set.** Transfers use multi-document transactions,
> which standalone `mongod` does not support. `docker-compose.yml` sets up a
> single-node replica set automatically. Pointing at your own server means
> starting it with `--replSet rs0` and running `rs.initiate()` once.

---

## Architecture

```
src/
├── api/                      HTTP layer
│   ├── routes/               route definitions + validation chains
│   ├── controllers/          request → service → response
│   ├── middlewares/          auth, idempotency, rate limit, errors, request id
│   └── validators/           shared express-validator rules
├── application/services/     business logic (auth, account, transaction, ledger)
├── domain/entities/          framework-free domain types
├── infrastructure/
│   ├── database/mongodb/     models + repositories + connection
│   └── cache/                Redis client, cache service, token store
└── shared/                   config, errors, utils, DI container
```

Dependencies point inward: controllers know services, services know
repositories, repositories know Mongoose. Nothing points back out.

---

## Core concepts

### Money is integers

Balances and amounts are **integers in the smallest currency unit** — paise for
INR, cents for USD. `500_00` means ₹500.00. Floats are never used: `0.1 + 0.2`
is not `0.3` in IEEE-754, and a ledger that cannot balance is worthless.

The API rejects decimals *and* numeric strings, so a client bug surfaces
immediately instead of becoming a rounding error.

### Double-entry bookkeeping

Every transaction writes two journal entries that sum to zero:

| Operation | Debit | Credit |
|---|---|---|
| Transfer | sender | receiver |
| Deposit | bank contra account (`SYSTEM-INR`) | customer |
| Withdrawal | customer | bank contra account |

Deposits and withdrawals go through a per-currency system account so the books
stay balanced even when money enters or leaves the bank. `GET /api/v1/ledger/verify`
proves the invariant across the entire database.

The journal is **append-only**: the schema refuses updates and deletes. A
mistake is corrected by a reversing transaction, never by an edit.

### Atomicity

A transfer runs inside a MongoDB transaction covering: the debit, the credit,
the transaction record and both journal entries. Either all five land or none do.

The debit is a conditional update:

```ts
AccountModel.findOneAndUpdate(
  { _id: from, availableBalance: mongoose.trusted({ $gte: amount }) },
  { $inc: { balance: -amount, availableBalance: -amount } },
  { session }
)
```

The balance check lives *inside the update filter*, so two concurrent debits
cannot both read "enough funds" and both succeed. A read-then-write check would
lose that race.

### Idempotency

Send `X-Idempotency-Key` on any mutating request. Three layers back it up:

1. A Redis lock rejects a second in-flight request with the same key (409).
2. A unique sparse MongoDB index on `idempotencyKey` makes a duplicate commit
   impossible even if both requests get past the lock.
3. The stored 2xx response is replayed for 24 hours.

Keys are namespaced per user and bound to the request payload. Reusing a key
with a *different* body is a 409 — a client bug must not be handed a response
that does not match what it asked for.

---

## Configuration

See `.env.example` for the full list. The ones that matter:

| Variable | Default | Notes |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017/ledger?replicaSet=rs0` | must be a replica set |
| `REDIS_URL` | `redis://localhost:6379` | |
| `JWT_SECRET` | — | **required in production**, ≥ 32 chars |
| `JWT_REFRESH_SECRET` | derived | separate key for refresh tokens |
| `TRUST_PROXY` | unset | proxy hop count when behind a load balancer |
| `CORS_ORIGINS` | none (same-origin) | comma-separated allow-list |
| `ALLOW_SELF_DEPOSIT` | `true` outside production | lets a user fund their own account |
| `SUPPORTED_CURRENCIES` | `INR,USD,EUR,GBP` | |

In production the app refuses to boot without strong JWT secrets rather than
falling back to a default key.

---

## Administration

```bash
npx ts-node scripts/promote-admin.ts alice@example.com
```

Admins can read any account, unfreeze accounts, reverse transactions and run
the system-wide ledger verification. Promotion invalidates existing sessions,
so the user logs in again to pick up the role.

---

## Testing

`tests/api.e2e.mjs` drives a running server through every route and asserts the
behaviour that matters:

```bash
BASE_URL=http://localhost:3000 MONGO_URI=mongodb://127.0.0.1:27017/ledger npm run test:e2e
```

It covers happy paths plus: IDOR on every read surface, money minting through
account creation and PATCH, alg:none token forgery, access-token-as-refresh
replay, refresh-token reuse, NoSQL operator injection, cross-currency
transfers, self-transfers, overdrafts, frozen/closed accounts, idempotent
replay, 10 concurrent identical requests, 5 concurrent overdraft attempts,
oversized bodies and the double-entry invariant.

## Production checklist

- [ ] Real `JWT_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -hex 32`)
- [ ] `NODE_ENV=production`, `ALLOW_SELF_DEPOSIT=false`
- [ ] `TRUST_PROXY` set to the real hop count
- [ ] `CORS_ORIGINS` set to the front-end origin
- [ ] MongoDB replica set with authentication and TLS
- [ ] Redis with `requirepass` and TLS
- [ ] TLS termination in front of the API
- [ ] Ship logs somewhere (request ids are already on every line)
