---
name: setup-kit
description: Use when the user wants to bootstrap their dev environment for this Next.js starter from zero. Triggers — "/setup-kit", "je viens d'installer Claude Code", "je débute", "qu'est-ce que je dois installer", "setup my environment", "I just cloned the repo, what now?", "help me start", "I'm a beginner". The kit is cloud-only — there is no Docker, no local Postgres, no MinIO, no Mailpit. Every user creates a free Neon Postgres project, pastes the connection string into .env.local, and runs `pnpm dev`. The skill audits Claude Code (CLI or VS Code extension) / Node / pnpm / gh CLI / 3 Claude Code skills (superpowers, ui-ux-pro-max, context-mode) / env vars, auto-installs what is automatable via Bash (pnpm via Corepack, secret generation), and surfaces explicit paste-ready commands for the rest (slash commands for plugins, Neon signup URL, env keys, Claude Code install command if missing). Banani is OPTIONAL (skill asks oui/non/plus tard in Phase 5). GSD is NOT in prereqs — surfaced as level-up after the first feature, not by default. No Vercel CLI required — deploys happen via GitHub push. Beginner-friendly — assumes zero prior knowledge, explains each step, stops at every human gate with clear instructions. The pitch is **vibe coding**: clone, plug Neon, talk to Claude, ship.
---

# Skill — setup-kit

## Purpose

Take a brand-new user from **« Claude Code just installed, repo just cloned »** to **« `pnpm dev` boots green, `pnpm smoke:auth` passes »** in 5-10 minutes, with maximum hand-holding and minimum hidden assumptions.

The kit is **cloud-only by design**. No Docker. No local Postgres. No MinIO. No Mailpit. The only mandatory dependency is a Postgres database — and a free Neon project takes 30 seconds to create. The 5 optional providers (Resend / Cloudinary / Bictorys / Google OAuth / Sentry / Upstash) are env-gated and inert when absent.

This skill exists because [WORKFLOW.md](../../../WORKFLOW.md) lists ~8 pre-requisites (Claude Code itself, Node, pnpm, gh CLI, 4 Claude Code skills, Neon account, Banani account, .mcp.json edit, .env.local creation, secret generation) and a beginner cannot reliably execute that list without guidance. Deploys go through GitHub push (Vercel imports the repo), so no Vercel CLI install is required locally.

> **Not a magic button.** Several steps require human action (creating Neon + Banani accounts, copying API keys, pasting `/plugin` commands) — the AI cannot do them. The skill makes these gates **explicit, sequential, and unmissable**, instead of letting a beginner discover them via cryptic build errors.

## When to invoke

- User typed `/setup-kit`
- User said any of: « je viens d'installer Claude Code », « je débute », « par où je commence », « qu'est-ce que je dois installer », « I'm a beginner », « help me set up », « I just cloned, what now? »
- The user is clearly lost about pre-requisites (asks « comment lancer le projet ? » with no `node_modules/` and no `.env.local`)

## Beginner Mode — non-negotiable

When this skill is active, you MUST:

1. **Explain every command** before running it (1 line, plain language, no jargon — « pnpm » mérite une phrase, « env var » aussi).
2. **Stop at every human gate** — never silently skip. Print a numbered TODO with URLs the user clicks.
3. **Use French by default** (the kit was authored by a French speaker; switch to English only if the user replies in English).
4. **Never assume prior dev knowledge.**
5. **Verify after each phase** — re-run the relevant check; never proceed on faith.
6. **Maintain a TodoWrite list** with one item per phase. Mark items completed as you go.
7. **Be resumable** — the user may close Claude Code mid-flow. On re-invocation, run the audit first; pick up where it broke.

## Procedure

### Phase 0 — Audit

Run these probes via Bash **in parallel** and build a table.

| Check | Command | Pass criterion |
|---|---|---|
| Claude Code CLI | `claude --version 2>/dev/null \|\| echo MISSING` | semver string (informational — most users run the VS Code extension instead) |
| Node version | `node -v 2>/dev/null \|\| echo MISSING` | starts with `v20.` or higher |
| pnpm version | `pnpm -v 2>/dev/null \|\| echo MISSING` | starts with `9.` or higher |
| GitHub CLI auth | `gh auth status 2>&1 \| head -1` | « Logged in to github.com » present |
| Repo `frontend/.env.local` | `test -f frontend/.env.local && echo EXISTS \|\| echo MISSING` | EXISTS |
| Repo `node_modules` | `test -d frontend/node_modules && echo EXISTS \|\| echo MISSING` | EXISTS |
| MCP config | `test -f .mcp.json && echo EXISTS \|\| echo MISSING` | EXISTS |
| Banani MCP configured (optional) | `node -e 'try{const j=require("./.mcp.json");console.log(Object.keys(j.mcpServers\|\|{}).length?"CONFIGURED":"EMPTY")}catch(e){console.log("MISSING")}'` | EMPTY by default (Banani optional — user opts in in Phase 5). CONFIGURED only if Phase 5 already ran. |
| `DATABASE_URL` set | `grep -q '^DATABASE_URL=postgresql://' frontend/.env.local 2>/dev/null && echo SET \|\| echo UNSET` | SET (must point at Neon, see Phase 4) |

