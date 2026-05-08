// EXAMPLE — copy this into your project's app router as /auth/error/page.tsx
// and customize the UI freely. This file is NOT part of the starter.
//
// The OAuth callback (Next.js API route at /api/auth/oauth/google/callback)
// redirects here with `?error=<code>` when something goes wrong — bad state, code-exchange
// failure, unverified Google email, etc. We map the stable codes to
// friendly messages and let the user retry.
'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_invalid_request:
    'Sign-in was interrupted (missing parameters). Please try again from the login page.',
  oauth_state_mismatch:
    'Sign-in was interrupted (security check failed). This can happen if you took too long on Google’s screen — please try again.',
  oauth_code_exchange_failed: 'Google rejected the sign-in attempt. Please try again in a moment.',
  oauth_no_id_token: 'Google didn’t return your account info. Please try again.',
  oauth_id_token_invalid: 'Google’s response was malformed. Please try again or contact support.',
  oauth_email_unverified:
    'Your Google email isn’t verified. Verify it on Google first, then try again.',
};

function AuthErrorBody() {
  const params = useSearchParams();
  const code = params.get('error') ?? '';
  const message = ERROR_MESSAGES[code] ?? 'An unknown sign-in error occurred. Please try again.';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-bold">Sign-in failed</h1>
      <p className="text-sm text-gray-700">{message}</p>
      {code && <p className="text-xs font-mono text-gray-400">code: {code}</p>}
      <div className="flex flex-col gap-2">
        <Link
          href="/login"
          className="rounded-md bg-black px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-gray-800"
        >
          Back to login
        </Link>
        <Link href="/" className="text-center text-sm text-gray-600 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorBody />
    </Suspense>
  );
}
