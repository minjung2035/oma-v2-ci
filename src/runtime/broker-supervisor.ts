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
 * The singleton guarantee is not here: the broker takes an exclusive lock on
 * its own run root and refuses to run twice.
 */
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { spawnSupervisedService, type ChildProcess } from "../process/async.js";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD, HostChannelReader, encodeHostMessage } from "../protocol/host-channel.js";

export type BrokerState =
  | { readonly kind: "already-running" }
  | { readonly kind: "started"; readonly pid: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface BrokerHandle {
  readonly state: BrokerState;
  /** Called each time a broker this handle started reports its endpoints are
   * listening: at first start and after every restart. Never called for a
   * broker this handle did not start. */
  onReady(listener: () => void): void;
  /** Names the engine this process started for the Principal and returns the
   * credential the current broker minted for it, or null when there is no
   * broker of this process's to ask, or it refused. */
  register(sessionHandle: string, pid: number): Promise<string | null>;
  /** Stops only a broker this handle started, and stops restarting it. */
  stop(): void;
}

/** Answers whether a broker is listening by connecting to its admin endpoint.
 * A refused connection is the absence of a broker; anything else is left as an
 * unknown so a spawn is not skipped on an inconclusive probe. */
export function brokerListening(runRoot: string, timeoutMs = 500): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const socket = connect(join(runRoot, "admin.sock"));
    const finish = (listening: boolean): void => { socket.destroy(); resolve(listening); };
    socket.setTimeout(timeoutMs, () => { finish(false); });
    socket.once("connect", () => { finish(true); });
    socket.once("error", () => { finish(false); });
  });
}

export interface SuperviseOptions {
  readonly node: string;
  readonly libdir: string;
  readonly society: string;
  readonly runRoot: string;
  readonly configPath: string;
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
  /** The registration awaiting the broker's answer, if any. */
  answer: ((credential: string | null) => void) | null;
}

export async function superviseBroker(options: SuperviseOptions): Promise<BrokerHandle> {
  if (await brokerListening(options.runRoot))
    return { state: { kind: "already-running" }, onReady: () => {}, register: async () => null, stop: () => {} };

  const say = options.onEvent ?? (() => {});
  const readyListeners: (() => void)[] = [];
  const maxRestarts = options.maxRestarts ?? 5;
  const windowMs = options.restartWindowMs ?? 60_000;
  const restarts: number[] = [];
  let stopping = false;
  let current: Generation | null = null;

  const start = (): Generation | string => {
    let child: ChildProcess;
    try {
      // The broker derives its own state and run roots from the environment, so
      // it is handed this process's environment rather than a reduced one. The
      // channel marker names a descriptor; nothing secret is ever put here.
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
      env[HOST_CHANNEL_ENV] = String(HOST_CHANNEL_FD);
      child = spawnSupervisedService(options.node, [join(options.libdir, "dist/src/entry/broker.js"),
        "--society", options.society, "--config", options.configPath], env, true);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    const channel = child.stdio[HOST_CHANNEL_FD];
    if (child.pid === undefined || !channel || !("write" in channel)) {
      child.kill("SIGKILL");
      return "the broker process did not start";
    }
    const generation: Generation = { child, channel: channel as Socket, ready: false, answer: null };
    const reader = new HostChannelReader(message => {
      if (current !== generation) return;
      switch (message.kind) {
        case "ready":
          generation.ready = true;
          for (const listener of readyListeners) listener();
          return;
        case "credential":
          generation.answer?.(message.credential);
          generation.answer = null;
          return;
        case "refused":
          say("broker refused the principal engine");
          generation.answer?.(null);
          generation.answer = null;
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
    child.once("error", error => { say(`broker failed: ${error.message}`); });
    child.once("exit", (code, signal) => {
      generation.answer?.(null);
      generation.answer = null;
      say(`broker ended (${signal ?? `code ${code ?? "unknown"}`})`);
      if (current !== generation || stopping) return;
      current = null;
      const now = Date.now();
      while (restarts.length > 0 && now - restarts[0]! > windowMs) restarts.shift();
      if (restarts.length >= maxRestarts) {
        say(`broker ended ${restarts.length} times within ${Math.round(windowMs / 1000)}s; not restarting it`);
        return;
      }
      restarts.push(now);
      // Doubling back-off within the window, so a broker that fails at once
      // does not spin; the first restart is quick because most ends are not.
      const delay = Math.min(250 * 2 ** (restarts.length - 1), 8000);
      setTimeout(() => {
        if (stopping) return;
        const next = start();
        if (typeof next === "string") { say(`broker could not be restarted: ${next}`); return; }
        current = next;
        say("broker restarted");
      }, delay).unref?.();
    });
    return generation;
  };

  const first = start();
  if (typeof first === "string")
    return { state: { kind: "unavailable", reason: first }, onReady: () => {}, register: async () => null, stop: () => {} };
  current = first;

  return {
    state: { kind: "started", pid: first.child.pid! },
    onReady(listener) {
      readyListeners.push(listener);
      if (current?.ready) listener();
    },
    register(sessionHandle, pid) {
      const generation = current;
      if (generation === null || !generation.ready || stopping) return Promise.resolve(null);
      if (generation.answer !== null) generation.answer(null);
      return new Promise<string | null>(resolve => {
        const timer = setTimeout(() => {
          if (generation.answer === settle) generation.answer = null;
          say("broker did not answer the principal registration");
          resolve(null);
        }, options.registerTimeoutMs ?? 10_000);
        timer.unref?.();
        const settle = (credential: string | null): void => { clearTimeout(timer); resolve(credential); };
        generation.answer = settle;
        try { generation.channel.write(encodeHostMessage({ kind: "session", sessionHandle, pid })); }
        catch (error) {
          generation.answer = null;
          settle(null);
          say(`principal registration could not be sent: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    },
    stop() {
      stopping = true;
      const generation = current;
      current = null;
      if (generation !== null && generation.child.exitCode === null && generation.child.signalCode === null)
        generation.child.kill("SIGTERM");
    },
  };
}