For Claude Code skills, check the system-reminder context loaded at session start — these 3 skill names must appear in the active skills list:
- `superpowers:*` (any — e.g. `superpowers:using-superpowers`)
- `ui-ux-pro-max`
- `context-mode:*` (any — e.g. `context-mode:context-mode`)

GSD (`get-shit-done-cc`) is **not** in the prereqs — it's an optional level-up tool surfaced in Phase 7 when the user finishes their first feature.

Print the result as a checklist:

```
🔍 AUDIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYSTÈME
  ℹ️  Claude Code CLI (extension VS Code OK aussi)
  ✅ Node 20.x       ❌ pnpm (manquant)
  ⏳ gh CLI (pas authentifié)
  ✅ .mcp.json présent

CLAUDE CODE SKILLS
  ❌ superpowers     ❌ ui-ux-pro-max
  ❌ context-mode    ℹ️  GSD (optionnel — level up)

REPO
  ❌ frontend/.env.local manquant
  ❌ frontend/node_modules manquant
  ❌ DATABASE_URL pas défini (Neon requis)
  ℹ️  Banani MCP (optionnel — Phase 5)

COMPTES (action humaine requise)
  🙋 Neon Postgres   🙋 GitHub
  ℹ️  Banani (optionnel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Phase 1 — Outils système

For each MISSING item, take the action below. **NEVER skip a missing one silently.**

| Manquant | Action AI | Action humaine |
|---|---|---|
| **Claude Code (CLI absent)** | — | « Si tu lis ceci, Claude Code tourne déjà — soit en extension VS Code (la plupart des gens), soit en CLI. La CLI est optionnelle. Si tu veux quand même la CLI dans le terminal : `npm install -g @anthropic-ai/claude-code` (Node 20+ requis). Pour l'extension VS Code : cherche « Claude Code » dans le Marketplace VS Code et clique Install. » |
| **Node < 20** | — | « Va sur https://nodejs.org/en/download → installe la version LTS (≥ 20). Relance `/setup-kit` après. » Stop. |
| **pnpm** | `corepack enable && corepack prepare pnpm@latest --activate` | Aucune (Corepack ship avec Node 20) |
| **gh CLI** | Sur macOS : `brew install gh` après confirmation. Sinon afficher https://cli.github.com/ | Puis `gh auth login` — interactif, choisir « GitHub.com » → « HTTPS » → ouvrir le navigateur |

> **Pas de Vercel CLI requise.** Le déploiement passe par GitHub push → import du repo dans Vercel (ou autre hébergeur). Aucun outil local en plus.

After each install, **re-run the matching probe** to confirm. If install fails, do not proceed — explique l'erreur en français simple et propose **une seule** alternative.

### Phase 2 — Skills Claude Code (3 skills, paste-required)

Les 3 skills utilisent des commandes `/plugin` (built-ins du harness Claude Code). **L'IA ne peut PAS taper ses propres slash commands.** Affiche-les comme bloc à copier-coller :

```
Copie-colle ces 5 commandes une par une dans Claude Code (Entrée entre chaque) :

