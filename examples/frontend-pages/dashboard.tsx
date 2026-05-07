// EXAMPLE — copy this into your project's app router and customize the UI freely.
// This file is NOT part of the starter — the template ships zero design.
// Delete this file or replace it with your own implementation.
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, loggingOut, logout } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-4">
        <p className="text-sm text-gray-600">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
        <p className="text-gray-500">Logged in as</p>
        <p className="font-medium">{user.email}</p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        disabled={loggingOut}
        className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </main>
  );
}
