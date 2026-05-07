/**
 * Readiness probe — "this instance is fit to serve traffic".
 * Pings DB and (if configured) Redis. Returns 503 if either is down so
 * the load balancer routes traffic away until they recover.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 1_500;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function GET() {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
  let allOk = true;

  {
    const t0 = Date.now();
    try {
      await withTimeout(prisma.$queryRawUnsafe('SELECT 1'), PROBE_TIMEOUT_MS);
      checks.database = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      allOk = false;
      checks.database = {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (redis) {
    const t0 = Date.now();
    try {
      await withTimeout(redis.ping(), PROBE_TIMEOUT_MS);
      checks.redis = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      allOk = false;
      checks.redis = {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return NextResponse.json(
    { ok: allOk, time: new Date().toISOString(), checks },
    { status: allOk ? 200 : 503 },
  );
}
