// GET /api/lessons/[lessonId]/quiz — fetch questions. `correctIndex` is
// stripped for MEMBER callers (must never leak the answer before scoring)
// but included for ADMIN/OWNER so the quiz editor can show/preserve it.
// PUT /api/lessons/[lessonId]/quiz — coach/moderator authors or replaces the
// quiz for a lesson (upsert — a lesson has at most one quiz, schema.prisma
// `Quiz.lessonId @unique`).
// POST /api/lessons/[lessonId]/quiz — submit answers, get scored, store a
// QuizResult. Informational only (see schema.prisma Quiz model comment) —
// does not gate the next lesson.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';

const PASS_THRESHOLD_PERCENT = 70;

interface QuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
}

const Body = z.object({ answers: z.array(z.number().int().nonnegative()) });

export async function GET(
  req: NextRequest,
  ctx2: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const { lessonId } = await ctx2.params;
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        quiz: { select: { id: true, questions: true } },
        module: { select: { course: { select: { organizationId: true } } } },
      },
    });
    if (!lesson?.quiz) {
      return NextResponse.json(
        { error: 'QUIZ_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const auth = await requireOrgRole(
      lesson.module.course.organizationId,
      'MEMBER',
      req.headers.get('authorization'),
    );
    if (auth instanceof NextResponse) return auth;

    const isCoach = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    const rawQuestions = lesson.quiz.questions as unknown as QuizQuestion[];
    const questions = isCoach
      ? rawQuestions
      : rawQuestions.map((q) => ({ question: q.question, choices: q.choices }));

    return NextResponse.json(
      { questions },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

const AuthorQuestion = z
  .object({
    question: z.string().trim().min(1).max(1000),
    choices: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
    correctIndex: z.number().int().nonnegative(),
  })
  .refine((q) => q.correctIndex < q.choices.length, {
    message: 'correctIndex must be a valid index into choices',
  });
const AuthorBody = z.object({ questions: z.array(AuthorQuestion).min(1).max(50) });

export async function PUT(
  req: NextRequest,
  ctx2: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { lessonId } = await ctx2.params;
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, module: { select: { course: { select: { organizationId: true } } } } },
    });
    if (!lesson) {
      return NextResponse.json(
        { error: 'LESSON_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const auth = await requireOrgRole(
      lesson.module.course.organizationId,
      'ADMIN',
      req.headers.get('authorization'),
    );
    if (auth instanceof NextResponse) return auth;

    const parsed = AuthorBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const quiz = await prisma.quiz.upsert({
      where: { lessonId },
      update: { questions: parsed.data.questions },
      create: { lessonId, questions: parsed.data.questions },
    });

    return NextResponse.json(
      {
        id: quiz.id,
        questions: parsed.data.questions.map((q) => ({ question: q.question, choices: q.choices })),
      },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function POST(
  req: NextRequest,
  ctx2: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { lessonId } = await ctx2.params;
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        quiz: { select: { id: true, questions: true } },
        module: { select: { course: { select: { organizationId: true } } } },
      },
    });
    if (!lesson?.quiz) {
      return NextResponse.json(
        { error: 'QUIZ_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const auth = await requireOrgRole(
      lesson.module.course.organizationId,
      'MEMBER',
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

    const questions = lesson.quiz.questions as unknown as QuizQuestion[];
    const total = questions.length;
    const correct = questions.reduce(
      (acc, q, i) => acc + (parsed.data.answers[i] === q.correctIndex ? 1 : 0),
      0,
    );
    const scorePercent = total ? Math.round((correct / total) * 100) : 0;
    const passed = scorePercent >= PASS_THRESHOLD_PERCENT;

    await prisma.quizResult.create({
      data: { userId: auth.user.sub, quizId: lesson.quiz.id, scorePercent, passed },
    });

    return NextResponse.json(
      { scorePercent, passed },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
