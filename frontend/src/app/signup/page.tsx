'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/community/Card';

const ERROR_MESSAGES: Record<string, string> = {
  PASSWORD_BANNED: 'Ce mot de passe est trop courant — choisis-en un autre.',
  PASSWORD_TOO_SHORT: 'Le mot de passe est trop court (8 caractères minimum).',
  PASSWORD_PWNED: 'Ce mot de passe a déjà fuité ailleurs — choisis-en un autre.',
  TOO_MANY_SIGNUP_ATTEMPTS: 'Trop de tentatives. Réessaie dans quelques minutes.',
  VALIDATION_FAILED: 'Champs invalides.',
};

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/auth/signup', { method: 'POST', body: { email, password } });
      // Signup never logs in directly — an 8-char code is sent by email first.
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(ERROR_MESSAGES[err.code] ?? err.message);
      } else {
        setError('Erreur réseau. Réessaie.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
            J
          </span>
          <h1 className="text-xl font-bold text-gray-900">Rejoindre Jey-club</h1>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Mot de passe
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <span className="text-xs text-gray-500">8 caractères minimum.</span>
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {submitting ? 'Création…' : 'Créer mon compte'}
            </button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-gray-600">
          Déjà un compte ?{' '}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </main>
  );
}
