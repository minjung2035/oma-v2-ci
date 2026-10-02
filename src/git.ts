import { observed } from "./git/observe.js";
// GIT/INT/CTX: composition and fixed repository observation boundaries.
// Coordinators own intent/effect ordering; no candidate gate is relaxed here.
import { decodeMutationPayload } from "./protocol/request-codec.js";
import type { RiskTier } from "../implementation/contracts/values.js";
import { AttestationModule } from "./attestation.js";
import type { AuthContext, ContextEntry, Oid, Receipt } from "../implementation/contracts.js";
import { Store } from "./store.js";
import type { OperationOf } from "./storage/operation-codec.js";
import { StoreError } from "./domain/errors.js";
import { assertNever } from "./domain/exhaustive.js";
import { MailModule } from "./mail.js";
import { isValidFullOid } from "./ids.js";
import type { GitObservation, RefAfterCas } from "./git/observe.js";
import { createCanonicalObserver, compareAndSwapCanonicalRef, authorizeCanonicalNoop, canonicalMergeDiff } from "./git/canonical-command.js";
import { IntegrationCoordinator } from "./git/integration.js";
import { ReviewModule, type ReviewBounds } from "./review.js";
import { SubmitCoordinator, type SubmitInput } from "./git/submit.js";
import { GitPublicationObserver } from "./git/publication.js";
import { QuarantineImporter } from "./git/quarantine.js";
import { ContextCoordinator, type ContextInput } from "./git/context.js";
import { ContextRepository } from "./git/context-repository.js";
import { ContextPublicationObserver, type ContextPublicationEvidence } from "./git/context-publication.js";
import type { GitPaths } from "./git/paths.js";
import type { IntegrationPolicy, IntegrationPolicyReader, FrozenCheck } from "./git/integration-policy.js";
import { GIT_ENV } from "./process/policies.js";
export type { GitPaths, CheckProfile } from "./git/paths.js";
export type { IntegrationPolicy } from "./git/integration-policy.js";
export type PolicyRevisionReader = IntegrationPolicyReader;
export const gitEnv = GIT_ENV;

