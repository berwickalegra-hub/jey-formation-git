// WD-01..04 — POST + GET /api/withdrawals.
//
// POST is the financially-critical path: a per-user advisory lock combined
// with a Serializable Prisma transaction is the entire invariant that makes
// concurrent withdrawal attempts safe. The lock MUST be the first awaited
// statement inside the tx (CF-12 in CLAUDE.md / Plan 04-04 D-LOCK-FIRST):
//
//   prisma.$transaction(async (tx) => {
//     await lockUserTx(tx, userId);                    // 1st — queues the user
//     const userRow = await tx.user.findUnique(...);   // PIN hash
//     const guard   = await validateWithdrawalRequest({ prisma: tx, ... });
//     if (!guard.ok) return { ok: false, ... };
//     const w = await tx.withdrawal.create(...);       // PENDING reservation
//     return { ok: true, withdrawal: w };
//   }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
//
// The 8 stable withdrawal-error codes returned by `validateWithdrawalRequest`
// (AMOUNT_BELOW_MIN, AMOUNT_ABOVE_MAX, DAILY_LIMIT_EXCEEDED, COOLDOWN_ACTIVE,
//  PIN_NOT_SET, PIN_REQUIRED, PIN_INVALID, INSUFFICIENT_BALANCE) propagate to
// the wire as JSON `{ code, message }` with the status the guard chose. The
// frontend `api()` wrapper exposes these via `ApiError.code` (CLAUDE.md
// invariant: never switch on the message).
//
// `createNotification` runs AFTER the tx commits (Pitfall 4 — its exported
// signature takes the standalone PrismaClient, not a TransactionClient).
// Idempotency comes from `dedupeKey: withdrawal-requested:${id}`. The
// notification dispatch is wrapped in try/catch so the 201 response is
// never poisoned by a notifications-table failure (the withdrawal is
// already committed at that point).
//
// GET is a cursor-paginated list scoped to the caller. `Withdrawal` uses
// `requestedAt` (not `createdAt`) — we lift the verbatim cursor-on-requestedAt
// pattern from `app/api/admin/withdrawals/route.ts` so the wire format stays
// compatible with frontend cursor consumers.
//
// PROTECTED imports (CLAUDE.md): lock.ts, balance.ts, guards.ts, auth/pin.ts,
// notifications/index.ts, middleware/index.ts, auth.ts. Call only — never modify.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';

import { lockUserTx } from '@/lib/server/withdrawals/lock';
import { createDefaultBalanceComputer } from '@/lib/server/withdrawals/balance';
import { loadGuardConfigFromEnv, validateWithdrawalRequest } from '@/lib/server/withdrawals/guards';
import { verifyPin } from '@/lib/server/auth/pin';
import { createNotification } from '@/lib/server/notifications';

import { clampLimit, decodeCursor, encodeCursor } from '@/lib/server/pagination/paginate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

