# Cahier des charges — Plateforme communauté & formations en ligne
*(à donner tel quel à Antigravity / Claude Code)*

## 0. Contexte et objectif

Je veux créer une application web type **"communauté + formations en ligne"**, sur le modèle de plateformes comme Skool. C'est un espace privé/payant où mes membres peuvent :
- suivre mes formations vidéo (avec quiz et suivi de progression),
- échanger dans un fil de discussion type réseau social ("Club"),
- consulter des documents/ressources que je publie,
- voir les événements à venir dans un calendrier,
- voir la liste des membres.

Le tout doit être **mon propre branding** (logo, nom, couleurs, mes formations à moi), pas une copie visuelle exacte d'un produit existant — je veux que tu t'inspires de la **structure et des fonctionnalités**, pas des logos/images/textes qui appartiennent à quelqu'un d'autre.

---

## 1. Stack technique recommandée

- **Frontend** : Next.js 14+ (App Router) + TypeScript + Tailwind CSS
- **Composants UI** : shadcn/ui (boutons, cards, dialogs, dropdowns, avatars)
- **Backend / DB** : Supabase (Postgres + Auth + Storage) — ou Firebase si plus simple
- **Vidéo** : hébergement Mux, Bunny Stream, ou simplement YouTube/Vimeo non-répertorié intégré en iframe custom player
- **Paiement** : Stripe (abonnement mensuel/annuel) + option Mobile Money si audience Afrique
- **Notifications** : email (Resend) + in-app
- **Déploiement** : Vercel

---

## 2. Architecture générale de navigation

