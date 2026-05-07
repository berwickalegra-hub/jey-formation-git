// Source: RESEARCH.md Example 3 + planner-added startedAt assertion.
// Covers OBS-04 — ALS-backed request context.
import { describe, expect, it } from 'vitest';
import {
  makeRequestContext,
  withRequestContext,
  getRequestId,
  getRequestContext,
} from './request-context';

describe('makeRequestContext', () => {
  it('mints a UUID when no inbound header is present', () => {
    const ctx = makeRequestContext(new Headers());
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('reuses a valid inbound X-Request-Id', () => {
    const id = 'abcdef12-1234-5678-9abc-def012345678';
    const ctx = makeRequestContext(new Headers({ 'x-request-id': id }));
    expect(ctx.requestId).toBe(id);
  });

  it('rejects malformed inbound X-Request-Id and mints a fresh one', () => {
    // Headers constructor itself rejects literal newlines (WHATWG spec), so
    // an attacker cannot inject `\n` directly. The regex defends against the
    // remaining surface: non-hex characters, wrong length, embedded quotes
    // that could break log parsers.
    const cases = [
      'evil log-poison', // spaces (invalid hex)
      'short', // too short (< 8 chars)
      'a'.repeat(65), // too long (> 64 chars)
      'not-a-uuid-but-has-bad-chars-!@#$', // disallowed punctuation
      '"injected"', // quotes that could break JSON log parsers
    ];
    for (const bad of cases) {
      const ctx = makeRequestContext(new Headers({ 'x-request-id': bad }));
      expect(ctx.requestId).not.toBe(bad);
      expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('records startedAt within 1s of now', () => {
    const before = Date.now();
    const ctx = makeRequestContext(new Headers());
    const after = Date.now();
    expect(ctx.startedAt).toBeGreaterThanOrEqual(before);
    expect(ctx.startedAt).toBeLessThanOrEqual(after);
  });
});

describe('withRequestContext', () => {
  it('preserves the request ID across await boundaries', async () => {
    const ctx = makeRequestContext(new Headers());
    const seen = await withRequestContext(ctx, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getRequestId();
    });
    expect(seen).toBe(ctx.requestId);
  });

  it('exposes the entire context to nested code', async () => {
    const ctx = makeRequestContext(new Headers());
    const seen = await withRequestContext(ctx, async () => {
      await Promise.resolve();
      return getRequestContext();
    });
    expect(seen).toEqual(ctx);
  });

  it('returns undefined outside any context', () => {
    expect(getRequestId()).toBeUndefined();
    expect(getRequestContext()).toBeUndefined();
  });
});
