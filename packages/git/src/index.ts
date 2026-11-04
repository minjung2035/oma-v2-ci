import { join } from "node:path";
import { readContextEntry } from "@oma/storage/context-files";
import { contextRevisionPathAt } from "@oma/domain/paths";
import type { GitRepositoryPort } from "./repository-port.js";
/** Git workflow composition. Canonical commands are supplied through explicit ports. */
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import type { RiskTier } from "@oma/contracts/values";
import type { AuthContext, Oid, OperationId, Receipt } from "@oma/contracts";
import type { OperationOf } from "@oma/protocol/operation-codec";
import { StoreError } from "@oma/domain/errors";
import { assertNever } from "@oma/domain/exhaustive";
import { observed } from "@oma/domain/git-facts";
import type { IntegrationPolicy, IntegrationPolicyReader, IntegrationSnapshot, FrozenCheck } from "@oma/domain/integration-policy";
import type { GitLedger, GitMessaging, ReviewAuthority } from "./ports.js";
import { IntegrationCoordinator } from "./integration.js";
import { SubmitCoordinator, type SubmitInput } from "./submit.js";
import { ContextCoordinator, type ContextInput } from "./context.js";
import { publicationSources } from "@oma/domain/durable";
import { MailAttachments } from "./mail-attachments.js";
import type { MailAttachmentSource, SharedCommitReference } from "@oma/contracts/values";
export type { GitPaths } from "./paths.js";

/** Observed canonical context, not a publication capability or GOAL acceptance. */
export type ContextRecord = { readonly state: "absent"; readonly revision: null } | {
  readonly state: "published"; readonly revision: Oid; readonly operation: OperationId;
  readonly goal: Buffer; readonly goalBytes: number; readonly goalSha256: string;
};
export class GitModule {
  private readonly attachments: MailAttachments;
  private readonly integrationCoordinator: IntegrationCoordinator;
  private readonly submissionCoordinator: SubmitCoordinator;
  private readonly contextCoordinator: ContextCoordinator;
  private readonly writers = new Set<"project" | "context">();
  constructor(private readonly store: GitLedger, mail: GitMessaging, private readonly repository: GitRepositoryPort,
    integration: IntegrationPolicy | null, integrationPolicyReader: IntegrationPolicyReader | null,
    private readonly candidateCheck: ((candidate: Oid, check: FrozenCheck, cancellation: AbortSignal | undefined, authorize: () => void, attempt?: string) => Promise<void>) | null,
    reviewAuthority: ReviewAuthority) {
    this.integrationCoordinator = new IntegrationCoordinator(store, {
      ...repository.integration, runCheck: (candidate, check, signal, authorize, attempt) => this.runCheck(candidate, check, signal, authorize, attempt),
    }, integration, integrationPolicyReader, mail, reviewAuthority);
    this.submissionCoordinator = new SubmitCoordinator({ stateRoot: repository.stateRoot, society: repository.society }, store, mail,
      repository.submission, repository.submissionPublication);
    this.contextCoordinator = new ContextCoordinator({ stateRoot: repository.stateRoot, society: repository.society }, store, mail,
      repository.context, repository.contextPublication);
    this.attachments = new MailAttachments(store, repository, commits => this.sharedAttachments(commits), work => this.withWriter(work));
  }
  /** One main writer, no retained waiting chain. Busy requests have not entered
   * admission and retry the SAME key; accepted/unknown rows still form a barrier.
   */
  private async withWriter<T>(work: () => Promise<T>, repository: "project" | "context" = "project"): Promise<T> {
    if (this.writers.has(repository)) throw new StoreError("BROKER_UNAVAILABLE", "repository writer is busy; retry the same request key", { details: { reason: "busy" } });
    this.writers.add(repository);
    // Preserve the former await-previous pre-admission scheduling boundary.
    try { return await Promise.resolve().then(work); } finally { this.writers.delete(repository); }
  }

