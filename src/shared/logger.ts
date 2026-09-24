import pino from 'pino';
import { config } from './config/app.config';

/**
 * Structured logging.
 *
 * Production emits newline-delimited JSON, which is what log shippers and
 * query tools expect; development gets a human-readable stream. Every line
 * carries the request id, so a customer complaint can be traced to the exact
 * request that produced it.
 */
/**
 * Human-readable output, but only when pino-pretty is actually installed.
 *
 * It is a devDependency, so a production image built with `--omit=dev` does not
 * have it. Asking pino for a transport that cannot be resolved throws at
 * startup — a logger must never be the thing that takes the process down, so
 * this degrades to JSON instead.
 */
function prettyTransport() {
  if (config.isProduction || process.env.LOG_PRETTY === 'false') return undefined;

  try {
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }

  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' },
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (config.isProduction ? 'info' : 'debug'),

  // A banking API's logs are a disclosure risk in their own right. Anything
  // that could carry a credential or a token is replaced rather than trimmed.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-idempotency-key"]',
      'res.headers["set-cookie"]',
      'password',
      'newPassword',
      'currentPassword',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
    ],
    censor: '[redacted]',
  },

  base: { service: 'ledger-api', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,

  transport: prettyTransport(),
});

/** A child logger bound to one request id. */
export function requestLogger(requestId?: string) {
  return requestId ? logger.child({ requestId }) : logger;
}
