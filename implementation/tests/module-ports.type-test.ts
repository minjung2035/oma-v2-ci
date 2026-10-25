import type { BrokerLedger } from "@oma/broker/ports";
import type { ReconcileLedger } from "@oma/reconcile/ports";
/** Compile-only port and wire checks included by the root typecheck. */
import type {
  Actor, AgentStatus, InternalMethods, InternalResults, OperationId, PublicMethod,
  Receipt, RunLease, SandboxPlan, ExecutionObservation,
} from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { DecodedOperation as OperationRow } from "@oma/protocol/operation-codec";
import type { MailLedger } from "@oma/mail/ports";
import type { GitLedger } from "@oma/git/ports";
import type { ReviewLedger } from "@oma/review/ports";
import type { LifecycleLedger } from "@oma/lifecycle/ports";
import type { NativeResidents } from "#oma-test/app/runtime/native-residents";
import type { ViewsModule } from "#oma-test/app/views";
import type { ReconcileModule } from "@oma/reconcile";
import type { RunnerModule } from "#oma-test/app/runner";
import type { SandboxModule } from "@oma/platform-linux/sandbox";
import type { StorePort, OperationReceiptPort } from "#oma-test/app/ports/ledger";
import type { ResidentExecutionPort, DerivedViewsPort, ReconcilePort, BoundRunnerPort, SandboxPort } from "#oma-test/app/ports/runtime";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

function mailTransactionScope(ledger: MailLedger) {
  // @ts-expect-error Mail cannot return an async continuation from root T.
  ledger.transaction(async () => "late");
  // @ts-expect-error A thenable also escapes the synchronous root T.
  ledger.transaction(() => Promise.resolve("late") as PromiseLike<string>);
  ledger.transaction(tx => {
    // @ts-expect-error Mail has no agent-creation capability.
    tx.insertAgent({});
  });
}
function featureTransactionScopes(git: GitLedger, review: ReviewLedger) {
  // @ts-expect-error Git cannot retain a continuation in root T.
  git.transaction(async () => "late");
  // @ts-expect-error Review cannot retain a thenable in root T.
  review.transaction(() => Promise.resolve("late") as PromiseLike<string>);
  git.transaction(tx => {
    // @ts-expect-error The Git transaction cannot create an agent.
    tx.insertAgent({});
  });
  review.transaction(tx => {
    // @ts-expect-error Review facts cannot rewrite a failed terminal operation.
    tx.setOperationFailed("missing", "INTERNAL_ERROR");
  });
}
function lifecycleTransactionScope(ledger: LifecycleLedger) {
  // @ts-expect-error Lifecycle cannot keep an async continuation in root T.
  ledger.transaction(async () => "late");
  // @ts-expect-error A thenable is outside Lifecycle's synchronous root T.
  ledger.transaction(() => Promise.resolve("late") as PromiseLike<string>);
  ledger.transaction(tx => {
    // @ts-expect-error Lifecycle does not settle Mail's prepared batches.
    tx.completeBatch("missing", [], "alice", 1, "session");
  });
}

// Actual implementations must satisfy consumer-owned capabilities.
function actualPorts(store: Store, units: NativeResidents, views: ViewsModule,
  reconcile: ReconcileModule, runner: RunnerModule, sandbox: SandboxModule) {
  return {
    store: store satisfies StorePort,
    units: units satisfies ResidentExecutionPort,
    views: views satisfies DerivedViewsPort,
    reconcile: reconcile satisfies ReconcilePort,
    runner: runner satisfies BoundRunnerPort,
    sandbox: sandbox satisfies SandboxPort,
  };
}

type RowNotReceipt = Assert<Equal<ReturnType<Store["getOperation"]>, OperationRow | null>>;
type EpochRequired = Assert<Equal<Parameters<NativeResidents["stop"]>, [Actor, number]>>;
type StopIsObserved = Assert<Equal<ReturnType<NativeResidents["stop"]>, Promise<ExecutionObservation>>>;
type ObservationIsSynchronous = Assert<Equal<ReturnType<NativeResidents["observe"]>, ExecutionObservation>>;
type ViewIsSynchronous = Assert<Equal<ReturnType<ViewsModule["status"]>, AgentStatus[]>>;
type MetricsPreserved = Assert<Equal<Awaited<ReturnType<ReconcileModule["sweep"]>>,
  { examined: number; repaired: number; remaining: number }>>;
