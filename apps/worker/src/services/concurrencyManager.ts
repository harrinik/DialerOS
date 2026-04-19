/**
 * ConcurrencyManager
 *
 * ISSUE-02 fix: Concurrency limit is now READ FROM REDIS (set by the worker at job start).
 * This eliminates the race condition where two replicas pass different limits to the Lua script.
 * All workers share a single authoritative limit value per campaign.
 */
import type { Redis } from 'ioredis';
import { REDIS_KEYS } from '@dialer/shared';
import { logger } from '../lib/logger.js';

export class ConcurrencyManager {
  constructor(private readonly redis: Redis) {}

  /**
   * Try to acquire a concurrency slot for a campaign.
   * Reads the limit from Redis (set by dialerWorker before calling this).
   * Returns true if acquired, false if at limit or limit not yet set.
   */
  async tryAcquire(campaignId: string): Promise<boolean> {
    const semKey   = REDIS_KEYS.CAMPAIGN_SEMAPHORE(campaignId);
    const limitKey = `campaign:limit:${campaignId}`;

    // ISSUE-02: Lua reads limit from Redis — single authoritative value across all replicas
    const luaScript = `
      local limit = tonumber(redis.call('GET', KEYS[2]) or '0')
      if limit == 0 then return 0 end
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      if current < limit then
        redis.call('INCR', KEYS[1])
        redis.call('EXPIRE', KEYS[1], 3600)
        return 1
      end
      return 0
    `;

    const result = await this.redis.eval(luaScript, 2, semKey, limitKey) as number;
    const acquired = result === 1;
    logger.trace({ campaignId, acquired }, 'Concurrency slot attempt');
    return acquired;
  }

  /** Release a concurrency slot. Clamped at 0 to prevent negatives. */
  async release(campaignId: string): Promise<void> {
    const key = REDIS_KEYS.CAMPAIGN_SEMAPHORE(campaignId);
    const luaScript = `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      if current > 0 then redis.call('DECR', KEYS[1]) end
      return redis.call('GET', KEYS[1])
    `;
    await this.redis.eval(luaScript, 1, key);
    logger.trace({ campaignId }, 'Concurrency slot released');
  }

  async getActiveCount(campaignId: string): Promise<number> {
    const val = await this.redis.get(REDIS_KEYS.CAMPAIGN_SEMAPHORE(campaignId));
    return parseInt(val ?? '0', 10);
  }

  async reset(campaignId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.CAMPAIGN_SEMAPHORE(campaignId));
    await this.redis.del(`campaign:limit:${campaignId}`);
    logger.info({ campaignId }, 'Concurrency counter reset');
  }
}
