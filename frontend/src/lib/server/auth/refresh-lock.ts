// Source: RESEARCH.md Pattern 5 — D-20 Redis SETNX single-flight refresh lock.
// 5-second TTL bounds blast radius; compare-and-delete via Lua script
// prevents the holder-dies-DELs-wrong-lock race (Pitfall 6).
//
// Single-instance Redis is sufficient (Vercel multi-pod safe per D-20). The
// Redlock algorithm targeting multi-Redis-node clusters is overkill for one
// Upstash node.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { getRedis } from '@/lib/server/redis';
import { log } from '@/lib/server/observability/log';

const TTL_SECONDS = 5;

// Compare-and-delete: only DEL when the held value still matches our token.
// Inlined here so callers (and tests) can verify the script shape.
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const localLocks = new Map<string, string>(); // userId → token

/**
 * Try to acquire the refresh lock for `userId`.
 * Returns a release fn on success, or null on contention.
 *
 * Without Redis, falls back to a per-process Map (D-20 — dev fallback only;
 * Vercel always has Upstash in prod).
 */
export async function acquireRefreshLock(
  userId: string,
): Promise<(() => Promise<void>) | null> {
  const token = randomUUID();
  const key = `refresh-lock:${userId}`;
  const redis = getRedis();

  if (!redis) {
    if (localLocks.has(userId)) return null;
    localLocks.set(userId, token);
    log.warn('refresh-lock using in-memory fallback (Redis absent)');
    return async () => {
      if (localLocks.get(userId) === token) localLocks.delete(userId);
    };
  }

  // @upstash/redis: { nx: true, ex: TTL_SECONDS } returns 'OK' on acquire,
  // null on miss.
  const ok = await redis.set(key, token, { nx: true, ex: TTL_SECONDS });
  if (ok !== 'OK') return null;

  return async () => {
    try {
      await redis.eval(RELEASE_LUA, [key], [token]);
    } catch (err) {
      log.warn('refresh-lock release failed (lock will expire)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
