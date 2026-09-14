/** Compile-only composition verification. Ports never import their implementors. */
import type {
  StorePort,
  SyncUnitsPort,
  DerivedViewsPort,
  ReconcilePort,
  BoundRunnerPort,
  SandboxPort,
} from "../module-ports.js";
import type { Store } from "../store.js";
import type { UnitsModule } from "../units.js";
import type { ViewsModule } from "../views.js";
import type { ReconcileModule } from "../reconcile.js";
import type { RunnerModule } from "../runner.js";
import type { SandboxModule } from "../sandbox.js";

type Conforms<Port, Implementation extends Port> = Implementation;
export type ActualModuleConformance = {
  store: Conforms<StorePort, Store>;
  units: Conforms<SyncUnitsPort, UnitsModule>;
  views: Conforms<DerivedViewsPort, ViewsModule>;
  reconcile: Conforms<ReconcilePort, ReconcileModule>;
  runner: Conforms<BoundRunnerPort, RunnerModule>;
  sandbox: Conforms<SandboxPort, SandboxModule>;
};
