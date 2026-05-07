const DEFAULT_RESERVED = new Set([
  'api',
  'admin',
  'login',
  'signup',
  'logout',
  'app',
  'dashboard',
  'me',
  'auth',
  'static',
  'public',
  'assets',
  '_next',
]);

const DEFAULT_MAX_ATTEMPTS = 50;
const DEFAULT_MAX_LENGTH = 64;

export interface SlugifyOptions {
  maxLength?: number;
}

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/-+$/g, '');
}

export interface EnsureUniqueSlugOptions {
  reserved?: readonly string[];
  isCollision?: (err: unknown) => boolean;
  maxAttempts?: number;
}

function defaultIsCollision(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; message?: string };
  if (e.code === 'P2002') return true;
  return /unique/i.test(e.message ?? '');
}

export async function ensureUniqueSlug<T>(
  base: string,
  create: (slug: string) => Promise<T>,
  options: EnsureUniqueSlugOptions = {},
): Promise<string> {
  const reserved = new Set(
    [...DEFAULT_RESERVED, ...(options.reserved ?? [])].map((s) => s.toLowerCase()),
  );
  const isCollision = options.isCollision ?? defaultIsCollision;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let attempt = 1;
  let candidate = reserved.has(base.toLowerCase()) ? `${base}-2` : base;
  if (reserved.has(base.toLowerCase())) attempt = 2;

  while (attempt <= maxAttempts) {
    try {
      await create(candidate);
      return candidate;
    } catch (err) {
      if (!isCollision(err)) throw err;
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }
  }
  throw new Error(`ensureUniqueSlug: exceeded maxAttempts (${maxAttempts}) for base="${base}"`);
}
