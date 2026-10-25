/** A refused workspace effect; no filesystem observation is fabricated. */
export class WorkspaceRefusal extends Error {
  constructor(message: string) { super(message); this.name = "WorkspaceRefusal"; }
}
