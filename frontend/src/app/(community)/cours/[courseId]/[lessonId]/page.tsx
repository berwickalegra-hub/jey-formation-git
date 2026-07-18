'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, Circle, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Card } from '@/components/community/Card';
import { Avatar } from '@/components/community/Avatar';
import { cn } from '@/lib/utils';

interface Lesson {
  id: string;
  title: string;
  videoUrl: string | null;
  descriptionHtml: string | null;
  durationSeconds: number | null;
  completed: boolean;
  hasQuiz: boolean;
  quizResult: { scorePercent: number; passed: boolean } | null;
}

interface CourseDetail {
  id: string;
  title: string;
  description: string | null;
  modules: { id: string; title: string; lessons: Lesson[] }[];
}

interface QuizQuestion {
  question: string;
  choices: string[];
}

interface CommentItem {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string | null; avatarUrl: string | null };
}

function isYoutubeOrVimeo(url: string): boolean {
  return /youtube\.com|youtu\.be|vimeo\.com/.test(url);
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Tab = 'description' | 'discussions' | 'quiz';

export default function LessonPlayerPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const router = useRouter();
  const { data: course, loading, refresh } = useApi<CourseDetail>(`/api/courses/${courseId}`);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('description');
  const [toggling, setToggling] = useState(false);

  const flatLessons = useMemo(() => course?.modules.flatMap((m) => m.lessons) ?? [], [course]);
  const currentIndex = flatLessons.findIndex((l) => l.id === lessonId);
  const currentLesson = currentIndex >= 0 ? flatLessons[currentIndex] : undefined;
  const prevLesson = currentIndex > 0 ? flatLessons[currentIndex - 1] : undefined;
  const nextLesson =
    currentIndex >= 0 && currentIndex < flatLessons.length - 1
      ? flatLessons[currentIndex + 1]
      : undefined;

  const currentModuleId = course?.modules.find((m) => m.lessons.some((l) => l.id === lessonId))?.id;
  const expandedModuleId = openModuleId ?? currentModuleId ?? null;

  const quiz = useApi<{ questions: QuizQuestion[] }>(`/api/lessons/${lessonId}/quiz`, {
    skip: tab !== 'quiz' || !currentLesson?.hasQuiz,
  });
  const comments = useApi<{ items: CommentItem[] }>(`/api/lessons/${lessonId}/comments`, {
    skip: tab !== 'discussions',
  });

  async function handleToggleComplete() {
    if (!currentLesson) return;
    setToggling(true);
    try {
      await api(`/api/lessons/${lessonId}/complete`, { method: 'POST' });
      invalidateCache(`/api/courses/${courseId}`);
      await refresh();
    } finally {
      setToggling(false);
    }
  }

  if (loading && !course) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }
  if (!course || !currentLesson) {
    return <div className="text-sm text-gray-500">Leçon introuvable.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <div className="order-2 space-y-2 lg:order-1">
        <Link href="/cours" className="text-sm text-gray-500 hover:text-gray-900">
          ← Toutes les formations
        </Link>
        <p className="mt-2 text-sm font-bold text-gray-900">{course.title}</p>

        <div className="mt-2 space-y-1">
          {course.modules.map((mod) => {
            const isOpen = mod.id === expandedModuleId;
            return (
              <div key={mod.id}>
                <button
                  onClick={() => setOpenModuleId(isOpen ? '' : mod.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-100"
                >
                  {mod.title}
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                  />
                </button>
                {isOpen && (
                  <div className="ml-2 space-y-0.5 border-l border-gray-200 pl-2">
                    {mod.lessons.map((l) => (
                      <Link
                        key={l.id}
                        href={`/cours/${courseId}/${l.id}`}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                          l.id === lessonId
                            ? 'bg-brand-50 font-semibold text-brand-700'
                            : 'text-gray-600 hover:bg-gray-100',
                        )}
                      >
                        {l.completed ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-gray-300" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="order-1 lg:order-2">
        <Card className="aspect-video overflow-hidden bg-gray-900">
          {currentLesson.videoUrl ? (
            isYoutubeOrVimeo(currentLesson.videoUrl) ? (
              <iframe
                src={currentLesson.videoUrl}
                className="h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video src={currentLesson.videoUrl} controls className="h-full w-full" />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
              Aucune vidéo pour cette leçon
            </div>
          )}
        </Card>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{currentLesson.title}</h1>
            {currentLesson.durationSeconds && (
              <p className="text-sm text-gray-500">
                {formatDuration(currentLesson.durationSeconds)}
              </p>
            )}
          </div>
          <button
            onClick={handleToggleComplete}
            disabled={toggling}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50',
              currentLesson.completed
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-900 text-white hover:bg-gray-800',
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
            {currentLesson.completed ? 'Terminée' : 'Marquer comme terminée'}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
          <button
            onClick={() => prevLesson && router.push(`/cours/${courseId}/${prevLesson.id}`)}
            disabled={!prevLesson}
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Précédent
          </button>
          <button
            onClick={() => nextLesson && router.push(`/cours/${courseId}/${nextLesson.id}`)}
            disabled={!nextLesson}
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            Suivant <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex gap-1 border-b border-gray-200">
          {(
            [
              ['description', 'Description'],
              ['discussions', 'Discussions'],
              ...(currentLesson.hasQuiz ? ([['quiz', 'Quiz']] as const) : []),
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'border-b-2 px-4 py-2 text-sm font-semibold',
                tab === key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === 'description' && (
            <div className="text-sm leading-relaxed text-gray-700">
              {currentLesson.descriptionHtml ? (
                <div dangerouslySetInnerHTML={{ __html: currentLesson.descriptionHtml }} />
              ) : (
                <p className="text-gray-500">Aucune description pour cette leçon.</p>
              )}
            </div>
          )}

          {tab === 'discussions' && (
            <DiscussionsPanel
              lessonId={lessonId}
              items={comments.data?.items ?? []}
              loading={comments.loading}
              onPosted={() => comments.refresh()}
            />
          )}

          {tab === 'quiz' && currentLesson.hasQuiz && (
            <QuizPanel
              lessonId={lessonId}
              questions={quiz.data?.questions ?? []}
              loading={quiz.loading}
              existingResult={currentLesson.quizResult}
              onSubmitted={() => {
                invalidateCache(`/api/courses/${courseId}`);
                void refresh();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DiscussionsPanel({
  lessonId,
  items,
  loading,
  onPosted,
}: {
  lessonId: string;
  items: CommentItem[];
  loading: boolean;
  onPosted: () => void;
}) {
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  async function handleSubmit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      await api(`/api/lessons/${lessonId}/comments`, {
        method: 'POST',
        body: { content: trimmed },
      });
      setContent('');
      onPosted();
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Poser une question sur cette leçon…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit();
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={posting || !content.trim()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Envoyer
        </button>
      </div>

      {loading && items.length === 0 ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune question pour l&apos;instant.</p>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <div key={c.id} className="flex items-start gap-3">
              <Avatar name={c.author.name ?? 'Membre'} src={c.author.avatarUrl} size="sm" />
              <div>
                <p className="text-sm font-semibold text-gray-900">{c.author.name ?? 'Membre'}</p>
                <p className="text-sm text-gray-600">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuizPanel({
  lessonId,
  questions,
  loading,
  existingResult,
  onSubmitted,
}: {
  lessonId: string;
  questions: QuizQuestion[];
  loading: boolean;
  existingResult: { scorePercent: number; passed: boolean } | null;
  onSubmitted: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ scorePercent: number; passed: boolean } | null>(
    existingResult,
  );

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const payload = questions.map((_, i) => answers[i] ?? -1);
      const res = await api<{ scorePercent: number; passed: boolean }>(
        `/api/lessons/${lessonId}/quiz`,
        { method: 'POST', body: { answers: payload } },
      );
      setResult(res);
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && questions.length === 0) {
    return <p className="text-sm text-gray-500">Chargement…</p>;
  }

  return (
    <div className="space-y-5">
      {result && (
        <div
          className={cn(
            'rounded-lg px-4 py-3 text-sm font-semibold',
            result.passed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
          )}
        >
          Score : {result.scorePercent}% {result.passed ? '— Réussi' : '— À retenter'}
        </div>
      )}

      {questions.map((q, i) => (
        <div key={i}>
          <p className="text-sm font-semibold text-gray-900">
            {i + 1}. {q.question}
          </p>
          <div className="mt-2 space-y-1.5">
            {q.choices.map((choice, ci) => (
              <label
                key={ci}
                className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name={`q-${i}`}
                  checked={answers[i] === ci}
                  onChange={() => setAnswers((a) => ({ ...a, [i]: ci }))}
                />
                {choice}
              </label>
            ))}
          </div>
        </div>
      ))}

      <button
        onClick={handleSubmit}
        disabled={submitting || questions.length === 0}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? 'Envoi…' : 'Valider le quiz'}
      </button>
    </div>
  );
}
