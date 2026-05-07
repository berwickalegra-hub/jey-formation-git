# Coding Conventions

**Analysis Date:** 2026-05-07

## TypeScript Configuration

**Base Config (`tsconfig.base.json`):**
- `target`: ES2022
- `module`: NodeNext
- `moduleResolution`: NodeNext
- Strict mode: `strict: true`
- `noUncheckedIndexedAccess: true` — prevents unsafe array/object access without index bounds checks
- `exactOptionalPropertyTypes: true` — disallows `undefined` for optional properties (must be present or omitted)
- `noImplicitOverride: true` — requires explicit `override` keyword when extending class methods
- `noFallthroughCasesInSwitch: true` — blocks unintended fallthrough in switch statements
- `skipLibCheck: true` — speeds up compilation by skipping DefinitelyTyped validation
- `verbatimModuleSyntax: false` — allows transpiling type-only imports

**Frontend Overrides (`frontend/tsconfig.json`):**
- Extends `tsconfig.base.json`
- `target`: ES2022
- `lib`: ["dom", "dom.iterable", "esnext"] — browser environment
- `jsx`: preserve (handled by Next.js)
- `moduleResolution`: bundler
- Path alias: `@/*` → `./src/*`
- ESLint type-checking is **NOT** enabled for frontend (perf cost skipped)

**Backend Type-Aware Linting:**
- Backend/scripts files use `tsconfig.eslint.json` for type-aware ESLint rules
- Includes tests and scripts (separate from build tsconfig which excludes them)
- Enables `@typescript-eslint/no-floating-promises` rule

## Naming Patterns

**Files:**
- Kebab-case for most files: `auth.ts`, `circuit-breaker.ts`, `job-queue.ts`, `email-queue.ts`
- Directories are lowercase: `lib/`, `server/`, `payments/`, `queues/`, `contexts/`
- Route files use convention: `page.tsx`, `layout.tsx`, `error.tsx` (Next.js App Router)

**Functions & Variables:**
- camelCase universally: `isProd()`, `cookieDomain()`, `createLogger()`, `setAuthCookies()`
- Private/internal functions use leading underscore: `_isRetryAfterRefresh` (internal option flag)
- Constants use UPPER_SNAKE_CASE: `ACCESS_TOKEN_EXPIRY`, `REFRESH_COOKIE_MAX_AGE`, `MAX_RETRIES`
- Boolean predicates start with `is` or `has`: `isProd()`, `isInAppBrowser()`, `isTikTokBrowser()`

**Types & Interfaces:**
- PascalCase: `ApiError`, `User`, `AuthContextValue`
- Interface names often have suffix `-Value`, `-Options`, `-State`

**React Components:**
- PascalCase: `AuthProvider`, `AuthContext`, `ToastContext`
- Client-side marked with `'use client'` at the top of file

## Code Style & Formatting

**Prettier Configuration (`.prettierrc.json`):**
- `semi: true` — always require semicolons
- `singleQuote: true` — use single quotes for strings
- `trailingComma: "all"` — trailing commas in multiline structures
- `printWidth: 100` — line length limit
- `tabWidth: 2` — 2-space indentation
- `arrowParens: "always"` — always wrap arrow function params
- `endOfLine: "lf"` — Unix line endings

**Run formatting:** `pnpm format` (or `pnpm format:check` to verify)

## Linting

**ESLint Configuration (`eslint.config.mjs`):**
- ESLint 9 flat config format
- Base: `@eslint/js` recommended + `typescript-eslint` recommended
- Global rules:
  - `@typescript-eslint/no-unused-vars`: error, ignore params starting with `_`
  - `@typescript-eslint/no-explicit-any`: warn (not an error)

**Backend-Specific Rules:**
- Type-aware linting enabled only for `backend/src/**/*.ts` and `backend/scripts/**/*.ts`
- `@typescript-eslint/no-floating-promises`: error (catches unawaited Promises with `ignoreVoid: true` and `ignoreIIFE: true`)
  - Critical for async-heavy backend code that does DB/queue/outbox work
  - Silently swallowing rejections would be a production risk

**Config Files:**
- `.config.{js,mjs,ts}` and `.cjs` files have `@typescript-eslint/no-require-imports` disabled
- Examples/ excluded from linting and typecheck

**Run linting:** `pnpm lint` (frontend only at this stage; root ESLint config scans both once backend is populated)

## Import Organization

**Order Pattern (observed in code):**
1. Node.js built-ins: `import crypto from 'node:crypto'`
2. Third-party packages: `import { SignJWT } from 'jose'`, `import bcrypt from 'bcryptjs'`
3. Next.js imports: `import { cookies } from 'next/headers'`, `import { useRouter } from 'next/navigation'`
4. Internal absolute imports: `import { api, ApiError } from '@/lib/api'`
5. Blank line separator between groups

