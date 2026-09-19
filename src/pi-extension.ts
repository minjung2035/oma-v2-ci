// Compiled trusted Pi extension. It imports no OMA runtime module so a reviewed
// single-file build can be mounted into either the resident sandbox or host RPC mode.
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const BATCH = new RegExp(`^b-${UUID_V4}$`);
const MESSAGE = new RegExp(`^m-${UUID_V4}-([0-9]+)$`);
const ACTOR = /^[a-z][a-z0-9-]{0,31}$/;
const RESERVED = new Set([
  "principal",
  "commons",
  "residents",
  "topic",
  "broker",
  "principal-relay",
  "reconcile",
]);
export const PI_ADAPTER_REVISION = "oma-pi-rpc-v1@0.85.1";
/** TSP-008: tools OMA itself owns. A role projection may reorder or group the
 * extensions' tools, but it can never take these away from the agent. */
export const OMA_TOOL_NAMES: readonly string[] = Object.freeze([
  "oma_mail_read",
  "oma_mail_send",
  "oma_mail_ack",
  "oma_status",
]);
export const PI_BOUNDARY_PREFIX = "OMA_PI_BOUNDARY_V1 ";
interface BatchManifest {
  id: string;
  agent: string;
  incarnation: number;
  deliveryMode: "steer" | "followUp";
  notice: string;
  messageIds: string[];
}
interface ViewLimits {
  frameBytes: number;
  batchMaxMessages: number;
}
function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function validMessageId(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = MESSAGE.exec(value);
  return match !== null && Number.isSafeInteger(Number(match[1]));
}
function validLimits(limits: ViewLimits): boolean {
  return (
    Number.isSafeInteger(limits.frameBytes) &&
    limits.frameBytes > 0 &&
    Number.isSafeInteger(limits.batchMaxMessages) &&
    limits.batchMaxMessages > 0
  );
}
function decodeManifest(
  value: unknown,
  expected: string,
  limits: ViewLimits,
): BatchManifest | null {
  const keys = [
    "id",
    "agent",
    "incarnation",
    "deliveryMode",
    "notice",
    "messageIds",
  ];
  if (
    !validLimits(limits) ||
    !exactObject(value, keys) ||
    value.id !== expected ||
    !BATCH.test(value.id as string) ||
    typeof value.agent !== "string" ||
    !ACTOR.test(value.agent) ||
    RESERVED.has(value.agent) ||
    value.agent.startsWith("topic-") ||
    !Number.isSafeInteger(value.incarnation) ||
    (value.incarnation as number) < 0 ||
    (value.deliveryMode !== "steer" && value.deliveryMode !== "followUp") ||
    typeof value.notice !== "string" ||
    Buffer.byteLength(value.notice) > limits.frameBytes ||
    !Array.isArray(value.messageIds) ||
    value.messageIds.length > limits.batchMaxMessages ||
    value.messageIds.some((id) => !validMessageId(id)) ||
    new Set(value.messageIds).size !== value.messageIds.length
  )
    return null;
  return {
    id: value.id as string,
    agent: value.agent,
    incarnation: value.incarnation as number,
    deliveryMode: value.deliveryMode,
    notice: value.notice,
    messageIds: [...value.messageIds] as string[],
  };
}
export function decodeBatchViewText(
  text: string,
  expected: string,
  limits: ViewLimits,
): BatchManifest | null {
  if (!validLimits(limits) || Buffer.byteLength(text) > limits.frameBytes)
    return null;
  try {
    return decodeManifest(JSON.parse(text), expected, limits);
  } catch {
    return null;
  }
}
export function readBatchView(
  batchId: string,
  root: string,
  limits: ViewLimits,
): BatchManifest | null {
  if (!BATCH.test(batchId) || !validLimits(limits)) return null;
  const path = join(root, `batch-${batchId}.json`);
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limits.frameBytes) return null;
    const bytes = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(fd, bytes, total, bytes.length - total, total);
      if (count === 0) break;
      total += count;
    }
    const after = fstatSync(fd);
    if (
      total !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      return null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
    return decodeBatchViewText(text, batchId, limits);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function integerEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function inside(root: string, path: string): boolean {
  const offset = relative(root, path);
  return (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  );
}
function allowedWorkspacePath(root: string, input: unknown): boolean {
  if (typeof input !== "string" || input.includes("\0")) return false;
  const target = resolve(root, input);
  if (!inside(root, target)) return false;
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  try {
    return inside(root, realpathSync(existing));
  } catch {
    return false;
  }
}
function workspaceUsage(root: string, stopAfter: number): number {
  const pending = [root];
  const files = new Set<string>();
  let total = 0;
  while (pending.length > 0) {
    const path = pending.pop()!;
    let stat: ReturnType<typeof lstatSync>;
    try { stat = lstatSync(path); } catch { continue; }
    if (stat.isFile()) {
      const identity = `${stat.dev}:${stat.ino}`;
      if (files.has(identity)) continue;
      files.add(identity);
      total += stat.size;
    } else if (stat.isSymbolicLink()) total += stat.size;
    if (total > stopAfter) return total;
    if (!stat.isDirectory()) continue;
    try { for (const name of readdirSync(path)) pending.push(join(path, name)); } catch { return stopAfter + 1; }
  }
  return total;
}

function workspaceWriteFits(root: string, tool: string, input: Record<string, unknown>, maximum: number): boolean {
  if (tool !== "write" && tool !== "edit") return true;
  const path = typeof input.path === "string" ? resolve(root, input.path) : null;
  if (!path) return false;
  let growth = 0;
  if (tool === "write") {
    if (typeof input.content !== "string") return false;
    growth = Buffer.byteLength(input.content);
    try { const current = lstatSync(path); if (current.isFile()) growth = Math.max(0, growth - current.size); } catch { /* new file */ }
  } else {
    if (typeof input.newText !== "string") return false;
    growth = Buffer.byteLength(input.newText);
  }
  return growth <= maximum && workspaceUsage(root, maximum - growth) <= maximum - growth;
}
function mailId(value: string): string | null {
  if (validMessageId(value)) return value;
  const prefix = "/mail/archive/cur/";
  const suffix = value.endsWith(":2,")
    ? ":2,"
    : value.endsWith(":2")
      ? ":2"
      : null;
  if (!value.startsWith(prefix) || suffix === null) return null;
  const candidate = value.slice(prefix.length, -suffix.length);
  return validMessageId(candidate) ? candidate : null;
}
function readBoundedMail(
  root: string,
  value: string,
  maximum: number,
): { id: string; text: string } {
  const id = mailId(value);
  if (!id) throw new Error("expected a message id or canonical archive path");
  const path = join(root, `${id}:2,`);
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum)
      throw new Error("mail is not a bounded regular file");
    return {
      id,
      text: new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(fd)),
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}
async function runCli(
  pi: ExtensionAPI,
  cli: string,
  cwd: string,
  home: string,
  socket: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const command = [
    "-i",
    `HOME=${home}`,
    `OMA_SOCKET=${socket}`,
    `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`,
    "LANG=C.UTF-8",
    process.execPath,
    cli,
    ...args,
  ];
  const result = await pi.exec(
    "/usr/bin/env",
    command,
    signal ? { cwd, signal } : { cwd },
  );
  if (result.code !== 0)
    throw new Error(
      (result.stderr || result.stdout || `CLI exited ${result.code}`)
        .trim()
        .slice(0, 2000),
    );
  return result.stdout.trim();
}
function registerOmaTools(pi: ExtensionAPI, cwd: string): void {
  const cli = process.env.OMA_CLI_PATH;
  const home = process.env.OMA_AGENT_HOME;
  const archive = process.env.OMA_MAIL_ARCHIVE;
  const socket = process.env.OMA_SOCKET;
  const maximum = integerEnv("OMA_MAIL_BYTES") ?? 1024 * 1024;
  if (
    !cli ||
    !home ||
    !archive ||
    !socket ||
    !isAbsolute(cli) ||
    !isAbsolute(home) ||
    !isAbsolute(archive) ||
    !isAbsolute(socket)
  )
    return;
  pi.registerTool({
    name: "oma_mail_read",
    label: "Read OMA mail",
    description:
      "Read one immutable OMA mail message by message id or canonical /mail/archive/cur path.",
    promptSnippet: "Read OMA mail using the path from the delivery notice.",
    parameters: Type.Object({
      messageId: Type.String({
        description: "Message id or canonical archive path from the notice",
      }),
    }),
    async execute(_id, params) {
      const mail = readBoundedMail(archive, params.messageId, maximum);
      return textResult(mail.text, { messageId: mail.id });
    },
  });
  pi.registerTool({
    name: "oma_mail_send",
    label: "Send OMA mail",
    description: "Send durable mail to agents or public addresses.",
    promptSnippet: "Send collaboration results through durable OMA mail.",
    parameters: Type.Object({
      to: Type.Array(Type.String(), { minItems: 1, maxItems: 32 }),
      subject: Type.String({ maxLength: 998 }),
      body: Type.String(),
      kind: Type.Optional(
        Type.Union([
          Type.Literal("message"),
          Type.Literal("question"),
          Type.Literal("result"),
          Type.Literal("alert"),
          Type.Literal("critical"),
        ]),
      ),
      replyTo: Type.Optional(Type.String()),
      request: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const temporary = mkdtempSync(join(home, "oma-tool-"));
      const body = join(temporary, "body.txt");
      try {
        writeFileSync(body, params.body, { mode: 0o600 });
        const key = params.request ?? `pi-${crypto.randomUUID()}`;
        const args = [
          "send",
          ...params.to,
          "--subject",
          params.subject,
          "--file",
          body,
          "--kind",
          params.kind ?? "message",
          "--request",
          key,
        ];
        if (params.replyTo) args.push("--reply", params.replyTo);
        return textResult(
          await runCli(pi, cli, cwd, home, socket, args, signal),
          { request: key },
        );
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  });
  pi.registerTool({
    name: "oma_mail_ack",
    label: "Acknowledge OMA mail",
    description: "Durably acknowledge one OMA message.",
    parameters: Type.Object({
      messageId: Type.String(),
      request: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const key = params.request ?? `pi-${crypto.randomUUID()}`;
      return textResult(
        await runCli(
          pi,
          cli,
          cwd,
          home,
          socket,
          ["ack", params.messageId, "--request", key],
          signal,
        ),
        { request: key },
      );
    },
  });
  pi.registerTool({
    name: "oma_status",
    label: "OMA status",
    description: "Read society or agent status.",
    parameters: Type.Object({ agent: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      return textResult(
        await runCli(
          pi,
          cli,
          cwd,
          home,
          socket,
          params.agent ? ["status", params.agent] : ["status"],
          signal,
        ),
      );
    },
  });
}

export default function extension(pi: ExtensionAPI) {
  const root = process.env.OMA_BATCH_VIEW ?? "/run/oma-view";
  const frameBytes = integerEnv("OMA_FRAME_BYTES");
  const batchMaxMessages = integerEnv("OMA_BATCH_MAX_MESSAGES");
  const workspaceBytes = integerEnv("OMA_WORKSPACE_BYTES");
  const workspace = realpathSync(process.cwd());
  let pending: BatchManifest | null = null;
  let terminalStop: string | null = null;
  registerOmaTools(pi, workspace);
  registerToolSurface(pi, OMA_TOOL_NAMES);
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" || event.toolName === "powershell")
      return {
        block: true,
        reason: "shell tools are disabled for OMA residents",
      };
    if (
      !["read", "write", "edit", "grep", "find", "ls"].includes(event.toolName)
    )
      return undefined;
    const input = event.input as Record<string, unknown>;
    const path = input.path ?? ".";
    if (!allowedWorkspacePath(workspace, path))
      return { block: true, reason: "tool path is outside the agent workspace" };
    if ((event.toolName === "write" || event.toolName === "edit") &&
        (!workspaceBytes || !workspaceWriteFits(workspace, event.toolName, input, workspaceBytes)))
      return { block: true, reason: "agent workspace quota would be exceeded" };
    return undefined;
  });
  pi.on("message_end", (event) => {
    // SAFETY: Pi's typed message_end contract supplies the discriminated AgentMessage union.
    const message = event.message;
    if (pending && message?.role === "assistant")
      terminalStop = message.stopReason ?? null;
  });
  pi.registerCommand("oma-deliver", {
    description: "Deliver one broker-prepared immutable mail batch",
    handler: async (args, ctx) => {
      if (pending || frameBytes === null || batchMaxMessages === null) {
        ctx.ui.notify("OMA delivery adapter is unavailable or busy", "error");
        return;
      }
      const batch = readBatchView(args.trim(), root, {
        frameBytes,
        batchMaxMessages,
      });
      if (!batch) {
        ctx.ui.notify("Invalid or unavailable OMA batch", "error");
        return;
      }
      pending = batch;
      terminalStop = null;
      await pi.sendMessage(
        {
          customType: "oma-mail",
          content: batch.notice,
          display: true,
          details: {
            batchId: batch.id,
            incarnation: batch.incarnation,
            messageIds: batch.messageIds,
          },
        },
        { triggerTurn: true, deliverAs: batch.deliveryMode },
      );
    },
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const batch = pending;
    if (!batch || terminalStop !== "stop") return;
    const sessionPath = ctx.sessionManager.getSessionFile();
    if (!sessionPath || !isAbsolute(sessionPath)) return;
    pi.appendEntry("oma-delivery-boundary", {
      adapterRevision: PI_ADAPTER_REVISION,
      batchId: batch.id,
      incarnation: batch.incarnation,
      messageIds: batch.messageIds,
      sessionPath,
    });
    const leaf = ctx.sessionManager.getLeafEntry();
    if (
      !leaf ||
      leaf.type !== "custom" ||
      leaf.customType !== "oma-delivery-boundary"
    )
      return;
    ctx.ui.notify(
      `${PI_BOUNDARY_PREFIX}${JSON.stringify({
        adapterRevision: PI_ADAPTER_REVISION,
        batchId: batch.id,
        incarnation: batch.incarnation,
        sessionPath,
        entryId: leaf.id,
      })}`,
      "info",
    );
    pending = null;
    terminalStop = null;
  });
}

/** TSP-005..008: apply the host-validated tool surface projection.
 *
 * The plan arrives already validated: cycles, duplicates, unknown references
 * and limits were rejected at config load. Inside the sandbox this code only
 * does set arithmetic over Pi's own tool registry. It never loads an extension,
 * never wraps a tool and never executes another extension's handler — opening a
 * group activates the real tools so Pi's own pipeline runs them.
 */
interface SurfacePlanGroup {
  readonly name: string;
  readonly description: string;
  readonly children: readonly string[];
}
interface SurfacePlan {
  readonly defaultMode: "DIRECT" | "DISABLED";
  readonly direct: readonly string[];
  readonly disabled: readonly string[];
  readonly grouped: readonly string[];
  readonly groups: readonly SurfacePlanGroup[];
  readonly roots: readonly string[];
}
type SurfaceParse =
  | { readonly state: "absent" }
  | { readonly state: "plan"; readonly plan: SurfacePlan }
  | { readonly state: "malformed"; readonly reason: string };

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) if (typeof entry !== "string" || entry.length === 0) return null;
  return value as readonly string[];
}

export function parseSurfacePlan(raw: string | undefined): SurfaceParse {
  if (raw === undefined || raw.trim().length === 0) return { state: "absent" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { state: "malformed", reason: "not JSON" }; }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { state: "malformed", reason: "not an object" };
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return { state: "malformed", reason: "unsupported version" };
  const mode = record.defaultMode;
  if (mode !== "DIRECT" && mode !== "DISABLED") return { state: "malformed", reason: "bad defaultMode" };
  const direct = stringArray(record.direct);
  const disabled = stringArray(record.disabled);
  const grouped = stringArray(record.grouped);
  const roots = stringArray(record.roots);
  if (!direct || !disabled || !grouped || !roots) return { state: "malformed", reason: "bad name list" };
  if (!Array.isArray(record.groups)) return { state: "malformed", reason: "bad groups" };
  const groups: SurfacePlanGroup[] = [];
  for (const entry of record.groups) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      return { state: "malformed", reason: "bad group" };
    const group = entry as Record<string, unknown>;
    const children = stringArray(group.children);
    if (typeof group.name !== "string" || typeof group.description !== "string" || !children)
      return { state: "malformed", reason: "bad group" };
    groups.push({ name: group.name, description: group.description, children });
  }
  return { state: "plan", plan: { defaultMode: mode, direct, disabled, grouped, groups, roots } };
}

