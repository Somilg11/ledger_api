/** Typed client for the Ledger API. Mirrors docs/api-reference.md. */

const BASE = '/api/v1';

// ── Wire types ────────────────────────────────────────────────────────────
export type AccountType = 'SAVINGS' | 'CURRENT' | 'WALLET';
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';
export type TransactionType = 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL';
export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REVERSED';
export type EntryType = 'DEBIT' | 'CREDIT';

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  roles: string[];
  status: string;
  emailVerified?: boolean;
}

/**
 * Present only while the API has mail mocked. It carries the link that a real
 * deployment would have emailed, so the simulation can show it instead.
 */
export interface MockVerification {
  link: string;
  expiresAt: string;
  delivery: 'mock';
}

export interface RegisterResult {
  userId: string;
  email: string;
  status: string;
  emailVerified: boolean;
  verification?: MockVerification;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

export interface Account {
  _id: string;
  userId: string;
  accountNumber: string;
  accountType: AccountType;
  currency: string;
  balance: number;
  availableBalance: number;
  status: AccountStatus;
  isSystem?: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface BalanceReport {
  accountId: string;
  accountNumber: string;
  currency: string;
  balance: number;
  availableBalance: number;
  ledgerBalance: number;
  totalDebits: number;
  totalCredits: number;
  reconciled: boolean;
}

export interface Transaction {
  _id: string;
  fromAccount?: string;
  toAccount?: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: TransactionType;
  initiatedBy?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
  /** Set on a hold: after this the reservation can no longer be captured. */
  expiresAt?: string;
}

export interface AuditLog {
  _id: string;
  actorId: string;
  actorEmail?: string;
  action: 'TRANSACTION_REVERSED' | 'ACCOUNT_FROZEN' | 'ACCOUNT_UNFROZEN' | 'ACCOUNT_CLOSED';
  targetType: 'ACCOUNT' | 'TRANSACTION';
  targetId: string;
  requestId?: string;
  ip?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface LedgerEntry {
  _id: string;
  transactionId: string;
  accountId: string;
  entryType: EntryType;
  amount: number;
  currency: string;
  balanceAfter: number;
  createdAt: string;
}

export interface VerifyResult {
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
}

// ── Errors ────────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from the server's validation details, if any. */
  get fieldErrors(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details
      .filter((d): d is { field?: string; message: string } => Boolean(d) && typeof d === 'object')
      .map((d) => (d.field ? `${d.field}: ${d.message}` : d.message));
  }
}

// ── Token storage ─────────────────────────────────────────────────────────
const STORAGE_KEY = 'ledger.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export function loadSession(): StoredSession | null {
  try {
    // Remove the legacy persistent token copy; sessions are now scoped to a tab.
    localStorage.removeItem(STORAGE_KEY);
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof value.accessToken !== 'string' ||
      typeof value.refreshToken !== 'string' ||
      !value.user ||
      typeof value.user.id !== 'string' ||
      typeof value.user.email !== 'string' ||
      !Array.isArray(value.user.roles) ||
      !value.user.roles.every((role) => typeof role === 'string')
    ) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return value as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession | null) {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private-browsing mode; the session simply does not survive a reload.
  }
}

let session: StoredSession | null = loadSession();
let onSessionLost: (() => void) | null = null;

export function setSession(next: StoredSession | null) {
  session = next;
  saveSession(next);
}

export function getSession(): StoredSession | null {
  return session;
}

export function onUnauthenticated(handler: () => void) {
  onSessionLost = handler;
}

// ── Request plumbing ──────────────────────────────────────────────────────
interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
  /** Internal: prevents an infinite refresh loop. */
  retrying?: boolean;
}

export function newIdempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the access token at most once at a time. Several requests hitting
 * 401 together must not each consume a refresh token - the API treats a reused
 * refresh token as a leak and revokes every session.
 */
async function refreshTokens(): Promise<boolean> {
  if (!session) return false;
  const originalSession = session;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: originalSession.refreshToken }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok || session !== originalSession) return false;

      const payload = await res.json();
      if (
        session !== originalSession ||
        typeof payload.data?.accessToken !== 'string' ||
        typeof payload.data?.refreshToken !== 'string'
      )
        return false;
      setSession({
        ...originalSession,
        accessToken: payload.data.accessToken,
        refreshToken: payload.data.refreshToken,
      });
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Browser-visible request metadata only: never bodies, credentials, or tokens. */
export interface ApiTrace {
  id: string;
  phase: 'request' | 'response' | 'network-error';
  method: string;
  path: string;
  time: number;
  status?: number;
  durationMs?: number;
  requestId?: string;
}

const traceListeners = new Set<(event: ApiTrace) => void>();
export function subscribeApiTrace(listener: (event: ApiTrace) => void): () => void {
  traceListeners.add(listener);
  return () => {
    traceListeners.delete(listener);
  };
}

