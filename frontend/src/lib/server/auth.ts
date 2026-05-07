import 'server-only';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

// ───────────────────────────────────────────────────────────────────────
// JWT secret + entropy guards
// ───────────────────────────────────────────────────────────────────────

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) {
  throw new Error('JWT_SECRET is required. Set it in .env');
}
if (rawSecret.length < 32) {
  throw new Error(
    `JWT_SECRET too short (${rawSecret.length} chars). Use at least 32 chars. Generate one with: openssl rand -base64 48`,
  );
}
if (/^(change[-_ ]?me|secret|password|test|dev|todo|placeholder)/i.test(rawSecret)) {
  throw new Error(
    'JWT_SECRET looks like a default placeholder. Regenerate with: openssl rand -base64 48',
  );
}
export const JWT_SECRET_BYTES = new TextEncoder().encode(rawSecret);

// ───────────────────────────────────────────────────────────────────────
// Cookie names
// ───────────────────────────────────────────────────────────────────────

const COOKIE_PREFIX = process.env.COOKIE_PREFIX || 'app';
export const COOKIE_NAME = `${COOKIE_PREFIX}-token`;
export const REFRESH_COOKIE_NAME = `${COOKIE_PREFIX}-refresh`;
export const CSRF_COOKIE_NAME = `${COOKIE_PREFIX}-csrf`;
const CSRF_HEADER_NAME = 'x-csrf-token';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const ACCESS_COOKIE_MAX_AGE = 15 * 60; // 15 min in seconds (Next.js cookies API)
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
const CSRF_COOKIE_MAX_AGE = REFRESH_COOKIE_MAX_AGE;

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

function cookieDomain(): string | undefined {
  return isProd() ? process.env.COOKIE_DOMAIN || undefined : undefined;
}

// ───────────────────────────────────────────────────────────────────────
// Cookie helpers — async because Next.js 15+ `cookies()` is async in
// route handlers. Each helper fetches the cookie store internally.
// ───────────────────────────────────────────────────────────────────────

export async function setAuthCookies(accessToken: string, refreshToken: string): Promise<void> {
  const store = await cookies();
  const domain = cookieDomain();
  store.set(COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    maxAge: ACCESS_COOKIE_MAX_AGE,
    path: '/',
    ...(domain ? { domain } : {}),
  });
  store.set(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/api/auth',
    ...(domain ? { domain } : {}),
  });
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  const domain = cookieDomain();
  store.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    ...(domain ? { domain } : {}),
  });
  store.set(REFRESH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    maxAge: 0,
    path: '/api/auth',
    ...(domain ? { domain } : {}),
  });
}

export async function setCsrfCookie(): Promise<string> {
  const store = await cookies();
  const domain = cookieDomain();
  const csrfToken = crypto.randomBytes(32).toString('hex');
  store.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false, // must be readable by JS
    secure: isProd(),
    sameSite: 'lax',
    maxAge: CSRF_COOKIE_MAX_AGE,
    path: '/',
    ...(domain ? { domain } : {}),
  });
  return csrfToken;
}

export async function clearCsrfCookie(): Promise<void> {
  const store = await cookies();
  store.set(CSRF_COOKIE_NAME, '', {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

// ───────────────────────────────────────────────────────────────────────
// Tokens
// ───────────────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: string;
  email: string;
  /** Bumped on password change so old tokens are rejected. */
  tokenVersion?: number;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createAccessToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET_BYTES);
}

export async function createRefreshToken(sub: string, tokenVersion: number = 0): Promise<string> {
  return new SignJWT({ sub, type: 'refresh', tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(JWT_SECRET_BYTES);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_BYTES);
    const tokenType = (payload as Record<string, unknown>).type;
    if (tokenType === 'refresh') return null;
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(
  token: string,
): Promise<{ sub: string; tokenVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_BYTES);
    const tokenType = (payload as Record<string, unknown>).type;
    if (tokenType !== 'refresh') return null;
    const sub = payload.sub as string | undefined;
    if (!sub) return null;
    const tokenVersion = (payload as Record<string, unknown>).tokenVersion as number | undefined;
    return { sub, tokenVersion: tokenVersion ?? 0 };
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────
// CSRF helper — call at top of any mutating route handler.
// Returns null if valid (continue), or a NextResponse 403 to short-circuit.
// ───────────────────────────────────────────────────────────────────────

export function verifyCsrf(req: NextRequest): NextResponse | null {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return null;

  const headerToken = req.headers.get(CSRF_HEADER_NAME);
  if (!headerToken) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (cookieToken) {
    const cookieBuf = Buffer.from(cookieToken);
    const headerBuf = Buffer.from(headerToken);
    if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
  }

  return null;
}

// ───────────────────────────────────────────────────────────────────────
// Verification codes (8-char Crockford alphanumeric)
// ───────────────────────────────────────────────────────────────────────

const VERIFICATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const VERIFICATION_CODE_LENGTH = 8;

export function generateVerificationCode(): string {
  const bytes = crypto.randomBytes(VERIFICATION_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
    out += VERIFICATION_CODE_ALPHABET[bytes[i]! % VERIFICATION_CODE_ALPHABET.length];
  }
  return out;
}

export const VERIFICATION_CODE_REGEX = new RegExp(
  `^[${VERIFICATION_CODE_ALPHABET}]{${VERIFICATION_CODE_LENGTH}}$`,
);

export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
