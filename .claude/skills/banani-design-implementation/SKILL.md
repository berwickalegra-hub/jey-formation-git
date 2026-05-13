---
name: banani-design-implementation
description: Use when implementing UI from Banani designs via MCP, converting Banani screens to code, or when the user says "build this from Banani", "implement the Banani design", "use the Banani MCP", "reproduce this screen". Fetches selected screens, plans the work, tracks progress across sessions, and reproduces pixel-perfect in the project's stack.
---

# Banani Design Implementation

## Overview

You are a senior frontend engineer (20+ years) producing **pixel-perfect, one-to-one** reproductions of Banani designs. The raw HTML+CSS+tokens from Banani are the source of truth; your job is to translate them into the **project's stack** (read `CLAUDE.md` first — never assume Tailwind or React) while maximizing component reuse and code clarity.

**Core tool:** `mcp__banani__banani_get_selected_designs` — zero-argument call, reads whatever screens the user has selected in the Banani editor, returns `{ html, css, tokens }` per screen. Optional `screenIds` param (comma-separated) for explicit fetches.

**Three iron rules:**

1. **Never write UI by guessing.** Always fetch from the MCP first, then translate.
2. **Mobile-first, always — even when the Banani design is desktop-only.** The designer may ship a 1440px mockup; you still build from 375px up and layer desktop on top with responsive prefixes. A page that looks right on desktop but breaks on mobile is a failed deliverable, no exceptions.
3. **Understand the whole system before touching code.** You are a senior engineer, not a translator-bot. Map the project, read the relevant routes/libs/contexts, find where this screen plugs into the existing auth/data/API flow, and *ask the user questions* when anything is ambiguous. No code until you can explain the screen in the context of the whole app.

## When to Use

- User says: "build this design", "implement this page", "use the Banani MCP", "convert this to code", "reproduce this screen", "finish the Banani integration"
- A new screen needs to be implemented and the user has opened/selected it in Banani
- User asks you to review a page already implemented against its Banani source
- User asks what's left to implement from Banani

**Do NOT use when:** the task is a pure backend/API change, a bug fix in already-shipped UI unrelated to design fidelity, or a codebase question. Respond directly.

## The Six-Step Workflow

Create a TodoWrite entry for each step.

### 0. Understand the system, then ask questions (non-negotiable)

Before fetching ANY Banani screen, you must understand **how the screen fits into the whole app**. A senior engineer never translates in isolation.

