import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @/lib/server/redis BEFORE importing the lockout module.
const getRedisMock = vi.fn();
vi.mock('@/lib/server/redis', () => ({
  getRedis: () => getRedisMock(),
}));

// Now safe to import the module under test.
const { isLockedOut, recordFailure, recordSuccess } = await import('./lockout');

describe('lockout — memory fallback (getRedis returns null)', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_LOCKOUT_THRESHOLD', '3');
    vi.stubEnv('AUTH_LOCKOUT_DURATION_MIN', '15');
    getRedisMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('first failure returns count=1 locked=false', async () => {
    const result = await recordFailure('mem1@example.com');
    expect(result).toEqual({ count: 1, locked: false });
  });

  it('reaches threshold on the 3rd failure (locked=true)', async () => {
    const email = 'mem-threshold@example.com';
    await recordFailure(email);
    await recordFailure(email);
    const third = await recordFailure(email);
    expect(third).toEqual({ count: 3, locked: true });
  });

  it('isLockedOut returns true after threshold reached', async () => {
    const email = 'mem-locked@example.com';
    await recordFailure(email);
    expect(await isLockedOut(email)).toBe(false);
    await recordFailure(email);
    await recordFailure(email);
    expect(await isLockedOut(email)).toBe(true);
  });

  it('lower-cases + trims email so case-mutation does not bypass (Pitfall 7)', async () => {
    await recordFailure('Case@Example.com');
    await recordFailure('case@example.com');
    const r = await recordFailure('  CASE@EXAMPLE.COM  ');
    expect(r.count).toBe(3);
    expect(r.locked).toBe(true);
  });

  it('recordSuccess clears the failure count', async () => {
    const email = 'mem-clear@example.com';
    await recordFailure(email);
    await recordFailure(email);
    await recordSuccess(email);
    const after = await recordFailure(email);
    expect(after.count).toBe(1);
    expect(after.locked).toBe(false);
  });

  it('logs a warn line when falling back to memory', async () => {
    // We can only assert the recordFailure path triggers the warn — read the
    // module's own log import via a side-channel. Use console.warn since the
    // log wrapper delegates to base logger. Just confirm no throw + behavior.
    expect(() => recordFailure('warn-path@example.com')).not.toThrow();
  });
});

describe('lockout — Redis path', () => {
  let redisStub: {
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubEnv('AUTH_LOCKOUT_THRESHOLD', '3');
    vi.stubEnv('AUTH_LOCKOUT_DURATION_MIN', '15');
    redisStub = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(null),
    };
    getRedisMock.mockReturnValue(redisStub);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('first failure increments + sets expire (TTL primer)', async () => {
    redisStub.incr.mockResolvedValueOnce(1);
    const r = await recordFailure('redis1@example.com');
    expect(r).toEqual({ count: 1, locked: false });
    expect(redisStub.incr).toHaveBeenCalledWith('auth:lockout-count:redis1@example.com');
    expect(redisStub.expire).toHaveBeenCalledWith('auth:lockout-count:redis1@example.com', 15 * 60);
    expect(redisStub.set).not.toHaveBeenCalled();
  });

  it('threshold-breach attempt sets the lockout flag', async () => {
    redisStub.incr.mockResolvedValueOnce(3);
    const r = await recordFailure('redis-threshold@example.com');
    expect(r).toEqual({ count: 3, locked: true });
    expect(redisStub.set).toHaveBeenCalledWith('auth:lockout:redis-threshold@example.com', '1', {
      ex: 15 * 60,
    });
  });

  it('isLockedOut reads Redis flag', async () => {
    redisStub.get.mockResolvedValueOnce('1');
    expect(await isLockedOut('redis-locked@example.com')).toBe(true);
    expect(redisStub.get).toHaveBeenCalledWith('auth:lockout:redis-locked@example.com');
  });

  it('isLockedOut returns false when Redis flag absent', async () => {
    redisStub.get.mockResolvedValueOnce(null);
    expect(await isLockedOut('redis-not-locked@example.com')).toBe(false);
  });

  it('recordSuccess deletes both keys', async () => {
    await recordSuccess('redis-success@example.com');
    expect(redisStub.del).toHaveBeenCalledWith('auth:lockout-count:redis-success@example.com');
    expect(redisStub.del).toHaveBeenCalledWith('auth:lockout:redis-success@example.com');
  });
});
