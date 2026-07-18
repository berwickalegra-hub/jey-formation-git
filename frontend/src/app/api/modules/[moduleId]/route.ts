// PATCH /api/modules/[moduleId] — rename a module.
// DELETE /api/modules/[moduleId] — remove a module (cascades its lessons).
// The organization is resolved via module → course → organizationId since a
// module has no direct organizationId column.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';

async function resolveModuleOrg(moduleId: string) {
  return prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, course: { select: { organizationId: true } } },
  });
}

const Body = z.object({ title: z.string().trim().min(1).max(200) });

export async function PATCH(
  req: NextRequest,
  ctx2: { params: Promise<{ moduleId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { moduleId } = await ctx2.params;
    const found = await resolveModuleOrg(moduleId);
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

    const module_ = await prisma.module.update({
      where: { id: moduleId },
      data: { title: parsed.data.title },
    });

    return NextResponse.json(module_, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}

export async function DELETE(
  req: NextRequest,
  ctx2: { params: Promise<{ moduleId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { moduleId } = await ctx2.params;
    const found = await resolveModuleOrg(moduleId);
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

    await prisma.module.delete({ where: { id: moduleId } });

    return NextResponse.json(
      { deleted: true },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
