/** Principal engine admission, prompt/delivery attribution and actual child lifetime. */
import { stopOwnedChild, spawnOwnedRpc, spawnOwnedInteractive, type ChildProcess } from "@oma/process/async";
import { InteractiveChannel, INTERACTIVE_RPC_FD, INTERACTIVE_UI_FD } from "./interactive-channel.js";
import type { FencedEngine } from "@oma/contracts/runtime";
import type { PiRpcStreams } from "./pi-rpc.js";
import type { Socket } from "node:net";
import { HOST_CHANNEL_FD, encodeHostMessage } from "@oma/protocol/host-channel";
import { assertModelScope } from "@oma/domain/paths";
import { PiRpcClient, alarm, assertPiRpcLimits, commandWasNotWritten, type PiEvent, type PiRpcLimits } from "./pi-rpc.js";
import type { EngineStartEffects } from "./ports.js";
import { preparePiRetry } from "./pi-runtime.js";
import { StoreError } from "@oma/domain/errors";
import { CONVERSATION_BOUNDS, TERMINAL_BOUNDS, humanPromptFitsFrame, humanPromptRequestId } from "@oma/domain/surface-bounds";
import { TurnAdmission, type TurnOwner } from "@oma/domain/turn-admission";
import type { PromptOutcome } from "@oma/domain/settings";
import { sessionArgv, sessionEnv, type SessionPaths, type SessionProfile } from "./principal-launch.js";
import { projectEvent, queuePreviewLine } from "./principal-events.js";
export { newSessionHandle, principalSessionDir, principalWorkspace, principalEnvironment,
  sessionArgv, sessionEnv, PACKAGE_STORE_ENV } from "./principal-launch.js";
export type { SessionPaths, SessionProfile, PrincipalPaths } from "./principal-launch.js";
export { projectEvent } from "./principal-events.js";

export interface SessionSink {
  /** Application owns product wording; headless consumers may keep raw errors. */
  readonly errorWords?: (error: unknown) => string;
  /** P0-4: ownership begins before fallible RPC/UI setup, not at constructor return. */
  readonly onAcquire?: (engine: FencedEngine) => void;
  readonly onLine: (line: string) => void;
  readonly onUi?: (event: PiEvent) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly onEnd: (reason: string) => void;
  /** One named prompt did not reach the engine, with the text it was.
   *
   * `reason` is the bare cause, not a sentence: the surface says what failed
   * and where the text went, and a second copy of "could not be sent" here
   * would push that answer off a narrow screen.
   *
   * A prompt typed while a run was going is echoed as sent the moment the
   * session takes it, because that is when the Human is told it was taken. If
   * the write behind it later fails, saying only that "a prompt" failed leaves
   * the Human holding three echoed prompts and no way to tell which of them
   * the Principal never got -- and nothing to resend it from. The text comes
   * back with the failure so the surface can give it back. */
  readonly onPromptFailed: (text: string, reason: string) => void;
  /** D06/WP09: a Human prompt that was written, but whose acceptance the
   * engine never answered before the session ended. It is not handed back as
   * unsent and never resent automatically: the engine may have taken it. */
  readonly onPromptUnconfirmed?: (text: string, reason: string) => void;
}

export class PrincipalSession {
  private errorWords(error: unknown): string {
    return this.sink.errorWords ? this.sink.errorWords(error) : error instanceof Error ? error.message : String(error);
  }
  private readonly rpc: PiRpcClient;
  private ui: InteractiveChannel | null = null;
  private ready = true;

  sendUi(event: PiEvent): void { this.ui?.send(event); }
  private readonly channel: Socket;
  private sequence = 0;
  private closed = false;
  private readonly frameBytes: number;
  private readonly turns = new TurnAdmission();

  /** Resolves when the operating system has reaped the engine, not when this
   * process asked it to stop. `close()` sends a signal; a teardown that took
   * the signal for the death could release the society while the engine it
   * paid for was still running. */
  readonly exited: Promise<void>;