Header fixe en haut de toutes les pages, avec :
- Logo + nom de la communauté (cliquable → page d'accueil "Club")
- Sélecteur de communauté (chevron, si multi-communautés — sinon on l'enlève)
- Barre de recherche centrale ("Rechercher...") avec raccourci clavier affiché (⌘K)
- Icône "flamme" avec compteur = streak/série de connexion de l'utilisateur
- Icône chat/messagerie privée
- Icône cloche de notifications avec badge rouge (nombre de nouvelles notifs)
- Icône "inviter un membre" (+ personne)
- Avatar utilisateur (rond, initiale ou photo) avec badge de niveau (petit cercle numéroté en bas à droite, ex: niveau "3")

En dessous, une **barre d'onglets horizontale** (navigation principale) :
1. **Club** (icône bulle de discussion) — fil d'actualité communautaire
2. **Cours** (icône livre) — liste des formations
3. **Calendrier** (icône calendrier) — événements
4. **Documents** (icône fichier) — ressources téléchargeables
5. **Membres** (icône personnes) — annuaire des membres
6. **À propos** (icône "i") — page de présentation publique de la communauté

L'onglet actif est souligné.

---

## 3. Détail des pages

### 3.1 Page "À propos" (landing/présentation de la communauté)

Layout en 2 colonnes :

**Colonne principale (gauche, ~70%)**
- Grand lecteur vidéo de présentation (16:9), avec :
  - bouton play centré
  - barre de progression, temps restant, volume, réglages (roue crantée), plein écran, "ouvrir dans un nouvel onglet"
- Sous la vidéo : une **rangée de miniatures** (autres vidéos/aperçus disponibles), cliquables pour changer la vidéo principale
- Titre de la formation/communauté (gros, gras)
- Ligne méta : icône "public" + statut (Public/Privé), icône carte bancaire + prix + périodicité ("150 000 FCFA (~229 €) / an"), avatar + nom du créateur (lien cliquable)
- Accroche courte en gras (une phrase de pitch)
- Description longue (plusieurs paragraphes : ce que contient la formation, qui est le créateur, résultats attendus, etc.)

**Colonne latérale (droite, ~30%), sticky en scroll**
- Carte "aperçu" : image de couverture + nom de la communauté + URL courte (ex: `moncoach.club/monoffre`)
- Accroche courte reprise
- Bouton principal large : "Inviter des personnes" (ou "Rejoindre" si visiteur non-membre)
- Mention "Tu es membre de cette communauté." (ou "Rejoindre pour X€/mois" si non membre)
- Bloc "À PROPOS" :
  - Communauté publique ou privée + explication (ex: "La page de présentation est visible par tous. L'accès aux discussions nécessite un abonnement.")
  - Tarif + méthode de paiement
  - Date de création
  - (optionnel) nombre de membres, catégorie

### 3.2 Page "Documents"

- Titre "Documents" + sous-titre ("Ressources publiées par ton coach")
- Barre de recherche "Rechercher un document..."
- Compteur total ("X documents") aligné à droite
- **Grille de cartes** (3 colonnes desktop, responsive) :
  - icône de fichier (PDF vs texte différenciés par icône/couleur)
  - titre du document
  - description courte (1-2 lignes, tronquée avec "...")
  - date de publication + poids du fichier (Ko/Mo)
  - card cliquable → ouvre/télécharge le document ou l'affiche en modal

### 3.3 Page "Cours" (liste des formations)

- Titre "Formations" + compteur ("X formations")
- **Grille de cartes formation** (3 colonnes desktop) :
  - image de couverture en haut (ratio ~16:9)
  - titre de la formation
  - description courte (2 lignes max, tronquée)
  - métadonnées : nombre de modules · nombre de leçons · icône personnes + nombre d'inscrits
  - **barre de progression** en bas de carte (remplissage proportionnel + % affiché à gauche dans la pilule)
  - card cliquable → va vers la page de lecture de la formation (3.6)

### 3.4 Page "Club" (fil communautaire — page d'accueil par défaut)

Layout 2 colonnes comme la page "À propos" :

**Colonne principale (gauche)**
- Zone de rédaction de post en haut : avatar + placeholder "Écrire quelque chose..."
- **Filtres par catégorie** en pilules horizontales : "Tous" (actif par défaut, en bleu), puis catégories personnalisables avec emoji (ex: "🎉 Présentations", "❓ Questions et aide", "📌 Business et stratégie"), + bouton réglages (icône curseurs) pour gérer les catégories
- **Flux de posts**, chaque post = une carte :
  - avatar auteur + nom + badge niveau (petit chiffre dans cercle) + badge "Épinglé" si post épinglé (fixé en haut du feed) + horodatage relatif ("il y a 5 jours")
  - titre du post en gras
  - contenu texte
  - média optionnel (image ou vidéo avec bouton play overlay)
  - barre d'actions : bouton "Like" avec compteur, bouton "commentaires" avec compteur
  - posts épinglés triés en premier

**Colonne latérale (droite, sticky)**
- Carte communauté (image + nom + URL + accroche + nombre de membres en ligne avec point vert)
- Bouton "Inviter des personnes"
- Mention "Tu es membre de cette communauté."
- Bloc "COACH & MODÉRATION" : avatar + nom + badge "Coach"/"Admin"

### 3.5 Page "Calendrier"

- Titre "Calendrier"
- **Calendrier mensuel** dans une card :
  - navigation mois précédent/suivant (chevrons)
  - nom du mois + année centré
  - grille 7 colonnes (Lun → Dim), jours du mois précédent/suivant en gris clair (désactivés)
  - jour du jour courant en cercle bleu plein (fond bleu, texte blanc)
  - jour ayant un événement passé légèrement grisé/highlighté
- Section "Événements" en dessous : liste de cartes événement :
  - badges statut ("Expiré" gris / "À venir" / icône caméra "En ligne" vert)
  - titre de l'événement
  - date (icône calendrier) + heure et durée (icône horloge)
  - cliquable → détail de l'événement (lien de connexion si en ligne, rappel, etc.)

### 3.6 Page de lecture d'une formation (détail cours)

Layout 2 colonnes :

**Colonne gauche (sidebar sticky, scrollable indépendamment)**
- Lien retour "← Retour aux cours"
- Titre de la formation
- Compteur "X/Y leçons" + pourcentage, avec barre de progression fine (verte)
- **Liste accordéon des modules** :
  - chaque module = en-tête cliquable (titre + compteur "terminées/total" + chevron pour déplier/replier)
  - sous chaque module : liste des leçons avec icône d'état :
    - ✅ cercle vert coché = leçon terminée
    - ⚪ cercle vide = leçon non commencée
  - ligne "Quiz réussi (XX%)" sous les leçons ayant un quiz, avec check vert et le score

**Colonne droite (contenu principal)**
- Lecteur vidéo (avec les mêmes contrôles que 3.1 : lecture, progression, temps, volume, réglages, plein écran)
- Titre de la leçon en cours (gros, gras)
- Barre de navigation : bouton "← Précédent", bouton central "✓ Terminée" (toggle, devient vert quand coché), bouton "Suivant →"
- **Onglets** : "DESCRIPTION" / "DISCUSSIONS"
  - Description : texte structuré (titres en majuscules, listes à puces) décrivant le contenu de la leçon, objectifs pédagogiques
  - Discussions : commentaires des membres sur cette leçon spécifique (fil type Q&A)

---

## 4. Modèle de données (tables principales)

```
users
  id, name, email, avatar_url, level (int), streak_count, role (member/coach/admin), created_at

communities
  id, name, slug, description, cover_image, price, price_period, currency, visibility (public/private), owner_id, created_at

memberships
  id, user_id, community_id, status (active/expired), joined_at

courses
  id, community_id, title, description, cover_image, order

modules
  id, course_id, title, order

lessons
  id, module_id, title, video_url, description_html, order, duration_seconds

lesson_progress
  id, user_id, lesson_id, completed (bool), completed_at

quizzes
  id, lesson_id, questions (json)

quiz_results
  id, user_id, quiz_id, score_percent, passed (bool)

posts
  id, community_id, author_id, category_id, title, content, media_url, media_type, is_pinned, created_at

post_categories
  id, community_id, name, emoji, order

comments
  id, post_id (nullable), lesson_id (nullable), author_id, content, created_at

likes
  id, post_id, user_id

documents
  id, community_id, title, description, file_url, file_type, file_size, created_at

events
  id, community_id, title, description, start_at, duration_minutes, is_online, meeting_url, status
```

---

## 5. Charte graphique suggérée (personnalisable)

- Police : Inter ou similaire (sans-serif moderne)
- Fond général : blanc / gris très clair (#F7F8FA)
- Cards : fond blanc, coins arrondis (rounded-xl), ombre légère, bordure fine grise
- Couleur d'accent principale : à choisir selon ta marque (le bleu est utilisé ici pour les états actifs/sélectionnés — libre à toi de le remplacer par ta couleur)
- Vert pour les indicateurs de succès/progression/complétion
- Badges pilule (rounded-full) pour statuts, niveaux, filtres de catégories
- Icônes : Lucide (cohérent avec shadcn/ui)

---

## 6. Fonctionnalités transverses attendues

- Authentification (email/password + Google OAuth)
- Abonnement payant (Stripe Checkout + gestion du statut d'accès)
- Upload et lecture vidéo avec suivi de progression (reprise à l'endroit quitté)
- Système de quiz avec calcul de score et déblocage de la leçon suivante (optionnel : rendre le passage du quiz obligatoire pour avancer)
- Système de gamification simple : niveaux (XP par action : poster, commenter, terminer une leçon) + streak de connexion quotidienne
- Notifications (nouveau commentaire, nouveau like, nouvel événement, rappel d'événement)
- Recherche globale (posts, leçons, documents, membres)
- Responsive mobile (les colonnes latérales passent en dessous du contenu principal sur mobile)
- Back-office simple pour moi (coach/admin) : créer/éditer formations, modules, leçons, quiz, posts épinglés, documents, événements, catégories

---

## 7. Ce qu'il ne faut PAS reproduire

- Ne pas copier le logo, le nom "IziSAAS", les textes, l'image du créateur ou toute image spécifique vue dans mes captures d'écran de référence — ce sont des éléments propres à un autre créateur.
- Utiliser mon propre nom de marque, mes propres couleurs, mes propres visuels, et le contenu de MES formations.

---

## 8. Livrable attendu de la part d'Antigravity

1. Une application Next.js fonctionnelle avec les 6 pages décrites ci-dessus
2. Un schéma de base de données Supabase correspondant au modèle de données (section 4)
3. Un système d'authentification + abonnement Stripe basique
4. Des données de démonstration (seed) pour tester : 1 formation avec 2-3 modules, quelques leçons, quelques posts, quelques documents, un événement
5. Un back-office minimal pour que je puisse ajouter mon propre contenu sans toucher au code
