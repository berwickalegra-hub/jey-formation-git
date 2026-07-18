import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET, PUT, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

const questions = [
  { question: 'Q1', choices: ['a', 'b'], correctIndex: 0 },
  { question: 'Q2', choices: ['a', 'b'], correctIndex: 1 },
  { question: 'Q3', choices: ['a', 'b'], correctIndex: 1 },
];

const lessonRow = {
  quiz: { id: 'quiz-1', questions },
  module: { course: { organizationId: 'org-1' } },
};

function makeGet(lessonId: string) {
  const req = new NextRequest(`http://test/api/lessons/${lessonId}/quiz`, { method: 'GET' });
  return GET(req, { params: Promise.resolve({ lessonId }) });
}

function makePut(lessonId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/lessons/${lessonId}/quiz`, { method: 'PUT', headers })
      : new NextRequest(`http://test/api/lessons/${lessonId}/quiz`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        });
  return PUT(req, { params: Promise.resolve({ lessonId }) });
}

function makePost(lessonId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/lessons/${lessonId}/quiz`, { method: 'POST', headers })
      : new NextRequest(`http://test/api/lessons/${lessonId}/quiz`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
  return POST(req, { params: Promise.resolve({ lessonId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('GET /api/lessons/[lessonId]/quiz', () => {
  it('404 QUIZ_NOT_FOUND when the lesson has no quiz', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      quiz: null,
      module: { course: { organizationId: 'org-1' } },
    } as never);
    const res = await makeGet('lesson-1');
    expect(res.status).toBe(404);
  });

  it('strips correctIndex from the returned questions for a MEMBER', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    const res = await makeGet('lesson-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toEqual([
      { question: 'Q1', choices: ['a', 'b'] },
      { question: 'Q2', choices: ['a', 'b'] },
      { question: 'Q3', choices: ['a', 'b'] },
    ]);
  });

  it('includes correctIndex for a coach (ADMIN/OWNER) so the editor can preserve answers', async () => {
    mockRequireOrgRole.mockResolvedValue({
      ...orgCtx,
      orgMember: { ...orgCtx.orgMember, role: 'ADMIN' },
    } as never);
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    const res = await makeGet('lesson-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toEqual(questions);
  });
});

describe('PUT /api/lessons/[lessonId]/quiz', () => {
  const lessonNoQuizYet = { id: 'lesson-1', module: { course: { organizationId: 'org-1' } } };
  const authorQuestions = [
    { question: 'Capitale du Sénégal ?', choices: ['Dakar', 'Thiès'], correctIndex: 0 },
  ];

  it('missing CSRF → 403', async () => {
    const res = await makePut('lesson-1', { questions: authorQuestions }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await makePut('lesson-x', { questions: authorQuestions });
    expect(res.status).toBe(404);
  });

  it('gates on ADMIN, not just MEMBER', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonNoQuizYet as never);
    prismaMock.quiz.upsert.mockResolvedValue({ id: 'quiz-1' } as never);
    await makePut('lesson-1', { questions: authorQuestions });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('empty questions array → 400 VALIDATION_FAILED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonNoQuizYet as never);
    const res = await makePut('lesson-1', { questions: [] });
    expect(res.status).toBe(400);
  });

  it('correctIndex out of range → 400 VALIDATION_FAILED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonNoQuizYet as never);
    const res = await makePut('lesson-1', {
      questions: [{ question: 'Q1', choices: ['a', 'b'], correctIndex: 5 }],
    });
    expect(res.status).toBe(400);
  });

  it('upserts the quiz and returns the questions without correctIndex', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonNoQuizYet as never);
    prismaMock.quiz.upsert.mockResolvedValue({ id: 'quiz-1' } as never);

    const res = await makePut('lesson-1', { questions: authorQuestions });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: 'quiz-1',
      questions: [{ question: 'Capitale du Sénégal ?', choices: ['Dakar', 'Thiès'] }],
    });

    const arg = prismaMock.quiz.upsert.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ lessonId: 'lesson-1' });
    expect(arg?.update).toEqual({ questions: authorQuestions });
    expect(arg?.create).toEqual({ lessonId: 'lesson-1', questions: authorQuestions });
  });
});

describe('POST /api/lessons/[lessonId]/quiz', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('lesson-1', { answers: [0, 1, 1] }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 QUIZ_NOT_FOUND when the lesson has no quiz', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      quiz: null,
      module: { course: { organizationId: 'org-1' } },
    } as never);
    const res = await makePost('lesson-1', { answers: [] });
    expect(res.status).toBe(404);
  });

  it('malformed body → 400 VALIDATION_FAILED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    const res = await makePost('lesson-1', { answers: 'nope' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('all correct → 100%, passed=true, stores a QuizResult', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.quizResult.create.mockResolvedValue({} as never);

    const res = await makePost('lesson-1', { answers: [0, 1, 1] });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ scorePercent: 100, passed: true });

    const arg = prismaMock.quizResult.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({
      userId: 'user-1',
      quizId: 'quiz-1',
      scorePercent: 100,
      passed: true,
    });
  });

  it('1 of 3 correct → 33%, below the 70% threshold → passed=false', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.quizResult.create.mockResolvedValue({} as never);

    const res = await makePost('lesson-1', { answers: [0, 0, 0] });
    const body = await res.json();
    expect(body).toEqual({ scorePercent: 33, passed: false });
  });

  it('gates on the org the lesson belongs to', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.quizResult.create.mockResolvedValue({} as never);
    await makePost('lesson-1', { answers: [0, 1, 1] });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'MEMBER', null);
  });
});
