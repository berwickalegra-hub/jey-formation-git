/**
 * Generic Upstash-backed FIFO job queue with visibility timeout + retry backoff.
 *
 * Persistence model:
 *   - q:{name}                 — main queue (LPUSH on enqueue, RPOPLPUSH on claim).
 *   - q:{name}:in-flight       — list of currently-processing jobs (each carries
 *                                 a `claimedAt` timestamp). RPOPLPUSH source/dest.
 *   - q:{name}:dlq             — dead-letter list for jobs that exhausted retries.
 *
 * Visibility timeout: a claimed job sits in :in-flight until the worker
 * either acks it (success) or re-queues it (failure). If the worker
 * crashes between claim and ack, the job sits in :in-flight forever — to
 * recover, every `processNext()` first runs `recoverStaleClaims()` which
 * scans :in-flight for entries older than `visibilityMs` and re-pushes
 * them to the main queue. Single-instance and multi-instance workers
 * both benefit (a crashed worker's jobs get picked up by the next).
 *
 * Retry policy: on handler failure, attempts++ and the job is delayed via
 * a separate sorted-set with score=delayUntilMs. A `drainDue()` helper
 * promotes due delayed jobs back to the main queue (called automatically
 * by processNext). Backoff defaults to 1s, 5s, 30s, 5min, 30min.
 */
import type { Redis } from '@upstash/redis';
import { randomBytes } from 'node:crypto';

export interface QueueJob<T> {
  id: string;
  payload: T;
  attempts: number;
  enqueuedAt: number;
  /** Set by `claim()`; absent when freshly enqueued. */
  claimedAt?: number;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [
  1_000, // 1s
  5_000, // 5s
  30_000, // 30s
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
];

export interface JobQueueOptions<T> {
  redis: Redis;
  name: string;
  /** Total attempts before dead-letter (default 5). */
  maxAttempts?: number;
  /**
   * How long a claimed job has to be acked before it's considered abandoned
   * and re-queued. Default 5 min. Should comfortably exceed your handler
   * runtime; set higher for slow handlers, lower for fast ones.
   */
  visibilityMs?: number;
  /**
   * Per-attempt backoff (ms). Index `i` = delay after the i-th failure.
   * If attempts exceed the array, the last entry is used.
   */
  retryDelaysMs?: readonly number[];
  onDeadLetter?: (job: QueueJob<T>, lastError: unknown) => void | Promise<void>;
}

export class JobQueue<T> {
  private readonly redis: Redis;
  private readonly mainKey: string;
  private readonly inFlightKey: string;
  private readonly delayedKey: string;
  private readonly dlqKey: string;
  private readonly maxAttempts: number;
  private readonly visibilityMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly onDeadLetter:
    | ((job: QueueJob<T>, err: unknown) => void | Promise<void>)
    | undefined;

  constructor(options: JobQueueOptions<T>) {
    this.redis = options.redis;
    this.mainKey = `q:${options.name}`;
    this.inFlightKey = `q:${options.name}:in-flight`;
    this.delayedKey = `q:${options.name}:delayed`;
    this.dlqKey = `q:${options.name}:dlq`;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.visibilityMs = options.visibilityMs ?? 5 * 60_000;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.onDeadLetter = options.onDeadLetter;
  }

  /** Enqueue a fresh job (attempts = 0). */
  async push(payload: T): Promise<string> {
    const job: QueueJob<T> = {
      id: `job_${randomBytes(8).toString('hex')}`,
      payload,
      attempts: 0,
      enqueuedAt: Date.now(),
    };
    await this.redis.lpush(this.mainKey, JSON.stringify(job));
    return job.id;
  }

  /** Number of jobs waiting in the main queue (excludes in-flight + delayed). */
  async size(): Promise<number> {
    return (await this.redis.llen(this.mainKey)) as number;
  }

  /** Number of jobs currently in flight. */
  async inFlight(): Promise<number> {
    return (await this.redis.llen(this.inFlightKey)) as number;
  }

  /** Number of jobs currently delayed (pending retry). */
  async delayedCount(): Promise<number> {
    return (await this.redis.zcard(this.delayedKey)) as number;
  }

  /** Number of jobs in the dead-letter queue. */
  async dlqSize(): Promise<number> {
    return (await this.redis.llen(this.dlqKey)) as number;
  }

  /** Convenience for ops dashboards / tests. */
  async stats(): Promise<{ pending: number; inFlight: number; delayed: number; dlq: number }> {
    return {
      pending: await this.size(),
      inFlight: await this.inFlight(),
      delayed: await this.delayedCount(),
      dlq: await this.dlqSize(),
    };
  }

