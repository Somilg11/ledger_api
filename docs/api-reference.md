# Ledger API — Reference

Accurate description of what the code actually implements. (`docs/api.md` is an
older aspirational spec and describes endpoints that do not exist yet.)

- **Base URL:** `/api/v1`
- **Auth:** `Authorization: Bearer <accessToken>`
- **Money:** every amount is an **integer in minor units** (paise/cents).
  `500_00` = ₹500.00. Decimals and numeric strings are rejected.
- **Replay protection:** send `X-Idempotency-Key: <1-128 chars of [A-Za-z0-9._:-]>`
  on any mutating request. Keys are scoped per user.

## Response envelope

Success:

```json
{ "success": true, "data": {} }
```

Failure — one shape for every error:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient available balance",
    "requestId": "b0c1...",
    "details": []
  }
}
```

| Code                  | Status | Meaning                                                                |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| `VALIDATION_ERROR`    | 400    | Request failed field validation                                        |
| `INSUFFICIENT_FUNDS`  | 400    | Source account cannot cover the amount                                 |
| `INVALID_IDENTIFIER`  | 400    | Malformed id                                                           |
| `PAYLOAD_TOO_LARGE`   | 413    | Body over 100 kB                                                       |
| `UNAUTHORIZED`        | 401    | Missing, invalid, expired or revoked token                             |
| `FORBIDDEN`           | 403    | Authenticated but not permitted                                        |
| `NOT_FOUND`           | 404    | Missing **or not yours** (deliberately indistinguishable)              |
| `CONFLICT`            | 409    | Duplicate email, frozen/closed account, in-flight idempotent request   |
| `RATE_LIMIT_EXCEEDED` | 429    | Too many requests; see `Retry-After`                                   |
| `INTERNAL_ERROR`      | 500    | Unexpected failure (stack traces never leave the server in production) |

---

## Health

| Method | Path      | Auth | Description                                                           |
| ------ | --------- | ---- | --------------------------------------------------------------------- |
| GET    | `/health` | —    | Liveness. Always 200 while the process runs.                          |
| GET    | `/ready`  | —    | Readiness. 200 only when MongoDB **and** Redis answer; 503 otherwise. |

---

## Auth — `/api/v1/auth`

| Method | Path                   | Auth   | Description                                |
| ------ | ---------------------- | ------ | ------------------------------------------ |
| POST   | `/register`            | —      | Create a user                              |
| POST   | `/login`               | —      | Exchange credentials for tokens            |
| POST   | `/refresh`             | —      | Rotate the refresh token                   |
| POST   | `/verify-email`        | —      | Confirm an address with a single-use token |
| POST   | `/resend-verification` | —      | Re-issue the verification link             |
| POST   | `/logout`              | Bearer | Revoke the current session                 |
| GET    | `/me`                  | Bearer | Caller profile                             |
| POST   | `/change-password`     | Bearer | Change password, kill all sessions         |

**POST `/register`**

```json
{ "email": "alice@example.com", "password": "Sup3rStrong!Pass", "name": "Alice", "phone": "+91..." }
```

Password must be ≥ 10 characters with lowercase, uppercase, a digit and a symbol.
→ `201 { "userId", "email", "status", "emailVerified": false, "verification"? }`

`verification` is present **only while mail is mocked** (`MOCK_EMAIL`, which
production ignores). It carries the link a real deployment would have emailed:

```json
{ "link": "http://localhost:8080/verify-email?token=…", "expiresAt": "…", "delivery": "mock" }
```

**POST `/verify-email`** `{ "token": "..." }` → `200 { "verified": true, "email" }`
Single-use and valid for 24 hours. Expired, already used and never issued all
return the same 400, so tokens cannot be probed.

**POST `/resend-verification`** `{ "email": "..." }` → always `200`
Supersedes any earlier unused link. The response is identical whether or not
the address is registered, so it cannot be used to enumerate accounts — an
ineligible address simply comes back with no `verification` object.

**POST `/login`** → `200`

```json
{ "accessToken": "...", "refreshToken": "...", "expiresIn": 900,
  "user": { "id", "email", "name", "roles", "status" } }
