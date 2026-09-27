/** The host's end of egress (macos-platform §4.7, §7): the pool of
 * connections it keeps open to the guest, and a relay per run.
 *
 * Nothing about a provider is decided in the guest. A run's placeholder is
 * made here from the credential this host resolved with its own engine state
 * (MAC-704), and each connection an engine opens reaches the provider through
 * the existing `InferenceRelay` -- the same key substitution, header rules,
 * concurrency limit and tripwire as on Linux -- created for that run and
 * listening nowhere: the pool hands it its connections.
 */
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { encodeFrame } from "../../frame.js";
import { StoreError, errorCodeOf } from "../../domain/errors.js";
import { InferenceRelay, type RelayLimits } from "../../runtime/inference-relay.js";
import { placeholderFor, type EngineAuth } from "../../runtime/engine-auth.js";
import { readLeadingFrame } from "../rpc.js";
import { productText } from "../product-text.js";
import {
  egressOpenProblem, egressPlaceholderProblem, requestProblem,
  type EgressOpenParams, type EgressPlaceholderParams, type EgressPlaceholderResult,
} from "../../protocol/host-guest.js";

export interface EgressHostOptions {
  /** Opens one egress connection to the guest and completes its hello. */
  readonly open: () => Promise<{ readonly socket: Socket; readonly rest: Buffer }>;
  /** MAC-704: this host's engine state, never the guest's. */
  readonly resolve: (credentialRef: string, provider: string, model: string) => Promise<EngineAuth>;
  readonly limits: RelayLimits;
  readonly frameBytes: number;
  /** The most connections kept waiting, whatever the runs ask (MAC-225). */
  readonly maxPool: number;
}

type Run = { readonly relay: InferenceRelay; readonly params: EgressPlaceholderParams };

export class EgressHost {
  private readonly runs = new Map<string, Run>();
  private readonly idle = new Set<Socket>();
  private waiting = 0;
  private opening = 0;
  private stopped = false;

  constructor(private readonly options: EgressHostOptions) {}

  /** MAC-225: two spare, and the existing relay's four per run. */
  get target(): number { return Math.min(2 + 4 * this.runs.size, this.options.maxPool); }
  get pooled(): number { return this.waiting; }
  get activeRuns(): number { return this.runs.size; }

  /** Opens connections until the pool is at its target. A failure to open
   * leaves the pool short; the next call tries again. */
  async fill(): Promise<void> {
    while (!this.stopped && this.waiting + this.opening < this.target) {
      this.opening += 1;
      let opened: { socket: Socket; rest: Buffer };
      try { opened = await this.options.open(); }
      catch { this.opening -= 1; return; }
      this.opening -= 1;
      // Stopped while this one was opening: it is not kept.
      if (this.stopped) { opened.socket.destroy(); return; }
      this.waiting += 1;
      void this.await(opened.socket, opened.rest);
    }
  }

  private async await(socket: Socket, rest: Buffer): Promise<void> {
    socket.on("error", () => { socket.destroy(); });
    if (rest.length > 0) socket.unshift(rest);
    this.idle.add(socket);
    let first: { frame: Record<string, unknown>; rest: Buffer };
    try { first = await readLeadingFrame(socket, this.options.frameBytes, Number.POSITIVE_INFINITY); }
    catch { this.idle.delete(socket); this.waiting -= 1; socket.destroy(); void this.fill(); return; }
    this.idle.delete(socket);
    this.waiting -= 1;
    void this.fill();
    const frame = first.frame;
    const problem = requestProblem(frame);
    if (problem !== null || frame.key !== undefined) { socket.destroy(); return; }
    if (frame.method === "egress.placeholder") { await this.placeholder(socket, frame.id as string, frame.params); return; }
    if (frame.method === "egress.open") { this.connect(socket, frame.params, first.rest); return; }
    socket.destroy();
  }

  private async placeholder(socket: Socket, id: string, params: unknown): Promise<void> {
    const answer = (value: Record<string, unknown>): void => { socket.end(encodeFrame({ v: 1, id, ...value })); };
    const problem = egressPlaceholderProblem(params);
    if (problem !== null) { answer({ ok: false, error: { code: "INVALID_REQUEST", message: problem, retry: "never" } }); return; }
    const asked = params as EgressPlaceholderParams;
    try {
      const auth = await this.options.resolve(asked.credentialRef, asked.provider, asked.model);
      const placeholder = placeholderFor(auth.apiKey);
      const relay = InferenceRelay.detached({ origin: auth.origin, headers: auth.headers, substitute: { placeholder, secret: auth.apiKey } }, this.options.limits);
      const placeholderId = randomUUID();
      this.runs.set(placeholderId, { relay, params: asked });
      const result: EgressPlaceholderResult = { placeholderId, placeholder, provider: auth.provider, model: auth.model };
      answer({ ok: true, result });
      void this.fill();
    } catch (error) {
      const code = errorCodeOf(error);
      const message = error instanceof StoreError && productText(error.message) ? error.message : code;
      answer({ ok: false, error: { code, message, retry: "never" } });
    }
  }

  private connect(socket: Socket, params: unknown, rest: Buffer): void {
    const run = egressOpenProblem(params) === null ? this.runs.get((params as EgressOpenParams).placeholderId) : undefined;
    // A placeholder this host did not issue in this boot opens nothing (MAC-712).
    if (run === undefined) { socket.destroy(); return; }
    const opened = params as EgressOpenParams;
    if (opened.society !== run.params.run.society || opened.actor !== run.params.run.actor || opened.incarnation !== run.params.run.incarnation) {
      socket.destroy();
      return;
    }
    run.relay.accept(socket, rest);
  }

  /** The run ended, or the guest rebooted: its placeholder opens nothing more. */
  async release(placeholderId: string): Promise<void> {
    const run = this.runs.get(placeholderId);
    if (run === undefined) return;
    this.runs.delete(placeholderId);
    await run.relay.close();
  }

  /** MAC-211: a new bootId means no placeholder of the last boot is valid. */
  async forgetBoot(): Promise<void> {
    await Promise.all([...this.runs.keys()].map(id => this.release(id)));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const socket of this.idle) socket.destroy();
    await this.forgetBoot();
  }
}
