import 'server-only';
import { z } from 'zod';

// Boot-time env validation. Module-level — throws at import time if
// REQUIRED env vars are missing or malformed. Each route handler that
// imports `env` from here pays the validation cost exactly once
// (the schema parse runs once per process at first import).
//
// Keep auth.ts:12-25's JWT_SECRET regex authoritative — we re-use the
// same min(32) constraint here so the failure surfaces sooner (boot
// instead of first auth call).
//
// OPTIONAL providers (Redis, Resend, R2, Bictorys, Sentry) are NOT
// validated here. They're load-bearing only when you call into them,
// and validating them at boot would force every fork to populate every
// optional integration before `pnpm dev` works. The relevant lib file
// (e.g. redis.ts) is responsible for falling back / 404'ing when its
// own env is absent.

const trueLikeStrings = ['1', 'true', 'TRUE', 'yes', 'YES'];
const flag = z
  .string()
  .optional()
  .transform((v) => (v ? trueLikeStrings.includes(v) : false));

const envSchema = z.object({
  // ── Required ──────────────────────────────────────────────────────────
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .url('DATABASE_URL must be a valid postgres connection string'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // ── Recommended (warn-only at boot, validated at first use) ───────────
  DIRECT_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // ── Cookie / origin ──────────────────────────────────────────────────
  COOKIE_PREFIX: z.string().min(1).default('app'),
  COOKIE_DOMAIN: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),

  // ── Tunables (numeric, with safe defaults) ───────────────────────────
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_SIGNUP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_FORGOT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  AUTH_RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RESEND_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_DURATION_MIN: z.coerce.number().int().positive().default(30),
  AUTH_FORGOT_TARGET_LATENCY_MS: z.coerce.number().int().nonnegative().default(350),
  AUTH_VERIFICATION_TTL_MIN: z.coerce.number().int().positive().default(15),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),

  // ── Boolean flags ────────────────────────────────────────────────────
  PASSWORD_HIBP_CHECK: flag,
  AUTH_RATE_LIMIT_FAIL_CLOSED: flag,

  // ── Runtime mode ─────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Throwing at module load is intentional. The server should refuse to
    // start with a misconfigured env rather than serving requests with
    // silent fallbacks that mask production bugs.
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

export const env = loadEnv();