/plugin install superpowers@claude-plugins-official
/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
/plugin install ui-ux-pro-max@ui-ux-pro-max-skill
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
```

Une fois confirmé : « Redémarre Claude Code (les skills se chargent au démarrage de la session) puis relance `/setup-kit` pour vérifier. »

> **GSD intentionnellement omis ici.** GSD est un workflow procédural (~30 slash commands, plans/phases/commits atomiques) qui sert vraiment quand le projet devient gros. Pour un premier MVP en vibe coding, c'est de la cérémonie. On le surface en Phase 7 quand le user a terminé sa première feature, pas avant.

### Phase 3 — Compte Neon (la SEULE dépendance obligatoire)

Le kit est **cloud-only** — pas de Postgres local. Une fois Neon en place, tout le reste boote.

Étapes (un compte à la fois, attends confirmation entre chaque) :

1. **Inscription Neon** — « Va sur https://neon.tech, inscription gratuite (Google / GitHub OK). 30 secondes. Confirme quand c'est fait. »
2. **Création projet** — « Dans le dashboard Neon, clique "New Project". Nomme-le comme tu veux. Sélectionne la région la plus proche. Confirme quand c'est créé. »
3. **Copier les 2 URLs** — « Dans le dashboard du projet :
   - `DATABASE_URL` = la version qui contient **`-pooler`** dans le hostname (pour l'app)
   - `DIRECT_URL` = la version **SANS** `-pooler` (pour `prisma migrate`)
   - Colle-les ici dans le chat (l'IA va les écrire dans `.env.local` pour toi). »
4. **AI écrit `.env.local`** — `cp .env.example frontend/.env.local` puis `Edit` pour insérer les deux URLs aux bonnes lignes.

### Phase 4 — Install du repo + secrets

Séquentiel (chaque étape dépend de la précédente) :

1. **Install dependencies** — `pnpm install` (« télécharge toutes les librairies, ~2 min la première fois »).
2. **Génère les secrets** — pour `JWT_SECRET` / `ENCRYPTION_KEY` / `CRON_SECRET`, lance `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` une fois par clé. Confirme avec le user puis fait l'`Edit` dans `.env.local`.
3. **Applique le schéma Prisma** — `pnpm db:migrate:deploy` (« crée toutes les tables dans ton Neon Postgres »). Vérifie que ça finit sans erreur.

Stop si une étape échoue. Lis l'erreur, explique en français simple, propose un fix.

### Phase 5 — Banani MCP (optionnel — design import)

**Demande explicitement à l'user :** *« Tu as un design Banani ? oui / non / plus tard »*

- **non / plus tard** → Skip immédiatement. Dis-lui : *« Pas de souci. Tu pourras décrire ce que tu veux à Claude en français à la prochaine étape, et il construira l'UI à partir de ta description. Ouvre Banani plus tard si tu veux un design plus polish. »* Passe à Phase 6.
- **oui** → continue ci-dessous :
  - URL : https://banani.co — **inscription gratuite, aucune clé payante.**
  - Banani expose son MCP via une **clé de connexion** (chaîne fournie dans son UI une fois loggé — onglet « Connect to MCP » ou équivalent).
  - Demande : *« Colle ici ta clé de connexion MCP Banani (ou la commande/URL que Banani te donne pour se connecter en MCP). »*
  - Une fois collée, l'IA met à jour `.mcp.json` à la racine du repo avec la config exacte fournie par l'user (commande + args, ou URL HTTP/SSE — selon ce que Banani lui donne). Ne pas inventer de format : utiliser tel quel ce que l'user colle.
  - Si l'user colle juste une URL : intégrer comme `{ "banani": { "url": "<url>" } }`. Si l'user colle une commande complète : reproduire `command` + `args`. En cas de doute, demande confirmation avant d'écrire.
  - Puis : *« Redémarre Claude Code pour que le MCP soit chargé. Au prochain chat, sélectionne tes écrans dans Banani et dis "reproduis ces écrans-là" — le skill `banani-design-implementation` prendra le relais (pixel-perfect 1:1). »*

### Phase 6 — Comptes optionnels (skip-friendly)

Pour chaque, demande : « Tu veux activer [feature] dès maintenant ? oui / non / plus tard ». Si `non` ou `plus tard`, skip sans jugement — le kit boote très bien sans (voir CLAUDE.md « Optional providers boot conditionally »).

| Feature | Provider | URL | Clés à coller |
|---|---|---|---|
| Cache / rate-limit | Upstash Redis | https://upstash.com | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` |
| Emails transactionnels | Resend | https://resend.com | `RESEND_API_KEY` + `EMAIL_FROM` |
| Upload de fichiers / média | Cloudinary | https://cloudinary.com | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Sign in with Google | Google Cloud Console | https://console.cloud.google.com | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Paiements mobile money | Bictorys | https://bictorys.com | `BICTORYS_API_KEY` + `BICTORYS_PRIVATE_KEY` (deux clés DISTINCTES — voir CLAUDE.md invariants) |
| Observabilité | Sentry | https://sentry.io | `SENTRY_DSN` |

Pour chaque clé collée, `Edit` `frontend/.env.local` après confirmation. Ne jamais coller les clés dans le chat visible (toujours via Edit).

