import type { ContextPublicationEvidence } from "@oma/contracts/publication";
/** CTX-004: derived snapshots and notifications need a fresh observation of
 * the accepted canonical revision, not merely a prepared candidate or a link.
 */
import type { OperationOf } from "@oma/protocol/operation-codec";
import { authorizeCanonicalNoop } from "./canonical-command.js";
import type { GitObservation } from "@oma/contracts/git";
import type { GitObserver } from "./observe.js";
import { StoreError } from "@oma/domain/errors";

const contextPublicationBrand: unique symbol = Symbol("observed context publication");
interface Facts { id: string; actor: string; planJson: string; candidate: string }
const issued = new WeakMap<object, Readonly<Facts>>();

export class ContextPublicationObserver {
  constructor(private readonly observer: GitObserver, private readonly repository: string) {}
  private witness(operation: OperationOf<"context.publish">, observation: GitObservation<string>): boolean {
    if (observation.kind === "absent") return false;
    if (observation.kind !== "present")
      throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "context no-op authorization cannot be observed");
    if (observation.value !== operation.plan.candidate)
      throw new StoreError("STORE_CORRUPT", "context no-op witness changed candidate");
    return true;
  }
  hasNoopWitness(operation: OperationOf<"context.publish">): boolean {
    const ref = operation.plan.noopRef;
    // Only the accepted per-operation witness proves authorization. Main
    // equality cannot create that proof or change accepted bytes.
    if (!ref) throw new StoreError("REF_STATE_UNKNOWN", "context no-op has no accepted authorization witness");
    return this.witness(operation, this.observer.ref(this.repository, ref));
  }
  authorizeNoop(operation: OperationOf<"context.publish">): boolean {
    const ref = operation.plan.noopRef;
    if (!ref) throw new StoreError("REF_STATE_UNKNOWN", "context no-op has no accepted authorization witness");
    return this.witness(operation, authorizeCanonicalNoop(this.observer, this.repository, ref, operation.plan.candidate));
  }
  observe(operation: OperationOf<"context.publish">): ContextPublicationEvidence {
    if (operation.state !== "pending" && operation.state !== "unknown")
      throw new StoreError("STORE_CORRUPT", "context publication evidence requires a nonterminal accepted intent");
    if (operation.plan.base === operation.plan.candidate && !this.hasNoopWitness(operation))
      throw new StoreError("REF_STATE_UNKNOWN", "context no-op is not yet authorized");
    const current = this.observer.ref(this.repository, operation.plan.target);
    if (current.kind !== "present" || current.value !== operation.plan.candidate)
      throw new StoreError(current.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "canonical context is not the accepted candidate");
    const proof = Object.freeze({ [contextPublicationBrand]: true as const });
    issued.set(proof, Object.freeze({ id: operation.id, actor: operation.actor, planJson: operation.planJson, candidate: current.value }));
    return proof as unknown as ContextPublicationEvidence;
  }
}

/** Each phase consumes its own token; mail must obtain a new ref observation
 * after snapshot publication. A JSON object or token for another intent fails.
 */
export function consumeContextPublication(proof: unknown, operation: OperationOf<"context.publish">): void {
  if (proof === null || typeof proof !== "object") throw new StoreError("REF_STATE_UNKNOWN", "context publication evidence is missing");
  const facts = issued.get(proof);
  if (!facts || (operation.state !== "pending" && operation.state !== "unknown") ||
      facts.id !== operation.id || facts.actor !== operation.actor || facts.planJson !== operation.planJson || facts.candidate !== operation.plan.candidate)
    throw new StoreError("REF_STATE_UNKNOWN", "context publication evidence is stale, mismatched or already consumed");
  issued.delete(proof);
}
