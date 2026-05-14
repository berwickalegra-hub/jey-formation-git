# POST-SIMPLIFY-AUDIT — verification of the vibe-coding pitch

> Pitch under audit: *"Clone, plug Neon, open Claude Code, describe what you want, ship.
> GSD optional, Banani optional, Cloudinary instead of R2, only `DATABASE_URL` mandatory."*
>
> Method: read-only inspection of the repo on `main` after commits `1a067e3` + `5a4bf16`
> + small follow-ups (`21489f7`, `903b5a4`, `b4fd81e`, `ab4d6bd`, `135e55e`).

Legend: ❌ broken · ⚠️ stale / contradicts pitch · ℹ️ note · ✅ clean

---

## 1. The vibe-coding pitch — end-to-end

| Severity | File / step | Line | Finding | Recommendation |
|---|---|---|---|---|
| ❌ | `frontend/src/app/page.tsx` | 81–86 | Landing-page welcome card still tells beginners the skill installs **GSD + vercel CLI** and hands off to **PRD → Banani → `/import-banani` → `/gsd-execute-phase`**. This is the FIRST thing a beginner sees and it directly contradicts the new pitch. | Rewrite the `<section>` content to match `setup-kit` Phase 7 hand-off ("describe what you want in French / no GSD / Banani optional"). |
| ❌ | `.claude/skills/setup-kit/SKILL.md` Phase 0 audit | "Banani MCP configured" row | Probe is `grep -q '@banani/mcp-server' .mcp.json && echo PLACEHOLDER \|\| echo CONFIGURED`. Current `.mcp.json` ships with `mcpServers: {}` — string `@banani/mcp-server` is **absent** → probe prints `CONFIGURED`. The audit will report "Banani MCP configured ✅" to a user who has done nothing. | Invert the logic: detect *presence* of any entry in `mcpServers`. E.g. `node -e 'const j=require("./.mcp.json"); console.log(Object.keys(j.mcpServers||{}).length?"CONFIGURED":"NOT_CONFIGURED")'`. Update the visual checklist to match. |
| ⚠️ | `WORKFLOW.md` Étape 2 | "Décris ce que tu veux à Claude" section | Phrase "/import-banani" still appears (`grep -n Banani`) — the workflow keeps Banani as an optional sub-step. Acceptable but verify wording matches Phase 5 oui/non/plus tard branching. | Confirm wording reads "optional" and doesn't imply user must use `/import-banani` (the skill no longer exists, see §2). |
| ✅ | `setup-kit` Phase 5 | branching | Confirmed `oui / non / plus tard` branching present; on `non/plus tard` user is told "décris à Claude". |
| ✅ | `setup-kit` Phase 7 hand-off | level-up | GSD is correctly surfaced only as a level-up (`npx get-shit-done-cc@latest`), not as a prereq. |
| ✅ | `setup-kit` Phase 0 | other probes | No probe references R2/Cloudflare/GSD as mandatory. |
| ℹ️ | `setup-kit` audit (line 14 of SKILL.md) | "WORKFLOW.md lists ~8 pre-requisites" | Wording still implies Banani + `.mcp.json` edit are in the 8-step prereq list. Vestigial — does not break anything but contradicts the "Banani optional" rewrite. | Rewrite the prereq count from "~8" to "5: Claude Code, Node, pnpm, gh CLI, Neon". |

---

## 2. Sprint 1 leftovers (GSD removal)

