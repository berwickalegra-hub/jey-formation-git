/**
 * EmailQueue — durable email send pipeline.
 *
 * Combines two persistence layers:
 *   1. EmailJob row (Postgres) — full payload + status (PENDING/SENT/FAILED/DEAD).
 *      Survives Redis flushes; queryable for ops dashboards.
 *   2. JobQueue (Redis list) — work-to-do pointer holding only the EmailJob id.
 *      Survives backend restart.
 *
 * `enqueue(input)` writes the row first, then pushes the id. `processNext`
 * loads the row, calls the mailer, then transitions status. Dead-letter
 * marks the row DEAD so an operator can replay it later.
 */
import type { Redis } from '@upstash/redis';
import type { PrismaClient } from '@prisma/client';
import { JobQueue, type QueueJob } from './job-queue';
import type { Mailer, SendEmailInput } from '../email';

export interface EmailJobPayload {
  emailJobId: string;
}

export interface EmailQueueOptions {
  redis: Redis;
  prisma: PrismaClient;
  mailer: Mailer;
  /** Defaults to 5. */
  maxAttempts?: number;
  /** Defaults to "email". */
  name?: string;
  /** Per-attempt backoff. Defaults to 30s, 2m, 10m, 30m, 1h. */
  retryDelaysMs?: readonly number[];
  /** Visibility timeout for stuck jobs. Default 5 min. */
  visibilityMs?: number;
}

const DEFAULT_EMAIL_RETRY_DELAYS_MS: readonly number[] = [
  30_000, // 30s
  2 * 60_000, // 2 min
  10 * 60_000, // 10 min
  30 * 60_000, // 30 min
  60 * 60_000, // 1 h
];

export class EmailQueue extends JobQueue<EmailJobPayload> {
  private readonly prisma: PrismaClient;
  private readonly mailer: Mailer;

  constructor(opts: EmailQueueOptions) {
    super({
      redis: opts.redis,
      name: opts.name ?? 'email',
      maxAttempts: opts.maxAttempts ?? 5,
      retryDelaysMs: opts.retryDelaysMs ?? DEFAULT_EMAIL_RETRY_DELAYS_MS,
      ...(opts.visibilityMs !== undefined ? { visibilityMs: opts.visibilityMs } : {}),
      onDeadLetter: async (job: QueueJob<EmailJobPayload>, lastError: unknown) => {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        try {
          await opts.prisma.emailJob.update({
            where: { id: job.payload.emailJobId },
            data: { status: 'DEAD', lastError: message },
          });
        } catch {
          // Row may have been deleted manually; swallow — already dropped from queue.
        }
      },
    });
    this.prisma = opts.prisma;
    this.mailer = opts.mailer;
  }

  /**
   * Persist the email payload + push the work pointer in one call.
   * Returns the EmailJob row id for callers that want to track status.
   */
  async enqueue(input: SendEmailInput): Promise<string> {
    const data: {
      to: string;
      subject: string;
      html: string;
      status: string;
      text?: string;
    } = {
      to: input.to,
      subject: input.subject,
      html: input.html,
      status: 'PENDING',
    };
    if (input.text !== undefined) data.text = input.text;

    const row = await this.prisma.emailJob.create({ data });
    await this.push({ emailJobId: row.id });
    return row.id;
  }

  /**
   * Drain one job from the queue. Returns true if a job was processed
   * (success OR failure), false if the queue was empty. Wrap in a loop +
   * setInterval at the call site.
   */
  async drainOne(): Promise<boolean> {
    return this.processNext(async (payload) => {
      const row = await this.prisma.emailJob.findUnique({ where: { id: payload.emailJobId } });
      if (!row) {
        // Row deleted out from under us — nothing to do; treat as success so
        // it isn't re-enqueued.
        return;
      }
      if (row.status === 'SENT' || row.status === 'DEAD') {
        // Idempotent: already terminal.
        return;
      }

      try {
        const sendInput: SendEmailInput = {
          to: row.to,
          subject: row.subject,
          html: row.html,
        };
        if (row.text !== null) sendInput.text = row.text;

        await this.mailer.send(sendInput);

        await this.prisma.emailJob.update({
          where: { id: row.id },
          data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1 },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.emailJob.update({
          where: { id: row.id },
          data: { status: 'FAILED', lastError: message, attempts: row.attempts + 1 },
        });
        // Re-throw so JobQueue increments its own attempts counter and
        // either re-enqueues or dead-letters.
        throw err;
      }
    });
  }
}
