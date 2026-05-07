import { describe, it, expect, beforeEach, vi } from 'vitest';

const getRedisMock = vi.fn();
vi.mock('@/lib/server/redis', () => ({
  getRedis: () => getRedisMock(),
}));

const { acquireRefreshLock } = await import('./refresh-lock');

describe('acquireRefreshLock — Redis path', () => {
  let redisStub: {
    set: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    redisStub = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    getRedisMock.mockReturnValue(redisStub);
  });

  it('returns a release fn when SETNX succeeds', async () => {
    redisStub.set.mockResolvedValueOnce('OK');
    const release = await acquireRefreshLock('u-redis-1');
    expect(release).toBeInstanceOf(Function);
    expect(redisStub.set).toHaveBeenCalledWith(
      'refresh-lock:u-redis-1',
      expect.any(String),
      { nx: true, ex: 5 },
    );
  });

  it('returns null when SETNX returns null (lock held)', async () => {
    redisStub.set.mockResolvedValueOnce(null);
    const release = await acquireRefreshLock('u-redis-2');
    expect(release).toBeNull();
  });

  it('release fn calls eval with compare-and-delete Lua + key + token', async () => {
    redisStub.set.mockResolvedValueOnce('OK');
    const release = await acquireRefreshLock('u-redis-3');
    expect(release).not.toBeNull();
    await release!();
    expect(redisStub.eval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = redisStub.eval.mock.calls[0]!;
    expect(script).toContain("redis.call('get', KEYS[1])");
    expect(script).toContain("redis.call('del', KEYS[1])");
    expect(keys).toEqual(['refresh-lock:u-redis-3']);
    expect(Array.isArray(args)).toBe(true);
    expect(args).toHaveLength(1);
    // Token is a UUID v4 string.
    expect(args[0]).toMatch(/^[0-9a-f-]+$/i);
  });

  it('release fn does not throw when eval rejects (logs + swallows)', async () => {
    redisStub.set.mockResolvedValueOnce('OK');
    redisStub.eval.mockRejectedValueOnce(new Error('redis flake'));
    const release = await acquireRefreshLock('u-redis-4');
    await expect(release!()).resolves.toBeUndefined();
  });
});

describe('acquireRefreshLock — memory fallback (getRedis returns null)', () => {
  beforeEach(() => {
    getRedisMock.mockReturnValue(null);
  });

  it('first acquire succeeds, second concurrent acquire returns null', async () => {
    const release1 = await acquireRefreshLock('u-mem-1');
    expect(release1).toBeInstanceOf(Function);

    const release2 = await acquireRefreshLock('u-mem-1');
    expect(release2).toBeNull();

    // Release first; subsequent acquire should succeed again.
    await release1!();
    const release3 = await acquireRefreshLock('u-mem-1');
    expect(release3).toBeInstanceOf(Function);
    await release3!();
  });

  it('different userIds do not interfere', async () => {
    const a = await acquireRefreshLock('u-mem-a');
    const b = await acquireRefreshLock('u-mem-b');
    expect(a).toBeInstanceOf(Function);
    expect(b).toBeInstanceOf(Function);
    await a!();
    await b!();
  });
});
