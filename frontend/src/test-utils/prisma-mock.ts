// Source: RESEARCH.md Pattern 21 — D-25 Prisma mocking strategy.
// Tests import this module FIRST (before any module that imports
// `@/lib/server/prisma`) so the `vi.mock` call hoists above route imports.
//
// Pitfall 11: vi.mock is auto-hoisted only when called at module level.
// Keep this call at the top of this file — never inside a beforeEach.
import { beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

vi.mock('@/lib/server/prisma', () => ({ prisma: prismaMock }));

beforeEach(() => {
  mockReset(prismaMock);
});