function trace(event: ApiTrace) {
  if (event.path.startsWith('/auth/')) return;
  for (const listener of traceListeners) {
    // Observability must never change whether a payment succeeds.
    try {
      listener(event);
    } catch {
      /* Ignore a failed observer. */
    }
  }
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, auth = true, retrying = false } = options;

  const requestSession = session;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && requestSession) headers.Authorization = `Bearer ${requestSession.accessToken}`;
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const traceId = crypto.randomUUID();
  const started = Date.now();
  trace({ id: traceId, phase: 'request', method, path, time: started });
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    trace({
      id: traceId,
      phase: 'network-error',
      method,
      path,
      time: Date.now(),
      durationMs: Date.now() - started,
    });
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach Ledger. Check that the API is running, then retry with the same payment key.'
    );
  }

  trace({
    id: traceId,
    phase: 'response',
    method,
    path,
    time: Date.now(),
    status: res.status,
    durationMs: Date.now() - started,
    requestId: res.headers.get('X-Request-Id') ?? undefined,
  });

  if (res.status === 401 && auth && session !== requestSession) {
    throw new ApiError(
      401,
      'SESSION_CHANGED',
      'Your session changed. Review the current account before retrying.'
    );
  }
  if (res.status === 401 && auth && session && !retrying) {
    if (await refreshTokens()) {
      return request<T>(method, path, { ...options, retrying: true });
    }
    if (session === requestSession) {
      setSession(null);
      onSessionLost?.();
    }
  }

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      res.status,
      'INVALID_RESPONSE',
      'Ledger returned an unreadable response. Check the API or proxy, then retry with the same payment key.'
    );
  }

  if (!res.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      res.status,
      error.code ?? 'UNKNOWN',
      error.message ?? res.statusText,
      error.details,
      error.requestId
    );
  }

  return payload?.data as T;
}

// ── Endpoints ─────────────────────────────────────────────────────────────
export const api = {
  health: () => fetch('/health').then((r) => r.json()),
  ready: () =>
    fetch('/ready', { signal: AbortSignal.timeout(5000) }).then(async (r) => ({
      ok: r.ok,
      body: await r.json(),
    })),

  auth: {
    register: (body: { email: string; password: string; name?: string; phone?: string }) =>
      request<RegisterResult>('POST', '/auth/register', { body, auth: false }),

    verifyEmail: (token: string) =>
      request<{ verified: true; email: string }>('POST', '/auth/verify-email', {
        body: { token },
        auth: false,
      }),

    resendVerification: (email: string) =>
      request<{ sent: true; verification?: MockVerification }>('POST', '/auth/resend-verification', {
        body: { email },
        auth: false,
      }),

    login: (body: { email: string; password: string }) =>
      request<LoginResult>('POST', '/auth/login', { body, auth: false }),

    me: () => request<SessionUser & { emailVerified: boolean; createdAt: string }>('GET', '/auth/me'),

    logout: (refreshToken?: string, allDevices = false) =>
      request<{ revoked: boolean }>('POST', '/auth/logout', { body: { refreshToken, allDevices } }),

    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      request<{ changed: boolean }>('POST', '/auth/change-password', { body }),
  },

  accounts: {
    list: () => request<Account[]>('GET', '/accounts'),
    get: (id: string) => request<Account>('GET', `/accounts/${id}`),
    balance: (id: string) => request<BalanceReport>('GET', `/accounts/${id}/balance`),

    create: (body: { accountType: AccountType; currency: string }, idempotencyKey?: string) =>
      request<Account>('POST', '/accounts', { body, idempotencyKey }),

    setMetadata: (id: string, metadata: Record<string, unknown>) =>
      request<Account>('PATCH', `/accounts/${id}`, { body: { metadata } }),

    freeze: (id: string) => request<Account>('POST', `/accounts/${id}/freeze`),
    unfreeze: (id: string) => request<Account>('POST', `/accounts/${id}/unfreeze`),
    close: (id: string) => request<Account>('DELETE', `/accounts/${id}`),
  },

  transactions: {
    transfer: (
      body: { fromAccount: string; toAccount: string; amount: number; reference?: string },
      idempotencyKey?: string
    ) => request<Transaction>('POST', '/transactions', { body, idempotencyKey }),

    deposit: (body: { accountId: string; amount: number; reference?: string }, idempotencyKey?: string) =>
      request<Transaction>('POST', '/transactions/deposit', { body, idempotencyKey }),

    withdraw: (body: { accountId: string; amount: number; reference?: string }, idempotencyKey?: string) =>
      request<Transaction>('POST', '/transactions/withdraw', { body, idempotencyKey }),

    authorize: (
      body: {
        fromAccount: string;
        toAccount: string;
        amount: number;
        reference?: string;
        expiresInSeconds?: number;
      },
      idempotencyKey?: string
    ) => request<Transaction>('POST', '/transactions/authorize', { body, idempotencyKey }),

    capture: (id: string) => request<Transaction>('POST', `/transactions/${id}/capture`),

    voidHold: (id: string, reason?: string) =>
      request<Transaction>('POST', `/transactions/${id}/void`, { body: { reason } }),

    get: (id: string) => request<Transaction>('GET', `/transactions/${id}`),

    listByAccount: (accountId: string, limit = 50, skip = 0) =>
      request<Transaction[]>('GET', `/transactions/account/${accountId}?limit=${limit}&skip=${skip}`),

    reverse: (id: string, reason?: string) =>
      request<Transaction>('POST', `/transactions/${id}/reverse`, { body: { reason } }),
  },

  ledger: {
    byAccount: (accountId: string, limit = 50, skip = 0) =>
      request<LedgerEntry[]>('GET', `/ledger/accounts/${accountId}?limit=${limit}&skip=${skip}`),

    byTransaction: (transactionId: string) =>
      request<LedgerEntry[]>('GET', `/ledger/transactions/${transactionId}`),

    reconcile: (accountId: string) =>
      request<BalanceReport>('GET', `/ledger/accounts/${accountId}/reconcile`),

    verify: () => request<VerifyResult>('GET', '/ledger/verify'),
  },

  admin: {
    auditLogs: (limit = 50, skip = 0) =>
      request<AuditLog[]>('GET', `/admin/audit-logs?limit=${limit}&skip=${skip}`),
  },
};
