import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedisClient } from '../../infrastructure/cache/redis.client';

const redisClient = getRedisClient();

// Create Redis-backed rate limiter
const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'rate_limit',
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
});

export function redisRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'unknown';
  
  rateLimiter
    .consume(key, 1)
    .then(() => {
      next();
    })
    .catch(() => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
        },
      });
    });
}
