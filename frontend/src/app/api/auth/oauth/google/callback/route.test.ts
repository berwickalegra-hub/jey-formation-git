// OAUTH-02 + OAUTH-03 — GET /api/auth/oauth/google/callback tests.
//
// Covers all D-06 redirect codes, state-mismatch / email_verified gates,
// D-01 link path (existing email user gets OAuthAccount only — name/avatar
// untouched), D-02 create path (new user inside $transaction with welcome
// notification), 3-cookie issuance, ephemeral cookie clearing on every exit,
// and a static NOTIF-05 source check (no direct prisma.notification.create).
import fs from 'node:fs';
import path from 'node:path';

import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { OAuth2RequestError } from 'arctic';

mockNextCookies();

vi.mock('@/lib/server/oauth/google', () => ({
  tryCreateGoogleProvider: vi.fn(),
  decodeIdToken: vi.fn(),
}));
vi.mock('@/lib/server/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
}));
vi.mock('@/lib/server/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    setAuthCookies: vi.fn(),
    setCsrfCookie: vi.fn().mockResolvedValue('csrf-token'),
    createAccessToken: vi.fn().mockResolvedValue('access-jwt'),
    createRefreshToken: vi.fn().mockResolvedValue('refresh-jwt'),
  };
});

import {
  tryCreateGoogleProvider,
  decodeIdToken,
  type GoogleProviderHandle,
} from '@/lib/server/oauth/google';
import { createNotification } from '@/lib/server/notifications';
import { setAuthCookies, setCsrfCookie } from '@/lib/server/auth';
import { GET } from './route';

const mockTryCreate = vi.mocked(tryCreateGoogleProvider);
const mockDecode = vi.mocked(decodeIdToken);
const mockCreateNotification = vi.mocked(createNotification);
const mockSetAuthCookies = vi.mocked(setAuthCookies);
const mockSetCsrfCookie = vi.mocked(setCsrfCookie);

// Help TypeScript: `tryCreateGoogleProvider` returns `GoogleProviderHandle | undefined`,
// so a bare `ReturnType<typeof …>['client']` doesn't narrow. Use the explicit
// interface field for the cast.
type ProviderClient = GoogleProviderHandle['client'];

interface MakeReqOpts {
  code?: string | null;
  state?: string | null;
}

// Seed the mock cookie store by calling the mocked cookies() function and
// using its `set` API, exactly like production code would.
async function seedCookie(name: string, value: string): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.set(name, value, { path: '/api/auth/oauth' });
}

function makeReq(opts: MakeReqOpts = {}): NextRequest {
  const u = new URL('https://app.example.test/api/auth/oauth/google/callback');
  if (opts.code !== null && opts.code !== undefined) u.searchParams.set('code', opts.code);
  if (opts.state !== null && opts.state !== undefined) u.searchParams.set('state', opts.state);
  return new NextRequest(u);
}

const STATE = 'random-state-123';
const PKCE = 'random-pkce-verifier-128-chars-long';
const ID_TOKEN = 'header.payload.signature';

const VALID_CLAIMS = {
  sub: 'google-sub-123',
  email: 'a@b.com',
  email_verified: true as const,
  name: 'Alice',
  picture: 'https://example.com/avatar.png',
};

