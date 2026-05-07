import type { PrismaClient } from '@prisma/client';
import type { TxClient } from './lock';

export interface WithdrawalGuardConfig {
  minAmount: number; // default 1 (must withdraw positive)
  maxAmount: number | null; // null = unlimited
  dailyLimit: number | null; // null = unlimited
  cooldownHours: number; // default 0
  requirePin: boolean; // default false
  balanceCheckEnabled: boolean; // default true
}

function parseIntOr(v: string | undefined, fallback: number | null): number | null {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function loadGuardConfigFromEnv(env: NodeJS.ProcessEnv): WithdrawalGuardConfig {
  return {
    minAmount: parseIntOr(env.WITHDRAWAL_MIN_AMOUNT, 1) ?? 1,
    maxAmount: parseIntOr(env.WITHDRAWAL_MAX_AMOUNT, null),
    dailyLimit: parseIntOr(env.WITHDRAWAL_DAILY_LIMIT, null),
    cooldownHours: parseIntOr(env.WITHDRAWAL_COOLDOWN_HOURS, 0) ?? 0,
    requirePin: env.WITHDRAWAL_REQUIRE_PIN === '1' || env.WITHDRAWAL_REQUIRE_PIN === 'true',
    balanceCheckEnabled:
      env.WITHDRAWAL_BALANCE_CHECK !== '0' && env.WITHDRAWAL_BALANCE_CHECK !== 'false',
  };
}

export type GuardResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

export interface ValidateInput {
  /**
   * Either the standalone Prisma client (legacy callers) or an active
   * transaction client (preferred — required for race-free balance reads).
   */
  prisma: PrismaClient | TxClient;
  config: WithdrawalGuardConfig;
  userId: string;
  amount: number;
  pin?: string | undefined;
  withdrawalPinHash: string | null;
  /**
   * Balance computer; passed the same client as above so reads happen
   * inside the calling transaction when one is open.
   */
  computeBalance: (userId: string, tx?: TxClient) => Promise<number>;
  bcryptCompare: (plain: string, hash: string) => Promise<boolean>;
}

/**
 * Run all configured financial guards. Return early on first failure with a stable code.
 * Codes (for frontend to localize/handle):
 *   AMOUNT_BELOW_MIN | AMOUNT_ABOVE_MAX | DAILY_LIMIT_EXCEEDED | COOLDOWN_ACTIVE
 *   PIN_REQUIRED | PIN_NOT_SET | PIN_INVALID | INSUFFICIENT_BALANCE
 */
export async function validateWithdrawalRequest(input: ValidateInput): Promise<GuardResult> {
  const { prisma, config, userId, amount, pin, withdrawalPinHash, computeBalance, bcryptCompare } =
    input;

  // 1. Amount bounds
  if (amount < config.minAmount) {
    return {
      ok: false,
      status: 422,
      code: 'AMOUNT_BELOW_MIN',
      message: `Amount must be at least ${config.minAmount}`,
    };
  }
  if (config.maxAmount !== null && amount > config.maxAmount) {
    return {
      ok: false,
      status: 422,
      code: 'AMOUNT_ABOVE_MAX',
      message: `Amount must not exceed ${config.maxAmount}`,
    };
  }

  // 2. PIN
  if (config.requirePin) {
    if (!withdrawalPinHash) {
      return {
        ok: false,
        status: 403,
        code: 'PIN_NOT_SET',
        message: 'Withdrawal PIN must be set before requesting a withdrawal',
      };
    }
    if (!pin) {
      return {
        ok: false,
        status: 403,
        code: 'PIN_REQUIRED',
        message: 'Withdrawal PIN is required',
      };
    }
    const valid = await bcryptCompare(pin, withdrawalPinHash);
    if (!valid) {
      return { ok: false, status: 403, code: 'PIN_INVALID', message: 'Invalid PIN' };
    }
  }

  // 3. Daily limit (sum of PENDING/PROCESSING/COMPLETED withdrawals in last 24h)
  if (config.dailyLimit !== null) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const todayWithdrawals = await prisma.withdrawal.findMany({
      where: {
        userId,
        requestedAt: { gte: since },
        status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
      },
      select: { amount: true },
    });
    const todayTotal = todayWithdrawals.reduce((s, w) => s + w.amount, 0);
    if (todayTotal + amount > config.dailyLimit) {
      return {
        ok: false,
        status: 422,
        code: 'DAILY_LIMIT_EXCEEDED',
        message: `Daily withdrawal limit ${config.dailyLimit} would be exceeded (already ${todayTotal} today)`,
      };
    }
  }

  // 4. Cooldown
  if (config.cooldownHours > 0) {
    const since = new Date(Date.now() - config.cooldownHours * 3600_000);
    const recent = await prisma.withdrawal.findFirst({
      where: {
        userId,
        requestedAt: { gte: since },
        status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
      },
      orderBy: { requestedAt: 'desc' },
      select: { requestedAt: true },
    });
    if (recent) {
      const nextAt = new Date(recent.requestedAt.getTime() + config.cooldownHours * 3600_000);
      return {
        ok: false,
        status: 422,
        code: 'COOLDOWN_ACTIVE',
        message: `Next withdrawal allowed at ${nextAt.toISOString()}`,
      };
    }
  }

  // 5. Balance check (last because most expensive). Passes the same client
  // as the daily-limit/cooldown reads above so all reads see the same
  // transaction snapshot when called from a Serializable tx.
  if (config.balanceCheckEnabled) {
    const balance = await computeBalance(userId, prisma as TxClient);
    if (amount > balance) {
      return {
        ok: false,
        status: 422,
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance (available: ${balance}, requested: ${amount})`,
      };
    }
  }

  return { ok: true };
}
