# Ledger: architecture and interview guide

This document describes the implemented project, not a production banking platform. All balances and payments are simulated. Use the interactive guide at `/demo` alongside these notes.

## Explain it in thirty seconds

> Ledger is a TypeScript double-entry ledger with an Express API and a React console. A posted payment updates both accounts, its transaction record, and two balanced journal entries in one MongoDB transaction. Conditional updates protect available funds under concurrency. Redis supports replay, rate limits, and session revocation; MongoDB also enforces payment-key uniqueness. The console makes transfers, retries, holds, reversals, and reconciliation visible.

Do not claim transaction volume, latency, uptime, or financial compliance without evidence. Explain decisions as engineering choices demonstrated by this repository; do not invent a historical reason for selecting a technology.

## The problem being solved

A balance field alone cannot explain where money came from or detect an incomplete transfer. Retrying a timed-out payment can charge twice. Two concurrent withdrawals can both pass an application-level balance check. Corrections can erase evidence if they overwrite history.

Ledger addresses these problems using a journal, database transactions, conditional writes, durable payment-key uniqueness, and compensating transactions. The UI exposes the evidence so these properties can be demonstrated instead of asserted.

## Domain model

| Model             | Responsibility                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| User              | Credentials, roles, status, verification state, failed-login lockout, token version                           |
| Account           | Owner, immutable currency and account number, posted balance, available balance, status                       |
| Transaction       | Intent/result: transfer, deposit, withdrawal; status; initiator; replay key/fingerprint; optional hold expiry |
| LedgerEntry       | One debit or credit, transaction/account IDs, currency, amount, resulting posted balance                      |
| VerificationToken | Hashed, expiring, single-use verification credential                                                          |
| AuditLog          | Administrative action, actor, target, reason, request ID, and context                                         |

Amounts are integers in minor units: `1000` means ₹10.00 or $10.00 in the supported two-decimal currencies. Never mix currencies at par. An INR account can transfer only to another INR account; USD is separate. Foreign exchange is not implemented.

For a customer account:

```text
posted balance = journal credits - journal debits
available balance = posted balance - outstanding reservations
```

Deposits debit a per-currency system contra account and credit the customer. Withdrawals do the opposite. The system account can be negative by design. This is a compact internal ledger convention, not a full general ledger with asset/liability account classifications.

## Follow a transfer through the code

1. The React form converts a decimal string to integer minor units and calls `/api/v1/transactions` with a bearer token and idempotency key.
2. Express middleware authenticates the token, reads current user roles/state, applies rate limits, and checks Redis replay ownership. Validators reject malformed IDs, invalid amounts, and oversized inputs.
3. `TransactionService.createTransfer` checks source ownership, account usability, same-account rejection, and matching currencies. A stored request fingerprint binds a payment key to the normalized operation/input.
4. A MongoDB session runs `withTransaction`. The debit filter includes `availableBalance >= amount` and active status. The credit also requires active status. Account writes participate in the same transaction.
5. The service writes a completed transaction and equal debit/credit journal legs. `LedgerService` verifies equal totals before inserting entries.
6. MongoDB commits everything or rolls everything back. The API returns the result; Redis stores successful responses for replay.

The database condition is the key concurrency detail. A read followed by an unconditional decrement is unsafe. The guarded update checks funds as part of the write, and transaction write conflicts cause the callback to retry against current state.

Account closure similarly includes zero posted/available balances in the database update. A concurrent payment must not leave a closed account containing newly posted funds.

## Why each technology is here

### TypeScript and Express 5

TypeScript catches incompatible internal values and helps keep the browser client aligned with the API. Express keeps routing and middleware order explicit: authentication must precede caller-scoped idempotency and authorization. Controllers translate HTTP into service input; services own business rules.

Tradeoff: compile-time types disappear at runtime. `express-validator`, body size limits, service checks, and behavioral tests remain essential. This layered structure is not strict Clean Architecture: services import Mongoose models directly for transaction coordination. A database migration would require service changes, not only repository replacement.

### MongoDB and Mongoose

MongoDB provides multi-document transactions, unique indexes, and conditional updates. Mongoose adds schemas, model types, and query helpers. The Compose replica set is required for transactions; a standalone MongoDB process is insufficient.

