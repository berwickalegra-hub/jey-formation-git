# Testing Patterns

**Analysis Date:** 2026-05-07

## Test Framework

**Current State:** Minimal test infrastructure wired; full suite is a future phase (M7).

**Runner:**
- Vitest is installed (`vitest@^2.1.8` in `frontend/package.json`)
- No `vitest.config.ts` is present yet (referenced as TODO in STATUS.md as a future port task)

**Frontend Test Command:**
```bash
pnpm test              # Run all tests (currently no-op; defaults to "vitest run")
```

**Status:** Frontend has no test framework wired in v1 (`pnpm --filter frontend test` was a stub in original template). Backend tests exist in the original codebase but are not yet ported to this monolith structure.

## Test File Organization

**Test Location Strategy (Future):**
- Test files will use `.test.ts` suffix (standard Vitest convention)
- Co-located or separate directory — not yet established for this project
- When backend routes are ported, tests will be adjacent to route implementations

**Examples from Original Template (Not Yet Ported):**
- 18 backend test files exist in the original codebase (`*.test.ts`)
- STATUS.md notes: "Port the 18 backend test files (`*.test.ts`) — most should work as-is once imports are fixed; route tests need rewrite (no supertest — use `fetch` against test server)"
- Tests will likely be in `frontend/src/lib/**/*.test.ts` for lib functions

## Test Configuration (Future)

**To Be Created (`frontend/vitest.config.ts`):**
- setupFiles for environment fixtures: `JWT_SECRET`, `ENCRYPTION_KEY`
- Configuration for running HTTP tests against a test server on `localhost:3000`
- Database setup/teardown for integration tests

**Status:** Not yet created. When wired:
```bash
pnpm --filter frontend run test        # Run all tests
pnpm --filter frontend run test --watch # Watch mode
pnpm --filter frontend run test --coverage # Coverage report
```

## Test Structure (Patterns from CLAUDE.md)

**Backend Unit Test Pattern (to be adopted):**
- Vitest + assertion library (inferred to be Node.js native or a lightweight lib)
- Single backend test file: `pnpm --filter frontend exec vitest run src/lib/<file>.test.ts`
- Single test by name: `pnpm --filter frontend exec vitest run -t "<test name>"`
- Watch mode: `pnpm --filter frontend exec vitest src/lib/<file>.test.ts`

**Route Tests (when ported):**
- No supertest (HTTP mocking library); instead use native `fetch()` against a test server
- Tests will boot a Next.js test server on a local port and make real HTTP requests
- Session/auth testing will use cookie handling (matching the cookie/JWT auth architecture)

## Mocking

**Strategy (Not Yet Defined):**
- Vitest built-in mocking (`vi.mock()`, `vi.spyOn()`) will be used
- No custom mock factory library yet established
- Redis, database, and payment provider mocks needed for unit tests (to be defined during port)

**Auth Token Fixtures:**
- `JWT_SECRET` will be provided via environment setup in `vitest.config.ts`
- Cryptographic keys will have test-only values (no randomization per test — deterministic for reproducibility)

## Test Types

**Unit Tests (When Ported):**
- Test scope: individual functions in `lib/` (auth, crypto, logger, zod-helpers, etc.)
- Approach: small, fast, no external services
- Examples: JWT signing/verification, Zod schema validation, error handling

**Integration Tests (Roadmap):**
- Test scope: routes + database transactions
- Approach: real database (test instance), real Redis (test instance), mocked external APIs (payments, webhooks)
- Examples: auth flow (signup → email verify → login), order creation + webhook delivery, withdrawal with advisory lock

**E2E Tests:**
- Framework: Not yet introduced (possibly playwright in future phases)
- Status: Not in current roadmap; smoke test reference exists in STATUS.md

**Smoke Test (Current Dev-Only):**
- `smoke-test.ts` may be dropped or rewritten as Vitest
- HTTP tests against `localhost:3000` verifying basic health checks
- Environment-gated (skips cleanly without credentials)