type RunnerIsBound = Assert<Equal<Parameters<RunnerModule["run"]>, []>>;
type RunnerExitPreserved = Assert<Equal<ReturnType<RunnerModule["run"]>, Promise<0>>>;
type SandboxReturnsPlan = Assert<Equal<ReturnType<SandboxModule["resident"]>, SandboxPlan>>;

// Independent wire inventories: adding/removing a wire method is not R40 alias repair.
type PublicWireUnchanged = Assert<Equal<PublicMethod,
  "society.set" | "attest.record" | "operation.read" | "review.status" |
  "mail.send" | "mail.ack" | "route.follow" | "route.unfollow" |
  "agent.create" | "agent.start" | "agent.stop" | "agent.continue" | "agent.wait" |
  "git.known" | "git.submit" | "git.integrate" | "context.publish" |
  "operation.get" | "status.get" | "logs.read"
>>;
type InternalNativeWire = Assert<Equal<keyof InternalMethods,
  "runner.open" | "runner.pending" | "batch.prepare" | "batch.read" | "batch.complete" |
  "runner.observe" | "principal.attach" | "principal.detach"
>>;

function rejectedChanges(store: Store, units: ResidentExecutionPort, views: DerivedViewsPort,
  reconcile: ReconcilePort, runner: BoundRunnerPort, sandbox: SandboxPort, lease: RunLease) {
  // @ts-expect-error The durable row still contains plan/hash/identity, not a wire receipt.
  const receipt: Receipt | null = store.getOperation("alice", "key");
  // @ts-expect-error A row query is not a receipt projection service.
  const receiptPort: OperationReceiptPort = store;
  // @ts-expect-error Death-proof incarnation must not be erased.
  units.stop("alice");
  // @ts-expect-error Diagnostic observation remains synchronous.
  const asyncUnits: { observe(agent: Actor): Promise<ExecutionObservation> } = units;
  // @ts-expect-error Observation is synchronous, not a Promise-wrapped result.
  const observation: Promise<ExecutionObservation> = units.observe("alice");
  // @ts-expect-error Derived publication is synchronous at the current boundary.
  const publication: Promise<void> = views.refreshWorld();
  // @ts-expect-error Reconciliation must preserve its metrics result.
  const sweep: Promise<void> = reconcile.sweep();
  // @ts-expect-error Runner identity is bound at composition, not each run.
  runner.run("different-agent");
  // @ts-expect-error Host directories are required composition input, never inferred from wire.
  sandbox.resident(lease);
  const recoverable: readonly OperationId[] = store.recoverableOperations();
  return { receipt, receiptPort, asyncUnits, observation, publication, sweep, recoverable };
}

export type {
  RowNotReceipt, EpochRequired, StopIsObserved, ObservationIsSynchronous,
  ViewIsSynchronous, MetricsPreserved, RunnerIsBound, RunnerExitPreserved,
  SandboxReturnsPlan, PublicWireUnchanged, InternalNativeWire,
};

function recoveryHasNoLedgerWriter(ledger: ReconcileLedger) {
  // @ts-expect-error Recovery ordering cannot mint a transaction or acceptance.
  ledger.transaction(() => undefined);
  // @ts-expect-error Physical collection gets its trusted root from composition.
  ledger.path;
  // @ts-expect-error Recovery cannot rewrite lifecycle desire.
  ledger.updateAgent({ name: "alice", desired: "enabled" });
}

function brokerTransactionScope(ledger: BrokerLedger) {
  // @ts-expect-error Broker incarnation writes cannot keep asynchronous T continuations.
  ledger.transaction(async () => "late");
  // @ts-expect-error Thenables cannot escape the captured root T.
  ledger.transaction(() => Promise.resolve("late") as PromiseLike<string>);
  ledger.transaction(tx => {
    // @ts-expect-error Broker cannot accept a workflow intent.
    tx.acceptOperation({});
    // @ts-expect-error Its write capability cannot rewrite desire or frozen spec.
    tx.updateAgent({ name: "alice", desired: "stopped" });
  });
}
