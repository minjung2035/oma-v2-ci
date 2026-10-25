import { prepareHostProjectDirectory } from "@oma/platform-mac/files";
/** Host application use case: orders bundle transfer, typed guest import and host checkpoint.
 * The guest owns mirror mutation; bundle/bookmark/file adapters implement host effects. */
import { societyResultProblem, type ProjectBindRequest, type ProjectBindResult, type ProjectExportRequest, type ProjectExportResult, type ProjectImportRequest, type ProjectImportResult } from "@oma/protocol/host-api";
import { requestSociety } from "../society-client.js";
/** Host-owned project identity and explicit import/export (MAC-404/411/412).
 * Record publication and stream staging keep their existing owners. */
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid } from "@oma/domain/identifiers";
import { PLATFORM_FRAME_BYTES, responseProblem, type PlatformFailure } from "@oma/protocol/host-guest";
import { PlatformError } from "@oma/protocol/host-errors";
import type { ProjectBookmarks } from "@oma/platform-mac/bookmark";
import { createHostStagingDirectory, ensureHostOwnedDirectory, publishHostStaged, publishMade, removeHostStaged, replaceFile } from "@oma/platform-mac/files";
import type { GuestLink } from "./guest-link.js";
import { MacGit, sha256File } from "@oma/git/host-project";
import { fileSink, getStream, putStream } from "./project.js";
import { readHostRecord, type HostRecord, type ProjectRecord } from "@oma/platform-mac/record";


export interface ProjectSyncOptions {
  readonly link: GuestLink;
  readonly git: string;
  readonly recordPath: string;
  readonly record: (update: (current: HostRecord) => HostRecord) => void;
  readonly bookmarks?: ProjectBookmarks;
  readonly transfer: string;
  readonly room: (dir: string, incoming: number) => void;
}

interface SavedImport {
  readonly intent: string;
  readonly bundle: { bytes: number; sha256: string; head: string };
  readonly previous: NonNullable<ProjectRecord["lastImport"]> | null;
  readonly result: ProjectImportResult | null;
  readonly failure: PlatformFailure | null;
}

