'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Radio, Video } from 'lucide-react';
import { useApi, invalidateCachePrefix } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Card } from '@/components/community/Card';
import { cn } from '@/lib/utils';

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  durationMinutes: number;
  isOnline: boolean;
  meetingUrl: string | null;
  status: string;
  createdBy: { id: string; name: string | null; avatarUrl: string | null } | null;
}

interface CommunityResponse {
  me: { role: string } | null;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const [showForm, setShowForm] = useState(false);
  const key = monthKey(cursor);
  const { data, loading, refresh } = useApi<{ items: EventItem[] }>(`/api/events?month=${key}`);
  const { data: community } = useApi<CommunityResponse>('/api/community');
  const canCreate = community?.me?.role === 'OWNER' || community?.me?.role === 'ADMIN';
  const events = data?.items ?? [];

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      const k = dayKey(e.startAt);
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const firstDay = new Date(Date.UTC(year, month, 1));
    const startOffset = (firstDay.getUTCDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const todayKey = dayKey(new Date().toISOString());

    const out: { date: Date | null; key: string | null; isToday: boolean }[] = [];
    for (let i = 0; i < startOffset; i++) out.push({ date: null, key: null, isToday: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(year, month, d));
      const k = dayKey(date.toISOString());
      out.push({ date, key: k, isToday: k === todayKey });
    }
    return out;
  }, [cursor]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setCursor((c) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() - 1, 1)))
            }
            className="rounded-md p-1.5 hover:bg-gray-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="w-48 text-center text-lg font-bold capitalize text-gray-900">
            {MONTH_LABEL.format(cursor)}
          </h1>
          <button
            onClick={() =>
              setCursor((c) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1)))
            }
            className="rounded-md p-1.5 hover:bg-gray-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" /> Nouvel événement
          </button>
        )}
      </div>

      {showForm && (
        <NewEventForm
          onCreated={() => {
            setShowForm(false);
            invalidateCachePrefix('/api/events');
            void refresh();
          }}
        />
      )}

      <Card className="mt-4 overflow-hidden p-4">
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-400">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((cell, i) => (
            <div
              key={i}
              className={cn(
                'min-h-20 rounded-md border border-gray-100 p-1.5',
                cell.isToday && 'border-brand-300 bg-brand-50',
              )}
            >
              {cell.date && (
                <>
                  <p
                    className={cn(
                      'text-xs font-semibold',
                      cell.isToday ? 'text-brand-700' : 'text-gray-500',
                    )}
                  >
                    {cell.date.getUTCDate()}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {(eventsByDay.get(cell.key as string) ?? []).slice(0, 3).map((e) => (
                      <p
                        key={e.id}
                        className="truncate rounded bg-brand-100 px-1 py-0.5 text-[10px] font-medium text-brand-700"
                        title={e.title}
                      >
                        {e.title}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-500">Événements du mois</h2>
        {!loading && events.length === 0 && (
          <p className="text-sm text-gray-500">Aucun événement prévu ce mois-ci.</p>
        )}
        {events.map((e) => (
          <Card key={e.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{e.title}</p>
              <p className="text-xs text-gray-500">
                {new Date(e.startAt).toLocaleString('fr-FR', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' · '}
                {e.durationMinutes} min
              </p>
              {e.description && <p className="mt-1 text-sm text-gray-600">{e.description}</p>}
            </div>
            <div className="flex items-center gap-2">
              {e.isOnline ? (
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <Radio className="h-3 w-3" /> En ligne
                </span>
              ) : null}
              {e.meetingUrl && (
                <a
                  href={e.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800"
                >
                  <Video className="h-3.5 w-3.5" /> Rejoindre
                </a>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NewEventForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [isOnline, setIsOnline] = useState(true);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim() || !startAt) return;
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/events', {
        method: 'POST',
        body: {
          title: title.trim(),
          description: description.trim() || undefined,
          startAt: new Date(startAt).toISOString(),
          durationMinutes,
          isOnline,
          meetingUrl: meetingUrl.trim() || undefined,
        },
      });
      onCreated();
    } catch {
      setError("Impossible de créer l'événement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-4 space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre de l'événement"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <input
          type="datetime-local"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <input
          type="number"
          min={1}
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
          placeholder="Durée (minutes)"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <input
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="Lien de la visio (optionnel)"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optionnel)"
        rows={2}
        className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={isOnline}
            onChange={(e) => setIsOnline(e.target.checked)}
          />
          Événement en ligne
        </label>
        <div className="flex items-center gap-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !startAt}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? 'Création…' : "Créer l'événement"}
          </button>
        </div>
      </div>
    </Card>
  );
}
