/** PR-002: delivering the Principal's mail into the session the product owns.
 *
 * A Resident's runner starts an engine per batch, hands it the batch and seals
 * the session once the trusted boundary appears. The Principal's engine is the
 * Human's live session and is never restarted for mail, so this owner does
 * the runner's part against that session instead:
 *
 *   prepare  -> the broker selects a bounded batch and publishes its view
 *   deliver  -> the trusted extension presents it as a custom message
 *   boundary -> the extension reports the settled turn it produced
 *   receipt  -> recorded here, beside the Resident's receipts
 *   complete -> the broker marks the batch delivered
 *
 * Two rules keep this honest. It prepares only while the product runs (PR-002:
 * no UI, no new batch), and it delivers only while the session is idle, so the
 * boundary it observes is the batch's own turn and not the end of a Human's;
 * attributing a boundary inside a turn already running is S-03's open
 * question, and this does not rely on an answer to it. And delivery is the
 * host's alone: the broker serves these two methods for the Principal only to
 * the host process, so nothing the model runs can mark its own mail read.
 */
import type { BoundaryEvidence, PreparedBatch, ProtocolLimits } from "../../implementation/contracts.js";
import { BrokerChannel } from "../protocol/channel.js";
import { StoreError } from "../domain/errors.js";
import { PI_ADAPTER_REVISION, publishDeliveryReceipt } from "../storage/delivery-receipt.js";
import { runnerReceiptPathAt } from "../storage/paths.js";
import { boundaryOf } from "./pi-adapter.js";
import type { PiEvent } from "./pi-rpc.js";

/** What the delivery needs from the live session. */
export interface DeliverySession {
  readonly running: boolean;
  /** True while any turn is owned, by the Human or by a delivery. */
  readonly busy: boolean;
  onEvent(listener: (event: PiEvent) => void): () => void;
  /** Claims the session and asks the extension to present the batch. Throws
   * `BATCH_CONFLICT` if the session was claimed in the meantime. */
  deliver(batchId: string): Promise<void>;
  /** Gives the claim back when a delivery ends without a settled turn. */
  release(): void;
}

/** The broker's two delivery methods, as the host calls them. */
export interface DeliveryBroker {
  prepare(): Promise<PreparedBatch | null>;
  complete(evidence: BoundaryEvidence): Promise<void>;
}

export type DeliveryOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "delivered"; readonly batchId: string; readonly messages: number }
  | { readonly kind: "deferred"; readonly reason: string }
  | { readonly kind: "failed"; readonly batchId: string; readonly reason: string };

/** The host's client for the Principal host endpoint. One short connection
 * per call, the same way the model-facing CLI talks to the broker. */
export function principalHostBroker(runRoot: string, limits: Pick<ProtocolLimits, "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds">): DeliveryBroker {
  const path = `${runRoot.endsWith("/") ? runRoot : `${runRoot}/`}principal-host.sock`;
  const call = async <T>(method: "batch.prepare" | "batch.complete", params: Record<string, unknown>): Promise<T> => {
    const channel = new BrokerChannel(limits);
    try {
      await channel.connect(path);
      const reply = await channel.call(method, params);
      if (!reply.ok) throw new StoreError(reply.error.code, reply.error.message);
      return reply.result as T;
    } finally { channel.close(); }
  };
  return {
    prepare: () => call<PreparedBatch | null>("batch.prepare", {}),
    complete: async evidence => { await call("batch.complete", { ...evidence }); },
  };
}

export interface PrincipalDeliveryOptions {
  readonly stateRoot: string;
  readonly frameBytes: number;
  /** How long the extension has to accept the delivery command. */
  readonly acceptMs: number;
  /** How long to leave a batch whose delivery did not settle before trying it
   * again. It stays prepared meanwhile; the broker never re-selects it into
   * another batch. */
  readonly retryAfterMs: number;
  readonly now?: () => number;
}

