// Source: RESEARCH.md Pattern 20 — sets env BEFORE any module imports auth.ts
// (auth.ts:13–25 throws if JWT_SECRET is missing or < 32 chars).
// Must run as setupFile (not inside a test) because module-level imports
// resolve before any test code.
//
// Per D-27: Vitest setup-files for JWT_SECRET / ENCRYPTION_KEY fixtures lands
// in Phase 1 (auth route tests cannot run without these).
// Note: avoid leading "test"/"secret"/"dev"/etc. — auth.ts:21 rejects those
// as placeholder values. Use a fixed-but-realistic-looking value.
process.env.JWT_SECRET ||= 'unit-fixture-jwt-secret-do-not-use-in-prod-12345678901234567890';
process.env.ENCRYPTION_KEY ||= 'aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n';
process.env.COOKIE_PREFIX ||= 'app';
process.env.NODE_ENV ||= 'test';
