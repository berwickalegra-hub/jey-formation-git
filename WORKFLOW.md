# Workflow — du PRD au SaaS livré en 4 étapes

> **🤖 Si tu es une IA qui lit ce fichier sur demande d'un débutant** : lis ce document **en entier** + lis ensuite [CLAUDE.md](CLAUDE.md) pour comprendre l'architecture, puis demande au débutant **où il en est dans les 5 étapes ci-dessous** (a-t-il déjà un PRD ? a-t-il designé sur Banani ? etc.) et guide-le étape par étape. Ne saute aucune étape — chaque étape valide la précédente.

> **👤 Si tu es un débutant** : ouvre ce projet dans Claude Code et tape **exactement** :
>
> ```
> Lis WORKFLOW.md et dis-moi ce que je dois faire pour démarrer mon projet.
> ```
>
> L'IA fera le reste.

Ce document décrit le **parcours canonique d'un débutant** qui utilise `izi kit` comme starter. Le but : passer d'une idée écrite à un produit fonctionnel sans toucher au plumbing (auth, paiements, admin, webhooks, cron).

## Prerequisites

Avant de commencer, installe :

1. **Claude Code** ([claude.com/claude-code](https://claude.com/claude-code))
2. **Get Shit Done (GSD)** — le framework de planification phase-par-phase qui orchestre les commandes `/gsd-*` utilisées dans ce workflow. Sans GSD installé, les commandes `/import-banani`, `/gsd-execute-phase`, etc. ne sont pas disponibles. Installe-le selon tes instructions habituelles avant d'ouvrir le starter dans Claude Code.
3. **pnpm 9+** + **Node 20+**
4. **Compte Neon** ([neon.tech](https://neon.tech), gratuit, 30 sec) pour ton `DATABASE_URL` + `DIRECT_URL` — c'est la **seule manière** de tourner ce kit. Pas de Docker, pas de Postgres local : tout passe par Neon.
5. **Compte Banani** + ton `BANANI_API_KEY` (étapes 2-3)

```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. PRD   │ ─▶ │ 2. Banani│ ─▶ │ 3. /import-  │ ─▶ │ 4. /gsd-     │
│ (texte)  │    │ (design) │    │    banani    │    │    execute-  │
│          │    │          │    │              │    │    phase N   │
└──────────┘    └──────────┘    └──────────────┘    └──────────────┘
   tu écris     tu sélectionnes   skill starter      commande GSD
                tes écrans        (lit MCP Banani,   (orchestre les
                                  réconcilie         sous-agents qui
                                  backend ↔ design)  shippent le code)
```

---

## Étape 1 — Rédiger le PRD

Sortie : un document Markdown qui décrit ton produit (qui, quoi, pourquoi, fonctionnalités principales, tunnel d'usage). Outil libre — un GPT, Claude, Notion, ou ton outil de création de PRD existant.

**Sortie attendue** : `.planning/PRD.md` (ou un chemin de ton choix). Pas de format imposé — un humain doit pouvoir le lire en 5 min. Tu poses ce fichier dans le repo, c'est tout.

---

## Étape 2 — Designer sur Banani

Donne ton PRD à Banani avec un prompt design. Banani va générer toutes les pages importantes : login, signup, dashboard, et toutes les features spécifiques au produit.

**Sortie attendue** : un projet Banani contenant tous les écrans clés. Sélectionne dans l'éditeur Banani les écrans que tu veux importer (la MCP lit ta sélection courante — il n'y a pas de `project_id` à passer).

---

## Étape 3 — Réconcilier design ↔ starter

Ouvre le starter dans Claude Code, puis :

```bash
# Pré-requis : .mcp.json déclare le serveur Banani (déjà templated dans le starter)
# Ajoute ta BANANI_API_KEY dans .env.local
```

Sélectionne tes écrans dans l'éditeur Banani, puis lance :

```
/import-banani
```

L'IA va :
1. Récupérer les écrans **actuellement sélectionnés** dans Banani via la MCP `mcp__banani__banani_get_selected_designs` (zero-arg). Si tu veux des écrans précis, passe `screenIds`.
2. Extraire les CTAs / formulaires / data-fetches par écran
3. Matcher contre les 40 routes API existantes du starter
4. Produire `.planning/DESIGN-COVERAGE.md` qui liste :
   - **Routes existantes à réutiliser** (auth, paiements, admin si applicables)
   - **Routes nouvelles à créer** (par exemple `POST /api/posts` pour un blog)
   - **Surfaces livrées mais inutilisées** (ex: pas de paiements pour un blog → désactiver `BICTORYS_*` dans `.env`)
5. Générer automatiquement `.planning/ROADMAP.md` avec 1-N phases prêtes à exécuter

Tu relis `DESIGN-COVERAGE.md` (5 min) et tu valides.

---

## Étape 4 — Implémenter

```
/gsd-execute-phase 1
```

L'IA :
- Reproduit pixel-perfect chaque écran Banani via le skill `banani-design-implementation`
- Câble chaque page aux routes API du starter (`requireAuth` + `verifyCsrf` + `withRequestContext` boilerplate déjà fourni)
- Crée les nouvelles routes/modèles Prisma identifiés à l'étape 3
- Lance la suite Vitest (559+ tests) après chaque commit
- Te dit `/gsd-execute-phase 2` quand la phase 1 est verte

Quand toutes les phases sont vertes : `pnpm dev` + `pnpm smoke:auth` (étape 5 ci-dessous pour le déploiement).

---

## Étape 5 — Déployer sur Vercel

Quand toutes tes phases sont vertes en local, dis à l'IA :

> *"Déploie mon app sur Vercel. Configure le projet, copie mes env vars depuis `.env.local`, et donne-moi l'URL de production."*

L'IA va exécuter (en te demandant confirmation aux étapes risquées) :

1. **Push GitHub** : `git push origin main` — ton repo doit déjà être sur GitHub (sinon `gh repo create`)
2. **Lien Vercel** : `vercel link` (interactif au premier run — si pas de Vercel CLI : `npm i -g vercel` et `vercel login`)
3. **Copier env vars** : pour chaque ligne non-vide de ton `.env.local`, l'IA lance `vercel env add <NAME> production` (l'IA ne déplace JAMAIS de secrets vers le terminal — elle te demande de coller chaque valeur quand le prompt Vercel s'ouvre)
4. **Postgres pooler** : vérifie que `DATABASE_URL` pointe sur le `-pooler` Neon URL (et `DIRECT_URL` sur la non-pooled — requis pour `prisma migrate deploy`)
5. **Crons** : `vercel.json` est lu automatiquement au déploiement → tes 5 crons sont enregistrés sans config supplémentaire
6. **Déployer** : `vercel --prod` → URL `https://<ton-projet>.vercel.app`
7. **Smoke prod** : `SMOKE_BASE_URL=https://<ton-projet>.vercel.app pnpm smoke:auth` valide signup → verify → me → logout en prod

Si l'IA n'a pas le Vercel CLI installé, elle te dit la commande exacte à lancer.

**Variables qui doivent absolument être dans Vercel** : `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL` (pointer sur ton URL Vercel), `COOKIE_PREFIX`, `NEXT_PUBLIC_COOKIE_PREFIX`, plus tous les providers que tu as activés (Resend, R2, Bictorys, Google OAuth, Sentry, Upstash).

---

## Surfaces optionnelles du starter

Ce que le starter livre, et comment le désactiver feature-par-feature (sans toucher au code) :

| Surface | Désactiver = | Vérification |
|---|---|---|
| Paiements (Bictorys) | Ne pas remplir `BICTORYS_*` dans `.env.local` | `/api/orders` 404 |
| OAuth Google | Ne pas remplir `GOOGLE_*` | `/api/auth/oauth/google/*` 404 |
| Uploads R2 | Ne pas remplir `R2_*` | `/api/upload` 503 STORAGE_NOT_CONFIGURED |
| Email Resend | Ne pas remplir `RESEND_API_KEY` | `EmailJob` rows pile up, drain skip |
| Sentry | Ne pas remplir `SENTRY_DSN` | SDK no-op silencieux |
| Multi-tenancy | Ne pas appeler `requireOrgRole(...)` | Modèles `Organization*` zero-cost |
| Admin back-office | Ne pas créer de SUPERADMIN | Routes refusent toutes les requêtes |

Le manifeste machine-lisible vit dans [.planning/features.json](.planning/features.json) — utilisé par le futur `gsd-prune-feature` pour supprimer atomiquement le code mort si tu veux un repo plus mince.

---

## Limitations connues

- `/import-banani` est **un skill du starter** ([.claude/skills/import-banani/SKILL.md](.claude/skills/import-banani/SKILL.md)) — pas une commande GSD-native. Sa logique est un fichier markdown d'instructions que Claude Code charge et suit ; la qualité d'extraction CTA/form/data-fetch dépend du modèle qui l'exécute et s'affinera au fur et à mesure des forks réels.
- Banani MCP requiert une `BANANI_API_KEY` non shippée + un `.mcp.json` correctement câblé sur le bon launcher Banani (le `command`/`args` template est à remplacer — voir [.mcp.json](.mcp.json)).
- Si tu n'utilises pas Banani, saute les étapes 2-3 et lance `/gsd-discuss-phase 1` directement avec ton PRD.
