/**
 * Magic-byte sniffer for the binary file types the uploader allows by default.
 *
 * Multer trusts the client-supplied `Content-Type` header — fine for honest
 * users, useless against an attacker who renames `evil.exe` to `cute.jpg`
 * with `Content-Type: image/jpeg`. We additionally inspect the first bytes
 * of the buffer to verify the declared MIME matches the actual format.
 *
 * Coverage is intentional: only formats we know how to verify, all binary,
 * and all conservative on the XSS surface. Text-ish formats (svg, html,
 * csv, json) are *not* covered here — if you allow those via
 * UPLOAD_ALLOWED_MIME, sniffing is skipped for those entries (we log a
 * warning at boot) and you assume the XSS risk yourself.
 */

const SNIFFERS: Record<string, (buf: Buffer) => boolean> = {
  // FF D8 FF
  'image/jpeg': (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,

  // 89 50 4E 47 0D 0A 1A 0A
  'image/png': (buf) =>
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a,

  // "RIFF" .. "WEBP"
  'image/webp': (buf) =>
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP',

  // GIF87a or GIF89a
  'image/gif': (buf) =>
    buf.length >= 6 &&
    buf.toString('ascii', 0, 4) === 'GIF8' &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61,

  // %PDF
  'application/pdf': (buf) => buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF',
};

/** Returns true when sniffer for this mime exists. */
export function hasMagicSniffer(mimeType: string): boolean {
  return mimeType in SNIFFERS;
}

/**
 * Verify the buffer's leading bytes match the declared MIME.
 *
 * Returns:
 *   - { match: true, sniffed: true } — the type is binary and bytes match.
 *   - { match: true, sniffed: false } — no sniffer for this MIME (you've
 *     allowed a type we don't verify, e.g. text/csv). Caller should still
 *     accept but knows the bytes weren't checked.
 *   - { match: false, sniffed: true } — type is binary and bytes mismatch.
 *     Reject the upload.
 */
export function verifyMagicBytes(
  buf: Buffer,
  mimeType: string,
): { match: boolean; sniffed: boolean } {
  const fn = SNIFFERS[mimeType];
  if (!fn) return { match: true, sniffed: false };
  return { match: fn(buf), sniffed: true };
}
