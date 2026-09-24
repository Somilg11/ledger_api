import Redis from 'ioredis';
import { config } from '../../shared/config/app.config';
import { logger } from '../../shared/logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      // Exponential-ish backoff, capped, so a Redis restart does not turn into
      // a reconnect storm.
      retryStrategy: (times) => Math.min(times * 200, 5_000),
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      logger.info('connected to Redis');
    });

    redisClient.on('error', (err: Error) => {
      logger.error({ err: err.message }, 'redis error');
    });
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
