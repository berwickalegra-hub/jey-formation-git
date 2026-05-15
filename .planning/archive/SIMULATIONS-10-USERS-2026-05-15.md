# 10 simulations de débutants — 2026-05-15

État du kit au moment de la simulation : commit `33ffb6d` (post fix beginner-audit + clarification redémarrage VS Code/Antigravity).

Chaque persona est tracé du clone au premier `pnpm dev` vert. Je note ce qui marche, ce qui frictionne, et ce qui casse.

---

## 1. Aïssatou, 22 ans — étudiante informatique, Dakar

**Profil** : Mac M2, parle français, a fait un peu de PHP en cours mais jamais Next.js. Veut shipper une appli de prise de rendez-vous pour le cabinet médical de sa mère.

**Setup** : Claude Code extension VS Code, GitHub déjà installé, pas de pnpm, Node v18 (cours).

**Walk-through** :
1. Ouvre VS Code, clone via `gh repo clone`, tape `/setup-kit`.
2. Phase 0 audit : ❌ Node 18 (trop vieux), ❌ pnpm, ❌ gh auth (jamais fait `gh auth login`).
3. La skill lui dit *« Va sur https://nodejs.org/en/download → installe la version LTS »*. Elle clique, installe Node 22. Relance `/setup-kit`.
4. Phase 1 : Corepack active pnpm. ✓
5. Phase 2 : colle les 3 commandes `/plugin install`. Recharge la fenêtre VS Code (instruction explicite). ✓
6. Phase 3 : crée son compte Neon en 1 min (s'inscrit avec Google). Colle DATABASE_URL + DIRECT_URL.
7. Phase 4 : install + migrate OK. ✓
8. Phase 5 : « Banani ? » → *« plus tard »*.
9. Phase 7 : `pnpm dev` boote. http://localhost:3000 affiche `<body></body>` (page vide).

**Premier prompt** : *« je veux une page d'accueil avec un bouton "Prendre rendez-vous" »*. Claude lit `examples/frontend-pages/login.tsx` pour le style, crée la page, ça marche.

**Verdict** : ✅ ship. Temps : ~12 min, dont 8 min à attendre les téléchargements Node + pnpm + dependencies.

---

## 2. Marc, 35 ans — dev backend Python (Django), Lyon

**Profil** : Linux Ubuntu, 10 ans de Python, jamais React/Next.js. Évalue le kit pour migrer un side-project de Django vers Next.js.

**Setup** : Node 20 via `apt`, pnpm jamais installé, gh CLI installé + authentifié. Claude Code CLI (terminal natif).

**Walk-through** :
1. `git clone`, `cd izikit`, `claude` (CLI).
2. Tape `/setup-kit`. Phase 0 : ✓ Node, ❌ pnpm.
3. Corepack active pnpm. ✓
4. Phase 2 : 3 plugins. Quitte avec Ctrl+C, relance `claude`. Re-tape `/setup-kit`. ✓
5. Phase 3 : Neon, déjà un compte (utilise Vercel Postgres en perso). Crée un projet, colle les URLs. Réflexe Django : *« pas de migrations à écrire ? »* — la skill dit *« migrate:deploy applique les migrations existantes »*. OK.
6. Phase 4 : install OK. Migrate fait passer 5 migrations.
7. `pnpm dev` boote.

**Premier prompt** : *« montre-moi le route handler de l'auth — je veux comparer avec Django ORM »*. Claude lit `frontend/src/app/api/auth/signup/route.ts` et lui explique.

**Verdict** : ✅ ship pour évaluation. Friction zéro pour un dev expérimenté. Sa remarque : *« pourquoi y a-t-il un `frontend/` dossier alors qu'il n'y a qu'un seul package ? »* — la réponse est dans CLAUDE.md ligne 31 (« seam architecturale »).

---

## 3. Sofia, 28 ans — designer freelance, Casablanca

**Profil** : Mac M1, HTML/CSS de base + Webflow. A un design Banani de 8 écrans pour un site de gestion de réservations. Anglais OK, préfère français.

**Setup** : Pas de Claude Code installé, pas de Node, pas de gh CLI, pas de Git CLI. Juste VS Code.

**Walk-through** :
1. Installe l'extension Claude Code depuis le Marketplace VS Code.
2. Ouvre Claude Code, demande : *« comment je clone ce projet ? https://github.com/.../izikit »*.
3. Claude lui montre `gh repo clone …`. Elle dit *« je n'ai pas gh »*. Claude propose `git clone` ; elle dit *« pas Git non plus »*.
4. Claude la guide : `brew install git gh` (Mac), ou GitHub Desktop si elle préfère cliquer.
5. Après installation + clone, tape `/setup-kit`. Phase 0 : ❌ tout.
6. Phase 1 : Node à installer manuellement (nodejs.org). 5 min de téléchargement.
7. Phase 2 : 3 plugins. *« Reload Window »* OK.
8. Phase 3 : Neon — première confrontation avec un *connection string*. La skill explique `-pooler` vs sans. ✓
9. Phase 4 : install. Migrate OK.
10. Phase 5 : Banani ? → **oui**. La skill lui demande la clé de connexion MCP. Elle ouvre Banani, va dans Connect to MCP, colle le bloc. Claude écrit `.mcp.json`. Reload Window. ✓
11. Phase 7 : `pnpm dev` boote.

**Premier prompt** : sélectionne les 8 écrans dans Banani, dit *« reproduis ces écrans-là »*. Le skill `banani-design-implementation` prend le relais.

**Verdict** : ✅ ship, mais sans le hand-holding initial pour Git + Node, elle aurait abandonné. **Friction réelle : la skill suppose Git installé.** Phase 0 ne le vérifie pas.

---

## 4. John, 19 ans — étudiant Iowa State, USA

**Profil** : Windows 11, anglais uniquement, jamais utilisé pnpm, sait clone-and-`npm install` mais c'est tout. Veut un SaaS de notes partagées entre étudiants.

**Setup** : Claude Code extension VS Code, Node 20 (via nodejs.org), gh CLI installé.

**Walk-through** :
1. Clone, ouvre VS Code, tape `/setup-kit`.
2. **Premier mur** : la skill répond en français. Il dit *« in english please »*. La skill switch à l'anglais (instruction Phase 1 ligne 30).
3. Phase 0 : ✓ Node, ❌ pnpm. Le terminal Windows (PowerShell) demande à confirmer Corepack — OK.
4. Phase 2 : 3 plugins. *« Reload Window »* avec `Ctrl+Shift+P` (Win). ✓
5. Phase 3 : Neon. Crée compte avec GitHub OAuth. Copie/colle URLs.
6. **Friction** : sur Windows, `pnpm` parfois exige PowerShell exec policy. La skill ne mentionne pas ça. Si John a une policy stricte, il reçoit `cannot be loaded because running scripts is disabled`. La skill devrait avoir un mode failure pour ça.
7. Heureusement la policy de John est par défaut. ✓
8. Phase 7 : `pnpm dev` boote.

**Premier prompt** : *« landing page with hero, signup form, pricing table »*. Claude utilise `examples/frontend-pages/signup.tsx` comme référence Tailwind.

**Verdict** : ✅ ship, mais Windows-specific friction non couverte (PowerShell exec policy). Mineur mais documenter dans Failure modes.

---

## 5. Karim, 40 ans — serial founder, Abidjan

**Profil** : Mac, 15 ans XP web (PHP → Rails → React). Utilise Cursor (pas VS Code) depuis 1 an. Veut un MVP de cagnotte pour associations en 48h.

**Setup** : tout installé déjà (Node 22, pnpm 9, gh CLI), compte Neon existant.

**Walk-through** :
1. Cursor + Claude Code extension. Clone, ouvre dans Cursor, ouvre la chat Claude, tape `/setup-kit`.
2. **Friction immédiate** : la skill mentionne explicitement « VS Code / Antigravity » mais pas Cursor. Karim hésite. *« Les instructions Reload Window marchent-elles ? »* — oui (Cursor est un fork VS Code) mais ce n'est pas documenté.
3. Phase 0 : tout vert sauf `frontend/.env.local` MISSING. ✓
4. Phase 2 : 3 plugins → OK.
5. Phase 3 : déjà un projet Neon, copie/colle.
6. Phase 4-7 : tout passe en 4 min.

**Premier prompt** : *« copie tout le modèle de cagnottes.sn que tu connais — j'ai une copie de leur CLAUDE.md »*. Claude code à fond, génère 8 routes nouvelles.

**Verdict** : ✅ ship. **Friction documentation** : Cursor / Antigravity / Windsurf sont tous des forks VS Code — le setup-kit devrait dire *« VS Code ou ses forks (Cursor, Windsurf, Antigravity) »* au lieu de juste *« VS Code / Antigravity »*.

---

## 6. Léa, 26 ans — dev frontend (Vue.js), Berlin

**Profil** : Mac, 4 ans Vue, jamais React. Anglais OK. Veut migrer un side-project Vue/Express vers Next.js pour apprendre.

**Setup** : Node 22, pnpm via Corepack, gh CLI authentifié. Claude Code extension.

**Walk-through** :
1. Clone, `/setup-kit`. Phase 0 : tout vert sauf env.
2. Phase 2 : 3 plugins. ✓
3. Phase 3 : Neon, 1 min. ✓
4. Phase 4 : migrate. ✓
5. `pnpm dev` boote.

**Premier prompt** : *« j'aimerais comprendre comment l'auth marche dans Next.js — viens de Vue + Pinia, c'est nouveau pour moi »*. Claude lui montre `frontend/src/contexts/AuthContext.tsx` n'existe pas (les contexts sont dans `frontend/src/lib/contexts/` — wait, je dois vérifier).

Vérification rapide :

```bash
find frontend/src -name "AuthContext*" -o -name "auth-context*"
```

→ trouvé : `frontend/src/lib/contexts/auth-context.tsx`. Claude lit, explique pourquoi React Context > Pinia côté SSR.

**Verdict** : ✅ ship. Apprentissage Vue→React rapide grâce au kit qui est *« headless = same API contract »*.

---

## 7. Boubacar, 31 ans — dev mobile Flutter, Bamako

**Profil** : Windows 11 + WSL2 Ubuntu, 3 ans Flutter, premier projet web. Veut une API REST pour son app de marché en ligne.

**Setup** : WSL2 Ubuntu 24.04, Node 22 via nvm, pnpm via Corepack, gh CLI authentifié. Claude Code CLI dans WSL.

**Walk-through** :
1. Clone dans `~/projects/izikit`, `cd`, lance `claude`, tape `/setup-kit`.
2. Phase 0 : tout vert. ✓
3. Phase 2 : 3 plugins. Quitte/relance CLI (instruction explicite). ✓
4. Phase 3-4 : Neon, migrate. ✓
5. Phase 5 : *« non »*.
6. Phase 7 : `pnpm dev` boote. **Friction WSL** : `http://localhost:3000` depuis Windows host marche grâce au port forwarding WSL2 auto. ✓ (par hasard — pas documenté).

**Premier prompt** : *« je veux que mon app Flutter consomme `/api/auth/login` — donne-moi l'exemple Dart »*. Claude écrit le Dio HTTP client avec cookies, et explique le cycle access/refresh.

**Verdict** : ✅ ship. **Friction non-bloquante** : WSL2 fonctionne par luck. Aucune mention WSL dans la skill.

---

## 8. Antoine, 45 ans — CTO PME, Paris

**Profil** : Mac, 20 ans XP. Évalue le kit pour standardiser le bootstrap des side-projects de sa team de 6 devs.

**Setup** : tout installé, audit critique.

**Walk-through** :
1. Clone, lit README + WORKFLOW + CLAUDE.md AVANT de toucher.
2. **Remarque immédiate** : *« 555 unit tests, Sentry, advisory locks, outbox pattern — c'est sérieux. »*
3. Tape `/setup-kit` pour valider le flow.
4. Phase 0-7 : tout fluide.
5. Pose des questions :
   - *« CSRF double-submit cookie — pourquoi pas SameSite=Strict + origin check ? »* → Claude répond en lisant `frontend/src/lib/server/auth.ts`.
   - *« Le circuit breaker est in-memory, single-instance. Production-ready ? »* → Claude pointe la note dans CLAUDE.md.
   - *« Vous avez Sentry mais pas de tracing distribué ? »* → `@vercel/otel` est wired (CLAUDE.md ligne 47).

**Verdict** : ✅ Adopté. Pas de blocker. Antoine note 2 limitations à documenter mieux dans le README : (1) le circuit breaker single-instance, (2) le fait que le kit ne ship aucun composant UI. Les deux SONT déjà dans le README — il les a juste lus trop vite.

---

## 9. Ngozi, 24 ans — autodidacte, Lagos

**Profil** : Windows 10 ancien (PC école), anglais uniquement, jamais utilisé un terminal sérieusement. Suit un cours « code your first SaaS » sur YouTube. Veut un site portfolio + petit shop.

**Setup** : VS Code installé. Pas de Claude Code, pas de Git, pas de Node, **pas de pnpm**, **pas de gh CLI**.

**Walk-through** :
1. Installe Claude Code extension depuis le Marketplace VS Code.
2. Demande à Claude : *« I just installed Claude. The repo is at github.com/.../izikit. What do I do? »*
3. Claude la guide. Mais elle confond « clone » et « download ZIP ». Télécharge le ZIP, le dézippe, l'ouvre. **Pas de `.git` → `gh auth status` impossible, `git status` impossible.**
4. Tape `/setup-kit`. Phase 0 : tout ❌ sauf node_modules MISSING.
5. La skill ne réalise pas que ce n'est pas un git repo — Phase 0 ne check pas `git status`. La skill propose d'installer Node/pnpm. Elle installe.
6. Phase 2 : *« paste these slash commands »*. Elle paste. ✓
7. Phase 3 : Neon. Crée le compte. Colle DATABASE_URL.
8. Phase 4 : `pnpm install` boote, télécharge tout en 5 min. `pnpm db:migrate:deploy` passe.
9. Phase 7 : `pnpm dev` boote ! http://localhost:3000 renvoie `<body></body>`.

**Premier prompt** : *« make me a landing page with a buy button »*. Claude lui code une landing.

**Plus tard** : Ngozi veut **push sur GitHub**. Là, ça casse — pas de repo Git, pas de gh CLI authentifié. *« Why can't I push? »*

**Verdict** : ✅ ship localement, ❌ deploy bloquée. **Friction critique non-couverte** : le setup-kit suppose `git clone` et `gh auth`. Si l'utilisateur télécharge le ZIP (cas réel pour les vrais débutants), Phase 0 devrait détecter et expliquer.

---

## 10. Yasmine, 30 ans — dev fullstack en reconversion, Tunis

**Profil** : Mac, 8 mois de bootcamp Express/Mongo. Veut tester le kit mais avec **Supabase** au lieu de Neon (elle préfère leur dashboard).

**Setup** : Node 22, pnpm 9, gh CLI ✓. Claude Code extension.

**Walk-through** :
1. Clone, `/setup-kit`. Phase 0 vert.
2. Phase 3 : skill dit *« va sur https://neon.tech »*. Yasmine résiste : *« je préfère Supabase, c'est le même Postgres »*.
3. La skill **ne sait pas** répondre à ça — elle insiste sur Neon. Yasmine improvise : prend la connection string Supabase (Direct connection + Pooler), les colle aux bonnes lignes.
4. Phase 4 : migrate. ✓ (Postgres = Postgres, peu importe l'hébergeur).
5. Phase 7 : `pnpm dev` boote.

**Premier prompt** : *« connecte Supabase Storage au lieu de Cloudinary »*. Claude répond *« tu peux, voici l'adapter »* en lisant l'interface `StorageClient` dans `frontend/src/lib/server/storage.ts`.

**Verdict** : ✅ ship. **Friction documentation** : la skill devrait dire *« Neon recommandé, mais n'importe quel Postgres marche — Supabase, Railway, Render, RDS »*. C'est déjà vrai techniquement (Prisma + Postgres standard), juste mal annoncé.

---

## 📊 Synthèse — friction matrix

| # | User | Verdict | Friction principale | Sévérité |
|---|---|---|---|---|
| 1 | Aïssatou (étudiante FR) | ✅ ship | Aucune | — |
| 2 | Marc (dev Python) | ✅ ship | Aucune | — |
| 3 | Sofia (designer) | ✅ ship | **Phase 0 ne vérifie pas Git installé** | 🟡 |
| 4 | John (étudiant US) | ✅ ship | **Windows PowerShell exec policy** non documenté | 🟢 |
| 5 | Karim (founder Cursor) | ✅ ship | **Cursor/Windsurf forks de VS Code** non mentionnés | 🟢 |
| 6 | Léa (Vue→React) | ✅ ship | Aucune | — |
| 7 | Boubacar (Flutter+WSL2) | ✅ ship | **WSL2** non documenté (marche par chance) | 🟢 |
| 8 | Antoine (CTO) | ✅ adoption | Aucune (limitations déjà documentées) | — |
| 9 | **Ngozi (autodidacte ZIP)** | ⚠️ ship local, deploy bloquée | **Pas de check `git status` dans Phase 0** — ZIP download casse le déploiement | 🔴 |
| 10 | Yasmine (Supabase) | ✅ ship | **Neon prescrit, Supabase/autres pas évoqués** | 🟡 |

## 🔴 Bug réel à fixer (Ngozi)

**Phase 0 du setup-kit doit vérifier que c'est un git repo**. Si non, la skill doit :
1. Détecter : `test -d .git && echo REPO || echo NOT-A-REPO`
2. Si NOT-A-REPO : *« Tu as téléchargé le ZIP au lieu de cloner. Pour pousser ton travail plus tard, il te faut un vrai clone. Soit `git clone <url>` (recommandé), soit installe GitHub Desktop si tu préfères cliquer. »*
3. **Bloquer** Phase 7 si pas de repo Git — sinon le user va shipper localement et perdre tout son code au reformat.

## 🟡 Friction non-bloquante mais fixable

- **Phase 0 devrait check `git` installé** (Sofia n'avait pas Git, contournement long via Claude).
- **Phase 3 devrait nommer Supabase/Railway/Render comme alternatives** (« n'importe quel Postgres marche, Neon est juste le plus rapide à provisionner »).

## 🟢 Friction cosmétique

- Mentionner Cursor/Windsurf à côté de VS Code/Antigravity dans les instructions Reload Window.
- Documenter PowerShell exec policy comme Failure mode.
- Mentionner WSL2 comme « marche out-of-the-box » pour rassurer les Windows users.

## ✅ Taux de réussite

**9/10 ships pour leur first feature.** Ngozi est le seul cas vraiment bloqué — et c'est par un comportement (téléchargement ZIP) que la skill devrait détecter et intercepter en 1 ligne de Bash.

Les 8 autres frictions sont mineures et documentaires.
