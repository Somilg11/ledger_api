# LEDGER API – Production-Grade API Specification# LEDGER API – Routes Documentation



## Version## Base URL

**API Version:** v1  

**Base URL:** `/api/v1`  ```

**Protocol:** HTTPS only  /api/v1

**Authentication:** JWT Bearer tokens  ```



------



## Architecture Overview# AUTH ROUTES



### Folder Structure (Clean Architecture + DDD)### POST /auth/register



```**Request**

src/

├── api/                          # API Layer (Controllers & Routes)```json

│   ├── controllers/              # Request handlers{

│   │   ├── auth.controller.ts  "email": "user@example.com",

│   │   ├── account.controller.ts  "password": "Strong@123",

│   │   ├── transaction.controller.ts  "name": "John Doe"

│   │   ├── ledger.controller.ts}

│   │   ├── webhook.controller.ts```

│   │   └── admin.controller.ts

│   ├── routes/                   # Route definitions**Response**

│   │   ├── index.ts

│   │   ├── auth.routes.ts```json

│   │   ├── account.routes.ts{

│   │   ├── transaction.routes.ts  "message": "User registered successfully",

│   │   ├── ledger.routes.ts  "userId": "64abcf..."

│   │   ├── webhook.routes.ts}

│   │   └── admin.routes.ts```

│   └── middlewares/              # HTTP middlewares

│       ├── auth.middleware.ts---

│       ├── validation.middleware.ts

│       ├── rateLimit.middleware.ts### POST /auth/login

│       ├── idempotency.middleware.ts

│       ├── error.middleware.ts**Request**

│       └── requestLogger.middleware.ts

├── application/                  # Application/Business Logic Layer```json

│   ├── services/                 # Business services{

│   │   ├── auth.service.ts  "email": "user@example.com",

│   │   ├── account.service.ts  "password": "Strong@123"

│   │   ├── transaction.service.ts}

│   │   ├── ledger.service.ts```

│   │   ├── balance.service.ts

│   │   ├── reconciliation.service.ts**Response**

│   │   ├── notification.service.ts

│   │   └── audit.service.ts```json

│   ├── usecases/                 # Use case orchestration{

│   │   ├── createTransaction.usecase.ts  "token": "jwt_token",

│   │   ├── transferFunds.usecase.ts  "user": {

│   │   ├── processRefund.usecase.ts    "id": "64abcf...",

│   │   └── reconcileAccount.usecase.ts    "email": "user@example.com"

│   └── dtos/                     # Data Transfer Objects  }

│       ├── transaction.dto.ts}

│       ├── account.dto.ts```

│       └── ledger.dto.ts

├── domain/                       # Domain Layer (Core Business Logic)---

│   ├── entities/                 # Domain entities

│   │   ├── User.entity.ts### POST /auth/logout

│   │   ├── Account.entity.ts

│   │   ├── Transaction.entity.ts**Response**

│   │   ├── LedgerEntry.entity.ts

│   │   └── AuditLog.entity.ts```json

│   ├── value-objects/            # Immutable value objects{

│   │   ├── Money.vo.ts  "message": "Logged out successfully"

│   │   ├── AccountNumber.vo.ts}

│   │   ├── TransactionId.vo.ts```

│   │   └── Currency.vo.ts

│   ├── repositories/             # Repository interfaces---

│   │   ├── IUserRepository.ts

│   │   ├── IAccountRepository.ts### GET /auth/me

│   │   ├── ITransactionRepository.ts

│   │   └── ILedgerRepository.ts**Headers**

│   ├── events/                   # Domain events

│   │   ├── AccountCreated.event.ts```

│   │   ├── TransactionCompleted.event.tsAuthorization: Bearer <token>

│   │   └── BalanceUpdated.event.ts```

│   └── aggregates/               # Aggregate roots

│       ├── Account.aggregate.ts**Response**

│       └── Transaction.aggregate.ts

├── infrastructure/               # Infrastructure Layer```json

