// Tests for POST /api/auth/logout (AUTH-05).
// Pattern 13. CSRF-gated mutating route (D-02).
import { describe, it, expect, beforeEach } from 'vitest';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import '@/test-utils/prisma-mock'; // not used but keeps mock stable across files

mockNextCookies();

import { POST } from './route';
import { NextRequest } from 'next/server';

function makeReq(opts: { csrfHeader?: string; csrfCookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.csrfHeader) headers['x-csrf-token'] = opts.csrfHeader;
  if (opts.csrfCookie) headers.cookie = `app-csrf=${opts.csrfCookie}`;
  return new NextRequest('https://test/api/auth/logout', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  __cookieStore.clear();
  // Pre-populate cookies that logout should clear.
  __cookieStore.entries(); // touch to keep linter quiet
});

describe('POST /api/auth/logout', () => {
  it('Test 1: happy path — valid CSRF, clears all 3 cookies, returns ok', async () => {
    const csrf = 'matching-csrf-token-value';
    const res = await POST(makeReq({ csrfHeader: csrf, csrfCookie: csrf }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    // setAuthCookies + clearCsrfCookie write empty values with maxAge: 0.
    const tokenCookie = __cookieStore.get('app-token');
    const refreshCookie = __cookieStore.get('app-refresh');
    const csrfCookie = __cookieStore.get('app-csrf');
    expect(tokenCookie?.value).toBe('');
    expect(refreshCookie?.value).toBe('');
    expect(csrfCookie?.value).toBe('');
  });

  it('Test 2: no CSRF header — 403 with CSRF error', async () => {
    const res = await POST(makeReq({ csrfCookie: 'has-cookie-but-no-header' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/CSRF/i);
  });

  it('Test 3: CSRF mismatch — header != cookie → 403', async () => {
    const res = await POST(makeReq({ csrfHeader: 'a', csrfCookie: 'b' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/CSRF/i);
  });
});