/** DIRECT tools plus the entry-point groups. A tool the plan never mentions
 * follows defaultMode. Names OMA itself registers are always kept so a
 * projection cannot strand the agent without its mail tools.
 */
export function initialActiveTools(
  plan: SurfacePlan,
  registered: readonly string[],
  always: readonly string[],
): string[] {
  const disabled = new Set(plan.disabled);
  const grouped = new Set(plan.grouped);
  const direct = new Set(plan.direct);
  const groupNames = new Set(plan.groups.map((group) => group.name));
  const active = new Set<string>(always);
  for (const name of registered) {
    if (always.includes(name) || groupNames.has(name)) continue;
    if (disabled.has(name) || grouped.has(name)) continue;
    if (direct.has(name) || plan.defaultMode === "DIRECT") active.add(name);
  }
  for (const root of plan.roots) if (groupNames.has(root)) active.add(root);
  return [...active].sort();
}

/** Additive by construction: revealing a group never deactivates a tool another
 * extension activated, and repeating the call is a no-op.
 */
export function expandedActiveTools(
  current: readonly string[],
  children: readonly string[],
): { readonly next: string[]; readonly revealed: string[] } {
  const active = new Set(current);
  const revealed: string[] = [];
  for (const child of children) if (!active.has(child)) { active.add(child); revealed.push(child); }
  return { next: [...active].sort(), revealed };
}

