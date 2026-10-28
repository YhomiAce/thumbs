import { Redis } from 'ioredis';

/**
 * Creates an ioredis connection suitable for BullMQ.
 *
 * BullMQ workers use blocking commands, so `maxRetriesPerRequest` must be `null`.
 *
 * @param url - Redis URL (the path selects the database index, e.g. `/5`)
 * @returns A new connection
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}
