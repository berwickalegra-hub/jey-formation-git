# Audit débutant — 2026-05-15

Je me mets dans la peau d'une personne qui :
- vient de découvrir le repo sur GitHub,
- a installé Claude Code (extension VS Code),
- clone, ouvre dans VS Code,
- lit le README,
- tape `/setup-kit`,
- veut shipper en parlant à Claude.

J'audite **uniquement** ce qui casse ou friction cette personne. Pas de revue de code.

---

## 🔴 BLOCKERS — le happy path casse

### B1. `cp .env.example .env.local` met le fichier au mauvais endroit

[README.md:30](README.md#L30) dit :

```bash
cp .env.example .env.local         # remplis DATABASE_URL, JWT_SECRET, ...
```

Mais Next.js + Prisma lisent **`frontend/.env.local`** (pas la racine). Et `pnpm dev` proxie vers `pnpm --filter frontend run dev` → `next dev` qui tourne depuis `frontend/`.

**Résultat pour le débutant** : il copie au root, lance `pnpm db:migrate:deploy`, reçoit `P1001 connection refused` car `DATABASE_URL` n'est pas chargé. Il ne comprend pas pourquoi.

La skill `setup-kit` Phase 3 step 4 fait le bon chose (`cp .env.example frontend/.env.local`) — mais le README Quickstart contredit, et le débutant qui lit le README **avant** de taper `/setup-kit` met le fichier au mauvais endroit.

**Fix** : remplacer dans [README.md:30](README.md#L30) `cp .env.example .env.local` → `cp .env.example frontend/.env.local`.

### B2. `pnpm db:make-superadmin` lit `.env`, pas `.env.local`

[frontend/package.json:19-21](frontend/package.json#L19-L21) :

```json
"db:make-superadmin": "tsx --env-file=.env scripts/make-superadmin.ts",
"seed:dev": "tsx --env-file=.env scripts/seed-dev.ts",
"smoke:auth": "tsx --env-file=.env.local scripts/smoke-auth.ts",
```

Trois scripts, **deux conventions différentes**.

- `setup-kit` écrit `frontend/.env.local`.
- `pnpm smoke:auth` lit `.env.local` → OK.
- `pnpm db:make-superadmin` lit `.env` → **n'existe pas** → script tourne sans `DATABASE_URL` → crash.

Le README Quickstart ([README.md:35](README.md#L35)) demande pourtant à l'utilisateur d'exécuter `pnpm db:make-superadmin you@example.com` immédiatement après le premier signup. **Ça ne marche pas tel quel.**

**Fix** : aligner les trois scripts sur `--env-file=.env.local`, ou ajouter `--env-file=.env --env-file=.env.local` (tsx supporte multi-files depuis Node 20.12).

---

## 🟡 FRICTION — le débutant comprend mais se sent floué

### F1. Le pitch « une seule commande » est mensonger

[README.md:9-15](README.md#L9-L15) :

> **Une seule commande pour démarrer.** Ouvre ce projet dans Claude Code et tape `/setup-kit`.

Mais Phase 2 de la skill exige de **coller manuellement 5 slash commands `/plugin install`**, puis de **redémarrer Claude Code**, puis de **relancer `/setup-kit`**. Ce n'est pas une commande, c'est ~10 actions humaines.

**Fix** : reformuler en « Un seul point d'entrée » ou « Un seul flow guidé », pas « une seule commande ». Ou réduire Phase 2 à un minimum vraiment automatique.

### F2. Phase 2 demande d'installer `ui-ux-pro-max` qui est **déjà** dans le repo

[.claude/skills/setup-kit/SKILL.md:108-115](.claude/skills/setup-kit/SKILL.md#L108-L115) liste 5 commandes :

```
/plugin install superpowers@claude-plugins-official
/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
/plugin install ui-ux-pro-max@ui-ux-pro-max-skill
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
```

Or `.claude/skills/ui-ux-pro-max/SKILL.md` est **tracké dans le repo** ([git ls-files](git) confirme : 200+ fichiers de data CSV inclus). Donc Claude Code le charge automatiquement à l'ouverture. Les lignes 2-3 sont redondantes — au mieux Claude Code dit « plugin already installed », au pire le marketplace n'existe plus / 404 / conflit.

**Fix** : retirer les 2 lignes `ui-ux-pro-max` de Phase 2. Garder superpowers (non bundled) + context-mode (non bundled). 5 → 3 commandes.

### F3. WORKFLOW.md prétend que `/setup-kit` lance `pnpm dev`

[WORKFLOW.md:13](WORKFLOW.md#L13) :

> ...génère les secrets et lance `pnpm install` + `pnpm dev`.

Mais Phase 7 de la skill ([.claude/skills/setup-kit/SKILL.md:181-183](.claude/skills/setup-kit/SKILL.md#L181-L183)) dit explicitement :

> Puis dans un second terminal : `pnpm dev`

C'est-à-dire : la skill **NE lance PAS** `pnpm dev` automatiquement. Elle demande à l'utilisateur d'ouvrir un autre terminal. WORKFLOW.md ment légèrement.

**Fix** : aligner WORKFLOW.md Étape 1 sur ce que la skill fait vraiment (« lance `pnpm install` + applique les migrations, puis te demande d'ouvrir un second terminal pour `pnpm dev` »).

### F4. GSD mentionné dans 3 endroits différents comme « level up »

`git grep -l 'get-shit-done\|gsd-'` (hors archive + data) retourne :
- [.claude/skills/setup-kit/SKILL.md](. claude/skills/setup-kit/SKILL.md) (Phase 7, ligne 199)
- [CLAUDE.md](CLAUDE.md) (mention « GSD is not a prerequisite »)
- [WORKFLOW.md](WORKFLOW.md) (Section « Pour aller plus loin »)

Pas faux, mais le débutant qui lit les 3 docs en parallèle reçoit le même message 3 fois et se demande si c'est un piège. Une seule mention canonique (probablement dans WORKFLOW.md « level up ») suffirait.

**Fix** : retirer les mentions de CLAUDE.md (qui s'adresse aux LLMs, pas aux débutants) et de la skill Phase 7 (qui doit dire « tu as fini » sans bruit). Garder uniquement WORKFLOW.md ligne 62.

---

## 🟢 COSMÉTIQUE — pas un blocker, mais ça sent mauvais

### C1. Dossier `izisaas mobile money skills/` au root avec un espace dans le nom

`git ls-files "izisaas mobile money skills/"` retourne 16 fichiers de référence (Bictorys, Moneroo, Paytech, Stripe) + un `SKILL.md`. Mais ce n'est **pas** une Claude Code skill — elle n'est pas dans `.claude/skills/`, donc jamais chargée. C'est de la doc référence mal placée, avec un nom qui contient des espaces (galère shell).

Trois options :
1. **Déplacer** sous `.claude/skills/payments-providers/` si c'est censé être une skill (et renommer).
2. **Déplacer** sous `docs/payments-providers/` si c'est juste de la doc.
3. **Supprimer** si c'est mort (les `bictorys.ts`, `stripe.ts`, `moneroo.ts`, `paytech.ts` sont des examples — pas du code de prod).

Le débutant qui voit ce dossier au root du clone va se demander s'il doit lire ça. Probablement non.

### C2. `frontend/.env` local cruft

Le fichier `frontend/.env` (non-tracké, donc pas un problème pour les fresh clones) existe dans ton arbre actuel et pointe vers `postgresql://amadoufall@localhost:5432/amadou_monolith_dev` — un Postgres local qui n'existe plus depuis que le kit est cloud-only. Si tu relances `/setup-kit` chez toi, Phase 0 va voir `frontend/.env` EXISTS_ENV, dire « DATABASE_URL set », mais l'URL est vers un serveur mort → confusion.

**Fix local** (pas pour les forks) : `rm frontend/.env`, ou re-générer avec un vrai Neon. Et ajouter à la skill Phase 0 un check « DATABASE_URL pointe-t-il vers `localhost` ? Si oui, ⚠️ probablement stale, demande à l'user ».

### C3. Mentions Docker restantes (info, pas problème)

`grep -i docker` dans tracked files :
- [STATUS.md:144-146](STATUS.md#L144-L146) — `« Docker / docker-compose — the kit is cloud-only by design »` ✓ correctement marqué hors-scope.
- [WORKFLOW.md:13](WORKFLOW.md#L13) — `« le kit est cloud-only, pas de Docker »` ✓ idem.
- [frontend/next.config.ts](frontend/next.config.ts) — probablement un commentaire `// for Docker`, vérifier.
- [frontend/src/lib/server/observability/readme-shape.test.ts](frontend/src/lib/server/observability/readme-shape.test.ts) — un tripwire qui interdit les mentions Docker. ✓ par design.
- [.claude/skills/ui-ux-pro-max/data/stacks/nextjs.csv](. claude/skills/ui-ux-pro-max/data/stacks/nextjs.csv) — data de la skill UI, pas concerné.

OK comme c'est. Rien à faire.

### C4. CLAUDE.md `gh repo create … --template=faratasn-pixel/izikit` peut casser

[README.md:28](README.md#L28) :

```bash
gh repo create my-project --template=faratasn-pixel/izikit --private --clone
```

Si le repo `faratasn-pixel/izikit` n'a **pas** le toggle "Template repository" activé sur GitHub, cette commande renvoie `template repo not found`. Vérifie sur https://github.com/faratasn-pixel/izikit → Settings → "Template repository" doit être coché.

**Fix** : soit cocher le toggle, soit changer la commande pour `gh repo clone faratasn-pixel/izikit my-project`.

---

## 📊 Résumé

| # | Sévérité | Item | Effort fix |
|---|---|---|---|
| B1 | 🔴 | README `cp .env.example .env.local` vs Next.js attend `frontend/.env.local` | 1 ligne |
| B2 | 🔴 | tsx scripts lisent `.env`, setup-kit écrit `.env.local` | 2 lignes dans `frontend/package.json` |
| F1 | 🟡 | Pitch « une seule commande » menteur (5 plugins à coller) | reformulation |
| F2 | 🟡 | Phase 2 réinstalle `ui-ux-pro-max` déjà bundled | retirer 2 lignes dans SKILL.md |
| F3 | 🟡 | WORKFLOW.md « lance pnpm dev » mais skill ne le fait pas | 1 ligne reformulée |
| F4 | 🟡 | GSD « level up » mentionné 3× | retirer 2 sur 3 |
| C1 | 🟢 | `izisaas mobile money skills/` au root, espaces, pas une skill | déplacer ou supprimer |
| C2 | 🟢 | `frontend/.env` local stale (localhost) | local-only |
| C4 | 🟢 | `--template=` peut casser si toggle absent sur GitHub | toggle GitHub |

**Ordre de priorité** : B1 → B2 → F2 → F1/F3/F4 → C1/C4 → C2.

B1 et B2 cassent le premier `pnpm db:migrate:deploy` ou `pnpm db:make-superadmin` — c'est-à-dire la promesse « clone, plug Neon, ship » du README.
