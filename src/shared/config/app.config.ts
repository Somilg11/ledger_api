import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

/**
 * Reads a secret from the environment.
 * In production a missing or weak value is a hard failure: a predictable JWT
 * signing key lets anyone mint tokens for any account.
 */
function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    if (isProduction) {
      throw new Error(`${name} must be set to a random string of at least 32 characters in production`);
    }
    // Development fallback: random per boot, so nothing can be signed offline.
    const generated = crypto.randomBytes(48).toString('hex');
    // The logger reads this config, so it cannot exist yet. This is the one
    // place in the codebase that legitimately writes to the console.
    console.warn(`[config] ${name} missing or too short - generated an ephemeral development value`);
    return generated;
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  env: NODE_ENV,
  isProduction,
  port: intEnv('PORT', 3000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ledger',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Access and refresh tokens are signed with different keys so an access
  // token can never be replayed as a refresh token.
  jwtSecret: requiredSecret('JWT_SECRET'),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET
    ? requiredSecret('JWT_REFRESH_SECRET')
    : requiredSecret('JWT_SECRET') + ':refresh',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpiresIn: process.env.REFRESH_EXPIRES_IN || '7d',
  jwtIssuer: process.env.JWT_ISSUER || 'ledger-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'ledger-api-clients',

  bcryptRounds: intEnv('BCRYPT_ROUNDS', 12),

  /** Serve the interactive OpenAPI reference at /docs. */
  enableApiDocs: process.env.ENABLE_API_DOCS !== 'false',

  /**
   * Mail is mocked: nothing is delivered, and verification links are handed
   * back in the API response so the simulation console can show them.
   *
   * This is a development affordance and a serious hole if it ever ships —
   * anyone who can call /auth/register for an address would receive that
   * address's verification link. Production therefore cannot turn it on, no
   * matter what the environment says.
   */
  mockEmail: !isProduction && process.env.MOCK_EMAIL !== 'false',

  /** Base URL the console is served from, used to build action links. */
  appUrl: process.env.APP_URL || 'http://localhost:8080',

  emailVerification: {
    tokenTtlSeconds: intEnv('EMAIL_VERIFICATION_TTL_SECONDS', 24 * 60 * 60),
    /**
     * When true, an unverified user cannot move money. Off by default so the
     * simulation is usable immediately; a real deployment would turn it on.
     */
    required: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  },

  // Behind a load balancer set TRUST_PROXY to the number of proxy hops so
  // req.ip is the real client and cannot be spoofed via X-Forwarded-For.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,

  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  rateLimit: {
    windowSeconds: intEnv('RATE_LIMIT_WINDOW_SECONDS', 60),
    max: intEnv('RATE_LIMIT_MAX', 100),
    authMax: intEnv('RATE_LIMIT_AUTH_MAX', 10),
    authWindowSeconds: intEnv('RATE_LIMIT_AUTH_WINDOW_SECONDS', 300),
  },

  limits: {
    // Money is handled in minor units (paise/cents) as integers only.
    maxTransferMinorUnits: intEnv('MAX_TRANSFER_MINOR_UNITS', 100_000_000), // 10,00,000.00
    maxPageSize: intEnv('MAX_PAGE_SIZE', 100),
    maxFailedLogins: intEnv('MAX_FAILED_LOGINS', 5),
    loginLockSeconds: intEnv('LOGIN_LOCK_SECONDS', 900),
  },

  supportedCurrencies: (process.env.SUPPORTED_CURRENCIES || 'INR,USD,EUR,GBP')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
};
