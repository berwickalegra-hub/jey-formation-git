// Dev seed script. Creates 3 sample users with bcrypt-hashed passwords for
// local development against a real Postgres. Refuses to run with
// NODE_ENV=production to prevent accidental destructive seeding in prod.
//
// Usage: pnpm seed:dev
//
// Idempotent — uses upsert keyed on email, so running multiple times
// does not duplicate rows.
//
// SCRIPT-01 refactor: exports `main(args, deps)` so tests can inject a
// mocked PrismaClient (no DB connection at module import time). The CLI
// guard at the bottom mirrors `make-superadmin.ts:85-92`.

import { pathToFileURL } from 'node:url';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const SEED_USERS = [
  { email: 'admin@example.com', password: 'AdminPassword123!', role: 'SUPERADMIN' },
  { email: 'user@example.com', password: 'UserPassword123!', role: 'USER' },
  {
    email: 'unverified@example.com',
    password: 'UnverifiedPwd123!',
    role: 'USER',
    skipVerify: true,
  },
] as const;

// Duplicated rather than imported from `@/lib/server/community/current` —
// that module (transitively) imports `next/headers`, which this script
// must not pull in since it runs under plain `tsx`, outside any Next.js
// request context.
const COMMUNITY_SLUG = process.env.COMMUNITY_SLUG || 'jey-club';

interface SeedDeps {
  // Injectable for tests — defaults to a freshly-instantiated PrismaClient
  // when called as a CLI.
  prisma?: PrismaClient;
}

/**
 * Demo content for the community platform (Club/Cours/Calendrier/Documents/
 * Membres). Idempotent via `count === 0` guards per model — safe to re-run
 * `pnpm seed:dev` without duplicating posts/courses/events on every call.
 */
