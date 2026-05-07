// Source: planner-derived; covers OPS-05.
// Asserts next.config.ts is clean of the deprecated experimental.instrumentationHook.
// Per RESEARCH.md line 12: VERIFIED ABSENT — this test locks the absence so a future
// contributor cannot silently re-introduce the flag.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// From frontend/src/lib/server/observability/ → frontend/next.config.ts is 4 levels up.
const NEXT_CONFIG = resolve(__dirname, '../../../../next.config.ts');

describe('next.config.ts is clean of deprecated config (OPS-05)', () => {
  const src = readFileSync(NEXT_CONFIG, 'utf8');

  it('does not contain the deprecated instrumentationHook flag', () => {
    // experimental.instrumentationHook is removed in Next.js 15+; auto-discovery
    // of instrumentation.ts replaces it. Re-introducing it triggers a deprecation
    // warning at build time.
    expect(src).not.toContain('instrumentationHook');
  });

  it('does not declare an experimental block targeting instrumentation', () => {
    // Defensive: catches `experimental: { instrumentationHook: true }` even if
    // a refactor splits the assignment across lines.
    expect(src).not.toMatch(/experimental[^}]*instrumentation/i);
  });
});