export class PrincipalDelivery {
  private inFlight = false;
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly session: DeliverySession,
    private readonly broker: DeliveryBroker,
    private readonly options: PrincipalDeliveryOptions,
  ) {}

  /** One step: deliver at most one batch. Safe to call from a timer, from a
   * turn settling and from the broker becoming ready; overlapping calls do
   * nothing. */
  async tick(): Promise<DeliveryOutcome> {
    if (this.inFlight) return { kind: "deferred", reason: "a delivery is already in flight" };
    if (!this.session.running) return { kind: "deferred", reason: "the principal session has ended" };
    if (this.session.busy) return { kind: "deferred", reason: "the principal session is in a turn" };
    this.inFlight = true;
    try {
      const batch = await this.broker.prepare();
      if (batch === null) return { kind: "idle" };
      const now = (this.options.now ?? Date.now)();
      const failed = this.failedAt.get(batch.id);
      if (failed !== undefined && now - failed < this.options.retryAfterMs)
        return { kind: "deferred", reason: `batch ${batch.id} failed recently` };
      // A turn may have started while the batch was being prepared.
      if (this.session.busy) return { kind: "deferred", reason: "the principal session is in a turn" };
      try {
        await this.deliverOne(batch);
        this.failedAt.delete(batch.id);
        return { kind: "delivered", batchId: batch.id, messages: batch.messageIds.length };
      } catch (error) {
        // Losing the race for the session is not a failed delivery: the batch
        // stays prepared and the next tick takes it, with no back-off.
        if (error instanceof StoreError && error.code === "BATCH_CONFLICT")
          return { kind: "deferred", reason: "the principal session was claimed first" };
        this.failedAt.set(batch.id, (this.options.now ?? Date.now)());
        return { kind: "failed", batchId: batch.id, reason: error instanceof Error ? error.message : String(error) };
      }
    } finally { this.inFlight = false; }
  }

  private async deliverOne(batch: PreparedBatch): Promise<void> {
    let accepted: boolean | null = null;
    let settled = false;
    let providerFailed = false;
    let ended = false;
    let boundary: ReturnType<typeof boundaryOf> = null;
    let wake: () => void = () => {};
    const changed = (): Promise<void> => new Promise(resolve => { wake = resolve; });
    let next = changed();
    const unsubscribe = this.session.onEvent(event => {
      if (event.type === "response" && event.id === batch.id && event.command === "prompt")
        accepted = event.success === true;
      if (event.type === "message_end") {
        const message = event.message;
        if (message && typeof message === "object" && !Array.isArray(message) &&
          (message as Record<string, unknown>).role === "assistant" &&
          ["error", "aborted"].includes(String((message as Record<string, unknown>).stopReason)))
          providerFailed = true;
      }
      if (event.type === "agent_settled") { settled = true; everSettled = true; }
      const decoded = boundaryOf(event, batch);
      if (decoded) boundary = decoded;
      wake();
    });
    let everSettled = false;
    try {
      await this.session.deliver(batch.id);
      const acceptBy = (this.options.now ?? Date.now)() + this.options.acceptMs;
      // Wait for the engine's answer, then for the turn to settle. There is no
      // deadline on the turn itself: a model thinking about its mail is not a
      // failure, and a batch abandoned mid-turn would be delivered twice.
      for (;;) {
        if (!this.session.running) { ended = true; break; }
        if (accepted === false) throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "the engine refused the delivery command");
        if (providerFailed) throw new StoreError("PROVIDER_FAILED", "the principal's provider failed while delivering mail");
        if (settled && boundary !== null) break;
        if (settled && accepted === true) throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "the turn settled without a delivery boundary");
        const waitMs = accepted === null ? Math.max(0, acceptBy - (this.options.now ?? Date.now)()) : 1000;
        if (accepted === null && waitMs === 0)
          throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "the engine did not accept the delivery command in time");
        await Promise.race([next, new Promise<void>(resolve => { setTimeout(resolve, Math.min(waitMs, 1000)).unref?.(); })]);
        next = changed();
      }
      if (ended) throw new StoreError("PRINCIPAL_DISCONNECTED", "the principal session ended during delivery");
      const confirmed = boundary!;
      // The receipt is the runner's record of the boundary, written beside the
      // Resident's, and the broker completes the batch only against it.
      publishDeliveryReceipt(this.options.stateRoot, batch, confirmed, this.options.frameBytes);
      await this.broker.complete({
        batchId: batch.id, incarnation: batch.incarnation, sessionPath: confirmed.sessionPath,
        adapterRevision: PI_ADAPTER_REVISION,
        receiptPath: runnerReceiptPathAt(this.options.stateRoot, batch.agent, batch.id),
      });
    } finally {
      unsubscribe();
      // A delivery that ended without a settled turn still holds the session;
      // give it back so the Human and the next batch are not locked out.
      if (!everSettled) this.session.release();
    }
  }
}
