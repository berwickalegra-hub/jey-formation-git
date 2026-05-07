// Source: RESEARCH.md Pattern 20 — sets env BEFORE any module imports auth.ts
// (auth.ts:13–25 throws if JWT_SECRET is missing or < 32 chars).
// Must run as setupFile (not inside a test) because module-level imports
// resolve before any test code.
//
// Per D-27: Vitest setup-files for JWT_SECRET / ENCRYPTION_KEY fixtures lands
// in Phase 1 (auth route tests cannot run without these).
// Must NOT start with `change-me|secret|password|test|dev|todo|placeholder`
// (auth.ts:21 placeholder guard). Vitest fixtures need a real-looking 32+ char
// value so module-level `import '@/lib/server/auth'` doesn't throw at boot.
process.env.JWT_SECRET ||= 'fixture-jwt-vitest-2026-must-be-32-chars-or-more-xx';
process.env.ENCRYPTION_KEY ||= 'aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n';
process.env.COOKIE_PREFIX ||= 'app';
process.env.NODE_ENV ||= 'test';