│   ├── database/                 # Database implementations{

│   │   ├── mongodb/  "id": "64abcf...",

│   │   │   ├── connection.ts  "email": "user@example.com",

│   │   │   ├── models/  "name": "John Doe"

│   │   │   └── repositories/}

│   │   └── migrations/```

│   ├── cache/                    # Caching layer

│   │   ├── redis.client.ts---

│   │   └── cache.service.ts

│   ├── messaging/                # Message queue# ACCOUNT ROUTES

│   │   ├── rabbitmq.client.ts

│   │   ├── kafka.client.ts### POST /accounts

│   │   └── eventBus.ts

│   ├── external/                 # External service clients**Request**

│   │   ├── email.client.ts

│   │   ├── sms.client.ts```json

│   │   ├── payment-gateway.client.ts{

│   │   └── kyc.client.ts  "accountType": "SAVINGS"

│   └── monitoring/               # Observability}

│       ├── logger.ts```

│       ├── metrics.ts

│       └── tracer.ts**Response**

├── shared/                       # Shared utilities

│   ├── types/```json

│   ├── constants/{

│   ├── errors/                   # Custom error classes  "accountId": "acc_123",

│   │   ├── AppError.ts  "status": "ACTIVE"

│   │   ├── ValidationError.ts}

│   │   ├── InsufficientFundsError.ts```

│   │   └── AccountLockedError.ts

│   ├── utils/---

│   │   ├── crypto.util.ts

│   │   ├── validation.util.ts### GET /accounts

│   │   └── date.util.ts

│   └── config/                   # Configuration**Response**

│       ├── app.config.ts

│       ├── db.config.ts```json

│       └── security.config.ts[

├── app.ts                        # Express app setup  {

└── server.ts                     # Server entry point    "id": "acc_123",

```    "balance": 5000,

    "status": "ACTIVE"

---  }

]

## Global Standards```



### Request Headers---

```

Authorization: Bearer <jwt_token>### GET /accounts/:id/balance

Content-Type: application/json

X-Request-ID: <uuid>              # For distributed tracing**Response**

X-Idempotency-Key: <uuid>         # For idempotent operations

X-API-Version: v1```json

```{

  "accountId": "acc_123",

### Response Structure (Success)  "balance": 4500

```json}

{```

  "success": true,

  "data": { },---

  "meta": {

    "timestamp": "2026-02-10T10:30:00Z",# TRANSACTION ROUTES

    "requestId": "req_abc123",

    "version": "v1"### POST /transactions

  }

}**Headers**

```

```

### Response Structure (Error)Idempotency-Key: unique-key-123

```json```

{

  "success": false,**Request**

  "error": {

    "code": "INSUFFICIENT_FUNDS",```json

    "message": "Account balance is insufficient",{

    "details": {},  "fromAccount": "acc_123",

    "statusCode": 400  "toAccount": "acc_456",

  },  "amount": 500,

  "meta": {  "currency": "INR"

    "timestamp": "2026-02-10T10:30:00Z",}

    "requestId": "req_abc123"```

  }

}**Response**

```

```json

### Pagination{

```json  "transactionId": "txn_789",

{  "status": "SUCCESS"

  "data": [],}

  "pagination": {```

    "page": 1,

    "limit": 20,---

    "total": 150,

    "totalPages": 8,### GET /transactions/:id

    "hasNext": true,

    "hasPrev": false**Response**

  }

}```json

```{

  "id": "txn_789",

---  "amount": 500,

  "status": "SUCCESS"

## 1. AUTHENTICATION & AUTHORIZATION}

```

### POST `/auth/register`

**Description:** Register a new user with email verification  ---

**Rate Limit:** 5 req/min per IP  

**Request:**# SECURITY

```json

{### POST /auth/refresh

  "email": "user@example.com",

  "password": "Strong@Pass123",**Response**

  "name": "John Doe",

  "phone": "+911234567890",```json

  "kycDocuments": {{

    "documentType": "PASSPORT",  "token": "new_jwt_token"

    "documentNumber": "A1234567",}

    "issuingCountry": "IN"```

  }

}---

```

**Response:** `201 Created`### Error Format

```json

{All errors follow:

  "success": true,

  "data": {```json

    "userId": "usr_64abc...",{

    "email": "user@example.com",  "error": true,

    "status": "PENDING_VERIFICATION",  "message": "Error message"

    "verificationEmailSent": true}

  }```

}
```

---

### POST `/auth/verify-email`
**Description:** Verify email with OTP  
**Request:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

---

### POST `/auth/login`
**Description:** Login with email/password, returns JWT + refresh token  
**Rate Limit:** 10 req/min per IP  
**Request:**
```json
{
  "email": "user@example.com",
  "password": "Strong@Pass123",
  "mfaCode": "123456"
}
```
**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "refresh_...",
    "expiresIn": 3600,
    "tokenType": "Bearer",
    "user": {
      "id": "usr_64abc...",
      "email": "user@example.com",
      "name": "John Doe",
      "roles": ["USER"],
      "permissions": ["account:read", "transaction:create"]
    }
  }
}
```

---

### POST `/auth/refresh`
**Description:** Refresh access token using refresh token  
**Request:**
```json
{
  "refreshToken": "refresh_..."
}
```

---

### POST `/auth/logout`
**Description:** Invalidate tokens (add to blacklist)  
**Headers:** `Authorization: Bearer <token>`  
**Response:** `200 OK`

---

### POST `/auth/forgot-password`
**Request:**
```json
{
  "email": "user@example.com"
}
```

---

### POST `/auth/reset-password`
**Request:**
```json
{
  "resetToken": "token_...",
  "newPassword": "NewPass@123"
}
```

---

### POST `/auth/mfa/enable`
**Description:** Enable multi-factor authentication  
**Response:**
```json
{
  "qrCode": "data:image/png;base64,...",
  "secret": "JBSWY3DPEHPK3PXP",
  "backupCodes": ["12345678", "87654321"]
}
```

---

### POST `/auth/mfa/verify`
**Request:**
```json
{
  "code": "123456"
}
```

---

## 2. ACCOUNT MANAGEMENT

### POST `/accounts`
**Description:** Create a new account (savings, current, wallet)  
**Permissions:** `account:create`  
**Request:**
```json
{
  "accountType": "SAVINGS",
  "currency": "INR",
  "initialDeposit": 1000,
  "metadata": {
    "purpose": "Personal savings",
    "branch": "Mumbai Central"
  }
}
```
**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "accountId": "acc_123abc",
    "accountNumber": "1234567890123456",
    "accountType": "SAVINGS",
    "currency": "INR",
    "balance": 1000,
    "status": "ACTIVE",
    "createdAt": "2026-02-10T10:00:00Z",
    "limits": {
      "dailyTransferLimit": 100000,
      "monthlyTransferLimit": 500000
    }
  }
}
```

---

### GET `/accounts`
**Description:** List all accounts for authenticated user  
**Query Params:**
- `page=1`
- `limit=20`
- `status=ACTIVE|FROZEN|CLOSED`
- `accountType=SAVINGS|CURRENT|WALLET`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "accountId": "acc_123",
      "accountNumber": "1234567890123456",
      "accountType": "SAVINGS",
      "currency": "INR",
      "balance": 5000,
      "availableBalance": 4500,
      "status": "ACTIVE",
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ],
  "pagination": { }
}
```

---

### GET `/accounts/:accountId`
**Description:** Get detailed account information  
**Response:**
```json
{
  "success": true,
  "data": {
    "accountId": "acc_123",
    "accountNumber": "1234567890123456",
    "accountType": "SAVINGS",
    "currency": "INR",
    "balance": 5000,
    "availableBalance": 4500,
    "pendingBalance": 500,
    "status": "ACTIVE",
    "limits": {
      "dailyTransferLimit": 100000,
      "dailyWithdrawalLimit": 50000,
      "usedDailyLimit": 2000
    },
    "linkedCards": [],
    "createdAt": "2026-01-15T10:00:00Z",
    "lastTransactionAt": "2026-02-10T09:30:00Z"
  }
}
```

---

### GET `/accounts/:accountId/balance`
**Description:** Get real-time balance with breakdown  
**Response:**
```json
{
  "success": true,
  "data": {
    "accountId": "acc_123",
    "balance": 5000,
    "availableBalance": 4500,
    "pendingBalance": 500,
    "currency": "INR",
    "asOf": "2026-02-10T10:30:00Z",
    "breakdown": {
      "credits": 10000,
      "debits": 5000,
      "holds": 500
    }
  }
}
```

---

### PATCH `/accounts/:accountId`
**Description:** Update account settings  
**Request:**
```json
{
  "status": "FROZEN",
  "limits": {
    "dailyTransferLimit": 50000
  }
}
```

---

### POST `/accounts/:accountId/freeze`
**Description:** Temporarily freeze account  

---

### POST `/accounts/:accountId/unfreeze`
**Description:** Unfreeze account  

---

### DELETE `/accounts/:accountId`
**Description:** Close account (soft delete, balance must be 0)  

---

## 3. TRANSACTIONS

### POST `/transactions`
**Description:** Create a transaction (transfer, payment, withdrawal)  
**Headers:** `X-Idempotency-Key: <uuid>`  
**Request:**
```json
{
  "type": "TRANSFER",
  "fromAccount": "acc_123",
  "toAccount": "acc_456",
  "amount": 500,
  "currency": "INR",
  "description": "Monthly rent payment",
  "reference": "REF123",
  "metadata": {
    "category": "HOUSING",
    "notes": "February 2026"
  },
  "scheduledAt": null
}
```
**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_789xyz",
    "status": "COMPLETED",
    "type": "TRANSFER",
    "fromAccount": "acc_123",
    "toAccount": "acc_456",
    "amount": 500,
    "currency": "INR",
    "fee": 0,
    "netAmount": 500,
    "description": "Monthly rent payment",
    "reference": "REF123",
    "completedAt": "2026-02-10T10:30:00Z",
    "balanceAfter": {
      "fromAccount": 4500,
      "toAccount": 5500
    }
  }
}
```

