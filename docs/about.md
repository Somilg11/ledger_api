# About this project

A plain-language walkthrough of the whole system: what it is, why it is built
this way, how to run it, how to drive the simulation, and what to say about it
in an interview.

No prior knowledge of banking systems is assumed. If you read this top to
bottom you will understand the project end to end.

---

## Table of contents

1. [What this is, in one paragraph](#1-what-this-is-in-one-paragraph)
2. [The core idea: why a ledger, not a balance column](#2-the-core-idea-why-a-ledger-not-a-balance-column)
3. [Money is integers, never decimals](#3-money-is-integers-never-decimals)
4. [What actually happens during a transfer](#4-what-actually-happens-during-a-transfer)
5. [The moving parts](#5-the-moving-parts)
6. [The data model](#6-the-data-model)
7. [Security, in plain words](#7-security-in-plain-words)
8. [Every endpoint](#8-every-endpoint)
9. [Running it](#9-running-it)
10. [Using the simulation](#10-using-the-simulation)
11. [How it is tested](#11-how-it-is-tested)
12. [What is deliberately missing](#12-what-is-deliberately-missing)
13. [Interview summary](#13-interview-summary)

---

## 1. What this is, in one paragraph

This is the backend a bank would need to move money between accounts, plus a
web console to drive it. It handles sign-up and login, opening accounts,
depositing, withdrawing, transferring between accounts, and reading the full
financial history. The important part is not the feature list — it is that the
system can **prove its own books are correct** at any moment, and that it
behaves sanely when things go wrong: two people spending at the same time, a
request sent twice because the network hiccuped, someone trying to read another
person's balance.

---

## 2. The core idea: why a ledger, not a balance column

### The naive approach

The obvious way to build a bank is a `balance` column:

```
Alice: 1000
Bob:    500
```

Alice sends Bob 100, so you subtract 100 from one row and add 100 to the other.

This works until it doesn't, and then it fails in ways you cannot recover from:

- **You cannot answer "why".** Alice's balance is 900. Why? What happened? There
  is no record. The number is the only truth, and it has no explanation.
- **You cannot detect corruption.** If a bug subtracts 100 from Alice but never
  adds it to Bob, the money is simply gone. Nothing in the system notices.
- **You cannot audit.** A regulator asks what happened on the 4th. You have no
  answer, only today's number.

### What real accounting does

Every financial system in the world — for the last five hundred years — records
money movement as **two entries that cancel out**. This is called double-entry
bookkeeping.

Alice sends Bob ₹100, and the system writes:

| Account | Entry type | Amount |
| ------- | ---------- | ------ |
| Alice   | DEBIT      | 100    |
| Bob     | CREDIT     | 100    |

A **debit** takes money out. A **credit** puts money in. They are always written
together, always equal, always in the same breath.

Now three things become true that were not true before:

1. **Balance is derived, not stored.** Alice's balance is the sum of her credits
   minus the sum of her debits. It is a _conclusion_, not an assumption.
2. **Corruption is detectable.** Add up every debit in the entire database. Add
   up every credit. They must be identical. If they are not, something is broken,
   and you know immediately instead of a year later.
3. **History is complete.** Every rupee that ever moved has a row explaining it.

This system implements that. `GET /api/v1/ledger/verify` performs the check in
point 2 across the whole database, and the console shows it as a green or red
badge on the Admin screen.

### What about deposits and withdrawals?

Here is a puzzle. A transfer has two sides — Alice and Bob. But when you deposit
cash, where does the money come _from_? If you only credit Alice, credits now
exceed debits and the books no longer balance.

Real banks solve this by treating the bank itself as an account. Money does not
appear from nowhere; it moves from the bank's own books into yours.

So this system keeps a hidden **system account** per currency (`SYSTEM-INR`,
`SYSTEM-USD`, and so on):

| Operation  | Debit          | Credit         |
| ---------- | -------------- | -------------- |
| Transfer   | sender         | receiver       |
| Deposit    | system account | customer       |
| Withdrawal | customer       | system account |

The system account is allowed to go negative — that is the bank's liability, the
money it owes to depositors. Customer accounts are not. The invariant holds in
every case: for every rupee credited somewhere, a rupee was debited somewhere
else.

### The cached balance

Recomputing a balance by summing thousands of ledger rows on every request would
be slow, so each account also stores a `balance` number that is updated as
money moves. That is a cache, and caches drift.

So the system never asks you to trust it. `GET /accounts/:id/balance` returns
**both**: the stored number and the number computed live from the journal, plus
a `reconciled: true/false` flag comparing them. Every balance shown in the
console carries this check. If they ever disagree, that is the loudest possible
alarm, and it is visible rather than silent.

---

## 3. Money is integers, never decimals

Computers cannot represent `0.1` exactly in binary, the same way you cannot
write `1/3` exactly in decimal. So:

```js
0.1 + 0.2 === 0.3; // false
0.1 + 0.2; // 0.30000000000000004
```

That tiny error is harmless in a graphics engine. In a ledger it is fatal:
apply it a million times and the books stop balancing, and you cannot tell
whether the mismatch is rounding noise or theft.

Every financial system therefore stores money as **whole numbers of the
smallest unit**: paise for rupees, cents for dollars.

- ₹500.00 is stored as `50000`
- ₹0.01 is stored as `1`

The API only accepts integers. It rejects `10.5`. It also rejects the _string_
`"1000"` — not because it could not parse it, but because a client sending a
string is usually a client that also has a rounding bug, and failing loudly at
the boundary is cheaper than discovering it in the books later.

The console handles the conversion in exactly one file (`web/src/lib/money.ts`).
You type `500.00`, it sends `50000`, and it shows you what it is sending. No
component anywhere does arithmetic on money.

---

## 4. What actually happens during a transfer

You click Send on ₹120 from Alice to Bob. Here is every step, in order.

**1. The request arrives at nginx** (in Docker) or the Vite dev server
(locally), which forwards `/api/*` to the API. The browser only ever talks to
one origin, so cross-origin rules never come into play.

**2. Rate limiting.** Has this IP made more than 100 requests this minute? If
Redis is down, the request is _allowed_ rather than blocked — a rate limiter
that fails closed turns a cache outage into a total outage.

**3. Authentication.** The `Authorization: Bearer <token>` header is verified:
signature valid, not expired, not on the revocation list, the user still exists
and is still ACTIVE. Roles are re-read from the database rather than trusted
from the token, so a role removed a minute ago takes effect immediately instead
of at token expiry.

**4. Validation.** `fromAccount` and `toAccount` must be real Mongo ids;
`amount` must be a positive integer within limits. This is also where
`{"$ne": null}` — an attempt to inject a database operator where an id belongs —
is rejected.

**5. Idempotency check.** If the request carries an `X-Idempotency-Key`, the
system looks for a transaction already recorded under it. If one exists, it is
returned as-is and nothing else happens. (Section 7 covers why.)

**6. Authorisation.** Does Alice own the source account? If not, the response is
**404, not 403**. A 403 would confirm that the account exists, letting someone
map out valid ids by probing. Both "does not exist" and "not yours" must be
indistinguishable.

**7. Business rules.** Is either account frozen or closed? Are both the same
currency? (Moving 100 paise into a dollar account at par would invent value out
of nothing.) Is the source different from the destination?

**8. The database transaction.** Now money actually moves, and all of the
following either happen together or not at all:

```
a. Debit Alice   — conditional: only if availableBalance >= 120_00
b. Credit Bob
c. Write the transaction record
d. Write the DEBIT ledger entry (with Alice's balance after)
e. Write the CREDIT ledger entry (with Bob's balance after)
```

Step (a) is the subtle one. The naive version is:

```js
const account = await Account.findById(from);        // read
if (account.balance < amount) throw ...;             // check
await Account.updateOne(..., { $inc: { balance: -amount } });  // write
```

Two requests can both run the read, both see enough money, and both write. The
account goes negative. This is a _race condition_, and it is how real money gets
double-spent.

The fix is to put the condition inside the write itself, so the database
evaluates it atomically:

```js
Account.findOneAndUpdate(
  { _id: from, availableBalance: { $gte: amount } }, // condition is part of the query
  { $inc: { balance: -amount, availableBalance: -amount } }
);
```

If the condition fails, the update matches nothing and returns `null` — no read,
no gap, no race. Whichever request arrives second simply loses.

Wrapping all five steps in a MongoDB transaction is why the database **must** be
a replica set: standalone MongoDB does not support multi-document transactions.
This is the single most common reason the project fails to start for someone new.

**9. Response.** The transaction record comes back. The console shows it
alongside both ledger entries and the note "Debits equal credits."

If anything in step 8 fails — insufficient funds, a crash, the process being
killed — the whole transaction rolls back. There is no state where Alice was
debited but Bob was not credited.

---

## 5. The moving parts

```
ledger_api/
├── src/                      the API (TypeScript, Express 5)
│   ├── api/                  HTTP layer
│   │   ├── routes/           URL definitions + validation rules
│   │   ├── controllers/      unpack the request, call a service, send the response
│   │   ├── middlewares/      auth, idempotency, rate limit, errors, request ids
│   │   └── validators/       shared field rules
│   ├── application/services/ the actual logic — this is where the thinking lives
│   ├── domain/entities/      plain type definitions, no framework
│   ├── infrastructure/
│   │   ├── database/mongodb/ schemas, repositories, connection
│   │   ├── cache/            Redis client, cache service, token store
│   │   └── email/            the Mailer interface and its mock transport
│   ├── docs/                 the OpenAPI document, served at /docs
│   └── shared/               config, logger, error types, utilities, wiring
├── web/                      the console (React 19, Vite, Tailwind, shadcn/ui)
├── tests/
│   ├── unit/                 29 checks on the pure logic, no infrastructure
│   ├── api.e2e.mjs           170 end-to-end API checks
│   └── load/                 k6 load profile for the money path
├── scripts/                  seeding, admin promotion, OpenAPI emit
├── docker-compose.yml        MongoDB + Redis + API + console
└── docs/                     this file, the API reference, security notes, openapi.json
```

### Why the layers

Dependencies point one way only: **controllers → services → repositories →
database**. Nothing points back.

The payoff is that authorisation and business rules live in the service layer,
in one place, rather than being duplicated across every route. When
`AccountService.getAuthorizedAccount()` is the only way to load an account, no
future route can forget the ownership check — the mistake is not available.

The layer names come from Clean Architecture. The reason for them is that one
sentence about the ownership check.

### What each piece does

| Piece             | Role                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **MongoDB**       | Stores users, accounts, transactions and ledger entries. Must be a replica set for transactions. |
| **Redis**         | Rate limit counters, idempotency records, live refresh tokens, revoked access tokens.            |
| **Express API**   | All logic. Stateless — every piece of state is in Mongo or Redis, so you can run many copies.    |
| **nginx**         | Serves the built console and proxies `/api` to the API, keeping the browser on one origin.       |
| **React console** | The simulation UI. Holds no logic of its own; it is a window onto the API.                       |

---

## 6. The data model

Four collections.

### users

Who can log in.

| Field                                 | Why it exists                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `email`                               | Stored lowercase with a unique index, so `Alice@x.com` and `alice@x.com` cannot become two people    |
| `passwordHash`                        | bcrypt, cost 12. Marked `select: false`, so a query has to _ask_ for it — it cannot leak by accident |
| `roles`                               | `USER` or `ADMIN`                                                                                    |
| `status`                              | `ACTIVE`, `SUSPENDED`, `CLOSED`. Checked at login _and_ on every request                             |
| `tokenVersion`                        | Incremented on password change. Every token issued before then stops working instantly               |
| `failedLoginAttempts` / `lockedUntil` | Five wrong passwords locks the account for 15 minutes                                                |

### accounts

Where money sits.

| Field              | Why it exists                                                            |
| ------------------ | ------------------------------------------------------------------------ |
| `accountNumber`    | 16 digits from a cryptographic RNG, generated server-side, unique        |
| `accountType`      | `SAVINGS`, `CURRENT`, `WALLET`                                           |
| `currency`         | Immutable after creation                                                 |
| `balance`          | Minor units. The cached number — always cross-checked against the ledger |
| `availableBalance` | Balance minus holds. Debits check against this                           |
| `status`           | `ACTIVE`, `FROZEN`, `CLOSED`                                             |
| `isSystem`         | Marks the bank's contra accounts, which may go negative                  |

Accounts always open at **zero**. A balance in the request body is ignored. The
only way money enters is a ledgered deposit.

### transactions

What someone did — the intent and the outcome.

| Field                       | Why it exists                                                               |
| --------------------------- | --------------------------------------------------------------------------- |
| `fromAccount` / `toAccount` | References to accounts                                                      |
| `amount`, `currency`        | Minor units                                                                 |
| `type`                      | `TRANSFER`, `DEPOSIT`, `WITHDRAWAL`                                         |
| `status`                    | `PENDING`, `COMPLETED`, `FAILED`, `REVERSED`                                |
| `initiatedBy`               | Which user asked for it                                                     |
| `idempotencyKey`            | **Unique sparse index** — two requests with the same key cannot both commit |

### ledger

What actually moved — the accounting truth.

| Field           | Why it exists                                                      |
| --------------- | ------------------------------------------------------------------ |
| `transactionId` | Which transaction produced this entry                              |
| `accountId`     | Whose book it lands in                                             |
| `entryType`     | `DEBIT` or `CREDIT`                                                |
| `amount`        | Always positive; direction comes from `entryType`                  |
| `balanceAfter`  | The account balance immediately after this entry — the audit trail |

**Ledger entries are immutable.** The schema blocks updates and deletes
outright. History that can be edited is not history. A mistake is fixed by
writing a new, opposite transaction — which is exactly what the reversal feature
does.

### Transactions vs ledger — why both?

A transaction is the _intent_: "Alice wanted to send Bob ₹120." A ledger entry
is the _effect_: "₹120 left Alice", "₹120 arrived at Bob."

One transaction always produces exactly two ledger entries. Keeping them
separate means you can ask "what did the user do?" and "what happened to the
money?" as different questions — which is precisely what an auditor does.

---

## 7. Security, in plain words

This is the part of the project with the most thought behind it. Each item is a
real attack, and the defence against it.

### Attack: mint money by opening an account

The original code let anyone create an account — no login required — and copied
the request body into the database, including `balance`. Sending
`{"balance": 999999999}` created money from nothing.

**Defence:** the route requires a token, the owner comes from that token, and
the opening balance is always zero regardless of what the body says.

### Attack: mint money by updating an account

`PUT /accounts/:id` passed the whole body to the database, so
`{"balance": 999999999}` rewrote the balance directly. This is _mass
assignment_: the client controls which fields get written.

**Defence:** the update path writes an allow-list of exactly two fields
(`metadata`, `status`). Balances are not writable by any route — they move only
inside a ledger transaction.

### Attack: steal someone's session through the cache

The idempotency layer originally ran on _every_ endpoint including `/auth/login`,
and its cache key was nothing but the client-supplied header. If you sent the
same key someone else had used, you were handed their cached response — access
token, refresh token and all.

**Defence:** the cache key is now `sha256(userId, method, path, key, body)`. It
is bound to the caller and to the exact request. Only successful responses are
cached — a cached 500 would turn a transient failure into a permanent one. And
reusing a key with a _different_ body is a 409, because a client bug must not be
handed a response that does not match what it asked for.

### Attack: a token that never dies

Access and refresh tokens were signed with the same secret and carried no type
marker, so a 15-minute access token could be presented as a 7-day refresh token
and renewed forever. There was no logout and no revocation of any kind.

**Defence:** separate signing keys, an explicit `typ` claim, a unique `jti` per
token, refresh tokens registered in Redis and **rotated on every use**, an
access-token deny-list for logout, and a `tokenVersion` that a password change
increments to kill every live session.

There is one more piece. Because refresh tokens are one-time, presenting a
consumed one means it leaked — either you are replaying it, or an attacker
already used the one they stole. The system cannot tell which, so it assumes the
worst and revokes **every** session for that user. That is why the test suite has
to log back in after exercising this path.

### Attack: read anyone's balance (IDOR)

`GET /accounts/:id`, `/transactions/:id` and the entire `/ledger` tree were
unauthenticated. Anyone could enumerate ids and read any balance and any
financial history.

**Defence:** every route requires a token, and ownership is enforced in the
service layer. Reading something you do not own returns **404**, so ids cannot be
probed for existence.

### Attack: double-spend under concurrency

Two things were wrong. The balance check was a read-then-write race (section 4),
and the `idempotencyKey` index was not unique, so two simultaneous requests with
the same key could both commit.

**Defence:** the conditional `$inc`, plus a unique sparse index as the final
backstop. The test suite fires ten identical requests simultaneously and asserts
exactly one debit, and five concurrent overdraft attempts and asserts the balance
never goes negative.

### Attack: brute-force a password

Unlimited login attempts, and no lockout.

**Defence:** credential endpoints get a much tighter budget (10 per 5 minutes)
keyed by IP **and** email — keying by IP alone would let one attacker lock every
user behind a shared office IP. On top of that, five failures lock the individual
account for 15 minutes.

### Attack: work out which emails are registered

A wrong password and an unknown email returned different errors and took
noticeably different amounts of time (no user meant no bcrypt call).

**Defence:** identical error messages, and a dummy bcrypt comparison for unknown
users so the timing matches.

### Attack: inject database operators

Sending `{"email": {"$ne": null}}` instead of a string can turn a lookup into
"match anything".

**Defence:** every id and email is type-checked at the edge, plus Mongoose's
`sanitizeFilter` as a second layer. (This one has a sharp edge worth knowing:
`sanitizeFilter` also rewrites _legitimate_ operators, which silently broke the
conditional balance check until it was wrapped in `mongoose.trusted()`. The test
suite caught it.)

### Other defences

- **Production refuses to boot** without strong JWT secrets, rather than falling
  back to a default key.
- **One error handler** for the whole app: one response shape, a request id on
  every error, and no stack traces in production.
- **100 kB body cap**, `helmet` security headers, `x-powered-by` disabled, CORS
  deny-by-default.
- **Bounded pagination** — `limit=1000000` is a 400, not a database scan.
- **Redaction at the logger** — `authorization`, `password`, `*.token` and
  friends are censored centrally, so a newly added log line cannot leak a
  credential by forgetting to.
- **An audit trail for staff actions** — reversals, and an operator freezing or
  unfreezing someone else's account, are written to an append-only collection
  with the actor, the reason and the request id. The collection refuses updates
  and deletes, for the same reason the ledger does: a record of privileged
  actions that the privileged can edit records nothing.

### Holds: money that is spoken for but has not moved

A card machine does not move money when you tap it. It puts a **hold** on the
funds — they are spoken for, so you cannot spend them twice — and the actual
transfer happens later, when the merchant settles.

That is the entire reason an account carries two numbers:

- `balance` — money that has actually moved, and always equals the journal
- `availableBalance` — balance minus everything currently reserved

| Operation    | `availableBalance` | `balance` | Journal entries |
| ------------ | ------------------ | --------- | --------------- |
| Place a hold | −amount            | unchanged | **none**        |
| Capture it   | unchanged          | −amount   | debit + credit  |
| Void it      | +amount            | unchanged | **none**        |

The row that matters is the first one. A hold writes **nothing** to the
journal, because in accounting terms nothing has happened. This keeps the
system's central invariant intact: total debits still equal total credits while
holds are outstanding, and a held account still reconciles, because
reconciliation compares `balance` to the journal and a hold does not touch
either.

Placing a hold is race-safe the same way a debit is — the balance condition
lives inside the update filter, so two simultaneous holds cannot reserve the
same funds.

This is also what `PENDING` means: a transaction that has been authorised but
not settled. Capture makes it `COMPLETED`; voiding makes it `CANCELLED`. An
expired hold can only be voided, never captured.

### Email verification, with mail mocked

Registration issues a single-use verification link. Nothing is actually
delivered — there is no SMTP anywhere in this project — but everything up to
the moment of delivery is real:

- A 32-byte random token is generated. Only its **SHA-256 hash** is stored, for
  the same reason passwords are hashed: a leaked database dump must not hand an
  attacker working links.
- The token expires in 24 hours, via a MongoDB TTL index that deletes the row.
- Claiming it is a single atomic update, so two simultaneous clicks cannot both
  consume it.
- Expired, already used and never issued all return the **same** error. Telling
  them apart would let someone probe which tokens are real.
- Re-sending supersedes the previous link rather than leaving several live.
- `POST /resend-verification` returns the same 200 whether or not the address
  exists, so it cannot be used to enumerate accounts.

The mock transport is a `Mailer` implementation that logs the message and keeps
it in a small in-memory outbox. Real delivery means writing one more class
against the same interface; no caller changes.

**The one thing to be careful about.** While mail is mocked, the API returns
the verification link in the response body so the console can show it. That is
a genuine hole if it ever shipped — anyone who can call `/auth/register` for an
address would be handed that address's link. So the flag is not merely
_defaulted_ off in production, it is **unavailable** there:

```ts
mockEmail: !isProduction && process.env.MOCK_EMAIL !== 'false',
```

Setting `MOCK_EMAIL=true` in production does nothing. A convenience that would
be a vulnerability in production should not be reachable by configuration.

Verification is tracked but not enforced by default, so the simulation is
usable the moment you register. Setting `REQUIRE_EMAIL_VERIFICATION=true` gates
money movement on it, reading the flag fresh from the database on every request
rather than trusting anything in the token.

---

## 8. Every endpoint

32 routes, plus two health checks and an interactive reference at `/docs`. Full details with request and response bodies
are in [`api-reference.md`](api-reference.md).

### Health

| Method | Path      | Auth | What it does                                         |
| ------ | --------- | ---- | ---------------------------------------------------- |
| GET    | `/health` | —    | Is the process alive                                 |
| GET    | `/ready`  | —    | Are MongoDB _and_ Redis actually usable (503 if not) |

### Auth — `/api/v1/auth`

| Method | Path                   | Auth   | What it does                               |
| ------ | ---------------------- | ------ | ------------------------------------------ |
| POST   | `/register`            | —      | Create a user                              |
| POST   | `/login`               | —      | Get an access + refresh token              |
| POST   | `/refresh`             | —      | Rotate the refresh token                   |
| POST   | `/verify-email`        | —      | Confirm an address with a single-use token |
| POST   | `/resend-verification` | —      | Re-issue the verification link             |
| POST   | `/logout`              | Bearer | Revoke this session (or all of them)       |
| GET    | `/me`                  | Bearer | Who am I                                   |
| POST   | `/change-password`     | Bearer | Change password, kill every session        |

### Accounts — `/api/v1/accounts`

| Method | Path            | What it does                                  |
| ------ | --------------- | --------------------------------------------- |
| POST   | `/`             | Open an account (always at zero)              |
| GET    | `/`             | List my accounts                              |
| GET    | `/:id`          | One account                                   |
| GET    | `/:id/balance`  | Balance **plus a live ledger reconciliation** |
| GET    | `/user/:userId` | A user's accounts (self, or admin)            |
| PATCH  | `/:id`          | Update `metadata` only                        |
| POST   | `/:id/freeze`   | Freeze                                        |
| POST   | `/:id/unfreeze` | Unfreeze — **admin only**                     |
| DELETE | `/:id`          | Close (requires a zero balance)               |

### Transactions — `/api/v1/transactions`

| Method | Path           | What it does                                     |
| ------ | -------------- | ------------------------------------------------ |
| POST   | `/`            | Transfer between two accounts                    |
| POST   | `/deposit`     | Money in, from the bank's contra account         |
| POST   | `/withdraw`    | Money out                                        |
| POST   | `/authorize`   | Place a hold — reserve funds without moving them |
| POST   | `/:id/capture` | Settle a hold                                    |
| POST   | `/:id/void`    | Release a hold                                   |
| GET    | `/:id`         | One transaction                                  |
| GET    | `/account/:id` | Statement for an account                         |
| POST   | `/:id/reverse` | Reverse a completed transaction — **admin only** |

### Ledger — `/api/v1/ledger`

| Method | Path                             | What it does                                   |
| ------ | -------------------------------- | ---------------------------------------------- |
| GET    | `/accounts/:accountId`           | Journal entries for an account                 |
| GET    | `/accounts/:accountId/reconcile` | Cached balance vs the journal                  |
| GET    | `/transactions/:transactionId`   | Both legs of one transaction                   |
| GET    | `/verify`                        | System-wide debits == credits — **admin only** |

### Admin — `/api/v1/admin` (admin only)

| Method | Path                    | What it does                                   |
| ------ | ----------------------- | ---------------------------------------------- |
| GET    | `/audit-logs`           | Privileged actions, newest first. Append-only. |
| GET    | `/audit-logs/:targetId` | The trail for one account or transaction       |

---

## 9. Running it

### Everything in Docker (recommended)

```bash
npm run stack:up     # MongoDB + Redis + API + console
npm run seed         # demo users, funded accounts, some traffic
```

Then open **http://localhost:8080**.

| Service | Port  |
| ------- | ----- |
| Console | 8080  |
| API     | 3000  |
| MongoDB | 27017 |
| Redis   | 6379  |

Useful commands:

```bash
docker compose ps                  # health of each container
docker compose logs -f api web     # follow logs
docker compose down                # stop
docker compose down -v             # stop and wipe all data
```

### Locally, with Docker only for the databases

```bash
npm run infra:up     # MongoDB + Redis only
cp .env.example .env # then set JWT_SECRET and JWT_REFRESH_SECRET
npm install
npm run dev          # API on :3000
npm run web:dev      # console on :5173
```

Generate secrets with `openssl rand -hex 32`.

### Things that commonly go wrong

**"MongoDB cannot start: Linux kernel versions 6.19 and newer…"**
MongoDB 8.0 refuses to boot on current Docker Desktop. The compose file pins
8.2, which is fine. If you changed it, change it back.

**Transfers fail with a transaction error.**
MongoDB is running standalone rather than as a replica set. Multi-document
transactions require one. The compose file sets this up automatically; a
hand-rolled MongoDB needs `--replSet rs0` and one `rs.initiate()`.

**Port 27017 or 6379 already in use.**
You have MongoDB or Redis running natively. Either stop them
(`brew services stop redis`) or change the host port mappings in a local
`docker-compose.override.yml`.

**"400 Request Header Or Cookie Too Large"**
Cookies are scoped to a hostname, not a port, so `localhost:8080` receives every
cookie any other project on `localhost` has ever set. nginx is configured with
larger header buffers to cope; if you still hit it, clear cookies for
`http://localhost` in DevTools → Application → Storage.

**429 Too Many Requests while clicking around.**
The rate limiter is real. The compose environment relaxes it for simulation;
production keeps 100/minute.

### Demo logins

All three use the password `Sup3rStrong!Pass`:

| Email               | Roles       | What they have                                                |
| ------------------- | ----------- | ------------------------------------------------------------- |
| `alice@example.com` | USER        | Three accounts (INR savings, INR wallet, USD current), funded |
| `bob@example.com`   | USER        | One INR savings account, funded                               |
| `admin@example.com` | USER, ADMIN | An account, plus the Admin screen                             |

`ADMIN` deliberately has no HTTP route that grants it — the seed script writes
it straight to the database. A role that can reverse transactions should not be
reachable through the API.

---

## 10. Using the simulation

The console is a window onto the API. Every screen maps to endpoints, and the
interesting behaviour is the system's, not the UI's.

### The screens

| Screen           | What you see                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| **Dashboard**    | Totals per currency, your accounts, a merged activity feed, reconciliation status                 |
| **Accounts**     | Open, rename, freeze, close; each row shows cached balance, ledger balance and whether they agree |
| **Move money**   | Transfer, deposit and withdraw, with a live idempotency-key control                               |
| **Transactions** | Statement per account; click a row for both ledger legs                                           |
| **Ledger**       | The raw journal — every debit and credit with the balance after each                              |
| **Admin**        | System-wide verification, transaction reversal, account unfreeze (admin only)                     |
| **Verify email** | A mock of the verification message, reachable signed out at `/verify-email`                       |

### Walkthrough: watch double-entry happen

1. Sign in as **alice**.
2. **Move money → Deposit**, ₹100, reference "Test".
3. The right-hand panel shows the transaction and **two ledger entries** — a
   CREDIT to Alice, a DEBIT to the system account — and the line "Debits equal
   credits."
4. Go to **Ledger**. The new CREDIT is at the top, with `balanceAfter`.
5. Note the header: cached balance and ledger balance, side by side, agreeing.

### Walkthrough: idempotency, the thing worth understanding

This is the most valuable five minutes in the app.

1. **Move money → Transfer**. Pick a destination, enter `50`, note the
   idempotency key shown in the form.
2. Send it. Balance drops by ₹50.
3. **Without changing anything, press Send again.**
4. The balance does **not** move. The panel says _"Replayed — the idempotency
   key matched an earlier request."_ The same transaction comes back.

That is the guarantee that makes a payments API safe to retry. A client whose
connection drops mid-request has no idea whether the money moved. Without this
it must choose between losing the payment and risking a double charge. With it,
retrying is always safe.

Now the other half:

5. Change the amount to `75`, keep the same key, send.
6. **409 Conflict.** The form offers to rotate the key.

The key is bound to the _payload_, not just to the caller. Returning the ₹50
response to a ₹75 request would be worse than failing.

### Walkthrough: you cannot overdraw

1. Check your available balance.
2. Try to transfer more than that.
3. `400 INSUFFICIENT_FUNDS`.

Nothing was written. The condition lives inside the database update, so this
holds even if ten requests arrive simultaneously — which the test suite proves.

### Walkthrough: frozen and closed accounts

1. **Accounts → ⋯ → Freeze** on one account.
2. Try to deposit into it: **409**, the account is frozen.
3. Try to unfreeze it yourself: **403**. A user can freeze their own account but
   only the bank can unfreeze it — otherwise freezing for suspected fraud would
   be meaningless.
4. Sign in as **admin**, go to **Admin → Unfreeze an account**, paste the id.
5. Try to close an account that still holds money: **409**. Empty it first.

### Walkthrough: reversal, and why nothing is deleted

1. As **alice**, make a transfer. Copy its id (click the id chip to copy).
2. Sign in as **admin** → **Admin → Reverse a transaction**, paste, look it up.
3. Reverse it with a reason.
4. The money moves back — and go look at **Transactions**. The original is still
   there, now marked `REVERSED`, and there is a **new** transaction next to it.

Nothing was edited. Nothing was deleted. The correction is itself a recorded
event, which is the only way history stays trustworthy.

5. Try reversing the same transaction again: **409**.

### Walkthrough: a hold, then capture or void

1. **Move money → Hold**. Pick two of your accounts, enter an amount, place it.
2. Look at **Accounts**. The available balance dropped; the balance did not.
3. Open **Ledger** for that account: **nothing new**. No money has moved.
4. Check **Admin → Double-entry verification**: still balanced. An outstanding
   hold cannot unbalance books it never touched.
5. Go to **Transactions** and open the `PENDING` row. Capture it, and both
   ledger entries appear at once. Or void it, and the reservation comes back
   with the journal still untouched.

### Walkthrough: email verification without any email

Mail is mocked, so the link that would have been sent is shown to you instead.

1. Sign out, then **Create account** with any address and a strong password.
2. A toast appears with the verification link and a **Copy** button. Copy it.
3. You land on the dashboard with a banner: _your email address is not
   verified_. Everything still works — verification is tracked, not enforced.
4. Paste the link into a new tab. You get a page laid out like the email you
   would have received: sender, subject, explanation, and one **Verify email
   address** button.
5. Press it. The address is confirmed and the banner disappears.
6. Open the same link again and press Verify: _this verification link is
   invalid or has expired_. Tokens are single-use.
7. Press **Resend link** on the banner of an unverified account and you get a
   new link — and the previous one stops working.

Two details worth noticing. Opening the link does **not** verify anything; only
pressing the button does. A corporate mail scanner that pre-fetches every URL
in a message would otherwise confirm addresses on the recipient's behalf. And
the seeded demo users are already verified, which is why you have to register
your own account to see this flow.

### Walkthrough: you cannot see other people's money

1. As **alice**, open any account and copy its id.
2. Sign out, sign in as **bob**.
3. Visit `/accounts/<alice's id>` directly.
4. **404** — not 403. Bob cannot even confirm the account exists.

Also notice: Bob has no **Admin** link. It is hidden in the UI, the route
redirects, _and_ the API returns 403 independently. The UI hiding it is a
convenience; the API refusing it is the actual security.

### Walkthrough: prove the books balance

1. Sign in as **admin** → **Admin**.
2. **Double-entry verification** shows total debits and total credits across the
   entire database, and whether they match.
3. Move some money, press **Re-run**. Still balanced — by construction.

---

## 11. How it is tested

Two suites, both running against a real server with real databases. No mocks:
mocks would not catch the race conditions, and those are the interesting part.

### Unit suite — 29 checks

```bash
npm run test:unit
```

Pure logic only — money parsing, pagination clamps, the password policy,
account-number generation, and the ledger's balance invariant against a fake
repository. No database, no server; the whole suite runs in under a second.

### API suite — 170 checks

```bash
npm run test:e2e
```

Covers every endpoint's happy path, plus:

- Money minting through account creation and through PATCH
- IDOR on every read surface
- `alg:none` token forgery
- Access token replayed as a refresh token
- Refresh-token reuse detection
- NoSQL operator injection
- Cross-currency transfers, self-transfers, overdrafts
- Frozen and closed accounts
- Idempotent replay, and the same key with a different payload
- Verification tokens: unknown, replayed, superseded, and operator injection
- Resend not leaking whether an address is registered
- **Ten simultaneous identical requests** — asserts exactly one debit
- **Five simultaneous overdraft attempts** — asserts the balance never goes negative
- Oversized bodies, malformed JSON
- The double-entry invariant across the database
- Holds: reservations that do not touch the journal, double capture, capture of
  a voided hold, and no reservation leaking once everything is settled
- The audit trail recording who reversed what, with the reason and request id

### UI suite — 13 checks

```bash
npm run test:ui
```

Drives a real browser through every screen and asserts things a type checker
cannot: that the money displayed matches what the API holds, that the idempotent
replay really moves money once (by reading the balance before and after), and
that a normal user never sees the admin surface.

It finds the console on :8080 (Docker) or :5173 (`npm run web:dev`) on its own,
and uses the Chrome already installed on the machine — no browser download.
Both suites need a running server and seeded data (`npm run seed`).

---

## 12. What is deliberately missing

Honest scope. These are not oversights; they are next steps.

- **Password reset.** The token model already supports a `PASSWORD_RESET`
  purpose and the mock mailer is in place, so this is mostly wiring — but it is
  not built.
- **Real mail delivery.** Everything up to the transport is implemented; the
  transport itself is a mock that logs instead of sending.
- **Multi-factor authentication.**
- **Holds and authorisations.** `availableBalance` currently tracks `balance`
  exactly. A real card network puts a _hold_ on funds at swipe time and settles
  later; the field is there for it but the mechanism is not.
- **Scheduled reconciliation.** Verification is on demand. Production would run
  it continuously and page someone on a mismatch.
- **Expired holds are not swept.** An expired hold cannot be captured, but
  nothing releases it automatically; a background job should.
- **Partial capture.** A hold settles in full or not at all. Card networks
  routinely capture less than they authorised.
- **Continuous integration.** The suites exist and pass, but nothing runs them
  on a push yet.
- **External settlement.** Deposits are simulated against the system account. A
  real bank receives them from a payment network via webhooks.
- **Redis as a hard dependency.** Flushing Redis logs everyone out. Session
  revocation would ideally survive a cache loss.

---

## 13. Interview summary

### The thirty-second version

> A double-entry banking ledger API in TypeScript with a React console. The
> guarantee is that every rupee that moves writes a balanced pair of journal
> entries inside a single database transaction, and the system can prove at any
> moment that total debits equal total credits. I built the API, then audited it
> as an attacker would and fixed what I found — which turned out to be most of
> the interesting work.

### What it demonstrates

**Domain modelling.** Not a CRUD app with a `balance` column. Double-entry
bookkeeping, immutable journal entries, derived balances continuously
cross-checked against a cached number, and a system contra account so deposits
and withdrawals keep the books balanced.

**Concurrency.** The balance check lives inside the database update filter rather
than in application code, so two simultaneous debits cannot both succeed. Proven
by a test that fires ten identical requests at once.

**Correctness under failure.** Multi-document transactions so a transfer either
fully happens or does not happen at all. Idempotency in three independent layers
so a retried request cannot double-charge.

**Security as a discipline, not a checklist.** I found eight critical issues in
my own code, including two paths that let anyone mint unlimited money and one
that leaked other users' session tokens. Each is documented with the attack, the
fix and the reasoning in [`security.md`](security.md).

**Testing what matters.** 29 unit checks on the pure logic, 170 API checks and
13 browser checks, the latter two against real databases and a real browser. The
suites test races, forged tokens and injection attempts — not just the happy
path.

### The best story to tell

The idempotency bug is the strongest one, because the mechanism is
non-obvious and the consequence is severe.

> The idempotency middleware was mounted globally, including on `/auth/login`,
> and its cache key was nothing but a client-supplied header. So if two users
> happened to send the same key — or one deliberately guessed another's — the
> second request was served the first one's cached response. On a login endpoint
> that means handing out someone else's access and refresh tokens.
>
> The fix was to scope the key to the caller and the payload:
> `sha256(userId, method, path, key, body)`, mounted per route after
> authentication rather than globally. Two details fell out of that. Only
> successful responses are cached, because a cached 500 turns a transient
> failure into a permanent one. And reusing a key with a different body is now a
> 409 — returning a ₹50 response to a ₹75 request would be worse than failing.

Others worth having ready:

- **The `sanitizeFilter` trap, which bit twice.** Enabling Mongoose's injection
  protection silently broke the conditional balance check, because it rewrites
  _legitimate_ operators too — `{ $gte: amount }` became an equality match.
  Months later the identical bug appeared in the verification-token expiry check
  (`{ $gt: new Date() }`). Security hardening broke a correctness guarantee,
  twice, and both times only a behavioural test caught it — the types were happy.
  The fix is `mongoose.trusted()` to mark the query as first-party.

- **404 instead of 403.** Returning "forbidden" when someone reads an account
  they do not own confirms the account exists, which lets an attacker enumerate
  valid ids. Both cases return 404.

- **Refresh-token reuse means a leak.** Because refresh tokens are one-time,
  presenting a consumed one means someone replayed it. The system cannot tell who
  is the attacker, so it revokes every session for that user and forces a fresh
  login.

- **The rate limiter that was the outage.** The original code treated a Redis
  connection error the same as "limit exceeded", so a cache blip would have
  returned 429 to every request on the platform. Rate limiters must fail open.

### Questions you should expect

**"Why MongoDB for financial data? Isn't Postgres the obvious choice?"**
Postgres would be the better default — stronger constraints, real foreign keys,
`NUMERIC` for exact decimal arithmetic. MongoDB was the existing choice here, so
the work was making it safe: a replica set for multi-document transactions,
conditional updates for atomicity, unique indexes as the last line of defence,
and integer minor units instead of trusting a decimal type. The data model
itself would port to Postgres almost unchanged.

**"How do you know the ledger is actually correct?"**
Two checks, both exposed as endpoints. Per account: cached balance versus the
sum of its journal entries, returned on every balance request as a `reconciled`
flag. System-wide: total debits versus total credits across the whole database.
Both are asserted in the test suite after every scenario.

**"What happens if the process dies mid-transfer?"**
Nothing partial. The debit, credit, transaction record and both ledger entries
are inside one MongoDB transaction, so they commit together or roll back
together. The client may not know the outcome — which is what the idempotency
key is for: retrying is safe, and returns the original result.

**"How would you scale this?"**
The API is stateless, so horizontal scaling is straightforward — all state is in
Mongo or Redis. The bottleneck is per-account write contention: many concurrent
debits on one hot account serialise. The standard answers are sharding by
account and batching, or moving hot accounts to an event-sourced model where
writes append and balances are projected. Reads scale with replica-set
secondaries, accepting eventual consistency for statements but never for the
balance check that gates a debit.

**"Why integers instead of a decimal type?"**
Floats cannot represent `0.1` exactly, and the error compounds until the books
stop balancing. A decimal type would also work, but integer minor units are
unambiguous across every language, database and JSON serialiser in the stack.
The cost is that formatting happens at the edges — one module in the API, one in
the console.

**"What would you do next?"**
Holds and authorisations, since `availableBalance` exists for exactly that and
card flows need it. Then scheduled reconciliation with alerting, because
verification on demand only catches what someone thinks to look for. Then an
audit log of administrative actions — reversals and unfreezes currently leave
less of a trail than the money movements do, which is backwards.

### What to be upfront about

Interviewers value knowing what you did _not_ do. Section 12 is the list. The
strongest framing is that the gaps are deliberate and you can name what each one
would take — which is a different thing from not having noticed them.
