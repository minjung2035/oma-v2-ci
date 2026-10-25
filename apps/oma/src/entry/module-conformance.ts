/** Compile-only composition verification. Ports never import their implementors. */
import type { StorePort } from "../ports/ledger.js";
import type {
  ResidentExecutionPort,
  DerivedViewsPort,
  ReconcilePort,
  BoundRunnerPort,
  SandboxPort,
} from "../ports/runtime.js";
import type { Store } from "@oma/storage";
import type { NativeResidents } from "../runtime/native-residents.js";
import type { ViewsModule } from "../views.js";
import type { ReconcileModule } from "@oma/reconcile";
import type { RunnerModule } from "../runner.js";
import type { SandboxModule } from "@oma/platform-linux/sandbox";
import type { OperationLookup } from "@oma/contracts/durable";
import type { ReceiptProjector } from "../ports/ledger.js";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import type { receiptOfOperation } from "@oma/protocol/receipt-projector";

type Conforms<Port, Implementation extends Port> = Implementation;
export type ActualModuleConformance = {
  store: Conforms<StorePort, Store>;
  operationLookup: Conforms<OperationLookup, DecodedOperation>;
  receiptProjector: Conforms<ReceiptProjector, typeof receiptOfOperation>;
  units: Conforms<ResidentExecutionPort, NativeResidents>;
  views: Conforms<DerivedViewsPort, ViewsModule>;
  reconcile: Conforms<ReconcilePort, ReconcileModule>;
  runner: Conforms<BoundRunnerPort, RunnerModule>;
  sandbox: Conforms<SandboxPort, SandboxModule>;
};
