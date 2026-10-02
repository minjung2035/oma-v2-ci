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
    if ((operation.state !== "pending" && operation.state !== "unknown") || !plan.publication)
      throw new StoreError("STORE_CORRUPT", "integration publication requires accepted nonterminal intent");
    const observation = plan.base === plan.candidate
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
      (operation.state !== "pending" && operation.state !== "unknown") || !operation.plan.publication)
    throw new StoreError("REF_STATE_UNKNOWN", "integration mail requires fresh matching canonical effect evidence");
  issued.delete(proof as object);
}
