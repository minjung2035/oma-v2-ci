/** Workflow-owned canonical repository capability; no adapter implementation imports. */
import type { Oid } from "@oma/contracts";
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { GitObservation, ChangedPath } from "@oma/contracts/git";
import type { IntegrationEffects } from "./integration.js";
import type { SubmitEffects } from "./submit.js";
import type { ContextEffects } from "./context.js";
import type { SubmissionPublication, ContextPublication } from "./ports.js";
/** Canonical repository facts and fixed publication effects exposed to app composition. */
export interface GitReviewRepository {
  verifyObjectFormat(oids: readonly Oid[]): void;
  main(): GitObservation<Oid>;
  published(): GitObservation<readonly Oid[]>;
  ancestry(base: Oid, candidate: Oid): GitObservation<boolean>;
  changedPaths(base: Oid, candidate: Oid): GitObservation<readonly ChangedPath[]>;
  gitlinks(candidate: Oid): GitObservation<readonly string[]>;
  submitters(base: Oid, candidate: Oid): readonly string[];
  mergeDiff(base: Oid, candidate: Oid, maxBytes: number): Buffer;
  prepareRevert(input: { readonly mergeBase: Oid; readonly main: Oid; readonly base: Oid; readonly message: string }): Oid;
  publishCandidateRef(ref: string, candidate: Oid): void;
}
export interface GitRepositoryPort {
  readonly stateRoot: string;
  readonly society: string;
  readonly integration: Omit<IntegrationEffects, "runCheck">;
  readonly submission: SubmitEffects;
  readonly context: ContextEffects;
  readonly review: GitReviewRepository;
  readonly submissionPublication: SubmissionPublication;
  readonly contextPublication: ContextPublication;
  snapshotReady(plan: OperationOf<"context.publish">["plan"]): boolean;
}
