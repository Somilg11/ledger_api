# Security model

What was wrong before this pass, what it was replaced with, and why.

## Fixed vulnerabilities

### Critical

**Money minting through account creation.** `POST /accounts` was unauthenticated
and copied the request body into the account document, including `balance`.
Anyone could open an account for any `userId` with any opening balance.
→ The route requires a token, the owner is taken from that token, and the
opening balance is always zero. Money enters only through a ledgered deposit.

**Money minting through account update.** `PUT /accounts/:id` was
unauthenticated and passed the raw body to `findByIdAndUpdate`, so
`{"balance": 999999999}` worked.
→ Replaced by `PATCH /accounts/:id`, which writes an allow-list of exactly two
fields (`metadata`, `status`). Balances are not writable through any route;
they move only inside a ledger transaction.

**Token theft through idempotency caching.** The idempotency middleware ran
globally — including on `/auth/login` — and keyed the cache on nothing but the
client-supplied header. Two clients using the same key meant the second one
received the first one's cached response, access and refresh tokens included.
→ The middleware is mounted per route (after authentication), the cache key is
`sha256(userId, method, path, key, body)`, and only 2xx responses are stored.
Reusing a key with a different payload is a 409.

**Refresh tokens that never died.** Refresh and access tokens were signed with
the same secret and carried no type claim, so an access token worked as a
refresh token and could be renewed indefinitely. There was no logout and no
revocation of any kind.
→ Separate signing keys, an explicit `typ` claim, a `jti` per token, one-time
refresh tokens registered in Redis and rotated on every use, an access-token
deny-list for logout, and a per-user `tokenVersion` that a password change
increments to kill every live session. Re-presenting a consumed refresh token is
treated as a leak and revokes all of that user's sessions.

**IDOR across every read surface.** `GET /accounts/:id`, `/accounts/user/:userId`,
`/transactions/:id`, `/transactions/account/:id` and the entire `/ledger` tree
were unauthenticated. Any balance and any financial history was public.
→ Every route requires a token, and ownership is enforced in the service layer.
Reading something that is not yours returns **404, not 403** — a 403 would
confirm that the id exists.

**Frozen and closed accounts still moved money.** Account status was never
consulted during a transfer.
→ Both sides are checked before any write; a frozen or closed account is a 409.

**Cross-currency value creation.** The transfer used the currency from the
_request body_ and never compared the two accounts, so 100 paise could be
credited as 100 cents.
→ The currency comes from the source account and both accounts must match.

**Self-transfers.** `from === to` incremented and decremented the same balance
while writing a debit and a credit, inflating the ledger.
→ Rejected with 400.

**Double spend on concurrent idempotent requests.** The `idempotencyKey` index
was not unique, so two simultaneous requests with the same key could both
commit.
→ Unique sparse index. A duplicate key crash is caught and resolved to the
original transaction. Verified by a test that fires ten identical requests at
once and asserts exactly one debit.

### High

**Float money.** `amount` was validated with `isNumeric()`, which accepts
`10.5`, `"1000"` and `1e21`.
→ Amounts are integers in minor units, type-checked as JSON numbers, bounded by
`MAX_TRANSFER_MINOR_UNITS`.

**Stack traces to clients.** There was no error handler, so unhandled failures
fell through to Express's default HTML handler.
→ One error middleware, one response shape, a request id on every error, and
stack traces only outside production.

**Rate limiter as a single point of failure.** A Redis outage made
`limiter.consume()` reject, which the code treated as "limit exceeded" — every
request would have returned 429.
→ Redis errors are distinguished from limit rejections and fail open, with an
in-process insurance limiter. Credential endpoints have their own much tighter
budget keyed by IP _and_ email, so one attacker cannot lock out everyone behind
a shared IP.

**No brute-force protection.** Unlimited login attempts.
→ Five failures lock the account for 15 minutes, on top of the auth rate limit.

**Suspended users could log in.** `status` was never checked.
→ Checked at login _and_ on every authenticated request.

