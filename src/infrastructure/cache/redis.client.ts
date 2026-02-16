import Redis from 'ioredis';
import { config } from '../../shared/config/app.config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = config.redisUrl || 'redis://localhost:6379';
    redisClient = new Redis(redisUrl);
    
    redisClient.on('connect', () => {
      // eslint-disable-next-line no-console
      console.log('Connected to Redis');
    });
    
    redisClient.on('error', (err: Error) => {
      // eslint-disable-next-line no-console
      console.error('Redis connection error:', err);
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
