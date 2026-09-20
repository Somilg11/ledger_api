import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { AuthRequest } from './auth.middleware';
import { ConflictError, ValidationError } from '../../shared/errors';

const cache = new CacheService();

const RESPONSE_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_SECONDS = 60;

export interface IdempotentRequest extends AuthRequest {
  idempotencyKey?: string;
}

function fingerprint(req: IdempotentRequest, key: string): string {
  // The cache key is bound to the caller, the route and the exact payload.
  // A global key space would let one client replay another client's key and
  // be handed their cached response, tokens and all.
  const identity = req.user?.id ?? `ip:${req.ip ?? 'unknown'}`;
  const body = JSON.stringify(req.body ?? {});
  return crypto
    .createHash('sha256')
    .update([identity, req.method, req.baseUrl + req.path, key, body].join('\n'))
    .digest('hex');
}

/**
 * Replay protection for mutating requests.
 *
 * Mount this *after* authentication so the key is scoped to a known caller.
 * Only successful (2xx) responses are replayed - a cached 500 would make a
 * transient failure permanent for 24 hours.
 */
export function idempotencyMiddleware(req: IdempotentRequest, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const key = req.header('X-Idempotency-Key');
  if (!key) return next();

  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    return next(new ValidationError('X-Idempotency-Key must be 1-128 characters of [A-Za-z0-9._:-]'));
  }

  req.idempotencyKey = key;

  const hash = fingerprint(req, key);
  const responseKey = `idemp:res:${hash}`;
  const lockKey = `idemp:lock:${hash}`;
  const ownerKey = `idemp:owner:${req.user?.id ?? 'anon'}:${key}`;

  (async () => {
    const cached = await cache.get(responseKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { statusCode: number; body: unknown };
      res.setHeader('X-Idempotent-Replay', 'true');
      res.status(parsed.statusCode).json(parsed.body);
      return;
    }

    // Same key, different payload: the client has a bug and must not be given
    // a response that does not match what it just asked for.
    const previousHash = await cache.get(ownerKey);
    if (previousHash && previousHash !== hash) {
      throw new ConflictError('This idempotency key was already used with a different request payload');
    }

    const acquired = await cache.setIfNotExists(lockKey, '1', LOCK_TTL_SECONDS);
    if (!acquired) {
      throw new ConflictError('A request with this idempotency key is already in flight');
    }

    await cache.set(ownerKey, hash, RESPONSE_TTL_SECONDS);

    const originalJson = res.json.bind(res);
    let stored = false;

    res.json = (body: unknown) => {
      if (!stored) {
        stored = true;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          void cache
            .set(responseKey, JSON.stringify({ statusCode: res.statusCode, body }), RESPONSE_TTL_SECONDS)
            .catch(() => undefined);
        }
      }
      return originalJson(body);
    };

    // The lock is released once the response is fully written, including on
    // error paths and aborted connections - otherwise a crash would block the
    // key for the whole lock TTL.
    res.on('finish', () => void cache.del(lockKey).catch(() => undefined));
    res.on('close', () => void cache.del(lockKey).catch(() => undefined));

    next();
  })().catch(next);
}
