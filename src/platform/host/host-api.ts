/** The Host API server (MAC-020, MAC-021, MAC-251): the only way the Mac's
 * UIs reach the engine. It answers only connections from this user, asked of
 * the kernel, that present the login token written at this start; within
 * one user the token is not a boundary (§3.4 A4), and nothing more is claimed.
 *
 * `terminal.attach` turns its connection into the society's terminal: after
 * the answer, frames pass through to the guest unchanged (§4.6).
 */
import { timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { isAbsolute } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { isValidSocietyName } from "../../domain/identifiers.js";
import { checkedGuestHistory } from "../../protocol/guest-history.js";
import type {
  ArchiveResult, PackageSyncRequest, PackageSyncResult, ProjectBindRequest, ProjectBindResult,
  ProjectExportRequest, ProjectExportResult,
  ProjectExtensionsResult,
  ProjectImportRequest, ProjectImportResult,
  SessionMethod, SessionRequests,
  SnapshotResult,
  SocietyMethods
} from "../../protocol/host-api.js";
import { HOST_API_VERSION, hostApiHelloProblem, type HostApiHello } from "../../protocol/host-api.js";
import { isRequestKey, isUuid, requestProblem } from "../../protocol/host-guest.js";
import { installedPackageSource } from "../../runtime/packages/index.js";
import { clearSocketName } from "../../storage/socket-name.js";
import { HANDOFF, serveRequests, type Answer } from "../rpc-server.js";
import { FramedPeer } from "../rpc.js";
import { requestSociety } from "../society-client.js";
import type { VmState } from "./lifecycle.js";
import { peerUid } from "./peer.js";
import { SNAPSHOT_ID } from "./snapshot.js";

export interface HostApiBackend {
  state(): VmState;
  start(): Promise<void>;
  stop(): Promise<"stopped" | "forced">;
  /** A society connection to the running guest. */
  society(): Promise<FramedPeer>;
  terminal(society: string, takeover: boolean): Promise<{ readonly socket: Socket; readonly rest: Buffer }>;
  /** §6: the project sync, keyed by the UI's request key (MAC-240). */
  importProject(key: string, params: ProjectImportRequest): Promise<ProjectImportResult>;
  exportProject(key: string, params: ProjectExportRequest): Promise<ProjectExportResult>;
  /** §8.4: a stopped society's archive, encrypted at rest (MAC-621). */
  archive(key: string, society: string): Promise<ArchiveResult & { path: string }>;
  /** DR25: the Mac's package store, carried to the engine whole; what was
   * added is turned on in `projectId`'s project when one is named. */
  syncPackages(key: string, params: PackageSyncRequest): Promise<PackageSyncResult>;
  bindProject?(params: ProjectBindRequest): Promise<ProjectBindResult>;
  projectExtensions?(projectId: string): Promise<ProjectExtensionsResult>;
  sessions?<M extends SessionMethod>(method: M, params: SessionRequests[M]): Promise<SocietyMethods[M]["result"]>;
  /** §8.4: a snapshot of the state disk at its quiescent point. Answers the
   * published path and the societies that were stopped for it. */
  snapshot?(params: { id?: string }): Promise<SnapshotResult>;
}

export interface HostApiOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly backend: HostApiBackend;
  readonly frameBytes: number;
  readonly helloDeadlineMs: number;
  readonly requestTimeoutMs: number;
  /** The user whose connections are answered: this process's. */
  readonly uid: number;
}

export function startHostApi(options: HostApiOptions): Promise<Server> {
  clearSocketName(options.socketPath);
  const server = createServer({ allowHalfOpen: true }, socket => { void accept(socket, options); });
  // omahostd runs no uncaughtException handler: once the startup
  // once-listener below is removed, an accept-class error (EMFILE/ENFILE)
  // meets zero 'error' listeners and escapes its emit as the service's
  // death -- the Mac's only channel to the engine with it. The permanent
  // listener journals and keeps the socket bound: the kernel retries the
  // accept, while closing would unlink the name the UIs dial. The journal
  // is best-effort -- a dead stderr must not throw out of this emit
  // either.
  server.on("error", error => {
    try { console.error(`host api listener error: ${error.message}`); } catch { /* nowhere left to say it */ }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      // The listener and its name are this opener's until the server is
      // handed back; a permission failure returns both (AV-20261003-28).
      try { chmodSync(options.socketPath, 0o600); }
      catch (error) { server.close(); reject(error as Error); return; }
      server.off("error", reject);
      resolve(server);
    });
  });
}

