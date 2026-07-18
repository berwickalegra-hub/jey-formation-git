// GET /api/courses — course grid for the "Cours" tab, with each course's
// completion percent for the current user (completed lessons / total lessons).
// POST /api/courses — coach/moderator publishes a new (empty) course; modules
// and lessons are added afterward via the nested routes.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org, ctx: auth } = gate;

    const [courses, memberCount] = await Promise.all([
      prisma.course.findMany({
        where: { organizationId: org.id },
        orderBy: { order: 'asc' },
        include: {
          modules: {
            orderBy: { order: 'asc' },
            select: { lessons: { orderBy: { order: 'asc' }, select: { id: true } } },
          },
        },
      }),
      prisma.organizationMember.count({ where: { organizationId: org.id } }),
    ]);

    const items = await Promise.all(
      courses.map(async (course) => {
        const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
        const lessonCount = lessonIds.length;
        const completedCount = lessonCount
          ? await prisma.lessonProgress.count({
              where: { userId: auth.user.sub, lessonId: { in: lessonIds }, completed: true },
            })
          : 0;
        return {
          id: course.id,
          title: course.title,
          description: course.description,
          coverImageUrl: course.coverImageUrl,
          moduleCount: course.modules.length,
          lessonCount,
          memberCount,
          progressPercent: lessonCount ? Math.round((completedCount / lessonCount) * 100) : 0,
          firstLessonId: lessonIds[0] ?? null,
        };
      }),
    );

    return NextResponse.json(
      { items },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  coverImageUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const gate = await requireCommunityRole(prisma, 'ADMIN', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org } = gate;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const order = await prisma.course.count({ where: { organizationId: org.id } });
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        coverImageUrl: parsed.data.coverImageUrl ?? null,
        order,
      },
    });

    return NextResponse.json(course, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
