// EXAMPLE — copy to frontend/src/app/admin/layout.tsx and customize.
// This file is NOT part of the starter — the template ships zero design.
//
// Wraps every /admin/* route in a check: GET /api/admin/me returns 200
// (with the admin object) or 403 ADMIN_REQUIRED. We render a children-
// shaped stub during the round trip and redirect non-admins to /.
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

interface AdminMe {
  admin: { id: string; email: string; role: 'ADMIN' | 'SUPERADMIN' };
}

const NAV = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/withdrawals', label: 'Withdrawals' },
  { href: '/admin/audit-log', label: 'Audit log' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminMe['admin'] | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<AdminMe>('/api/admin/me');
        if (!cancelled) setAdmin(res.admin);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            router.replace('/');
          } else {
            // Unknown error — treat as access denied to fail safe.
            router.replace('/');
          }
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked || !admin) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Checking access…
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-gray-200 bg-gray-50 p-4">
        <h1 className="mb-6 text-lg font-bold">Admin</h1>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm ${
                  active ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-200'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="mt-8 text-xs text-gray-500">
          Signed in as <br />
          <span className="font-medium">{admin.email}</span>
          <br />
          <span className="text-gray-400">{admin.role}</span>
        </p>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
