# Ledger API

A double-entry banking ledger API in TypeScript: Express 5, MongoDB (replica
set, multi-document transactions), Redis (rate limiting, idempotency, token
revocation).

Every rupee that moves produces a balanced pair of journal entries, and the
system can prove at any moment that total debits equal total credits.

A React simulation console ships alongside it in [`web/`](web/README.md).

| Document                                         | What it covers                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **[`docs/about.md`](docs/about.md)**             | **Start here.** The whole project explained end to end in plain language, a guided tour of the simulation, and an interview summary. |
| [`docs/api-reference.md`](docs/api-reference.md) | Every endpoint, with request and response bodies                                                                                     |
| [`docs/security.md`](docs/security.md)           | Each vulnerability found and fixed, and why                                                                                          |
| [`web/README.md`](web/README.md)                 | The console                                                                                                                          |

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

| Service | Port  |
| ------- | ----- |
| Console | 8080  |
| API     | 3000  |
| MongoDB | 27017 |
| Redis   | 6379  |

All three seeded logins use the password `Sup3rStrong!Pass`:

| Email               | Roles                                               |
| ------------------- | --------------------------------------------------- |
| `alice@example.com` | USER — three accounts across two currencies, funded |
| `bob@example.com`   | USER — one funded account                           |
| `admin@example.com` | USER, ADMIN — also gets the Admin screen            |

To run the API and console from source instead, see
[All commands → Run it locally](#run-it-locally).

> **MongoDB must be a replica set, version 8.2 or newer.** Transfers use
> multi-document transactions, which standalone `mongod` does not support, and
> MongoDB 8.0 refuses to boot on Linux kernels 6.19+ (including the Docker
> Desktop VM). `docker-compose.yml` handles both. Pointing at your own server
> means starting it with `--replSet rs0` and running `rs.initiate()` once.

---

## All commands

Every script, in the order you would reach for them.

### Run the stack

| Command                      | What it does                                                          |
| ---------------------------- | --------------------------------------------------------------------- |
| `npm run stack:up`           | Build and start everything: MongoDB, Redis, API, console on **:8080** |
| `npm run stack:ps`           | Health of each container                                              |
| `npm run stack:logs`         | Follow the API and console logs                                       |
| `npm run stack:stop`         | Pause everything, keeping the containers                              |
| `npm run stack:down`         | Stop and remove the containers. **Data is kept**                      |
| `npm run stack:reset`        | Same, but also wipe the databases — start from nothing                |
| `docker compose restart api` | Restart just the API                                                  |

`npm run stack:up` after a `stack:down` brings everything back with the data
intact. Use `stack:reset` when you want a clean slate, then `npm run seed`
again.

These wrap `docker compose --profile web …`. The profile matters: without it,
compose only sees MongoDB and Redis, so a bare `docker compose stop` would
leave the API and console running.

### Run it locally

| Command             | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run infra:up`  | Start MongoDB and Redis only, in containers           |
| `npm install`       | Install API dependencies                              |
| `npm run dev`       | API on **:3000**, rebuilding and restarting on change |
| `npm run build`     | Compile TypeScript to `dist/`                         |
| `npm start`         | Run the compiled build                                |
| `npm run typecheck` | Type-check without emitting                           |
| `npm run web:dev`   | Console on **:5173**, proxying the API                |
| `npm run web:build` | Build the console to `web/dist/`                      |

Needs a `.env` first — `cp .env.example .env`, then set `JWT_SECRET` and
`JWT_REFRESH_SECRET` (`openssl rand -hex 32` for each). Stop the databases with
`npm run stack:down`, which works whichever way you started things.

### Data and admin

| Command                            | What it does                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run seed`                     | Create demo users, funded accounts and some traffic. Safe to re-run — it reuses what already exists |
| `npm run promote:admin -- <email>` | Grant an existing user the `ADMIN` role                                                             |

`npm run seed` already promotes `admin@example.com`, so you only need
`promote:admin` for a user you created yourself. Neither goes through the API —
a role that can reverse transactions should not be reachable over HTTP, so both
write to the database directly. Promotion invalidates that user's sessions, so
they log in again to pick the role up.

### Tests

| Command             | What it does                                                                |
| ------------------- | --------------------------------------------------------------------------- |
| `npm test`          | The API suite (alias for `test:e2e`)                                        |
| `npm run test:unit` | 29 unit checks on the pure logic — no server needed, runs in under a second |
| `npm run test:e2e`  | 170 API checks against a running server                                     |
| `npm run test:ui`   | 13 browser checks against the console                                       |

Both need a running server and `npm run seed` first. They default to
`http://localhost:3000` and the local MongoDB; override with `BASE_URL` and
`MONGO_URI`. The UI suite finds the console on :8080 or :5173 by itself.

### Shortest path from nothing

```bash
npm install
npm run stack:up     # everything in containers
npm run seed         # demo data
open http://localhost:8080
```

Sign in as `alice@example.com` / `Sup3rStrong!Pass`.

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

The API rejects decimals _and_ numeric strings, so a client bug surfaces
immediately instead of becoming a rounding error.

### Double-entry bookkeeping

Every transaction writes two journal entries that sum to zero:

| Operation  | Debit                              | Credit              |
| ---------- | ---------------------------------- | ------------------- |
| Transfer   | sender                             | receiver            |
| Deposit    | bank contra account (`SYSTEM-INR`) | customer            |
| Withdrawal | customer                           | bank contra account |

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
);
```

The balance check lives _inside the update filter_, so two concurrent debits
cannot both read "enough funds" and both succeed. A read-then-write check would
lose that race.

### Idempotency

Send `X-Idempotency-Key` on any mutating request. Three layers back it up:

1. A Redis lock rejects a second in-flight request with the same key (409).
2. A unique sparse MongoDB index on `idempotencyKey` makes a duplicate commit
   impossible even if both requests get past the lock.
3. The stored 2xx response is replayed for 24 hours.

Keys are namespaced per user and bound to the request payload. Reusing a key
with a _different_ body is a 409 — a client bug must not be handed a response
that does not match what it asked for.

### Holds

`availableBalance` is not decoration. A hold reserves funds without moving
them: the available balance drops, the ledger balance does not, and **no
journal entries are written** — nothing has happened in accounting terms yet.

| Operation                         | `availableBalance` | `balance` | Journal        |
| --------------------------------- | ------------------ | --------- | -------------- |
| `POST /transactions/authorize`    | −amount            | unchanged | nothing        |
| `POST /transactions/{id}/capture` | unchanged          | −amount   | debit + credit |
| `POST /transactions/{id}/void`    | +amount            | unchanged | nothing        |

This is also what `PENDING` means: a hold is a transaction that has not
happened yet. The reservation itself is race-safe for the same reason a debit
is — the balance condition lives inside the update filter.

### Email verification, with mail mocked

Registration issues a single-use link. Nothing is delivered — there is no SMTP
in this project — but everything upstream of the transport is real: a 32-byte
random token stored only as a SHA-256 hash, a 24-hour TTL index that deletes
the row, an atomic single-use claim, and one identical error for expired,
spent and never-issued tokens so they cannot be probed.

While mail is mocked the link comes back in the API response, and the console
shows it in a toast. Opening it lands on a page laid out like the message you
would have received, with a Verify button — pressing the button verifies, not
opening the link, so a mail scanner that pre-fetches URLs cannot confirm an
address on the recipient's behalf.

Swapping in real delivery means writing one more class against the `Mailer`
interface. No caller changes.

---

## Configuration

See `.env.example` for the full list. The ones that matter:

| Variable                     | Default                                           | Notes                                                              |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `MONGO_URI`                  | `mongodb://localhost:27017/ledger?replicaSet=rs0` | must be a replica set                                              |
| `REDIS_URL`                  | `redis://localhost:6379`                          |                                                                    |
| `JWT_SECRET`                 | —                                                 | **required in production**, ≥ 32 chars                             |
| `JWT_REFRESH_SECRET`         | derived                                           | separate key for refresh tokens                                    |
| `TRUST_PROXY`                | unset                                             | proxy hop count when behind a load balancer                        |
| `CORS_ORIGINS`               | none (same-origin)                                | comma-separated allow-list                                         |
| `ALLOW_SELF_DEPOSIT`         | `true` outside production                         | lets a user fund their own account                                 |
| `SUPPORTED_CURRENCIES`       | `INR,USD,EUR,GBP`                                 |                                                                    |
| `MOCK_EMAIL`                 | `true` outside production                         | returns verification links in the response instead of sending them |
| `APP_URL`                    | `http://localhost:8080`                           | base URL for links in mocked mail                                  |
| `REQUIRE_EMAIL_VERIFICATION` | `false`                                           | gate money movement on a verified address                          |

