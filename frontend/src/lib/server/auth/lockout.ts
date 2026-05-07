// Source: RESEARCH.md Pattern 10 — D-07 failed-login lockout primitives.
// Threshold default 5 / 15-min lockout (env-overridable).
// Redis-backed when available; per-process Map fallback (logs warn).
//
// Key shape:
//   auth:lockout-count:{lower(email)}  → counter (TTL = lockout duration)
//   auth:lockout:{lower(email)}        → flag '1' (TTL = lockout duration)
//
// Email normalization (trim + lowercase) prevents trivial bypass via
// case-mutation (Pitfall 7).
import 'server-only';
import { getRedis } from '@/lib/server/redis';
import { log } from '@/lib/server/observability/log';

function threshold(): number {
  return Number(process.env.AUTH_LOCKOUT_THRESHOLD ?? 5);
}

function durationMs(): number {
  return Number(process.env.AUTH_LOCKOUT_DURATION_MIN ?? 15) * 60 * 1000;
}

function memKey(email: string): string {
  return email.trim().toLowerCase();
}

interface MemEntry {
  count: number;
  resetAt: number;
}

const memCounts = new Map<string, MemEntry>();

/** Returns true if `email` is currently locked out. */
export async function isLockedOut(email: string): Promise<boolean> {
  const k = memKey(email);
  const redis = getRedis();
  if (redis) {
    const v = await redis.get(`auth:lockout:${k}`);
    return Boolean(v);
  }
  log.warn('lockout using in-memory fallback (Redis absent)');
  const e = memCounts.get(k);
  if (!e) return false;
  if (e.resetAt <= Date.now()) {
    memCounts.delete(k);
    return false;
  }
  return e.count >= threshold();
}

/**
 * Increment failure count for `email`. Returns the post-increment count plus a
 * `locked` flag that becomes true on the attempt that hits/exceeds threshold.
 *
 * On the threshold-breach attempt, also writes the lockout flag (D-07: 15-min
 * lockout duration) so subsequent calls to `isLockedOut` return true without
 * needing a count read.
 */
export async function recordFailure(email: string): Promise<{ count: number; locked: boolean }> {
  const k = memKey(email);
  const redis = getRedis();
  const limit = threshold();
  const ttlMs = durationMs();

  if (redis) {
    const countKey = `auth:lockout-count:${k}`;
    const lockKey = `auth:lockout:${k}`;
    const count = (await redis.incr(countKey)) as number;
    if (count === 1) {
      await redis.expire(countKey, Math.ceil(ttlMs / 1000));
    }
    if (count >= limit) {
      await redis.set(lockKey, '1', { ex: Math.ceil(ttlMs / 1000) });
      return { count, locked: true };
    }
    return { count, locked: false };
  }

  log.warn('lockout using in-memory fallback (Redis absent)');
  const now = Date.now();
  const e = memCounts.get(k);
  if (!e || e.resetAt <= now) {
    memCounts.set(k, { count: 1, resetAt: now + ttlMs });
    return { count: 1, locked: 1 >= limit };
  }
  e.count += 1;
  return { count: e.count, locked: e.count >= limit };
}

/** Clear failure count + lockout flag after successful login. */
export async function recordSuccess(email: string): Promise<void> {
  const k = memKey(email);
  const redis = getRedis();
  if (redis) {
    await redis.del(`auth:lockout-count:${k}`);
    await redis.del(`auth:lockout:${k}`);
    return;
  }
  memCounts.delete(k);
}
