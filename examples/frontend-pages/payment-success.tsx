// EXAMPLE — copy this into your project's app router and customize the UI freely.
// This file is NOT part of the starter — the template ships zero design.
// Delete this file or replace it with your own implementation.
/**
 * Payment success landing.
 *
 * The default `successUrl` for /api/orders is `${FRONTEND_URL}/payment/success?o=<orderId>`.
 * Replace this skeleton with your project's real receipt UI — the
 * backend already has the canonical Order record by the time we land here.
 */
interface PageProps {
  searchParams: Promise<{ o?: string }>;
}

export default async function PaymentSuccessPage({ searchParams }: PageProps) {
  const { o } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="mb-3 text-2xl font-semibold">Payment received</h1>
      <p className="mb-6 text-gray-600">Thank you — your payment was confirmed.</p>
      {o ? (
        <p className="text-sm text-gray-500">
          Reference: <code className="rounded bg-gray-100 px-2 py-1">{o}</code>
        </p>
      ) : null}
      <a
        href="/"
        className="mt-8 inline-block rounded-md border border-gray-300 px-5 py-2 text-sm font-medium hover:bg-gray-50"
      >
        Back home
      </a>
    </main>
  );
}
