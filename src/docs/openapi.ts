import { config } from '../shared/config/app.config';

/**
 * OpenAPI 3.1 description of the API.
 *
 * Kept as source rather than generated from decorators so the contract is
 * reviewable in a diff, and emitted to docs/openapi.json by `npm run
 * docs:openapi` for importing into Postman or a client generator.
 */

const money = {
  type: 'integer',
  format: 'int64',
  minimum: 1,
  description: 'Amount in minor units (paise/cents). Integers only — never a decimal or a string.',
  example: 50000,
} as const;

const errorResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'INSUFFICIENT_FUNDS' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: {},
      },
      required: ['code', 'message'],
    },
  },
} as const;

/** Wraps a payload in the API's success envelope. */
const ok = (schema: unknown) => ({
  type: 'object',
  properties: { success: { type: 'boolean', enum: [true] }, data: schema },
});

const responses = (extra: Record<string, string> = {}) => {
  const base: Record<string, unknown> = {};
  for (const [status, description] of Object.entries({
    '400': 'Validation failed, or a business rule rejected the request',
    '401': 'Missing, invalid, expired or revoked token',
    '403': 'Authenticated but not permitted',
    '404': 'Not found — or not yours; the two are deliberately indistinguishable',
    '409': 'Conflict: duplicate, frozen or closed account, or an in-flight idempotent request',
    '429': 'Rate limit exceeded',
    ...extra,
  })) {
    base[status] = { description, content: { 'application/json': { schema: errorResponse } } };
  }
  return base;
};

const idempotencyHeader = {
  name: 'X-Idempotency-Key',
  in: 'header',
  required: false,
  schema: { type: 'string', maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
  description:
    'Replay protection. Scoped per user and bound to the request payload: the same key with a different body is a 409.',
} as const;

const pagination = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: config.limits.maxPageSize } },
  { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0 } },
] as const;

const idParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-f0-9]{24}$' },
  description,
});

