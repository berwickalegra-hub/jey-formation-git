import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format an integer amount with regular ASCII space as thousands separator. */
export function formatPrice(amount: number, currency: string = ''): string {
  // Some locales (e.g. fr-FR) emit non-breaking spaces (U+00A0) as the
  // grouping separator; normalise any whitespace to a regular space for
  // predictable output.
  const formatted = amount.toLocaleString('fr-FR').replace(/\s/g, ' ');
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Detect in-app browsers (Facebook, Instagram, TikTok). These WebViews
 * often block redirects to native payment apps.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|TikTok|musical_ly|BytedanceWebview/i.test(ua);
}

/** Detect specifically the TikTok WebView. */
export function isTikTokBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /TikTok|musical_ly|BytedanceWebview/i.test(ua);
}
