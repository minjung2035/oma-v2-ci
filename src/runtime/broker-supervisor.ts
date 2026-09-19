/** TUI-002: the product starts its own society.
 *
 * `oma` is one command, so the broker cannot be something the user starts
 * separately. This owns that child: it declines to start a second broker when
 * one is already listening, and it stops the one it started when the product
 * exits. A broker it did not start is never stopped — another `oma` owns it.
 *
 * The singleton guarantee is not here: the broker takes an exclusive lock on
 * its own run root and refuses to run twice. This only avoids the pointless
 * spawn, and reports the outcome rather than assuming either way.
 */
import { connect } from "node:net";
import { join } from "node:path";
import { spawnSupervisedService, type ChildProcess } from "../process/async.js";

export type BrokerState =
  | { readonly kind: "already-running" }
  | { readonly kind: "started"; readonly pid: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface BrokerHandle {
  readonly state: BrokerState;
  /** Stops only a broker this handle started. */
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
}

export async function superviseBroker(options: SuperviseOptions): Promise<BrokerHandle> {
  if (await brokerListening(options.runRoot))
    return { state: { kind: "already-running" }, stop: () => {} };

  let child: ChildProcess;
  try {
    // The broker derives its own state and run roots from the environment, so
    // it is handed this process's environment rather than a reduced one.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    child = spawnSupervisedService(options.node, [join(options.libdir, "dist/src/entry/broker.js"),
      "--society", options.society, "--config", options.configPath], env);
  } catch (error) {
    return {
      state: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) },
      stop: () => {},
    };
  }

  const say = options.onEvent ?? (() => {});
  let ended = false;
  // The broker's stderr is its operational channel. Losing it would turn a
  // refused start into an unexplained absence of status.
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", chunk => {
    for (const line of String(chunk).split("\n")) if (line.trim().length > 0) say(line.trim());
  });
  child.once("exit", (code, signal) => {
    ended = true;
    // An expected stop during shutdown still reports, because a broker that
    // died on its own and one the product stopped look identical afterwards.
    say(`broker ended (${signal ?? `code ${code ?? "unknown"}`})`);
  });
  child.once("error", error => { ended = true; say(`broker failed: ${error.message}`); });

  return {
    state: child.pid === undefined
      ? { kind: "unavailable", reason: "the broker process did not start" }
      : { kind: "started", pid: child.pid },
    stop: () => { if (!ended) child.kill("SIGTERM"); },
  };
}
