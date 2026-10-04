/** R40/D12 compatibility surface for internal ports, not new wire methods.
 * P17: canonical declarations live with their ledger/runtime semantic contracts.
 * These modules are erased contracts, not members of the runtime kernel DAG.
 * Actual implementation compatibility is checked in entry/module-conformance.ts.
 * SyncUnitsPort is not the async lifecycle orchestration port; no effect, epoch,
 * return-type or host-directory trust adaptation is performed by this facade.
 */
export type {
  OperationRowsPort, StorePort, OperationReceiptPort, ReceiptProjector,
} from "./ports/ledger.js";
export type {
  SyncUnitsPort, DerivedViewsPort, ReconcileMetrics,
  ReconcilePort, BoundRunnerPort, SandboxDirectories, SandboxCompositionInput,
  SandboxPort, UnitObserve, SandboxHost,
} from "./ports/runtime.js";
