/** Society model actions use only the explicit collaboration surface.
 * Raw archive readers, legacy mutation registrations and aliases are retired. */
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@oma/client";
import { collaborationOmaNames } from "@oma/domain/collaboration-surface";
import { parseSurfacePlan } from "@oma/tool-runtime/tool-surface";
import { PrincipalChannel } from "./principal-channel.js";
import { registerCollaborationTools } from "./collaboration-tools.js";

export function omaToolNames(principal: boolean): readonly string[] {
  const selected = parseSurfacePlan(process.env.OMA_TOOL_SURFACE);
  if (selected.state !== "plan") return [];
  if (selected.plan.role !== (principal ? "principal" : "resident"))
    throw new Error("Collaboration catalog belongs to another authenticated role");
  return collaborationOmaNames(selected.plan.role);
}

/** Explicit client inputs only. A Principal grant stays on its private channel,
 * never in an inherited environment or a persisted request. */
export function clientEnvironment(home: string, socket: string, archive: string): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: home, OMA_SOCKET: socket, OMA_MAIL_ARCHIVE: archive,
    PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8",
  };
  for (const name of ["OMA_MAIL_ADDRESSES", "OMA_FRAME_BYTES", "OMA_CONTEXT_BYTES", "OMA_BUNDLE_BYTES", "OMA_ACTOR",
      "OMA_PROJECT_GIT", "OMA_CONTEXT_GIT", "OMA_WORKER_ARCHIVE", "OMA_SOCIETY", "OMA_RECORD_ROOT",
      "OMA_SUBJECT_BYTES", "OMA_BODY_BYTES", "OMA_WORLD_ROOT"]) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) environment[name] = value;
  }
  return environment;
}

export function registerOmaTools(pi: ExtensionAPI, cwd: string, channel: PrincipalChannel = PrincipalChannel.detached(), continuationPermitted?: (name: string) => boolean): (() => Promise<boolean>) | undefined {
  const selected = parseSurfacePlan(process.env.OMA_TOOL_SURFACE);
  // The composition's surface guard refuses unsupported/absent plans. This
  // factory must not register old names while that refusal is still pending.
  if (selected.state !== "plan") return;
  if (selected.plan.role !== (channel.attached ? "principal" : "resident"))
    throw new Error("Collaboration tools belong to another authenticated role");
  const home = process.env.OMA_AGENT_HOME, archive = process.env.OMA_MAIL_ARCHIVE, socket = process.env.OMA_SOCKET;
  if (!home || !archive || !socket || !isAbsolute(home) || !isAbsolute(archive) || !isAbsolute(socket) ||
      !process.env.OMA_ACTOR || !process.env.OMA_RECORD_ROOT)
    throw new Error("Selected collaboration tools require their host-bound client paths, actor and record root");
  const addresses = Number(process.env.OMA_MAIL_ADDRESSES);
  if (!Number.isSafeInteger(addresses) || addresses < 1) throw new Error("Selected collaboration tools require the effective host recipient bound");
  const environment = clientEnvironment(home, socket, archive);
  const client = new Client({ cwd, env: environment }, () => channel.current(), signal => channel.waitForGrant(signal));
  return registerCollaborationTools(pi, client, selected.plan.role, { addresses }, environment.OMA_RECORD_ROOT, continuationPermitted);
}
