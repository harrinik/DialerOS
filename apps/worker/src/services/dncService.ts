import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_KEYS } from '@dialer/shared';
import { logger } from '../lib/logger.js';

/**
 * DncService — O(1) Do-Not-Call lookup backed by a Redis Set.
 *
 * Numbers are stored as SHA-256(E.164 phone) to avoid storing PII
 * in plaintext in the cache layer.
 */
export class DncService {
  constructor(private readonly redis: Redis) {}

  /** Hash a phone number for storage / lookup. */
  private hash(phone: string): string {
    return createHash('sha256').update(phone.trim()).digest('hex');
  }

  /**
   * Check if a phone number is on the DNC list.
   * Returns true if the number should NOT be called.
   */
  async isBlocked(phone: string): Promise<boolean> {
    const h = this.hash(phone);
    const result = await this.redis.sismember(REDIS_KEYS.DNC_SET, h);
    const blocked = result === 1;
    if (blocked) {
      logger.debug({ phone }, 'DNC check: number is blocked');
    }
    return blocked;
  }

  /**
   * Add a phone number to the Redis DNC set.
   * The authoritative record lives in MongoDB; this is the hot-path cache.
   */
  async addToCache(phone: string): Promise<void> {
    const h = this.hash(phone);
    await this.redis.sadd(REDIS_KEYS.DNC_SET, h);
    logger.debug({ phone }, 'DNC: number added to Redis cache');
  }

  /**
   * Remove a phone number from the Redis DNC set.
   */
  async removeFromCache(phone: string): Promise<void> {
    const h = this.hash(phone);
    await this.redis.srem(REDIS_KEYS.DNC_SET, h);
    logger.debug({ phone }, 'DNC: number removed from Redis cache');
  }

  /**
   * Bulk-load DNC hashes into Redis from an array of phone numbers.
   * Uses a pipeline for efficiency.
   */
  async bulkAddToCache(phones: readonly string[]): Promise<void> {
    if (phones.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const phone of phones) {
      pipeline.sadd(REDIS_KEYS.DNC_SET, this.hash(phone));
    }
    await pipeline.exec();
    logger.info({ count: phones.length }, 'DNC: bulk loaded into Redis cache');
  }

  /**
   * Return the total size of the DNC set in Redis.
   */
  async size(): Promise<number> {
    return this.redis.scard(REDIS_KEYS.DNC_SET);
  }
}