---

### GET `/transactions/:transactionId`
**Description:** Get transaction details  
**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_789",
    "status": "COMPLETED",
    "type": "TRANSFER",
    "fromAccount": "acc_123",
    "toAccount": "acc_456",
    "amount": 500,
    "currency": "INR",
    "fee": 0,
    "description": "Monthly rent",
    "reference": "REF123",
    "createdAt": "2026-02-10T10:30:00Z",
    "completedAt": "2026-02-10T10:30:01Z",
    "ledgerEntries": ["led_001", "led_002"],
    "metadata": { }
  }
}
```

---

### GET `/transactions`
**Description:** List transactions with filters  
**Query Params:**
- `accountId=acc_123` (required)
- `page=1`
- `limit=50`
- `startDate=2026-02-01`
- `endDate=2026-02-28`
- `status=COMPLETED|PENDING|FAILED`
- `type=TRANSFER|DEPOSIT|WITHDRAWAL`
- `minAmount=100`
- `maxAmount=5000`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "transactionId": "txn_789",
      "type": "TRANSFER",
      "amount": 500,
      "currency": "INR",
      "status": "COMPLETED",
      "fromAccount": "acc_123",
      "toAccount": "acc_456",
      "completedAt": "2026-02-10T10:30:00Z"
    }
  ],
  "pagination": { },
  "summary": {
    "totalCredits": 2000,
    "totalDebits": 1500,
    "netFlow": 500,
    "transactionCount": 15
  }
}
```