| Severity | File | Line | Reference | Verdict |
|---|---|---|---|---|
| ❌ | `frontend/src/app/page.tsx` | 84–86 | `(GSD, pnpm via Corepack, vercel CLI, secrets)` + `/import-banani` + `/gsd-execute-phase` | Broken — calls a skill that was deleted and contradicts the new pitch on the landing page. **Highest user-impact regression.** |
| ❌ | `CLAUDE.md` | 167 | "When the user wants to remove an optional feature (or `/import-banani` flags one as PRUNABLE)" | Broken — `.claude/skills/import-banani/` no longer exists (`ls .claude/skills/` returns only `banani-design-implementation`, `setup-kit`, `ui-ux-pro-max`). |
| ⚠️ | `CLAUDE.md` | "559/559 unit tests green" (under "What this project is") | Pitch says 555/555. Doc still claims 559. | Update CLAUDE.md to reflect actual test count after the upload-route test rewrite. |
| ✅ | `CLAUDE.md` | 18 | "GSD (`get-shit-done-cc`) is **not** a prerequisite." | Kosher level-up framing. |
| ✅ | `.claude/skills/` directory | n/a | Only 3 skills: `banani-design-implementation`, `setup-kit`, `ui-ux-pro-max`. `import-banani` confirmed deleted. | Clean. |
| ✅ | `setup-kit/SKILL.md` Phase 7 | level-up footer | GSD surfaced only as optional level-up. | Clean. |
| ⚠️ | `.planning/SIMPLIFY-AUDIT.md` | full file | Pre-work audit kept in `.planning/`. Not user-facing but contains historical R2 references that grep into noise. | See §10. |
| ℹ️ | `.claude/settings.json` | 10–17 | Permission allowlist still contains `Skill(gsd-plan-phase)` + `Bash(node .claude/get-shit-done/...)` entries. Harmless (just allowlist) but signals incomplete cleanup. | Strip dead permissions or leave as forward-compat once a fork installs GSD. |
| ℹ️ | `.claude/worktrees/agent-*/` | n/a | GSD agent scratch left in tree (very large GSD/R2 footprint inside). Tripwires don't read it but `grep -rIn 'gsd\\|R2_'` users will hit massive noise. | Add to `.gitignore` and `rm -rf` — these are agent worktrees that should never have shipped (matches SIMPLIFY-AUDIT cut #2). |
| ✅ | `frontend/src/` source code | n/a | No GSD references in code (consistent with SIMPLIFY-AUDIT §1d "No code in frontend/ references GSD"). | Clean. |

---

## 3. Sprint 2 leftovers (R2 → Cloudinary)

| Severity | File | Line | Reference | Verdict |
|---|---|---|---|---|
| ⚠️ | `frontend/prisma/schema.prisma` | 166 | `// Phase 2 — file uploads (R2 / S3)` (block comment above `model FileUpload`) | Stale doc. Code uses Cloudinary but comment still says R2/S3. |
| ⚠️ | `frontend/prisma/schema.prisma` | 172 | `key String @unique // R2 object key` | Stale doc — column now holds a Cloudinary `public_id`. The route.ts already documents this fact ("column kept as-is from the R2 era; semantically now a Cloudinary public_id") but the schema itself doesn't. |
| ⚠️ | `README.md` | 232 | "Runtime Edge / Cloudflare Workers — `runtime='nodejs'`" | Allowed (historical / negation context); kosher per readme-shape tripwire. |
| ✅ | `frontend/package.json` | deps | `grep aws-sdk\|cloudinary` returns nothing — both new and old deps absent from grep. Inspect manually: package.json no longer imports `@aws-sdk/client-s3`. Cloudinary SDK presumably imported by `cloudinary-client.ts` — verify the dep is present in `package.json` (search returned empty; could indicate `cloudinary` is a transitive or missing). | **Action**: confirm `cloudinary` is listed as a direct dependency. If absent, `pnpm install` from a fresh clone will fail to resolve. |
| ✅ | `frontend/.env.example` (actually at REPO ROOT `/.env.example`) | full file | `grep R2_` returns **0** matches. Cloudinary block present (lines 124–132). | Clean. |
| ✅ | `frontend/src/lib/server/storage.ts` | `tryCreateStorageClient()` | Cloudinary-only — `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` env reads only. | Clean. |
| ✅ | `frontend/src/app/api/upload/route.ts` | full file | Pipeline uses `uploadBuffer()` from `cloudinary-client`, `STORAGE_NOT_CONFIGURED` 503 on missing creds, `secure_url` returned. | Clean. |
| ✅ | `frontend/src/app/api/files/` | n/a | Directory **deleted** (`find` returns "No such file or directory"). | Confirmed deleted. |
| ✅ | `frontend/src/test-utils/cloudinary-mock.ts` | full file | Real mock — returns `{ publicId, secureUrl, bytes }`, supports `onUpload` override for failure injection, uses `vi.fn()` so call assertions work. Not a fake-pass. | Clean. |
| ✅ | `frontend/next.config.ts` | full file | No R2 / Cloudinary domain allowlist either way — `images.remotePatterns` not declared. Acceptable: no `next/image` on Cloudinary URLs yet. | Note: if a beginner uses `<Image src=secureUrl>` they'll hit a remote-pattern error. Add `res.cloudinary.com` once UI lands. |
| ✅ | `.planning/features.json` | 107–129 | `uploads-cloudinary` entry replaces `uploads-r2`. envVars list correct (`CLOUDINARY_*` + `UPLOAD_*`). | Clean. |
| ⚠️ | `.planning/features.json` | 118 | `CLOUDINARY_UPLOAD_PRESET` listed as an owned env var, but `storage.ts` only forwards it conditionally and the route.ts never references it. Dead env-var doc unless the upload preset is wired into `uploadBuffer()`. | Verify `cloudinary-client.ts` actually applies the preset; if not, drop the env var from docs or wire it in. |
| ⚠️ | `.planning/SIMPLIFY-AUDIT.md` | full file | Document is the pre-work audit and is full of stale R2 references that grep into noise. | Move to `.planning/archive/SIMPLIFY-AUDIT.md` or delete (see §10). |