export async function seedCommunity(
  prisma: PrismaClient,
  ownerId: string,
  memberId: string,
): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: COMMUNITY_SLUG },
    update: {},
    create: {
      slug: COMMUNITY_SLUG,
      name: 'Jey-club',
      ownerId,
      description:
        'Une communauté pour apprendre, progresser et échanger ensemble. Cours, discussions et événements en direct.',
      tagline: 'Apprends. Partage. Progresse.',
      visibility: 'PUBLIC',
      currency: 'XOF',
    },
  });
  console.log(`✓ community "${org.name}" (${org.slug})`);

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: ownerId } },
    update: {},
    create: { organizationId: org.id, userId: ownerId, role: 'OWNER' },
  });
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: memberId } },
    update: {},
    create: { organizationId: org.id, userId: memberId, role: 'MEMBER' },
  });

  const categoryCount = await prisma.postCategory.count({ where: { organizationId: org.id } });
  if (categoryCount === 0) {
    await prisma.postCategory.create({
      data: { organizationId: org.id, name: 'Général', emoji: '💬', order: 0 },
    });
    await prisma.postCategory.create({
      data: { organizationId: org.id, name: 'Annonces', emoji: '📣', order: 1 },
    });
    await prisma.postCategory.create({
      data: { organizationId: org.id, name: 'Questions', emoji: '❓', order: 2 },
    });
    console.log('✓ 3 post categories');
  }

  const courseCount = await prisma.course.count({ where: { organizationId: org.id } });
  if (courseCount === 0) {
    await prisma.course.create({
      data: {
        organizationId: org.id,
        title: 'Fondations',
        description: 'Les bases essentielles pour bien démarrer.',
        order: 0,
        modules: {
          create: [
            {
              title: 'Module 1 — Introduction',
              order: 0,
              lessons: {
                create: [
                  {
                    title: 'Bienvenue',
                    videoUrl: null,
                    descriptionHtml: '<p>Présentation de la formation et des objectifs.</p>',
                    order: 0,
                    durationSeconds: 180,
                  },
                  {
                    title: 'Comment utiliser la plateforme',
                    videoUrl: null,
                    descriptionHtml: '<p>Un tour rapide du Club, des Cours et du Calendrier.</p>',
                    order: 1,
                    durationSeconds: 240,
                    quiz: {
                      create: {
                        questions: [
                          {
                            question: 'Où trouve-t-on les discussions de la communauté ?',
                            choices: ['Onglet Club', 'Onglet Documents', 'Onglet Calendrier'],
                            correctIndex: 0,
                          },
                          {
                            question: 'Le quiz est-il obligatoire pour continuer la formation ?',
                            choices: ['Oui', 'Non'],
                            correctIndex: 1,
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
            {
              title: 'Module 2 — Aller plus loin',
              order: 1,
              lessons: {
                create: [
                  {
                    title: 'Premiers exercices',
                    videoUrl: null,
                    descriptionHtml: '<p>Mets en pratique ce que tu viens d’apprendre.</p>',
                    order: 0,
                    durationSeconds: 300,
                  },
                  {
                    title: 'Bilan du module',
                    videoUrl: null,
                    descriptionHtml: '<p>Récapitulatif et prochaines étapes.</p>',
                    order: 1,
                    durationSeconds: 200,
                  },
                ],
              },
            },
          ],
        },
      },
    });
    console.log('✓ course "Fondations" (2 modules, 4 lessons, 1 quiz)');
  }

  const postCount = await prisma.post.count({ where: { organizationId: org.id } });
  if (postCount === 0) {
    const generalCategory = await prisma.postCategory.findFirst({
      where: { organizationId: org.id },
      orderBy: { order: 'asc' },
    });

    const welcomePost = await prisma.post.create({
      data: {
        organizationId: org.id,
        authorId: ownerId,
        categoryId: generalCategory?.id ?? null,
        title: 'Bienvenue dans la communauté 👋',
        content: 'Contente de vous voir ici ! N’hésitez pas à vous présenter en commentaire.',
        isPinned: true,
      },
    });
    await prisma.post.create({
      data: {
        organizationId: org.id,
        authorId: memberId,
        content: 'Première leçon terminée, top ! Hâte de voir la suite 🚀',
      },
    });
    await prisma.comment.create({
      data: { postId: welcomePost.id, authorId: memberId, content: 'Merci pour l’accueil !' },
    });
    await prisma.like.create({ data: { postId: welcomePost.id, userId: memberId } });
    console.log('✓ 2 posts (1 pinned) + 1 comment + 1 like');
  }

  const documentCount = await prisma.document.count({ where: { organizationId: org.id } });
  if (documentCount === 0) {
    await prisma.document.create({
      data: {
        organizationId: org.id,
        uploadedById: ownerId,
        title: 'Guide de démarrage.pdf',
        description: 'Le guide complet pour bien démarrer dans la communauté.',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/guide-demarrage.pdf',
        fileType: 'application/pdf',
        fileSizeBytes: 245_000,
      },
    });
    await prisma.document.create({
      data: {
        organizationId: org.id,
        uploadedById: ownerId,
        title: 'Support de cours - Fondations.pdf',
        description: null,
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/support-fondations.pdf',
        fileType: 'application/pdf',
        fileSizeBytes: 512_000,
      },
    });
    console.log('✓ 2 documents');
  }

  const eventCount = await prisma.event.count({ where: { organizationId: org.id } });
  if (eventCount === 0) {
    const startAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await prisma.event.create({
      data: {
        organizationId: org.id,
        createdById: ownerId,
        title: 'Live mensuel — Questions/Réponses',
        description: 'Session en direct pour répondre à toutes vos questions.',
        startAt,
        durationMinutes: 60,
        isOnline: true,
        meetingUrl: 'https://meet.google.com/demo-jey-club',
      },
    });
    console.log('✓ 1 event scheduled');
  }
}

export async function main(_args: string[] = [], deps: SeedDeps = {}): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run seed-dev in production.');
    process.exit(1);
  }

  const prisma = deps.prisma ?? new PrismaClient();
  try {
    const userIdByEmail = new Map<string, string>();
    for (const seed of SEED_USERS) {
      const passwordHash = await bcrypt.hash(seed.password, 12);
      const user = await prisma.user.upsert({
        where: { email: seed.email },
        update: { passwordHash, role: seed.role },
        create: {
          email: seed.email,
          passwordHash,
          role: seed.role,
          emailVerifiedAt: 'skipVerify' in seed && seed.skipVerify ? null : new Date(),
        },
        select: { id: true, email: true, role: true, emailVerifiedAt: true },
      });
      const verified = user.emailVerifiedAt ? 'verified' : 'unverified';
      console.log(`✓ ${user.email} (${user.role}, ${verified})`);
      userIdByEmail.set(seed.email, user.id);
    }
    console.log('\nLogin with the password from this file (do NOT use these in prod).');

    const ownerId = userIdByEmail.get('admin@example.com');
    const memberId = userIdByEmail.get('user@example.com');
    if (ownerId && memberId) {
      await seedCommunity(prisma, ownerId, memberId);
    }
  } finally {
    // Only disconnect the real client; tests pass their own mock and close
    // it themselves.
    if (!deps.prisma) {
      await prisma.$disconnect();
    }
  }
}

// CLI entrypoint guard — only run when invoked as a script, not when
// imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
