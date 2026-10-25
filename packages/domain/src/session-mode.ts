/** A session's execution mode is fixed at birth, not a live permission toggle. */
export type SessionMode = "society" | "personal";
export function isSessionMode(value: unknown): value is SessionMode {
  return value === "society" || value === "personal";
}