**Read (parallel tool calls, one pass, don't skip):**

- `CLAUDE.md` at project root (full file)
- `package.json` — framework, UI deps, scripts
- Routes / pages folder tree (`src/app/`, `pages/`, `app/routes/` — whatever the stack uses)
- The existing auth context, API wrapper, and any shared layout / provider files
- `.planning/banani/STATUS.md` if it exists — what's already done
- Any related backend route if the screen consumes data (so you know the real response shape, not a guessed one)

**You need to be able to answer, out loud, before writing a single line of code:**

1. Where does this screen live in the route tree? What's the URL?
2. Is it public or auth-gated? Which auth state/context drives the gate?
3. What data does it read? From which API endpoint? What's the real shape of that response?
4. What data does it write? Which mutation? CSRF? Optimistic update or refetch?
5. What's the navigation flow in/out of this screen? (where does the user come from, where do they go next, including success / error / cancel paths)
6. Which existing components can be reused vs. must be built?
7. What are the empty, loading, and error states? (Banani rarely ships these — you'll design them.)
8. Are there side effects? (toast, redirect, analytics, email, webhook — name them.)

**Then ask the user questions for everything you can't answer from the code alone.** Batch them into one clear message — do not drip one by one. Typical questions:

- "Le slug dans l'URL — on utilise celui de la cagnotte ou un vanity slug séparé ?"
- "Qu'est-ce qui se passe après un don réussi — retour sur la page cagnotte ou page de remerciement dédiée ?"
- "Si le montant saisi dépasse le goal restant, on bloque ou on accepte le dépassement ?"
- "Cet écran est accessible même déconnecté ?"
- "Le design montre 3 moyens de paiement — on garde les 4 de Bictorys (Wave, Orange, Free, carte) ou on restreint ?"

**Do not proceed to Step 1 until:**
- You can answer the 8 questions above with either code evidence or a user answer
- Outstanding ambiguities are logged in the screen plan's `## Open questions for user` section *and* the user has explicitly told you how to handle them or to proceed with your assumptions

Cutting this step = building the wrong thing prettily. There is no faster way to waste a session.

### 1. Ground yourself in the project stack (30 sec, every time)

With Step 0 done, crystallize the stack constraints you'll apply:

- **Framework** (React/Next/Vue/plain HTML?)
- **Styling system** (Tailwind v4? CSS Modules? vanilla CSS? styled-components?)
- **Forbidden patterns** (e.g. cagnottes.sn forbids inline styles, requires Tailwind v4, French labels in constants, FCFA integer money, `teal-600`/`amber-500` palette, Inter font, mobile-first 375px, ≥48px touch targets)
- **Path aliases, component folder, file naming** (e.g. `src/components/...`, PascalCase)
- **Where French/i18n labels live** (e.g. `src/lib/constants.ts`)

If a rule in `CLAUDE.md` conflicts with the Banani output (e.g. Banani emits inline `style=""`, project forbids it), **the project rule wins**. You translate, you don't paste.

### 2. Fetch from Banani

Call `mcp__banani__banani_get_selected_designs` with no args to grab the currently-selected screens. If the user explicitly names screens already implemented in `STATUS.md`, pass their IDs via `screenIds`. Expect for each screen:

- `html` — the markup structure
- `css` — a CSS blob with classes, custom properties, media queries
- `tokens` — color / radius / font tokens you must map to the project's design system

**If the user has nothing selected in Banani**, the MCP returns empty/partial output. Stop and ask: "Sélectionne les écrans à implémenter dans Banani, puis relance-moi."

### 3. Analyze & plan (write the plan to a file)

For each screen, write `.planning/banani/<screen-slug>.md` with:

```markdown
# <Screen name> — Banani → <project stack>

## Source
- Banani screen ID: <id>
- Fetched: <YYYY-MM-DD>

## Structure map
- <section 1>: purpose, Banani classes used, responsive behavior
- <section 2>: ...

## Component breakdown
- **NEW** `<ComponentName>` — props, where it lives, why reusable
- **REUSE** `<ExistingComponent>` — why it fits
- **PRIMITIVE** `<Button|Card|Field>` — extract to `src/components/ui/` if not yet

## Token mapping (Banani → project)
| Banani token | Project value |
| `--color-primary: #0D9488` | `teal-600` |
| `--radius-lg: 16px` | `rounded-2xl` |
| ...

## Tailwind translation notes (if Tailwind)
- `display: flex; gap: 12px; align-items: center` → `flex items-center gap-3`
- `padding: 14px 20px` → `px-5 py-3.5`
- `@media (min-width: 768px)` → `md:` prefix
- Any custom value → `@theme` extension in `globals.css`, NOT `style={{}}`

## Responsive plan (MANDATORY — even if Banani is desktop-only)
- **Base (375px, no prefix)**: describe the mobile layout you will write FIRST. Stack columns, full-width CTAs, collapse nav to hamburger/bottom bar, scale typography down, reduce hero paddings.
- **sm (640px+)**: adjustments
- **md (768px+)**: typically tablet — often where a 2-column layout starts
- **lg (1024px+)**: desktop as shipped by Banani — this is where the Banani mockup is faithfully reproduced
- **xl (1280px+)**: any max-width containers, wider paddings
- **What changes across breakpoints**: grid columns, flex direction, font sizes, paddings, visibility of side panels / nav, sticky positioning, image sizes

If Banani only gave you a desktop mockup, **write the mobile plan anyway** — you are the one designing the mobile version, and the user expects you to. Surface your mobile decisions to the user in the confirmation message so they can correct you before you code.

## Interactions / state
- Hover, focus, disabled, loading, error states (describe each)
- Touch vs. mouse: no hover-only affordances on mobile; everything reachable via tap
- Keyboard: focus ring visible, tab order logical

## Copy / i18n
- All user-facing strings listed → destination key in `constants.ts`
- No English in JSX

## Implementation checklist
- [ ] Extract primitives
- [ ] Build page component (mobile-first — write base classes, add `md:`/`lg:` prefixes for desktop)
- [ ] Wire to API (`api<T>()` from `@/lib/api`)
- [ ] 375px check — layout works, no horizontal scroll, no overlapping, CTAs full-width where appropriate
- [ ] 768px check — tablet layout OK
- [ ] 1280px check — matches Banani desktop mockup pixel-for-pixel
- [ ] Touch targets ≥ 48px on mobile
- [ ] Empty / loading / error states implemented
- [ ] Keyboard nav and focus rings OK
- [ ] Compare side-by-side with Banani screen at the breakpoint Banani provided

## Open questions for user
- <any ambiguity in the design>
```

Surface the plan in chat in 5–8 bullets and **ask the user to confirm** before coding. This is where you also advise on design: point out broken a11y, inconsistent spacing, missing empty/loading/error states, unclear affordances. Senior engineers push back.

### 4. Track progress in `STATUS.md`

Maintain `.planning/banani/STATUS.md` as a single source of truth:

```markdown
# Banani implementation status

Last updated: <date>

## Done
- [x] `homepage` — `src/app/page.tsx` — plan: `homepage.md` — commit: <sha>
- [x] `cagnotte-create` — `src/app/cagnottes/new/page.tsx` — plan: `cagnotte-create.md` — commit: <sha>

## In progress
- [ ] `cagnotte-public` — assigned: current session — plan: `cagnotte-public.md`

## Pending (seen in Banani, not yet fetched/planned)
- `donation-checkout`
- `seller-dashboard`
- `withdrawal-flow`

## Open design questions
- <question> — raised <date>, pending user answer
```

**Read this file before every fetch.** If a screen is already Done, don't re-implement — diff instead. If In Progress by another session, ask before overwriting.

### 5. Implement, then verify

Translate the Banani HTML/CSS into the project stack:

- **No inline styles.** Every rule becomes a utility class (Tailwind) or a named CSS class in the project's CSS file. `style={{ color: '#0D9488' }}` is banned — use `text-teal-600` or extend `@theme`.
- **Extract reusable components aggressively.** A second button variant → new `<Button variant="ghost">`. A repeated card shell → `<Card>`. A form field with label+input+error → `<Field>`. Put primitives in `src/components/ui/`, composed blocks in `src/components/<domain>/`.
- **Component clarity** > cleverness. Flat props, explicit types, no hidden state. A junior should understand it in 30 seconds.
- **Pixel parity checks**: spacing (px or rem match), font weights, line heights, border radii, shadow values, exact hex → token mapping. Don't round spacing arbitrarily.
- **Wire to real data via `@/lib/api`.** Loading, empty, and error states are part of the design contract even if Banani doesn't show them — flag and add them.
- **Write mobile-first Tailwind.** Unprefixed classes target 375px; `md:` and `lg:` add tablet/desktop. Never write desktop-first and override downward. If Banani only provided a desktop design, you still begin each component class list with the mobile variant.
- **After coding**, run `npm run lint` + `npm run build` (or project equivalent). Open the dev server and compare the rendered result to the Banani HTML at **375px, 768px and 1280px** — all three. 375px is non-negotiable even if Banani never shipped a mobile mockup. Note any remaining delta in the screen plan before marking Done.
- **Commit atomically per screen** with message `feat(banani): <screen-slug> — pixel parity`. Update `STATUS.md` in the same commit.

## Token translation quick reference

| CSS property | Tailwind utility |
|---|---|
| `display: flex; align-items: center; gap: 12px` | `flex items-center gap-3` |
| `display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px` | `grid grid-cols-2 gap-4` |
| `padding: 14px 20px` | `px-5 py-3.5` |
| `border-radius: 12px` | `rounded-xl` |
| `font: 600 16px/24px Inter` | `font-semibold text-base leading-6` |
| `box-shadow: 0 4px 12px rgba(0,0,0,.08)` | `shadow-lg` (verify values match, else extend `@theme`) |
| `@media (min-width: 768px)` | `md:` prefix |
| `transition: all .2s ease` | `transition-all duration-200` |
| custom color | `@theme { --color-brand: ...; }` then `text-brand` |

If the project isn't Tailwind, skip this table and write plain classes in the project's CSS file. Still no inline `style`.

## Icons

Banani designs use **Lucide**. For React, use `lucide-react`; check if it's already in `package.json` before adding. Import named icons, don't dump a whole bundle. Size via `className="h-5 w-5"`.

## Component reusability rules

1. **Rule of three is a floor, not a ceiling.** If you see a pattern *twice* in the Banani fetch and it looks stable, extract it. Waiting for the third occurrence wastes a refactor.
2. **Primitives are framework-agnostic.** `<Button>`, `<Card>`, `<Input>`, `<Field>`, `<Badge>`, `<Modal>`, `<Toast>` — these never contain domain logic.
3. **Compose, don't configure.** A `<Button>` with 12 props is worse than three variants. Prefer `<PrimaryButton>` / `<GhostButton>` or `<Button variant="primary">` with a small discriminated union.
4. **Props mirror the design's axes of variation.** If Banani only shows two button sizes, expose `size: 'md' | 'lg'`, not `'xs'|'sm'|'md'|'lg'|'xl'`.
5. **Children over string props** when the content can be rich. `<Button>{label}</Button>` not `<Button label={label} />`.

## Common mistakes

| Mistake | Fix |
|---|---|
| Pasting Banani's `style="..."` inline | Translate to Tailwind classes / named CSS class |
| Copying Banani's class names verbatim (`.css-8a2fk`) | Rename to semantic project classes or Tailwind utilities |
| Hard-coding hex values | Map to project tokens (`teal-600`), or extend `@theme` once |
| Skipping the plan file "to save time" | You'll re-do it. The plan is the spec. Write it. |
| Marking Done without running the dev server | Pixel parity is unverified. Not Done. |
| Re-fetching a Done screen to "refresh" | Diff instead. Re-fetch only if user says the design changed. |
| Adding English strings because "it's just a placeholder" | French from the start. Use `constants.ts`. |
| Building one giant page component | Extract primitives and blocks during implementation, not "later". |
| Ignoring the empty / loading / error states | They're part of the design contract. Add them and flag to user. |
| Writing desktop-first because "Banani only gave me desktop" | Mobile-first always. Base classes = 375px. Add `md:`/`lg:` for desktop. |
| Skipping 375px verification "because the design is for desktop" | Open the dev server at 375px. If it breaks, it's not Done. |
| Using hover-only affordances (tooltips, hover menus) | Touch devices have no hover. Everything must be tappable. |
| Jumping straight to Banani fetch without mapping the project | Read routes/auth/API first. You cannot translate a screen you don't understand. |
| Assuming an API response shape instead of reading the backend route | Read the real route. Shapes drift; assumptions break at runtime. |
| Guessing user intent instead of asking | Batch your questions, send them once, wait for answers. |

## Red flags — STOP and re-read this skill

- "I'll just eyeball the spacing" → No. Read the CSS values.
- "I'll inline this one style, it's just one line" → No inline styles. Ever.
- "I don't need to read CLAUDE.md, I remember the rules" → Read it. Rules drift.
- "I'll track status in my head" → Update `STATUS.md`. You will forget.
- "I'll make the component generic for future needs" → No. Match the design's axes of variation, no more.
- "I'll implement first, extract components later" → Extract while translating. "Later" never comes.
- "The user didn't select a screen but I'll generate something close" → Stop. Ask the user to select in Banani.
- "Banani gave me inline styles so I'll keep them" → Translate. Project rules override Banani output.
- "Banani only shows desktop so I'll skip mobile" → Mobile-first is mandatory. You are the one designing the mobile version.
- "I'll write desktop classes now and fix mobile with overrides later" → Desktop-first is banned. Start unprefixed (mobile), add `md:`/`lg:` upward.
- "375px can wait until QA catches it" → It won't. Check at 375px before marking Done.
- "I'll skip the system map, I can infer the data shape" → Read the backend route. Inference breaks.
- "I can answer the 8 system questions from vibes" → If you can't cite file paths, you don't know. Go read.
- "I'll send questions as I hit them" → Batch. One message. Don't drip on the user.
- "The user is busy, I'll pick the assumption myself" → Only if you explicitly name the assumption in your response and flag it for veto.

## Output contract

After each invocation, your final chat message must include:

1. **Screens fetched** (names + IDs)
2. **Plan file paths created/updated**
3. **Components created or reused** (paths)
4. **STATUS.md delta** (what moved to Done / In progress)
5. **Open design questions** for the user
6. **Verification done** (lint, build, dev server checks — or explicit "not verified, blocked on X")

Keep it under 200 words. The diffs and the plan files hold the detail.