---

### POST `/transactions/:transactionId/cancel`
**Description:** Cancel a pending transaction  
**Request:**
```json
{
  "reason": "USER_REQUESTED",
  "notes": "Wrong amount entered"
}
```

---

### POST `/transactions/:transactionId/refund`
**Description:** Initiate refund for completed transaction  
**Request:**
```json
{
  "amount": 500,
  "reason": "Duplicate payment",
  "partial": false
}
```

---

### POST `/transactions/bulk`
**Description:** Create bulk transactions (batch payments)  
**Request:**
```json
{
  "fromAccount": "acc_123",
  "transactions": [
    {
      "toAccount": "acc_456",
      "amount": 100,
      "description": "Payment 1"
    },
    {
      "toAccount": "acc_789",
      "amount": 200,
      "description": "Payment 2"
    }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "batchId": "batch_abc123",
    "status": "PROCESSING",
    "totalTransactions": 2,
    "totalAmount": 300,
    "transactions": [
      {
        "transactionId": "txn_001",
        "status": "COMPLETED"
      },
      {
        "transactionId": "txn_002",
        "status": "COMPLETED"
      }
    ]
  }
}
```

---

### GET `/transactions/bulk/:batchId`
**Description:** Get status of bulk transaction batch  

---

## 4. LEDGER (Double-Entry Bookkeeping)

