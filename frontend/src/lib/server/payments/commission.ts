/**
 * Optional marketplace commission helper.
 *
 * Pure, integer-only math. Routes call this to compute the take-rate when
 * the project sets `COMMISSION_RATE_BP` (basis points: 600 = 6%, 800 = 8%).
 *
 * Invariant — `commission + net === gross` (enforced inside the helper).
 * Uses `Math.floor` on the commission, which favors the recipient.
 */

export interface CommissionResult {
  /** Smallest currency unit, integer. */
  commission: number;
  /** Smallest currency unit, integer. `gross - commission`. */
  net: number;
}

/**
 * Compute commission and net amount.
 *
 * @param gross   amount in smallest currency unit (e.g. 10000 = 10000 FCFA)
 * @param rateBp  rate in basis points: 600 = 6%, 800 = 8%, 0 = no commission
 * @returns       { commission, net } where commission + net === gross
 *
 * @throws Error if `gross` is not a non-negative integer.
 * @throws Error if `rateBp` is not an integer in 0..10000.
 */
export function computeCommission(gross: number, rateBp: number): CommissionResult {
  if (!Number.isInteger(gross) || gross < 0) {
    throw new Error(
      `computeCommission: gross must be a non-negative integer, got ${String(gross)}`,
    );
  }
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000) {
    throw new Error(
      `computeCommission: rateBp must be an integer in 0..10000, got ${String(rateBp)}`,
    );
  }

  const commission = Math.floor((gross * rateBp) / 10_000);
  const net = gross - commission;

  // Defense-in-depth — should be impossible by construction.
  if (commission + net !== gross) {
    throw new Error(
      `computeCommission invariant violated: ${commission} + ${net} !== ${gross} (rateBp=${rateBp})`,
    );
  }

  return { commission, net };
}
