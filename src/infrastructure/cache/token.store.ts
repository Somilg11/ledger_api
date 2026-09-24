import { getRedisClient } from './redis.client';

/**
 * Redis-backed token lifecycle store.
 *
 * Stateless JWTs cannot be revoked on their own, so a banking API needs a
 * server-side record: refresh tokens are allow-listed (one live jti per
 * session, rotated on every use) and revoked access tokens are deny-listed
 * until their natural expiry.
 */
export class TokenStore {
  /**
   * Resolved on first use rather than at construction. Creating the client in
   * a field initialiser opened a Redis socket merely by importing this module,
   * which made the file unusable from anything that is not a running server.
   */
  private get redis() {
    return getRedisClient();
  }

  private refreshKey(userId: string, jti: string) {
    return `auth:refresh:${userId}:${jti}`;
  }

  private denyKey(jti: string) {
    return `auth:denied:${jti}`;
  }

  async registerRefreshToken(userId: string, jti: string, ttlSeconds: number): Promise<void> {
    await this.redis.setex(this.refreshKey(userId, jti), ttlSeconds, '1');
  }

  async isRefreshTokenActive(userId: string, jti: string): Promise<boolean> {
    const found = await this.redis.get(this.refreshKey(userId, jti));
    return found === '1';
  }

  /**
   * Atomically consumes a refresh token. Returns false if it was already used,
   * which is the signal for refresh-token replay.
   */
  async consumeRefreshToken(userId: string, jti: string): Promise<boolean> {
    const removed = await this.redis.del(this.refreshKey(userId, jti));
    return removed === 1;
  }

  async revokeAllRefreshTokens(userId: string): Promise<number> {
    const pattern = this.refreshKey(userId, '*');
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        removed += await this.redis.del(...keys);
      }
    } while (cursor !== '0');
    return removed;
  }

  async denyAccessToken(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.redis.setex(this.denyKey(jti), ttlSeconds, '1');
  }

  async isAccessTokenDenied(jti: string): Promise<boolean> {
    const found = await this.redis.get(this.denyKey(jti));
    return found === '1';
  }
}

export const tokenStore = new TokenStore();
