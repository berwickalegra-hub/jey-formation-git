/**
 * createNotification — single entry point for every Notification row.
 *
 * The Notification.dedupeKey @unique constraint is the at-most-once
 * delivery gate (mirrors the cagnottes.sn P01 + P06 pattern). Project
 * code MUST always go through this function — never call
 * `prisma.notification.create` inline. Typed wrappers (e.g.
 * `fireWelcome(userId)`) live in `templates.ts`.
 */
import type { PrismaClient, Notification, Prisma } from '@prisma/client';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Caller-supplied — must be deterministic for the dedup window. */
  dedupeKey: string;
}

/**
 * Returns the created Notification row, or `null` if the dedupeKey already
 * exists (silently deduplicated).
 *
 * Other Prisma errors are re-thrown so callers can decide whether to retry.
 */
export async function createNotification(
  prisma: PrismaClient,
  input: CreateNotificationInput,
): Promise<Notification | null> {
  try {
    return await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        dedupeKey: input.dedupeKey,
        data: (input.data ?? null) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      },
    });
  } catch (err) {
    // Duck-typed P2002 catch (Prisma unique violation). Mirrors slug.ts
    // pattern from Phase 1 — works across Prisma client edge cases that
    // don't always tag the error with the proper subclass.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 'P2002'
    ) {
      return null;
    }
    throw err;
  }
}
