// OBS-03 — Admin rate-limit visibility (read-only summary across known buckets).
//
// Returns a compact summary per bucket: total key count + top10 hottest keys
// (with hits + expiresAt). Read-only in v1 — admins cannot reset a lockout
// here (D-OBS-03; deferred to v2 as `DELETE /api/admin/rate-limits/:bucket/:key`).
//
// Threats:
//   T-03-04-02: A 50K-key bucket would OOM the JSON response. Hard-cap at
//     1000 keys per bucket; emit `truncated: true` when capped.
//   T-03-04-05: redis === null in dev/CI without Upstash configured would
//     crash the route. Explicit early-return `{ buckets: [], note: 'redis not
//     configured' }`. Caller must read this gracefully.
//
// 7 buckets: 6 under `rl:` prefix (login/signup/verify/forgot/reset/pin)
// matching the auth route handlers' `bucket:` parameter, plus the synthetic
// `lockout` bucket scanning `auth:lockout:` keys (the lock flags themselves;
// counters live under `auth:lockout-count:` and decay together — admin sees
// the lock state directly).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { redis } from '@/lib/server/redis';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface BucketDef {
  bucket: string;
  prefix: string;
}

const BUCKETS: BucketDef[] = [
  { bucket: 'auth:login', prefix: 'rl:auth:login:' },
  { bucket: 'auth:signup', prefix: 'rl:auth:signup:' },
  { bucket: 'auth:verify', prefix: 'rl:auth:verify:' },
  { bucket: 'auth:forgot', prefix: 'rl:auth:forgot:' },
  { bucket: 'auth:reset', prefix: 'rl:auth:reset:' },
  { bucket: 'auth:pin', prefix: 'rl:auth:pin:' },
  // Synthetic 7th bucket per RESEARCH.md Open Question 3 — admins triaging
  // an account-lockout incident need the lock-flag visibility.
  { bucket: 'lockout', prefix: 'auth:lockout:' },
];

const HARD_CAP = 1000;
const SCAN_BATCH = 200;

interface Top10Entry {
  key: string;
  hits: number;
  expiresAt: string | null;
}

interface BucketSummary {
  bucket: string;
  totalKeys: number;
  top10: Top10Entry[];
  truncated?: boolean;
}

async function scanBucket(
  redisClient: NonNullable<typeof redis>,
  b: BucketDef,
): Promise<BucketSummary> {
  let cursor: string = '0';
  const keys: string[] = [];
  let truncated = false;

  do {
    const res = await redisClient.scan(cursor, {
      match: `${b.prefix}*`,
      count: SCAN_BATCH,
    });
    cursor = String(res[0]);
    keys.push(...res[1]);
    if (keys.length >= HARD_CAP) {
      truncated = true;
      break;
    }
  } while (cursor !== '0');

  const trimmed = keys.slice(0, HARD_CAP);
  const hits =
    trimmed.length > 0 ? await redisClient.mget<(number | string | null)[]>(...trimmed) : [];
  const ttls = await Promise.all(trimmed.map((k) => redisClient.ttl(k)));

  const top10: Top10Entry[] = trimmed
    .map((key, i) => ({
      key,
      hits: Number(hits[i] ?? 0),
      ttl: ttls[i] ?? -1,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 10)
    .map((r) => ({
      key: r.key.replace(b.prefix, ''),
      hits: r.hits,
      expiresAt: r.ttl > 0 ? new Date(Date.now() + r.ttl * 1000).toISOString() : null,
    }));

  return {
    bucket: b.bucket,
    totalKeys: trimmed.length,
    top10,
    ...(truncated ? { truncated: true } : {}),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    if (!redis) {
      return NextResponse.json(
        { buckets: [], note: 'redis not configured' },
        { headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const redisClient = redis;
    const buckets = await Promise.all(BUCKETS.map((b) => scanBucket(redisClient, b)));
    return NextResponse.json({ buckets }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
