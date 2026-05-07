import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { isPwned, pwnedCount } from './hibp';

// Compute the SHA-1 prefix/suffix for a known plaintext so tests can craft
// realistic mock responses.
function sha1Hex(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();
}

describe('hibp.pwnedCount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T00:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends GET with correct prefix URL + User-Agent + Add-Padding headers', async () => {
    const password = 'P@ssw0rd-2026';
    const hex = sha1Hex(password);
    const prefix = hex.slice(0, 5);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    await pwnedCount(password);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('amadou-monolith-auth/1');
    expect(headers['Add-Padding']).toBe('true');
  });

  it('returns the breach count when suffix matches', async () => {
    const password = 'hello-world';
    const hex = sha1Hex(password);
    const suffix = hex.slice(5);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`${suffix}:42\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n`, {
        status: 200,
      }),
    );

    expect(await pwnedCount(password)).toBe(42);
  });

  it('returns 0 when suffix not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n', { status: 200 }),
    );
    expect(await pwnedCount('nonexistent-password-xyz-987')).toBe(0);
  });

  it('returns 0 on non-2xx (fail-open per D-13)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    expect(await pwnedCount('whatever')).toBe(0);
  });

  it('returns 0 on fetch rejection (fail-open per D-13)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    expect(await pwnedCount('whatever')).toBe(0);
  });

  it('returns 0 on AbortError / timeout (fail-open per D-13)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    // Don't actually wait the full 2s — drive the timer.
    const promise = pwnedCount('whatever');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await promise).toBe(0);
  });
});

describe('hibp.isPwned', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when count > 0', async () => {
    const password = 'common';
    const hex = sha1Hex(password);
    const suffix = hex.slice(5);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`${suffix}:7\n`, { status: 200 }));
    expect(await isPwned(password)).toBe(true);
  });

  it('returns false when count is 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n', { status: 200 }),
    );
    expect(await isPwned('weird-password-2026-xyzpdq')).toBe(false);
  });
});
