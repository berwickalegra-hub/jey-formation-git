/**
 * Liveness probe — "the process is running, restart if not".
 * No external calls, never lies. Use for k8s livenessProbe / fly.io checks.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
