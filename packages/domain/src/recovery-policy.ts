/** REC-002: the reference interval between physical reconciliation sweeps.
 * The broker runs them in-process on `setInterval` for its own lifetime
 * (broker.ts); there is no external reconcile timer unit. */
export const RECONCILE_INTERVAL_MS = 5_000;