export function registerToolSurface(pi: ExtensionAPI, always: readonly string[]): void {
  const parsed = parseSurfacePlan(process.env.OMA_TOOL_SURFACE);
  if (parsed.state === "absent") return;
  // TSP-007: the projection is a containment decision, so a host that refuses
  // the change leaves the surface in an unproven state. Failing loudly is the
  // only outcome that cannot silently expose a tool meant to be disabled.
  const apply = (names: readonly string[], phase: string): void => {
    try { pi.setActiveTools([...names]); }
    catch (error) {
      throw new Error(`OMA tool surface ${phase} could not be applied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  if (parsed.state === "malformed") {
    // Fail closed, but not during load: the engine rejects action methods while
    // extensions are still loading, and throwing here would stop the trusted
    // extension from loading at all. The surface is narrowed at session start,
    // before the model can call anything.
    pi.on("session_start", () => { apply(always, `fallback (${parsed.reason})`); });
    return;
  }
  const plan = parsed.plan;
  for (const group of plan.groups) {
    pi.registerTool({
      name: group.name,
      label: group.name,
      description: `${group.description} Opening this group enables its tools for the next turn.`,
      promptSnippet: "Open a tool group to reveal the tools it contains.",
      parameters: Type.Object({}),
      executionMode: "sequential",
      async execute() {
        // An unreadable active set must not be treated as empty: that would
        // deactivate every tool the session already had.
        let active: readonly string[];
        try { active = [...pi.getActiveTools()]; }
        catch (error) {
          throw new Error(`OMA tool surface could not read the active tools: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { next, revealed } = expandedActiveTools(active, group.children);
        apply(next, `group "${group.name}"`);
        const text = revealed.length === 0
          ? `${group.name}: already enabled (${group.children.join(", ")})`
          : `${group.name}: enabled ${revealed.length} (${revealed.join(", ")})`;
        return textResult(text, { group: group.name, revealed });
      },
    });
  }
  const project = (): void => {
    let registered: string[];
    try { registered = pi.getAllTools().map((tool) => tool.name); }
    catch (error) {
      throw new Error(`OMA tool surface could not read the registered tools: ${error instanceof Error ? error.message : String(error)}`);
    }
    apply(initialActiveTools(plan, registered, always), "projection");
  };
  // Registering tools is allowed while loading; reading or setting the active
  // set is not. The projection therefore happens only at session start, which
  // still precedes any model turn.
  pi.on("session_start", () => { project(); });
}
