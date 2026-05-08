// Dev seed script. Creates 3 sample users with bcrypt-hashed passwords for
// local development against a real Postgres. Refuses to run with
// NODE_ENV=production to prevent accidental destructive seeding in prod.
//
// Usage: pnpm seed:dev
//
// Idempotent — uses upsert keyed on email, so running multiple times
// does not duplicate rows.

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

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run seed-dev in production.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
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
        select: { email: true, role: true, emailVerifiedAt: true },
      });
      const verified = user.emailVerifiedAt ? 'verified' : 'unverified';
      console.log(`✓ ${user.email} (${user.role}, ${verified})`);
    }
    console.log('\nLogin with the password from this file (do NOT use these in prod).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
