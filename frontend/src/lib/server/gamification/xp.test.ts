import { describe, it, expect, vi } from 'vitest';
import { awardXp, touchStreak, levelForXp, XP_AWARD } from './xp';
import type { PrismaClient } from '@prisma/client';

function makeDb(overrides: {
  update?: ReturnType<typeof vi.fn>;
  findUniqueOrThrow?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: {
      update: overrides.update ?? vi.fn(),
      findUniqueOrThrow: overrides.findUniqueOrThrow ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('levelForXp', () => {
  it('is level 1 at 0 xp and bumps every 100 xp', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(250)).toBe(3);
  });
});

describe('awardXp', () => {
  it('increments xp then persists the recomputed level', async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({ xp: 110 }) // increment result
      .mockResolvedValueOnce({}); // level write
    const db = makeDb({ update });

    const result = await awardXp(db, 'user_1', XP_AWARD.LESSON_COMPLETE);

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 'user_1' },
      data: { xp: { increment: 15 } },
      select: { xp: true },
    });
    expect(update).toHaveBeenNthCalledWith(2, { where: { id: 'user_1' }, data: { level: 2 } });
    expect(result).toEqual({ xp: 110, level: 2 });
  });
});

describe('touchStreak', () => {
  it('no-ops (does not write) when already active today', async () => {
    const now = new Date('2026-07-18T12:00:00.000Z');
    vi.useFakeTimers().setSystemTime(now);
    const update = vi.fn();
    const findUniqueOrThrow = vi
      .fn()
      .mockResolvedValue({ lastActiveAt: new Date('2026-07-18T01:00:00.000Z'), streakCount: 4 });
    const db = makeDb({ update, findUniqueOrThrow });

    const streak = await touchStreak(db, 'user_1');

    expect(streak).toBe(4);
    expect(update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('increments the streak when last active exactly yesterday', async () => {
    const now = new Date('2026-07-18T12:00:00.000Z');
    vi.useFakeTimers().setSystemTime(now);
    const update = vi.fn().mockResolvedValue({});
    const findUniqueOrThrow = vi
      .fn()
      .mockResolvedValue({ lastActiveAt: new Date('2026-07-17T23:00:00.000Z'), streakCount: 4 });
    const db = makeDb({ update, findUniqueOrThrow });

    const streak = await touchStreak(db, 'user_1');

    expect(streak).toBe(5);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { streakCount: 5, lastActiveAt: now },
    });
    vi.useRealTimers();
  });

  it('resets the streak to 1 after a gap of 2+ days or first-ever activity', async () => {
    const now = new Date('2026-07-18T12:00:00.000Z');
    vi.useFakeTimers().setSystemTime(now);
    const update = vi.fn().mockResolvedValue({});
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ lastActiveAt: null, streakCount: 0 });
    const db = makeDb({ update, findUniqueOrThrow });

    const streak = await touchStreak(db, 'user_1');

    expect(streak).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { streakCount: 1, lastActiveAt: now },
    });
    vi.useRealTimers();
  });
});
