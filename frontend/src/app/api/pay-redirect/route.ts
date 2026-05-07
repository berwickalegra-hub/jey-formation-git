import { NextRequest, NextResponse } from 'next/server';

/**
 * Same-domain proxy redirect for restrictive in-app browsers (TikTok,
 * Instagram, Facebook). The TikTok WebView scans query params for known
 * payment hostnames (pay.wave.com, pay.bictorys.com, etc.) and blocks
 * the request before it reaches the network. Encoding the URL in
 * Base64 + serving a 302 from our own origin sidesteps that scanner.
 *
 * Usage:
 *   GET /api/pay-redirect?u=<base64-url-encoded-payment-url>
 *
 * Security:
 *   - Only HTTPS URLs whose hostname matches the allow-list below.
 *   - Anything else returns 403/400.
 *
 * Add new payment hosts to ALLOWED_DOMAINS as you onboard providers.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_DOMAINS: readonly string[] = [
  'pay.wave.com',
  'checkout.bfrpay.com',
  'checkout.bfrpay.net',
  'pay.bfrpay.com',
  'bictorys.com', // covers pay.bictorys.com + api.test.bictorys.com
  'orange-money-prod-flowlinks.web.app',
  'sugu.orange-sonatel.com',
];

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const encoded = request.nextUrl.searchParams.get('u');
  if (!encoded) {
    return NextResponse.json({ error: 'Missing parameter' }, { status: 400 });
  }

  let url: string;
  try {
    url = atob(encoded);
  } catch {
    return NextResponse.json({ error: 'Invalid encoding' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  if (parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'HTTPS required' }, { status: 400 });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
  }

  const res = NextResponse.redirect(url, 302);
  // Defensive headers — never let this response be cached or framed.
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}
