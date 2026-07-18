import type { Prisma, PrismaClient } from '@prisma/client';

type XpClient = PrismaClient | Prisma.TransactionClient;

// XP granted per action. Kept as a single map so tuning doesn't require
// touching call sites (posts/comments/lesson-complete routes).
export const XP_AWARD = {
  POST: 10,
  COMMENT: 5,
  LESSON_COMPLETE: 15,
} as const;

// Simple linear level curve: 100 xp per level, level 1 at xp=0.
export function levelForXp(xp: number): number {
  return Math.floor(xp / 100) + 1;
}

/** Adds xp to a user and recomputes their level. Safe to call inside a transaction. */
export async function awardXp(
  db: XpClient,
  userId: string,
  amount: number,
): Promise<{ xp: number; level: number }> {
  const user = await db.user.update({
    where: { id: userId },
    data: { xp: { increment: amount } },
    select: { xp: true },
  });
  const level = levelForXp(user.xp);
  await db.user.update({ where: { id: userId }, data: { level } });
  return { xp: user.xp, level };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // UTC calendar day, e.g. "2026-07-18"
}

/**
 * Bumps the daily login/activity streak. No-ops if the user was already
 * active today; increments if their last activity was exactly yesterday;
 * resets to 1 otherwise (first-ever activity, or a gap of 2+ days).
 */
export async function touchStreak(db: XpClient, userId: string): Promise<number> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { lastActiveAt: true, streakCount: true },
  });

  const now = new Date();
  const today = dayKey(now);

  if (user.lastActiveAt && dayKey(user.lastActiveAt) === today) {
    return user.streakCount; // already counted today
  }

  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const wasYesterday = user.lastActiveAt !== null && dayKey(user.lastActiveAt) === yesterday;
  const streakCount = wasYesterday ? user.streakCount + 1 : 1;

  await db.user.update({ where: { id: userId }, data: { streakCount, lastActiveAt: now } });
  return streakCount;
}
