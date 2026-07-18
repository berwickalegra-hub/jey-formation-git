'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/community/Card';
import { Avatar } from '@/components/community/Avatar';
import { Badge } from '@/components/community/Badge';
import { timeAgo } from '@/lib/utils';

interface Member {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  level: number;
  xp: number;
  streakCount: number;
  role: string;
  joinedAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Coach',
  ADMIN: 'Modérateur',
  MEMBER: 'Membre',
};

export default function MembersPage() {
  const [items, setItems] = useState<Member[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async (reset: boolean, q: string, after: string | null) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (!reset && after) qs.set('cursor', after);
      const res = await api<{ items: Member[]; nextCursor: string | null }>(
        `/api/members?${qs.toString()}`,
      );
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void load(true, query, null), 250);
    return () => clearTimeout(handle);
  }, [query, load]);

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Membres</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un membre…"
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={m.name ?? 'Membre'} src={m.avatarUrl} level={m.level} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{m.name ?? 'Membre'}</p>
                <p className="text-xs text-gray-400">Membre depuis {timeAgo(m.joinedAt)}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Badge color={m.role === 'OWNER' ? 'brand' : m.role === 'ADMIN' ? 'amber' : 'gray'}>
                {ROLE_LABEL[m.role] ?? m.role}
              </Badge>
              {m.streakCount > 0 && (
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-600">
                  <Flame className="h-3.5 w-3.5" /> {m.streakCount}
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      {!loading && items.length === 0 && (
        <p className="mt-10 text-center text-sm text-gray-500">Aucun membre trouvé.</p>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => void load(false, query, cursor)}
            disabled={loading}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Chargement…' : 'Voir plus'}
          </button>
        </div>
      )}
    </div>
  );
}
