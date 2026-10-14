/** TS-001: module-contracts contract owner. Declarations only; wire/persisted v1 unchanged. */

/** R40/D12: internal owner ports, not wire DTOs. See src/module-ports.ts for
 * the reviewed signature inventory and production compile-time conformance.
 * Store row queries and receipt projection intentionally remain separate.
 * Only the aliases a compile-time conformance check verifies stay declared;
 * interfaces nothing checked against reality were removed (B2).
 */
export type Store = import('../../src/module-ports.js').StorePort;

export type OperationReceiptPort = import('../../src/module-ports.js').OperationReceiptPort;

export type UnitsModule = import('../../src/module-ports.js').SyncUnitsPort;

export type SandboxModule = import('../../src/module-ports.js').SandboxPort;

export type ViewsModule = import('../../src/module-ports.js').DerivedViewsPort;

export type ReconcileModule = import('../../src/module-ports.js').ReconcilePort;

export type RunnerModule = import('../../src/module-ports.js').BoundRunnerPort;