## Coverage

**Status:** No coverage enforcement yet
- Jest/Vitest coverage tools are available but not configured
- Target coverage: TBD (typically 70%+ for critical paths like auth, payments)

**View Coverage (When Configured):**
```bash
pnpm test --coverage
```

## Critical Test Invariants (From CLAUDE.md)

When tests ARE written, they must respect these constraints:

**Auth & Crypto:**
- JWT refresh token races must not allow concurrent refresh calls (frontend `api.ts` uses a single-flight lock)
- CSRF token double-submit validation must be tested (backend sets cookie, frontend mirrors in header)
- OAuth state + PKCE verifier cookies must be path-scoped to `/api/auth/oauth` (5min expiry)

**Database Transactions:**
- Webhook idempotency via `@@unique([externalId, eventType])` on WebhookLog
- Withdrawals use `Serializable` Prisma transactions with `pg_advisory_xact_lock(hashtext(userId))`
- Tests must verify double-spend is prevented when two withdrawals race for the same user

**Outbox Pattern:**
- Enqueued events must go inside the transaction, not after commit
- Side-effects (emails, notifications) must be atomic: enqueue fails → whole tx fails
- Outbox dispatcher claims rows atomically and retries with backoff (max 5 attempts)

**Payment Retry:**
- Charges retry up to 3 times on Bictorys 403 (Cloudflare WAF false-positive)
- Retry backoff: 2s, 4s, 8s exponential
- Circuit breaker must be tested (single-instance in-memory; multi-pod requires Redis variant)

**Webhook Signature Verification:**
- HMAC-SHA256 timing-safe comparison (never plain string `==`)
- Replay window default 60s (`BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` to override)
- Dev escape hatch: `SMOKE_BYPASS_WEBHOOK_VERIFY=1` bypasses verification with loud logging

**Upload Validation:**
- Magic-byte validation against `UPLOAD_ALLOWED_MIME` — never trust `file.mimetype` alone

**Admin Audit:**
- Every admin mutation (role change, order cancel, etc.) must call `logAdminAction(prisma, {...})`
- Tests must verify audit log records created

**Rate Limiting:**
- Per-email limits: login 10/15m, signup 5/h, reset 3/h, verify 10/15m
- Global IP limiter + per-email limiter in Redis (dev fallback to MemoryStore with warning)
- Test that nth request over limit returns 429

## Frontend-Specific Testing Notes

**No UI Component Testing Yet:**
- v1 ships frontend logic only (no UI components per CLAUDE.md)
- Component testing will be added when UI design lands

**API Wrapper Testing:**
- `api()` function in `frontend/src/lib/api.ts` is battle-tested but should be covered:
  - Auto-refresh on 401 (single-flight lock)
  - CSRF token injection on mutations only
  - Network retry only for GET/HEAD (never POST/PUT/PATCH/DELETE)
  - Timeout handling (30s + AbortController)
  - ApiError construction with stable error codes

**Context Testing:**
- `AuthContext` should test user fetch, logout, token refresh edge cases
- `ToastContext` (if present) should test notification lifecycle

## Pre-Commit Check

**Required before git commit:**
```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

All must pass. If any fail, fix the issue and re-run before committing.

**CI/CD Hooks:**
- `.github/workflows/` (likely) will enforce this check on PRs
- Not yet explored in this analysis; see repo for CI config

## Test-Related TODO Items (From STATUS.md)

- Create `frontend/vitest.config.ts` with setupFiles for JWT_SECRET/ENCRYPTION_KEY
- Drop or rewrite `smoke-test.ts` as Vitest HTTP tests
- Port 18 backend test files:
  - Fix imports for monolith structure
  - Rewrite route tests to use `fetch()` against test server (no supertest)
  - Ensure all async patterns use proper await/Promise handling
- Add coverage targets once test suite is wired
- Set up GitHub Actions CI/CD to run tests on every PR

---

*Testing analysis: 2026-05-07*