function mockProvider(opts?: { exchange?: () => Promise<unknown> }): void {
  mockTryCreate.mockReturnValue({
    client: {
      validateAuthorizationCode:
        opts?.exchange ?? (() => Promise.resolve({ idToken: () => ID_TOKEN })),
    } as unknown as ProviderClient,
    scopes: ['openid', 'email', 'profile'] as const,
    redirectUri: 'https://app.example.test/api/auth/oauth/google/callback',
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  __cookieStore.clear();
  process.env.APP_URL = 'https://app.example.test';
  // Default: provider is configured.
  mockProvider();
  mockDecode.mockReturnValue(VALID_CLAIMS);
  // Default $transaction passthrough — runs the callback against the mock.
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
  mockCreateNotification.mockResolvedValue({ id: 'notif-1' } as never);
});

describe('GET /api/auth/oauth/google/callback', () => {
  it('OAUTH_PROVIDER_DISABLED: 302s to /auth/error?code=OAUTH_PROVIDER_DISABLED when env missing', async () => {
    mockTryCreate.mockReturnValue(undefined);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/error?code=OAUTH_PROVIDER_DISABLED');
    expect(mockSetAuthCookies).not.toHaveBeenCalled();
  });

  it('OAUTH_STATE_MISMATCH: missing state cookie → redirect; ephemeral cookies cleared', async () => {
    // No state cookie seeded.
    await seedCookie('app-oauth-pkce', PKCE);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/error?code=OAUTH_STATE_MISMATCH');
    expect(mockSetAuthCookies).not.toHaveBeenCalled();
    // Ephemeral cookies cleared (maxAge: 0).
    const stateAfter = __cookieStore.get('app-oauth-state');
    const pkceAfter = __cookieStore.get('app-oauth-pkce');
    if (stateAfter) expect((stateAfter.options as { maxAge?: number }).maxAge).toBe(0);
    if (pkceAfter) expect((pkceAfter.options as { maxAge?: number }).maxAge).toBe(0);
  });

  it('OAUTH_STATE_MISMATCH: state cookie value !== query state → redirect', async () => {
    await seedCookie('app-oauth-state', 'different-state');
    await seedCookie('app-oauth-pkce', PKCE);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/error?code=OAUTH_STATE_MISMATCH');
  });

  it('OAUTH_CODE_EXCHANGE_FAILED: validateAuthorizationCode throws OAuth2RequestError', async () => {
    mockProvider({
      exchange: () =>
        Promise.reject(new OAuth2RequestError('invalid_grant', 'bad code', null, null)),
    });
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/error?code=OAUTH_CODE_EXCHANGE_FAILED');
    expect(mockSetAuthCookies).not.toHaveBeenCalled();
  });

  it('OAUTH_GENERIC: unknown error from validateAuthorizationCode', async () => {
    mockProvider({ exchange: () => Promise.reject(new Error('boom')) });
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/error?code=OAUTH_GENERIC');
    expect(mockSetAuthCookies).not.toHaveBeenCalled();
  });

  it('GOOGLE_EMAIL_NOT_VERIFIED: rejects email_verified=false; no User created, no cookies', async () => {
    mockDecode.mockReturnValue({ ...VALID_CLAIMS, email_verified: false });
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.oAuthAccount.create).not.toHaveBeenCalled();
    expect(mockSetAuthCookies).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('D-01 link path: existing email user gets OAuthAccount row; User.update NOT called for name/avatar; 3 cookies issued; no welcome notif', async () => {
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);
    // Provider lookup misses, email lookup hits.
    prismaMock.oAuthAccount.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 'u-existing' } as never) // by email
      .mockResolvedValueOnce({
        id: 'u-existing',
        email: 'a@b.com',
        tokenVersion: 0,
      } as never); // re-fetch for token issuance
    prismaMock.oAuthAccount.create.mockResolvedValue({
      id: 'oa-1',
      userId: 'u-existing',
      provider: 'google',
      providerAccountId: VALID_CLAIMS.sub,
    } as never);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    // Success branch — should NOT redirect to /auth/error.
    expect(res.headers.get('location')).not.toContain('/auth/error');

    expect(prismaMock.oAuthAccount.create).toHaveBeenCalledTimes(1);
    const oaArg = prismaMock.oAuthAccount.create.mock.calls[0]?.[0];
    expect(oaArg?.data).toEqual(
      expect.objectContaining({
        userId: 'u-existing',
        provider: 'google',
        providerAccountId: VALID_CLAIMS.sub,
      }),
    );
    // D-01: do NOT overwrite name/avatarUrl on existing users.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();

    // 3-cookie issuance.
    expect(mockSetAuthCookies).toHaveBeenCalledWith('access-jwt', 'refresh-jwt');
    expect(mockSetCsrfCookie).toHaveBeenCalledTimes(1);
    // No welcome notification on link path.
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('D-02 create path: brand-new user → $transaction creates User + OAuthAccount; createNotification dispatched with welcomeNotification', async () => {
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);

    prismaMock.oAuthAccount.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // by email — no existing user
      .mockResolvedValueOnce({
        id: 'u-new',
        email: 'a@b.com',
        tokenVersion: 0,
      } as never); // re-fetch for token issuance
    prismaMock.user.create.mockResolvedValue({ id: 'u-new' } as never);
    prismaMock.oAuthAccount.create.mockResolvedValue({ id: 'oa-2' } as never);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).not.toContain('/auth/error');

    // $transaction was used for the create path.
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    const userArg = prismaMock.user.create.mock.calls[0]?.[0];
    expect(userArg?.data).toEqual(
      expect.objectContaining({
        email: 'a@b.com',
        name: 'Alice',
        avatarUrl: 'https://example.com/avatar.png',
        passwordHash: null,
      }),
    );
    expect(userArg?.data?.emailVerifiedAt).toBeInstanceOf(Date);

    expect(prismaMock.oAuthAccount.create).toHaveBeenCalledTimes(1);

    // 3 cookies + welcome notif via createNotification (NOTIF-05 wrapper).
    expect(mockSetAuthCookies).toHaveBeenCalledWith('access-jwt', 'refresh-jwt');
    expect(mockSetCsrfCookie).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const notifInput = mockCreateNotification.mock.calls[0]?.[1];
    expect(notifInput).toEqual(
      expect.objectContaining({
        userId: 'u-new',
        type: 'WELCOME',
        dedupeKey: 'welcome:u-new',
      }),
    );
  });

  it('existing OAuth user (provider lookup hits): no User update, no welcome, just 3 cookies', async () => {
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);

    prismaMock.oAuthAccount.findUnique.mockResolvedValue({
      userId: 'u-returning',
    } as never);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u-returning',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).not.toContain('/auth/error');

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.oAuthAccount.create).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();

    expect(mockSetAuthCookies).toHaveBeenCalledTimes(1);
    expect(mockSetCsrfCookie).toHaveBeenCalledTimes(1);
  });

  it('success branch with no app-oauth-next cookie: 302 to APP_URL', async () => {
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);
    // No next cookie.
    prismaMock.oAuthAccount.findUnique.mockResolvedValue({ userId: 'u1' } as never);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc.startsWith('https://app.example.test')).toBe(true);
  });

  it('success branch with valid app-oauth-next cookie: 302 to that path; revalidates same-origin', async () => {
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);
    await seedCookie('app-oauth-next', 'https://app.example.test/dashboard');

    prismaMock.oAuthAccount.findUnique.mockResolvedValue({ userId: 'u1' } as never);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);

    const res = await GET(makeReq({ code: 'c', state: STATE }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.test/dashboard');
  });

  it('clears all 3 ephemeral cookies on every exit branch (success path)', async () => {
    await seedCookie('app-oauth-state', STATE);
    await seedCookie('app-oauth-pkce', PKCE);
    await seedCookie('app-oauth-next', 'https://app.example.test/x');

    prismaMock.oAuthAccount.findUnique.mockResolvedValue({ userId: 'u1' } as never);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);

    await GET(makeReq({ code: 'c', state: STATE }));

    // Each ephemeral cookie has been re-set with maxAge: 0.
    for (const name of ['app-oauth-state', 'app-oauth-pkce', 'app-oauth-next']) {
      const entry = __cookieStore.get(name);
      expect(entry).toBeDefined();
      expect((entry!.options as { maxAge?: number }).maxAge).toBe(0);
    }
  });

  it('NOTIF-05 source check: callback uses createNotification(, never prisma.notification.create(', () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toContain('createNotification(');
    expect(src).not.toMatch(/prisma\.notification\.create\(/);
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