// ───────────────────────────────────────────────────────────────────────
// Request body schema (D-WD-METHOD-01 + CLAUDE.md "integer smallest unit")
// ───────────────────────────────────────────────────────────────────────
//
// amount: integer, positive — decimals are a financial-safety regression
//   per CLAUDE.md ("Payment amounts are integer in smallest currency unit").
// destination.method: enum WAVE | ORANGE_MONEY | MTN_MOMO (Senegal mobile-money
//   providers; new providers added per-project, not in the starter).
// destination.phone: E.164 (+countrycode + 10–15 digits).
// pin: optional in body — only required when WITHDRAWAL_REQUIRE_PIN=1. The
//   guard chain returns PIN_REQUIRED / PIN_NOT_SET / PIN_INVALID as needed.
//
// Pitfall 1 (RESEARCH): PIN goes in the body, NOT a header. Headers are
// preserved by intermediaries and may end up in proxy logs.
const Body = z.object({
  amount: z.number().int().positive(),
  currency: z.literal('XOF').default('XOF'),
  destination: z.object({
    method: z.enum(['WAVE', 'ORANGE_MONEY', 'MTN_MOMO']),
    phone: z.string().regex(/^\+\d{10,15}$/, 'phone must be E.164 (e.g. +221XXXXXXXX)'),
    accountName: z.string().max(120).optional(),
  }),
  pin: z.string().min(4).max(12).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // 1. CSRF — bail before any auth/db work (T-04-04-08)
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    // 2. Auth
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    // 3. Parse + validate body
    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'INVALID_BODY', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const { amount, currency, destination, pin } = parsed.data;

    // 4. Read env at call-time (Pitfall 5 — supports `vi.stubEnv` in tests).
    //    `WITHDRAWAL_BALANCE_CHECK=0` flips `balanceCheckEnabled` off (T-04-04-05
    //    accepted, documented in `.env.example`).
    const config = loadGuardConfigFromEnv(process.env);
    const computeBalance = createDefaultBalanceComputer(prisma);

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // CF-12: lockUserTx MUST be the FIRST awaited statement inside the tx.
          // Two concurrent POSTs for the same user serialize on this lock —
          // the second one sees the first's PENDING reservation in the balance
          // computation and is correctly rejected as INSUFFICIENT_BALANCE
          // (T-04-04-01, T-04-04-02 mitigated).
          await lockUserTx(tx, auth.user.sub);

          const userRow = await tx.user.findUnique({
            where: { id: auth.user.sub },
            select: { withdrawalPinHash: true },
          });

          const guard = await validateWithdrawalRequest({
            prisma: tx,
            config,
            userId: auth.user.sub,
            amount,
            ...(pin !== undefined ? { pin } : {}),
            withdrawalPinHash: userRow?.withdrawalPinHash ?? null,
            computeBalance,
            bcryptCompare: verifyPin,
          });
          if (!guard.ok) {
            return {
              ok: false as const,
              status: guard.status,
              code: guard.code,
              message: guard.message,
            };
          }

          const w = await tx.withdrawal.create({
            data: {
              userId: auth.user.sub,
              amount,
              currency,
              status: 'PENDING',
              destination: destination as Prisma.InputJsonValue,
              provider: 'bictorys',
            },
            select: {
              id: true,
              status: true,
              amount: true,
              currency: true,
              requestedAt: true,
            },
          });

          return { ok: true as const, withdrawal: w };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!result.ok) {
        return NextResponse.json(
          { code: result.code, message: result.message },
          { status: result.status, headers: { 'x-request-id': ctx.requestId } },
        );
      }

      // Post-commit notification (Pitfall 4 — `createNotification` takes a
      // `PrismaClient`, not a `TransactionClient`; D-WD-NOTIF defers the
      // signature widening to a future cleanup phase). The dedupeKey makes
      // any retry idempotent. A failure here must NOT poison the response —
      // the withdrawal is already committed (T-04-04-11).
      try {
        await createNotification(prisma, {
          userId: auth.user.sub,
          type: 'WITHDRAWAL_REQUESTED',
          title: 'Withdrawal requested',
          body: `Withdrawal of ${amount} ${currency} is pending.`,
          data: {
            withdrawalId: result.withdrawal.id,
            amount,
            currency,
          },
          dedupeKey: `withdrawal-requested:${result.withdrawal.id}`,
        });
      } catch {
        // Swallow — `createNotification` already returns null on P2002 dedup
        // hits; a thrown error here is some other DB hiccup. The withdrawal
        // commit is preserved.
      }

      return NextResponse.json(
        { withdrawalId: result.withdrawal.id, status: result.withdrawal.status },
        { status: 201, headers: { 'x-request-id': ctx.requestId } },
      );
    } catch (err) {
      // P2034 — Serializable isolation aborted due to a concurrent update.
      // The advisory lock makes this rare; surface it as a transient 409 so
      // the client can decide whether to retry (CLAUDE.md: frontend `api()`
      // does NOT auto-retry POSTs — a duplicate withdrawal is worse than a
      // surfaced error).
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === 'P2034'
      ) {
        return NextResponse.json(
          { code: 'TRANSIENT_CONFLICT', message: 'Please retry' },
          { status: 409, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw err;
    }
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    // Pitfall 2: `Withdrawal` has no `createdAt` — its primary timestamp is
    // `requestedAt`. We re-use the shared cursor wire format ({ createdAt, id })
    // but bind it to `requestedAt` here. Lifted verbatim from
    // app/api/admin/withdrawals/route.ts lines 80–101.
    const where: Prisma.WithdrawalWhereInput = {
      userId: auth.user.sub,
      ...(cursor
        ? {
            OR: [
              { requestedAt: { lt: cursor.createdAt } },
              { requestedAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await prisma.withdrawal.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        destination: true,
        requestedAt: true,
        processedAt: true,
        completedAt: true,
        failureReason: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.requestedAt, id: last.id }) : null;

    return NextResponse.json({ items, nextCursor }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
