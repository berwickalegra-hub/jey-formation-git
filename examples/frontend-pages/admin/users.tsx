// EXAMPLE — copy to frontend/src/app/admin/users/page.tsx and customize.
// Demonstrates the admin list pattern: search box + cursor pagination
// against /api/admin/users. The same shape works for orders, withdrawals,
// and audit-log; just swap the endpoint + columns.
'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  emailVerifiedAt: string | null;
  createdAt: string;
}

interface ListResponse {
  items: AdminUser[];
  nextCursor: string | null;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/users?${params.toString()}`);
      setUsers((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Users</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(true);
          }}
          className="flex gap-2"
        >
          <input
            type="search"
            placeholder="Search email or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Search
          </button>
        </form>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          {error}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
            <th className="py-2">Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Verified</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 font-medium">{u.email}</td>
              <td className="text-gray-600">{u.name ?? '—'}</td>
              <td>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs ${
                    u.role === 'SUPERADMIN'
                      ? 'bg-purple-100 text-purple-800'
                      : u.role === 'ADMIN'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {u.role}
                </span>
              </td>
              <td className="text-gray-600">{u.emailVerifiedAt ? '✓' : '—'}</td>
              <td className="text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasMore && (
        <button
          onClick={() => void load(false)}
          disabled={loading}
          className="self-start rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}

      {!loading && users.length === 0 && <p className="text-sm text-gray-500">No users match.</p>}
    </div>
  );
}