export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Ledger API',
    version: '1.0.0',
    description: [
      'A double-entry banking ledger.',
      '',
      '**Money is integers.** Every amount is a whole number of minor units (paise, cents).',
      'Decimals and numeric strings are rejected rather than coerced.',
      '',
      '**Reads are ownership-scoped.** Requesting a resource you do not own returns 404, not 403,',
      'so identifiers cannot be probed for existence.',
      '',
      '**Mutations are replayable.** Send `X-Idempotency-Key` and a retry is safe.',
    ].join('\n'),
    license: { name: 'ISC' },
  },
  servers: [
    { url: '/api/v1', description: 'Same origin (the console proxies to the API)' },
    { url: 'http://localhost:3000/api/v1', description: 'Local API' },
  ],
  tags: [
    { name: 'Auth', description: 'Registration, sessions, email verification' },
    { name: 'Accounts', description: 'Opening, reading and freezing accounts' },
    { name: 'Transactions', description: 'Moving money, including holds' },
    { name: 'Ledger', description: 'The journal and its invariants' },
    { name: 'Admin', description: 'Staff-only operations' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Account: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          userId: { type: 'string' },
          accountNumber: { type: 'string', example: '8240368283006222' },
          accountType: { type: 'string', enum: ['SAVINGS', 'CURRENT', 'WALLET'] },
          currency: { type: 'string', enum: config.supportedCurrencies },
          balance: { ...money, minimum: 0, description: 'Settled balance in minor units' },
          availableBalance: {
            ...money,
            minimum: 0,
            description: 'Balance minus outstanding holds. Debits are checked against this.',
          },
          status: { type: 'string', enum: ['ACTIVE', 'FROZEN', 'CLOSED'] },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      BalanceReport: {
        type: 'object',
        description: 'The stored balance next to the balance computed from the journal.',
        properties: {
          accountId: { type: 'string' },
          currency: { type: 'string' },
          balance: money,
          availableBalance: money,
          ledgerBalance: { ...money, description: 'Credits minus debits, summed from the journal' },
          totalDebits: money,
          totalCredits: money,
          reconciled: {
            type: 'boolean',
            description:
              'False means the cached balance has drifted from the journal — the loudest alarm here.',
          },
        },
      },
      Transaction: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          fromAccount: { type: 'string' },
          toAccount: { type: 'string' },
          amount: money,
          currency: { type: 'string' },
          type: { type: 'string', enum: ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL'] },
          status: {
            type: 'string',
            enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED'],
            description: 'PENDING is an uncaptured hold. Nothing has moved and no journal entries exist yet.',
          },
          reference: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time', description: 'Set on a hold' },
          completedAt: { type: 'string', format: 'date-time' },
        },
      },
      LedgerEntry: {
        type: 'object',
        description: 'One side of a double-entry pair. Append-only: updates and deletes are refused.',
        properties: {
          _id: { type: 'string' },
          transactionId: { type: 'string' },
          accountId: { type: 'string' },
          entryType: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
          amount: money,
          currency: { type: 'string' },
          balanceAfter: { type: 'integer', description: 'Account balance immediately after this entry' },
        },
      },
      AuditLog: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          actorEmail: { type: 'string' },
          action: {
            type: 'string',
            enum: ['TRANSACTION_REVERSED', 'ACCOUNT_FROZEN', 'ACCOUNT_UNFROZEN', 'ACCOUNT_CLOSED'],
          },
          targetType: { type: 'string', enum: ['ACCOUNT', 'TRANSACTION'] },
          targetId: { type: 'string' },
          requestId: { type: 'string' },
          reason: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        security: [],
        summary: 'Create a user',
        description:
          'Issues a single-use email verification link. While mail is mocked the link is returned in `verification`; production never includes it.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: {
                    type: 'string',
                    minLength: 10,
                    description: 'At least 10 characters with upper and lower case, a digit and a symbol.',
                  },
                  name: { type: 'string' },
                  phone: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: ok({
                  type: 'object',
                  properties: {
                    userId: { type: 'string' },
                    email: { type: 'string' },
                    emailVerified: { type: 'boolean' },
                    verification: {
                      type: 'object',
                      description: 'Present only while mail is mocked.',
                      properties: {
                        link: { type: 'string' },
                        expiresAt: { type: 'string', format: 'date-time' },
                        delivery: { type: 'string', enum: ['mock'] },
                      },
                    },
                  },
                }),
              },
            },
          },
          ...responses(),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        security: [],
        summary: 'Exchange credentials for tokens',
        description:
          'Wrong password and unknown email return an identical 401, and an unknown user still pays the bcrypt cost, so timing does not enumerate accounts. Five failures lock the account for 15 minutes.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Signed in',
            content: {
              'application/json': {
                schema: ok({
                  type: 'object',
                  properties: {
                    accessToken: { type: 'string' },
                    refreshToken: { type: 'string' },
                    expiresIn: { type: 'integer' },
                  },
                }),
              },
            },
          },
          ...responses(),
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        security: [],
        summary: 'Rotate the refresh token',
        description:
          'Refresh tokens are single-use. Presenting a consumed one is treated as a leak and revokes every session for that user.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'New token pair' }, ...responses() },
      },
    },
    '/auth/verify-email': {
      post: {
        tags: ['Auth'],
        security: [],
        summary: 'Confirm an address with a single-use token',
        description:
          'Expired, already used and never issued all return the same 400, so tokens cannot be probed.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
            },
          },
        },
        responses: { '200': { description: 'Verified' }, ...responses() },
      },
    },
    '/auth/resend-verification': {
      post: {
        tags: ['Auth'],
        security: [],
        summary: 'Re-issue the verification link',
        description:
          'Always 200, whether or not the address is registered, so it cannot be used to enumerate accounts. Supersedes any earlier unused link.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
            },
          },
        },
        responses: { '200': { description: 'Accepted' }, ...responses() },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the current session',
        description:
          'Deny-lists the access token for its remaining lifetime. `allDevices` revokes everything.',
        responses: { '200': { description: 'Revoked' }, ...responses() },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Caller profile',
        responses: { '200': { description: 'Profile' }, ...responses() },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password and kill every session',
        responses: { '200': { description: 'Changed' }, ...responses() },
      },
    },

    '/accounts': {
      post: {
        tags: ['Accounts'],
        summary: 'Open an account',
        description:
          'The account number is generated server-side and the opening balance is always zero. A balance in the request body is ignored.',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['accountType'],
                properties: {
                  accountType: { type: 'string', enum: ['SAVINGS', 'CURRENT', 'WALLET'] },
                  currency: { type: 'string', enum: config.supportedCurrencies },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Opened',
            content: { 'application/json': { schema: ok({ $ref: '#/components/schemas/Account' }) } },
          },
          ...responses(),
        },
      },
      get: {
        tags: ['Accounts'],
        summary: "List the caller's accounts",
        parameters: [...pagination],
        responses: { '200': { description: 'Accounts' }, ...responses() },
      },
    },
    '/accounts/{id}': {
      get: {
        tags: ['Accounts'],
        summary: 'One account',
        parameters: [idParam('id', 'Account id')],
        responses: {
          '200': {
            description: 'Account',
            content: { 'application/json': { schema: ok({ $ref: '#/components/schemas/Account' }) } },
          },
          ...responses(),
        },
      },
      patch: {
        tags: ['Accounts'],
        summary: 'Update metadata',
        description: 'Only `metadata` is writable. Balances move exclusively through ledger transactions.',
        parameters: [idParam('id', 'Account id')],
        responses: { '200': { description: 'Updated' }, ...responses() },
      },
      delete: {
        tags: ['Accounts'],
        summary: 'Close the account',
        description: 'Refused while the account still holds a balance.',
        parameters: [idParam('id', 'Account id')],
        responses: { '200': { description: 'Closed' }, ...responses() },
      },
    },
    '/accounts/{id}/balance': {
      get: {
        tags: ['Accounts'],
        summary: 'Balance with a live ledger reconciliation',
        parameters: [idParam('id', 'Account id')],
        responses: {
          '200': {
            description: 'Balance report',
            content: { 'application/json': { schema: ok({ $ref: '#/components/schemas/BalanceReport' }) } },
          },
          ...responses(),
        },
      },
    },
    '/accounts/{id}/freeze': {
      post: {
        tags: ['Accounts'],
        summary: 'Freeze an account',
        parameters: [idParam('id', 'Account id')],
        responses: { '200': { description: 'Frozen' }, ...responses() },
      },
    },
    '/accounts/{id}/unfreeze': {
      post: {
        tags: ['Accounts'],
        summary: 'Unfreeze an account (admin only)',
        description:
          'A user may freeze their own account but not unfreeze it — otherwise freezing for suspected fraud would be meaningless.',
        parameters: [idParam('id', 'Account id')],
        responses: { '200': { description: 'Unfrozen' }, ...responses() },
      },
    },
    '/accounts/user/{userId}': {
      get: {
        tags: ['Accounts'],
        summary: "A user's accounts (self, or admin)",
        parameters: [idParam('userId', 'User id'), ...pagination],
        responses: { '200': { description: 'Accounts' }, ...responses() },
      },
    },

    '/transactions': {
      post: {
        tags: ['Transactions'],
        summary: 'Transfer between two accounts',
        description:
          'Atomic: the two balance updates, the transaction record and both journal entries commit together or not at all. The balance check lives inside the update filter, so concurrent debits cannot both succeed.',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fromAccount', 'toAccount', 'amount'],
                properties: {
                  fromAccount: { type: 'string' },
                  toAccount: { type: 'string' },
                  amount: money,
                  reference: { type: 'string', maxLength: 140 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Completed',
            content: { 'application/json': { schema: ok({ $ref: '#/components/schemas/Transaction' }) } },
          },
          ...responses(),
        },
      },
    },
    '/transactions/deposit': {
      post: {
        tags: ['Transactions'],
        summary: 'Money in',
        description:
          "Debits the bank's per-currency contra account so total debits still equal total credits. Admin-only unless ALLOW_SELF_DEPOSIT is set.",
        parameters: [idempotencyHeader],
        responses: { '201': { description: 'Completed' }, ...responses() },
      },
    },
    '/transactions/withdraw': {
      post: {
        tags: ['Transactions'],
        summary: 'Money out',
        parameters: [idempotencyHeader],
        responses: { '201': { description: 'Completed' }, ...responses() },
      },
    },
    '/transactions/authorize': {
      post: {
        tags: ['Transactions'],
        summary: 'Place a hold',
        description:
          'Reserves funds without moving them: `availableBalance` drops, `balance` does not, and **no journal entries are written**. Nothing has happened in accounting terms until the hold is captured.',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fromAccount', 'toAccount', 'amount'],
                properties: {
                  fromAccount: { type: 'string' },
                  toAccount: { type: 'string' },
                  amount: money,
                  expiresInSeconds: { type: 'integer', minimum: 1, maximum: 2592000, default: 604800 },
                  reference: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Hold placed (status PENDING)' }, ...responses() },
      },
    },
    '/transactions/{id}/capture': {
      post: {
        tags: ['Transactions'],
        summary: 'Settle a hold',
        description:
          'The reserved funds move and the journal entries are written. An expired hold can only be voided.',
        parameters: [idParam('id', 'Hold (transaction) id')],
        responses: { '200': { description: 'Captured' }, ...responses() },
      },
    },
    '/transactions/{id}/void': {
      post: {
        tags: ['Transactions'],
        summary: 'Release a hold',
        description: 'Returns the reservation. No money ever moved, so no journal entries are involved.',
        parameters: [idParam('id', 'Hold (transaction) id')],
        responses: { '200': { description: 'Released' }, ...responses() },
      },
    },
    '/transactions/{id}': {
      get: {
        tags: ['Transactions'],
        summary: 'One transaction',
        description: 'Visible to an admin, the initiator, or either counterparty owner.',
        parameters: [idParam('id', 'Transaction id')],
        responses: { '200': { description: 'Transaction' }, ...responses() },
      },
    },
    '/transactions/account/{id}': {
      get: {
        tags: ['Transactions'],
        summary: 'Statement for an owned account',
        parameters: [idParam('id', 'Account id'), ...pagination],
        responses: { '200': { description: 'Transactions' }, ...responses() },
      },
    },
    '/transactions/{id}/reverse': {
      post: {
        tags: ['Transactions'],
        summary: 'Reverse a completed transaction (admin only)',
        description:
          'Writes a new opposite transaction and marks the original REVERSED. Nothing is edited or deleted — that is what keeps the audit trail trustworthy. A transaction can only be reversed once.',
        parameters: [idParam('id', 'Transaction id')],
        responses: { '201': { description: 'Reversal created' }, ...responses() },
      },
    },

    '/ledger/accounts/{accountId}': {
      get: {
        tags: ['Ledger'],
        summary: 'Journal entries for an owned account',
        parameters: [idParam('accountId', 'Account id'), ...pagination],
        responses: {
          '200': {
            description: 'Entries',
            content: {
              'application/json': {
                schema: ok({ type: 'array', items: { $ref: '#/components/schemas/LedgerEntry' } }),
              },
            },
          },
          ...responses(),
        },
      },
    },
    '/ledger/accounts/{accountId}/reconcile': {
      get: {
        tags: ['Ledger'],
        summary: 'Cached balance against the journal',
        parameters: [idParam('accountId', 'Account id')],
        responses: { '200': { description: 'Balance report' }, ...responses() },
      },
    },
    '/ledger/transactions/{transactionId}': {
      get: {
        tags: ['Ledger'],
        summary: 'Both legs of one transaction',
        parameters: [idParam('transactionId', 'Transaction id')],
        responses: { '200': { description: 'Entries' }, ...responses() },
      },
    },
    '/ledger/verify': {
      get: {
        tags: ['Ledger'],
        summary: 'System-wide double-entry check (admin only)',
        description:
          'Sums every journal entry in the database. Total debits must equal total credits; 500 if they do not.',
        responses: { '200': { description: 'Balanced' }, ...responses() },
      },
    },

    '/admin/audit-logs': {
      get: {
        tags: ['Admin'],
        summary: 'Privileged actions, newest first',
        description: 'Append-only: the collection refuses updates and deletes.',
        parameters: [...pagination],
        responses: {
          '200': {
            description: 'Entries',
            content: {
              'application/json': {
                schema: ok({ type: 'array', items: { $ref: '#/components/schemas/AuditLog' } }),
              },
            },
          },
          ...responses(),
        },
      },
    },
  },
} as const;
