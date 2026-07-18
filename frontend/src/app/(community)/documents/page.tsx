'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Search } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/community/Card';

interface DocumentItem {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileType: string;
  fileSizeBytes: number;
  createdAt: string;
}

interface DocumentsPage {
  items: DocumentItem[];
  nextCursor: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DocumentsPage() {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const qs = !reset && cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page = await api<DocumentsPage>(`/api/documents${qs}`);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const filtered = query
    ? items.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    : items;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="mt-1 text-sm text-gray-500">Ressources publiées par ton coach.</p>
        </div>
        <p className="text-sm text-gray-500">{items.length} documents</p>
      </div>

      <div className="relative mt-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un document..."
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((doc) => (
          <a key={doc.id} href={doc.fileUrl} target="_blank" rel="noreferrer">
            <Card className="h-full p-4 transition-shadow hover:shadow-md">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <FileText className="h-5 w-5" />
              </span>
              <p className="mt-3 font-semibold text-gray-900">{doc.title}</p>
              {doc.description && (
                <p className="mt-1 line-clamp-2 text-sm text-gray-500">{doc.description}</p>
              )}
              <p className="mt-3 text-xs text-gray-400">
                {new Date(doc.createdAt).toLocaleDateString('fr-FR')} ·{' '}
                {formatSize(doc.fileSizeBytes)}
              </p>
            </Card>
          </a>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-gray-500">
          Aucun document pour l&apos;instant.
        </p>
      )}

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={() => void load(false)}
            disabled={loading}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      )}
    </div>
  );
}
