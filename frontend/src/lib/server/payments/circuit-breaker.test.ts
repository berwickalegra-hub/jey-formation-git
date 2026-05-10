// TEST-02 — companion unit test for `payments/circuit-breaker.ts` (PROTECTED lib).
//
// State machine under test:
//   CLOSED → [N failures within windowMs] → OPEN
//   OPEN   → [cooldownMs elapsed]         → HALF_OPEN  (next call probes)
//   HALF_OPEN → [1 success]               → CLOSED
//   HALF_OPEN → [1 failure]               → OPEN       (cooldown resets)
//
// Uses `vi.useFakeTimers()` so cooldown transitions are deterministic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CircuitBreaker (TEST-02)', () => {
  it('starts CLOSED and forwards calls', async () => {
    const cb = new CircuitBreaker({ name: 'test-1' });
    expect(cb.state()).toBe('closed');

    const result = await cb.execute(async () => 'ok');

    expect(result).toBe('ok');
    expect(cb.state()).toBe('closed');
  });

  it('opens after N consecutive failures (per ctor threshold)', async () => {
    const cb = new CircuitBreaker({ name: 'test-2', failureThreshold: 3 });
    const fn = vi.fn().mockRejectedValue(new Error('upstream down'));

    // Trip the breaker — exactly `failureThreshold` failures.
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fn)).rejects.toThrow('upstream down');
    }
    expect(cb.state()).toBe('open');
  });

  it('refuses with CircuitOpenError while OPEN — does not invoke fn', async () => {
    const cb = new CircuitBreaker({ name: 'test-3', failureThreshold: 2, cooldownMs: 60_000 });
    const fn = vi.fn().mockRejectedValue(new Error('upstream down'));

    // Trip.
    await expect(cb.execute(fn)).rejects.toThrow();
    await expect(cb.execute(fn)).rejects.toThrow();
    expect(cb.state()).toBe('open');

    const callCountAtTrip = fn.mock.calls.length;

    // While OPEN, the next execute() must throw CircuitOpenError without
    // invoking fn.
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn.mock.calls.length).toBe(callCountAtTrip);
  });

  it('transitions OPEN → HALF_OPEN after cooldown ms', async () => {
    const cb = new CircuitBreaker({ name: 'test-4', failureThreshold: 2, cooldownMs: 60_000 });
    const fn = vi.fn().mockRejectedValue(new Error('upstream down'));

    // Trip into OPEN.
    await expect(cb.execute(fn)).rejects.toThrow();
    await expect(cb.execute(fn)).rejects.toThrow();
    expect(cb.state()).toBe('open');

    // Advance past the cooldown.
    vi.advanceTimersByTime(60_001);
    expect(cb.state()).toBe('half-open');
  });

  it('returns to CLOSED on a successful HALF_OPEN probe', async () => {
    const cb = new CircuitBreaker({ name: 'test-5', failureThreshold: 2, cooldownMs: 60_000 });
    const failing = vi.fn().mockRejectedValue(new Error('upstream down'));
    const ok = vi.fn().mockResolvedValue('recovered');

    // Trip.
    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();
    expect(cb.state()).toBe('open');

    // Cool down.
    vi.advanceTimersByTime(60_001);
    expect(cb.state()).toBe('half-open');

    // Successful probe closes.
    const result = await cb.execute(ok);
    expect(result).toBe('recovered');
    expect(cb.state()).toBe('closed');
  });

  it('re-opens with fresh cooldown when HALF_OPEN probe fails', async () => {
    const cb = new CircuitBreaker({ name: 'test-6', failureThreshold: 2, cooldownMs: 60_000 });
    const failing = vi.fn().mockRejectedValue(new Error('upstream down'));

    // Trip.
    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();
    expect(cb.state()).toBe('open');

    // Cool down to HALF_OPEN.
    vi.advanceTimersByTime(60_001);
    expect(cb.state()).toBe('half-open');

    // Probe fails — back to OPEN.
    await expect(cb.execute(failing)).rejects.toThrow('upstream down');
    expect(cb.state()).toBe('open');
  });

  it('reset() force-clears state back to CLOSED', async () => {
    const cb = new CircuitBreaker({ name: 'test-7', failureThreshold: 2, cooldownMs: 60_000 });
    const failing = vi.fn().mockRejectedValue(new Error('upstream down'));

    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();
    expect(cb.state()).toBe('open');

    cb.reset();
    expect(cb.state()).toBe('closed');
  });

  it('retryAt() returns a sensible Date when OPEN', async () => {
    const cb = new CircuitBreaker({ name: 'test-8', failureThreshold: 1, cooldownMs: 60_000 });
    const failing = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(cb.execute(failing)).rejects.toThrow();

    const retry = cb.retryAt();
    expect(retry).toBeInstanceOf(Date);
    // Should be the trip time + cooldown.
    expect(retry.getTime()).toBe(new Date('2026-01-01T00:01:00Z').getTime());
  });
});
