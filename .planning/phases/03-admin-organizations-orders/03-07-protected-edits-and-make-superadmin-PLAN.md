---
phase: 03-admin-organizations-orders
plan: 07
type: execute
wave: 2
depends_on: [01]
files_modified:
  - frontend/src/app/api/auth/login/route.ts
  - frontend/src/app/api/auth/refresh/route.ts
  - frontend/src/app/api/auth/login/route.test.ts
  - frontend/src/app/api/auth/refresh/route.test.ts
  - frontend/scripts/make-superadmin.ts
autonomous: false
requirements: [ADMIN-07]
must_haves:
  truths:
    - Login route refuses authentication with 403 ACCOUNT_SUSPENDED when User.status === 'SUSPENDED' (D-ADMIN-02)
    - Refresh route refuses with 403 ACCOUNT_SUSPENDED when User.status === 'SUSPENDED' on the rotation request
    - Login refusal happens AFTER password verification (timing-attack window unchanged) and BEFORE cookie issuance, with the failed-attempt counter NOT cleared (suspended user's password is still credentials-valid)
    - frontend/scripts/make-superadmin.ts CLI exits 0 when promoting an existing user; exits 1 with clear stderr when email is missing
    - make-superadmin script writes an AdminAction { action: 'BOOTSTRAP_SUPERADMIN', actorId: <self>, metadata: { via: 'cli-script', previousRole } }
    - make-superadmin is idempotent (running it twice on the same email no-ops the second time)
    - Existing login + refresh tests still pass (no Phase 1 regressions)
  artifacts:
    - path: frontend/src/app/api/auth/login/route.ts
      provides: PROTECTED — modified to add SUSPENDED check (Pitfall 2)
      contains: 'ACCOUNT_SUSPENDED'
    - path: frontend/src/app/api/auth/refresh/route.ts
      provides: PROTECTED — modified to add SUSPENDED check
      contains: 'ACCOUNT_SUSPENDED'
    - path: frontend/scripts/make-superadmin.ts
      provides: ADMIN-07 bootstrap CLI
      exports: []
  key_links:
    - from: frontend/scripts/make-superadmin.ts
      to: frontend/src/lib/server/admin/audit.ts
      via: logAdminAction(prisma, { action: 'BOOTSTRAP_SUPERADMIN' })
      pattern: 'BOOTSTRAP_SUPERADMIN'
    - from: frontend/src/app/api/auth/login/route.ts
      to: User.status field (Wave 0 schema)
      via: select { status: true } in user lookup
      pattern: 'status: true'
---

<objective>
Wave 2 — close out the phase with the two PROTECTED-FILE edits required by D-ADMIN-02 (suspend SUSPENDED users at login + refresh) and the bootstrap CLI script (ADMIN-07). This plan is `autonomous: false` because two of the three modified files are in CLAUDE.md's "Files Claude SHOULD NOT modify" list and require explicit human confirmation per the project invariant.

Purpose: Complete the SUSPENDED enforcement loop (Plan 03-06 lets ADMINs SUSPEND a user; without this plan, that suspension has no observable effect on already-issued sessions) and ship the operator script that bootstraps the first SUPERADMIN.

Output: 2 modified protected files + 1 new script.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-admin-organizations-orders/03-CONTEXT.md
@.planning/phases/03-admin-organizations-orders/03-RESEARCH.md
@frontend/src/app/api/auth/login/route.ts
@frontend/src/app/api/auth/refresh/route.ts
@frontend/src/app/api/auth/login/route.test.ts
@frontend/src/app/api/auth/refresh/route.test.ts
@frontend/src/lib/server/admin/audit.ts
@frontend/src/lib/server/prisma.ts
@CLAUDE.md
@package.json

<interfaces>
From frontend/src/lib/server/admin/audit.ts:
```typescript
export async function logAdminAction(
  prisma: AuditClient,
  input: { actorId: string; action: string; targetType?: string; targetId?: string; metadata?: Json; ip?: string; userAgent?: string }
): Promise<void>;
```

From package.json (root, line 24-28 per RESEARCH.md):
```json
"db:make-superadmin": "pnpm --filter frontend exec tsx scripts/make-superadmin.ts"
```

Protected file constraint (CLAUDE.md):
- frontend/src/app/api/auth/login/route.ts — invariants: enumeration-resistance, dummy bcrypt for non-existent users, lockout sequencing, cookie issuance ordering. The SUSPENDED check MUST insert AFTER password verification ok and BEFORE cookie issuance / lockout reset, so the failed-attempt counter is NOT cleared (Pitfall 2).
- frontend/src/app/api/auth/refresh/route.ts — issues new access cookies; SUSPENDED check on every refresh closes the 15-min loophole for already-issued tokens.
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: CONFIRM-BEFORE-EDIT — protected files login + refresh</name>
  <files>frontend/src/app/api/auth/login/route.ts, frontend/src/app/api/auth/refresh/route.ts</files>
  <action>
    Do NOT touch either protected file yet. First, emit the following confirmation request to the user verbatim:

    > "I am about to modify `frontend/src/app/api/auth/login/route.ts` because of D-ADMIN-02 (insert User.status === 'SUSPENDED' check between password verification and cookie issuance) and `frontend/src/app/api/auth/refresh/route.ts` because of the same decision (re-check on every refresh). Confirm?"

    Then PAUSE and wait for the user. Possible replies:
    - "approved" / "confirm" / "yes" → proceed to Task 2 (which performs the actual edit).
    - "no" / "stop" / specific guidance → halt and surface the user's revision request to the planner.

    The executor MUST NOT open Edit/Write on either protected file until the user responds. Reading the files for context is permitted only AFTER approval (Task 2's `<read_first>` covers this).
  </action>
  <what-built>This is a confirmation gate before modifying two PROTECTED files: `frontend/src/app/api/auth/login/route.ts` and `frontend/src/app/api/auth/refresh/route.ts`. No code changes happen in this task — only the explicit "I am about to modify X because Y — confirm?" wording per CLAUDE.md's protected-files invariant.</what-built>
  <how-to-verify>
    Confirm the executor emitted the exact "I am about to modify ..." line and waited for user input before any Edit/Write tool call against the two protected files.
  </how-to-verify>
  <verify>Executor emitted the confirmation prompt and received an explicit "approved" (or equivalent) response from the user before any Edit/Write call against the two protected files.</verify>
  <done>User has explicitly approved the edit; executor has not yet modified either file. Task 2 may now proceed.</done>
  <resume-signal>Type "approved" to proceed; otherwise describe the requested change.</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add SUSPENDED check to login + refresh routes (PROTECTED files)</name>
  <files>frontend/src/app/api/auth/login/route.ts, frontend/src/app/api/auth/refresh/route.ts, frontend/src/app/api/auth/login/route.test.ts, frontend/src/app/api/auth/refresh/route.test.ts</files>
  <read_first>
    - frontend/src/app/api/auth/login/route.ts (full file — protected; read before editing)
    - frontend/src/app/api/auth/refresh/route.ts (full file — protected; read before editing)
    - frontend/src/app/api/auth/login/route.test.ts (existing test pattern to extend)
    - frontend/src/app/api/auth/refresh/route.test.ts (existing test pattern to extend)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pitfall 2: Login-route edit breaks Phase 1 invariants" — describes the EXACT insertion point
    - frontend/src/test-utils/admin-fixtures.ts — `seedSuspendedUser` factory from Wave 0
  </read_first>
  <behavior>
    - **Login** (`POST /api/auth/login`): After `verifyPassword` returns ok and BEFORE the cookie-issuance / lockout-reset block, branch:
      - If `user.status === 'SUSPENDED'` → return `403 { error: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended. Contact support.' }`
      - The failed-attempt counter MUST NOT be cleared (their credentials are still valid; we don't want to wipe their lockout state because a SUSPENDED user is not the threat model for failed-login bursts — but per Pitfall 2, leave the counter as-is and don't call `recordSuccess` either).
    - **Refresh** (`POST /api/auth/refresh`): Re-fetch the user (or extend the existing user lookup) and branch on `status === 'SUSPENDED'`. Return `403 { error: 'ACCOUNT_SUSPENDED' }` and do NOT rotate the access cookie. The refresh-cookie path-scoped to `/api/auth` means a suspended user's refresh attempt is the choke point — once it 403s, their session expires within 15 min (existing access JWT lifetime).
    - Existing Phase 1 tests in both files MUST still pass (enumeration-resistance, dummy bcrypt, csrf, etc. are all upstream of this insertion).
  </behavior>
  <action>
    **Login route edit** — Read `frontend/src/app/api/auth/login/route.ts` first. Locate:
    1. The `verifyPassword(...)` call site
    2. The success branch where `recordSuccess` (or equivalent lockout-reset) is called
    3. The cookie-issuance call

    Insert the SUSPENDED branch BETWEEN steps (1)-success and (2). Concrete shape:
    ```typescript
    // ... existing flow ...
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) { /* existing failure handling */ }

    // D-ADMIN-02: refuse SUSPENDED users AFTER credentials verify (so we don't
    // leak whether the user exists via a different code path) but BEFORE
    // clearing the lockout counter or issuing cookies. (RESEARCH.md Pitfall 2)
    if (user.status === 'SUSPENDED') {
      return NextResponse.json(
        { error: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended. Contact support.' },
        { status: 403 },
      );
    }

    // existing recordSuccess + cookie issuance ...
    ```

    If the existing user lookup does NOT select `status`, extend the `select` to include `status: true` (this is the smallest possible diff that achieves the invariant).

    **Refresh route edit** — Read `frontend/src/app/api/auth/refresh/route.ts`. After the user lookup (the place where `tokenVersion` is read), add:
    ```typescript
    if (user.status === 'SUSPENDED') {
      return NextResponse.json(
        { error: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended.' },
        { status: 403 },
      );
    }
    ```
    Likewise extend the user `select` to include `status: true` if not already present. Do NOT rotate cookies on the SUSPENDED branch.

    **Test updates** — Extend `frontend/src/app/api/auth/login/route.test.ts` with:
    ```typescript
    it('returns 403 ACCOUNT_SUSPENDED for SUSPENDED user with valid credentials', async () => {
      const user = await seedSuspendedUser({ password: 'TestPass123!' });
      const res = await POST(makeReq({ email: user.email, password: 'TestPass123!' }));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('ACCOUNT_SUSPENDED');
      // Cookies NOT issued
      expect(res.headers.get('set-cookie') ?? '').not.toContain('-access=');
    });
    ```
    Extend `frontend/src/app/api/auth/refresh/route.test.ts` with the analogous test (seed an authenticated SUSPENDED user with a valid refresh cookie; assert refresh returns 403 ACCOUNT_SUSPENDED + no Set-Cookie rotation).

    Run BOTH `route.test.ts` files end-to-end and assert all existing tests still pass + the two new tests pass.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/auth/login/route.test.ts src/app/api/auth/refresh/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "ACCOUNT_SUSPENDED" frontend/src/app/api/auth/login/route.ts` returns 1
    - `grep -c "ACCOUNT_SUSPENDED" frontend/src/app/api/auth/refresh/route.ts` returns 1
    - `grep -c "status: true" frontend/src/app/api/auth/login/route.ts` returns ≥1 OR the existing user lookup already selects all fields (`select: undefined`)
    - `grep -c 'SUSPENDED' frontend/src/app/api/auth/login/route.test.ts` returns ≥1 (new test seeded)
    - `grep -c 'SUSPENDED' frontend/src/app/api/auth/refresh/route.test.ts` returns ≥1
    - `pnpm --filter frontend exec vitest run src/app/api/auth/login/route.test.ts src/app/api/auth/refresh/route.test.ts` exits 0 (existing + new tests pass)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 (login + refresh still export runtime='nodejs')
    - `pnpm typecheck` exits 0
  </acceptance_criteria>
  <done>Both protected files have the SUSPENDED check in the correct position; existing tests still pass; new SUSPENDED tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: frontend/scripts/make-superadmin.ts CLI script (ADMIN-07)</name>
  <files>frontend/scripts/make-superadmin.ts</files>
  <read_first>
    - frontend/scripts/make-superadmin.test.ts (Wave 0 RED scaffolding — both test names)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Code Examples — make-superadmin script" (lines 568-616) — verbatim source
    - .planning/phases/03-admin-organizations-orders/03-CONTEXT.md D-SCRIPT-01
    - frontend/src/lib/server/prisma.ts (the prisma client export for tsx invocation)
    - frontend/src/lib/server/admin/audit.ts (`logAdminAction` signature)
    - package.json — confirm `db:make-superadmin` script line 24-28
  </read_first>
  <behavior>
    - CLI: `pnpm db:make-superadmin <email>` (delegates to `tsx scripts/make-superadmin.ts`).
    - Read `process.argv[2]`; trim + lowercase. If missing → `console.error('Usage: pnpm db:make-superadmin <email>')` + `process.exit(1)`.
    - Lookup `prisma.user.findUnique({ where: { email } })`. If missing → `console.error('Error: user <email> not found. Sign up first.')` + `process.exit(1)`.
    - If `user.role === 'SUPERADMIN'` → `console.log('User <email> is already SUPERADMIN — no-op.')` + `process.exit(0)` (idempotent).
    - Else: `prisma.$transaction` performing:
      1. `tx.user.update({ where: { id: user.id }, data: { role: 'SUPERADMIN' } })`
      2. `logAdminAction(tx, { actorId: user.id, action: 'BOOTSTRAP_SUPERADMIN', targetType: 'User', targetId: user.id, metadata: { via: 'cli-script', previousRole: user.role } })`
    - Then `console.log('✓ Promoted <email> (id=<id>) to SUPERADMIN.')` + `process.exit(0)`.
  </behavior>
  <action>
    Create `frontend/scripts/make-superadmin.ts` verbatim per RESEARCH.md Example (lines 568-616):
    ```typescript
    import { prisma } from '../src/lib/server/prisma';
    import { logAdminAction } from '../src/lib/server/admin/audit';

    async function main() {
      const email = process.argv[2]?.trim().toLowerCase();
      if (!email) {
        console.error('Usage: pnpm db:make-superadmin <email>');
        process.exit(1);
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        console.error(`Error: user ${email} not found. Sign up first.`);
        process.exit(1);
      }

      if (user.role === 'SUPERADMIN') {
        console.log(`User ${email} is already SUPERADMIN — no-op.`);
        process.exit(0);
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { role: 'SUPERADMIN' },
        });
        await logAdminAction(tx, {
          actorId: user.id,
          action: 'BOOTSTRAP_SUPERADMIN',
          targetType: 'User',
          targetId: user.id,
          metadata: { via: 'cli-script', previousRole: user.role },
        });
      });

      console.log(`✓ Promoted ${email} (id=${user.id}) to SUPERADMIN.`);
      process.exit(0);
    }

    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    ```

    Make the Wave 0 RED tests in `frontend/scripts/make-superadmin.test.ts` GREEN:
    - `it('promotes existing user to SUPERADMIN and writes BOOTSTRAP_SUPERADMIN AdminAction')`: seed a USER, invoke the script's `main()` directly (refactor: split `main` so the test can call it without spawning a subprocess — OR use `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)` so exit doesn't kill the test process). Assert role is now SUPERADMIN + exactly 1 AdminAction with `action='BOOTSTRAP_SUPERADMIN', metadata.via='cli-script'`.
    - `it('missing user exits 1 with clear stderr message')`: `process.argv = [..., 'nonexistent@test.local']`; spy on `process.exit` and `console.error`; invoke main; assert `process.exit` called with 1 AND `console.error` was called with a string containing `not found`.

    To make `main` testable without spawning subprocesses, refactor as:
    ```typescript
    export async function main(args = process.argv.slice(2)): Promise<number> {
      const email = args[0]?.trim().toLowerCase();
      if (!email) {
        console.error('Usage: pnpm db:make-superadmin <email>');
        return 1;
      }
      // ... rest of logic returning 0 or 1 instead of process.exit
    }

    // Only run when invoked as script (not when imported by test):
    if (import.meta.url === `file://${process.argv[1]}`) {
      main().then((code) => process.exit(code)).catch((err) => {
        console.error(err);
        process.exit(1);
      });
    }
    ```
    This preserves the CLI behavior while making the function unit-testable. Test imports `main` and asserts its return value.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run scripts/make-superadmin.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/scripts/make-superadmin.ts` exists
    - `grep -c "BOOTSTRAP_SUPERADMIN" frontend/scripts/make-superadmin.ts` returns 1
    - `grep -c "via: 'cli-script'" frontend/scripts/make-superadmin.ts` returns 1
    - `grep -c "logAdminAction" frontend/scripts/make-superadmin.ts` returns 1
    - `grep -c "prisma.\$transaction" frontend/scripts/make-superadmin.ts` returns 1
    - `grep -cE "(process\.exit\(1\)|return 1)" frontend/scripts/make-superadmin.ts` returns ≥2 (missing-arg + missing-user paths)
    - `pnpm --filter frontend exec vitest run scripts/make-superadmin.test.ts` exits 0
    - `pnpm --filter frontend exec tsx scripts/make-superadmin.ts 2>&1 | grep -q "Usage:"` (running with no args prints usage and exits 1)
  </acceptance_criteria>
  <done>Bootstrap CLI script implemented; both ADMIN-07 tests green; manual `pnpm db:make-superadmin` (no args) prints usage.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → POST /api/auth/login | Untrusted credentials (existing) |
