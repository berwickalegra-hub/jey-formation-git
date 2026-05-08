// OAUTH-01 — GET /api/auth/oauth/google/start tests.
//
// Covers env-gated 404, state+PKCE cookie shape (path /api/auth/oauth, maxAge 300,
// httpOnly, SameSite=Lax), 302 to Google, ?next= echo (same-origin only), and
// silent rejection of cross-origin / protocol-relative ?next= values (Pitfall 10).
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

// Cookies mock MUST be installed at module level so vi.mock auto-hoists.
mockNextCookies();

// Mock the provider factory so we control the env-gated branch from tests.
vi.mock('@/lib/server/oauth/google', () => ({
  tryCreateGoogleProvider: vi.fn(),
}));

import { tryCreateGoogleProvider, type GoogleProviderHandle } from '@/lib/server/oauth/google';
import { GET } from './route';

const mockTryCreate = vi.mocked(tryCreateGoogleProvider);

// Help TypeScript: tryCreateGoogleProvider returns `GoogleProviderHandle | undefined`,
// so a bare `ReturnType<typeof …>['client']` doesn't narrow. Use the explicit
// interface field for the cast.
type ProviderClient = GoogleProviderHandle['client'];

function makeReq(url = 'https://app.example.test/api/auth/oauth/google/start'): NextRequest {
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  process.env.APP_URL = 'https://app.example.test';
});

describe('GET /api/auth/oauth/google/start', () => {
  it('returns 404 silently when GOOGLE_* env is missing', async () => {
    mockTryCreate.mockReturnValue(undefined);
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ error: 'Not found' }));
    // No ephemeral cookies issued on the inert path.
    expect(__cookieStore.has('app-oauth-state')).toBe(false);
    expect(__cookieStore.has('app-oauth-pkce')).toBe(false);
  });

  it('issues state + PKCE cookies with path=/api/auth/oauth maxAge=300 and 302s to Google', async () => {
    mockTryCreate.mockReturnValue({
      client: {
        createAuthorizationURL: (state: string, codeVerifier: string, scopes: string[]) => {
          const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          u.searchParams.set('client_id', 'cid');
          u.searchParams.set(
            'redirect_uri',
            'https://app.example.test/api/auth/oauth/google/callback',
          );
          u.searchParams.set('response_type', 'code');
          u.searchParams.set('scope', scopes.join(' '));
          u.searchParams.set('state', state);
          u.searchParams.set('code_challenge', `chal-${codeVerifier.slice(0, 6)}`);
          u.searchParams.set('code_challenge_method', 'S256');
          return u;
        },
      } as unknown as ProviderClient,
      scopes: ['openid', 'email', 'profile'] as const,
      redirectUri: 'https://app.example.test/api/auth/oauth/google/callback',
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(loc).toContain('client_id=cid');
    expect(loc).toContain('code_challenge');
    expect(loc).toContain('code_challenge_method=S256');
    // URLSearchParams encodes spaces as `+`; tolerate either by checking parts.
    expect(loc).toMatch(/scope=openid(\+|%20)email(\+|%20)profile/);
    expect(loc).toContain('response_type=code');

    const stateCookie = __cookieStore.get('app-oauth-state');
    const pkceCookie = __cookieStore.get('app-oauth-pkce');
    expect(stateCookie).toBeDefined();
    expect(pkceCookie).toBeDefined();
    expect(stateCookie!.options).toEqual(
      expect.objectContaining({
        path: '/api/auth/oauth',
        maxAge: 300,
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    expect(pkceCookie!.options).toEqual(
      expect.objectContaining({
        path: '/api/auth/oauth',
        maxAge: 300,
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    // The state cookie value must equal the `state` query param in the URL.
    const urlState = new URL(loc).searchParams.get('state');
    expect(stateCookie!.value).toBe(urlState);
  });

  it('echoes ?next=/dashboard to app-oauth-next cookie when same-origin', async () => {
    mockTryCreate.mockReturnValue({
      client: {
        createAuthorizationURL: () => new URL('https://accounts.google.com/?state=x'),
      } as unknown as ProviderClient,
      scopes: ['openid', 'email', 'profile'] as const,
      redirectUri: '',
    });

    await GET(makeReq('https://app.example.test/api/auth/oauth/google/start?next=/dashboard'));

    const nextCookie = __cookieStore.get('app-oauth-next');
    expect(nextCookie).toBeDefined();
    // The validator returns an absolute URL with origin === APP_URL origin.
    expect(nextCookie!.value).toBe('https://app.example.test/dashboard');
    expect(nextCookie!.options).toEqual(
      expect.objectContaining({
        path: '/api/auth/oauth',
        maxAge: 300,
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
  });

  it('rejects protocol-relative ?next=//evil.com silently (no app-oauth-next cookie)', async () => {
    mockTryCreate.mockReturnValue({
      client: {
        createAuthorizationURL: () => new URL('https://accounts.google.com/?state=x'),
      } as unknown as ProviderClient,
      scopes: ['openid', 'email', 'profile'] as const,
      redirectUri: '',
    });

    await GET(makeReq('https://app.example.test/api/auth/oauth/google/start?next=//evil.com/x'));
    expect(__cookieStore.has('app-oauth-next')).toBe(false);
  });

  it('rejects scheme-prefixed ?next=https://evil.com silently (no app-oauth-next cookie)', async () => {
    mockTryCreate.mockReturnValue({
      client: {
        createAuthorizationURL: () => new URL('https://accounts.google.com/?state=x'),
      } as unknown as ProviderClient,
      scopes: ['openid', 'email', 'profile'] as const,
      redirectUri: '',
    });

    await GET(
      makeReq('https://app.example.test/api/auth/oauth/google/start?next=https://evil.com/x'),
    );
    expect(__cookieStore.has('app-oauth-next')).toBe(false);
  });

  it("source contains runtime='nodejs' (Phase 0 invariant)", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
