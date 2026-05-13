import path from 'node:path';

const MAX_BASENAME_LENGTH = 200;
const STRIP_CHARS = /[^a-zA-Z0-9À-ÿ _\-().]/g;

export function sanitizeFilename(name: string): string {
  const ext = path.extname(name);
  const base = path
    .basename(name, ext)
    .replace(STRIP_CHARS, '')
    .trim()
    .slice(0, MAX_BASENAME_LENGTH);
  return (base || 'file') + ext.toLowerCase();
}