Tradeoff: MongoDB does not supply relational foreign keys or the same constraint model as PostgreSQL. The service must enforce ownership, currency compatibility, valid account transitions, and balanced posting. PostgreSQL would be a strong default for a new financial ledger, especially for relational constraints and exact numeric types. The defensible claim here is that the project demonstrates transaction and concurrency design with MongoDB, not that MongoDB is universally preferable for finance.

`sanitizeFilter` protects against injected operators, but legitimate first-party operators need `mongoose.trusted()`. Otherwise a `$gte` funds guard or `$gt` expiry condition can be rewritten incorrectly. Behavioral tests catch this class of failure when types cannot.

### Redis

Redis shares rate-limit counters, response replay, request locks, token deny lists, and refresh-token state across API processes. Lock acquisition uses one `SET ... EX ... NX` operation so a crash cannot leave a lock without expiry. Request ownership is also claimed atomically.

Tradeoff: it is an additional stateful dependency. The rate limiter can fail open on Redis connection errors, but authentication and idempotency still use Redis. Do not describe the entire application as available without Redis. Persistence and recovery matter; cache loss is not equivalent to losing harmless derived data.

### Integer money

Integer minor units avoid fractional floating-point arithmetic and serialize clearly through JSON. The UI parses money at the boundary and formats it for display.

Tradeoff: supported currencies use two decimal places; there is no exchange-rate model. JavaScript `number` is exact only through `Number.MAX_SAFE_INTEGER`. Per-payment validation is present, but cumulative account and aggregate totals need explicit bounds or a different representation before very large-scale use. Decimal/BigInt/database numeric types are possible alternatives.

### JWT, bcrypt, and session state

Passwords are hashed with bcrypt. Access and refresh tokens have separate signing secrets, issuer/audience checks, and distinct token types. Production requires both secrets to be configured. Refresh tokens rotate and are consumed atomically; reuse revokes the user's sessions. User token versions invalidate old access tokens after sensitive changes.

Tradeoff: JWT does not make authentication stateless here: roles, status, token version, and revocation are checked against server state. Browser tokens use validated tab-scoped sessionStorage. Legacy localStorage token copies are removed. This reduces persistence but still exposes tokens to injected JavaScript. HttpOnly cookies with an appropriate CSRF strategy or a backend-for-frontend would be a production alternative. New tabs sign in independently; duplicated tabs can still inherit a browser session snapshot. A late refresh response cannot restore a logged-out session, but robust production session handling still needs further design.

### React, Vite, Tailwind, and Radix UI

React handles interactive state and transaction inspection. Vite builds the app and proxies API calls during development. nginx serves the production build and proxies calls in Docker, keeping the browser on one origin. Tailwind provides styling; Radix-based component source supplies accessible primitives. Purple remains the visual theme, with an SVG Ledger mark. The responsive playground uses a GitHub-style HTML/SVG data-flow diagram, not a draggable graph library. Shadcn controls provide selects, tabs, tooltips, menus, and the mobile drawer.

Tradeoff: a static frontend alone cannot demonstrate this system. The API, MongoDB replica set, and Redis must run too. The public guide displays demo credentials, but users must submit the sign-in form to authenticate. Reading the guide never logs in or switches accounts. Shared demo accounts mean visitors can affect each other's state; a public sandbox should isolate sessions or reset data.

## Idempotency: guarantees and boundaries

There are three cooperating mechanisms:

1. **Redis response replay:** a hash includes caller, method, route, key, and request body. Successful responses can be returned without running the operation again. Response/ownership TTL is 24 hours; request locks expire after 60 seconds.
2. **Request ownership:** a caller's key is bound to a request hash. Different requests with that key are rejected with `409`.
3. **MongoDB payment guard:** a unique, sparse index stores `userId:key` on money transactions. The operation/input fingerprint is persisted with the transaction. If Redis state expires, the service checks the durable fingerprint before returning an existing result. Concurrent inserts cannot both commit.

The persistent guard covers transfers, deposits, withdrawals, and authorizations. It is not a universal durable replay system for every HTTP mutation. Account creation uses the Redis layer; capture, void, and reversal use state transitions rather than response replay.

Historical payment rows without fingerprints are rejected when a key is reused after Redis replay is unavailable. That is safer than returning an unrelated result. Use a new key for a genuinely new operation. The Redis hash uses JSON serialization, so clients should preserve payload representation when retrying within its TTL.

Do not call this end-to-end exactly-once delivery. The practical property is at-most-once committed money movement for a supplied payment key, with retries returning the stored result when the request matches. Requests without keys can create multiple valid payments.

