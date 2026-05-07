// Source: planner-derived; covers OBS-04 logger-wrapper half.
// Asserts the wrapper injects requestId from ALS into every log emit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestLogger } from './log';
import { makeRequestContext, withRequestContext } from './request-context';

describe('createRequestLogger (OBS-04)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const log = createRequestLogger({ env: 'development' });

  beforeEach(() => {
    // Capture console output. The base logger writes to console.log for
    // info/debug/warn and console.error for error.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('omits requestId when called outside any ALS context', () => {
    log.info('hello');
    expect(logSpy).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls[0]![0] as string;
    expect(out).not.toContain('requestId');
  });

  it('adds requestId when called inside withRequestContext', async () => {
    const ctx = makeRequestContext(new Headers());
    await withRequestContext(ctx, async () => {
      log.info('inside');
    });
    // The base logger emits in dev format: `[info] inside {"requestId":"..."}`.
    const out = logSpy.mock.calls[0]![0] as string;
    expect(out).toContain('requestId');
    expect(out).toContain(ctx.requestId);
  });

  it('preserves user-supplied ctx and adds requestId on top', async () => {
    const ctx = makeRequestContext(new Headers());
    await withRequestContext(ctx, async () => {
      log.info('hi', { userId: 'u1' });
    });
    const out = logSpy.mock.calls[0]![0] as string;
    expect(out).toContain('userId');
    expect(out).toContain('u1');
    expect(out).toContain(ctx.requestId);
  });

  it('passes user-supplied ctx unchanged when outside ALS scope', () => {
    log.info('hi', { foo: 'bar' });
    const out = logSpy.mock.calls[0]![0] as string;
    expect(out).toContain('foo');
    expect(out).toContain('bar');
    expect(out).not.toContain('requestId');
  });

  it('injects requestId on all four log levels', async () => {
    const ctx = makeRequestContext(new Headers());
    await withRequestContext(ctx, async () => {
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
    });
    // info/debug/warn → console.log (3 calls); error → console.error (1 call).
    expect(logSpy.mock.calls.length).toBe(3);
    expect(errorSpy.mock.calls.length).toBe(1);
    // Each call's first argument should mention the requestId.
    for (const call of [...logSpy.mock.calls, ...errorSpy.mock.calls]) {
      expect(call[0] as string).toContain(ctx.requestId);
    }
  });
});
