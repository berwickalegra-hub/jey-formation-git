// Source: planner-derived; covers OPS-03 (Sentry onRequestError) + OBS-05 (registerOTel).
// Asserts the instrumentation.ts file declares both exports with the correct shape.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// From frontend/src/lib/server/observability/ → frontend/instrumentation.ts is 4 levels up.
const INSTRUMENTATION = resolve(__dirname, '../../../../instrumentation.ts');

describe('instrumentation.ts shape (OPS-03, OBS-05)', () => {
  const src = readFileSync(INSTRUMENTATION, 'utf8');

  it('imports registerOTel from @vercel/otel', () => {
    expect(src).toMatch(/import\s*\{\s*registerOTel\s*\}\s*from\s*['"]@vercel\/otel['"]/);
  });

  it('calls registerOTel with serviceName "amadou-monolith"', () => {
    // OBS-05: minimal, exact shape per D-16.
    expect(src).toMatch(/registerOTel\(\s*\{\s*serviceName:\s*['"]amadou-monolith['"]\s*\}\s*\)/);
  });

  it('re-exports onRequestError from @sentry/nextjs (named export)', () => {
    // OPS-03 / D-07: required for Next.js 15+ to capture unhandled route errors.
    expect(src).toMatch(/export\s*\{[^}]*\bonRequestError\b[^}]*\}\s*from\s*['"]@sentry\/nextjs['"]/);
  });

  it('does NOT use export default for onRequestError', () => {
    // Next.js looks for the literal named export `onRequestError`.
    // A `export default { onRequestError }` would NOT register the hook.
    expect(src).not.toMatch(/export\s+default\s+\{?\s*onRequestError/);
  });

  it('keeps Sentry dynamic imports inside register() for runtime-conditional boot', () => {
    // Pitfall 6: Sentry init must run inside register() so NEXT_RUNTIME is observable.
    expect(src).toMatch(/await import\(['"]\.\/sentry\.server\.config['"]\)/);
    expect(src).toMatch(/await import\(['"]\.\/sentry\.edge\.config['"]\)/);
  });
});