## Holds and settlement

Authorization creates a `PENDING` transfer and reduces only available balance. It writes no journal entries because nothing has settled.

- **Capture:** claims `PENDING` inside a database transaction, moves posted balances, credits the destination's available balance, and writes the two journal legs. Available funds were already reserved at authorization.
- **Void:** claims `PENDING`, sets `CANCELLED`, and restores the source's available balance. No journal posting occurs.
- **Race:** only one state transition can claim a pending hold. Capture/capture and capture/void cannot both settle it.
- **Expiry:** expired holds cannot be captured. They still require manual void; no background sweeper runs.
- **Frozen accounts:** existing reservations may settle after a freeze. Closed accounts cannot settle. This is an explicit policy choice.

Partial capture, incremental authorization, and card-network integration are not implemented.

## Reversal and administrative audit

An admin reversal claims the original `COMPLETED` transaction and marks it `REVERSED` inside the same MongoDB transaction as the opposite payment. Simultaneous reversals cannot both commit. Journal entries are retained. The original transaction's status changes; claiming that every original row is immutable would be inaccurate.

The reversal audit event is emitted after the database transaction commits, avoiding events for aborted/retried callbacks. Audit writes are best effort and logged on failure. Admin actions on another user's account are also recorded; ordinary self-service freezes are not.

Tradeoffs: audit records can be lost if the process dies after commit or the audit write fails. A transactional outbox or audit entry in the same transaction would close that gap. Reversal may force a customer balance negative when the recipient already spent the funds; a production system needs an explicit recovery/debt policy. An HTTP journal with no edit route is not database-level immutability or cryptographic tamper evidence.

## Reconciliation and observability

Per-account reconciliation compares cached posted balance with journal credits minus debits. Available balance can legitimately differ while holds exist. Global verification compares aggregate debits and credits; it is an on-demand diagnostic, not a complete accounting audit. Global totals currently combine currencies and can hide offsetting per-currency errors. Strengthen this with per-currency/per-transaction checks and scheduled reconciliation before production.

Balance and journal reads are separate operations, so concurrent posting can produce a transient reconciliation mismatch. A consistent snapshot or retry is needed before treating that mismatch as corruption. Matching totals alone also cannot detect every invalid but balanced transaction.

Pino provides structured logs, request IDs connect errors to requests, `/health` reports process liveness, and `/ready` checks dependency connectivity. These do not constitute full metrics, distributed tracing, alerting, or automated recovery.

## Interactive playground

The authenticated `/playground` screen displays account, posting-engine, and confirmed-journal blocks connected by labeled arrows. It exposes transfers, deposits, withdrawals, holds, capture, void, safe retry, and an overdraft experiment. Balances and journal entries come from the existing API; visual movement starts after an accepted posting. No artificial intermediate debit/credit states are presented as server events because the real posting is atomic.

A browser API-client observer publishes request metadata to the page's timeline. It excludes authentication endpoints and never publishes bodies, credentials, or headers. Observers are isolated so an observer exception cannot fail a payment. This is page-local observability, not a WebSocket/SSE stream of backend logs or other users' activity. Full server logs remain in Docker. Manual refresh updates balances changed by another client.

A new user can explicitly prepare two funded INR wallets through the same account/deposit endpoints. The action uses stable keys and requires the existing self-deposit permission. Playground operations use normal owner authorization, and visiting the page requires sign-in. No admin role or account switching is granted by the playground.

A failed evidence read after a successful payment is reported separately from payment failure. Retrying preserves the original operation/key/payload. Transaction status is re-read when evidence loads, avoiding stale cached `PENDING` authorization responses after capture. The timeline is capped at 200 events and disappears on navigation; clearing it never changes the journal or balances.

## Frontend reliability and delivery

Routes are lazy-loaded so the playground and other screens are not downloaded on the sign-in page. Skeletons show loading state. Render boundaries exist at app, route, and diagram scope; a route failure preserves navigation and never displays raw exception payloads. API/network errors remain normal recoverable UI state rather than render errors. Failed writes preserve retry keys, and failed evidence reads are distinguished from rejected payments.

The desktop shell has one viewport owner, collapsible navigation, and independently bounded content panels. Mobile/tablet content stacks and scrolls in the main region; navigation uses a shadcn drawer. Collapsed navigation passes static classes through tooltip slots: passing NavLink's class-name callback through Radix Slot previously broke icon centering. Keyboard labels, skip navigation, amount validation descriptions, and reduced-motion rules are included.

