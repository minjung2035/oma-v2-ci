/** R40 compile-only checks. Never imported by production; compilation is NOT_RUN. */
import type {
  Actor, AgentStatus, InternalMethods, InternalResults, OperationId, PublicMethod,
  Receipt, RunLease, SandboxPlan, UnitObservation,
  Store as StoreContract, UnitsModule as UnitsContract, ViewsModule as ViewsContract,
  ReconcileModule as ReconcileContract, RunnerModule as RunnerContract,
  SandboxModule as SandboxContract,
} from "../contracts.js";
import type { Store, OperationRow } from "../../src/store.js";
import type { UnitsModule } from "../../src/units.js";
import type { ViewsModule } from "../../src/views.js";
import type { ReconcileModule } from "../../src/reconcile.js";
import type { RunnerModule } from "../../src/runner.js";
import type { SandboxModule } from "../../src/sandbox.js";
import type { AsyncUnitsOrchestrationPort, OperationReceiptPort } from "../../src/module-ports.js";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// These assignments are direct actual-object facade checks, not assertion adapters.
function actualPorts(store: Store, units: UnitsModule, views: ViewsModule,
  reconcile: ReconcileModule, runner: RunnerModule, sandbox: SandboxModule) {
  return {
    store: store satisfies StoreContract,
    units: units satisfies UnitsContract,
    views: views satisfies ViewsContract,
    reconcile: reconcile satisfies ReconcileContract,
    runner: runner satisfies RunnerContract,
    sandbox: sandbox satisfies SandboxContract,
  };
}

type RowNotReceipt = Assert<Equal<ReturnType<Store["getOperation"]>, OperationRow | null>>;
type EpochRequired = Assert<Equal<Parameters<UnitsModule["stop"]>, [Actor, number]>>;
type StopIsObserved = Assert<Equal<ReturnType<UnitsModule["stop"]>, UnitObservation>>;
type ObservationIsSynchronous = Assert<Equal<ReturnType<UnitsModule["observe"]>, UnitObservation>>;
type ViewIsSynchronous = Assert<Equal<ReturnType<ViewsModule["status"]>, AgentStatus[]>>;
type MetricsPreserved = Assert<Equal<Awaited<ReturnType<ReconcileModule["sweep"]>>,
  { examined: number; repaired: number; remaining: number }>>;
type RunnerIsBound = Assert<Equal<Parameters<RunnerModule["run"]>, []>>;
type RunnerExitPreserved = Assert<Equal<ReturnType<RunnerModule["run"]>, Promise<0>>>;
type SandboxReturnsPlan = Assert<Equal<ReturnType<SandboxModule["resident"]>, SandboxPlan>>;

// Independent wire inventories: adding/removing a wire method is not R40 alias repair.
type PublicWireUnchanged = Assert<Equal<PublicMethod,
  "mail.send" | "mail.ack" | "route.follow" | "route.unfollow" |
  "agent.create" | "agent.start" | "agent.stop" | "agent.continue" | "agent.wait" |
  "git.known" | "git.submit" | "git.integrate" | "context.publish" |
  "operation.get" | "status.get" | "logs.read"
>>;
type InternalWireUnchanged = Assert<Equal<keyof InternalMethods,
  "runner.open" | "runner.pending" | "batch.prepare" | "batch.read" | "batch.complete" |
  "runner.observe" | "principal.attach" | "principal.detach" | "host.principalRelay"
>>;

function rejectedChanges(store: Store, units: UnitsContract, views: ViewsContract,
  reconcile: ReconcileContract, runner: RunnerContract, sandbox: SandboxContract, lease: RunLease) {
  // @ts-expect-error The durable row still contains plan/hash/identity, not a wire receipt.
  const receipt: Receipt | null = store.getOperation("alice", "key");
  // @ts-expect-error A row query is not a receipt projection service.
  const receiptPort: OperationReceiptPort = store;
  // @ts-expect-error Death-proof incarnation must not be erased.
  units.stop("alice");
  // @ts-expect-error Synchronous effects cannot silently become async orchestration.
  const asyncUnits: AsyncUnitsOrchestrationPort = units;
  // @ts-expect-error Observation is synchronous, not a Promise-wrapped result.
  const observation: Promise<UnitObservation> = units.observe("alice");
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
  SandboxReturnsPlan, PublicWireUnchanged, InternalWireUnchanged,
};