  hasCreateSource(commit: string): boolean { return this.attachments.hasCreateSource(commit); }
  stageCreateSource(...args: Parameters<MailAttachments["stageCreate"]>) { return this.attachments.stageCreate(...args); }
  finalizeCreateSource(...args: Parameters<MailAttachments["finalizeCreate"]>) { return this.attachments.finalizeCreate(...args); }
  completeCreateSource(root: string): Promise<void> { return this.attachments.complete(root); }
  stageMailAttachments(...args: Parameters<MailAttachments["stage"]>) { return this.attachments.stage(...args); }
  finalizeMailAttachments(...args: Parameters<MailAttachments["finalize"]>) { return this.attachments.finalize(...args); }
  completeMailAttachments(root: string): Promise<void> { return this.attachments.complete(root); }
  /** Shared reachability is observed, never a new publication or author fact. */
  hasSharedCommit(commit: string): boolean {
    try { this.sharedAttachments([commit]); return true; }
    catch (error) { if (error instanceof StoreError && error.code === "CANDIDATE_NOT_PUBLISHED") return false; throw error; }
  }
  sharedAttachments(commits: readonly string[]): readonly SharedCommitReference[] {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "attachment Git observations cannot run inside a transaction");
    if (commits.length === 0) return [];
    this.repository.submission.verifyObjectFormat(commits);
    const result: SharedCommitReference[] = [], known = new Map<string, SharedCommitReference>();
    let submissions: ReturnType<GitLedger["submissions"]> | undefined;
    let main: string | undefined;
    for (const commit of commits) {
      let source = known.get(commit);
      const exists = this.repository.submission.canonicalHas(commit);
      const reachable = (tip: string): boolean => tip === commit || exists && observed(this.repository.review.ancestry(commit, tip), "shared attachment ancestry");
      if (source === undefined && exists) {
        main ??= this.currentMain();
        if (reachable(main)) source = { commit, objectFormat: commit.length === 40 ? "sha1" : "sha256", publication: null,
          publishedRef: "refs/heads/main", reachableFrom: main };
      }
      if (source === undefined) {
        for (const operation of submissions ??= this.store.submissions()) {
          const tip = operation.plan.candidate;
          if (tip !== commit && (operation.state === "failed" || !exists)) continue;
          const ref = this.repository.submission.observeRef(operation.plan.publishedRef);
          if (ref.kind === "absent") {
            if (operation.state === "succeeded") throw new StoreError("STORE_CORRUPT", "completed publication lost its immutable attachment reference");
            continue;
          }
          if (operation.state === "failed" || observed(ref, "attachment reference") !== tip) throw new StoreError("STORE_CORRUPT", "immutable publication names a different attachment OID");
          if (!reachable(tip)) continue;
          source = { commit, objectFormat: commit.length === 40 ? "sha1" : "sha256", publication: operation.id, publishedRef: operation.plan.publishedRef,
            ...(tip === commit ? {} : { reachableFrom: tip }) };
          break;
        }
      }
      if (source === undefined) for (const root of this.store.attachmentRoots?.() ?? []) {
        for (const [ordinal, candidate] of publicationSources(root.plan).entries()) {
          if (!candidate.local || candidate.commit !== commit && !exists) continue;
          const ref = this.repository.submission.observeRef(candidate.publishedRef);
          if (ref.kind === "absent" && root.state !== "succeeded") continue;
          if (ref.kind === "absent") throw new StoreError("STORE_CORRUPT", "completed mail publication lost its immutable reference");
          if (observed(ref, "accepted mail attachment publication") !== candidate.commit) throw new StoreError("STORE_CORRUPT", "mail publication contains another OID");
          if (!reachable(candidate.commit)) continue;
          source = { commit, objectFormat: candidate.objectFormat, publication: root.id, publicationOrdinal: ordinal, publishedRef: candidate.publishedRef,
            ...(candidate.commit === commit ? {} : { reachableFrom: candidate.commit }) };
          break;
        }
        if (source !== undefined) break;
      }
      if (source === undefined) throw new StoreError("CANDIDATE_NOT_PUBLISHED", "attachment has no canonical-main or accepted immutable-publication reachability; local publication requires its accepted root plan");
      known.set(commit, source); result.push(source);
    }
    this.observeSharedAttachments(result);
    return result;
  }
  assertSharedAttachments(sources: readonly MailAttachmentSource[]): undefined {
    for (const source of sources) {
      if (source.objectFormat !== (source.commit.length === 40 ? "sha1" : "sha256") ||
          source.reachableFrom !== undefined && source.reachableFrom.length !== source.commit.length)
        throw new StoreError("STORE_CORRUPT", "attachment object format differs from its exact reachability anchor");
      if (source.publication === null) {
        if (source.publishedRef !== "refs/heads/main" || source.reachableFrom === undefined || source.local !== undefined || source.publicationOrdinal !== undefined)
          throw new StoreError("STORE_CORRUPT", "canonical attachment has no exact recorded main relationship");
        continue; // An observation, not a fabricated prior accepted operation.
      }
      const operation = this.store.getOperationById(source.publication), referenceCommit = source.reachableFrom ?? source.commit;
      const owned = operation && source.publicationOrdinal !== undefined ? publicationSources(operation.plan)[source.publicationOrdinal] : undefined;
      const matches = operation?.kind === "git.submit" ? operation.state !== "failed" && source.publicationOrdinal === undefined &&
        operation.plan.candidate === referenceCommit && operation.plan.publishedRef === source.publishedRef : owned?.local !== undefined &&
        owned.commit === referenceCommit && owned.objectFormat === source.objectFormat && owned.publishedRef === source.publishedRef;
      if (!matches) throw new StoreError("STORE_CORRUPT", "attachment lost its original accepted publication relationship");
    }
    return undefined;
  }
  observeSharedAttachments(sources: readonly MailAttachmentSource[]): undefined {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "attachment Git observations cannot run inside a transaction");
    this.assertSharedAttachments(sources);
    for (const source of sources) {
      const ref = this.repository.submission.observeRef(source.publishedRef), referenceCommit = source.reachableFrom ?? source.commit;
      if (source.publication === null) {
        const main = observed(ref, "canonical attachment main");
        if (main !== referenceCommit && !observed(this.repository.review.ancestry(referenceCommit, main), "recorded attachment main ancestry"))
          throw new StoreError("REF_STATE_UNKNOWN", "canonical main no longer includes the recorded attachment anchor");
      } else {
        if (ref.kind === "absent") throw new StoreError("STORE_CORRUPT", "accepted shared attachment reference disappeared");
        if (observed(ref, "shared attachment reference") !== referenceCommit)
          throw new StoreError("STORE_CORRUPT", "shared attachment reference is not its exact accepted OID");
      }
      if (!this.repository.submission.canonicalHas(source.commit)) throw new StoreError(source.publication === null ? "REF_STATE_UNKNOWN" : "STORE_CORRUPT", "shared attachment object is unavailable");
      if (source.commit !== referenceCommit && !observed(this.repository.review.ancestry(source.commit, referenceCommit), "exact attachment source ancestry"))
        throw new StoreError("REF_STATE_UNKNOWN", "attachment is not reachable from its exact recorded reference commit");
    }
    return undefined;
  }

  boundPolicy(): IntegrationSnapshot | null { return this.integrationCoordinator.boundPolicy(); }
  currentIntegrationPolicy(): IntegrationSnapshot { return this.integrationCoordinator.currentIntegrationPolicy(); }
  applyMerge(operation: OperationOf<"git.integrate">): Promise<void> { return this.integrationCoordinator.applyMerge(operation); }
  executionPhase(request: OperationId) { return this.integrationCoordinator.executionPhase(request); }
  cancelMerge(request: OperationId): void { this.integrationCoordinator.cancelMerge(request); }
  withProjectWriter<T>(work: () => Promise<T>): Promise<T> { return this.withWriter(work); }
  submit(auth: AuthContext, key: string, input: SubmitInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.submissionCoordinator.submit(auth, key, input, bytes);
  }
  integrate(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid; tier?: RiskTier }): Promise<Receipt> {
    const frozen = Object.freeze(decodeMutationPayload("git.integrate", input));
    return this.withWriter(() => this.integrationCoordinator.execute(auth, key, frozen));
  }
  isPublished(oid: Oid): boolean { return observed(this.repository.integration.published(), "published refs").includes(oid); }
  private currentMain(): Oid { return observed(this.repository.integration.main(), "canonical main ref"); }
  private runCheck(candidate: Oid, check: FrozenCheck, cancellation: AbortSignal | undefined, authorize: () => void, attempt?: string): Promise<void> {
    if (!this.candidateCheck) throw new StoreError("UNSUPPORTED_PROFILE", "trusted candidate check executor is unavailable");
    return this.candidateCheck(candidate, check, cancellation, authorize, attempt);
  }
  publishContext(auth: AuthContext, key: string, input: ContextInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.withWriter(() => this.contextCoordinator.publish(auth, key, input, bytes), "context");
  }

  /** Host record reader. Reuse canonical/snapshot verification and frozen entry
   * hashes; never treat the derived current symlink as canonical authority. */
  readContextRecord(): ContextRecord {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "context record I/O cannot run inside a transaction");
    const revision = this.repository.context.current();
    if (revision === null) return Object.freeze({ state: "absent", revision: null });
    const operation = this.store.findSucceededContext(revision);
    if (operation === null || !this.repository.snapshotReady(operation.plan))
      throw new StoreError("BROKER_UNAVAILABLE", "canonical context is not yet fully observable as a settled snapshot");
    const entry = operation.plan.entries.find(item => item.path === "GOAL.md");
    if (!entry) throw new StoreError("STORE_CORRUPT", "settled canonical context has no GOAL descriptor");
    const goal = readContextEntry(contextRevisionPathAt(join(this.repository.stateRoot, "world"), revision), entry);
    return Object.freeze({ state: "published", revision, operation: operation.id, goal, goalBytes: entry.bytes, goalSha256: entry.sha256 });
  }

  withReviewSourceRecord(base: Oid, candidate: Oid, consume: (source: import("@oma/contracts/files").ReviewSourceRecord) => undefined): void {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "review source observations cannot run inside a transaction");
    if (!this.repository.withReviewSourceRecord) throw new StoreError("BROKER_UNAVAILABLE", "recorded review source reader is unavailable");
    this.repository.withReviewSourceRecord(base, candidate, consume);
  }
  readReviewPatchRecord(diff: import("@oma/contracts/files").ReviewDiffArtifact): Buffer {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "stored review patch I/O cannot run inside a transaction");
    if (!this.repository.readDiffPatch) throw new StoreError("BROKER_UNAVAILABLE", "stored review patch reader is unavailable");
    return this.repository.readDiffPatch(diff);
  }
  readReviewDiffRecord(diff: import("@oma/contracts/files").ReviewDiffArtifact) {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "review record I/O cannot run inside a transaction");
    if (!this.repository.readDiffRecord) throw new StoreError("BROKER_UNAVAILABLE", "frozen review artifact reader is unavailable");
    return this.repository.readDiffRecord(diff);
  }
  /** CTX-006: canonical publication, snapshot/current and notification settlement
   * precede activation. This I/O must remain outside synchronous Store T.
   */
  hasCommittedContext(): boolean {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "context activation proof cannot run inside a transaction");
    for (const id of this.store.recoverableOperations()) {
      const operation = this.store.getOperationById(id);
      if (!operation) throw new StoreError("STORE_CORRUPT", "recoverable context operation disappeared");
      if (operation.kind === "context.publish") return false;
    }
    const revision = this.repository.context.current();
    if (revision === null) return false;
    const operation = this.store.findSucceededContext(revision);
    return operation !== null && this.repository.snapshotReady(operation.plan);
  }
  async reconcile(operationId: string): Promise<void> {
    const repository = this.store.getOperationById(operationId)?.kind === "context.publish" ? "context" : "project";
    return this.withWriter(async () => {
      const operation = this.store.getOperationById(operationId);
      if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) return;
      switch (operation.kind) {
        case "git.integrate": await this.integrationCoordinator.reconcile(operation); return;
        case "context.publish": await this.contextCoordinator.reconcile(operation); return;
        case "git.submit": await this.submissionCoordinator.reconcile(operation); return;
        case "society.set": case "attest.record": case "mail.send": case "agent.continue": case "mail.ack":
        case "route.follow": case "route.unfollow":
        case "agent.create": case "agent.start": case "agent.stop": return;
        default: assertNever(operation);
      }
    }, repository);
  }
  knownRefs(): { main: string; published: string[] } {
    return { main: this.currentMain(), published: [...observed(this.repository.integration.published(), "known published refs")] };
  }
}