### GET `/ledger/entries`
**Description:** Get ledger entries (audit trail)  
**Query Params:**
- `accountId=acc_123`
- `transactionId=txn_789`
- `page=1`
- `limit=100`
- `startDate`, `endDate`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "entryId": "led_001",
      "accountId": "acc_123",
      "transactionId": "txn_789",
      "type": "DEBIT",
      "amount": 500,
      "currency": "INR",
      "balanceBefore": 5000,
      "balanceAfter": 4500,
      "description": "Transfer to acc_456",
      "createdAt": "2026-02-10T10:30:00Z"
    },
    {
      "entryId": "led_002",
      "accountId": "acc_456",
      "transactionId": "txn_789",
      "type": "CREDIT",
      "amount": 500,
      "currency": "INR",
      "balanceBefore": 5000,
      "balanceAfter": 5500,
      "description": "Transfer from acc_123",
      "createdAt": "2026-02-10T10:30:00Z"
    }
  ],
  "pagination": { }
}
```

---

### GET `/ledger/balance-verification`
**Description:** Verify calculated balance matches ledger entries  
**Response:**
```json
{
  "success": true,
  "data": {
    "accountId": "acc_123",
    "calculatedBalance": 5000,
    "ledgerBalance": 5000,
    "isMatch": true,
    "lastVerifiedAt": "2026-02-10T10:30:00Z"
  }
}
```

---

## 5. RECONCILIATION

### POST `/reconciliation/accounts/:accountId`
**Description:** Reconcile account balance with ledger  
**Response:**
```json
{
  "success": true,
  "data": {
    "reconciliationId": "rec_abc123",
    "accountId": "acc_123",
    "status": "COMPLETED",
    "discrepancies": [],
    "balanceMatch": true,
    "completedAt": "2026-02-10T11:00:00Z"
  }
}
```

---

### GET `/reconciliation/reports`
**Description:** Get reconciliation reports  
**Query Params:**
- `date=2026-02-10`
- `status=COMPLETED|FAILED`

---

## 6. REPORTS & ANALYTICS

### GET `/reports/account-statement`
**Description:** Generate account statement (PDF/CSV)  
**Query Params:**
- `accountId=acc_123`
- `startDate=2026-02-01`
- `endDate=2026-02-28`
- `format=pdf|csv|json`

---

### GET `/reports/tax-summary`
**Description:** Generate tax summary for financial year  

---

### GET `/analytics/spending`
**Description:** Get spending analytics by category  
**Response:**
```json
{
  "success": true,
  "data": {
    "period": "2026-02",
    "totalSpending": 15000,
    "categories": [
      {
        "category": "FOOD",
        "amount": 5000,
        "percentage": 33.33,
        "transactionCount": 25
      },
      {
        "category": "TRANSPORT",
        "amount": 3000,
        "percentage": 20,
        "transactionCount": 15
      }
    ]
  }
}
```

---

## 7. WEBHOOKS

### POST `/webhooks`
**Description:** Register webhook endpoint  
**Request:**
```json
{
  "url": "https://myapp.com/webhooks/ledger",
  "events": [
    "transaction.completed",
    "transaction.failed",
    "account.frozen",
    "balance.low"
  ],
  "secret": "whsec_..."
}
```

---

### GET `/webhooks`
**Description:** List registered webhooks  

---

### DELETE `/webhooks/:webhookId`
**Description:** Delete webhook  

---

### GET `/webhooks/:webhookId/deliveries`
**Description:** View webhook delivery history  

---

## 8. ADMIN OPERATIONS

### GET `/admin/users`
**Description:** List all users (admin only)  
**Permissions:** `admin:users:read`  

---

### PATCH `/admin/users/:userId`
**Description:** Update user status/roles  
**Request:**
```json
{
  "status": "SUSPENDED",
  "roles": ["USER", "MERCHANT"]
}
```

---

### GET `/admin/transactions/suspicious`
**Description:** Get flagged suspicious transactions  

---

### POST `/admin/accounts/:accountId/force-close`
**Description:** Force close account (admin override)  

---

### GET `/admin/audit-logs`
**Description:** Get system audit logs  
**Query Params:**
- `userId`, `action`, `startDate`, `endDate`

---

### GET `/admin/metrics`
**Description:** Get system health metrics  
**Response:**
```json
{
  "success": true,
  "data": {
    "totalUsers": 10000,
    "activeAccounts": 8500,
    "totalTransactions24h": 5000,
    "totalVolume24h": 5000000,
    "avgTransactionTime": "150ms",
    "errorRate": 0.02,
    "uptime": 99.99
  }
}
```

---

## 9. HEALTH & MONITORING

### GET `/health`
**Description:** Basic health check (no auth required)  
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-10T10:30:00Z",
  "version": "1.0.0"
}
```

