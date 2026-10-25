import { RestartPolicy } from "@oma/process/restart-policy";
/** TUI-002/LIFE-006: the product starts, owns and keeps its own society.
 *
 * `oma` is one command, so the broker cannot be something the user starts
 * separately. This owns that child:
 *
 *  - It declines to start a second broker when one is already listening. A
 *    broker it did not start is never stopped and never supervised -- another
 *    `oma` owns it -- and it hands this process no Principal authority.
 *  - It holds the broker's supervision channel. The broker says on it when its
 *    endpoints are listening, which is the only readiness signal worth
 *    waiting for; a pid appearing is not one. The same channel carries the
 *    Principal engine's registration and credential, and its closing is how
 *    the broker learns this process died, however it died.
 *  - When a broker it started ends unexpectedly it starts another, and tells
 *    its listener each time one becomes ready, so the Principal is registered
 *    with the new broker and receives the new credential. Restarts are bounded:
 *    a broker that cannot stay up is reported, not restarted forever.
 *
 * The singleton guarantee is not here, and it is not the broker's lock either.
 * The broker's lock answers "may this process be the society's single SQLite
 * writer", and it dies with the broker, so it cannot answer "may this `oma`
 * run the society's one engine" -- every restart gap would be a gap in that
 * answer. The host holds a lease of its own for that (`society-lease.ts`).
 *
 * What this handle reports is whether the host's own broker is working, and
 * the product acts on those reports rather than on the spawn: `onReady`, which
 * the broker sends only after it holds its lock, and `onDisowned`, which says
 * this process will not get a working broker for the society at all. A child
 * that exits with the ownership status is disowned and never restarted --
 * restarting it would only lose the same race again. `onDisowned` is a
 * teardown signal, not a notice: the host gives up the society lease when it
 * arrives, so everything the host ran on the strength of that lease must be
 * stopped by then.
 */
import type { Socket } from "node:net";
import { endpointListening } from "@oma/client/connection";
import { join } from "node:path";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, spawnSupervisedService, type ChildProcess } from "@oma/process/async";
import { SOCIETY_OWNED_EXIT } from "@oma/native/process-lock";
import { launchLocationArgv } from "./assets.js";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD, HostChannelReader, encodeHostMessage } from "@oma/protocol/host-channel";

