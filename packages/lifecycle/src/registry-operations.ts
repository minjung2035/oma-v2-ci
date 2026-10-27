import type { LifecycleEffects } from "./ports.js";
import { encodeOperationPlan } from "@oma/protocol/operation-codec";
import type { AuthContext } from "@oma/contracts/runtime";
import type { MessageId } from "@oma/contracts/identity";
import type { Receipt } from "@oma/contracts/durable";
import type { LifecycleLedger } from "./ports.js";
import { reused } from "@oma/domain/request-identity";
import { ownedMessages } from "@oma/domain/durable";
import { parseMessageId } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";
import { assertActorIdentity, assertCurrentActor } from "@oma/domain/authority";
import { requestHash } from "@oma/domain/request-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { lifecycleReceipt } from "./policy.js";

/** Transaction-only handlers. No filesystem, unit, provider or process effects.
 * D06: identity authentication precedes replay; fresh acceptance additionally
 * requires current authority. Do not extend this order to start/stop handlers.
 */
export class RegistryOperations {
  constructor(private readonly store: LifecycleLedger, private readonly effects: Pick<LifecycleEffects, "nextOperationId">) {}

  ack(auth: AuthContext, message: MessageId, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("mail.ack", { message });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    const id = this.effects.nextOperationId();
    const outcome = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth);
      const accepted = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "mail.ack",
        payloadJson: JSON.stringify({ message }), planJson: encodeOperationPlan({ kind: "mail.ack", recipient: auth.actor, message }) });
      if (accepted === "retry") return accepted;
      if (!this.store.getDelivery(message, auth.actor)) {
        const identity = parseMessageId(message);
        const operation = identity === null ? null : this.store.getOperationById(identity.operationId);
        const named = operation === null ? undefined : ownedMessages(operation.plan).find(candidate => candidate.id === message);
        throw new StoreError("REQUEST_NOT_FOUND", named !== undefined
          ? `${message} was not addressed to ${auth.actor}; acknowledge a message delivered to your own inbox`
          : `message ${message} does not exist in this society; use the Message-ID of a message in your own inbox`);
      }
      tx.markAcknowledged(message, auth.actor);
      tx.setOperationSucceeded(id, JSON.stringify({ kind: "mail.ack", message, acknowledged: true }));
      return accepted;
    });
    return outcome === "retry" ? receiptOfOperation(this.store.retriedOperation(auth.actor, key)) : lifecycleReceipt(this.store, id);
  }

  follow(auth: AuthContext, topic: string, subscribe: boolean, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const kind = subscribe ? "route.follow" : "route.unfollow";
    const hash = requestHash(kind, { topic });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    // MAIL-001/002 (DR18): topics are the Residents'. A topic's mail goes to
    // the Residents that follow it and to no one else, so a follow by anyone
    // else would be a subscription that delivers nothing -- refused, not kept.
    if (auth.role !== "resident")
      throw new StoreError("CAPABILITY_DENIED", "topics are followed by Residents; the Principal receives the mail addressed to it");
    const id = this.effects.nextOperationId();
    const outcome = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth);
      const accepted = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind,
        payloadJson: JSON.stringify({ topic }), planJson: encodeOperationPlan({ kind, topic, agent: auth.actor }) });
      if (accepted === "retry") return accepted;
      if (subscribe) tx.follow(topic, auth.actor); else tx.unfollow(topic, auth.actor);
      tx.setOperationSucceeded(id, JSON.stringify({ kind, topic, subscribed: subscribe }));
      return accepted;
    });
    return outcome === "retry" ? receiptOfOperation(this.store.retriedOperation(auth.actor, key)) : lifecycleReceipt(this.store, id);
  }
}
