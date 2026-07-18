/**
 * Notification templates.
 *
 * Each project defines its own typed wrappers around `createNotification`.
 * The example below ships with the template — adapt it, replace it, or add
 * more (e.g. `firePaymentReceived`, `fireExportReady`). The pattern:
 *
 *   1. Build a `CreateNotificationInput` with a *deterministic* dedupeKey
 *      so the unique constraint enforces at-most-once delivery for that
 *      logical event (e.g. `payment-received:${orderId}` — never include
 *      a timestamp or random suffix).
 *   2. Pass the input + your PrismaClient to `createNotification`.
 *   3. Optionally enqueue an email via `EmailQueue.enqueue` — but ONLY
 *      after the notification row is created, so a duplicate event never
 *      sends a duplicate email.
 *
 * Keep these helpers free of side effects beyond the row insert; the
 * email enqueue belongs at the call site so each project can pick the
 * right channel (no email vs. transactional vs. marketing).
 */

import type { CreateNotificationInput } from './index';

export function welcomeNotification(userId: string, email: string): CreateNotificationInput {
  return {
    userId,
    type: 'WELCOME',
    title: 'Welcome!',
    body: `Glad to have you on board, ${email}.`,
    dedupeKey: `welcome:${userId}`,
  };
}

/**
 * Example: notification dispatched after a successful payment.
 * Called from the Bictorys webhook handler's `onPaid` post-commit hook.
 */
export function paymentReceived(
  userId: string,
  orderId: string,
  amount: number,
  currency: string,
): CreateNotificationInput {
  return {
    userId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment received',
    body: `Order ${orderId} for ${amount} ${currency} confirmed.`,
    data: { orderId, amount, currency },
    dedupeKey: `payment-received:${orderId}`,
  };
}

/** Club feed: someone commented on the recipient's post. */
export function newPostComment(
  postAuthorId: string,
  postId: string,
  commentId: string,
  commenterName: string,
): CreateNotificationInput {
  return {
    userId: postAuthorId,
    type: 'NEW_POST_COMMENT',
    title: 'Nouveau commentaire',
    body: `${commenterName} a commenté ta publication.`,
    data: { postId, commentId },
    dedupeKey: `new-post-comment:${commentId}`,
  };
}

/** Club feed: someone liked the recipient's post (deduped per liker+post). */
export function newPostLike(
  postAuthorId: string,
  postId: string,
  likerId: string,
): CreateNotificationInput {
  return {
    userId: postAuthorId,
    type: 'NEW_POST_LIKE',
    title: 'Nouveau j’aime',
    body: 'Quelqu’un a aimé ta publication.',
    data: { postId, likerId },
    dedupeKey: `new-post-like:${postId}:${likerId}`,
  };
}
