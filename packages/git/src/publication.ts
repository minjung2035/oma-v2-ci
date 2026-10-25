import type { SubmissionPublicationEvidence } from "@oma/contracts/publication";
/** GIT-008: a request argument or successful child exit cannot authorize mail.
 * Only this observation owner can issue the opaque, single-use capability.
 * Capabilities are in memory; no new durable proof file or wire field is added.
 */
import type { OperationOf } from "@oma/protocol/operation-codec";
import { GitObserver } from "./observe.js";
import { StoreError } from "@oma/domain/errors";

const publicationBrand: unique symbol = Symbol("observed publication");
interface Facts {
  readonly operationId: string;
  readonly actor: string;
  readonly planJson: string;
  readonly publishedRef: string;
  readonly candidate: string;
}
const issued = new WeakMap<object, Facts>();

export class GitPublicationObserver {
  constructor(private readonly observer: GitObserver, private readonly projectRepository: string) {}
  submission(operation: OperationOf<"git.submit">): SubmissionPublicationEvidence {
    if (operation.state !== "pending" && operation.state !== "unknown")
      throw new StoreError("STORE_CORRUPT", "publication proof requires accepted nonterminal submit intent");
    const result = this.observer.ref(this.projectRepository, operation.plan.publishedRef);
    if (result.kind !== "present" || result.value !== operation.plan.candidate)
      throw new StoreError(result.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "canonical publication is not the accepted candidate");
    const proof = Object.freeze({ [publicationBrand]: true as const });
    issued.set(proof, Object.freeze({ operationId: operation.id, actor: operation.actor,
      planJson: operation.planJson, publishedRef: operation.plan.publishedRef, candidate: result.value }));
    return proof as unknown as SubmissionPublicationEvidence;
  }
}

/** Mail checks the current decoded row against issuance facts before any file
 * publication. An object reconstructed from JSON, a boolean or a stale token is
 * never an observation. A retry must obtain a fresh ref observation and token.
 */
export function consumeSubmissionPublication(proof: unknown, operation: OperationOf<"git.submit">): void {
  if (proof === null || typeof proof !== "object")
    throw new StoreError("REF_STATE_UNKNOWN", "mail publication requires canonical-ref evidence");
  const facts = issued.get(proof);
  if (!facts || facts.operationId !== operation.id || facts.actor !== operation.actor ||
      facts.planJson !== operation.planJson || facts.publishedRef !== operation.plan.publishedRef ||
      facts.candidate !== operation.plan.candidate)
    throw new StoreError("REF_STATE_UNKNOWN", "mail publication requires fresh matching canonical-ref evidence");
  issued.delete(proof);
}