**Duplicate accounts by email case.** `alice@x.com` and `Alice@x.com` were two
users.
→ Emails are normalised and stored lowercase with a unique index.

**Inert validators.** Several routes declared validation chains but never ran
`validationMiddleware`, so the rules did nothing.
→ Every route runs it, and pagination is bounded (`limit=1000000` is a 400).

**Broken account creation.** `accountNumber` was required by the schema but
never generated, so the route 500'd — and a client-supplied number could
collide.
→ Generated server-side from `crypto.randomInt`, with retry on the unique index.

## Controls in place

| Control              | Implementation                                                            |
| -------------------- | ------------------------------------------------------------------------- |
| Authentication       | JWT access tokens, 15 min, `jti` + `typ` + `ver` claims                   |
| Session revocation   | Redis deny-list (access) + one-time allow-list (refresh)                  |
| Authorisation        | Ownership in the service layer; `ADMIN` role for privileged routes        |
| Password storage     | bcrypt, 12 rounds, `select: false` on the field                           |
| Password policy      | ≥ 10 chars, mixed case, digit, symbol                                     |
| User enumeration     | Identical error + constant-time-ish bcrypt on unknown users               |
| Injection            | `isMongoId`/`isEmail`/type checks at the edge + Mongoose `sanitizeFilter` |
| Transport of secrets | Hashes and token versions stripped from every response                    |
| Headers              | `helmet`, `x-powered-by` disabled, CORS allow-list (deny by default)      |
| Payload size         | 100 kB body cap → 413                                                     |
| Rate limiting        | Per IP, per IP+email, per user                                            |
| Idempotency          | Redis lock + payload fingerprint + unique DB index                        |
| Audit                | Append-only ledger, request id on every log line and error                |
| Integrity            | Per-account and system-wide reconciliation endpoints                      |

## Added since the audit

| Control                  | Implementation                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email verification       | Single-use token stored only as a SHA-256 hash, 24h TTL index, atomic claim, one identical error for expired/spent/unknown so tokens cannot be probed |
| No enumeration on resend | `/auth/resend-verification` returns the same 200 whether or not the address exists                                                                    |
| Mock-mail containment    | The verification link is returned in the response **only** while mail is mocked, and mocking is unavailable in production — not merely defaulted off  |
| Audit trail              | Reversals and staff-initiated freeze/unfreeze/close are written to an append-only collection with actor, reason and request id                        |
| Log redaction            | `authorization`, `password`, `*.token`, `set-cookie` and friends are censored at the logger, so a new log line cannot leak one by omission            |
| Holds                    | Reservations are race-safe by the same conditional-update construction as debits, and write nothing to the journal                                    |

### One trap worth repeating

Mongoose's `sanitizeFilter` — the defence against injected query operators —
rewrites **legitimate** operators too. It broke the conditional balance check
once (`{ $gte: amount }` became an equality match) and then broke the
verification-token expiry check the same way (`{ $gt: new Date() }`). Both are
now wrapped in `mongoose.trusted()`. In both cases the failure was silent at
the type level and caught only by a test that exercised the behaviour.

## Known gaps

Deliberately out of scope for this pass — worth doing before real money:

- **Password reset** is not implemented. The token model already supports the
  purpose and the mailer exists, so it is mostly wiring.
- **Real mail delivery** — everything up to the transport is implemented; the
  transport logs instead of sending.
- **MFA** is not implemented.
- **No webhook or external settlement integration** — deposits are simulated
  against the system contra account.
- **Expired holds are not swept.** An expired hold cannot be captured, but
  nothing releases it automatically.
- **Partial capture** is not supported — a hold settles in full or not at all.
- **Reconciliation is on demand**, not a scheduled job with alerting.
- **No continuous integration.** The suites exist and pass; nothing runs them
  on a push yet.
- **Redis is a hard dependency for session revocation.** Flushing Redis logs
  everyone out; losing it silently would stop deny-listing from working.
