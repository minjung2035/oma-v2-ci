// Independent test oracle. No production constructors, decoders, transition tables or hashes are imported.
import { Seeded } from "./reproducible.js";
export type Action =
  | { kind: "request"; slot: number; variant: 0 | 1; boundary: "complete" | "accepted" }
  | { kind: "unknown" | "fail" | "ack"; slot: number }
  | { kind: "prepare" | "stop" | "start" | "revoke" | "reconcile" | "restart" };
export interface ModelOperation {
  variant: 0 | 1; state: "pending" | "unknown" | "succeeded" | "failed";
  published: boolean; acknowledged: boolean;
}
export interface Model {
  desired: "enabled" | "stopped"; incarnation: number; revoked: boolean;
  operations: Map<number, ModelOperation>; batchMembers: number[] | null;
  /** DR9: the run the prepared batch was created in; later runs are its later attempts. */
  batchIncarnation: number | null;
}
export function initialModel(): Model {
  return { desired: "enabled", incarnation: 1, revoked: false, operations: new Map(), batchMembers: null, batchIncarnation: null };
}
export type Expected = "ok" | "noop" | "STALE_RUN" | "CAPABILITY_DENIED" | "REQUEST_KEY_REUSED" | "STORE_CORRUPT";
function admission(model: Model): Expected | null {
  return model.desired !== "enabled" ? "STALE_RUN" : model.revoked ? "CAPABILITY_DENIED" : null;
}
/** Ledger transitions and admission are modeled here, not actual kernel start/stop
 * completion or provider settlement proof. Those remain separate real-host suites.
 */
export function advance(model: Model, action: Action): Expected {
  switch (action.kind) {
    case "stop": model.desired = "stopped"; model.revoked = true; return "ok";
    case "start": model.desired = "enabled"; model.incarnation++; model.revoked = false; return "ok";
    case "revoke": model.revoked = true; return "ok";
    case "restart": model.revoked = true; return "ok";
    case "reconcile":
      for (const operation of model.operations.values()) if (operation.state === "pending" || operation.state === "unknown") {
        operation.state = "succeeded"; operation.published = true;
      }
      return "ok";
    case "unknown": {
      const operation = model.operations.get(action.slot);
      if (!operation || operation.state !== "pending") return "noop";
      operation.state = "unknown"; return "ok";
    }
    case "fail": {
      const operation = model.operations.get(action.slot);
      if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) return "noop";
      operation.state = "failed"; return "ok";
    }
    case "request": {
      const denied = admission(model); if (denied) return denied;
      const existing = model.operations.get(action.slot);
      if (existing) return existing.variant === action.variant ? "ok" : "REQUEST_KEY_REUSED";
      model.operations.set(action.slot, { variant: action.variant, state: action.boundary === "accepted" ? "pending" : "succeeded",
        published: action.boundary === "complete", acknowledged: false });
      return "ok";
    }
    case "ack": {
      const denied = admission(model); if (denied) return denied;
      const operation = model.operations.get(action.slot); if (!operation) return "noop";
      operation.acknowledged = true; return "ok";
    }
    case "prepare": {
      const denied = admission(model); if (denied) return denied;
      if (model.batchMembers === null) {
        const members = [...model.operations].filter(([, operation]) => operation.published).map(([slot]) => slot).sort((a, b) => a - b);
        if (members.length) { model.batchMembers = members; model.batchIncarnation = model.incarnation; }
      }
      return "ok";
    }
  }
}
export function generateActions(seed: number, count: number): Action[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000) throw new RangeError("invalid finite action count");
  const random = new Seeded(seed), model = initialModel(), sequence: Action[] = [];
  const kinds = ["request", "request", "unknown", "fail", "ack", "prepare", "stop", "start", "revoke", "reconcile", "restart"] as const;
  for (let index = 0; index < count; index++) {
    const kind = kinds[random.index(kinds.length)]!;
    const slot = random.index(8);
    const action: Action = kind === "request"
      ? { kind, slot, variant: random.index(2) === 0 ? 0 : 1, boundary: random.index(2) === 0 ? "complete" : "accepted" }
      : kind === "unknown" || kind === "fail" || kind === "ack" ? { kind, slot } : { kind };
    // Missing-target operations have defined no-op semantics, so deletion shrinking
    // cannot turn a target failure into an unrelated invalid setup failure.
    advance(model, action); sequence.push(action);
  }
  return sequence;
}
/** Authored regression seeds/sequences, not discoveries or executed evidence. */
export const MODEL_CORPUS: readonly (readonly Action[])[] = [
  [{ kind: "request", slot: 0, variant: 0, boundary: "accepted" }, { kind: "unknown", slot: 0 }, { kind: "restart" },
    { kind: "reconcile" }, { kind: "start" }, { kind: "request", slot: 0, variant: 0, boundary: "complete" }, { kind: "request", slot: 0, variant: 1, boundary: "complete" }, { kind: "prepare" }, { kind: "ack", slot: 0 }],
  [{ kind: "request", slot: 0, variant: 0, boundary: "accepted" }, { kind: "fail", slot: 0 }, { kind: "reconcile" },
    { kind: "request", slot: 0, variant: 0, boundary: "complete" }, { kind: "stop" }, { kind: "request", slot: 1, variant: 0, boundary: "complete" }, { kind: "start" }, { kind: "revoke" }],
  [{ kind: "request", slot: 0, variant: 0, boundary: "accepted" }, { kind: "unknown", slot: 0 }, { kind: "reconcile" },
    { kind: "request", slot: 1, variant: 1, boundary: "complete" }, { kind: "prepare" }, { kind: "restart" },
    { kind: "start" }, { kind: "prepare" }, { kind: "ack", slot: 0 }],
];
