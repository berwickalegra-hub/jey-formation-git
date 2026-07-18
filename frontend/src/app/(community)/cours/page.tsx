'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Users } from 'lucide-react';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Card } from '@/components/community/Card';
import { ProgressBar } from '@/components/community/ProgressBar';

interface CourseItem {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  moduleCount: number;
  lessonCount: number;
  memberCount: number;
  progressPercent: number;
  firstLessonId: string | null;
}

interface CommunityResponse {
  me: { role: string } | null;
}

export default function CoursesPage() {
  const router = useRouter();
  const { data, loading } = useApi<{ items: CourseItem[] }>('/api/courses');
  const { data: community } = useApi<CommunityResponse>('/api/community');
  const canCreate = community?.me?.role === 'OWNER' || community?.me?.role === 'ADMIN';
  const items = data?.items ?? [];

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const course = await api<{ id: string }>('/api/courses', {
        method: 'POST',
        body: { title: title.trim(), description: description.trim() || undefined },
      });
      invalidateCache('/api/courses');
      router.push(`/cours/${course.id}/editer`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Formations</h1>
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">{items.length} formations</p>
          {canCreate && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            >
              <Plus className="h-4 w-4" /> Nouvelle formation
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <Card className="mt-4 space-y-3 p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre de la formation"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optionnel)"
            rows={2}
            className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={creating || !title.trim()}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {creating ? 'Création…' : 'Créer et éditer'}
            </button>
          </div>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((course) => {
          const href = course.firstLessonId ? `/cours/${course.id}/${course.firstLessonId}` : '#';
          return (
            <div key={course.id} className="relative">
              {canCreate && (
                <Link
                  href={`/cours/${course.id}/editer`}
                  className="absolute right-3 top-3 z-10 rounded-md bg-white/90 px-2.5 py-1 text-xs font-semibold text-gray-700 shadow hover:bg-white"
                >
                  Éditer
                </Link>
              )}
              <Link href={href} className={course.firstLessonId ? '' : 'pointer-events-none'}>
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div className="aspect-video bg-gray-200">
                    {course.coverImageUrl && (
                      <img
                        src={course.coverImageUrl}
                        alt={course.title}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-bold text-gray-900">{course.title}</p>
                    {course.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                        {course.description}
                      </p>
                    )}
                    <p className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                      {course.moduleCount} module{course.moduleCount > 1 ? 's' : ''} ·{' '}
                      {course.lessonCount} leçon{course.lessonCount > 1 ? 's' : ''} ·
                      <Users className="ml-1 h-3.5 w-3.5" /> {course.memberCount}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="w-9 shrink-0 text-xs font-semibold text-gray-500">
                        {course.progressPercent}%
                      </span>
                      <ProgressBar percent={course.progressPercent} />
                    </div>
                  </div>
                </Card>
              </Link>
            </div>
          );
        })}
      </div>

      {!loading && items.length === 0 && (
        <p className="mt-10 text-center text-sm text-gray-500">
          Aucune formation publiée pour l&apos;instant.
        </p>
      )}
    </div>
  );
}
