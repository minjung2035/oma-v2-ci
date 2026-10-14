/** DR27/S-08: authentication and live authority apply at acceptance only. The
 * fact is then immutable, even if mail publication is pending or its author stops.
 * I48: mail-v1 is the only production review grammar. The legacy attestation
 * kinds are refused at fresh acceptance; their already-accepted durable rows
 * remain decodable and a same-key replay still returns its historical receipt. */
import type { AttestationInput, ReviewInput } from "../implementation/contracts/attestation.js";
import type { AuthContext, Receipt } from "../implementation/contracts.js";
import type { Store } from "./store.js";
import { assertActorIdentity } from "./authority.js";
import { snapshotJson } from "./domain/canonical-json.js";
import { StoreError } from "./domain/errors.js";
import { requestHash } from "./hash.js";
import { receiptOfOperation } from "./storage/receipt-projector.js";

/** mail-v1: the review kinds attest.record can carry; `refresh` is listed so
 * a caller-shaped one routes to the refusal it deserves, not to legacy text. */
const REVIEW_INPUT_KINDS = new Set(["merge.open", "challenge.open", "review", "vote", "cancel", "refresh"]);
/** The removed production kinds: well-formed, but no longer accepted fresh. */
const LEGACY_INPUT_KINDS = new Set(["peer", "decision", "revoke", "challenge", "finding", "scope"]);
export interface ReviewRoute {
  record(auth: AuthContext, key: string, input: ReviewInput): Promise<Receipt>;
}
export class AttestationModule {
  constructor(private readonly store: Store, private readonly reviews: ReviewRoute | null = null) {}
  async record(auth: AuthContext, key: string, input: AttestationInput): Promise<Receipt> {
    assertActorIdentity(this.store, auth);
    const copied = snapshotJson(input);
    const hash = requestHash("attest.record", copied);
    // The durable receipt answers before any current-config judgment (AV-03):
    // a same-key replay of an accepted row -- including a legacy one -- keeps
    // its historical outcome, and a reused key refuses identically forever.
    const prior = this.store.claimKey(auth.actor, key, hash);
    if (prior === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (prior === "reused") throw new StoreError("REQUEST_KEY_REUSED", "attestation key has a different payload");
    const kind = copied !== null && typeof copied === "object" && !Array.isArray(copied)
      ? (copied as { kind?: unknown }).kind : undefined;
    if (typeof kind === "string" && REVIEW_INPUT_KINDS.has(kind)) {
      if (this.reviews === null) throw new StoreError("UNSUPPORTED_PROFILE", "mail-v1 review is not configured on this society");
      return this.reviews.record(auth, key, copied as ReviewInput);
    }
    if (typeof kind === "string" && LEGACY_INPUT_KINDS.has(kind))
      throw new StoreError("UNSUPPORTED_PROFILE", "this society reviews with oma_merge/oma_challenge");
    throw new StoreError("INVALID_REQUEST", "unknown attestation kind");
  }
}