  private constructor(private readonly child: ChildProcess, limits: PiRpcLimits, private readonly sink: SessionSink,
    streams?: PiRpcStreams, uiSocket?: Socket) {
    this.frameBytes = limits.frameBytes;
    this.exited = new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once("exit", () => { resolve(); });
      // P0V-73, P0-4: a spawn that failed never had a process -- `error` with no
      // pid, then `close`, and no `exit` -- and that is its terminal fact. An
      // error from a process that did start (a kill that failed) is not its end.
      child.once("error", () => { if (child.pid === undefined) resolve(); });
    });
    let rpc: PiRpcClient | null = null;
    let startup: ReturnType<typeof alarm> | null = null;
    try {
      sink.onAcquire?.({
        exited: this.exited,
        close: () => {
          if (rpc === null || this.closed) stopOwnedChild(child);
          else this.close();
        },
      });
      rpc = this.rpc = new PiRpcClient(child, limits, streams, uiSocket ? () => {
        child.kill("SIGTERM");
        const deadline = alarm(TERMINAL_BOUNDS.interactiveExitSeconds.value, () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        });
        void this.exited.then(() => deadline.cancel());
      } : undefined);
      if (uiSocket) {
        this.ready = false;
        startup = alarm(limits.receiptWaitSeconds, () => this.close());
        let sequence = 0;
        let last: PiEvent | undefined;
        this.ui = new InteractiveChannel(uiSocket, limits, event => {
          if (event.type === "ready") {
            if (this.ready) { this.close(); return; }
            startup?.cancel(); this.ready = true; this.sink.onBusy(this.busy);
          } else if (!this.ready) { this.close(); return; }
          if (event.type === "human_input") {
            if (last && event.id === last.id) { this.ui?.send(last); return; }
            if (event.id !== `ui-${sequence + 1}` || typeof event.text !== "string") { this.close(); return; }
            sequence += 1;
            // Said so the screen can tell the Human the prompt waits its turn.
            const queued = this.busy;
            const outcome = this.submit(event.text);
            last = { type: "input_result", id: event.id, accepted: outcome.kind === "accepted",
              ...(outcome.kind === "refused" ? { reason: outcome.reason } : { queued }) };
            this.ui?.send(last);
          } else if (["ready", "quit", "panel_open", "panel_size", "panel_key", "sessions_request", "switch", "engine_state", "worker_model"].includes(event.type))
            this.sink.onUi?.(event);
          else this.close();
        }, () => { startup?.cancel(); this.close(); });
      }
      // The private socket the credential travels on. Kept open for the life of
      // the session so a restarted broker's credential can replace the old one.
      this.channel = child.stdio[HOST_CHANNEL_FD] as unknown as Socket;
      this.channel.on("error", () => {});
      this.rpc.onEvent(event => this.observe(event));
      void this.rpc.completion.then(async result => {
        this.closed = true;
        this.ui?.close();
        const reason = result.state === "failed"
          ? `Session ended with an error: ${this.errorWords(result.error)}`
          : "Session ended.";
        this.handBack(reason);
        this.turns.settle();
        this.sink.onBusy(false);
        if (uiSocket) await this.exited;
        this.sink.onEnd(reason);
      });
    } catch (error) {
      // No completed session was handed to the host. Returning partial owners
      // must not emit onEnd or invite another prompt into this failed session.
      this.closed = true;
      startup?.cancel();
      const errors: unknown[] = [error];
      try { this.ui?.close(); } catch (cleanup) { errors.push(cleanup); }
      try { rpc?.close(); } catch (cleanup) { errors.push(cleanup); }
      try { stopOwnedChild(child); } catch (cleanup) { errors.push(cleanup); }
      if (errors.length > 1) throw new AggregateError(errors, "Principal setup and cleanup failed");
      throw error;
    }
  }

  static start(effects: EngineStartEffects, paths: SessionPaths, profile: SessionProfile, limits: PiRpcLimits, env: Readonly<Record<string, string>>, sink: SessionSink): PrincipalSession {
    // Validate before spawn: a constructor refusal must leave no ownerless child.
    assertPiRpcLimits(limits);
    // TUI-010: the digests recorded for this role are checked again here, at the
    // last moment before the file is handed to Pi.
    effects.assertExtensions(profile.extensions);
    // PR-004: the model's tools are confined to `workspace`, which holds
    // neither the Human's session history nor the engine's credentials.
    assertModelScope(paths.workspace, [paths.sessionDir, ...(paths.piAgentDir === undefined ? [] : [paths.piAgentDir])]);
    if (paths.piAgentDir !== undefined) preparePiRetry(effects.settings, paths.piAgentDir);
    if (paths.interactiveEntry !== undefined) {
      if (paths.fence === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "interactive session requires its lease descriptor");
      const child = spawnOwnedInteractive(paths.piCommand, ["--import", new URL("./pi-compat/interactive-tool-setup.js", import.meta.url).href,
        paths.interactiveEntry, ...sessionArgv(paths, profile)], paths.workspace,
        { ...sessionEnv(env, profile, paths), OMA_UI_IDLE_SECONDS: String(limits.idleStreamSeconds),
          OMA_UI_RECEIPT_SECONDS: String(limits.receiptWaitSeconds), OMA_PROJECT_DISPLAY: paths.project ?? paths.workspace,
          ...(paths.sessionFile === undefined ? {} : { OMA_SESSION_FILE: paths.sessionFile }),
          TERM: process.env.TERM ?? "xterm-256color", ...(process.env.COLORTERM ? { COLORTERM: process.env.COLORTERM } : {}) }, paths.fence);
      const channels: readonly unknown[] = child.stdio;
      const rpc = channels[INTERACTIVE_RPC_FD] as Socket;
      return new PrincipalSession(child, limits, sink, { stdin: rpc, stdout: rpc, stderr: child.stderr! },
        channels[INTERACTIVE_UI_FD] as Socket);
    }
    const child = spawnOwnedRpc(
      paths.piCommand,
      [...(paths.piArgs ?? []), ...sessionArgv(paths, profile)],
      paths.workspace,
      sessionEnv(env, profile, paths),
      true,
      paths.fence,
    );
    return new PrincipalSession(child, limits, sink);
  }

  /** The one place the session's state moves in answer to the engine. */
  private observe(event: PiEvent): void {
    if (event.type === "response" && event.command === "prompt") {
      const prompt = this.turns.response(event.id);
      if (prompt !== null && event.success !== true) {
        const { role, text } = prompt;
        // Refused before acceptance: no run starts and none settles, so the
        // claim has to be given back here or the session would stay the
        // refused prompt's for the rest of its life -- and the Human would
        // never learn that what they typed was not taken.
        const detail = typeof event.error === "string" && event.error.length > 0 ? event.error : "Unknown reason";
        // A Human prompt is named and handed back; a delivery command is the
        // product's own text and there is nothing to give back.
        if (role === "human") this.sink.onPromptFailed(text, `The engine did not accept the input: ${detail}`);
        else this.sink.onLine(`⚠ The engine rejected the input: ${detail}`);
        this.release(role);
      }
    }
    // Pi settles a whole run, retries and queued continuations included, not
    // one prompt. One of these ends whatever this session was running.
    if (event.type === "agent_settled") this.free();
    const projected = projectEvent(event);
    if (projected.line !== undefined) this.sink.onLine(projected.line);
  }

  private reportBusy(): void { this.sink.onBusy(this.busy); }

  /** B3: the waiting queue's picture for the screen's above-editor widget.
   * The queue itself is the fact; this is only a bounded, single-line copy
   * sent on every change, so the widget never shows a stale count. Empty
   * clears the widget; a session without the interactive channel has no
   * screen to tell. */
  private emitQueue(): void {
    const waiting = this.turns.queued;
    this.ui?.send({ type: "queued_prompts", total: waiting.length,
      prompts: waiting.slice(0, CONVERSATION_BOUNDS.queuePreviewPrompts.value).map(queuePreviewLine) });
  }

  /** The run is over. A Human prompt that was waiting takes the session here,
   * synchronously, so nothing can start between the two steps. */
  private free(): void {
    if (this.closed) return;
    const next = this.turns.settle();
    this.emitQueue();
    this.reportBusy();
    if (next !== null) this.write(next);
  }

  /** Writes one Human prompt the session already belongs to. A prompt refused
   * before any byte was written is handed back and the next one goes; one
   * whose write began and failed ended the transport, so the session's end
   * reports it as unconfirmed rather than unsent (D06). */
  private write(text: string): void {
    void this.sendPrompt(this.nextRequestId(), text, "human").catch((error: unknown) => {
      if (!commandWasNotWritten(error)) return;
      this.sink.onPromptFailed(text, this.errorWords(error));
      this.release("human");
    });
  }

  /** D06/WP09: once, when the session ends or is closed. Waiting prompts were
   * never written: each goes back, in the order typed. A written prompt the
   * engine never answered is reported apart and is not resent. */
  private handBack(reason: string): void {
    const { unconfirmed, unsent } = this.turns.end();
    if (unconfirmed !== null) this.sink.onPromptUnconfirmed?.(unconfirmed, reason);
    for (const text of unsent) this.sink.onPromptFailed(text, reason);
    this.emitQueue();
  }

  private nextRequestId(): string {
    this.sequence += 1;
    return humanPromptRequestId(this.sequence);
  }

  /** Writes one prompt and remembers that the engine has yet to accept it. */
  private async sendPrompt(id: string, message: string, role: "human" | "delivery"): Promise<void> {
    this.turns.writing(id, message, role);
    try { await this.rpc.send({ id, type: "prompt", message }); }
    catch (error) {
      // Only a command that was provably not written is no longer awaiting an
      // answer; after a partial write acceptance stays unknown.
      if (commandWasNotWritten(error)) this.turns.notWritten(id);
      throw error;
    }
  }

  get running(): boolean { return !this.closed; }

  /** The engine's pid, which the broker checks is this process's own child
   * before it accepts the engine as the Principal. */
  get pid(): number | null { return this.closed ? null : this.child.pid ?? null; }

  /** True while the session is spoken for. A Human prompt that arrives while it
   * is takes the session the moment the run ends, in the same step that ends
   * it, so this never reads false with one still waiting. Delivery waits for
   * it to clear so a batch's boundary is never confused with a Human's turn. */
  get busy(): boolean { return this.ready === false || this.turns.busy; }

  /** Hands the engine its credential on the private socket. A new one simply
   * replaces the previous one; the old broker that minted it is gone. */
  grant(credential: string, sessionHandle: string): void {
    if (this.closed || this.channel.destroyed) return;
    this.channel.write(encodeHostMessage({ kind: "credential", credential, sessionHandle }));
  }

  /** Every event the engine emits, for the delivery owner. */
  onEvent(listener: (event: PiEvent) => void): () => void { return this.rpc.onEvent(listener); }

  /** PR-002: asks the trusted extension to present a prepared batch. The
   * session is claimed first, so the run this starts is the batch's alone and
   * the boundary the extension reports for it belongs to no one else. */
  async deliver(batchId: string): Promise<void> {
    if (this.closed) throw new StoreError("PRINCIPAL_DISCONNECTED", "the principal session has ended");
    // Claimed before the command is written, and given back if it cannot be.
    if (!this.ready || !this.turns.claimDelivery())
      throw new StoreError("BATCH_CONFLICT", "the principal session is already spoken for");
    this.reportBusy();
    try { await this.sendPrompt(batchId, `/oma-deliver ${batchId}`, "delivery"); }
    catch (error) {
      // A command that was never written starts no run; any other failure
      // ended the transport, and the claim ends with the session.
      if (commandWasNotWritten(error)) this.release("delivery");
      throw error;
    }
  }

  /** Gives the session back if this owner still holds it, and lets whatever
   * the Human has waiting take it. D06/WP09: only for a run that provably did
   * not start -- a command refused before it was written, or refused by the
   * engine. An unanswered command is not one: its run may be going, and
   * handing the session to a waiting Human prompt would put that prompt into
   * it. Settlement, refusal or the session's end ends that claim. */
  release(owner: TurnOwner): void {
    if (this.closed) return;
    const outcome = this.turns.release(owner);
    if (!outcome.released) return;
    this.emitQueue();
    this.reportBusy();
    if (outcome.next !== null) this.write(outcome.next);
  }

  /** The Human is never made to wait for mail, and never has to retype. A
   * prompt typed while the session is spoken for waits here in order and is
   * written the moment the session is free; it is never folded into the run
   * already going, so that run keeps its own boundary.
   *
   * Whether this session took the prompt is answered here, synchronously, for
   * the same reason ownership is claimed synchronously: the screen shows what
   * was accepted, and an answer that arrives after the screen has drawn is an
   * answer about a prompt the Human has already been told was sent. Everything
   * that decides acceptance -- closed, over the frame, no room left to wait --
   * is known in this call. What cannot be known here is whether the write
   * itself will succeed; that failure is reported into the transcript the same
   * way a failed write from the waiting queue is.
   */
  submit(text: string): PromptOutcome {
    if (this.ready === false) return { kind: "refused", reason: "Preparing the conversation UI." };
    if (this.closed) {
      this.sink.onEnd("Cannot send: the session has ended.");
      return { kind: "refused", reason: "Session ended." };
    }
    if (!humanPromptFitsFrame(text, this.frameBytes))
      return { kind: "refused", reason: "Input exceeds this session's UTF-8 prompt limit." };
    const claim = this.turns.claimHuman(text);
    if (claim === "full")
      return { kind: "refused", reason: `Only ${TurnAdmission.WAITING} prompts may wait. Try again after the current response finishes.` };
    if (claim === "queued") this.emitQueue();
    else { this.reportBusy(); this.write(text); }
    return { kind: "accepted" };
  }

  /** Quitting hands back what never reached the engine before the transport
   * closes; the completion that follows finds nothing left to hand back. */
  close(): void {
    if (this.closed) return;
    this.handBack("Session closed.");
    this.closed = true;
    this.ui?.close();
    this.rpc.close();
  }
}