### Phase 7 — Smoke test final

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

Puis dans un second terminal :

```bash
pnpm dev
```

Puis :

```bash
pnpm smoke:auth
```

Si tout vert : 🎉 imprime un récap félicitations + le hand-off vibe coding :

> *« Tout est prêt. Maintenant, dis-moi simplement ce que tu veux construire — en français, en langage naturel. Exemple : "je veux une page d'accueil avec un bouton créer un compte, un dashboard utilisateur, et une page de paiement." Les 40 routes API sont déjà câblées. Je m'occupe du code. »*
>
> *Si tu as connecté Banani en Phase 5 : sélectionne tes écrans et dis "reproduis ces écrans-là" — le skill `banani-design-implementation` prendra le relais.*
>
> *Pour déployer plus tard sur Vercel : dis-moi "déploie sur Vercel" quand tu es prêt. Voir [WORKFLOW.md](../../../WORKFLOW.md).*

**Level up (pas obligatoire).** Quand le projet devient gros (multi-sessions, plusieurs features, dette technique), GSD (`npx get-shit-done-cc@latest`) ajoute un workflow par phases avec commits atomiques. Surface-le seulement si l'user demande à structurer son travail — pas par défaut.

Si quelque chose rouge : stop, colle l'output qui échoue, explique en français simple, propose un fix. **Ne dis jamais « tout est prêt »** tant que les 3 commandes ne sont pas vertes.

## Failure modes — be explicit

| Symptôme | Cause probable | Réponse |
|---|---|---|
| `pnpm install` échoue avec EACCES | Permissions npm cassées | Suggère `corepack enable` ; ne **jamais** suggérer `sudo` (mauvaise pratique) |
| `pnpm db:migrate:deploy` échoue avec `P1001 connection refused` | `DATABASE_URL` faux ou Neon offline | Vérifie l'URL dans `.env.local` (commence par `postgresql://`, contient `-pooler`, finit par `?sslmode=require`) ; teste Neon dashboard |
| `pnpm db:migrate:deploy` échoue avec « prepared statement does not exist » | L'user a mis l'URL pooler dans `DIRECT_URL` au lieu de la non-pooled | Re-vérifier que `DIRECT_URL` n'a PAS `-pooler` dans le hostname |
| `pnpm dev` démarre mais `/api/auth/signup` renvoie 500 | `JWT_SECRET` / `ENCRYPTION_KEY` manquants ou trop courts (< 32 chars) | Re-run Phase 4 step 2 (génération de secrets) |
| User dit « les commandes `/plugin` ne marchent pas » | Pas dans Claude Code ou marketplace pas accessible | Vérifier qu'il est dans le chat Claude Code (pas dans le terminal shell) |
| User dit « après `/plugin install` rien ne change » | Skill chargé au prochain démarrage de session | Demande à l'user de redémarrer Claude Code |
| User demande « pourquoi pas de Docker ? » | Habitude des autres starters | Réponds : « Ce kit est cloud-only par design — Neon free tier remplace Postgres local en 30 sec, et tu skip 2 Go de Docker Desktop. » |

## Anti-patterns — ne fais JAMAIS

- ❌ Lancer `sudo` quoi que ce soit
- ❌ Modifier `~/.zshrc` / `~/.bashrc` sans demander
- ❌ Suggérer Docker à un user qui demande pourquoi pas de DB locale (le kit est cloud-only par décision)
- ❌ Installer Node via Homebrew si l'user est sur Windows / Linux (utiliser nodejs.org)
- ❌ Cacher les erreurs avec `|| true` ou `2>/dev/null` (sauf pour les probes Phase 0)
- ❌ Réécrire `.env.local` complet — toujours `Edit` ligne par ligne après avoir lu le fichier
- ❌ Continuer la phase suivante si la précédente est rouge
- ❌ Coller des API keys dans la réponse visible (toujours via Edit dans `.env.local`)

## Notes pour les forks

Ce skill est bundlé dans le starter mais peut diverger par fork :
- Si ton fork retire Bictorys / Banani / etc. via [PRUNING.md](../../../PRUNING.md), mets à jour la Phase 6 pour ne plus proposer ces options.
- Si ton fork ajoute un provider (Stripe, Paystack, etc.), ajoute-le en Phase 6.
- Le manifeste machine-lisible vit dans [.planning/features.json](../../../.planning/features.json) — un futur enhancement de cette skill pourrait dériver Phase 6 automatiquement de ce JSON.
