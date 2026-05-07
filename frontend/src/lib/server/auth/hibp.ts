// Source: RESEARCH.md Pattern 4 — D-13 HIBP k-anonymity password check.
// Sends only the first 5 chars of SHA-1(password); never the full password
// or full hash. Fail-open on network failure / non-2xx / timeout — HIBP outage
// must NOT block signup.
//
// Opt-in via PASSWORD_HIBP_CHECK=1 env. Default OFF.
import 'server-only';
import { createHash } from 'node:crypto';
import { log } from '@/lib/server/observability/log';

const HIBP_BASE = 'https://api.pwnedpasswords.com/range/';
const USER_AGENT = 'amadou-monolith-auth/1';
const TIMEOUT_MS = 2_000;

/**
 * Returns the breach count for `password` if found in HIBP, or 0 if not found.
 *
 * On network failure / timeout / non-2xx: logs warn and returns 0
 * (D-13 fail-open — HIBP degradation must not block legitimate signup).
 */
export async function pwnedCount(password: string): Promise<number> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HIBP_BASE + prefix, {
      // 'Add-Padding: true' asks HIBP to pad responses to fixed size, defending
      // against length-based traffic analysis (HIBP recommended since 2020).
      headers: { 'User-Agent': USER_AGENT, 'Add-Padding': 'true' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      log.warn('hibp non-2xx', { status: res.status });
      return 0;
    }
    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      const s = trimmed.slice(0, idx);
      const c = trimmed.slice(idx + 1);
      if (s === suffix) return Number.parseInt(c, 10) || 0;
    }
    return 0;
  } catch (err) {
    log.warn('hibp request failed (allow)', {
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Convenience predicate. */
export async function isPwned(password: string): Promise<boolean> {
  return (await pwnedCount(password)) > 0;
}
