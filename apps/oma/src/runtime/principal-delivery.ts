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
 * no UI, no new batch), and it delivers only into a session nothing else is
 * spoken for, so the agent run it observes is the batch's alone -- the Human's
 * prompts wait in the host until it is over rather than joining it;
 * attributing a boundary inside a turn already running is S-03's open
 * question, and this does not rely on an answer to it. And delivery is the
 * host's alone: the broker serves these two methods for the Principal only to
 * the host process, so nothing the model runs can mark its own mail read.
 */
import type { BoundaryEvidence, PreparedBatch, ProtocolLimits } from "@oma/contracts";
import { createBrokerChannel } from "./broker-channel.js";
import { StoreError } from "@oma/domain/errors";
import { deliveryDecision, observeDeliveryReceipt, publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import type { CheckedReceipt } from "@oma/contracts/runtime";
import { runnerReceiptPathAt } from "@oma/domain/paths";
import { boundaryOf } from "@oma/engine/pi-adapter";
import type { PiEvent } from "@oma/engine/pi-rpc";

/** What the delivery needs from the live session. */
export interface DeliverySession {
  readonly running: boolean;
  /** True while the session is spoken for -- by the run in progress, or by a
   * Human prompt already typed and waiting for it. */
  readonly busy: boolean;
  onEvent(listener: (event: PiEvent) => void): () => void;
  /** Claims the session and asks the extension to present the batch. Throws
   * `BATCH_CONFLICT` if the session was claimed in the meantime. The session
   * itself gives the claim back when the command provably started no run (not
   * written, or refused by the engine); D06/WP09: nothing else may, because an
   * unanswered command's run may be going. */
  deliver(batchId: string): Promise<void>;
}

/** The broker's two delivery methods, as the host calls them. */
export interface DeliveryBroker {
  prepare(): Promise<PreparedBatch | null>;
  complete(evidence: BoundaryEvidence): Promise<void>;
}

/** D01/WP08: "delivered" means this tick presented the batch to the engine and
 * completed it; "settled" means the engine had already produced the batch's
 * boundary and only its completion was retried -- no second presentation.
 * Neither says every notification reached the Human exactly once. */
export type DeliveryOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "delivered"; readonly batchId: string; readonly messages: number }
  | { readonly kind: "settled"; readonly batchId: string }
  | { readonly kind: "deferred"; readonly reason: string }
  | { readonly kind: "failed"; readonly batchId: string; readonly phase: DeliveryPhase; readonly reason: string };
/** Where a delivery stopped (WP08.04): the same error code means different
 * things in different phases, so the phase decides the handling. */
export type DeliveryPhase = "evidence" | "claim" | "engine" | "receipt" | "complete";
/** At most this many batches are remembered as recently failed; a batch leaves
 * the record when it settles or is delivered. */
const FAILED_BATCHES = 64;

/** The host's client for the Principal host endpoint. One short connection
 * per call, the same way the model-facing CLI talks to the broker. */
