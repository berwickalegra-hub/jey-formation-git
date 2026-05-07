// EXAMPLE — copy this into your project's app router and customize the UI freely.
// This file is NOT part of the starter — the template ships zero design.
// Delete this file or replace it with your own implementation.
//
// /forgot-password is enumeration-resistant: backend always returns
// "If this account exists, a reset code has been sent" regardless of
// whether the email is registered. UI mirrors that — show the same
// confirmation screen on success either way.
'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_RESET_REQUESTS') {
        setError('Too many reset requests for this email. Try again in an hour.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-sm text-gray-600">
          If an account exists for <strong>{email}</strong>, you&apos;ll receive a reset code in the
          next minute.
        </p>
        <p className="text-sm text-gray-600">
          <Link href="/reset-password" className="underline">
            Already have your code?
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-bold">Forgot your password?</h1>
      <p className="text-sm text-gray-600">
        Enter your email and we&apos;ll send a code to reset your password.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send reset code'}
        </button>
      </form>
      <p className="text-sm text-gray-600">
        Remembered it?{' '}
        <Link href="/login" className="underline">
          Log in
        </Link>
        .
      </p>
    </main>
  );
}
