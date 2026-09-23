# Ledger API

A double-entry banking ledger API in TypeScript: Express 5, MongoDB (replica
set, multi-document transactions), Redis (rate limiting, idempotency, token
revocation).

Every rupee that moves produces a balanced pair of journal entries, and the
system can prove at any moment that total debits equal total credits.

A React simulation console ships alongside it in [`web/`](web/README.md).

| Document | What it covers |
|---|---|
| **[`docs/about.md`](docs/about.md)** | **Start here.** The whole project explained end to end in plain language, a guided tour of the simulation, and an interview summary. |
| [`docs/api-reference.md`](docs/api-reference.md) | Every endpoint, with request and response bodies |
| [`docs/security.md`](docs/security.md) | Each vulnerability found and fixed, and why |
| [`web/README.md`](web/README.md) | The console |

`docs/api.md` and `docs/flow-diagrams.md` are earlier design drafts kept for
history — they describe endpoints that were never built. `api-reference.md` is
the one that matches the code.

---

## Quick start

Everything in containers, which is the path that needs no local setup:

```bash
npm run stack:up     # MongoDB + Redis + API + console
npm run seed         # demo users, funded accounts, some traffic
```

Open **http://localhost:8080**.

| Service | Port |
|---|---|
| Console | 8080 |
| API | 3000 |
| MongoDB | 27017 |
| Redis | 6379 |

All three seeded logins use the password `Sup3rStrong!Pass`:

| Email | Roles |
|---|---|
| `alice@example.com` | USER — three accounts across two currencies, funded |
| `bob@example.com` | USER — one funded account |
| `admin@example.com` | USER, ADMIN — also gets the Admin screen |

### Developing against containerised databases

```bash
npm run infra:up     # MongoDB + Redis only

cp .env.example .env # then set JWT_SECRET and JWT_REFRESH_SECRET
                     #   openssl rand -hex 32

npm install
npm run dev          # API on :3000, rebuilds and restarts on change
npm run web:dev      # console on :5173
```

### Testing

```bash
npm run test:e2e              # 124 API checks against a running server
npm run test:ui  # 12 browser checks against the console
```

> **MongoDB must be a replica set, version 8.2 or newer.** Transfers use
> multi-document transactions, which standalone `mongod` does not support, and
> MongoDB 8.0 refuses to boot on Linux kernels 6.19+ (including the Docker
> Desktop VM). `docker-compose.yml` handles both. Pointing at your own server
> means starting it with `--replSet rs0` and running `rs.initiate()` once.

[`docs/about.md`](docs/about.md#things-that-commonly-go-wrong) lists the errors
people usually hit first and what each one means.

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

web/                          simulation console (React + Vite + shadcn/ui)
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
npm run test:e2e
```

Both suites default to `http://localhost:3000` and the local MongoDB; override
with `BASE_URL` and `MONGO_URI`.

It covers happy paths plus: IDOR on every read surface, money minting through
account creation and PATCH, alg:none token forgery, access-token-as-refresh
replay, refresh-token reuse, NoSQL operator injection, cross-currency
transfers, self-transfers, overdrafts, frozen/closed accounts, idempotent
replay, 10 concurrent identical requests, 5 concurrent overdraft attempts,
oversized bodies and the double-entry invariant.

`web/tests/ui.smoke.mjs` drives a real browser through all six screens, checking
what a type system cannot: that displayed money matches what the API holds, that
an idempotent replay really moves money only once, and that a normal user never
reaches the admin surface.

```bash
npm run test:ui
```

## Front end

`web/` is a Vite + React + Tailwind + shadcn/ui console themed after Linear. It
drives every route of the API: opening accounts, moving money, reading
statements and the journal, and the admin-only reversal and verification
surfaces. The dev server and the nginx container both proxy the API, so the
browser stays on one origin and CORS never enters the picture.

```bash
npm run web:dev      # http://localhost:5173
npm run web:build
```

See [`web/README.md`](web/README.md).

## Production checklist

- [ ] Real `JWT_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -hex 32`)
- [ ] `NODE_ENV=production`, `ALLOW_SELF_DEPOSIT=false`
- [ ] `TRUST_PROXY` set to the real hop count
- [ ] `CORS_ORIGINS` set to the front-end origin
- [ ] MongoDB replica set with authentication and TLS
- [ ] Redis with `requirepass` and TLS
- [ ] TLS termination in front of the API
- [ ] Ship logs somewhere (request ids are already on every line)