**Path Aliases:**
- Frontend: `@/*` resolves to `./src/*`
- Used throughout: `@/lib/api`, `@/lib/server/auth`, `@/contexts/AuthContext`

**Server-Only Imports:**
- Files that run only server-side import `'server-only'` at the top: `import 'server-only'`
- Examples: `auth.ts`, `prisma.ts`, `payments/bictorys.ts`

## Error Handling

**Custom Error Class:**
- `ApiError` extends `Error` (frontend/src/lib/api.ts)
- Properties: `status: number`, `body: Record<string, unknown>`, `code: ApiErrorCode | (string & {}) | ''`
- Used for backend response errors, network errors, and timeouts
- **Frontend consumers switch on `.code`, not on `.message`** — message is user-facing and may be translated; code is stable

**Stable Error Codes (from backend):**
```typescript
// Auth
'TOO_MANY_LOGIN_ATTEMPTS' | 'TOO_MANY_RESET_REQUESTS' | ...
// Upload
'INVALID_FILE_CONTENT'
// Withdrawals
'AMOUNT_BELOW_MIN' | 'AMOUNT_ABOVE_MAX' | 'DAILY_LIMIT_EXCEEDED' | ...
'PIN_NOT_SET' | 'PIN_REQUIRED' | 'PIN_INVALID'
'INSUFFICIENT_BALANCE' | 'WITHDRAWAL_TX_FAILED' | 'USER_NOT_FOUND'
```

**Error Handling Patterns:**
- Try-catch blocks catch both `ApiError` and generic errors
- Network errors (timeout, offline) are caught and wrapped as `new ApiError(0, message)`
- Rate-limit errors (429) get special user messages: "Too many requests. Wait a few minutes and try again."
- Server errors (500+) get generic message: "The server is temporarily unavailable"

**Promise Handling:**
- All Promises are awaited (ESLint rule `no-floating-promises` enforces this in backend)
- IIFE and void expressions are allowed exceptions to the rule

## Comments & Documentation

**JSDoc/TSDoc Usage:**
- Used for public functions and exported types
- Example from `api.ts`:
  ```typescript
  /**
   * Stable backend error codes — the strings the backend returns in the
   * `error` field of a 4xx/5xx response body. Frontend code should switch
   * on `err.code` (string union below) rather than parsing `err.message`,
   * which is a translated user-facing string subject to change.
   */
  ```

**Inline Comments:**
- Section headers use `// ───────────────────────` visual dividers (seen in auth.ts)
- Comments explain why, not what: "Serialize on lock" rather than "acquires lock"
- Comments point to related audit tags or invariants: "Audit 011 D-01: never retry non-idempotent verbs"

## Module Design

**Barrel Files:**
- `lib/server/middleware/index.ts` likely exports multiple middleware functions
- `lib/server/` uses subdirectories per concern: `payments/`, `queues/`, `outbox/`, etc.

**Exports:**
- Named exports are preferred: `export function getCsrfToken()`, `export const cn = (...) => ...`
- Default exports used sparingly
- React Contexts use default export where context is the sole export: `export default tseslint.config(...)`

**File Size:**
- Largest files are 437 lines (`bictorys.ts`) — indicates complex but focused modules
- Files are kept under ~300 lines where practical

## Conventions for Server Code

**Cookie Handling:**
- Async because `cookies()` is async in Next.js 15+
- Functions fetch store internally: `const store = await cookies()`
- httpOnly, secure (prod), sameSite: lax
- Max-age stored as seconds (not ms)

**Logging:**
- Use centralized `createLogger()` from `../logger`
- Not yet explored in detail but referenced in bictorys.ts

**String Utilities:**
- `cn()` merges Tailwind classes with conflict resolution (clsx + tailwind-merge)
- `formatPrice()` normalizes localized numbers to use regular spaces
- `isInAppBrowser()` detects WebView contexts that block redirects

## Commit Message Convention

**Format:** Conventional Commits with scope

Observed patterns:
- `feat(monolith): port health + readyz routes; redis singleton; explicit STATUS roadmap`
- `feat(monolith): port lib + middleware as Next.js-native modules`
- `chore: initial scaffold from amadou-template (frontend-only)`

- Type: `feat`, `chore`, `fix`, etc.
- Scope: optional, e.g., `(monolith)`, `(auth)`, `(payments)`
- Imperative mood: "port" not "ported" or "ports"

---

*Convention analysis: 2026-05-07*
