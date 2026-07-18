'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Plus, Trash2, Video } from 'lucide-react';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Card } from '@/components/community/Card';

interface Lesson {
  id: string;
  title: string;
  videoUrl: string | null;
  descriptionHtml: string | null;
  durationSeconds: number | null;
  hasQuiz: boolean;
}

interface ModuleT {
  id: string;
  title: string;
  lessons: Lesson[];
}

interface CourseDetail {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  modules: ModuleT[];
}

interface CommunityResponse {
  me: { role: string } | null;
}

interface QuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
}

function isYoutubeOrVimeo(url: string): boolean {
  return /youtube\.com|youtu\.be|vimeo\.com/.test(url);
}

export default function CourseEditorPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data: community, loading: communityLoading } =
    useApi<CommunityResponse>('/api/community');
  const { data: course, loading, refresh } = useApi<CourseDetail>(`/api/courses/${courseId}`);
  const canEdit = community?.me?.role === 'OWNER' || community?.me?.role === 'ADMIN';

  function reload() {
    invalidateCache(`/api/courses/${courseId}`);
    void refresh();
  }

  if (communityLoading || loading) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }
  if (!canEdit) {
    return <div className="text-sm text-gray-500">Accès réservé aux coachs de la communauté.</div>;
  }
  if (!course) {
    return <div className="text-sm text-gray-500">Formation introuvable.</div>;
  }

  const firstLessonId = course.modules.flatMap((m) => m.lessons)[0]?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/cours" className="text-sm text-gray-500 hover:text-gray-900">
          ← Toutes les formations
        </Link>
        {firstLessonId && (
          <Link
            href={`/cours/${courseId}/${firstLessonId}`}
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            Voir la formation →
          </Link>
        )}
      </div>

      <CourseHeaderForm course={course} onSaved={reload} />

      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Modules</h2>
        {course.modules.map((m, i) => (
          <ModuleEditor
            key={m.id}
            module={m}
            isFirst={i === 0}
            isLast={i === course.modules.length - 1}
            onChanged={reload}
          />
        ))}
        <NewModuleForm courseId={courseId} onCreated={reload} />
      </div>
    </div>
  );
}