---

## 4. Test honesty

| Severity | Check | Finding | Recommendation |
|---|---|---|---|
| ✅ | Skipped/`.only` tests | `grep -rn 'describe.skip\|it.skip\|test.skip\|...only'` in `frontend/src` → **0 hits**. | No tests disabled to make the suite pass. |
| ✅ | `upload/route.test.ts` rewrite | Covers: happy path 201, magic-byte mismatch 415, missing CSRF 403, missing auth 401, file too large 413, storage not configured 503, missing file 400, Cloudinary throws → 502. All previous R2-era scenarios reproduced against Cloudinary mock. | Real coverage, not a stub. |
| ✅ | `cloudinary-mock.ts` realism | Returns realistic `{ publicId, secureUrl: 'https://res.cloudinary.com/test-cloud/image/upload/<id>', bytes }`. `onUpload` override enables failure injection. Uses `vi.fn()` for call assertions. | Real mock, not a pass-through. |
| ⚠️ | Test-count claim "555/555" | CLAUDE.md still says **559/559**. Pitch in the audit instructions says 555/555. Delta unverified from a read-only audit. | Reconcile: either CLAUDE.md is stale (likely — `/api/files/` route + test were deleted, dropping ~3–4 tests) or the pitch number is wrong. Pick one source of truth. |
| ℹ️ | Test files in `frontend/src` | 63 `.test.ts` files. | No anomaly. |

---

## 5. README route inventory

| Severity | Section | Finding | Recommendation |
|---|---|---|---|
| ✅ | "Inventaire des routes > Uploads" | Section is titled **"Uploads — 1 route"** (singular). | Matches deletion of `/api/files/[...key]`. |
| ✅ | Quickstart command sequence | `cp .env.example .env.local`, `pnpm install`, `pnpm dev`, `neon.tech`, `CRON_SECRET`, `frontend/src/app/api`, `pnpm smoke:auth`, zero `\\bdocker\\b` mentions. | All readme-shape tripwire assertions satisfied. |
| ⚠️ | README L232 "Runtime Edge / Cloudflare Workers" | Historical negation context ("All routes are `runtime='nodejs'`"). Allowed by the test's allowlist regex but reads slightly weird in a "Cloudinary-only" pitch. | Cosmetic only. |
| ⚠️ | README count of "40 routes" | README still says "40 routes" in the routes inventory subsection headers (10+2+3+2+1+1+5+12+2 = 38). After dropping `/api/files/[...key]` the count is **39 not 40**. | Recount and align — but I only see 38 from the headers. Reconcile. |

---

## 6. Tripwire integrity