In production the app refuses to boot without strong JWT secrets rather than
falling back to a default key. `MOCK_EMAIL` is not merely defaulted off in
production — it is unavailable there, because returning a verification link to
whoever called `/auth/register` would let anyone verify an address they do not
control.

---

## Administration

Admins can read any account, unfreeze accounts, reverse transactions and run
the system-wide ledger verification.

No HTTP route grants the role — a role that can reverse transactions should not
be reachable through the API, so `scripts/promote-admin.ts` writes it straight
to the database. Promotion invalidates existing sessions, so the user logs in
again to pick it up.

---

## Testing

Both suites run against a real server and real databases. Mocks would not catch
the race conditions, and those are the interesting part.

`tests/api.e2e.mjs` drives every route and covers happy paths plus: IDOR on every read surface, money minting through
account creation and PATCH, alg:none token forgery, access-token-as-refresh
replay, refresh-token reuse, NoSQL operator injection, cross-currency
transfers, self-transfers, overdrafts, frozen/closed accounts, idempotent
replay, 10 concurrent identical requests, 5 concurrent overdraft attempts,
oversized bodies and the double-entry invariant.

`web/tests/ui.smoke.mjs` drives a real browser through all six screens, checking
what a type system cannot: that displayed money matches what the API holds, that
an idempotent replay really moves money only once, and that a normal user never
reaches the admin surface.

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

## Observability

Structured JSON logs via pino, one line per request, each carrying the same
request id that appears in every error response — so a user reporting "request
`b0c1…` failed" is one grep away from the cause. Anything resembling a
credential (`authorization`, `password`, `*.token`, `set-cookie`) is redacted
at the logger, not at the call site, so a new log line cannot leak one by
omission. Development renders the same stream human-readably, when
`pino-pretty` is installed.

Privileged actions — reversals, and an operator freezing or unfreezing someone
else's account — also land in an append-only audit collection, readable at
`GET /api/v1/admin/audit-logs`.

---

## Production checklist

- [ ] Real `JWT_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -hex 32`)
- [ ] `NODE_ENV=production`, `ALLOW_SELF_DEPOSIT=false`
- [ ] `TRUST_PROXY` set to the real hop count
- [ ] `CORS_ORIGINS` set to the front-end origin
- [ ] MongoDB replica set with authentication and TLS
- [ ] Redis with `requirepass` and TLS
- [ ] TLS termination in front of the API
- [ ] Ship logs somewhere (request ids are already on every line)
