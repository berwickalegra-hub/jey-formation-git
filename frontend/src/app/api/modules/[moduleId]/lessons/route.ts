// POST /api/modules/[moduleId]/lessons — coach/moderator adds a lesson to a
// module. New lessons always append at the end (order = current count).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';

const Body = z.object({
  title: z.string().trim().min(1).max(200),
  videoUrl: z.string().url().optional(),
  descriptionHtml: z.string().trim().max(20000).optional(),
  durationSeconds: z.number().int().positive().optional(),
});

export async function POST(
  req: NextRequest,
  ctx2: { params: Promise<{ moduleId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { moduleId } = await ctx2.params;
    const found = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, course: { select: { organizationId: true } } },
    });
    if (!found) {
      return NextResponse.json(
        { error: 'MODULE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const auth = await requireOrgRole(
      found.course.organizationId,
      'ADMIN',
      req.headers.get('authorization'),
    );
    if (auth instanceof NextResponse) return auth;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const order = await prisma.lesson.count({ where: { moduleId } });
    const lesson = await prisma.lesson.create({
      data: {
        moduleId,
        title: parsed.data.title,
        videoUrl: parsed.data.videoUrl ?? null,
        descriptionHtml: parsed.data.descriptionHtml ?? null,
        durationSeconds: parsed.data.durationSeconds ?? null,
        order,
      },
    });

    return NextResponse.json(lesson, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
