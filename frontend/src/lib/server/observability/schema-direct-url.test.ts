// Source: planner-derived; covers OPS-01 schema half.
// Asserts the prisma datasource declares directUrl for migrations.
//
// On failure, each assertion message names the offending file path so an
// incident responder can grep a CI log without grepping the test source.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// frontend/src/lib/server/observability/ → frontend/prisma/schema.prisma is
// 4 levels up + prisma/. Use import.meta.url so this works under both ESM
// and CJS Vitest configs.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA = resolve(__dirname, '../../../../prisma/schema.prisma');

describe('schema.prisma datasource (OPS-01)', () => {
  const src = readFileSync(SCHEMA, 'utf8');

  it(`declares datasource db with provider postgresql (file: ${SCHEMA})`, () => {
    expect(src).toMatch(/datasource db \{[^}]*provider\s*=\s*"postgresql"/s);
  });

  it('declares url = env("DATABASE_URL")', () => {
    expect(src).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });

  it('declares directUrl = env("DIRECT_URL")', () => {
    // Defensive: the directUrl line must live INSIDE the datasource block.
    const block = src.match(/datasource db \{([^}]*)\}/s);
    expect(block, `datasource block not found in ${SCHEMA}`).not.toBeNull();
    expect(block![1]!).toMatch(/directUrl\s*=\s*env\("DIRECT_URL"\)/);
  });
});
