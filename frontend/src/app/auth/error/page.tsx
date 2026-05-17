// /auth/error — landing page for OAuth callback failures.
//
// The callback (frontend/src/app/api/auth/oauth/google/callback/route.ts)
// builds redirects via `redirectToAuthError(code)` in
// frontend/src/lib/server/oauth/error-redirect.ts. That helper hard-codes
// `/auth/error?code=<CODE>` with five UPPERCASE codes (D-06 contract):
//   GOOGLE_EMAIL_NOT_VERIFIED
//   OAUTH_STATE_MISMATCH
//   OAUTH_CODE_EXCHANGE_FAILED
//   OAUTH_PROVIDER_DISABLED
//   OAUTH_GENERIC
//
// Unknown / missing codes fall back to a generic message.
'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const ERROR_MESSAGES: Record<string, string> = {
  GOOGLE_EMAIL_NOT_VERIFIED:
    "Votre adresse Google n'est pas vérifiée. Vérifiez-la sur votre compte Google, puis réessayez.",
  OAUTH_STATE_MISMATCH:
    'La connexion a été interrompue (vérification de sécurité). Cela peut arriver si la page Google est restée ouverte trop longtemps — réessayez.',
  OAUTH_CODE_EXCHANGE_FAILED: 'Google a refusé la connexion. Réessayez dans un instant.',
  OAUTH_PROVIDER_DISABLED:
    'La connexion via Google n’est pas activée sur ce serveur. Contactez le support.',
  OAUTH_GENERIC: 'Une erreur inattendue est survenue pendant la connexion. Réessayez.',
};

function AuthErrorBody() {
  const params = useSearchParams();
  const code = params.get('code') ?? params.get('error') ?? '';
  const normalized = code.toUpperCase();
  const message =
    ERROR_MESSAGES[normalized] ??
    'Une erreur inconnue est survenue pendant la connexion. Réessayez.';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-bold">Échec de connexion</h1>
      <p className="text-sm text-gray-700">{message}</p>
      {code && <p className="font-mono text-xs text-gray-400">code: {code}</p>}
      <div className="flex flex-col gap-2">
        <Link
          href="/login"
          className="rounded-md bg-black px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-gray-800"
        >
          Retour à la connexion
        </Link>
        <Link href="/" className="text-center text-sm text-gray-600 underline">
          Accueil
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