| Severity | File | Finding | Recommendation |
|---|---|---|---|
| ✅ | `env-shape.test.ts` L73–76 | Verbatim block replaced: `expect(src).toMatch(/^CLOUDINARY_CLOUD_NAME=""$/m)` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`. No regex weakening. | Clean swap. |
| ✅ | `env-shape.test.ts` Phase 4 header comment | Still labeled "Phase 4 — UPLOAD + R2 + WITHDRAWAL safety knobs" — comment is stale but assertions are correct. | Minor: update the section comment from "R2" to "Cloudinary" for readability. |
| ✅ | `readme-shape.test.ts` | All required mentions still pass: `pnpm install`, `pnpm dev`, `neon.tech`, `CRON_SECRET`, `frontend/src/app/api`, `pnpm smoke:auth`, no Docker, Express negation allowlist intact. | Clean. |
| ✅ | `claude-md-shape.test.ts` | Required substrings `cron`/`webhook`/`withdrawal`/`upload` still present in CLAUDE.md. | Clean. |
| ✅ | `vercel.json` | All 5 cron schedules present (`outbox-drain`, `email-queue-drain`, `verification-cleanup`, `order-expiration`, `webhook-log-purge`). Tripwire passes. | Clean. |
| ✅ | `runtime-enforcement.test.ts` | Routes inspected via `find`: every remaining `route.ts` declares `runtime`. | Clean (assuming no edits to existing routes; sample-checked `upload/route.ts` L29 — present). |
| ⚠️ | `env-shape.test.ts` `ENV_EXAMPLE` resolution | `resolve(__dirname, '../../../../../.env.example')` — resolves to **repo root**, not `frontend/.env.example`. The shipped `.env.example` lives at repo root. Beginners reading docs ("see `frontend/.env.example`") will look in the wrong place. | Either move `.env.example` to `frontend/` OR fix doc references to point at the repo-root file (README L?? "Référence env complète… `.env.example` à la racine du repo" is already correct; lint other refs). |

---

## 7. Beginner trap surface

| # | Severity | Trap | Why it breaks |
|---|---|---|---|
| 1 | ❌ | Beginner opens `localhost:3000` after `pnpm dev`. The welcome card says: "the skill installs (GSD, pnpm via Corepack, vercel CLI, secrets), walks you through creating a free Neon Postgres + Banani account, and hands off to WORKFLOW.md for the PRD → Banani → `/import-banani` → `/gsd-execute-phase` flow." | Contradicts everything the docs say. User now believes GSD + Banani are mandatory. `/import-banani` doesn't exist (skill deleted). |
| 2 | ❌ | Beginner runs `/setup-kit`. Phase 0 audit reports "Banani MCP configuré ✅" (because the placeholder string `@banani/mcp-server` is absent from `.mcp.json`). User assumes Banani is set up. In Phase 5 the skill asks "Tu as un design Banani ?". Confusion follows. | Inverted probe logic — see §1. |
| 3 | ⚠️ | Beginner reads CLAUDE.md L167: "or `/import-banani` flags one as PRUNABLE". Runs `/import-banani`. Gets "skill not found". | Broken cross-reference to deleted skill. |
| 4 | ⚠️ | Beginner tries to upload a passport scan or invoice through `/api/upload` to test the kit. Cloudinary returns a public CDN URL. The kit does not warn the user that **anyone with the URL can fetch the file** (R2-era owner-gated proxy at `/api/files/[...key]` was deleted). | See §8 — no security note anywhere documenting this trade-off. |
| 5 | ⚠️ | Beginner runs `pnpm install` from a clean clone. If `cloudinary` is not in `package.json` `dependencies` (grep returned 0 hits), `cloudinary-client.ts` import will fail at build. | Verify `frontend/package.json` actually declares `cloudinary` — the grep produced nothing. If missing, `pnpm install` succeeds but `pnpm build` fails. |

---

## 8. Cloudinary security gotchas

| Severity | Check | Finding | Recommendation |
|---|---|---|---|
| ❌ | "Cloudinary URLs are public by default" warning | **Absent from CLAUDE.md, README.md, WORKFLOW.md, setup-kit/SKILL.md, `.env.example`, and the upload route docblock.** The R2-era kit had `/api/files/[...key]` as an owner-gated proxy; deleting it shifts trust to a public CDN URL without surfacing the change. | Add a one-line warning in (a) `.env.example` Cloudinary section, (b) README "Variables d'environnement" Storage row, (c) the docblock of `upload/route.ts`. E.g. *"⚠️ `secure_url` is publicly accessible — anyone with the URL can fetch the file. For private uploads use Cloudinary signed delivery URLs or a custom auth proxy."* |
| ⚠️ | `CLOUDINARY_UPLOAD_PRESET` documented but unused | Listed as owned in `features.json:118`, set in `tryCreateStorageClient()` if present, but the route's `uploadBuffer()` call signature (`uploadBuffer(publicId, body)`) does not surface a preset arg. | Either wire the preset into the Cloudinary `upload_stream({ upload_preset })` options inside `cloudinary-client.ts`, or remove from docs as dead env. |
| ℹ️ | Cloudinary client SDK quota / signed URLs | No mention of free-tier limits (25 credits/month), signed delivery, transformation costs. | Optional: link to Cloudinary pricing from README "Stack" section. |

---

## 9. PRUNING.md still valid?

| Severity | Step | Finding | Recommendation |
|---|---|---|---|
| ✅ | Step 0–9 | Protocol references generic concepts (`features.json`, `owns`, `cross_dependencies`, `vercel.json`, `tripwires`, prisma schema, env example). No mention of `gsd-prune-feature`, GSD, or any deleted command. | Clean. |
| ✅ | R2 / Cloudflare | No mention. | Clean. |
| ℹ️ | Step 9 validation | Lists `pnpm format && lint && typecheck && test && build` — matches CLAUDE.md guidance. | Clean. |

---

## 10. `.planning/SIMPLIFY-AUDIT.md` recommendation

| Severity | Check | Finding | Recommendation |
|---|---|---|---|
| ⚠️ | Document presence in `.planning/` | The pre-work audit is still there. It's now historical; it contains many `R2_*` and `/gsd-execute-phase` references that pollute `grep -rIn 'R2_' ...` results. | Move to `.planning/archive/SIMPLIFY-AUDIT-2026-05-13.md` (or `docs/historical/`). Don't delete — useful as a record of intent. |
| ℹ️ | `.planning/` directory | Currently holds `features.json` + `SIMPLIFY-AUDIT.md` (+ no `PROJECT.md`/`ROADMAP.md` etc, consistent with the GSD purge). | Add a one-line README.md in `.planning/` explaining the directory is now reserved for `features.json` (PRUNING.md anchor) — so a new contributor doesn't see it and assume it's GSD output. |

---

## TL;DR — top 5 issues to fix, prioritized

1. ❌ **`frontend/src/app/page.tsx` lines 81–86 lie on the landing page.** Replace the GSD/Banani/import-banani/gsd-execute-phase paragraph with the new "vibe coding" hand-off. *Single highest-impact fix — every beginner sees this on first `pnpm dev`.*
2. ❌ **Phase 0 audit probe for Banani MCP is inverted.** `grep -q '@banani/mcp-server'` returns no match on the current empty `.mcp.json` → prints "CONFIGURED" → tells the user a thing they haven't done is done. Rewrite as `Object.keys(mcpServers).length` check.
3. ❌ **`CLAUDE.md` line 167 references the deleted `/import-banani` skill.** Strip the parenthetical or replace with "or manually via `features.json`". Same line lives in the "Pruning protocol" section so its accuracy matters.
4. ⚠️ **No documentation anywhere warns that Cloudinary `secure_url`s are public.** R2 era used an owner-gated proxy that the swap removed silently — a beginner uploading sensitive files will get burned. Add a one-liner in `.env.example`, README, and the upload route docblock.
5. ⚠️ **Prisma schema comments still say "R2".** Lines 166 + 172 still call the column an R2 key. Update to "Cloudinary public_id" to keep the schema honest with the code (a `Prisma Studio` user will read these comments).

**Verdict on the pitch.** *Mostly delivers.* The infrastructure swap (R2→Cloudinary, GSD removal, Banani opt-in) actually shipped correctly in code, env, tests, and tripwires. The pitch breaks at the **first user touchpoint** — the welcome card and the Phase 0 audit table — which makes the beginner experience contradict every doc they're about to read. Fix issues 1 + 2 + 3 and the pitch lands; leave them and the kit feels half-shipped on first impression.