function sameToken(presented: string, token: string): boolean {
  const a = Buffer.from(presented, "utf8"); const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function accept(socket: Socket, options: HostApiOptions): Promise<void> {
  socket.on("error", () => { socket.destroy(); });
  if (peerUid(socket) !== options.uid) { socket.destroy(); return; }
  const peer = new FramedPeer(socket, { frameBytes: options.frameBytes, requestTimeoutMs: options.requestTimeoutMs });
  const hello = await new Promise<{ id: string; params: HostApiHello } | null>(resolve => {
    const timer = setTimeout(() => { resolve(null); }, options.helloDeadlineMs);
    timer.unref();
    let first = true;
    peer.onClose(() => { clearTimeout(timer); resolve(null); });
    peer.onFrame(frame => {
      // Only the first frame is the hello; the rest are requests.
      if (!first) return;
      first = false;
      clearTimeout(timer);
      const problem = requestProblem(frame) ?? (frame.method === "hello" ? hostApiHelloProblem(frame.params) : "the first message must be hello");
      if (problem !== null) { refuseAndClose(peer, frame.id, "INVALID_REQUEST", problem); resolve(null); return; }
      resolve({ id: frame.id as string, params: frame.params as unknown as HostApiHello });
    });
  });
  if (hello === null) { peer.close(); return; }
  if (!sameToken(hello.params.token, options.token)) { refuseAndClose(peer, hello.id, "AUTH_FAILED", "the login token is not this service's"); return; }
  if (HOST_API_VERSION < hello.params.api.min || HOST_API_VERSION > hello.params.api.max) {
    refuseAndClose(peer, hello.id, "UNSUPPORTED_VERSION", `this service speaks ${HOST_API_VERSION}`);
    return;
  }
  peer.answer(hello.id, { api: HOST_API_VERSION });
  serve(peer, options.backend);
}

function refuseAndClose(peer: FramedPeer, id: unknown, code: "INVALID_REQUEST" | "AUTH_FAILED" | "UNSUPPORTED_VERSION", message: string): void {
  try { if (typeof id === "string") peer.refuse(id, { code, message, retry: "never" }); } catch { /* closing anyway */ }
  peer.closeAfterFlush(message);
}

function serve(peer: FramedPeer, backend: HostApiBackend): void {
  const forward = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    await backend.start();
    const society = await backend.society();
    try {
      if (method === "society.list") return await requestSociety(society, method, {});
      if (method === "society.open") {
        if (!isValidSocietyName(params.society) || !isUuid(params.projectId)) throw new StoreError("INVALID_REQUEST", "society.open names a society and project");
        return await requestSociety(society, method, { society: params.society, projectId: params.projectId });
      }
      if (method === "society.close") {
        if (!isValidSocietyName(params.society) || params.mode !== "stop" && params.mode !== "keep-running") throw new StoreError("INVALID_REQUEST", "society.close names a society and close mode");
        return await requestSociety(society, method, { society: params.society, mode: params.mode });
      }
      return await society.request(method, params); // request.status carries an opaque durable operation result.
    }
    finally { society.close(); }
  };
  let attached = false;
  const keyed = (key: string | undefined): string => {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "this request needs a request key");
    return key;
  };
  const macRepo = (value: unknown): string => {
    if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) throw new StoreError("INVALID_REQUEST", "the project's folder must be an absolute path");
    return value;
  };
  const since = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) throw new StoreError("INVALID_REQUEST", "since is a commit id");
    return value;
  };
  serveRequests(peer, async (method, params, key): Promise<Answer> => {
    if (attached) throw new StoreError("INVALID_REQUEST", "this connection is a terminal now");
    switch (method) {
      case "engine.status": return { state: backend.state() };
      case "engine.start": await backend.start(); return { state: backend.state() };
      case "engine.stop": return { result: await backend.stop() };
      case "society.list": return await forward("society.list", {});
      case "society.open": return await forward("society.open", { society: params.society, projectId: params.projectId });
      case "society.close": return await forward("society.close", { society: params.society, mode: params.mode });
      case "project.bind": {
        if (Object.keys(params).sort().join(",") !== "macRepo,society" || !isValidSocietyName(params.society) || key !== undefined)
          throw new StoreError("INVALID_REQUEST", "project.bind names a project folder and a society");
        if (backend.bindProject === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Project binding is unavailable");
        return await backend.bindProject({ macRepo: macRepo(params.macRepo), society: params.society });
      }
      case "project.extensions": {
        if (Object.keys(params).join(",") !== "projectId" || !isUuid(params.projectId) || key !== undefined)
          throw new StoreError("INVALID_REQUEST", "project.extensions names a project");
        if (backend.projectExtensions === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Project settings are unavailable");
        // Observation must never start a VM or reopen a Society.
        return await backend.projectExtensions(params.projectId);
      }
      case "session.list": {
        if (!["projectId", "after,projectId"].includes(Object.keys(params).sort().join(",")) || !isUuid(params.projectId) || key !== undefined)
          throw new StoreError("INVALID_REQUEST", "session.list names a project");
        if (backend.sessions === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Saved guest histories are unavailable");
        if (params.after !== undefined && typeof params.after !== "string")
          throw new StoreError("INVALID_REQUEST", "session.list cursor must be a file name");
        return await backend.sessions(method, { projectId: params.projectId, ...(params.after === undefined ? {} : { after: params.after }) });
      }
      case "session.inspect": case "session.resume": {
        const identity = checkedGuestHistory(params);
        if (key !== undefined) throw new StoreError("INVALID_REQUEST", "Session requests do not accept a replay key");
        if (backend.sessions === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Saved guest histories are unavailable");
        return await backend.sessions(method, { ...identity });
      }
      case "project.import": {
        if (!isUuid(params.projectId) || typeof params.branch !== "string") throw new StoreError("INVALID_REQUEST", "project.import names a project and a branch");
        await backend.start();
        return await backend.importProject(keyed(key), { projectId: params.projectId, macRepo: macRepo(params.macRepo), branch: params.branch, since: since(params.since) });
      }
      case "project.export": {
        if (typeof params.society !== "string") throw new StoreError("INVALID_REQUEST", "project.export names a society");
        await backend.start();
        return await backend.exportProject(keyed(key), { society: params.society, macRepo: macRepo(params.macRepo), since: since(params.since) });
      }
      case "request.status": return await forward("request.status", { key: params.key });
      case "packages.sync": {
        if (params.activate !== undefined && (typeof params.activate !== "string" || !installedPackageSource(params.activate)))
          throw new StoreError("INVALID_REQUEST", "activate must name an installed package source");
        if (params.projectId !== undefined && !isUuid(params.projectId)) throw new StoreError("INVALID_REQUEST", "packages.sync names a project by its id, or none");
        await backend.start();
        return await backend.syncPackages(keyed(key), { projectId: params.projectId === undefined ? null : params.projectId as string, activate: params.activate as string | undefined });
      }
      case "archive.create": {
        if (typeof params.society !== "string") throw new StoreError("INVALID_REQUEST", "archive.create names a society");
        await backend.start();
        return await backend.archive(keyed(key), params.society);
      }
      case "snapshot.create": {
        if (key !== undefined) throw new StoreError("INVALID_REQUEST", "snapshot.create does not accept a replay key");
        if (Object.keys(params).some(name => name !== "id") || (params.id !== undefined &&
            (typeof params.id !== "string" || !SNAPSHOT_ID.test(params.id))))
          throw new StoreError("INVALID_REQUEST", "snapshot.create may name the snapshot, and only that");
        // `update-<expectImage>` is the service's own pre-update marker: a
        // user snapshot in that namespace is prune-protected forever and,
        // worse, satisfies updateSnapshot's already-made check so the real
        // rollback point is never taken.
        if (typeof params.id === "string" && params.id.startsWith("update-"))
          throw new StoreError("INVALID_REQUEST", "snapshot ids beginning update- are reserved for the service's own pre-update snapshots");
        if (backend.snapshot === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Snapshots are unavailable");
        // Observation must never start a VM: a stopped engine's disk is
        // quiescent as it is, a running one's societies are stopped for it.
        return await backend.snapshot(params.id === undefined ? {} : { id: params.id });
      }
      case "terminal.attach": {
        if (typeof params.society !== "string" || (params.takeover !== undefined && params.takeover !== true))
          throw new StoreError("INVALID_REQUEST", "terminal.attach names a society and may take over");
        await backend.start();
        const guest = await backend.terminal(params.society, params.takeover === true);
        attached = true;
        // After this answer the connection carries the terminal's frames.
        return { attached: true, [HANDOFF]: () => {
          const screen = peer.detach();
          if (guest.rest.length > 0) screen.write(guest.rest);
          screen.pipe(guest.socket);
          guest.socket.pipe(screen);
          screen.once("close", () => { guest.socket.destroy(); });
          guest.socket.once("close", () => { screen.end(); });
          guest.socket.on("error", () => { screen.destroy(); });
          screen.resume();
        } };
      }
      default: throw new StoreError("UNKNOWN_METHOD", `the Host API has no ${method}`);
    }
  });
}
