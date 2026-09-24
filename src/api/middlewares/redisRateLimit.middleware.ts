import { Request, RequestHandler } from 'express';
import {
  RateLimiterRedis,
  RateLimiterRes,
  RateLimiterMemory,
  RateLimiterAbstract,
} from 'rate-limiter-flexible';
import { getRedisClient } from '../../infrastructure/cache/redis.client';
import { config } from '../../shared/config/app.config';
import { logger } from '../../shared/logger';
import { AuthRequest } from './auth.middleware';

function build(keyPrefix: string, points: number, duration: number): RateLimiterAbstract {
  try {
    return new RateLimiterRedis({
      storeClient: getRedisClient(),
      keyPrefix,
      points,
      duration,
      // If Redis is unreachable, fall back to an in-process counter instead of
      // rejecting everything. A rate limiter must never become the outage.
      insuranceLimiter: new RateLimiterMemory({ keyPrefix: `${keyPrefix}_mem`, points, duration }),
    });
  } catch {
    return new RateLimiterMemory({ keyPrefix, points, duration });
  }
}

const globalLimiter = build('rl_global', config.rateLimit.max, config.rateLimit.windowSeconds);
const authLimiter = build('rl_auth', config.rateLimit.authMax, config.rateLimit.authWindowSeconds);

function makeHandler(limiter: RateLimiterAbstract, keyOf: (req: Request) => string): RequestHandler {
  return (req, res, next) => {
    limiter
      .consume(keyOf(req), 1)
      .then((result) => {
        res.setHeader('RateLimit-Remaining', String(result.remainingPoints));
        next();
      })
      .catch((rejection: RateLimiterRes | Error) => {
        if (rejection instanceof Error) {
          // A limiter failure is an infrastructure problem, not a client one.
          logger.error({ err: rejection.message }, 'rate limiter unavailable, allowing request');
          return next();
        }
        const retryAfter = Math.ceil(rejection.msBeforeNext / 1000) || 1;
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests', retryAfter },
        });
      });
  };
}

/** Per-IP budget for the whole API. */
export const redisRateLimiter = makeHandler(globalLimiter, (req) => req.ip || 'unknown');

/**
 * Much tighter budget for credential endpoints, keyed by IP *and* the email
 * being tried, so one attacker cannot lock out every user from a shared IP.
 */
export const authRateLimiter = makeHandler(authLimiter, (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 120) : '';
  return `${req.ip || 'unknown'}:${email}`;
});

/** Per-user budget for money movement, on top of the per-IP limit. */
export const transactionRateLimiter = makeHandler(
  build('rl_txn', config.rateLimit.max, config.rateLimit.windowSeconds),
  (req) => (req as AuthRequest).user?.id || req.ip || 'unknown'
);
