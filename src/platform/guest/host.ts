/** guesthost (macos-platform §4.5, §4.6): the society channel and the
 * terminal channel, as the oma user.
 *
 * A society here is what it is on Linux: a state root under
 * `<data>/oma/<society>` that the product's own `oma` made and owns. guesthost
 * never acts on a society's state; it starts, stops and lists the sessions
 * that run `oma` (each a holder in its own user unit, so a guesthost restart
 * leaves them running), and it relays a screen to one of them.
 */
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { StoreError } from "../../domain/errors.js";
import { isValidSocietyName } from "../../domain/identifiers.js";
import { runGitText } from "../../process/policies.js";
import { observeProjectBinding, stateRootHasSociety } from "../../runtime/provision.js";
import type { FramedPeer } from "../rpc.js";
import { serveRequests } from "./server.js";
import { encodeTerminalJson, isRequestKey, isUuid, type HelloParams } from "../../protocol/host-guest.js";
import type { GuestProjects } from "./project.js";
import type { RequestLedger } from "./requests.js";
import type { GuestArchives } from "./archive.js";

/** Starts and stops the holder of one society's session. */
export interface SessionLauncher {
  /** Resolves once the holder accepts connections on `socketPath(society)`. */
  start(society: string, projectDir: string): Promise<void>;
  /** Asks the session to end; "unknown" when it was not seen to end in time. */
  stop(society: string, deadlineMs: number): Promise<"stopped" | "unknown">;
  socketPath(society: string): string;
}

export interface GuestHostOptions {
  /** `<XDG_DATA_HOME>/oma`: where the guest's `oma` keeps its state roots. */
  readonly societiesDir: string;
  /** Where the project mirrors are (§6.3). */
  readonly projectsDir: string;
  readonly launcher: SessionLauncher;
  readonly stopDeadlineMs: number;
  /** §6 and MAC-240: project sync and its request ledger. */
  readonly projects?: GuestProjects;
  readonly ledger?: RequestLedger;
  readonly archives?: GuestArchives;
}

/** Whether something accepts connections at a path: a holder that ended
 * removed its socket, and one that was killed left a socket nobody answers. */
export function listening(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(path);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { resolve(false); });
  });
}

export class GuestHost {
  private readonly maintenance = new Set<string>();
  private readonly archiving = new Set<string>();
  /** P0V-106 (G13-04): one open of a society at a time. A second open waits
   * for the first and then sees what it made, instead of starting a second
   * session under the same unit name. */
  private readonly opening = new Map<string, Promise<unknown>>();

  constructor(private readonly options: GuestHostOptions) {}

  private stateRoot(society: string): string { return join(this.options.societiesDir, society); }
  mirrorOf(projectId: string): string { return join(this.options.projectsDir, projectId); }

