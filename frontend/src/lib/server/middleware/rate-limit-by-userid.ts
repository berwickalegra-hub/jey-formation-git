// D-ADMIN-05 — Per-userId admin rate limiter. 100 req/min per admin
// userId, regardless of source IP (admins often share office IPs).
//
// Pattern: mirrors `createEmailLimiter` (per-email) but keyed on a
// stable `User.id` instead of an email string. Backed by the same
// `RedisRateLimitStore` (Upstash) when available; fails open in dev
// when `redis === null` so local development without UPSTASH still works.
//
// Usage from a Route Handler:
//   const auth = await requireAdmin('ADMIN');
//   if (auth instanceof NextResponse) return auth;
//   const limited = await enforceAdminRateLimit(auth.user.sub);
//   if (limited) return limited;
//
// Threat T-03-01-03: rate-limits the back-office surface — without it,
// a compromised admin token could be used to scrape PII at unbounded rate.
import 'server-only';
import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { RedisRateLimitStore } from '@/lib/server/rate-limit-store';

const ADMIN_PREFIX = 'rl:admin:userid:';
const WINDOW_MS = 60_000;
const MAX_HITS = 100;

/**
 * Enforce the per-userId admin rate limit. Returns a 429 NextResponse when
 * the userId has exceeded MAX_HITS in WINDOW_MS, otherwise returns null and
 * the caller should proceed.
 *
 * Returns null when `redis` is absent (dev parity with `createEmailLimiter`)
 * — production deployments MUST set UPSTASH_REDIS_REST_URL/_TOKEN; the
 * runtime-environment test (Phase 0) is the right place to add a CI check
 * if this becomes a deploy-time concern.
 */
export async function enforceAdminRateLimit(userId: string): Promise<NextResponse | null> {
  if (!redis) return null;
  // Use empty `prefix` since we encode the full keyspace into the key
  // ourselves — the existing store applies its own prefix on top, so we
  // pass '' and prepend rl:admin:userid: explicitly to keep the keyspace
  // contract documented at this call site.
  const store = new RedisRateLimitStore({ redis, prefix: '', windowMs: WINDOW_MS });
  const { totalHits, resetTime } = await store.increment(`${ADMIN_PREFIX}${userId}`);
  if (totalHits > MAX_HITS) {
    const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: 'TOO_MANY_REQUESTS',
        message: 'Admin rate limit exceeded; retry shortly.',
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(MAX_HITS),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(resetTime.getTime() / 1000)),
        },
      },
    );
  }
  return null;
}
