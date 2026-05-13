// Default welcome page for the izi kit starter.
//
// Replace this file with your real homepage as soon as you're oriented.
// This file exists so a fresh fork shows something useful at `/` instead of a
// blank page — it's a server component that reads env at request time and
// shows which optional providers are configured.
//
// Design-swappable: uses minimal Tailwind utilities; rip the JSX out and write
// your own homepage. The starter ships no UI components by design.

export const runtime = 'nodejs';

function ConfigRow({ label, ok, hint }: { label: string; ok: boolean; hint: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5">
      <span aria-hidden className={ok ? 'text-emerald-600' : 'text-amber-500'}>
        {ok ? '✅' : '⚠️ '}
      </span>
      <span className="font-mono text-sm">{label}</span>
      <span className="text-xs text-gray-500">— {hint}</span>
    </li>
  );
}

export default function Home() {
  const env = process.env;

  const required = [
    { label: 'DATABASE_URL', ok: !!env.DATABASE_URL, hint: 'Postgres (required)' },
    { label: 'JWT_SECRET', ok: !!env.JWT_SECRET, hint: 'Auth signing key (required)' },
  ];

  const recommended = [
    { label: 'ENCRYPTION_KEY', ok: !!env.ENCRYPTION_KEY, hint: 'AES-256-GCM (recommended)' },
    { label: 'CRON_SECRET', ok: !!env.CRON_SECRET, hint: 'Vercel Cron Bearer (recommended)' },
    { label: 'DIRECT_URL', ok: !!env.DIRECT_URL, hint: 'For prisma migrate deploy' },
  ];

  const optional = [
    {
      label: 'UPSTASH_REDIS_REST_URL',
      ok: !!env.UPSTASH_REDIS_REST_URL,
      hint: 'Redis (rate limit, queue, lockout)',
    },
    {
      label: 'GOOGLE_CLIENT_ID',
      ok: !!env.GOOGLE_CLIENT_ID,
      hint: 'Sign in with Google (OAuth)',
    },
    { label: 'RESEND_API_KEY', ok: !!env.RESEND_API_KEY, hint: 'Email sender' },
    { label: 'EMAIL_FROM', ok: !!env.EMAIL_FROM, hint: 'Verified sender address' },
    { label: 'R2_ACCOUNT_ID', ok: !!env.R2_ACCOUNT_ID, hint: 'Cloudflare R2 file storage' },
    { label: 'BICTORYS_API_KEY', ok: !!env.BICTORYS_API_KEY, hint: 'Mobile money payments' },
    { label: 'SENTRY_DSN', ok: !!env.SENTRY_DSN, hint: 'Error reporting + traces' },
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans text-gray-900">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">izi kit</h1>
        <p className="mt-2 text-gray-600">
          Headless Next.js 16 starter — auth, payments, admin, webhooks, cron.
          <br />
          You&rsquo;re seeing this default page because{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">
            frontend/src/app/page.tsx
          </code>{' '}
          hasn&rsquo;t been replaced yet.
        </p>
      </header>

      {/* ─── Beginner: what to type next ───────────────────────────────── */}
      <section className="mt-10 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-lg font-semibold text-emerald-900">
          👋 New here? Open this project in Claude Code and type:
        </h2>
        <pre className="mt-3 overflow-x-auto rounded bg-white p-3 text-sm">
          Lis WORKFLOW.md et dis-moi ce que je dois faire pour démarrer mon projet.
        </pre>
        <p className="mt-2 text-sm text-emerald-900">
          (Or in English:{' '}
          <em>&ldquo;Read WORKFLOW.md and tell me what to do to start my project.&rdquo;</em>)
        </p>
        <p className="mt-3 text-sm text-emerald-900">
          The AI will read <code>WORKFLOW.md</code> + <code>CLAUDE.md</code> (both at the repo
          root), then guide you through the 4-step flow: PRD → Banani design →{' '}
          <code>/import-banani</code> → <code>/gsd-execute-phase</code>.
        </p>
      </section>

      {/* ─── Live backend probes ──────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold">Backend status</h2>
        <p className="mt-1 text-sm text-gray-600">
          Live JSON probes — open these in a new tab to confirm everything is up.
        </p>
        <ul className="mt-3 space-y-1">
          <li>
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline"
            >
              /api/health
            </a>{' '}
            <span className="text-xs text-gray-500">— liveness (always responds)</span>
          </li>
          <li>
            <a
              href="/api/readyz"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline"
            >
              /api/readyz
            </a>{' '}
            <span className="text-xs text-gray-500">
              — readiness (DB + Redis probes, 503 if either is down)
            </span>
          </li>
        </ul>
      </section>

      {/* ─── Provider configuration ───────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold">Provider configuration</h2>
        <p className="mt-1 text-sm text-gray-600">
          Read at request time from <code>process.env</code>. Optional providers are inert when
          absent — the corresponding routes 404 silently and the rest of the app keeps working.
        </p>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Required (app refuses to boot without these)
        </h3>
        <ul>
          {required.map((row) => (
            <ConfigRow key={row.label} {...row} />
          ))}
        </ul>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Recommended (app boots, but breaks at first use)
        </h3>
        <ul>
          {recommended.map((row) => (
            <ConfigRow key={row.label} {...row} />
          ))}
        </ul>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Optional providers
        </h3>
        <ul>
          {optional.map((row) => (
            <ConfigRow key={row.label} {...row} />
          ))}
        </ul>
      </section>

      {/* ─── What's shipped ───────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold">What this starter ships</h2>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm">
          <li>
            API routes under <code>/api/*</code> — auth, OAuth, admin, payments, uploads, webhooks,
            5 cron handlers
          </li>
          <li>Prisma schema + versioned migrations (Postgres / Neon)</li>
          <li>Vitest unit test suite covering the protected libs</li>
          <li>CI pipeline: format / lint / typecheck / test / build / audit</li>
          <li>
            Cloud-only by design — bring your own Postgres (Neon free tier), no local containers
          </li>
        </ul>
        <p className="mt-3 text-sm text-gray-600">
          Full architecture overview in{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">CLAUDE.md</code>; public surface in{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">README.md</code>.
        </p>
      </section>

      <footer className="mt-12 border-t border-gray-200 pt-6 text-xs text-gray-500">
        Replace this page in{' '}
        <code className="rounded bg-gray-100 px-1.5 py-0.5">frontend/src/app/page.tsx</code> when
        you&rsquo;re ready.
      </footer>
    </main>
  );
}
