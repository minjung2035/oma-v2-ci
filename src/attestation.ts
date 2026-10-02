/** DR27/S-08: authentication and live authority apply at acceptance only. The
 * fact is then immutable, even if mail publication is pending or its author stops. */
import type { AttestationInput } from "../implementation/contracts/attestation.js";
import type { AuthContext, Receipt } from "../implementation/contracts.js";
import type { ExactCandidateIdentity } from "../implementation/contracts/values.js";
import type { Store } from "./store.js";
import type { MailModule } from "./mail.js";
import { assertActorIdentity, assertCurrentActor } from "./authority.js";
import { attestationProblem } from "./domain/attestation.js";
import { attestationTarget, attestationRelationProblem } from "./domain/attestation-relations.js";
import { snapshotJson } from "./domain/canonical-json.js";
import { StoreError } from "./domain/errors.js";
import { requestHash } from "./hash.js";
import { receiptOfOperation } from "./storage/receipt-projector.js";

export interface AttestationAuthority {
  /** Synchronous host-owned observation; no provider, Worker assertion or await. */
  exact(identity: ExactCandidateIdentity): void;
  principal(): void;
}
export class AttestationModule {
  constructor(private readonly store: Store, private readonly mail: MailModule, private readonly authority: AttestationAuthority) {}
  async record(auth: AuthContext, key: string, input: AttestationInput): Promise<Receipt> {
    assertActorIdentity(this.store, auth);
    const copied = snapshotJson(input);
    const problem = attestationProblem(copied);
    if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
    const fact = copied as AttestationInput;
    const hash = requestHash("attest.record", copied);
    const prior = this.store.operations.classifyKey(auth.actor, key, hash);
    if (prior === "retry") return receiptOfOperation(this.store.operations.retried(auth.actor, key));
    if (prior === "reused") throw new StoreError("REQUEST_KEY_REUSED", "attestation key has a different payload");
    // The live host/Git snapshot is observed before filesystem mail preparation,
    // then refreshed immediately before the synchronous acceptance transaction.
    const observeAuthority = () => {
      assertCurrentActor(this.store, auth, "mail.send");
      if (fact.kind === "peer" || fact.kind === "decision" || fact.kind === "scope") this.authority.exact(fact.identity);
      if (fact.kind === "decision" || fact.kind === "finding" || fact.kind === "scope") this.authority.principal();
    };
    const accept = () => {
      const targetId = attestationTarget(fact);
      const target = targetId === null ? null : this.store.operations.getById(targetId);
      const reference = target === null ? null : { actor: target.actor,
        fact: target.kind === "attest.record" ? target.plan.fact : null,
        integrated: target.kind === "git.integrate" && target.state === "succeeded" ? {
          repo: target.plan.repo, targetRef: target.plan.target, expectedBase: target.plan.base,
          candidate: target.plan.candidate, policyRevision: target.plan.policyRevision,
        } : null };
      const invalid = attestationRelationProblem(auth.actor, fact, reference);
      if (invalid !== null) throw new StoreError("INVALID_REQUEST", invalid);
    };
    accept(); observeAuthority();
    return this.mail.recordAttestation(auth, key, fact, observeAuthority, accept);
  }
}
