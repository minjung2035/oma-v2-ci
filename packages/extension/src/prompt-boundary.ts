/** C15/C19/C21: OMA's prompt policy, applied where the whole prompt is mutable.
 *
 * `before_agent_start` hands extensions the normalized prompt options once per
 * run; mutations are the run's own. Three rules live here because they are the
 * same boundary:
 *
 * - Society's own `--system-prompt` is the identity. `.pi/SYSTEM.md` can never
 *   replace it (the flag wins in the loader), and an APPEND_SYSTEM.md --
 *   discovered or passed -- is dropped: an append nobody enabled is not OMA's
 *   voice either.
 * - A Principal's context files are narrowed to its workspace. It runs on the
 *   host, where ancestor discovery would otherwise reach ~/AGENTS.md, the
 *   shared engine home and the filesystem root. A Resident's chain ends at its
 *   sealed rootfs, so its files are kept as discovered.
 * - The role prompt replaces Pi's coding-agent preamble, which drops the
 *   sections Pi would have built for tool snippets and guidelines. The active
 *   tools' guidance is recomposed here into OMA's own section so a loaded
 *   extension still tells the model how to use its tools.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { collaborationAuthority, collaborationEnvironment, collaborationProfilePrompt } from "@oma/domain/collaboration-prompts";
import type { CollaborationRole } from "@oma/domain/collaboration-surface";

/** The section OMA's guidance is written under. It must match the engine's
 * section-name grammar (lowercase tag), or the prompt build refuses it. */
const GUIDANCE_SECTION = "oma_tools";

/** UX-19: Pi's own boilerplate does not hold inside OMA. A Resident's
 * environment is cleared and carries no PI_* variables, so the engine's
 * "inspect PI_*" guideline is dropped rather than re-spoken under OMA's
 * section name. */
const PI_ENV_BOILERPLATE = /PI_\*/;

function inside(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

/** A context file counts only if its real location is under the workspace. A
 * file that cannot be resolved cannot be proven inside, so it is dropped --
 * the closed direction for a prompt channel. */
function workspaceContext(workspace: string, files: NormalizedBuildSystemPromptOptions["contextFiles"]): typeof files {
  let root: string;
  try { root = realpathSync(workspace); } catch { root = resolve(workspace); }
  return files.filter(file => {
    try { return inside(root, realpathSync(file.path)); }
    catch { return false; }
  });
}

/** The tool guidance a custom system prompt would otherwise lose: every active
 * tool's one-line snippet and its guideline bullets, deduplicated. */
function toolGuidance(pi: ExtensionAPI, options: NormalizedBuildSystemPromptOptions): string {
  let active: readonly string[];
  try { active = pi.getActiveTools(); }
  catch { active = options.selectedTools; }
  const snippets = active.filter(name => typeof options.toolSnippets[name] === "string")
    .map(name => `- ${name}: ${options.toolSnippets[name]}`);
  const rules: string[] = [];
  const dedupe = new Set<string>();
  for (const name of active) {
    for (const rule of options.toolGuidelines[name] ?? []) {
      const trimmed = rule.trim();
      if (trimmed && !PI_ENV_BOILERPLATE.test(trimmed) && !dedupe.has(trimmed)) { dedupe.add(trimmed); rules.push(trimmed); }
    }
  }
  const parts: string[] = [];
  if (snippets.length > 0) parts.push(`Available tools:\n${snippets.join("\n")}`);
  if (rules.length > 0) parts.push(`Guidelines:\n${rules.map(rule => `- ${rule}`).join("\n")}`);
  return parts.join("\n\n");
}

/** Explicit host selection only. Omitting this scope preserves the legacy role,
 * environment and prompt contract; record-root visibility is enforced elsewhere. */
export interface CollaborationPromptScope {
  readonly role: CollaborationRole;
  readonly actor: string;
  readonly recordRoot: string;
  readonly persistentPaths: readonly string[];
  readonly activationProcessesSurvive: boolean;
  readonly rolePrompt?: string;
}
/** `narrow` asks for the workspace-only context policy -- the Principal's.
 * A Resident's ancestor chain is bounded by its sealed rootfs and is kept. */
export function registerPromptBoundary(pi: ExtensionAPI, workspace: string, narrow: boolean, collaboration?: CollaborationPromptScope): void {
  let toolOptions: NormalizedBuildSystemPromptOptions | undefined;
  let owned: Readonly<Record<string, string>> = {};
  const scope = collaboration && { ...collaboration, persistentPaths: [...collaboration.persistentPaths] };
  if (scope) {
    if (narrow !== (scope.role === "principal")) throw new TypeError("prompt role differs from host containment role");
    collaborationEnvironment({ ...scope, workspace, platform: process.platform, observedAtMs: Date.now() });
    collaborationProfilePrompt(scope.role, scope.rolePrompt);
  }
  pi.on("before_agent_start", event => {
    const options = event.systemPromptOptions;
    toolOptions = options;
    if (narrow) options.contextFiles = workspaceContext(workspace, options.contextFiles);
    // The append channel stays closed until an OMA policy opens it: Society's
    // system prompt is authored, not discovered.
    options.appendSystemPrompt = "";
    const guidance = toolGuidance(pi, options);
    if (guidance.length > 0) options.sections[GUIDANCE_SECTION] = guidance;
    else delete options.sections[GUIDANCE_SECTION];
    if (scope) {
      options.customPrompt = collaborationProfilePrompt(scope.role, scope.rolePrompt);
      owned = { oma_authority: collaborationAuthority(scope.role), oma_environment: collaborationEnvironment({ ...scope,
        workspace, platform: process.platform, observedAtMs: Date.now() }) };
      const remaining = { ...options.sections };
      delete remaining.oma_authority; delete remaining.oma_environment; delete remaining[GUIDANCE_SECTION];
      options.sections = { ...owned, ...(guidance ? { [GUIDANCE_SECTION]: guidance } : {}), ...remaining };
    }
    // Returning nothing: a `systemPrompt` result would force-replace the whole
    // prompt, and the role prompt stays the owner.
  });
  // A run can change its toolset between provider calls without another
  // before_agent_start. Refresh owned sections only; retain other declarations
  // and historical messages. New-surface host authority is not profile-owned.
  pi.on("context_with_system", event => {
    if (!toolOptions) return;
    const guidance = toolGuidance(pi, toolOptions);
    const desired: Record<string, string | null> = { [GUIDANCE_SECTION]: guidance || null, ...owned };
    const changed: Record<string, string | null> = {};
    for (const [name, value] of Object.entries(desired)) {
      const expected = value === null ? null : `<${name}>\n${value}\n</${name}>`;
      let current: string | null = null;
      for (const message of event.messages) if (message.role === "system" && message.sections && Object.hasOwn(message.sections, name))
        current = message.sections[name] ?? null;
      if (current !== expected) changed[name] = expected;
    }
    if (Object.keys(changed).length === 0) return;
    return { messages: [...event.messages, { role: "system" as const, content: "",
      sections: changed, timestamp: Date.now() }] };
  });
  pi.on("session_shutdown", () => { toolOptions = undefined; owned = {}; });
}
