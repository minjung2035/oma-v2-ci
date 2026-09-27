import type { AuthContext } from "../../implementation/contracts/runtime.js";
import type { MessageId } from "../../implementation/contracts/identity.js";
import type { Receipt } from "../../implementation/contracts/durable.js";
import { Store, reused } from "../store.js";
import { StoreError } from "../domain/errors.js";
import { assertActorIdentity, assertCurrentActor } from "../authority.js";
import { generateOperationId } from "../ids.js";
import { requestHash } from "../hash.js";
import { receiptOfOperation } from "../storage/receipt-projector.js";
import { lifecycleReceipt } from "./policy.js";

/** Transaction-only handlers. No filesystem, unit, provider or process effects.
 * D06: identity authentication precedes replay; fresh acceptance additionally
 * requires current authority. Do not extend this order to start/stop handlers.
 */
export class RegistryOperations {
  constructor(private readonly store: Store) {}

  ack(auth: AuthContext, message: MessageId, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("mail.ack", { message });
    const claim = this.store.operations.classifyKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    const id = generateOperationId();
    const outcome = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth);
      const accepted = tx.operations.accept({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "mail.ack",
        payloadJson: JSON.stringify({ message }), planJson: JSON.stringify({ kind: "mail.ack", recipient: auth.actor, message }) });
      if (accepted === "retry") return accepted;
      if (!this.store.deliveries.get(message, auth.actor))
        throw new StoreError("REQUEST_NOT_FOUND", `no delivery of ${message} to ${auth.actor}`);
      tx.deliveries.acknowledge(message, auth.actor);
      tx.operations.succeed(id, JSON.stringify({ kind: "mail.ack", message, acknowledged: true }));
      return accepted;
    });
    return outcome === "retry" ? receiptOfOperation(this.store.retriedOperation(auth.actor, key)) : lifecycleReceipt(this.store, id);
  }

  follow(auth: AuthContext, topic: string, subscribe: boolean, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const kind = subscribe ? "route.follow" : "route.unfollow";
    const hash = requestHash(kind, { topic });
    const claim = this.store.operations.classifyKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    // MAIL-001/002 (DR18): topics are the Residents'. A topic's mail goes to
    // the Residents that follow it and to no one else, so a follow by anyone
    // else would be a subscription that delivers nothing -- refused, not kept.
    if (auth.role !== "resident")
      throw new StoreError("CAPABILITY_DENIED", "topics are followed by Residents; the Principal receives the mail addressed to it");
    const id = generateOperationId();
    const outcome = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth);
      const accepted = tx.operations.accept({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind,
        payloadJson: JSON.stringify({ topic }), planJson: JSON.stringify({ kind, topic, agent: auth.actor }) });
      if (accepted === "retry") return accepted;
      if (subscribe) tx.subscriptions.follow(topic, auth.actor); else tx.subscriptions.unfollow(topic, auth.actor);
      tx.operations.succeed(id, JSON.stringify({ kind, topic, subscribed: subscribe }));
      return accepted;
    });
    return outcome === "retry" ? receiptOfOperation(this.store.retriedOperation(auth.actor, key)) : lifecycleReceipt(this.store, id);
  }
}
