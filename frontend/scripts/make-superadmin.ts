// Bootstrap script. Promotes a user to SUPERADMIN by email.
// Usage: pnpm db:make-superadmin <email>
//
// Idempotent — running it twice is a no-op for an existing SUPERADMIN.
// The role hierarchy is USER < ADMIN < SUPERADMIN; only SUPERADMINs can
// promote others via the admin back-office, so this script exists to
// bootstrap the very first one.

import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: pnpm db:make-superadmin <email>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`User not found: ${email}`);
      console.error('Sign up first at /api/auth/signup, then re-run this script.');
      process.exit(1);
    }

    if (user.role === 'SUPERADMIN') {
      console.log(`✓ ${email} is already SUPERADMIN — no change.`);
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'SUPERADMIN' },
      select: { email: true, role: true },
    });
    console.log(`✓ Promoted ${updated.email} to ${updated.role}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
