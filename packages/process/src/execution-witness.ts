/** Persisted physical execution identity. No role or authority is inferred. */
export type ExecutionWitness =
  | { readonly kind: "linux-namespace"; readonly pid: number; readonly bootId: string; readonly startTime: string;
      readonly namespaceDevice: string; readonly namespaceInode: string }
  | { readonly kind: "darwin-audit-session"; readonly auditSession: number; readonly pid: number; readonly pidVersion: number };
