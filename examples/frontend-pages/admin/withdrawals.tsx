// EXAMPLE — copy to frontend/src/app/admin/withdrawals/page.tsx and customize.
// Demonstrates a list with filters + a per-row admin mutation (cancel),
// plus the audit-log surface — every cancel goes through the server's
// logAdminAction so /admin/audit-log keeps a trace.
'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface Withdrawal {
  id: string;
  amount: number;
  currency: string;
  status: Status;
  provider: string;
  failureReason: string | null;
  requestedAt: string;
  user: { id: string; email: string };
}

interface ListResponse {
  items: Withdrawal[];
  nextCursor: string | null;
}

const STATUSES: Status[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];

export default function AdminWithdrawalsPage() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState<Status | ''>('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const res = await api<ListResponse>(`/api/admin/withdrawals?${params.toString()}`);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unknown error');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function cancel(id: string) {
    const reason = window.prompt('Cancel reason (audited):');
    if (!reason) return;
    try {
      await api(`/api/admin/withdrawals/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Withdrawals</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          {error}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
            <th className="py-2">User</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Requested</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 font-medium">{w.user.email}</td>
              <td>
                {w.amount.toLocaleString()} {w.currency}
              </td>
              <td>{w.status}</td>
              <td className="text-gray-500">{new Date(w.requestedAt).toLocaleString()}</td>
              <td>
                {(w.status === 'PENDING' || w.status === 'PROCESSING' || w.status === 'FAILED') && (
                  <button
                    onClick={() => void cancel(w.id)}
                    className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {items.length === 0 && <p className="text-sm text-gray-500">No withdrawals match.</p>}
    </div>
  );
}
