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
export type { GitPaths } from "./paths.js";

export class GitModule {
  private readonly integrationCoordinator: IntegrationCoordinator;
  private readonly submissionCoordinator: SubmitCoordinator;
  private readonly contextCoordinator: ContextCoordinator;
  private readonly writers = new Set<"project" | "context">();
  constructor(private readonly store: GitLedger, mail: GitMessaging, private readonly repository: GitRepositoryPort,
    integration: IntegrationPolicy | null, integrationPolicyReader: IntegrationPolicyReader | null,
    private readonly candidateCheck: ((candidate: Oid, check: FrozenCheck, cancellation: AbortSignal | undefined, authorize: () => void) => Promise<void>) | null,
    reviewAuthority: ReviewAuthority) {
    this.integrationCoordinator = new IntegrationCoordinator(store, {
      ...repository.integration, runCheck: (candidate, check, signal, authorize) => this.runCheck(candidate, check, signal, authorize),
    }, integration, integrationPolicyReader, mail, reviewAuthority);
    this.submissionCoordinator = new SubmitCoordinator({ stateRoot: repository.stateRoot, society: repository.society }, store, mail,
      repository.submission, repository.submissionPublication);
    this.contextCoordinator = new ContextCoordinator({ stateRoot: repository.stateRoot, society: repository.society }, store, mail,
      repository.context, repository.contextPublication);
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

  boundPolicy(): IntegrationSnapshot | null { return this.integrationCoordinator.boundPolicy(); }
  currentIntegrationPolicy(): IntegrationSnapshot { return this.integrationCoordinator.currentIntegrationPolicy(); }
  applyMerge(operation: OperationOf<"git.integrate">): Promise<void> { return this.integrationCoordinator.applyMerge(operation); }
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
  private runCheck(candidate: Oid, check: FrozenCheck, cancellation: AbortSignal | undefined, authorize: () => void): Promise<void> {
    if (!this.candidateCheck) throw new StoreError("UNSUPPORTED_PROFILE", "trusted candidate check executor is unavailable");
    return this.candidateCheck(candidate, check, cancellation, authorize);
  }
  publishContext(auth: AuthContext, key: string, input: ContextInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.withWriter(() => this.contextCoordinator.publish(auth, key, input, bytes), "context");
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
