// DOC-01 — CLAUDE.md doc tripwire.
//
// Asserts the post-rewrite shape of repo-root CLAUDE.md so refactors that
// re-introduce Express-era residue (or strip Phase 4/5 surface mentions)
// fail CI. Mirrors the pattern of `runtime-enforcement.test.ts` and
// `vercel-json-shape.test.ts` from Phases 0/5.
//
// Negation context is allowed: the historical phrase
//   "There is no separate Express backend anymore"
// is intentional documentation that the project was PORTED FROM an Express
// stack — keep it. Every other "Express" hit is a regression.
//
// Path resolution: frontend/src/lib/server/observability/ → 5 levels up
// is repo root (where CLAUDE.md lives). Uses import.meta.url for portable
// resolution under both ESM and CJS Vitest configs.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLAUDE_MD_PATH = resolve(__dirname, '../../../../../CLAUDE.md');

describe('CLAUDE.md doc tripwire (DOC-01)', () => {
  it(`exists at repo root (file: ${CLAUDE_MD_PATH})`, () => {
    expect(existsSync(CLAUDE_MD_PATH)).toBe(true);
  });

  it('contains zero errant Express references (negation context allowed)', () => {
    const content = readFileSync(CLAUDE_MD_PATH, 'utf8');
    // The single intentional phrase is "no separate Express backend anymore".
    // Every other "Express" hit is a regression.
    const lines = content.split('\n');
    const expressHits = lines
      .map((line, idx) => ({ line, idx: idx + 1 }))
      .filter(({ line }) => /\bExpress\b/.test(line))
      .filter(({ line }) => !/no separate Express backend|There is no.*Express/i.test(line));
    expect(
      expressHits,
      `Unexpected Express references:\n${expressHits.map((h) => `  L${h.idx}: ${h.line}`).join('\n')}`,
    ).toEqual([]);
  });

  it('contains zero references to backend/src (the monolith has no backend/ dir)', () => {
    const content = readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(content).not.toMatch(/backend\/src/);
  });

  it('contains zero express.json() middleware references', () => {
    const content = readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(content).not.toMatch(/express\.json\(/);
  });

  it('contains zero middleware-order references (Express-era concept)', () => {
    const content = readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(content).not.toMatch(/middleware-order/);
  });

  it('mentions the canonical Phase 4–5 surface (cron + webhook + withdrawals + upload)', () => {
    const content = readFileSync(CLAUDE_MD_PATH, 'utf8');
    // /api/cron path lives in the monolith — Phase 5 routes.
    expect(content).toMatch(/\/api\/cron|app\/api\/cron|cron/i);
    expect(content).toMatch(/webhook/i);
    expect(content).toMatch(/withdrawal/i);
    expect(content).toMatch(/upload/i);
  });
});