Self-hosted Geist uses font-display swap. Nginx caches hashed assets immutably, revalidates HTML, rejects missing chunks, and disables API caching. CSP disallows inline scripts/eval and framing, with inline styles permitted for Radix positioning. Referrer policy, no-sniff and permissions headers, and query-free access logs reduce browser/log exposure. Authenticated API responses also send no-store directly. Unknown-user login performs bcrypt comparison against a valid dummy hash at the configured work factor rather than an invalid placeholder hash.

Public-demo metadata and a query-free canonical URL are set in the browser; authenticated routes are noindex. This remains a client-rendered application, not an SSR marketing site. Search discoverability and HTTPS/public hosting remain deployment concerns.

## Testing and evidence

Local verification on 2026-11-12 passed 36 unit tests, 176 API checks, and 20 browser scenarios, plus 12 responsive/recovery/security browser checks. Both builds, lint, formatting, and dependency audits passed. These counts describe this verification, not a performance benchmark.

Run the commands in the README. Unit tests exercise money parsing, password rules, pagination, account-number generation, and ledger invariants. API tests run against real MongoDB and Redis and include unauthorized reads, forged/replayed tokens, injection, duplicate payment requests, concurrent overspending, holds, reversals, and audit visibility. Browser tests compare UI behavior with actual balances and check desktop/mobile flows.

The regression suite includes simultaneous reversal requests and persistent idempotency checks independent of cached response replay. GitHub Actions defines reproducible checks against a fresh stack. A workflow file does not mean a remote CI run has already passed; inspect its result after pushing.

The load script is available for experimentation. No benchmark numbers are claimed. Passing these tests is evidence for tested scenarios, not proof that every possible failure is eliminated.

## Questions to prepare

**What if the process dies halfway through a payment?** MongoDB commits all writes or none. If the response is lost after commit, retry the same key and payload to retrieve the stored payment. The durable key prevents a second committed payment even after Redis replay expires.

**Why not check balance in JavaScript?** Two requests can read the same funds. The funds predicate belongs in the database update, inside the transaction.

**Why not reverse by deleting the original?** Deletion destroys the explanation for past balances. A compensating transaction preserves the original journal and records the correction.

**What if Redis fails?** Rate limiting may fail open, but session/replay operations can fail. MongoDB retains payment-key uniqueness. Recovery policy, persistence, and availability still need operational design.

**How does this scale?** Multiple API processes can share MongoDB and Redis. Hot accounts serialize competing writes; contra accounts can be hotspots. Reconciliation scans also grow expensive. Measure contention and query cost before choosing partitioning, projections, or batching. Replica reads can be stale and must not decide whether a debit is safe.

**Why not microservices or Kafka?** A single service keeps the atomic accounting boundary easy to reason about. Splitting it introduces distributed consistency, delivery, and recovery problems without a demonstrated scale need. An outbox becomes useful when reliable external events are required.

**What would you build next?** Automatic hold expiry, per-currency/snapshot reconciliation with alerts, reliable audit/outbox delivery, stronger session handling, and isolated public demo data. Real settlement and email transport come after these correctness/operational foundations.

## Resume wording

Use only claims that you can explain and demonstrate:

- Built a TypeScript/Express double-entry ledger with MongoDB transactions, conditional balance updates, and a React simulation console.
- Implemented caller-scoped idempotency with Redis replay and MongoDB unique payment keys, plus authorization holds, settlement, and compensating reversals.
- Added integration and browser tests covering concurrent payments, access control, token replay, and ledger reconciliation; packaged the stack with Docker Compose.

Suggested title: **Ledger — Double-entry Ledger and Banking Simulation**.

Link the repository and, once you deploy one, the actual interactive demo URL. Do not put `localhost` on a resume or imply that a downloaded video is a live service.

## Production gaps to state openly

No real banking rails, KYC/AML workflow, FX, password reset, MFA, actual email delivery, automatic hold expiry, partial capture, scheduled reconciliation, tamper-proof audit, or production HA. There is no regulatory/compliance certification. MongoDB/Redis backups, disaster recovery, TLS, secret rotation, resource limits, metrics/alerts, and public-demo isolation remain deployment work.

These are useful interview tradeoffs: explain the demonstrated scope, show the evidence, and name the next constraint you would address.
