/** guesthost (macos-platform §4.5, §4.6): the society channel and the
 * terminal channel, as the oma user.
 *
 * A society here is what it is on Linux: a state root under
 * `<data>/oma/<society>` that the product's own `oma` made and owns. guesthost
 * never acts on a society's state; it starts, stops and lists the sessions
 * that run `oma` (each a holder in its own user unit, so a guesthost restart
 * leaves them running), and it relays a screen to one of them.
 */
import type { Socket } from "node:net";
import { connectEndpoint, endpointListening } from "../../protocol/connection.js";
import { join } from "node:path";
import { lstatSync, readdirSync } from "node:fs";
import { StoreError } from "../../domain/errors.js";
import { isValidSocietyName } from "../../domain/identifiers.js";
import { runGitText } from "../../process/policies.js";
import { observeProjectBinding, stateRootHasSociety } from "../../runtime/provision.js";
import type { FramedPeer } from "../rpc.js";
import { serveRequests } from "./server.js";
import { encodeTerminalJson, isRequestKey, isUuid, type HelloParams } from "../../protocol/host-guest.js";
import type { GuestProjects } from "./project.js";
import type { RequestLedger } from "./requests.js";
import type { GuestPackages } from "./packages.js";
import type { GuestArchives } from "./archive.js";
import { defaultSocietyFor } from "../../config/defaults.js";
import { sha256Hex } from "../../hash.js";
import { projectSettingsPathAt } from "../../storage/paths.js";
import { loadEditableConfiguration } from "../../config.js";
import { DEPLOYMENT_LAYOUT } from "../../domain/deployment.js";
import { GuestHistories } from "./histories.js";
import { checkedGuestHistory } from "../../protocol/guest-history.js";

/** Starts and stops the holder of one society's session. */
export interface SessionLauncher {
  /** Resolves once the holder accepts connections on `socketPath(society)`. */
  start(society: string, projectDir: string, resume?: string): Promise<void>;
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
  /** DR25: the packages the Mac installed, taken on by the engine. */
  readonly packages?: GuestPackages;
}

