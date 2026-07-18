// GET /api/community — public "À propos" data + the current user's
// membership snapshot (role, xp, level, streak) when authenticated.
// POST /api/community/join — v1 free access: any verified user can join;
// the Bictorys paywall can gate this later without touching the shape.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { optionalAuth, requireAuth } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { getCurrentOrganization } from '@/lib/server/community/current';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const org = await getCurrentOrganization(prisma);
    if (!org) {
      return NextResponse.json(
        { error: 'COMMUNITY_NOT_CONFIGURED', message: 'No community has been seeded yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const [memberCount, owner] = await Promise.all([
      prisma.organizationMember.count({ where: { organizationId: org.id } }),
      prisma.user.findUnique({
        where: { id: org.ownerId },
        select: { id: true, name: true, avatarUrl: true },
      }),
    ]);

    const auth = await optionalAuth(req.headers.get('authorization'));
    let me: {
      role: string;
      xp: number;
      level: number;
      streakCount: number;
      name: string | null;
      avatarUrl: string | null;
    } | null = null;

    if (auth) {
      const [member, user] = await Promise.all([
        prisma.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: org.id, userId: auth.user.sub } },
        }),
        prisma.user.findUnique({
          where: { id: auth.user.sub },
          select: { xp: true, level: true, streakCount: true, name: true, avatarUrl: true },
        }),
      ]);
      if (member && user) {
        me = {
          role: member.role,
          xp: user.xp,
          level: user.level,
          streakCount: user.streakCount,
          name: user.name,
          avatarUrl: user.avatarUrl,
        };
      }
    }

    return NextResponse.json(
      {
        community: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          description: org.description,
          tagline: org.tagline,
          coverImageUrl: org.coverImageUrl,
          logoUrl: org.logoUrl,
          visibility: org.visibility,
          priceAmount: org.priceAmount,
          pricePeriod: org.pricePeriod,
          currency: org.currency,
          createdAt: org.createdAt,
          memberCount,
        },
        owner,
        me,
      },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) return auth;

    const org = await getCurrentOrganization(prisma);
    if (!org) {
      return NextResponse.json(
        { error: 'COMMUNITY_NOT_CONFIGURED', message: 'No community has been seeded yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const member = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: auth.user.sub } },
      update: {},
      create: { organizationId: org.id, userId: auth.user.sub, role: 'MEMBER' },
    });

    return NextResponse.json(
      { role: member.role, organizationId: org.id },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
