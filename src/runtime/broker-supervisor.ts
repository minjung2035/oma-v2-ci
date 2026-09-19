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
import { PRINCIPAL_SESSION_ENV, isPrincipalCredential } from "../protocol/principal-credential.js";

/** Where the broker writes its credential. Descriptors 0-2 are the ordinary
 * streams; this parent attaches one more. */
const PRINCIPAL_CREDENTIAL_FD = 3;

export type BrokerState =
  | { readonly kind: "already-running" }
  | { readonly kind: "started"; readonly pid: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface BrokerHandle {
  readonly state: BrokerState;
  /** PR-001: the credential this broker minted for the session that was
   * registered with it, or null when there is none to have — the broker was
   * already running and belongs to another host, it failed to start, or it
   * ended before publishing. Awaiting it is also the readiness barrier: the
   * broker publishes only once its Principal endpoint is listening, so a
   * credential in hand means the endpoint is there. */
  readonly credential: Promise<string | null>;
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
  /** The session this host will run, named before the broker starts so the
   * broker knows which one to expect rather than recording whichever attaches
   * first. Omitted, no Principal endpoint is opened at all. */
  readonly sessionHandle?: string;
  /** How long to wait for the credential before giving up on it. A broker that
   * is still starting has not failed, but the product cannot hold its terminal
   * indefinitely for one. */
  readonly readyTimeoutMs?: number;
  /** Receives one line whenever the child says something or ends. */
  readonly onEvent?: (line: string) => void;
}

export async function superviseBroker(options: SuperviseOptions): Promise<BrokerHandle> {
  const none = Promise.resolve<string | null>(null);
  if (await brokerListening(options.runRoot))
    return { state: { kind: "already-running" }, credential: none, stop: () => {} };

  let child: ChildProcess;
  try {
    // The broker derives its own state and run roots from the environment, so
    // it is handed this process's environment rather than a reduced one.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    if (options.sessionHandle !== undefined) env[PRINCIPAL_SESSION_ENV] = options.sessionHandle;
    child = spawnSupervisedService(options.node, [join(options.libdir, "dist/src/entry/broker.js"),
      "--society", options.society, "--config", options.configPath], env,
      options.sessionHandle !== undefined);
  } catch (error) {
    return {
      state: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) },
      credential: none, stop: () => {},
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
    credential: options.sessionHandle === undefined ? none : publishedCredential(child, options.readyTimeoutMs ?? 30000),
    stop: () => { if (!ended) child.kill("SIGTERM"); },
  };
}

/** Reads the one line the broker writes on the channel this parent holds.
 *
 * Nothing else is ever sent on it, so a line that is not a credential means the
 * channel is not what this expects and is refused rather than passed on. The
 * child exiting, or never answering, resolves to absence: the product then runs
 * a Principal with no society authority and says so, which is what actually
 * happened.
 */
function publishedCredential(child: ChildProcess, timeoutMs: number): Promise<string | null> {
  const channel = child.stdio[PRINCIPAL_CREDENTIAL_FD];
  if (!channel || !("setEncoding" in channel)) return Promise.resolve(null);
  return new Promise<string | null>(resolve => {
    let text = "";
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    channel.setEncoding("utf8");
    channel.on("data", chunk => {
      text += String(chunk);
      if (Buffer.byteLength(text) > 4096) { finish(null); return; }
      const end = text.indexOf("\n");
      if (end < 0) return;
      const line = text.slice(0, end).trim();
      finish(isPrincipalCredential(line) ? line : null);
    });
    channel.once("error", () => finish(null));
    channel.once("end", () => finish(null));
    child.once("exit", () => finish(null));
  });
}
