// GIT/INT/CTX: composition and fixed repository observation boundaries.
// Coordinators own intent/effect ordering; no candidate gate is relaxed here.
import type { AuthContext, ContextEntry, Oid, Receipt } from "../implementation/contracts.js";
import { Store } from "./store.js";
import type { OperationOf } from "./storage/operation-codec.js";
import { StoreError } from "./domain/errors.js";
import { MailModule } from "./mail.js";
import { isValidFullOid } from "./ids.js";
import type { GitObservation, RefAfterCas } from "./git/observe.js";
import { createCanonicalObserver, compareAndSwapCanonicalRef } from "./git/canonical-command.js";
import { repairContextMirror } from "./git/context-mirror.js";
import { IntegrationCoordinator } from "./git/integration.js";
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
function observed<T>(observation: GitObservation<T>, what: string): T {
  if (observation.kind === "present") return observation.value;
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", `${what}: ${observation.kind}`);
}

export class GitModule {
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
    }, integration, policyRevisionReader);
    this.quarantine = new QuarantineImporter(paths, candidate => this.canonicalHas(candidate));
    this.submissionCoordinator = new SubmitCoordinator(paths, store, mail, {
      verifyObjectFormat: oids => { this.objectFormat(paths.projectGit, oids); },
      canonicalHas: candidate => this.canonicalHas(candidate),
      quarantineImport: (path, candidate, exportRef, prerequisites) => this.quarantineImport(path, candidate, exportRef, prerequisites),
      publishRef: (ref, candidate) => this.publishRef(ref, candidate),
      observeRef: ref => this.observations.ref(paths.projectGit, ref),
    }, new GitPublicationObserver(this.observations, paths.projectGit));
    this.contextRepository = new ContextRepository(paths, this.observations);
    this.contextCoordinator = new ContextCoordinator(paths, store, mail, {
      current: () => this.currentContext(),
      prepareCandidate: (tree, entries, expected) => this.prepareContextCandidate(tree, entries, expected),
      ensureCandidate: operation => this.contextRepository.ensureCandidate(operation),
      compareAndSwap: (base, candidate) => this.casRef(paths.contextGit, "refs/heads/main", candidate, base),
      publishSnapshot: (operation, proof) => this.publishContextSnapshot(operation, proof),
    }, new ContextPublicationObserver(this.observations, paths.contextGit));
  }
  /** Preserve one main writer, without retaining an unbounded promise chain.
   * Busy callers have not entered admission and can retry the SAME request key.
   * Accepted/unknown rows remain the coordinators' independent durable barrier.
   */
  private async withWriter<T>(work: () => Promise<T>): Promise<T> {
    if (this.writerActive) throw new StoreError("BROKER_UNAVAILABLE", "repository writer is busy; retry the same request key");
    this.writerActive = true;
    try { return await work(); } finally { this.writerActive = false; }
  }
  private objectFormat(repo: string, oids: readonly string[] = []): "sha1" | "sha256" {
    const format = observed(this.observations.objectFormat(repo), "repository object format");
    if (oids.some(oid => !isValidFullOid(oid) || oid.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", `OID does not match repository object format ${format}`);
    return format;
  }
  /** Every CAS, including exit zero, gets a NEW canonical observation. */
  private casRef(repository: string, ref: string, candidate: string, expected: string | null): RefAfterCas {
    return compareAndSwapCanonicalRef(this.observations, repository, ref, candidate, expected);
  }
  submit(auth: AuthContext, key: string, input: SubmitInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.submissionCoordinator.submit(auth, key, input, bytes);
  }
  private canonicalHas(oid: string): boolean {
    const value = this.observations.commit(this.paths.projectGit, oid);
    return value.kind === "absent" ? false : observed(value, "canonical commit");
  }
  private quarantineImport(bundlePath: string, candidate: Oid, exportRef: string, prerequisites: readonly Oid[]): Promise<void> {
    return this.quarantine.importBundle(bundlePath, candidate, exportRef, prerequisites);
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
  integrate(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid }): Promise<Receipt> {
    return this.withWriter(() => this.integrationCoordinator.execute(auth, key, input));
  }
  isPublished(oid: Oid): boolean { return observed(this.observations.published(this.paths.projectGit), "published refs").includes(oid); }
  private currentMain(): Oid { return observed(this.observations.ref(this.paths.projectGit, "refs/heads/main"), "canonical main ref"); }
  private async runCheck(_candidate: Oid, _check: FrozenCheck): Promise<void> {
    throw new StoreError("SPIKE_UNRESOLVED", "S-01-CANDIDATE bounded writable work area is not verified");
  }
  publishContext(auth: AuthContext, key: string, input: ContextInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.withWriter(() => this.contextCoordinator.publish(auth, key, input, bytes));
  }
  // Named physical seams remain reachable for corruption/crash oracles.
  private currentContext(): Oid | null { return this.contextRepository.current(); }
  private prepareContextCandidate(tree: string, entries: ContextEntry[], expected: Oid | null): Oid | Promise<Oid> {
    return this.contextRepository.prepareCandidate(tree, entries, expected);
  }
  private publishContextSnapshot(operation: OperationOf<"context.publish">, proof: ContextPublicationEvidence): void {
    this.contextRepository.publishSnapshot(operation, proof);
  }
  private reconcileContext(operation: OperationOf<"context.publish">): Promise<void> { return this.contextCoordinator.reconcile(operation); }

  /** CTX-006: the first GOAL is usable only after canonical publication,
   * complete snapshot/current and notification settlement. Never do this I/O in T.
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
  repairContextMirror(): void {
    const revision = this.currentContext(); if (!revision) return;
    repairContextMirror(this.paths, revision);
  }
  reconcile(operationId: string): Promise<void> {
    return this.withWriter(async () => {
      const operation = this.store.getOperationById(operationId);
      if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) return;
      switch (operation.kind) {
        case "git.integrate": await this.integrationCoordinator.reconcile(operation); return;
        case "context.publish": await this.reconcileContext(operation); return;
        case "git.submit": await this.submissionCoordinator.reconcile(operation); return;
        default: return;
      }
    });
  }
  knownRefs(): { main: string; published: string[] } {
    return { main: this.currentMain(), published: [...observed(this.observations.published(this.paths.projectGit), "known published refs")] };
  }
}
