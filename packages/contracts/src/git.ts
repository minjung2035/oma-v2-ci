/** Git observation values and the read capability used by diagnostics. No effects. */
export interface GitProcessEvidence {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
  readonly stdout: Uint8Array | null;
  readonly stderr: Uint8Array | null;
  /** The file a streamed stdout was spooled into, when the runner carries one;
   * the observation reads it back a record at a time and `dispose`s it. */
  readonly stdoutSpooledTo?: string;
  /** Releases whatever the runner staged for this evidence (the spool's
   * holding directory). Called by the observation that consumed it. */
  readonly dispose?: () => void;
}
export type GitObservation<T> =
  | { readonly kind: "present"; readonly value: T; readonly evidence: GitProcessEvidence }
  | { readonly kind: "absent"; readonly evidence: GitProcessEvidence }
  | { readonly kind: "unknown"; readonly reason: string; readonly evidence: GitProcessEvidence }
  | { readonly kind: "corrupt"; readonly reason: string; readonly evidence: GitProcessEvidence }
  /** AV-20261003-25: the observation answered, and its answer is that the
   * candidate's content is outside the grammar OMA can represent -- a
   * refusal of that candidate, never a fact about the durable store. */
  | { readonly kind: "refused"; readonly reason: string; readonly evidence: GitProcessEvidence };

export interface ChangedPath { readonly status: "A" | "M" | "D" | "T"; readonly path: string }