export class GitModule {
  readonly attestations: AttestationModule;
  readonly reviews: ReviewModule;
  private readonly integrationCoordinator: IntegrationCoordinator;
  private readonly submissionCoordinator: SubmitCoordinator;
  private readonly contextCoordinator: ContextCoordinator;
  private readonly contextRepository: ContextRepository;
  private readonly quarantine: QuarantineImporter;
  private writerActive = false;
  private readonly observations = createCanonicalObserver();
  constructor(
    private readonly paths: GitPaths, private readonly store: Store, mail: MailModule,
    integration: IntegrationPolicy | null = null, policyRevisionReader: PolicyRevisionReader | null = null,
    private readonly candidateCheck: ((candidate: Oid, check: FrozenCheck) => Promise<void>) | null = null,
    reviewBounds: ReviewBounds = { mailBodyBytes: 256 * 1024, subjectBytes: 512, bundleBytes: 256 * 1024 * 1024 },
  ) {
    this.store.bindRepositoryIdentity({ society: paths.society });
    this.integrationCoordinator = new IntegrationCoordinator(store, {
      verifyObjectFormat: oids => { this.objectFormat(paths.projectGit, oids); },
      main: () => this.observations.ref(paths.projectGit, "refs/heads/main"),
      published: () => this.observations.published(paths.projectGit),
      ancestry: (base, candidate) => this.observations.ancestry(paths.projectGit, base, candidate),
      changedPaths: (base, candidate) => this.observations.changedPaths(paths.projectGit, base, candidate),
      compareAndSwap: (base, candidate) => this.casRef(paths.projectGit, "refs/heads/main", candidate, base),
      runCheck: (candidate, check) => this.runCheck(candidate, check),
      noopWitness: ref => this.observations.ref(paths.projectGit, ref),
      authorizeNoop: (ref, candidate) => authorizeCanonicalNoop(this.observations, paths.projectGit, ref, candidate),
      submitters: (base, candidate) => this.submitters(base, candidate),
    }, integration, policyRevisionReader, mail,
      // The reviews field is assigned below; the gate is only invoked by
      // applyMerge, long after construction completes.
      request => this.reviews.assertApplicable(request));
    this.reviews = new ReviewModule(store, mail, {
      policy: () => this.integrationCoordinator.boundPolicy(),
      currentPolicy: () => this.integrationCoordinator.currentIntegrationPolicy(),
      verifyObjectFormat: oids => { this.objectFormat(paths.projectGit, oids); },
      main: () => this.observations.ref(paths.projectGit, "refs/heads/main"),
      published: () => this.observations.published(paths.projectGit),
      ancestry: (base, candidate) => this.observations.ancestry(paths.projectGit, base, candidate),
      changedPaths: (base, candidate) => this.observations.changedPaths(paths.projectGit, base, candidate),
      submitters: (base, candidate) => this.submitters(base, candidate),
      mergeDiff: (base, candidate, maxBytes) => canonicalMergeDiff(paths.projectGit, base, candidate, maxBytes),
      applyMerge: operation => this.integrationCoordinator.applyMerge(operation),
      withWriter: work => this.withWriter(work),
    }, reviewBounds, paths.society);
    this.attestations = new AttestationModule(store, mail, { exact: identity => this.integrationCoordinator.assertReviewIdentity(identity),
      principal: () => this.integrationCoordinator.assertPrincipalDelegated() },
      { mode: () => this.integrationCoordinator.boundPolicy()?.tiered?.review === "mail-v1",
        record: (a, k, i) => this.reviews.record(a, k, i) });
    this.quarantine = new QuarantineImporter(paths, candidate => this.canonicalHas(candidate));
    this.submissionCoordinator = new SubmitCoordinator(paths, store, mail, {
      verifyObjectFormat: oids => { this.objectFormat(paths.projectGit, oids); },
      canonicalHas: candidate => this.canonicalHas(candidate),
      quarantineImport: (fd, candidate, exportRef, prerequisites) => this.quarantineImport(fd, candidate, exportRef, prerequisites),
      publishRef: (ref, candidate) => this.publishRef(ref, candidate),
      observeRef: ref => this.observations.ref(paths.projectGit, ref),
    }, new GitPublicationObserver(this.observations, paths.projectGit));
    this.contextRepository = new ContextRepository(paths, this.observations);
    this.contextCoordinator = new ContextCoordinator(paths, store, mail, {
      current: () => this.currentContext(),
      observedObjectFormat: () => this.contextRepository.observedObjectFormat(),
      prepareCandidate: (tree, entries, expected) => this.prepareContextCandidate(tree, entries, expected),
      assertGoalOnly: (candidate, expected) => this.contextRepository.assertGoalOnly(candidate, expected),
      preparationQuiescent: tree => this.contextRepository.preparationQuiescent(tree),
      ensureCandidate: operation => this.contextRepository.ensureCandidate(operation),
      compareAndSwap: (base, candidate) => this.casRef(paths.contextGit, "refs/heads/main", candidate, base),
      publishSnapshot: (operation, proof) => this.publishContextSnapshot(operation, proof),
    }, new ContextPublicationObserver(this.observations, paths.contextGit));
  }
  /** One main writer, no retained waiting chain. Busy requests have not entered
   * admission and retry the SAME key; accepted/unknown rows still form a barrier.
   */
  private async withWriter<T>(work: () => Promise<T>): Promise<T> {
    if (this.writerActive) throw new StoreError("BROKER_UNAVAILABLE", "repository writer is busy; retry the same request key", { details: { reason: "busy" } });
    this.writerActive = true;
    // Preserve the former await-previous pre-admission scheduling boundary.
    try { return await Promise.resolve().then(work); } finally { this.writerActive = false; }
  }
  private objectFormat(repo: string, oids: readonly string[] = []): "sha1" | "sha256" {
    const format = observed(this.observations.objectFormat(repo), "repository object format");
    if (oids.some(oid => !isValidFullOid(oid) || oid.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", `OID does not match repository object format ${format}`);
    return format;
  }
  private casRef(repository: string, ref: string, candidate: string, expected: string | null): RefAfterCas {
    return compareAndSwapCanonicalRef(this.observations, repository, ref, candidate, expected);
  }
  submit(auth: AuthContext, key: string, input: SubmitInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.submissionCoordinator.submit(auth, key, input, bytes);
  }
  private submitters(base: Oid, candidate: Oid): readonly string[] {
    const changed = new Set(observed(this.observations.commits(this.paths.projectGit, base, candidate), "candidate commit range"));
    const actors = new Set<string>();
    for (const submission of this.store.operations.submissions()) {
      if (submission.state === "failed") continue;
      const ref = this.observations.ref(this.paths.projectGit, submission.plan.publishedRef);
      if (ref.kind === "absent" && submission.state !== "succeeded") continue;
      if (observed(ref, "authenticated submission ref") !== submission.plan.candidate)
        throw new StoreError("STORE_CORRUPT", "published submission changed identity");
      const contributed = observed(this.observations.commits(this.paths.projectGit, base, submission.plan.candidate), "submitted commit range");
      if (submission.plan.candidate === candidate || contributed.some(commit => changed.has(commit))) actors.add(submission.actor);
    }
    return [...actors].sort();
  }
  private canonicalHas(oid: string): boolean {
    const value = this.observations.commit(this.paths.projectGit, oid);
    return value.kind === "absent" ? false : observed(value, "canonical commit");
  }
  private quarantineImport(bundleFd: number, candidate: Oid, exportRef: string, prerequisites: readonly Oid[]): Promise<void> {
    return this.quarantine.importBundle(bundleFd, candidate, exportRef, prerequisites);
  }
  private publishRef(ref: string, candidate: Oid): void {
    const current = this.observations.ref(this.paths.projectGit, ref);
    if (current.kind === "present") {
      if (current.value !== candidate) throw new StoreError("PUBLISHED_REF_CONFLICT", `ref ${ref} already points elsewhere`);
      return;
    }
    if (current.kind !== "absent") observed(current, `published ref ${ref}`);
    const after = this.casRef(this.paths.projectGit, ref, candidate, null);
    if (after.kind === "candidate") return;
    if (after.kind === "third" && after.oid !== null) throw new StoreError("PUBLISHED_REF_CONFLICT", `CAS publish found another value for ${ref}`);
    throw new StoreError("REF_STATE_UNKNOWN", `published ref ${ref} is not proven after CAS`);
  }
  integrate(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid; tier?: RiskTier }): Promise<Receipt> {
    const frozen = Object.freeze(decodeMutationPayload("git.integrate", input));
    return this.withWriter(() => this.integrationCoordinator.execute(auth, key, frozen));
  }
  isPublished(oid: Oid): boolean { return observed(this.observations.published(this.paths.projectGit), "published refs").includes(oid); }
  private currentMain(): Oid { return observed(this.observations.ref(this.paths.projectGit, "refs/heads/main"), "canonical main ref"); }
  private runCheck(candidate: Oid, check: FrozenCheck): Promise<void> {
    if (!this.candidateCheck) throw new StoreError("UNSUPPORTED_PROFILE", "trusted candidate check executor is unavailable");
    return this.candidateCheck(candidate, check);
  }
  publishContext(auth: AuthContext, key: string, input: ContextInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.withWriter(() => this.contextCoordinator.publish(auth, key, input, bytes));
  }
  private currentContext(): Oid | null { return this.contextRepository.current(); }
  private prepareContextCandidate(tree: string, entries: ContextEntry[], expected: Oid | null): Oid | Promise<Oid> {
    return this.contextRepository.prepareCandidate(tree, entries, expected);
  }
  private publishContextSnapshot(operation: OperationOf<"context.publish">, proof: ContextPublicationEvidence): void {
    this.contextRepository.publishSnapshot(operation, proof);
  }
  private reconcileContext(operation: OperationOf<"context.publish">): Promise<void> { return this.contextCoordinator.reconcile(operation); }

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
    const revision = this.currentContext();
    if (revision === null) return false;
    const operation = this.store.findSucceededContext(revision);
    return operation !== null && this.contextRepository.snapshotReady(operation.plan);
  }
  reconcile(operationId: string): Promise<void> {
    return this.withWriter(async () => {
      const operation = this.store.getOperationById(operationId);
      if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) return;
      switch (operation.kind) {
        case "git.integrate": await this.integrationCoordinator.reconcile(operation); return;
        case "context.publish": await this.reconcileContext(operation); return;
        case "git.submit": await this.submissionCoordinator.reconcile(operation); return;
        case "society.set": case "attest.record": case "mail.send": case "agent.continue": case "mail.ack":
        case "route.follow": case "route.unfollow":
        case "agent.create": case "agent.start": case "agent.stop": return;
        default: assertNever(operation);
      }
    });
  }
  knownRefs(): { main: string; published: string[] } {
    return { main: this.currentMain(), published: [...observed(this.observations.published(this.paths.projectGit), "known published refs")] };
  }
}
