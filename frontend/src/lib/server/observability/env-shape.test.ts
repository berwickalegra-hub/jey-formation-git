// Source: planner-derived; covers OPS-01 + OPS-04.
// Asserts .env.example documents the dual Neon URL contract + CRON_SECRET.
//
// On failure, each assertion message names the offending file path so an
// incident responder can grep a CI log without grepping the test source.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// frontend/src/lib/server/observability/ → repo root is 5 levels up.
// Use import.meta.url so this works under both ESM and CJS Vitest configs.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_EXAMPLE = resolve(__dirname, '../../../../../.env.example');

describe('.env.example shape (OPS-01, OPS-04)', () => {
  const src = readFileSync(ENV_EXAMPLE, 'utf8');

  it(`declares DATABASE_URL using the Neon -pooler hostname (file: ${ENV_EXAMPLE})`, () => {
    // Hostname shape: <project>-pooler.<region>.aws.neon.tech (e.g. ep-xxx-pooler.us-east-2.aws.neon.tech).
    // Matches plan key_links pattern: `-pooler\.[a-z0-9-]+\.aws\.neon\.tech`.
    expect(src).toMatch(
      /DATABASE_URL="postgresql:\/\/[^"]*-pooler\.[a-z0-9-]+\.aws\.neon\.tech/,
    );
  });

  it('DATABASE_URL carries pgbouncer=true & connection_limit=1 & pool_timeout=15 & sslmode=require', () => {
    // Match a single DATABASE_URL line with all four params (order-independent).
    const m = src.match(/^DATABASE_URL="([^"]+)"/m);
    expect(m, `DATABASE_URL line not found in ${ENV_EXAMPLE}`).not.toBeNull();
    const url = m![1]!;
    expect(url).toContain('pgbouncer=true');
    expect(url).toContain('connection_limit=1');
    expect(url).toContain('pool_timeout=15');
    expect(url).toContain('sslmode=require');
  });

  it('declares DIRECT_URL for prisma migrate deploy', () => {
    expect(src).toMatch(/^DIRECT_URL="postgresql:\/\/[^"]+"/m);
  });

  it('declares CRON_SECRET with empty default + openssl hint', () => {
    expect(src).toMatch(/^CRON_SECRET=""/m);
    expect(src).toContain('openssl rand -base64 32');
  });

  it('explains why DIRECT_URL is needed (prevents future deletion)', () => {
    // D-03: short rationale comment near DIRECT_URL.
    expect(src.toLowerCase()).toContain('migrate deploy');
  });
});
