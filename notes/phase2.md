# Phase 2: Transactions, Ledger & ACID Guarantees

## Table of Contents
1. [Overview](#overview)
2. [Goals for Phase 2](#goals-for-phase-2)
3. [New Concepts and Patterns](#new-concepts-and-patterns)
4. [Domain & Schema Changes](#domain--schema-changes)
5. [TransactionService (ACID)](#transactionservice-acid)
6. [LedgerService (Double-entry bookkeeping)](#ledgerservice-double-entry-bookkeeping)
7. [API Endpoints — Phase 2](#api-endpoints---phase-2)
8. [Idempotency and Concurrency](#idempotency-and-concurrency)
9. [Testing Strategy](#testing-strategy)
10. [Operational Concerns & Observability](#operational-concerns--observability)
11. [Migration & Backwards Compatibility](#migration--backwards-compatibility)
12. [Example Workflows](#example-workflows)
13. [Next Steps & Phase 3 Preview](#next-steps--phase-3-preview)

---

## Overview

Phase 2 builds on the clean architecture and foundational features implemented in Phase 1. The core focus here is to implement safe, atomic money movement and an immutable ledger of entries using double-entry bookkeeping. Phase 2 adds transaction orchestration, ledger recording, and important operational safeguards (idempotency, distributed locks, ACID semantics via MongoDB sessions).

This document explains design decisions, service contracts, models, endpoints, example flows, and testing guidance so the team can learn from and extend the system.

---

## Goals for Phase 2

- Implement TransactionService that performs transfers with ACID guarantees using MongoDB transactions (sessions).
- Implement LedgerService that records balanced debit/credit entries for each transfer.
- Ensure idempotency for transactions (via X-Idempotency-Key + transaction.idempotencyKey persisted).
- Add transaction endpoints (create, get, list) and ensure they are secured and validated.
- Provide tests (unit + integration) to verify correctness for core flows.

---

## New Concepts and Patterns

- ACID with MongoDB Sessions: Use `startSession()` and `session.withTransaction()` for multi-document atomicity.
- Double-entry bookkeeping: Each financial movement is recorded as two (or more) ledger lines that sum to zero for a given currency.
- Idempotency: Persist idempotencyKey in transaction documents and use Redis caching to deduplicate inflight/duplicate requests.
- Concurrency control: Use optimistic checks (versioning) or DB-level transactions; Redis locks can be used for cross-instance coordination.

---

## Domain & Schema Changes

### Transaction model additions (already present in Phase 1 but reiterated)
- Fields: fromAccount, toAccount, amount, currency, type, status, idempotencyKey, reference, metadata, completedAt
- Add indexes: idempotencyKey (unique | sparse), fromAccount, toAccount

### New Ledger model (suggested)

File: `src/infrastructure/database/mongodb/models/ledger.model.ts`

Fields:
- transactionId: ObjectId (ref Transaction)
- accountId: ObjectId (ref Account)
- entryType: 'DEBIT' | 'CREDIT'
- amount: number
- currency: string
- balanceAfter: number (optional snapshot)
- metadata: Mixed
- createdAt

Indexing and constraints:
- Index transactionId
- Compound index (accountId, createdAt) for account statement queries

Rationale: Ledger entries are append-only, immutable, and form the source-of-truth for balances and reconciliation.

---

## TransactionService (ACID)

Contract (typed):

- createTransfer(options: {
  fromAccountId: string;
  toAccountId: string;
  amount: number; // smallest currency unit
  currency?: string;
  idempotencyKey?: string;
  reference?: string;
  metadata?: Record<string, any>;
}): Promise<Transaction>

Responsibilities:

1. Validate input (non-negative amount, accounts exist, currencies match or conversion handled elsewhere).
2. Check idempotency: if a transaction with the same idempotencyKey exists, return it.
3. Start MongoDB session and transaction.
4. Perform balance checks and update account balances atomically (debit fromAccount, credit toAccount).
5. Create Transaction record with `status: COMPLETED` or `FAILED` depending on outcome.
6. Create Ledger entries (DEBIT for fromAccount, CREDIT for toAccount) within the same transaction.
7. Commit transaction and return Transaction result.

Error handling:
- If any step fails, abort the session (rollback) and mark transaction as FAILED (or don't persist) depending on timing.
- Use domain-specific errors such as `InsufficientFundsError` to map to 400 responses.

Performance & scale notes:
- Keep transactions short-lived (avoid long-running external calls inside a session).
- Consider splitting heavy work (notifications, analytics) into async jobs after commit.

Sample pseudo-code:

```ts
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // 1. find accounts (with session)
    // 2. check balances
    // 3. update balances (atomic)
    // 4. insert transaction doc
    // 5. insert two ledger entries
  });
} finally {
  session.endSession();
}
```

Idempotency integration: set idempotencyKey on transaction document and use Redis to deduplicate inflight processing (see Idempotency section).

---

## LedgerService (Double-entry bookkeeping)

Responsibilities:

- Receive completed transactions and create ledger entries (DEBIT/CREDIT) ensuring the sum of entries per transaction equals zero per currency.
- Provide reconciliation utilities (balances from ledger, detect gaps, export statements).
- Support queries: get ledger entries by account, date ranges, filter by transactionId.

Important properties:

- Immutability: Ledger entries should not be updated. Corrections should be new entries referencing the original transaction.
- Auditability: Each entry contains sufficient metadata to trace back to source transaction and reason.

Reconciliation pattern:

- Use ledger entries to recompute balances: sum(CREDIT) - sum(DEBIT) = balance
- Periodic background job: reconcile ledger vs stored account balances and produce discrepancies report

---

## API Endpoints — Phase 2

Add the following endpoints (secured with JWT and validation):

Accounts (some already added in Phase 1):
- POST /api/v1/accounts — create account (body: userId, accountType, currency)
- GET /api/v1/accounts/:id — get account by id
- GET /api/v1/accounts/user/:userId — list accounts for a user
- PUT /api/v1/accounts/:id — update account metadata/status
- DELETE /api/v1/accounts/:id — close account (soft-delete/status)

Transactions (new):
- POST /api/v1/transactions — create transfer
  - Headers: X-Idempotency-Key (recommended)
  - Body: { fromAccount, toAccount, amount, currency?, reference?, metadata? }
  - Response: transaction object with status

- GET /api/v1/transactions/:id — fetch transaction by id
- GET /api/v1/accounts/:id/transactions — list transactions for account (pagination)

Ledger (read-only for now):
- GET /api/v1/ledger/accounts/:accountId — ledger entries for account
- GET /api/v1/ledger/transactions/:transactionId — ledger entries for transaction

Auth (new):
- POST /api/v1/auth/refresh — exchange refresh token for a new access token

Ensure these endpoints are documented in `docs/api.md` with example requests/responses.

---

### Detailed Request/Response Examples (Phase 2)

Below are fully detailed examples for each Phase 2 endpoint: request headers, body schema, and example responses (success and error). Use these in Postman or as part of automated API docs.

#### POST /api/v1/accounts

Request Headers:
- Authorization: Bearer <access_token>
- Content-Type: application/json

Request Body:
```json
{
  "userId": "64abcf...",
  "accountType": "SAVINGS",
  "currency": "INR",
  "metadata": { "nickname": "Salary" }
}
```

Success Response (201):
```json
{
  "success": true,
  "data": {
    "id": "acc_123",
    "userId": "64abcf...",
    "accountNumber": "1000001234",
    "accountType": "SAVINGS",
    "currency": "INR",
    "balance": 0,
    "availableBalance": 0,
    "status": "ACTIVE",
    "createdAt": "2026-05-29T10:00:00Z"
  }
}
```

Error (400): Missing fields
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "userId is required" } }
```

---

#### GET /api/v1/accounts/:id

Success Response (200):
```json
{
  "success": true,
  "data": {
    "id": "acc_123",
    "userId": "64abcf...",
    "accountNumber": "1000001234",
    "accountType": "SAVINGS",
    "currency": "INR",
    "balance": 5000,
    "availableBalance": 4500,
    "status": "ACTIVE"
  }
}
```

Error (404):
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Account not found" } }
```

---

#### POST /api/v1/transactions

Request Headers:
- Authorization: Bearer <access_token>
- X-Idempotency-Key: <uuid>
- Content-Type: application/json

Request Body:
```json
{
  "fromAccount": "acc_123",
  "toAccount": "acc_456",
  "amount": 1000,
  "currency": "INR",
  "reference": "order-123",
  "metadata": { "note": "Payment for invoice 42" }
}
```

Success Response (201):
```json
{
  "success": true,
  "data": {
    "id": "txn_789",
    "fromAccount": "acc_123",
    "toAccount": "acc_456",
    "amount": 1000,
    "currency": "INR",
    "type": "TRANSFER",
    "status": "COMPLETED",
    "idempotencyKey": "uuid-abc-123",
    "reference": "order-123",
    "completedAt": "2026-05-29T10:05:00Z"
  }
}
```

Error (409) — Processing / concurrent:
```json
{ "success": false, "error": { "code": "PROCESSING", "message": "Request is currently being processed" } }
```

Error (400) — Insufficient funds:
```json
{ "success": false, "error": { "code": "INSUFFICIENT_FUNDS", "message": "Insufficient funds" } }
```

---

#### GET /api/v1/transactions/:id

Success Response (200):
```json
{
  "success": true,
  "data": {
    "id": "txn_789",
    "fromAccount": "acc_123",
    "toAccount": "acc_456",
    "amount": 1000,
    "currency": "INR",
    "status": "COMPLETED",
    "createdAt": "2026-05-29T10:05:00Z",
    "completedAt": "2026-05-29T10:05:00Z"
  }
}
```

Error (404):
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Transaction not found" } }
```

---

#### GET /api/v1/accounts/:id/transactions

Query Params: `?page=1&limit=20`

Success Response (200):
```json
{
  "success": true,
  "data": [ /* array of transaction objects */ ],
  "pagination": { "page": 1, "limit": 20, "total": 100 }
}
```

---

#### GET /api/v1/ledger/accounts/:accountId

Success Response (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "ledger_1",
      "transactionId": "txn_789",
      "accountId": "acc_123",
      "entryType": "DEBIT",
      "amount": 1000,
      "currency": "INR",
      "createdAt": "2026-05-29T10:05:00Z"
    }
  ]
}
```

---

#### POST /api/v1/auth/refresh

Request Body:
```json
{ "refreshToken": "<refresh_token>" }
```

Success Response (200):
```json
{ "success": true, "data": { "accessToken": "new_access_token" } }
```

Error (401):
```json
{ "success": false, "error": { "code": "UNAUTHORIZED", "message": "Invalid refresh token" } }
```

---

End of detailed examples.


---

## Idempotency and Concurrency

Idempotency rules for transaction creation:

1. Client should send `X-Idempotency-Key` (UUID v4 recommended).
2. On server: Check Redis for key. If exists and completed response cached, return cached response.
3. If key exists but is processing, return 409 Conflict or wait (design choice).
4. If key not present: attempt to set a processing key in Redis with short TTL (e.g., 60s). Proceed.
5. Persist `idempotencyKey` on transaction document when creating the record within DB transaction.
6. Cache final response in Redis with TTL (e.g., 24h) for subsequent retries.

Race conditions & distributed systems:

- Use Redis `SET ... NX EX` for atomic lock acquisition.
- Also persist idempotencyKey as a unique index in DB (sparse unique) as strong DB-side protection.

---

## Testing Strategy

Unit tests:
- AuthService, AccountService: happy path + 1-2 edge cases (missing fields, invalid data)
- TransactionService: unit tests using mocked repositories and mocked mongoose session wrapper to assert that debit/credit calls are invoked in order

Integration tests:
- Use a test database (MongoDB test instance or in-memory Mongo emulator like `mongodb-memory-server`).
- Tests: register user, create accounts, perform transfer, assert balances and ledger entries.
- Use supertest to call endpoints; ensure idempotency by repeating the same request with same idempotency key.

Contract tests (optional):
- Verify event shapes and ledger entries across versions.

---

## Operational Concerns & Observability

- Instrument transactions: add trace IDs (X-Request-ID), include transactionId in logs.
- Metrics: number of transfers, failed transfers, average transaction latency, idempotency cache hits/misses.
- Alerts: failed transactions growth, imbalance in ledger vs account balances.
- Backups: ensure MongoDB backups are scheduled; test restore plans.

---

## Migration & Backwards Compatibility

- When adding unique index on `idempotencyKey`, use a sparse unique index and backfill cautiously.
- For ledger entries: create new collection `ledgers` and backfill historical transactions via a migration job.
- Avoid breaking changes to public API; support both older and newer response shapes for a transition window.

---

## Example Workflows

1. Transfer (happy path)

Client:
```http
POST /api/v1/transactions
Headers: Authorization: Bearer <token>
         X-Idempotency-Key: tx-uuid-123
Body: {
  "fromAccount": "acc_1",
  "toAccount": "acc_2",
  "amount": 1000,
  "currency": "INR",
  "reference": "order-123"
}
```

Server (TransactionService):

1. Check idempotency in Redis -> not present, set processing key
2. Start MongoDB session
3. Lock/validate accounts, check balances
4. Update account balances (debit/credit)
5. Create transaction document with idempotencyKey
6. Create two ledger entries (DEBIT/CREDIT)
7. Commit
8. Cache response in Redis (24h)

2. Retry with same idempotency key

- Server returns cached response immediately (no duplicate transfer)

---

## Next Steps & Phase 3 Preview

- Implement more advanced features: scheduled interest posting, fee engine, dispute handling.
- Add policy-based access controls and audit trails for sensitive operations.
- Implement reconciliation workers and periodic integrity checks.
- Add observability improvements (distributed tracing, structured logs, dashboards).

---