  /**
   * Re-queue any in-flight jobs whose claim has expired (worker crashed
   * before ack). Returns count recovered. Idempotent — safe to call often.
   */
  async recoverStaleClaims(): Promise<number> {
    const now = Date.now();
    const items = (await this.redis.lrange(this.inFlightKey, 0, -1)) as unknown[];
    let recovered = 0;
    for (const raw of items) {
      const job = parseJob<T>(raw);
      if (!job) {
        // Garbage entry — drop it.
        await this.redis.lrem(this.inFlightKey, 1, raw as string);
        continue;
      }
      const claimedAt = job.claimedAt ?? 0;
      if (now - claimedAt > this.visibilityMs) {
        // Atomic-ish cleanup: remove from in-flight, push back to main.
        // Concurrent workers racing on the same stale job is OK — the
        // second LREM returns 0 and the second LPUSH would duplicate, so
        // we only LPUSH if LREM actually removed it.
        const removed = (await this.redis.lrem(this.inFlightKey, 1, serializeJob(job))) as number;
        if (removed > 0) {
          // Reset claimedAt so the recovered job re-enters the queue clean.
          const recoveredJob: QueueJob<T> = { ...job };
          delete recoveredJob.claimedAt;
          await this.redis.lpush(this.mainKey, JSON.stringify(recoveredJob));
          recovered++;
        }
      }
    }
    return recovered;
  }

  /**
   * Promote any delayed jobs whose retry-delay has elapsed back to the
   * main queue. Returns count promoted.
   */
  async drainDue(): Promise<number> {
    const now = Date.now();
    // Upstash exposes ZRANGE with byScore semantics (replaces ZRANGEBYSCORE).
    const due = (await this.redis.zrange(this.delayedKey, '-inf', now, {
      byScore: true,
    })) as unknown[];
    let promoted = 0;
    for (const raw of due) {
      const removed = (await this.redis.zrem(this.delayedKey, raw as string)) as number;
      if (removed > 0) {
        await this.redis.lpush(this.mainKey, raw as string);
        promoted++;
      }
    }
    return promoted;
  }

  /**
   * Atomically claim the next job. Moves it from `mainKey` → `inFlightKey`
   * via LMOVE (the modern atomic replacement for RPOPLPUSH). Stamps
   * `claimedAt` post-move; under a worker crash the entry stays in
   * :in-flight until `recoverStaleClaims()` re-queues it.
   */
  private async claim(): Promise<QueueJob<T> | null> {
    const raw = (await this.redis.lmove(
      this.mainKey,
      this.inFlightKey,
      'right',
      'left',
    )) as unknown;
    if (raw === null || raw === undefined) return null;
    const job = parseJob<T>(raw);
    if (!job) {
      // Garbage in main queue — drop the entry from in-flight too.
      await this.redis.lrem(this.inFlightKey, 1, raw as string);
      return null;
    }
    // Stamp claimedAt by replacing the in-flight entry with one that has it.
    const stamped: QueueJob<T> = { ...job, claimedAt: Date.now() };
    const oldSerialized = serializeJob(job);
    const newSerialized = serializeJob(stamped);
    if (oldSerialized !== newSerialized) {
      const removed = (await this.redis.lrem(this.inFlightKey, 1, oldSerialized)) as number;
      if (removed > 0) {
        await this.redis.lpush(this.inFlightKey, newSerialized);
      }
    }
    return stamped;
  }

  /** Remove a job from in-flight (success path). */
  private async ack(job: QueueJob<T>): Promise<void> {
    await this.redis.lrem(this.inFlightKey, 1, serializeJob(job));
  }

  /** Schedule a delayed retry. */
  private async scheduleRetry(job: QueueJob<T>): Promise<void> {
    const delayIdx = Math.min(job.attempts - 1, this.retryDelaysMs.length - 1);
    const delay = this.retryDelaysMs[Math.max(0, delayIdx)] ?? 0;
    const dueAt = Date.now() + delay;
    const cleaned: QueueJob<T> = { ...job };
    delete cleaned.claimedAt;
    await this.redis.zadd(this.delayedKey, { score: dueAt, member: JSON.stringify(cleaned) });
  }

  /**
   * Pop one job, run it through the handler. On success: ack it. On failure:
   * increment attempts and schedule a delayed retry (or dead-letter once
   * attempts hit maxAttempts). Recovers stale claims and drains due delayed
   * jobs first. Returns true if a job was processed (success OR failure),
   * false if no work was available.
   */
  async processNext(handler: (payload: T) => Promise<void>): Promise<boolean> {
    // Cheap maintenance — both ops are bounded and only run if there's work.
    await this.recoverStaleClaims();
    await this.drainDue();

    const job = await this.claim();
    if (!job) return false;

    try {
      await handler(job.payload);
      await this.ack(job);
      return true;
    } catch (err) {
      const updated: QueueJob<T> = { ...job, attempts: job.attempts + 1 };
      // Always remove the original claim from in-flight first.
      await this.redis.lrem(this.inFlightKey, 1, serializeJob(job));

      if (updated.attempts >= this.maxAttempts) {
        await this.redis.lpush(this.dlqKey, serializeJob(updated));
        if (this.onDeadLetter) {
          await this.onDeadLetter(updated, err);
        } else {
          console.warn(
            `[JobQueue:${this.mainKey}] dropping job ${updated.id} after ${updated.attempts} attempts (no onDeadLetter handler)`,
            { lastError: err instanceof Error ? err.message : String(err) },
          );
        }
      } else {
        await this.scheduleRetry(updated);
      }
      return true;
    }
  }
}

// ── helpers ──

function serializeJob<T>(job: QueueJob<T>): string {
  return JSON.stringify(job);
}

function parseJob<T>(raw: unknown): QueueJob<T> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as QueueJob<T>; // Upstash auto-parses
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as QueueJob<T>;
  } catch {
    return null;
  }
}
