import { getRedisClient } from './redis.client';

export class CacheService {
  private redis = getRedisClient();

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, value);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /** Release only the lock we acquired, never a successor after our TTL expired. */
  async delIfValue(key: string, value: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      value
    );
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  async setIfNotExists(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    // Acquire and expire atomically: a crash between SETNX and EXPIRE must
    // never leave a permanent lock.
    if (ttlSeconds) {
      return (await this.redis.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
    }
    return (await this.redis.setnx(key, value)) === 1;
  }
}