| client → POST /api/auth/refresh | Refresh cookie scoped to /api/auth (existing) |
| dev shell → make-superadmin script | Trusted dev/operator; no untrusted input |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-07-01 | Spoofing (suspended user reuses session) | Login route SUSPENDED branch | mitigate | After password verifies, branch returns 403 BEFORE cookie issuance. Verification: login/route.test.ts asserts no Set-Cookie on SUSPENDED branch. |
| T-03-07-02 | Spoofing (already-issued JWT) | Refresh route SUSPENDED branch | mitigate | Re-checks status on every refresh; access JWT 15-min lifetime guarantees suspension takes effect within 15 min worst case. Verification: refresh/route.test.ts asserts 403 + no rotation. |
| T-03-07-03 | Information Disclosure (timing attack regression) | Login route ordering of SUSPENDED check | mitigate | SUSPENDED check is AFTER password verify, so non-existent emails and SUSPENDED accounts both go through the dummy-bcrypt path identically before any branching observable to the attacker. (Pitfall 2 — verified by inspection that the existing dummy-bcrypt-on-missing-user path is unchanged.) |
| T-03-07-04 | Tampering (PROTECTED file regression) | Phase 1 invariants in login.ts | mitigate | Existing login/route.test.ts continues to pass after the edit; the SUSPENDED test is additive. CI gate: `pnpm test` on the file. Verification: vitest run exits 0 with both old and new tests. |
| T-03-07-05 | Repudiation (bootstrap SUPERADMIN) | make-superadmin script | mitigate | logAdminAction with action='BOOTSTRAP_SUPERADMIN' inside `prisma.$transaction` — promotion + audit row are atomic. Verification: scripts/make-superadmin.test.ts asserts AdminAction count goes from 0 to 1 in one tx. |
| T-03-07-06 | Tampering (CLI script with shell-shipped args) | make-superadmin email arg | mitigate | `args[0]?.trim().toLowerCase()` + `prisma.user.findUnique` (parametric) — no shell injection surface. The script does not accept role or other mutable parameters. |
| T-03-07-07 | Elevation (any user runs CLI to promote themselves) | make-superadmin shell access | accept | Script requires shell access to a host that has DATABASE_URL. The threat model assumes only operators can run dev shells (this is the bootstrap path; production sets the SUPERADMIN once and locks it down via DB-side IAM / Neon role separation). Documented in CONTEXT.md D-SCRIPT-01 + RESEARCH.md "Specific Ideas". |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/auth/login/route.test.ts src/app/api/auth/refresh/route.test.ts scripts/make-superadmin.test.ts` exits 0 (all old + new tests)
- `pnpm test` (full suite) exits 0
- `pnpm typecheck && pnpm lint` exit 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 (protected files still export runtime='nodejs')
- `pnpm --filter frontend exec tsx scripts/make-superadmin.ts` (no args) exits 1 with "Usage:" stderr
</verification>

<success_criteria>
- SUSPENDED users cannot log in (403 ACCOUNT_SUSPENDED, no cookies issued)
- SUSPENDED users cannot refresh (403 ACCOUNT_SUSPENDED, no rotation)
- Phase 1 login + refresh tests still all pass
- `pnpm db:make-superadmin <email>` promotes a user, writes the audit row, exits 0
- `pnpm db:make-superadmin <missing>` exits 1 with clear stderr
- `pnpm db:make-superadmin <existing-superadmin>` exits 0 with no-op message
</success_criteria>

<output>
After completion, create `.planning/phases/03-admin-organizations-orders/03-07-SUMMARY.md` documenting:
- Two protected files modified (with line numbers of the SUSPENDED check insertions)
- The "I am about to modify X because Y — confirm?" wording was emitted before any edit
- Bootstrap script ships at frontend/scripts/make-superadmin.ts; root `db:make-superadmin` script wires through
- All Phase 1 tests still passing
</output>
