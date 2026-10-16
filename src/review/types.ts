/** Internal review stage values; immutable intent is still the existing operation plan. */
import type { Actor, Address, MessagePlan, ExactCandidateIdentity, Oid, OperationId } from "../../implementation/contracts.js";
import type { ReviewFact, ReviewInput } from "../../implementation/contracts/attestation.js";
import type { OperationOf } from "../storage/operation-codec.js";
import type { PreacceptArtifact } from "../storage/preaccept-artifact.js";
import type { ResourceGate } from "../domain/admission.js";
import type { ReviewState } from "../domain/review-evaluation.js";
import type { IntegrationSnapshot } from "../git/integration-policy.js";
import type { ChangedPath, GitObservation } from "../git/observe.js";
export interface ReviewEffects {
  /** The policy the broker bound at start; null when the society has none. */
  policy(): IntegrationSnapshot | null;
  /** The host's current policy: BROKER_UNAVAILABLE when unreadable,
   * POLICY_CHANGED when its facts differ. Outside T only. */
  currentPolicy(): IntegrationSnapshot;
  verifyObjectFormat(oids: readonly Oid[]): void;
  main(): GitObservation<Oid>;
  published(): GitObservation<readonly Oid[]>;
  ancestry(base: Oid, candidate: Oid): GitObservation<boolean>;
  changedPaths(base: Oid, candidate: Oid): GitObservation<readonly ChangedPath[]>;
  /** UX-09: the candidate tree's submodule gitlinks, observed whole. `open`
   * and `challenge` refuse them synchronously so a caller gets the named
   * refusal now rather than a failed CAS receipt later. */
  gitlinks(candidate: Oid): GitObservation<readonly string[]>;
  submitters(base: Oid, candidate: Oid): readonly string[];
  /** §6: the canonical merge diff for the completion notice, as raw bytes;
   * one owner renders them for text consumers (never U+FFFD substitution).
   * Output bounded at maxBytes; LIMIT_EXCEEDED marks the request oversize. */
  mergeDiff(base: Oid, candidate: Oid, maxBytes: number): Buffer;
  /** §7: the broker's revert commit on canonical main — merge-tree against the
   * applied merge's candidate, commit-tree with the OMA identity. Throws
   * REVERT_CONFLICT (details.paths), INVALID_REQUEST when the merged change is
   * already absent, or a state error on unobservable Git. */
  prepareRevert(input: { readonly mergeBase: Oid; readonly main: Oid; readonly base: Oid;
    readonly message: string }): Oid;
  /** §7: publish the prepared revert under refs/oma/published/<actor>/<op> by
   * CAS null→oid, after the acceptance transaction. */
  publishCandidateRef(ref: string, candidate: Oid): void;

  /** §5.3: execute an accepted merge integration inside the held writer. */
  applyMerge(operation: OperationOf<"git.integrate">): Promise<void>;
  /** Stop an executing check after its cancel fact is durably accepted. */
  cancelMerge?(request: OperationId): void;
  /** Serialize project integrations, including their checks. */
  withWriter<T>(work: () => Promise<T>): Promise<T>;
  /** AV-01: the resource admission fresh advance effects (a broker-derived
   * refresh or a new integration and its completion mail) must pass. Recovery
   * callers pass their own gate instead; absent either, no hold is taken
   * (caller-record admission already covers the caller's request). */
  admitResource?: ResourceGate;
}
export interface ReviewBounds {
  readonly mailBodyBytes: number; readonly subjectBytes: number;
  /** Completion notices larger than this are never created (the request waits). */
  readonly bundleBytes: number;
}
export interface Emission {
  readonly to: readonly Address[];
  readonly kind: MessagePlan["kind"];
  readonly subject: string;
  readonly body: string;
  readonly replyHeaders: { replyTo: readonly Address[]; inReplyTo: string | null; references: readonly string[] };
  readonly approvalFor?: ExactCandidateIdentity;
  readonly audience?: "workers";
  readonly review: NonNullable<MessagePlan["review"]>;
}
export interface PreparedReview {
  readonly id: OperationId;
  readonly fact: ReviewFact;
  /** The caller input, or the frozen fact itself for broker-derived refresh. */
  readonly payload: ReviewInput | ReviewFact;
  readonly emissions: readonly Emission[];
  readonly frozen: readonly { readonly message: MessagePlan; readonly artifact: PreacceptArtifact }[];
  /** The state before and after the new fact without its own messages; null
   * for merge.open, whose concurrent check is the duplicate scan only. */
  readonly before: ReviewState | null;
  readonly after0: ReviewState;
  readonly name: string;
}
export interface OpenRequest { readonly sequence: number; readonly operation: OperationOf<"attest.record"> }
export type OpenFact = Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>;
export function isOpenFact(fact: unknown): fact is OpenFact {
  return fact !== null && typeof fact === "object" &&
    ((fact as { kind?: string }).kind === "merge.open" || (fact as { kind?: string }).kind === "challenge.open");
}
export const PRINCIPAL: Actor = "principal";
