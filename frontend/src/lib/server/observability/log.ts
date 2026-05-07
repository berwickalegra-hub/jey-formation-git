// Source: composed from D-13 + the existing createLogger signature in
// frontend/src/lib/server/logger.ts (read-only here; not modified).
import 'server-only';
import {
  createLogger,
  type CreateLoggerOptions,
  type Logger,
} from '@/lib/server/logger';
import { getRequestId } from './request-context';

/**
 * Wraps the existing logger so every log line picks up the current request ID
 * from AsyncLocalStorage. The base logger is created lazily so callers can
 * still pass options if they want a non-default config.
 *
 * The wrapper does NOT bypass the base logger's redaction step — it merely
 * adds a `requestId` field to the ctx object before delegating.
 */
export function createRequestLogger(options: CreateLoggerOptions = {}): Logger {
  const base = createLogger(options);
  function decorate(
    ctx?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const requestId = getRequestId();
    if (!requestId) return ctx;
    return { ...(ctx ?? {}), requestId };
  }
  return {
    debug: (msg, ctx) => base.debug(msg, decorate(ctx)),
    info: (msg, ctx) => base.info(msg, decorate(ctx)),
    warn: (msg, ctx) => base.warn(msg, decorate(ctx)),
    error: (msg, ctx) => base.error(msg, decorate(ctx)),
  };
}

/** Default singleton — most call sites use this. */
export const log: Logger = createRequestLogger();
