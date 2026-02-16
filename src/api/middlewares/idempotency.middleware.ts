import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../../infrastructure/cache/cache.service';

const cacheService = new CacheService();

export interface IdempotencyRequest extends Request {
  idempotencyKey?: string;
}

export function idempotencyMiddleware(req: IdempotencyRequest, res: Response, next: NextFunction) {
  // Only apply to mutation operations
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const idempotencyKey = req.header('X-Idempotency-Key');
  
  if (!idempotencyKey) {
    // For now, allow requests without idempotency key (can be made required later)
    return next();
  }

  req.idempotencyKey = idempotencyKey;

  // Check if this key was already processed
  const cacheKey = `idempotency:${idempotencyKey}`;
  
  cacheService
    .get(cacheKey)
    .then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached response
        const parsed = JSON.parse(cachedResponse);
        return res.status(parsed.statusCode || 200).json(parsed.body);
      }

      // Store a processing flag
      return cacheService.setIfNotExists(`${cacheKey}:processing`, '1', 60).then((wasSet) => {
        if (!wasSet) {
          // Another request is processing this key
          return res.status(409).json({
            success: false,
            error: {
              code: 'DUPLICATE_REQUEST',
              message: 'Request with this idempotency key is currently being processed',
            },
          });
        }

        // Intercept response to cache it
        const originalJson = res.json.bind(res);
        res.json = function (body: any) {
          // Cache the response for 24 hours
          const responseData = { statusCode: res.statusCode, body };
          cacheService.set(cacheKey, JSON.stringify(responseData), 86400).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('Failed to cache idempotency response:', err);
          });
          
          // Remove processing flag
          cacheService.del(`${cacheKey}:processing`).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('Failed to remove processing flag:', err);
          });

          return originalJson(body);
        };

        next();
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Idempotency middleware error:', err);
      // On cache error, continue with request (fail open)
      next();
    });
}
