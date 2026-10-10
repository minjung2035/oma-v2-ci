import type { ProjectBindRequest, ProjectBindResult, ProjectExportRequest, ProjectExportResult, ProjectImportRequest, ProjectImportResult } from "../../protocol/host-api.js";
import { requestSociety } from "../society-client.js";
/** Host-owned project identity and explicit import/export (MAC-404/411/412).
 * Record publication and stream staging keep their existing owners. */
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { PLATFORM_FRAME_BYTES } from "../../protocol/host-guest.js";
import type { ProjectBookmarks } from "./bookmark.js";
import { removeHostStaged } from "./files.js";
import type { GuestLink } from "./guest-link.js";
import { MacGit, fileSink, getStream, putStream } from "./project.js";
import { readHostRecord, type HostRecord, type ProjectRecord } from "./record.js";


export interface ProjectSyncOptions {
  readonly link: GuestLink;
  readonly git: string;
  readonly recordPath: string;
  readonly record: (update: (current: HostRecord) => HostRecord) => void;
  readonly bookmarks?: ProjectBookmarks;
  readonly transfer: string;
  readonly room: (dir: string, incoming: number) => void;
}

export class ProjectSyncCoordinator {
  private readonly importing = new Map<string, Promise<ProjectImportResult>>();
  private readonly git: MacGit;
  constructor(private readonly options: ProjectSyncOptions) { this.git = new MacGit(options.git); }
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
    const before = this.importing.get(params.projectId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(() => this.importAlone(key, params));
    this.importing.set(params.projectId, next);
    try { return await next; }
    finally { if (this.importing.get(params.projectId) === next) this.importing.delete(params.projectId); }
  }
  private async importAlone(key: string, params: ProjectImportRequest): Promise<ProjectImportResult> {
    const project = this.projects().find(p => p.projectId === params.projectId);
    if (project === undefined) throw new StoreError("INVALID_REQUEST", "Bind the project on this Mac before importing it");
    const repo = await this.repo(project, params.macRepo);
    const file = join(this.options.transfer, `${createHash("sha256").update(key).digest("hex")}.import.bundle`);
    this.options.room(this.options.transfer, 0);
    try {
      const bundled = await this.git.bundle(repo, params.branch, params.since, file);
      await putStream(await this.options.link.bytes("stream"), key, file, PLATFORM_FRAME_BYTES);
      const society = await this.options.link.json("society");
      try {
        const result = await requestSociety(society, "project.import",
          { projectId: params.projectId, branch: params.branch, bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, key);
        if (result.objectFormat !== project.objectFormat)
          throw new StoreError("BROKER_UNAVAILABLE", "The import result could not be observed");
        const head = result.head;
        this.options.record(current => ({ ...current, projects: current.projects.map(p => p.projectId === project.projectId
          ? { ...p, lastImport: { head, at: Date.now() } } : p) }));
        return result;
      } finally { society.close(); }
    } finally { removeHostStaged(file); }
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