  async list(): Promise<{ societies: { society: string; running: boolean }[] }> {
    let names: string[];
    try { names = readdirSync(this.options.societiesDir).filter(name => isValidSocietyName(name)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { societies: [] };
      throw new StoreError("BROKER_UNAVAILABLE", "the societies could not be listed");
    }
    const societies: { society: string; running: boolean }[] = [];
    for (const society of names.sort()) {
      if (!stateRootHasSociety(this.stateRoot(society))) continue;
      societies.push({ society, running: await listening(this.options.launcher.socketPath(society)) });
    }
    return { societies };
  }

  /** §4.5 society.open. MAC-412: a project's society starts only from a
   * mirror that has the imported history; an existing society opens only
   * for the project it is bound to (D05, as on Linux). */
  async open(society: unknown, projectId: unknown): Promise<{ state: "running" }> {
    if (!isValidSocietyName(society)) throw new StoreError("INVALID_REQUEST", "invalid society name");
    const before = this.opening.get(society) ?? Promise.resolve();
    const opened = before.catch(() => undefined).then(() => this.openAlone(society, projectId));
    this.opening.set(society, opened);
    try { return await opened; }
    finally { if (this.opening.get(society) === opened) this.opening.delete(society); }
  }

  private async openAlone(society: string, projectId: unknown): Promise<{ state: "running" }> {
    if (!isUuid(projectId)) throw new StoreError("INVALID_REQUEST", "projectId must be a UUID");
    if (this.maintenance.size > 0) throw new StoreError("BROKER_UNAVAILABLE", "the engine is being maintained; try again shortly");
    if (this.archiving.has(society)) throw new StoreError("BROKER_UNAVAILABLE", "this society is being archived; try again shortly");
    if (await listening(this.options.launcher.socketPath(society))) return { state: "running" };
    const mirror = this.mirrorOf(projectId);
    const head = runGitText(["-C", mirror, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    if (head.status !== 0) throw new StoreError("INVALID_REQUEST", "the project has not been imported yet; import it first");
    const binding = observeProjectBinding(this.stateRoot(society));
    if (binding.kind === "bound" && binding.binding.canonicalProjectPath !== mirror)
      throw new StoreError("INVALID_REQUEST", "this society belongs to another project");
    if (binding.kind === "unreadable" || binding.kind === "unavailable")
      throw new StoreError("BROKER_UNAVAILABLE", "the society's project could not be checked");
    await this.options.launcher.start(society, mirror);
    return { state: "running" };
  }

  /** §4.5 society.close. `stop` ends the session through `oma`'s own
   * shutdown; an end not seen in time is unknown, not stopped (P0-5). */
  async close(society: unknown, mode: unknown): Promise<{ state: "running" | "stopped" | "unknown" }> {
    if (!isValidSocietyName(society)) throw new StoreError("INVALID_REQUEST", "invalid society name");
    if (mode === "keep-running") return { state: (await listening(this.options.launcher.socketPath(society))) ? "running" : "stopped" };
    if (mode !== "stop") throw new StoreError("INVALID_REQUEST", "mode is keep-running or stop");
    if (!(await listening(this.options.launcher.socketPath(society)))) return { state: "stopped" };
    return { state: await this.options.launcher.stop(society, this.options.stopDeadlineMs) };
  }

  /** §4.5 / MAC-320: while any maintenance is open no society opens. */
  maintenanceBegin(key: unknown): { maintenance: true } {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "invalid request key");
    this.maintenance.add(key);
    return { maintenance: true };
  }
  maintenanceEnd(key: unknown): { maintenance: boolean } {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "invalid request key");
    this.maintenance.delete(key);
    return { maintenance: this.maintenance.size > 0 };
  }

  serve(peer: FramedPeer): void {
    serveRequests(peer, async (method, params, key) => {
      switch (method) {
        case "society.list": return await this.list();
        case "society.open": return await this.open(params.society, params.projectId);
        case "society.close": return await this.close(params.society, params.mode);
        case "maintenance.begin": return this.maintenanceBegin(key);
        case "maintenance.end": return this.maintenanceEnd(key);
        case "project.import": return await this.need(this.options.projects, method).import(key, params);
        case "project.export": return await this.need(this.options.projects, method).export(key, { society: params.society, since: params.since });
        case "request.status": return this.need(this.options.ledger, method).status(params.key);
        case "archive.create": {
          // §8.4: a society being archived does not open.
          if (isValidSocietyName(params.society)) this.archiving.add(params.society);
          try { return await this.need(this.options.archives, method).create(key, { society: params.society }); }
          finally { if (typeof params.society === "string") this.archiving.delete(params.society); }
        }
        default: throw new StoreError("UNKNOWN_METHOD", `the society channel has no ${method}`);
      }
    });
  }

  private need<T>(part: T | undefined, method: string): T {
    if (part === undefined) throw new StoreError("UNKNOWN_METHOD", `the society channel has no ${method}`);
    return part;
  }

  /** §4.6: relays one screen to the society's session holder. The frames
   * pass through unchanged; the holder checks them. */
  terminal(screen: Socket, hello: HelloParams): void {
    const society = hello.society!;
    const holder = connect(this.options.launcher.socketPath(society));
    let joined = false;
    holder.once("connect", () => {
      joined = true;
      holder.write(encodeTerminalJson("attach", hello.takeover === true ? { takeover: true } : {}));
      screen.pipe(holder);
      holder.pipe(screen);
      screen.resume();
    });
    holder.once("error", () => {
      if (!joined) { screen.end(encodeTerminalJson("refused", { code: "INVALID_REQUEST", message: "the society is not open" })); return; }
      screen.destroy();
    });
    holder.once("close", () => { if (joined) screen.end(); });
    screen.once("close", () => { holder.destroy(); });
    screen.on("error", () => { holder.destroy(); });
  }
}