```

Wrong password and unknown email return the identical 401, and a missing user
still pays the bcrypt cost, so response timing does not enumerate accounts.
Five failures lock the account for 15 minutes.

**POST `/refresh`** `{ "refreshToken": "..." }` → new `accessToken` + `refreshToken`.
The presented token is consumed. Presenting it a second time is treated as a
leak: every session for that user is revoked.

**POST `/logout`** `{ "refreshToken": "...", "allDevices": false }`
Deny-lists the access token for its remaining lifetime and consumes the refresh
token. `allDevices: true` revokes every session.

**POST `/change-password`** `{ "currentPassword", "newPassword" }` — bumps the
user's token version, so every token issued before the change stops working.

---

## Accounts — `/api/v1/accounts` (all routes require Bearer)

| Method | Path            | Description                                   |
| ------ | --------------- | --------------------------------------------- |
| POST   | `/`             | Open an account                               |
| GET    | `/`             | List the caller's accounts                    |
| GET    | `/:id`          | One account (owner or admin)                  |
| GET    | `/:id/balance`  | Balance **plus a live ledger reconciliation** |
| GET    | `/user/:userId` | Accounts of a user (self or admin)            |
| PATCH  | `/:id`          | Update `metadata` only                        |
| POST   | `/:id/freeze`   | Freeze                                        |
| POST   | `/:id/unfreeze` | Unfreeze (**admin only**)                     |
| DELETE | `/:id`          | Close (requires a zero balance)               |

**POST `/`** `{ "accountType": "SAVINGS|CURRENT|WALLET", "currency": "INR" }`
The account number is generated server-side. **An opening balance in the body
is ignored** — money only enters through a ledgered deposit.

**GET `/:id/balance`** → `200`

```json
{ "accountId", "accountNumber", "currency",
  "balance": 38000, "availableBalance": 38000,
  "ledgerBalance": 38000, "totalDebits": 12000, "totalCredits": 50000,
  "reconciled": true }
```

`reconciled: false` means the cached balance has drifted from the journal — the
single most important alarm in this system.

---

## Transactions — `/api/v1/transactions` (all routes require Bearer)

| Method | Path           | Description                                        |
| ------ | -------------- | -------------------------------------------------- |
| POST   | `/`            | Transfer between two accounts                      |
| POST   | `/deposit`     | Money in (from the bank's contra account)          |
| POST   | `/withdraw`    | Money out                                          |
| GET    | `/:id`         | One transaction (initiator, counterparty or admin) |
| GET    | `/account/:id` | Statement for an owned account                     |
| POST   | `/:id/reverse` | Reverse a completed transaction (**admin only**)   |

**POST `/`**

```json
{ "fromAccount": "<id>", "toAccount": "<id>", "amount": 12000, "reference": "Dinner", "metadata": {} }
```

Rejected when: source is not yours (404), amount is not a positive integer
(400), source and destination match (400), currencies differ (400), funds are
short (400), either account is frozen or closed (409).

**POST `/deposit`** / **POST `/withdraw`**

```json
{ "accountId": "<id>", "amount": 50000, "reference": "Opening funding" }
```

Deposits are self-service only when `ALLOW_SELF_DEPOSIT=true` (the default
outside production); otherwise they require `ADMIN`.

**POST `/:id/reverse`** `{ "reason": "Disputed" }`
Writes a new opposite transaction and marks the original `REVERSED`. Nothing is
ever edited or deleted — that is what keeps the audit trail trustworthy.

---

**Holds.** `POST /authorize` reserves funds: `availableBalance` drops,
`balance` does not, and **no ledger entries are written**. Capture settles it
(journal entries appear then); void releases it. An expired hold can only be
voided. This is what the `PENDING` status means.

## Admin — `/api/v1/admin` (admin only)

| Method | Path                    | Description                                    |
| ------ | ----------------------- | ---------------------------------------------- |
| GET    | `/audit-logs`           | Privileged actions, newest first — append-only |
| GET    | `/audit-logs/:targetId` | The trail for one account or transaction       |

## Ledger — `/api/v1/ledger` (all routes require Bearer)

| Method | Path                             | Description                                    |
| ------ | -------------------------------- | ---------------------------------------------- |
| GET    | `/accounts/:accountId`           | Journal entries for an owned account           |
| GET    | `/accounts/:accountId/reconcile` | Cached balance vs journal                      |
| GET    | `/transactions/:transactionId`   | Both legs of one transaction                   |
| GET    | `/verify`                        | System-wide debits == credits (**admin only**) |

A ledger entry:

```json
{ "transactionId", "accountId", "entryType": "DEBIT|CREDIT",
  "amount": 12000, "currency": "INR", "balanceAfter": 38000, "createdAt" }
```

Entries are append-only; the schema refuses updates and deletes.

---

## Pagination

`?limit=50&skip=0`. `limit` is clamped to `MAX_PAGE_SIZE` (default 100); an
out-of-range value is a 400 rather than a silent clamp.

## Rate limits

| Scope                       | Default   |
| --------------------------- | --------- |
| Per IP, whole API           | 100 / 60s |
| Per IP + email, auth routes | 10 / 300s |
| Per user, money movement    | 100 / 60s |

If Redis is unavailable the limiter falls back to an in-process counter rather
than rejecting traffic — a rate limiter must never become the outage.
