/** AV11 -- the Principal's capabilities, reachable by its model.
 *
 * The Principal's profile holds `agent.create`, `agent.manage.descendants`,
 * `route.follow` and `context.publish`, and the society is built on them:
 * Residents are created when they are asked for, and none starts work before
 * the Principal publishes the GOAL (arch §8.3, §15.1; LIFE-004). A Resident
 * reaches the same commands through the shell in its sandbox. The Principal runs
 * on the host without one -- its shell stays excluded until S-02 closes (PR-004)
 * -- and the credential that makes a CLI the Principal's never leaves this
 * extension (T114). Without these tools none of those capabilities could be used.
 *
 * Each tool is one model-facing CLI command (CLI-001). Every value is checked
 * against the grammar of the slot it goes into and goes into that slot only
 * (INV09, as for the mail tools); the CLI and the broker decide everything else
 * -- authority, quota, the frozen request -- exactly as for a Resident.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validActorName, validFullOid, validTopicName } from "./batch-view.js";
import { refused, requestKeyOf, textResult } from "./shared.js";

export const PRINCIPAL_TOOL_NAMES: readonly string[] = Object.freeze([
  "oma_agent_create",
  "oma_agent_lifecycle",
  "oma_route",
  "oma_context_publish",
  "oma_logs",
]);

export interface PrincipalToolContext {
  /** Runs the model-facing CLI as the Principal, with a fixed argv, in the
   * Principal's scratch unless another working directory is named. */
  readonly run: (args: string[], signal?: AbortSignal, cwd?: string) => Promise<string>;
  /** The Principal's private scratch: the only directory its files come from. */
  readonly workspace: string;
  /** The society's canonical repository, read only to name its main. */
  readonly projectGit: string | undefined;
}

/** CLI-001's duration: a positive integer and a unit. */
const DURATION = /^[1-9][0-9]{0,9}[smhd]$/;
const BRIEF_BYTES = 8 * 1024;

function within(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

export function registerPrincipalTools(pi: ExtensionAPI, context: PrincipalToolContext): void {
  const { run, workspace } = context;
  pi.registerTool({
    name: "oma_agent_create",
    label: "Create an OMA Resident",
    description:
      "Create a Resident agent: a name, a brief it starts from, and optionally the full commit id of the base (default: the society's current main). The broker decides its profile and capabilities.",
    parameters: Type.Object({
      name: Type.String(),
      brief: Type.String(),
      from: Type.Optional(Type.String()),
      request: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const name = validActorName(params.name) ? params.name : refused("agent name", params.name);
      if (params.brief.length === 0 || Buffer.byteLength(params.brief) > BRIEF_BYTES) refused("brief (1..8 KiB)", params.brief.slice(0, 40));
      // The default base is the society's main, resolved by the CLI the way it
      // resolves every revision (resolveOid), in the canonical repository.
      if (params.from !== undefined && !validFullOid(params.from)) refused("from (a full commit id)", params.from);
      if (params.from === undefined && (context.projectGit === undefined || !isAbsolute(context.projectGit)))
        refused("from (there is no canonical repository to take main from)", params.from);
      const from = params.from ?? "main";
      const cwd = params.from === undefined ? context.projectGit : undefined;
      const key = requestKeyOf(params.request);
      const temporary = mkdtempSync(join(workspace, "oma-tool-"));
      const brief = join(temporary, "brief.md");
      try {
        writeFileSync(brief, params.brief, { mode: 0o600 });
        return textResult(await run(["agent", "create", "--from", from, "--file", brief, "--request", key, "--", name], signal, cwd), { request: key });
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    },
  });
  pi.registerTool({
    name: "oma_agent_lifecycle",
    label: "Start or stop an OMA Resident",
    description: "Start or stop a Resident this Principal manages.",
    parameters: Type.Object({
      name: Type.String(),
      action: Type.Union([Type.Literal("start"), Type.Literal("stop")]),
      request: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const name = validActorName(params.name) ? params.name : refused("agent name", params.name);
      const action = params.action === "start" || params.action === "stop" ? params.action : refused("action", params.action);
      const key = requestKeyOf(params.request);
      return textResult(await run(["agent", action, "--request", key, "--", name], signal), { request: key });
    },
  });
  pi.registerTool({
    name: "oma_route",
    label: "Follow or unfollow an OMA topic",
    description: "Follow a topic to receive its future mail, or unfollow it.",
    parameters: Type.Object({
      topic: Type.String(),
      action: Type.Union([Type.Literal("follow"), Type.Literal("unfollow")]),
      request: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const topic = validTopicName(params.topic) ? params.topic : refused("topic", params.topic);
      const action = params.action === "follow" || params.action === "unfollow" ? params.action : refused("action", params.action);
      const key = requestKeyOf(params.request);
      return textResult(await run([action, "--request", key, "--", topic], signal), { request: key });
    },
  });
  pi.registerTool({
    name: "oma_context_publish",
    label: "Publish the shared OMA context",
    description:
      "Publish the shared context -- GOAL.md (required), RATIONALE.md, decisions/*.md -- from a directory in your workspace. expect is the current context revision, or none for the first publication.",
    parameters: Type.Object({
      directory: Type.String({ description: "A directory inside your workspace" }),
      expect: Type.String({ description: "The current context revision (full id), or none" }),
      request: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const directory = resolve(workspace, params.directory);
      if (params.directory.includes("\0") || !within(workspace, directory)) refused("directory (inside your workspace)", params.directory);
      const expect = params.expect === "none" || validFullOid(params.expect) ? params.expect : refused("expect (a full id or none)", params.expect);
      const key = requestKeyOf(params.request);
      return textResult(await run(["context", "publish", "--expect", expect, "--request", key, "--", directory], signal), { request: key });
    },
  });
  pi.registerTool({
    name: "oma_logs",
    label: "Read an OMA agent's log",
    description: "Read a Resident's recent journal, for a duration such as 10m or 2h.",
    parameters: Type.Object({ agent: Type.String(), since: Type.String() }),
    async execute(_id, params, signal) {
      const agent = validActorName(params.agent) ? params.agent : refused("agent", params.agent);
      const since = DURATION.test(params.since) ? params.since : refused("since (like 10m)", params.since);
      return textResult(await run(["logs", "--since", since, "--", agent], signal));
    },
  });
}