export class ProjectSyncCoordinator {
  private readonly importing = new Map<string, Promise<ProjectImportResult>>();
  private readonly importKeys = new Map<string, Promise<ProjectImportResult>>();
  private readonly git: MacGit;
  private readonly imports: string;
  constructor(private readonly options: ProjectSyncOptions) {
    this.git = new MacGit(options.git, prepareHostProjectDirectory);
    // Outside run/transfer: the original snapshot must outlive a host restart.
    // Constructed under the host service lock, so unfinished preparations here
    // belong to the dead service. Published requests are never collected.
    this.imports = join(dirname(options.recordPath), "imports");
    ensureHostOwnedDirectory(this.imports, dirname(options.recordPath));
    for (const name of readdirSync(this.imports))
      if (name.startsWith(".prepare-import-")) removeHostStaged(join(this.imports, name));
  }
  projects(): readonly ProjectRecord[] {
    const current = readHostRecord(this.options.recordPath);
    if (current === null) throw new StoreError("STORE_CORRUPT", "The app's project record is missing");
    return current.projects;
  }
  private bookmarks(): ProjectBookmarks {
    if (this.options.bookmarks === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Project bookmarks are unavailable");
    return this.options.bookmarks;
  }
  async repo(project: ProjectRecord, requested?: string): Promise<string> {
    const repo = realpathSync(await this.bookmarks().resolve(project.bookmark));
    if (requested !== undefined && realpathSync(requested) !== repo)
      throw new StoreError("INVALID_REQUEST", "The project folder does not match its saved bookmark; bind its new location first");
    await this.git.verifyIdentity(repo, project);
    return repo;
  }
  async bindProject(params: ProjectBindRequest): Promise<ProjectBindResult> {
    const repo = realpathSync(params.macRepo);
    const identity = await this.git.identity(repo);
    const bookmark = await this.bookmarks().create(repo);
    if (realpathSync(await this.bookmarks().resolve(bookmark)) !== repo)
      throw new StoreError("BROKER_UNAVAILABLE", "The project bookmark does not identify the selected folder");
    // The existing writer re-reads after the asynchronous inspection.
    // Repeating a bind for this Society keeps its original project ID.
    let selected: ProjectRecord | undefined;
    this.options.record(current => {
      const prior = current.projects.find(p => p.society === params.society);
      if (prior !== undefined && (prior.objectFormat !== identity.objectFormat ||
          !identity.rootCommits.some(root => prior.rootCommits.includes(root))))
        throw new StoreError("INVALID_REQUEST", "This Society is bound to another repository");
      selected = prior === undefined ? { ...identity, projectId: randomUUID(), society: params.society,
        displayName: basename(repo).slice(0, 200), bookmark } : { ...prior, bookmark };
      return { ...current, projects: [...current.projects.filter(p => p.society !== params.society), selected] };
    });
    if (selected === undefined) throw new StoreError("STORE_CORRUPT", "The app's project record is missing");
    return { projectId: selected.projectId, displayName: selected.displayName, society: selected.society };
  }
  async importProject(key: string, params: ProjectImportRequest): Promise<ProjectImportResult> {
    const before = [this.importing.get(params.projectId), this.importKeys.get(key)];
    const next = Promise.all(before.map(value => value?.catch(() => undefined))).then(() => this.importAlone(key, params));
    this.importing.set(params.projectId, next);
    this.importKeys.set(key, next);
    try { return await next; }
    finally {
      if (this.importing.get(params.projectId) === next) this.importing.delete(params.projectId);
      if (this.importKeys.get(key) === next) this.importKeys.delete(key);
    }
  }
  private async importAlone(key: string, params: ProjectImportRequest): Promise<ProjectImportResult> {
    const project = this.projects().find(p => p.projectId === params.projectId);
    if (project === undefined) throw new StoreError("INVALID_REQUEST", "Bind the project on this Mac before importing it");
    const name = createHash("sha256").update(key).digest("hex"), dir = join(this.imports, name);
    const intent = JSON.stringify([key, params.projectId, params.macRepo, params.branch, params.since]);
    let saved = this.readImport(dir);
    if (saved !== null && saved.intent !== intent) throw new StoreError("REQUEST_KEY_REUSED", "this import key already names another request");
    if (saved === null) {
      const repo = await this.repo(project, params.macRepo);
      this.options.room(this.imports, 0);
      const preparing = createHostStagingDirectory(this.imports, ".prepare-import-", this.imports);
      try {
        const made = join(preparing, "making.bundle");
        const bundle = await this.git.bundle(repo, params.branch, params.since, made);
        publishMade(made, preparing, "bundle");
        saved = { intent, bundle, previous: project.lastImport ?? null, result: null, failure: null };
        replaceFile(preparing, "request.json", JSON.stringify(saved));
        publishHostStaged(preparing, this.imports, name, this.imports);
      } finally { removeHostStaged(preparing); }
    }
    const file = join(dir, "bundle");
    if (saved.failure !== null) { removeHostStaged(file); throw new PlatformError(saved.failure); }
    if (saved.result === null) {
      try {
        const info = lstatSync(file, { throwIfNoEntry: false });
        if (!info?.isFile() || info.size !== saved.bundle.bytes || await sha256File(file) !== saved.bundle.sha256)
          throw new StoreError("STORE_CORRUPT", "The saved import snapshot is missing or damaged; it cannot be recreated under the same key");
        await putStream(await this.options.link.bytes("stream"), key, file, PLATFORM_FRAME_BYTES);
        const society = await this.options.link.json("society");
        try {
          const result = await requestSociety(society, "project.import",
            { projectId: params.projectId, branch: params.branch, bundle: { bytes: saved.bundle.bytes, sha256: saved.bundle.sha256 } }, key);
          if (result.objectFormat !== project.objectFormat || result.head !== saved.bundle.head || result.ref !== `refs/remotes/mac/${params.branch}`)
            throw new StoreError("BROKER_UNAVAILABLE", "The import result could not be observed");
          saved = { ...saved, result };
          replaceFile(dir, "request.json", JSON.stringify(saved));
        } finally { society.close(); }
      } catch (error) {
        if (error instanceof PlatformError && error.failure.retry === "never") {
          saved = { ...saved, failure: error.failure };
          replaceFile(dir, "request.json", JSON.stringify(saved));
          removeHostStaged(file);
        }
        throw error;
      }
    }
    const { result, previous } = saved;
    if (result === null) throw new StoreError("STORE_CORRUPT", "The saved import has no result");
    if (result.objectFormat !== project.objectFormat || result.ref !== `refs/remotes/mac/${params.branch}`)
      throw new StoreError("STORE_CORRUPT", "The saved import result does not match this project request");
    // An old retry must not roll back a newer import's host checkpoint.
    this.options.record(current => ({ ...current, projects: current.projects.map(p => p.projectId === project.projectId &&
      (p.lastImport?.head ?? null) === (previous?.head ?? null) && (p.lastImport?.at ?? null) === (previous?.at ?? null)
      ? { ...p, lastImport: { head: result.head, at: Date.now() } } : p) }));
    removeHostStaged(file);
    return result;
  }

  private readImport(dir: string): SavedImport | null {
    if (lstatSync(dir, { throwIfNoEntry: false }) === undefined) return null;
    let bytes: string;
    try { bytes = readFileSync(join(dir, "request.json"), "utf8"); }
    catch (cause) {
      throw new StoreError((cause as NodeJS.ErrnoException).code === "ENOENT" ? "STORE_CORRUPT" : "BROKER_UNAVAILABLE",
        "The saved import request cannot be read", { cause });
    }
    try {
      const saved = JSON.parse(bytes) as SavedImport;
      if (Object.keys(saved).sort().join(",") !== "bundle,failure,intent,previous,result" || typeof saved.intent !== "string" ||
          !saved.bundle || Object.keys(saved.bundle).sort().join(",") !== "bytes,head,sha256" ||
          !Number.isSafeInteger(saved.bundle.bytes) || saved.bundle.bytes < 0 || !isValidFullOid(saved.bundle.head) ||
          typeof saved.bundle.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(saved.bundle.sha256) ||
          (saved.previous !== null && (!saved.previous || Object.keys(saved.previous).sort().join(",") !== "at,head" ||
            !isValidFullOid(saved.previous.head) || !Number.isSafeInteger(saved.previous.at) || saved.previous.at < 0)) ||
          (saved.result !== null && (!saved.result || societyResultProblem("project.import", saved.result) !== null || saved.result.head !== saved.bundle.head)) ||
          (saved.failure !== null && (saved.result !== null || responseProblem({ v: 1, id: "saved", ok: false, error: saved.failure }) !== null || saved.failure.retry !== "never")))
        throw new Error("invalid saved import");
      return saved;
    } catch { throw new StoreError("STORE_CORRUPT", "The saved import request is damaged"); }
  }
  async exportProject(key: string, params: ProjectExportRequest): Promise<ProjectExportResult> {
    const project = this.projects().find(p => p.society === params.society);
    if (project === undefined) throw new StoreError("INVALID_REQUEST", "The Society is not bound to a project on this Mac");
    const repo = await this.repo(project, params.macRepo);
    const society = await this.options.link.json("society");
    let exported: Omit<ProjectExportResult, "ref">;
    try { exported = await requestSociety(society, "project.export", { society: params.society, ...(params.since === null ? {} : { since: params.since }) }, key); }
    finally { society.close(); }
    const file = join(this.options.transfer, `${createHash("sha256").update(key).digest("hex")}.export.bundle`);
    try {
      await getStream(await this.options.link.bytes("stream"), key, declared => { this.options.room(this.options.transfer, declared.bytes); return fileSink(file); },
        PLATFORM_FRAME_BYTES);
      // Recheck immediately before writing the Human's repository.
      await this.git.verifyIdentity(repo, project);
      const fetched = await this.git.fetchExport(repo, file);
      // NB-22: nothing malformed reaches the durable record -- a head
      // that is not this repository's object id is not a head.
      const oid = new RegExp(`^[0-9a-f]{${project.objectFormat === "sha256" ? 64 : 40}}$`);
      if (typeof fetched.head !== "string" || !oid.test(fetched.head))
        throw new StoreError("BROKER_UNAVAILABLE", "The export result could not be observed");
      this.options.record(current => ({ ...current, projects: current.projects.map(p => p.projectId === project.projectId
        ? { ...p, lastExport: { head: fetched.head, at: Date.now() } } : p) }));
      return { ...exported, ...fetched, ref: "refs/remotes/oma/main" };
    } finally { removeHostStaged(file); }
  }
}
