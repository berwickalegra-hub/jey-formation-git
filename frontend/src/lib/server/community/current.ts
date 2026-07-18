import type { Organization, PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireOrgRole, type OrgContext } from '@/lib/server/middleware';
import type { OrgRole } from '@/lib/server/middleware/require-org-role';

// This app runs a single community in practice (see cahier des charges —
// the community switcher is explicitly dropped for a single-community
// setup). Every route resolves "the" community by this stable slug instead
// of `findFirst()`, so a fork can parameterize it from the URL later
// without touching call sites beyond this one function.
export const COMMUNITY_SLUG = process.env.COMMUNITY_SLUG || 'jey-club';

export async function getCurrentOrganization(prisma: PrismaClient): Promise<Organization | null> {
  return prisma.organization.findUnique({ where: { slug: COMMUNITY_SLUG } });
}

/**
 * Shared boilerplate for every community-scoped route: resolve "the"
 * organization, then gate on the caller's role in it. Collapses the
 * `getCurrentOrganization` + `requireOrgRole` pair repeated across
 * courses/posts/documents/events/members routes into one call.
 */
export async function requireCommunityRole(
  prisma: PrismaClient,
  minRole: OrgRole,
  authHeader: string | null,
): Promise<{ org: Organization; ctx: OrgContext } | NextResponse> {
  const org = await getCurrentOrganization(prisma);
  if (!org) {
    return NextResponse.json({ error: 'COMMUNITY_NOT_CONFIGURED' }, { status: 404 });
  }
  const ctx = await requireOrgRole(org.id, minRole, authHeader);
  if (ctx instanceof NextResponse) return ctx;
  return { org, ctx };
}
