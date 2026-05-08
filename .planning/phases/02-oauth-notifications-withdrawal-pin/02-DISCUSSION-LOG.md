# Phase 2: OAuth, Notifications, Withdrawal PIN — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 02-oauth-notifications-withdrawal-pin
**Areas discussed:** OAuth account-linking + provisioning, Notifications API contract, Mark-as-read API shape

---

## OAuth account-linking + provisioning

### Q1 — Email Google correspond à un user existant : que se passe-t-il ?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-link silencieux | Créer OAuthAccount lié + 3 cookies. Standard NextAuth/Stripe/Vercel. Sécurisé car `email_verified=true` enforced. | ✓ |
| Refuser + redirect EMAIL_ALREADY_EXISTS | Forcer login email/pwd puis lier explicitement. Plus sûr en théorie mais UX cassée (pas de page settings). | |
| Auto-link + email d'alerte | Compromis sécurité/UX. Nécessite outbox + template dédié. | |

**User's choice:** Auto-link silencieux

### Q2 — Nouveau user OAuth : `emailVerifiedAt` ?

| Option | Description | Selected |
|--------|-------------|----------|
| `= now()` (Google a vérifié) | Standard industrie. Re-prompt = friction sans gain de sécurité. | ✓ |
| `= null`, envoyer un code de vérif | Plus paranoid mais énorme friction post-Google sign-in. | |

**User's choice:** `= now()`

### Q3 — Welcome notification au premier sign-in OAuth ?

| Option | Description | Selected |
|--------|-------------|----------|
| Oui, via createNotification + welcomeNotification template | Template existe déjà. dedupeKey `welcome:${userId}` garantit at-most-once. | ✓ |
| Non, pas de bruit à la création | Plus minimal, dashboard vide. | |

**User's choice:** Oui

### Q4 — Storage du Google `refresh_token` ?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip, pas d'`offline_access` | On re-issue notre access JWT via /api/auth/refresh. Plus simple, moins de fuite. | ✓ |
| Stocker chiffré (AES-256-GCM) | Pour off-session API calls (Calendar/Drive). Pas nécessaire pour Phase 2 sign-in. | |

**User's choice:** Skip

---

## Notifications API contract

### Q1 — GET /api/notifications : pagination ?

| Option | Description | Selected |
|--------|-------------|----------|
| Cursor (createdAt + id) | Stable sur insertions concurrentes. Index `[userId, createdAt]` déjà en place. Pas de skip-trick attaque. | ✓ |
| Offset/limit classique | Plus simple côté client mais buggy avec insertions live. | |

**User's choice:** Cursor

### Q2 — Page size par défaut + max ?

| Option | Description | Selected |
|--------|-------------|----------|
| default=20, max=50 | Standard infinite-scroll. Évite les sur-fetch. | ✓ |
| default=50, max=100 | Pour dashboards admin avec beaucoup de notifs visibles. | |
| default=10, max=25 | Plus minimaliste, force infinite-scroll plus rapide. | |

**User's choice:** default=20, max=50

### Q3 — Filtres supportés ?

| Option | Description | Selected |
|--------|-------------|----------|
| `?unread=true` uniquement | Couvre 90% des cas. Index `[userId, readAt]` en place. Pas de feature creep. | ✓ |
| `?unread + ?type` | Vues séparées. Ajoute index `[userId, type, createdAt]`. Prématuré. | |
| `?unread + ?type + ?since` | Le plus flexible. Combiné avec cursor + filters complique le hot path. | |

**User's choice:** `?unread=true` uniquement

### Q4 — Schema JSON de NotificationPreferences.prefs ?

| Option | Description | Selected |
|--------|-------------|----------|
| Map open-ended `{ [eventType]: { email, inApp } }` | Pas de migration sur nouveau type. Schema flex. | ✓ |
| Map fermée avec enum coupé | Plus typesafe mais code change + tests à chaque type. Trop rigide pour starter. | |

**User's choice:** Open-ended

---

## Mark-as-read API shape

### Q1 — Verbe HTTP + endpoint ?

| Option | Description | Selected |
|--------|-------------|----------|
| `PATCH /api/notifications` body `{ ids: string[] \| 'all' }` | Single endpoint, REST-correct. Single = juste un élément dans le tableau. | ✓ |
| `POST /api/notifications/mark-read` + `/mark-all-read` séparés | Plus explicite mais 2 endpoints quand 1 suffit. POST sur updates = anti-pattern REST. | |
| `PATCH /api/notifications/:id` (single) + `PATCH /api/notifications` (bulk) | Plus REST-ortho mais 2 endpoints à maintenir + duplication tests. | |

**User's choice:** PATCH `/api/notifications` avec body `{ ids: string[] \| 'all' }`

### Q2 — Notification déjà read : comportement ?

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotent : 200 no-op si déjà read | Standard. Frontend peut spammer mark-read sans erreurs. | ✓ |
| 409 Conflict | Force le frontend à gérer un cas d'erreur sans bénéfice. | |

**User's choice:** Idempotent

### Q3 — Notification cross-tenant dans la liste d'IDs ?

| Option | Description | Selected |
|--------|-------------|----------|
| Silent ignore (`where: { userId: ctx.userId }`) | Standard. Cross-tenant matche rien. Pas d'énumération. | ✓ |
| 403 Forbidden | Loud mais révèle l'existence d'IDs valides ailleurs. Mauvais pour la sécu. | |

**User's choice:** Silent ignore

### Q4 — Réponse inclut le compteur unread mis à jour ?

| Option | Description | Selected |
|--------|-------------|----------|
| Oui, `{ updated: N, unreadCount: M }` | Évite le round-trip. Frontend update son badge en 1 call. Coût: une COUNT query addtl. | ✓ |
| Non, juste `{ updated: N }` | Plus minimal mais tous les UIs notifs utilisent un badge. | |

**User's choice:** Oui

---

## Claude's Discretion

- **PIN security model** — non sélectionné par l'utilisateur lors du choix des zones. Defaults capturés dans CONTEXT.md sous CD-01..CD-04 (bcrypt cost 12, lockout via Redis sliding-window keyé `pin:${userId}` séparé du login lockout, currentPin requis pour change, reset hors scope = DELETE+POST).

## Deferred Ideas

Capturés dans CONTEXT.md `<deferred>` :
- GitHub / Apple OAuth providers (Phase 6+)
- Server-Sent Events pour notifications live
- Notification retention/cleanup cron (Phase 5)
- `?type=` + `?since=` filters on list
- Forgot PIN flow
- OAuth linking depuis page settings (page n'existe pas)
