// NOTIF-04 — GET + PATCH /api/notifications/prefs tests.
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { GET, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/notifications/prefs', { method: 'GET' });
}

function makePatch(body: unknown, opts: { csrf?: 'match' | 'missing' } = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/notifications/prefs', {
    method: 'PATCH',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/notifications/prefs', () => {
  it('Test 1: no row exists → { prefs: {} }', async () => {
    prismaMock.notificationPreferences.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ prefs: {} });
  });

  it('Test 2: row exists → returns existing prefs', async () => {
    prismaMock.notificationPreferences.findUnique.mockResolvedValue({
      prefs: { ORDER_PAID: { email: false, inApp: true } },
    } as never);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ prefs: { ORDER_PAID: { email: false, inApp: true } } });
  });

  it('Test 3: requireAuth bail → 401', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Missing token' }, { status: 401 }));
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(prismaMock.notificationPreferences.findUnique).not.toHaveBeenCalled();
  });

  it('GET: scopes findUnique by userId: ctx.user.sub', async () => {
    prismaMock.notificationPreferences.findUnique.mockResolvedValue(null);
    await GET(makeGet());
    const args = prismaMock.notificationPreferences.findUnique.mock.calls[0]?.[0];
    expect(args?.where?.userId).toBe('user-1');
  });
});

describe('PATCH /api/notifications/prefs', () => {
  it('Test 4: missing CSRF header → 403', async () => {
    const res = await PATCH(makePatch({ prefs: {} }, { csrf: 'missing' }));
    expect(res.status).toBe(403);
    expect(prismaMock.notificationPreferences.upsert).not.toHaveBeenCalled();
  });

  it('Test 5: no existing row + valid patch → upsert with merged prefs', async () => {
    prismaMock.notificationPreferences.findUnique.mockResolvedValue(null);
    prismaMock.notificationPreferences.upsert.mockResolvedValue({} as never);
    const res = await PATCH(
      makePatch({ prefs: { ORDER_PAID: { email: false, inApp: true } } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prefs).toEqual({ ORDER_PAID: { email: false, inApp: true } });

    const upsertArg = prismaMock.notificationPreferences.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.where?.userId).toBe('user-1');
    expect(upsertArg?.create?.userId).toBe('user-1');
    expect(upsertArg?.create?.prefs).toEqual({ ORDER_PAID: { email: false, inApp: true } });
    expect(upsertArg?.update?.prefs).toEqual({ ORDER_PAID: { email: false, inApp: true } });
  });

  it('Test 6: existing row → response merges new event with existing untouched events', async () => {
    prismaMock.notificationPreferences.findUnique.mockResolvedValue({
      prefs: { WELCOME: { email: true, inApp: true } },
    } as never);
    prismaMock.notificationPreferences.upsert.mockResolvedValue({} as never);
    const res = await PATCH(
      makePatch({ prefs: { ORDER_PAID: { email: false, inApp: true } } }),
    );
    const body = await res.json();
    expect(body.prefs).toEqual({
      WELCOME: { email: true, inApp: true },
      ORDER_PAID: { email: false, inApp: true },
    });
  });

  it('Test 7: malformed body (string instead of bool) → 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatch({ prefs: { X: { email: 'true' } } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.notificationPreferences.upsert).not.toHaveBeenCalled();
  });

  it('Test 8: empty patch ({}) → upsert called; response equals existing prefs', async () => {
    prismaMock.notificationPreferences.findUnique.mockResolvedValue({
      prefs: { WELCOME: { email: true, inApp: false } },
    } as never);
    prismaMock.notificationPreferences.upsert.mockResolvedValue({} as never);
    const res = await PATCH(makePatch({ prefs: {} }));
    const body = await res.json();
    expect(body.prefs).toEqual({ WELCOME: { email: true, inApp: false } });
    expect(prismaMock.notificationPreferences.upsert).toHaveBeenCalledTimes(1);
  });

  it('Test 9: partial channel patch merges channel-by-channel (Wave 0 prefs-merge test 2)', async () => {
    prismaMock.notificationPreferences.findUnique.mockResolvedValue({
      prefs: { ORDER_PAID: { email: true, inApp: true } },
    } as never);
    prismaMock.notificationPreferences.upsert.mockResolvedValue({} as never);
    const res = await PATCH(makePatch({ prefs: { ORDER_PAID: { email: false } } }));
    const body = await res.json();
    expect(body.prefs).toEqual({ ORDER_PAID: { email: false, inApp: true } });
  });

  it('PATCH: requireAuth bail → 401, no upsert', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Missing token' }, { status: 401 }));
    const res = await PATCH(makePatch({ prefs: {} }));
    expect(res.status).toBe(401);
    expect(prismaMock.notificationPreferences.upsert).not.toHaveBeenCalled();
  });

  it('PATCH: rejects non-string event-type via Zod', async () => {
    const res = await PATCH(makePatch({ prefs: 'not-an-object' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs', mergePrefs, verifyCsrf, withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('mergePrefs');
    expect(src).toContain('verifyCsrf(req)');
    expect(src).toContain('withRequestContext');
  });
});
