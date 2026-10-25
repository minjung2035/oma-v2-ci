/** Host application use case: admits a project-bound session and relays guest commands/observations.
 * GuestHost remains the session-holder owner; this gateway does not infer engine or Worker state. */
import type { ProjectExtensionsResult, SessionMethod, SessionRequests, SocietyMethods } from "@oma/protocol/host-api";
import { requestSociety } from "../society-client.js";
/** The Mac's gateway to guest histories and project settings.
 * Resume uses the same update-safe start as every other engine start. */
import { StoreError } from "@oma/domain/errors";
import type { GuestLink } from "./guest-link.js";
import type { VmLifecycle } from "./lifecycle.js";
import type { ProjectSyncCoordinator } from "./project-sync.js";

export class SessionGateway {
  constructor(private readonly link: GuestLink, private readonly lifecycle: VmLifecycle,
    private readonly projects: ProjectSyncCoordinator, private readonly start: () => Promise<void>) {}
  async projectExtensions(projectId: string): Promise<ProjectExtensionsResult> {
    const project = this.projects.projects().find(p => p.projectId === projectId);
    if (project === undefined) throw new StoreError("INVALID_REQUEST", "The project is not bound on this Mac");
    if (this.lifecycle.state !== "ready") throw new StoreError("BROKER_UNAVAILABLE", "Project settings require an already running engine");
    const peer = await this.link.json("society");
    try { return await requestSociety(peer, "project.extensions", { projectId }); }
    finally { peer.close(); }
  }
  async sessions<M extends SessionMethod>(method: M, params: SessionRequests[M]): Promise<SocietyMethods[M]["result"]> {
    const project = this.projects.projects().find(p => p.projectId === params.projectId);
    if (project === undefined || "society" in params && params.society !== project.society)
      throw new StoreError("INVALID_REQUEST", "That history is not bound to a project on this Mac");
    // A resume may be the first interaction after an update: the boot
    // must take the same pre-update snapshot `start` takes, or the
    // rollback point is gone before this image writes the disk.
    if (method === "session.resume") { await this.start(); }
    else if (this.lifecycle.state !== "ready") throw new StoreError("BROKER_UNAVAILABLE", "Guest histories require an already running engine");
    await this.projects.repo(project);
    const peer = await this.link.json("society");
    try { return await requestSociety(peer, method, { ...params, society: project.society }); }
    finally { peer.close(); }
  }
}
