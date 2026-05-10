// OBS-03 — Admin rate-limit visibility tests.
//
// D-OBS-03 + RESEARCH.md Pattern 4 + Pitfall 6 (1000-key SCAN cap).
//
// Test approach: vi.mock('@/lib/server/redis') so we can swap the `redis`
// export between a mocked Upstash client and `null` per test (matches the
// production fail-soft behavior when UPSTASH_REDIS_REST_URL is absent).
// The mocked client provides the same scan/mget/ttl shape the real Upstash
// SDK exposes — test seeds the in-memory map with prefix-shaped keys.
//
// Wave 1 conversion of the it.todo scaffold from Plan 03-01 (Wave 0).
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { seedAdmin, mockRedis, type MockRedisStub } from '@/test-utils/admin-fixtures';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

// Use a holder so individual tests can swap the redis export between a
// mocked client and `null` to exercise the "redis not configured" branch.
const redisHolder: { current: MockRedisStub | null } = { current: null };

vi.mock('@/lib/server/redis', () => ({
  get redis() {
    return redisHolder.current;
  },
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockEnforceAdminRateLimit = vi.mocked(enforceAdminRateLimit);

const admin = seedAdmin({ id: 'admin-1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: admin.id, email: admin.email },
  admin: { id: admin.id, email: admin.email, role: 'ADMIN' as const },
};

function makeGet(url: string = 'http://test/api/admin/rate-limits'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockEnforceAdminRateLimit.mockResolvedValue(null);
  redisHolder.current = null; // default to absent; tests opt in.
});

describe('/api/admin/rate-limits [Wave 1]', () => {
  it('GET returns bucket summary across known prefixes', async () => {
    const stub = mockRedis({
      'rl:auth:login:e:foo@example.com': 5,
      'rl:auth:login:e:bar@example.com': 12,
      'rl:auth:signup:ip:1.2.3.4': 1,
      'rl:auth:verify:ip:5.6.7.8': 3,
      'rl:auth:forgot:e:baz@example.com': 7,
      'rl:auth:reset:e:qux@example.com': 2,
      'rl:auth:pin:user-123': 4,
      'auth:lockout:foo@example.com': 1,
    });
    redisHolder.current = stub;

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.buckets)).toBe(true);
    // 7 buckets returned
    expect(body.buckets).toHaveLength(7);
    const names = body.buckets.map((b: { bucket: string }) => b.bucket);
    expect(names).toEqual([
      'auth:login',
      'auth:signup',
      'auth:verify',
      'auth:forgot',
      'auth:reset',
      'auth:pin',
      'lockout',
    ]);

    const login = body.buckets.find((b: { bucket: string }) => b.bucket === 'auth:login');
    expect(login.totalKeys).toBe(2);
    // top10 stripped of the prefix and sorted DESC by hits
    expect(login.top10[0].key).toBe('e:bar@example.com');
    expect(login.top10[0].hits).toBe(12);
    expect(login.top10[1].key).toBe('e:foo@example.com');
    expect(login.top10[1].hits).toBe(5);

    // lockout bucket scans `auth:lockout:` (NOT under rl: prefix)
    const lockout = body.buckets.find((b: { bucket: string }) => b.bucket === 'lockout');
    expect(lockout.totalKeys).toBe(1);
    expect(lockout.top10[0].key).toBe('foo@example.com');
  });

  it('GET hard-caps at 1000 keys per bucket and emits truncated:true', async () => {
    // Build 1500 keys for the auth:login bucket; SCAN should stop at 1000
    const flood: Record<string, number> = {};
    for (let i = 0; i < 1500; i += 1) {
      flood[`rl:auth:login:victim-${i}`] = 1;
    }
    const stub = mockRedis(flood);
    redisHolder.current = stub;

    const res = await GET(makeGet());
    const body = await res.json();
    const login = body.buckets.find((b: { bucket: string }) => b.bucket === 'auth:login');
    expect(login.totalKeys).toBe(1000);
    expect(login.truncated).toBe(true);
    // Top 10 length capped
    expect(login.top10).toHaveLength(10);
  });

  it('GET uses Redis SCAN (not KEYS) for non-blocking enumeration', async () => {
    const stub = mockRedis({ 'rl:auth:login:e:a@example.com': 1 });
    redisHolder.current = stub;

    await GET(makeGet());
    expect(stub.scan).toHaveBeenCalled();
    // The route MUST NOT call KEYS — KEYS blocks Upstash for the whole
    // keyspace and is a Pitfall 6 regression.
    expect(stub.keys).not.toHaveBeenCalled();
    // SCAN was called with a `match` glob per bucket.
    const firstCall = stub.scan.mock.calls[0];
    expect(firstCall?.[0]).toBe('0');
    expect(firstCall?.[1]?.match).toMatch(/^rl:auth:login:\*$|^rl:auth:.*:\*$|^auth:.*:\*$/);
  });

  it('GET returns top10 [{ key, hits, expiresAt }] per bucket', async () => {
    const stub = mockRedis({
      'rl:auth:login:e:a': 10,
      'rl:auth:login:e:b': 50,
      'rl:auth:login:e:c': 3,
      'rl:auth:login:e:d': 100,
      'rl:auth:login:e:e': 25,
    });
    redisHolder.current = stub;

    const res = await GET(makeGet());
    const body = await res.json();
    const login = body.buckets.find((b: { bucket: string }) => b.bucket === 'auth:login');
    expect(login.totalKeys).toBe(5);
    // Sorted DESC by hits — 100, 50, 25, 10, 3
    expect(login.top10.map((e: Top10Like) => e.hits)).toEqual([100, 50, 25, 10, 3]);
    // Each entry has the three documented fields
    for (const entry of login.top10) {
      expect(entry).toHaveProperty('key');
      expect(entry).toHaveProperty('hits');
      expect(entry).toHaveProperty('expiresAt');
      // expiresAt is an ISO string when ttl > 0 (mockRedis default ttl=60)
      expect(typeof entry.expiresAt === 'string' || entry.expiresAt === null).toBe(true);
    }
    // Top10 keys are stripped of the bucket prefix
    expect(login.top10[0].key).toBe('e:d');
  });

  it('GET returns 0 totalKeys + empty top10 for empty buckets', async () => {
    // Only one bucket has any data; the other 6 are empty
    const stub = mockRedis({ 'rl:auth:login:e:a@example.com': 1 });
    redisHolder.current = stub;

    const res = await GET(makeGet());
    const body = await res.json();
    const signup = body.buckets.find((b: { bucket: string }) => b.bucket === 'auth:signup');
    expect(signup.totalKeys).toBe(0);
    expect(signup.top10).toEqual([]);
  });

  it('GET returns { buckets: [], note: "redis not configured" } when redis is null', async () => {
    redisHolder.current = null;

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ buckets: [], note: 'redis not configured' });
  });

  it('GET returns 401/403 when requireAdmin bails', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'ADMIN_REQUIRED', message: 'Admin access required' },
        { status: 403 },
      ),
    );
    const stub = mockRedis({ 'rl:auth:login:e:a': 1 });
    redisHolder.current = stub;

    const res = await GET(makeGet());
    expect(res.status).toBe(403);
    expect(stub.scan).not.toHaveBeenCalled();
  });

  it('GET short-circuits when admin rate limit is exceeded', async () => {
    mockEnforceAdminRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const stub = mockRedis({ 'rl:auth:login:e:a': 1 });
    redisHolder.current = stub;

    const res = await GET(makeGet());
    expect(res.status).toBe(429);
    expect(stub.scan).not.toHaveBeenCalled();
  });

  it('GET response includes x-request-id header', async () => {
    redisHolder.current = mockRedis({});
    const res = await GET(makeGet());
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});

// Helper type for top10 element shape used in expectations
interface Top10Like {
  key: string;
  hits: number;
  expiresAt: string | null;
}

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });

  it('route source uses redis.scan (not redis.keys), HARD_CAP=1000, and the lockout prefix', () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toContain('redisClient.scan');
    expect(src).not.toContain('redisClient.keys');
    expect(src).toContain('HARD_CAP = 1000');
    expect(src).toContain('auth:lockout:');
    expect(src).toContain('redis not configured');
    expect(src).toContain('truncated: true');
  });
});