---

### GET `/health/detailed`
**Description:** Detailed health check (auth required)  
**Response:**
```json
{
  "status": "healthy",
  "services": {
    "database": {
      "status": "up",
      "responseTime": "5ms"
    },
    "cache": {
      "status": "up",
      "responseTime": "2ms"
    },
    "messageQueue": {
      "status": "up",
      "queueDepth": 120
    }
  },
  "timestamp": "2026-02-10T10:30:00Z"
}
```

---

### GET `/metrics`
**Description:** Prometheus metrics endpoint  

---

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or expired token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `INSUFFICIENT_FUNDS` | 400 | Account balance too low |
| `ACCOUNT_FROZEN` | 403 | Account is frozen |
| `DUPLICATE_TRANSACTION` | 409 | Idempotency key conflict |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

---

## Rate Limits

| Endpoint Group | Limit | Window |
|----------------|-------|--------|
| Auth (login/register) | 10 req | 1 min |
| Transactions | 100 req | 1 min |
| Read operations | 1000 req | 1 min |
| Admin operations | 500 req | 1 min |

---

## Security Features

1. **JWT Authentication** with refresh tokens
2. **Multi-Factor Authentication** (TOTP)
3. **Rate Limiting** per IP and per user
4. **Idempotency Keys** for all mutations
5. **Request Signing** for sensitive operations
6. **Encryption at Rest** (AES-256)
7. **TLS 1.3** in transit
8. **SQL Injection Protection** via ORMs
9. **CSRF Protection** for web clients
10. **IP Whitelisting** for admin operations
