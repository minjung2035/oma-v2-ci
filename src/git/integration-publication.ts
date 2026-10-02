/** PUB-002: a canonical effect, not a caller's success flag, authorizes mail.
 * A no-op is witnessed by its immutable authorization ref, never main equality. */
import type { OperationOf } from "../storage/operation-codec.js";
import type { GitObservation } from "./observe.js";
import { StoreError } from "../domain/errors.js";

const publicationBrand: unique symbol = Symbol("observed integration");
export interface IntegrationPublicationEvidence { readonly [publicationBrand]: true }
const issued = new WeakMap<object, { id: string; actor: string; planJson: string }>();
export interface IntegrationPublicationObservations {
  main(): GitObservation<string>;
  noopWitness?(ref: string): GitObservation<string>;
}
export class IntegrationPublicationObserver {
  constructor(private readonly observations: IntegrationPublicationObservations) {}
  integration(operation: OperationOf<"git.integrate">): IntegrationPublicationEvidence {
    const { plan } = operation;
    if ((operation.state !== "pending" && operation.state !== "unknown") || (!plan.publication && !plan.merge))
      throw new StoreError("STORE_CORRUPT", "integration publication requires accepted nonterminal intent");
    // A reviewed merge is never a no-op (merge.open refuses candidate === base);
    // the noop witness branch exists only for the legacy publication shape.
    const observation = plan.base === plan.candidate && plan.publication !== undefined
      ? (plan.publication.noopRef === null ? undefined : this.observations.noopWitness?.(plan.publication.noopRef))
      : this.observations.main();
    if (observation?.kind !== "present" || observation.value !== plan.candidate)
      throw new StoreError(observation?.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN",
        "integration mail requires the accepted canonical effect");
    const proof = Object.freeze({ [publicationBrand]: true as const });
    issued.set(proof, { id: operation.id, actor: operation.actor, planJson: operation.planJson });
    return proof;
  }
}
export function consumeIntegrationPublication(proof: unknown, operation: OperationOf<"git.integrate">): void {
  const facts = proof !== null && typeof proof === "object" ? issued.get(proof) : undefined;
  if (!facts || facts.id !== operation.id || facts.actor !== operation.actor || facts.planJson !== operation.planJson ||
      (operation.state !== "pending" && operation.state !== "unknown") ||
      (operation.plan.publication === undefined && operation.plan.merge === undefined))
    throw new StoreError("REF_STATE_UNKNOWN", "integration mail requires fresh matching canonical effect evidence");
  issued.delete(proof as object);
}
