import type { IntegrationPublicationEvidence } from "@oma/contracts/publication";
/** PUB-002: a canonical effect, not a caller's success flag, authorizes mail.
 * A no-op is witnessed by its immutable authorization ref, never main equality. */
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { GitLedger } from "./ports.js";
import type { GitObservation } from "@oma/contracts/git";
import { StoreError } from "@oma/domain/errors";

const publicationBrand: unique symbol = Symbol("observed integration");
const issued = new WeakMap<object, { id: string; actor: string; planJson: string }>();
export interface IntegrationPublicationObservations {
  main(): GitObservation<string>;
  ancestry?(base: string, candidate: string): GitObservation<boolean>;
}
export class IntegrationPublicationObserver {
  constructor(private readonly observations: IntegrationPublicationObservations,
    private readonly ledger?: Pick<GitLedger,"findSucceededIntegration">) {}
  /** Walk only completed, decoded CAS links; an arbitrary descendant is unknown. */
  applied(candidate: string, main: string): boolean {
    if (candidate === main) return true;
    const seen = new Set<string>(); let current = main;
    while (current !== candidate) {
      if (seen.has(current)) return false; seen.add(current);
      const successor = this.ledger?.findSucceededIntegration?.(current);
      if (!successor || successor.state !== "succeeded" || successor.plan.candidate !== current || successor.plan.base === current) return false;
      const ancestry = this.observations.ancestry?.(successor.plan.base,current);
      if (ancestry?.kind !== "present" || !ancestry.value) return false;
      current = successor.plan.base;
    }
    return true;
  }
  integration(operation: OperationOf<"git.integrate">): IntegrationPublicationEvidence {
    const { plan } = operation;
    if ((operation.state !== "pending" && operation.state !== "unknown") || plan.merge === undefined)
      throw new StoreError("STORE_CORRUPT", "integration publication requires accepted nonterminal intent");
    const observation = this.observations.main();
    if (observation?.kind !== "present" || !this.applied(plan.candidate,observation.value))
      throw new StoreError(observation?.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN",
        "integration mail requires the accepted canonical effect");
    const proof = Object.freeze({ [publicationBrand]: true as const });
    issued.set(proof, { id: operation.id, actor: operation.actor, planJson: operation.planJson });
    return proof as unknown as IntegrationPublicationEvidence;
  }
}
export function consumeIntegrationPublication(proof: unknown, operation: OperationOf<"git.integrate">): void {
  const facts = proof !== null && typeof proof === "object" ? issued.get(proof) : undefined;
  if (!facts || facts.id !== operation.id || facts.actor !== operation.actor || facts.planJson !== operation.planJson ||
      (operation.state !== "pending" && operation.state !== "unknown") ||
      operation.plan.merge === undefined)
    throw new StoreError("REF_STATE_UNKNOWN", "integration mail requires fresh matching canonical effect evidence");
  issued.delete(proof as object);
}