function MoveButtons({
  isFirst,
  isLast,
  onMove,
}: {
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        onClick={() => onMove('up')}
        disabled={isFirst}
        title="Déplacer vers le haut"
        className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onMove('down')}
        disabled={isLast}
        title="Déplacer vers le bas"
        className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CourseHeaderForm({ course, onSaved }: { course: CourseDetail; onSaved: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? '');
  const [coverImageUrl, setCoverImageUrl] = useState(course.coverImageUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api(`/api/courses/${course.id}`, {
        method: 'PATCH',
        body: {
          title: title.trim(),
          description: description.trim() || null,
          coverImageUrl: coverImageUrl.trim() || null,
        },
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Supprimer définitivement cette formation et tout son contenu ?')) return;
    setDeleting(true);
    try {
      await api(`/api/courses/${course.id}`, { method: 'DELETE' });
      invalidateCache('/api/courses');
      router.push('/cours');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre de la formation"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold focus:border-brand-500 focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={2}
        className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
      <input
        value={coverImageUrl}
        onChange={(e) => setCoverImageUrl(e.target.value)}
        placeholder="URL de l'image de couverture (optionnel)"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" /> Supprimer la formation
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </Card>
  );
}

function ModuleEditor({
  module: mod,
  isFirst,
  isLast,
  onChanged,
}: {
  module: ModuleT;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(mod.title);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);

  async function handleRename() {
    if (!title.trim() || title === mod.title) return;
    setSaving(true);
    try {
      await api(`/api/modules/${mod.id}`, { method: 'PATCH', body: { title: title.trim() } });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Supprimer le module « ${mod.title} » et ses leçons ?`)) return;
    setDeleting(true);
    try {
      await api(`/api/modules/${mod.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  async function handleMove(direction: 'up' | 'down') {
    setMoving(true);
    try {
      await api(`/api/modules/${mod.id}/move`, { method: 'POST', body: { direction } });
      onChanged();
    } finally {
      setMoving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <MoveButtons isFirst={isFirst || moving} isLast={isLast || moving} onMove={handleMove} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleRename}
          disabled={saving}
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold focus:border-brand-500 focus:outline-none"
        />
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2 border-l-2 border-gray-100 pl-4">
        {mod.lessons.map((l, i) => (
          <LessonEditor
            key={l.id}
            lesson={l}
            isFirst={i === 0}
            isLast={i === mod.lessons.length - 1}
            onChanged={onChanged}
          />
        ))}
        <NewLessonForm moduleId={mod.id} onCreated={onChanged} />
      </div>
    </Card>
  );
}

function LessonEditor({
  lesson,
  isFirst,
  isLast,
  onChanged,
}: {
  lesson: Lesson;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [videoUrl, setVideoUrl] = useState(lesson.videoUrl ?? '');
  const [descriptionHtml, setDescriptionHtml] = useState(lesson.descriptionHtml ?? '');
  const [durationSeconds, setDurationSeconds] = useState(lesson.durationSeconds?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api(`/api/lessons/${lesson.id}`, {
        method: 'PATCH',
        body: {
          title: title.trim(),
          videoUrl: videoUrl.trim() || null,
          descriptionHtml: descriptionHtml.trim() || null,
          durationSeconds: durationSeconds ? Number(durationSeconds) : null,
        },
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Supprimer la leçon « ${lesson.title} » ?`)) return;
    setDeleting(true);
    try {
      await api(`/api/lessons/${lesson.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  async function handleMove(direction: 'up' | 'down') {
    setMoving(true);
    try {
      await api(`/api/lessons/${lesson.id}/move`, { method: 'POST', body: { direction } });
      onChanged();
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="rounded-md bg-gray-50 p-3">
      <div className="flex items-center gap-2">
        <MoveButtons isFirst={isFirst || moving} isLast={isLast || moving} onMove={handleMove} />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 truncate text-left text-sm font-medium text-gray-800"
        >
          {lesson.title}
          {lesson.videoUrl && <span className="ml-2 text-xs text-green-600">(vidéo)</span>}
          {lesson.hasQuiz && <span className="ml-2 text-xs text-brand-600">(quiz)</span>}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre de la leçon"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="URL de la vidéo (YouTube, Vimeo, mp4…)"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          {videoUrl.trim() && (
            <div className="aspect-video overflow-hidden rounded-md bg-gray-900">
              {isYoutubeOrVimeo(videoUrl.trim()) ? (
                <iframe
                  src={videoUrl.trim()}
                  className="h-full w-full"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video src={videoUrl.trim()} controls className="h-full w-full" />
              )}
            </div>
          )}
          <textarea
            value={descriptionHtml}
            onChange={(e) => setDescriptionHtml(e.target.value)}
            placeholder="Description"
            rows={2}
            className="w-full resize-none rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          <input
            type="number"
            min={1}
            value={durationSeconds}
            onChange={(e) => setDurationSeconds(e.target.value)}
            placeholder="Durée (secondes)"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowQuiz((v) => !v)}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {lesson.hasQuiz ? 'Modifier le quiz' : '+ Ajouter un quiz'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          {showQuiz && (
            <QuizEditor
              lessonId={lesson.id}
              hasQuiz={lesson.hasQuiz}
              onSaved={() => {
                setShowQuiz(false);
                onChanged();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function NewModuleForm({ courseId, onCreated }: { courseId: string; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await api(`/api/courses/${courseId}/modules`, {
        method: 'POST',
        body: { title: title.trim() },
      });
      setTitle('');
      onCreated();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nom du nouveau module"
        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleCreate();
        }}
      />
      <button
        onClick={handleCreate}
        disabled={creating || !title.trim()}
        className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Module
      </button>
    </div>
  );
}

function NewLessonForm({ moduleId, onCreated }: { moduleId: string; onCreated: () => void }) {
  const [mode, setMode] = useState<'closed' | 'video'>('closed');
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate(withVideo: boolean) {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await api(`/api/modules/${moduleId}/lessons`, {
        method: 'POST',
        body: {
          title: title.trim(),
          ...(withVideo && videoUrl.trim() ? { videoUrl: videoUrl.trim() } : {}),
        },
      });
      setTitle('');
      setVideoUrl('');
      setMode('closed');
      onCreated();
    } finally {
      setCreating(false);
    }
  }

  if (mode === 'video') {
    return (
      <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre de la leçon vidéo"
          autoFocus
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="URL de la vidéo (YouTube, Vimeo, mp4…)"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setMode('closed')}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
          >
            Annuler
          </button>
          <button
            onClick={() => handleCreate(true)}
            disabled={creating || !title.trim()}
            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter la vidéo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nom de la nouvelle leçon"
        className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleCreate(false);
        }}
      />
      <button
        onClick={() => handleCreate(false)}
        disabled={creating || !title.trim()}
        className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Leçon
      </button>
      <button
        onClick={() => setMode('video')}
        className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
      >
        <Video className="h-3.5 w-3.5" /> Vidéo
      </button>
    </div>
  );
}

function QuizEditor({
  lessonId,
  hasQuiz,
  onSaved,
}: {
  lessonId: string;
  hasQuiz: boolean;
  onSaved: () => void;
}) {
  // Fetched as a coach (ADMIN/OWNER), so the GET route includes correctIndex
  // — unlike the MEMBER-facing quiz-taking view, where it's stripped.
  const { data, loading } = useApi<{ questions: QuizQuestion[] }>(`/api/lessons/${lessonId}/quiz`, {
    skip: !hasQuiz,
  });
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveQuestions = questions ??
    data?.questions ?? [{ question: '', choices: ['', ''], correctIndex: 0 }];

  function update(next: QuizQuestion[]) {
    setQuestions(next);
  }

  function addQuestion() {
    update([...effectiveQuestions, { question: '', choices: ['', ''], correctIndex: 0 }]);
  }

  function removeQuestion(qi: number) {
    update(effectiveQuestions.filter((_, i) => i !== qi));
  }

  function addChoice(qi: number) {
    update(
      effectiveQuestions.map((q, i) => (i === qi ? { ...q, choices: [...q.choices, ''] } : q)),
    );
  }

  function removeChoice(qi: number, ci: number) {
    update(
      effectiveQuestions.map((q, i) =>
        i === qi
          ? {
              ...q,
              choices: q.choices.filter((_, j) => j !== ci),
              correctIndex:
                q.correctIndex >= ci && q.correctIndex > 0 ? q.correctIndex - 1 : q.correctIndex,
            }
          : q,
      ),
    );
  }

  async function handleSave() {
    const cleaned = effectiveQuestions
      .map((q) => ({ ...q, question: q.question.trim(), choices: q.choices.map((c) => c.trim()) }))
      .filter((q) => q.question && q.choices.filter(Boolean).length >= 2);
    if (cleaned.length === 0) return;
    setSaving(true);
    try {
      await api(`/api/lessons/${lessonId}/quiz`, { method: 'PUT', body: { questions: cleaned } });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (hasQuiz && loading && !data) {
    return <p className="text-xs text-gray-500">Chargement du quiz…</p>;
  }

  return (
    <div className="space-y-3 rounded-md border border-brand-100 bg-brand-50/40 p-3">
      {effectiveQuestions.map((q, qi) => (
        <div key={qi} className="space-y-1.5 rounded-md bg-white p-2">
          <div className="flex gap-2">
            <input
              value={q.question}
              onChange={(e) =>
                update(
                  effectiveQuestions.map((x, i) =>
                    i === qi ? { ...x, question: e.target.value } : x,
                  ),
                )
              }
              placeholder={`Question ${qi + 1}`}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
            />
            <button onClick={() => removeQuestion(qi)} className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {q.choices.map((c, ci) => (
            <div key={ci} className="flex items-center gap-2 pl-3">
              <input
                type="radio"
                name={`correct-${qi}`}
                checked={q.correctIndex === ci}
                onChange={() =>
                  update(
                    effectiveQuestions.map((x, i) => (i === qi ? { ...x, correctIndex: ci } : x)),
                  )
                }
              />
              <input
                value={c}
                onChange={(e) =>
                  update(
                    effectiveQuestions.map((x, i) =>
                      i === qi
                        ? {
                            ...x,
                            choices: x.choices.map((cc, j) => (j === ci ? e.target.value : cc)),
                          }
                        : x,
                    ),
                  )
                }
                placeholder={`Choix ${ci + 1}`}
                className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
              />
              {q.choices.length > 2 && (
                <button
                  onClick={() => removeChoice(qi, ci)}
                  className="text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => addChoice(qi)}
            className="ml-3 text-xs font-medium text-brand-700 hover:underline"
          >
            + choix
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          onClick={addQuestion}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          + Question
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer le quiz'}
        </button>
      </div>
    </div>
  );
}