export function principalHostBroker(runRoot: string, limits: Pick<ProtocolLimits, "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds">): DeliveryBroker {
  const path = `${runRoot.endsWith("/") ? runRoot : `${runRoot}/`}principal-host.sock`;
  const call = async <T>(method: "batch.prepare" | "batch.complete", params: Record<string, unknown>): Promise<T> => {
    const channel = createBrokerChannel(limits);
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
  /** Elapsed time only -- the retry spacing and the accept deadline -- so a
   * monotonic clock by default: a wall clock stepped forward after a sleep
   * would expire every deadline at once, and stepped back would hold one
   * open (MAC-650). */
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

  /** One step: deliver or settle at most one batch. Safe to call from a timer,
   * from a turn settling and from the broker becoming ready; overlapping calls
   * do nothing.
   *
   * D01/WP08: the prepared batch's own receipt is examined before anything
   * else. A verified receipt means the engine already produced this batch's
   * boundary, so only the completion is retried -- with the first receipt's
   * session path -- and no second model turn starts, busy session or not.
   * Unavailable or conflicting evidence delivers nothing and is kept. Only a
   * proven-absent receipt lets the batch be presented. */
  async tick(): Promise<DeliveryOutcome> {
    if (this.inFlight) return { kind: "deferred", reason: "a delivery is already in flight" };
    if (!this.session.running) return { kind: "deferred", reason: "the principal session has ended" };
    this.inFlight = true;
    const at: { phase: DeliveryPhase } = { phase: "evidence" };
    let batch: PreparedBatch | null = null;
    try {
      batch = await this.broker.prepare();
      if (batch === null) return { kind: "idle" };
      const now = (this.options.now ?? performance.now.bind(performance))();
      const failed = this.failedAt.get(batch.id);
      if (failed !== undefined && now - failed < this.options.retryAfterMs)
        return { kind: "deferred", reason: `batch ${batch.id} failed recently` };
      // What the receipt means is the receipt decision's (D01, P0-2).
      const decision = deliveryDecision(observeDeliveryReceipt(this.options.stateRoot, batch, this.options.frameBytes));
      if (decision.action === "hold") throw decision.error;
      if (decision.action === "settle") {
        at.phase = "complete";
        await this.complete(batch, decision.receipt);
        this.failedAt.delete(batch.id);
        return { kind: "settled", batchId: batch.id };
      }
      // A new presentation needs a session nothing else is speaking for.
      if (this.session.busy) return { kind: "deferred", reason: "the principal session is in a turn" };
      const receipt = await this.deliverOne(batch, next => { at.phase = next; });
      at.phase = "complete";
      await this.complete(batch, receipt);
      this.failedAt.delete(batch.id);
      return { kind: "delivered", batchId: batch.id, messages: batch.messageIds.length };
    } catch (error) {
      // Losing the race for the session is not a failed delivery: the batch
      // stays prepared and the next tick takes it, with no back-off. The same
      // code in any other phase is a real failure and backs off.
      if (at.phase === "claim" && error instanceof StoreError && error.code === "BATCH_CONFLICT")
        return { kind: "deferred", reason: "the principal session was claimed first" };
      if (batch === null) throw error;
      this.rememberFailure(batch.id);
      return { kind: "failed", batchId: batch.id, phase: at.phase, reason: error instanceof Error ? error.message : String(error) };
    } finally { this.inFlight = false; }
  }

  private rememberFailure(batchId: string): void {
    this.failedAt.delete(batchId);
    this.failedAt.set(batchId, (this.options.now ?? performance.now.bind(performance))());
    while (this.failedAt.size > FAILED_BATCHES) this.failedAt.delete(this.failedAt.keys().next().value!);
  }

  /** The broker completes the batch only against its first receipt. */
  private async complete(batch: PreparedBatch, receipt: CheckedReceipt): Promise<void> {
    await this.broker.complete({
      batchId: batch.id, incarnation: batch.incarnation, sessionPath: receipt.sessionPath,
      adapterRevision: receipt.adapterRevision,
      receiptPath: runnerReceiptPathAt(this.options.stateRoot, batch.agent, batch.id),
    });
  }

  /** Presents the batch and returns the first durable receipt of its
   * boundary. Completion is the caller's, so a failed completion is retried
   * from the receipt instead of presenting the batch again. */
  private async deliverOne(batch: PreparedBatch, enter: (phase: DeliveryPhase) => void): Promise<CheckedReceipt> {
    let accepted: boolean | null = null;
    let settled = false;
    let lastStop = "";
    let ended = false;
    let boundary: ReturnType<typeof boundaryOf> = null;
    let wake: () => void = () => {};
    const changed = (): Promise<void> => new Promise(resolve => { wake = resolve; });
    let next = changed();
    const unsubscribe = this.session.onEvent(event => {
      if (event.type === "response" && event.id === batch.id && event.command === "prompt")
        accepted = event.success === true;
      if (event.type === "message_end") {
        // Remembered, not acted on. A failed assistant message is not the end
        // of the run: Pi retries a retryable one and compacts before
        // continuing, so only the last one before the run settles says how the
        // delivery actually ended.
        const message = event.message;
        if (message && typeof message === "object" && !Array.isArray(message) &&
          (message as Record<string, unknown>).role === "assistant")
          lastStop = String((message as Record<string, unknown>).stopReason ?? "");
      }
      if (event.type === "agent_settled") settled = true;
      const decoded = boundaryOf(event, batch);
      if (decoded) boundary = decoded;
      wake();
    });
    try {
      enter("claim");
      await this.session.deliver(batch.id);
      enter("engine");
      const acceptBy = (this.options.now ?? performance.now.bind(performance))() + this.options.acceptMs;
      // Wait for the engine's answer, then for the turn to settle. There is no
      // deadline on the turn itself: a model thinking about its mail is not a
      // failure, and a batch abandoned mid-turn would be delivered twice.
      for (;;) {
        if (!this.session.running) { ended = true; break; }
        if (accepted === false) throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "the engine refused the delivery command");
        if (settled) {
          if (boundary !== null) break;
          if (["error", "aborted"].includes(lastStop))
            throw new StoreError("PROVIDER_FAILED", "the principal's provider failed while delivering mail");
          if (accepted === true) throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "the turn settled without a delivery boundary");
        }
        const waitMs = accepted === null ? Math.max(0, acceptBy - (this.options.now ?? performance.now.bind(performance))()) : 1000;
        if (accepted === null && waitMs === 0)
          throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "the engine did not accept the delivery command in time");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([next, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(waitMs, 1000)); timer.unref?.(); })]);
        } finally { clearTimeout(timer); }
        next = changed();
      }
      if (ended) throw new StoreError("PRINCIPAL_DISCONNECTED", "the principal session ended during delivery");
      const confirmed = boundary!;
      // The receipt is the runner's record of the boundary, written beside the
      // Resident's. Publication returns the first valid receipt, which is the
      // one the batch is completed against from now on.
      enter("receipt");
      return publishDeliveryReceipt(this.options.stateRoot, batch, confirmed, this.options.frameBytes);
    } finally {
      // D06/WP09: an unanswered or unsettled delivery keeps the session. Its
      // run may be going; only settlement, the engine's refusal or the
      // session's end gives the claim back, never this owner's timeout.
      unsubscribe();
    }
  }
}