/** Observation of the holder endpoint, not proof that its processes ended. */
export const listening = endpointListening;

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

  /** DR29: read committed project choice without opening a session or config. */
  projectExtensions(projectId: unknown): { extensions: readonly string[] } {
    if (!isUuid(projectId)) throw new StoreError("INVALID_REQUEST", "projectId must be a UUID");
    const mirror = this.mirrorOf(projectId);
    if (runGitText(["-C", mirror, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).status !== 0)
      throw new StoreError("INVALID_REQUEST", "The project has not been imported");
    const config = projectSettingsPathAt(this.options.societiesDir, defaultSocietyFor(mirror, sha256Hex(mirror)));
    if (lstatSync(config, { throwIfNoEntry: false }) === undefined) return { extensions: [] };
    const saved = loadEditableConfiguration(config), profile = saved.config.principalProfile;
    if (saved.config.agentProfiles[profile] === undefined) throw new StoreError("STORE_CORRUPT", "Project settings have no Principal profile");
    const authored = saved.authoredRoles[profile]?.value;
    return { extensions: authored === undefined ? [DEPLOYMENT_LAYOUT.extension] : authored.extensions as readonly string[] };
  }

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

  async resume(value: unknown): Promise<{ state: "running" }> {
    const identity = checkedGuestHistory(value);
    const before = this.opening.get(identity.society) ?? Promise.resolve();
    const resumed = before.catch(() => undefined).then(async () => {
      const saved = await new GuestHistories(this.options.societiesDir, this.options.projectsDir).inspect(identity);
      return await this.openAlone(identity.society, identity.projectId, saved.file);
    });
    this.opening.set(identity.society, resumed);
    try { return await resumed; }
    finally { if (this.opening.get(identity.society) === resumed) this.opening.delete(identity.society); }
  }

  private async openAlone(society: string, projectId: unknown, resume?: string): Promise<{ state: "running" }> {
    if (!isUuid(projectId)) throw new StoreError("INVALID_REQUEST", "projectId must be a UUID");
    if (this.maintenance.size > 0) throw new StoreError("BROKER_UNAVAILABLE", "the engine is being maintained; try again shortly");
    if (this.archiving.has(society)) throw new StoreError("BROKER_UNAVAILABLE", "this society is being archived; try again shortly");
    if (await listening(this.options.launcher.socketPath(society))) {
      if (resume !== undefined) throw new StoreError("ATTACH_CONFLICT", "That Society already has an open session");
      return { state: "running" };
    }
    const mirror = this.mirrorOf(projectId);
    const head = runGitText(["-C", mirror, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    if (head.status !== 0) throw new StoreError("INVALID_REQUEST", "the project has not been imported yet; import it first");
    const binding = observeProjectBinding(this.stateRoot(society));
    if (binding.kind === "bound" && binding.binding.canonicalProjectPath !== mirror)
      throw new StoreError("INVALID_REQUEST", "this society belongs to another project");
    if (binding.kind === "unreadable" || binding.kind === "unavailable")
      throw new StoreError("BROKER_UNAVAILABLE", "the society's project could not be checked");
    await this.options.launcher.start(society, mirror, resume);
    return { state: "running" };
  }

  /** §4.5 society.close. `stop` ends the session through `oma`'s own
   * shutdown; an end not seen in time is unknown, not stopped (P0-5). */
  async close(society: unknown, mode: unknown): Promise<{ state: "running" | "stopped" | "unknown" }> {
    if (!isValidSocietyName(society)) throw new StoreError("INVALID_REQUEST", "invalid society name");
    if (mode === "keep-running") {
      try { return { state: (await listening(this.options.launcher.socketPath(society))) ? "running" : "unknown" }; }
      catch (error) { if (error instanceof StoreError && error.code === "BROKER_UNAVAILABLE") return { state: "unknown" }; throw error; }
    }
    if (mode !== "stop") throw new StoreError("INVALID_REQUEST", "mode is keep-running or stop");
    // Even a missing holder endpoint cannot prove its child and descendants
    // ended. Only the launcher can confirm its explicit stop.
    return { state: await this.options.launcher.stop(society, this.options.stopDeadlineMs) };
  }

  /** §4.5 / MAC-320: while any maintenance is open no society opens. */
  maintenanceBegin(key: unknown): { maintenance: true } {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "invalid request key");
    if (this.opening.size > 0 || this.archiving.size > 0)
      throw new StoreError("BROKER_UNAVAILABLE", "a society is opening or being archived; retry maintenance shortly");
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
        case "project.extensions": {
          if (Object.keys(params).join(",") !== "projectId" || key !== undefined)
            throw new StoreError("INVALID_REQUEST", "project.extensions names a project");
          return this.projectExtensions(params.projectId);
        }
        case "session.list": {
          if (!["projectId,society", "after,projectId,society"].includes(Object.keys(params).sort().join(",")) || key !== undefined)
            throw new StoreError("INVALID_REQUEST", "session.list names a project and Society");
          return await new GuestHistories(this.options.societiesDir, this.options.projectsDir).list(params.projectId, params.society, params.after);
        }
        case "session.inspect": {
          if (key !== undefined) throw new StoreError("INVALID_REQUEST", "Session inspection does not accept a request key");
          const saved = await new GuestHistories(this.options.societiesDir, this.options.projectsDir).inspect(params);
          return { mode: saved.mode, sessionId: saved.sessionId };
        }
        case "session.resume": {
          if (key !== undefined) throw new StoreError("INVALID_REQUEST", "Session resume does not accept a replay key");
          return await this.resume(params);
        }
        case "request.status": return this.need(this.options.ledger, method).status(params.key);
        case "packages.replace": return await this.need(this.options.packages, method).replace(key, params);
        case "archive.create": {
          // P0-4: acquire before any await, return only this call's slot. An
          // earlier open or maintenance also owns its entire asynchronous work.
          const society = params.society;
          if (!isValidSocietyName(society)) throw new StoreError("INVALID_REQUEST", "invalid society name");
          if (this.maintenance.size > 0 || this.opening.has(society) || this.archiving.has(society))
            throw new StoreError("BROKER_UNAVAILABLE", "the society has an active operation; retry the same key shortly");
          this.archiving.add(society);
          try { return await this.need(this.options.archives, method).create(key, { society }); }
          finally { this.archiving.delete(society); }
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
    const connecting = new AbortController();
    let holder: Socket | null = null;
    const end = (): void => { connecting.abort(); holder?.destroy(); };
    screen.once("close", end);
    screen.on("error", end);
    void connectEndpoint(this.options.launcher.socketPath(society), 5000, connecting.signal).then(connected => {
      holder = connected;
      if (screen.destroyed || screen.readableEnded) { holder.destroy(); return; }
      holder.on("error", () => { screen.destroy(); });
      holder.once("close", () => { screen.end(); });
      holder.write(encodeTerminalJson("attach", hello.takeover === true ? { takeover: true } : {}));
      screen.pipe(holder);
      holder.pipe(screen);
      screen.resume();
    }, error => {
      if (screen.destroyed) return;
      const cause = error instanceof StoreError ? error.cause as NodeJS.ErrnoException | undefined : undefined;
      const absent = cause?.code === "ENOENT" || cause?.code === "ECONNREFUSED";
      screen.end(encodeTerminalJson("refused", { code: absent ? "INVALID_REQUEST" : "BROKER_UNAVAILABLE",
        message: absent ? "the society is not open" : "the society connection could not be observed" }));
    });
  }
}