export type BrokerState =
  | { readonly kind: "already-running" }
  | { readonly kind: "started"; readonly pid: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface BrokerHandle {
  readonly state: BrokerState;
  /** Called each time a broker this handle started reports its endpoints are
   * listening: at first start and after every restart. Never called for a
   * broker this handle did not start.
   *
   * It grants broker authority, not the private conversation's lifetime: the
   * host's inherited lease owns that lifetime even while startup is pending.
   * Registration and Society delivery wait for this signal. */
  onReady(listener: () => void): void;
  /** Called whenever a broker this handle started ends, before anything is
   * decided about restarting it.
   *
   * Everything a ready broker authorised stops being true here. The Principal
   * registration above all: the credential was minted by that broker and dies
   * with it, so a product that kept delivering between this and the next
   * `onReady` would be pushing work into an engine no live broker has accepted
   * as the Principal. */
  onLost(listener: () => void): void;
  /** Called once, when this process is known not to own the society's broker:
   * another one was already listening, none could be started, the child
   * reported the society already has an owner, or restarts ran out. Called at
   * once if that is already known when the listener is added. */
  onDisowned(listener: (reason: string) => void): void;
  /** Names the engine this process started for the Principal and returns the
   * credential the current broker minted for it, or null when there is no
   * broker of this process's to ask, or it refused. */
  register(sessionHandle: string, pid: number): Promise<string | null>;
  /** Stops only a broker this handle started, and stops restarting it. */
  /** Stops the broker; resolves once it has exited. */
  stop(): Promise<void>;
}

/** Endpoint absence is not broker death; the society lease still owns
 * admission. An inconclusive observation never authorizes a new spawn. */
export function brokerListening(runRoot: string, timeoutMs = 500): Promise<boolean> {
  return endpointListening(join(runRoot, "admin.sock"), timeoutMs);
}

export interface SuperviseOptions {
  readonly node: string;
  readonly libdir: string;
  readonly society: string;
  /** D03: the host's resolved location, handed to the broker whole so that it
   * and every unit it renders use the same configuration and roots. */
  readonly stateRoot: string;
  readonly runRoot: string;
  readonly configPath: string;
  /** The bound project whose initial snapshot this broker prepares. */
  readonly projectDir?: string;
  /** The society lease descriptor, inherited by the broker so that the society
   * cannot pass to another host while a process that can still write to it is
   * alive (REC-007). */
  readonly fence?: number | undefined;
  /** Receives one line whenever the child says something or ends. */
  readonly onEvent?: (line: string) => void;
  /** Restart policy: at most this many unexpected ends within the window. */
  readonly maxRestarts?: number;
  readonly restartWindowMs?: number;
  /** How long a registration may wait for the broker's answer. */
  readonly registerTimeoutMs?: number;
}

interface Generation {
  readonly child: ChildProcess;
  readonly channel: Socket;
  ready: boolean;
  /** The registration awaiting the broker's answer, if any, and the session it
   * is waiting for. The answer is correlated against that handle: an answer to
   * a registration this process is no longer waiting for -- a late one from a
   * session since replaced -- must not settle the one that is. */
  pending: { readonly sessionHandle: string; readonly settle: (credential: string | null) => void } | null;
}

/** A handle for a society this process does not own. It supervises nothing and
 * never becomes ready, so nothing gated on readiness can run behind it. */
function disownedHandle(state: BrokerState, reason: string): BrokerHandle {
  return {
    state,
    onReady: () => {},
    onLost: () => {},
    onDisowned: listener => { listener(reason); },
    register: async () => null,
    stop: () => Promise.resolve(),
  };
}

export async function superviseBroker(options: SuperviseOptions): Promise<BrokerHandle> {
  if (await brokerListening(options.runRoot))
    return disownedHandle({ kind: "already-running" }, "another oma already owns this society");

  const say = options.onEvent ?? (() => {});
  const readyListeners: (() => void)[] = [];
  const lostListeners: (() => void)[] = [];
  const disownedListeners: ((reason: string) => void)[] = [];
  let disowned: string | null = null;
  /** Said once and never taken back: ownership is not something this process
   * regains by trying again. */
  const disown = (reason: string): void => {
    if (disowned !== null) return;
    disowned = reason;
    for (const listener of disownedListeners) listener(reason);
  };
  const maxRestarts = options.maxRestarts ?? 5;
  const windowMs = options.restartWindowMs ?? 60_000;
  const restarts = new RestartPolicy(maxRestarts, windowMs);
  let stopping = false;
  let current: Generation | null = null;
  let restarting: ReturnType<typeof setTimeout> | null = null;
  let closing: Promise<void> | null = null;

  /** Settles the registration this answer is for, and only that one. An answer
   * that names a session nothing is waiting for is a late answer to a
   * registration already superseded or timed out; it is reported and dropped,
   * never applied to whatever happens to be pending. */
  const settlePending = (generation: Generation, sessionHandle: string, credential: string | null): void => {
    const pending = generation.pending;
    if (pending === null) { say("broker answered a principal registration nothing is waiting for"); return; }
    if (pending.sessionHandle !== sessionHandle) {
      say("broker answered a principal session this process is not waiting for; ignoring it");
      return;
    }
    generation.pending = null;
    pending.settle(credential);
  };

  const start = (): Generation | string => {
    let child: ChildProcess;
    try {
      // The broker is told this process's location explicitly and is also
      // handed its environment rather than a reduced one. The channel marker
      // names a descriptor; nothing secret is ever put here.
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
      env[HOST_CHANNEL_ENV] = String(HOST_CHANNEL_FD);
      // The broker is told which descriptor its society lease is on, on the
      // same rule as every other fenced child: a process that must decide
      // whether it owns the society should read that from the product rather
      // than infer it from how it happened to be started.
      if (options.fence !== undefined) env[SOCIETY_FENCE_ENV] = String(SOCIETY_FENCE_FD);
      child = spawnSupervisedService(options.node, [join(options.libdir, "apps/oma/dist/entry/broker.js"),
        "--society", options.society, ...launchLocationArgv(options),
        ...(options.projectDir === undefined ? [] : ["--project-dir", options.projectDir])], env, true, options.fence);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    // P0V-27, P0-4: a spawn that failed returns a child with no pid and says
    // why in an `error` event afterwards. It is observed from here, before any
    // path below can return, so that report reaches the Human instead of
    // ending this process as an unhandled event.
    // A failed termination can emit another error before the queued spawn
    // failure. Observe both for the whole owned child's lifetime.
    child.on("error", error => { say(`broker failed: ${error.message}`); });
    const channel = child.stdio[HOST_CHANNEL_FD];
    if (child.pid === undefined || !channel || !("write" in channel)) {
      if (child.pid !== undefined) child.kill("SIGKILL");
      return "the broker process did not start";
    }
    const generation: Generation = { child, channel: channel as Socket, ready: false, pending: null };
    const reader = new HostChannelReader(message => {
      if (current !== generation) return;
      switch (message.kind) {
        case "ready":
          generation.ready = true;
          for (const listener of readyListeners) listener();
          return;
        case "credential":
          settlePending(generation, message.sessionHandle, message.credential);
          return;
        case "refused":
          say("broker refused the principal engine");
          settlePending(generation, message.sessionHandle, null);
          return;
        case "session":
          // Only a host sends this. A broker that does is not the one we
          // started, or not behaving as one; it is not trusted further.
          say("broker sent a message only a host sends; stopping it");
          child.kill("SIGTERM");
          return;
      }
    }, reason => { say(`broker channel broken: ${reason}`); child.kill("SIGTERM"); });
    generation.channel.on("data", chunk => reader.push(chunk as Buffer));
    generation.channel.on("error", () => {});
    // The broker's stderr is its operational channel. Losing it would turn a
    // refused start into an unexplained absence of status.
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => {
      for (const line of String(chunk).split("\n")) if (line.trim().length > 0) say(line.trim());
    });
    child.once("exit", (code, signal) => {
      generation.pending?.settle(null);
      generation.pending = null;
      // Said for every generation this handle started, including the one being
      // stopped on the way out, and said before any restart decision: whatever
      // this broker authorised is no longer authorised as of now, not as of
      // whenever a replacement turns out to be possible.
      if (generation.ready) { generation.ready = false; for (const listener of lostListeners) listener(); }
      say(`broker ended (${signal ?? `code ${code ?? "unknown"}`})`);
      if (current !== generation || stopping) return;
      current = null;
      // The child lost the race for the society lock. Another process owns the
      // society; a restart would only lose it again, and in the meantime this
      // process must not behave as an owner.
      if (signal === null && code === SOCIETY_OWNED_EXIT) {
        disown("another oma took this society while this one was starting");
        return;
      }
      // The restart window is elapsed time: a wall clock stepped back would
      // keep old restarts inside it and give the broker up (MAC-650).
      const decision = restarts.next();
      if (decision.kind === "exhausted") {
        say(`broker ended ${decision.count} times within ${Math.round(windowMs / 1000)}s; not restarting it`);
        disown("the broker could not stay running");
        return;
      }
      const delay = decision.delayMs;
      const timer = setTimeout(() => {
        if (stopping || restarting !== timer) return;
        restarting = null;
        const next = start();
        if (typeof next === "string") {
          say(`broker could not be restarted: ${next}`);
          disown(`the broker could not be restarted: ${next}`);
          return;
        }
        current = next;
        say("broker restarted");
      }, delay);
      restarting = timer;
      timer.unref?.();
    });
    return generation;
  };

  const first = start();
  if (typeof first === "string")
    return disownedHandle({ kind: "unavailable", reason: first }, `the broker could not be started: ${first}`);
  current = first;

  return {
    // A pid, not a claim of ownership: the child has started, and whether it
    // owns the society is answered later, by onReady or onDisowned.
    state: { kind: "started", pid: first.child.pid! },
    onReady(listener) {
      readyListeners.push(listener);
      if (current?.ready) listener();
    },
    onLost(listener) { lostListeners.push(listener); },
    onDisowned(listener) {
      disownedListeners.push(listener);
      if (disowned !== null) listener(disowned);
    },
    register(sessionHandle, pid) {
      const generation = current;
      if (generation === null || !generation.ready || stopping) return Promise.resolve(null);
      // A registration still waiting is superseded, not left to be settled by
      // the answer to this one.
      if (generation.pending !== null) {
        const superseded = generation.pending;
        generation.pending = null;
        superseded.settle(null);
      }
      return new Promise<string | null>(resolve => {
        const timer = setTimeout(() => {
          if (generation.pending?.settle === settle) generation.pending = null;
          say("broker did not answer the principal registration");
          resolve(null);
        }, options.registerTimeoutMs ?? 10_000);
        timer.unref?.();
        const settle = (credential: string | null): void => { clearTimeout(timer); resolve(credential); };
        generation.pending = { sessionHandle, settle };
        try { generation.channel.write(encodeHostMessage({ kind: "session", sessionHandle, pid })); }
        catch (error) {
          generation.pending = null;
          settle(null);
          say(`principal registration could not be sent: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    },
    stop() {
      if (closing !== null) return closing;
      stopping = true;
      if (restarting !== null) clearTimeout(restarting);
      restarting = null;
      const generation = current;
      current = null;
      if (generation !== null) {
        const pending = generation.pending;
        generation.pending = null;
        pending?.settle(null);
      }
      if (generation === null || generation.child.exitCode !== null || generation.child.signalCode !== null)
        return closing = Promise.resolve();
      // P0-4/P0-5: every caller shares actual exit, not the signal request.
      closing = new Promise<void>(resolve => { generation.child.once("exit", () => resolve()); });
      generation.child.kill("SIGTERM");
      return closing;
    },
  };
}
