/** OMA's own tools: read, send and acknowledge mail, and read status.
 *
 * Reading goes straight to the immutable archive with bounded, no-follow file
 * access. Everything that changes state goes through the model-facing CLI with
 * a fixed argv, so the broker's request identity and receipts apply.
 */
import { closeSync, constants, existsSync, fstatSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { logicalFromDisplay, validAddress, validFullOid, validMessageId } from "./batch-view.js";
export { validAddress } from "./batch-view.js";
import { runCliProcess, type CliResult } from "./cli-process.js";
import { PrincipalChannel } from "./principal-channel.js";
import { PRINCIPAL_TOOL_NAMES, registerPrincipalTools } from "./principal-tools.js";
import { registerReviewTools } from "./review-tools.js";
import { REQUEST_PARAMETER_HELP, actorNameOf, integerEnv, refused, requestKeyOf, textResult } from "./shared.js";
import { decodeUtf8 } from "./utf8.js";

/** TSP-008: tools OMA itself owns. A role projection may reorder or group the
 * extensions' tools, but it can never take these away from the agent. */
/** mail-v1: the review requests both roles work, through the same two tool
 * names -- the Worker's schema carries the whole vocabulary, the Principal's
 * only diff and vote. */
export const REVIEW_TOOL_NAMES: readonly string[] = Object.freeze(["oma_merge", "oma_challenge"]);
export const OMA_TOOL_NAMES: readonly string[] = Object.freeze([
  "oma_mail_read",
  "oma_mail_send",
  "oma_mail_ack",
  "oma_status",
  ...REVIEW_TOOL_NAMES,
  // Registered only for the Principal's engine (AV11).
  ...PRINCIPAL_TOOL_NAMES.filter(name => !REVIEW_TOOL_NAMES.includes(name)),
]);
export function omaToolNames(principal: boolean): readonly string[] {
  return principal ? ["oma_mail_read", "oma_mail_send", ...PRINCIPAL_TOOL_NAMES]
    : ["oma_mail_read", "oma_mail_send", "oma_mail_ack", "oma_status", ...REVIEW_TOOL_NAMES];
}
/** A message by any name OMA shows for it (AV15, BATCH-002): its id, the
 * archive path shown for it, that path's file name -- the Maildir name the index
 * lists -- or this society's RFC Message-ID, which its headers show (MAIL-004).
 * Nothing else names a message. */
function mailId(value: string): string | null {
  if (validMessageId(value)) return value;
  const rfc = value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value;
  const domain = MESSAGE_DOMAIN();
  if (domain !== null && rfc.endsWith(domain)) {
    const local = rfc.slice(0, -domain.length);
    return validMessageId(local) ? local : null;
  }
  // P0V-37, P0-2: a path is read back with the root it was shown with -- the
  // sandbox's canonical one, or this engine's own archive root, which is what
  // a Principal's results show (DR1). No other directory names a message.
  const shown = DISPLAYED_ARCHIVE();
  const worker = WORKER_ARCHIVE();
  const prefix = ["/mail/archive/cur/", ...(shown === null ? [] : [`${shown}/`]),
    // mail-v1: a Resident also sees worker-only review mail under its own
    // archive mount. An engine without OMA_WORKER_ARCHIVE (the Principal's)
    // refuses the name entirely.
    ...(worker === null ? [] : ["/mail/workers/cur/", `${worker}/`]),
  ].find(root => value.startsWith(root));
  const suffix = value.endsWith(":2,")
    ? ":2,"
    : value.endsWith(":2")
      ? ":2"
      : null;
  if (suffix === null) return null;
  const name = prefix === undefined ? value : value.slice(prefix.length);
  const candidate = name.slice(0, -suffix.length);
  return validMessageId(candidate) ? candidate : null;
}
function readBoundedMail(
  root: string,
  value: string,
  maximum: number,
): { id: string; text: string } {
  const id = mailId(value);
  if (!id) throw new Error("expected a message id or canonical archive path");
  try {
    return { id, text: readBoundedText(join(root, `${id}:2,`), maximum) };
  } catch (error) {
    // mail-v1: worker-only review mail is not in the public archive; the worker
    // mount is consulted only when this engine has one and the name is absent.
    const worker = WORKER_ARCHIVE();
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || worker === null) throw error;
    return { id, text: readBoundedText(join(worker, `${id}:2,`), maximum) };
  }
}

/** AV23 -- arch §5.1, BATCH-002: a message is a UTF-8 plain text body, and
 * what a reader is pointed at can be read; the Principal has no shell to undo
 * a transfer encoding. Mirrors `readableMail` in src/mail/display.ts, which
 * owns the rule (PI-001 keeps this extension free of runtime imports); a test
 * binds the two (INV04). */
export function readableMail(text: string): string {
  // P0V-45, P0-2: the header block ends where `headerEnd` says (CRLF as the
  // writer emits it, LF as older mail has it), and the body keeps every
  // character its sender wrote, a leading U+FEFF included.
  const crlf = text.indexOf("\r\n\r\n");
  const lf = text.indexOf("\n\n");
  const newline = crlf >= 0 && (lf < 0 || crlf < lf) ? "\r\n" : lf >= 0 ? "\n" : null;
  if (newline === null) return text;
  const split = newline === "\r\n" ? crlf : lf;
  const head = text.slice(0, split);
  const encoded = text.slice(split + newline.length * 2);
  const unfolded = head.split(`${newline} `).join(" ").split(`${newline}\t`).join(" ").split(newline);
  const declared = unfolded.filter(line => /^content-transfer-encoding:/i.test(line));
  if (declared.length !== 1) return text;
  const encoding = declared[0]!.slice(declared[0]!.indexOf(":") + 1).trim().toLowerCase();
  let bytes: Buffer;
  if (encoding === "base64") {
    const compact = encoded.split(newline).join("");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) return text;
    bytes = Buffer.from(compact, "base64");
    if (bytes.toString("base64") !== compact) return text;
  } else return text;
  let body: string;
  try { body = decodeUtf8(bytes); } catch { return text; }
  return `${head}${newline}${newline}${body}`;
}

/** The archive root this engine's CLI results name paths under (DR1): the
 * sandbox's /mail/archive/cur for a Resident, the host's own for the Principal. */
const DISPLAYED_ARCHIVE = (): string | null => {
  const root = process.env.OMA_MAIL_ARCHIVE;
  return root === undefined || !isAbsolute(root) ? null : root.replace(/\/+$/, "");
};

/** mail-v1: the worker-only review archive in this engine's view, set only for
 * Residents (the sandbox bind is /mail/workers; the host path otherwise). The
 * literal "/mail/workers/cur" mirrors RESIDENT_PATHS.workerArchive in
 * src/sandbox.ts -- PI-001 keeps this extension free of runtime imports, so a
 * test binds the two. */
const WORKER_ARCHIVE = (): string | null => {
  const root = process.env.OMA_WORKER_ARCHIVE;
  return root === undefined || !isAbsolute(root) ? null : root.replace(/\/+$/, "");
};

/** AV-10: the file a reply targets. The normal archive is consulted first; a
 * Resident's review thread mail lives only in the worker archive mount, so the
 * same source the read path resolves is used here. A message in neither mount
 * keeps the primary path -- the CLI reports the missing reply target. */
export function replyPathFor(archive: string, id: string): string {
  const candidate = join(archive, `${id}:2,`);
  if (existsSync(candidate)) return candidate;
  const worker = WORKER_ARCHIVE();
  const mounted = worker === null ? null : join(worker, `${id}:2,`);
  return mounted !== null && existsSync(mounted) ? mounted : candidate;
}

/** This society's RFC domain, from the environment the engine was started with. */
const MESSAGE_DOMAIN = (): string | null => {
  const society = process.env.OMA_SOCIETY;
  return society === undefined || society.length === 0 ? null : `@${society}.oma.invalid`;
};

/** One file, not followed if it is a link, read within the bound. */
function readBoundedText(path: string, maximum: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    return decodeUtf8(boundedBytes(fd, maximum));
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** BATCH-002: a delivery notice names at most six messages and the index that
 * lists them all, `/inbox.md`. Inside a sandbox that is a file; the Principal
 * runs on the host, where the same name is the batch view's index. The notice
 * is one text for both, so the tool that reads what it names resolves both. */
const BATCH_INDEX = "/inbox.md";

/** INV09, PR-004: what the model supplies is data. Each value is checked against the
 * grammar of the slot it is going into before the CLI is started, and it goes
 * into that slot and no other: an option's value right after its option, an
 * address after `--`. The CLI refuses an option it does not know or one given
 * twice, so a value that looks like an option cannot become one on either side.
 * The grammar is the extension's one mirror of the wire grammar (batch-view.ts;
 * the extension may not import the host's, PI-001; INV04 binds the mirror to its
 * owner by an equivalence test). */
const SEND_KINDS: ReadonlySet<string> = new Set(["message", "question", "result", "alert", "critical"]);

/** The one spelling of a message the CLI is handed: its id. */
function messageIdOf(value: unknown): string {
  return (typeof value === "string" ? mailId(value) : null) ?? refused("message id or archive path", value);
}

/** Reads exactly the file that was measured, and no more than the bound.
 *
 * Checking the size and then reading "the whole file" is two observations: a
 * file that grows in between is read past its bound, because the read never
 * saw the limit. Read-only mode does not prevent that for a process of the
 * same user, so the count is fixed at the measured size, one more byte proves
 * nothing was appended, and the identity is compared again afterwards. This is
 * the same discipline the core applies to its immutable files; the extension
 * cannot import that code (PI-001), so it states it here.
 */
function boundedBytes(fd: number, maximum: number): Buffer {
  const before = fstatSync(fd);
  if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > maximum)
    throw new Error("mail is not a bounded regular file");
  const bytes = Buffer.allocUnsafe(before.size);
  let filled = 0;
  while (filled < before.size) {
    const count = readSync(fd, bytes, filled, before.size - filled, filled);
    if (count === 0) throw new Error("mail was truncated while it was read");
    filled += count;
  }
  if (readSync(fd, Buffer.allocUnsafe(1), 0, 1, before.size) !== 0)
    throw new Error("mail grew while it was read");
  const after = fstatSync(fd);
  if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
    throw new Error("mail changed while it was read");
  return bytes;
}
/** Mirrors the frame- and stream-limit names the CLI reads. The extension cannot import
 * OMA's modules (PI-001); a rule holds the names this file forwards to the
 * names the CLI reads. */
const FRAME_BYTES = "OMA_FRAME_BYTES";
const CONTEXT_BYTES = "OMA_CONTEXT_BYTES";
const BUNDLE_BYTES = "OMA_BUNDLE_BYTES";

/** The environment the model-facing CLI is started with.
 *
 * It is built, never inherited, so anything else in the engine's environment
 * -- a provider key, a session path -- cannot travel with it. Nothing secret
 * is in it: a Principal credential goes to the CLI on its own private
 * descriptor (see cli-process.ts), because an environment is readable by any
 * process of this user through /proc/<pid>/environ.
 */
export function cliEnvironment(home: string, socket: string, archive: string): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: home,
    OMA_SOCKET: socket,
    // DR1: the archive root in this engine's view, so the CLI shows paths there.
    OMA_MAIL_ARCHIVE: archive,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C.UTF-8",
  };
  // The frame and stream bounds the broker was configured with. Without them
  // the CLI falls back to its own defaults, which are not necessarily this
  // society's.
  for (const name of [FRAME_BYTES, CONTEXT_BYTES, BUNDLE_BYTES, "OMA_PROJECT_GIT", "OMA_CONTEXT_GIT", "OMA_WORKER_ARCHIVE"]) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) environment[name] = value;
  }
  return environment;
}

/** The CLI owns each preparation/transport deadline. No sum-of-phases tool
 * timer may kill it between an accepted effect and its same-key lookup. */
async function runCli(
  cli: string,
  cwd: string,
  environment: Readonly<Record<string, string>>,
  channel: PrincipalChannel,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const result = await runCliProcess({
    node: process.execPath, cli, args, cwd, env: environment,
    // Read at each call: a restarted broker replaces the credential.
    grant: channel.current(),
    signal,
  });
  const failure = cliFailure(result, args);
  if (failure !== null) throw failure;
  return result.stdout.trim();
}
/** DR13, P0-5: what a tool reports when the CLI it ran did not succeed. A CLI
 * that answered speaks for itself (it names the key when the outcome is to be
 * looked up again, CLI-003). One this tool stopped, or could not start, gave no
 * answer: the request may stand accepted, so the tool says the outcome is
 * unknown and names the request key to look it up with, never "failed". */
export function cliFailure(result: CliResult, args: readonly string[]): Error | null {
  const at = args.indexOf("--request");
  const key = at >= 0 && at + 1 < args.length && args[at + 1] !== "--" ? args[at + 1] : undefined;
  if (!result.finished)
    return new Error(key === undefined
      ? "Outcome unknown:The CLI stopped before replying"
      : `Outcome unknown:The CLI stopped before replying, so the outcome is unknown. Call again with the same request "${key}" to query the outcome; do not use a new request`);
  if (result.code === 0) return null;
  return new Error((result.stderr || result.stdout || `CLI exited ${result.code}`).trim().slice(0, 2000));
}
export function registerOmaTools(pi: ExtensionAPI, cwd: string, channel: PrincipalChannel = PrincipalChannel.detached()): (() => Promise<boolean>) | undefined {
  const cli = process.env.OMA_CLI_PATH;
  const home = process.env.OMA_AGENT_HOME;
  const archive = process.env.OMA_MAIL_ARCHIVE;
  const socket = process.env.OMA_SOCKET;
  const maximum = integerEnv("OMA_MAIL_BYTES") ?? 1024 * 1024;
  const batchView = process.env.OMA_BATCH_VIEW;
  const society = process.env.OMA_SOCIETY;
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
  // Read once, here, where every other value this extension needs is read. A
  // command assembled later from whatever the environment happens to hold then
  // would not be the environment the engine was started with.
  const environment = cliEnvironment(home, socket, archive);
  pi.registerTool({
    name: "oma_mail_read",
    label: "Read OMA mail",
    description:
      "Read one durable mail message by its id or the archive path a notice or tool result showed. `/inbox.md` reads this batch's delivery index.",
    promptSnippet: "Read mail by id or `/inbox.md`.",
    parameters: Type.Object({
      messageId: Type.String({
        description: "Message id or archive path from a notice, or /inbox.md",
      }),
    }),
    async execute(_id, params) {
      if (params.messageId === BATCH_INDEX) {
        if (batchView === undefined || !isAbsolute(batchView)) throw new Error("no delivery index is available here");
        return textResult(readBoundedText(join(batchView, "inbox.md"), maximum), { index: BATCH_INDEX });
      }
      const mail = readBoundedMail(archive, params.messageId, maximum);
      return textResult(readableMail(mail.text), { messageId: mail.id });
    },
  });
  pi.registerTool({
    name: "oma_mail_send",
    label: "Send OMA mail",
    description: "Send durable mail to agents or shared addresses. `to` names agents or addresses (`commons`/`residents` reach every Worker, `principal` reaches the Principal); `replyTo` threads the message; `kind` marks message/question/result/alert/critical.",
    promptSnippet: "Send durable society mail.",
    parameters: Type.Object({
      to: Type.Array(Type.String(), { minItems: 1, maxItems: 32,
        description: "agent names, or shared addresses: commons / residents (all Workers), principal" }),
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
      ...(channel.attached ? { intent: Type.Optional(Type.Literal("goal", { description: "Explicitly publish this body as GOAL.md and mail it to residents. Requires expectedRevision; preserves other shared context documents." })),
        expectedRevision: Type.Optional(Type.String({ description: "Current context revision or none for the first GOAL" })) } : {}),
      replyTo: Type.Optional(Type.String()),
      request: Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP })),
    }),
    async execute(id, params, signal, _update, context) {
      // AV15: the address a header or notice shows is accepted as the logical
      // address it displays; nothing else is.
      const to = params.to.map(address => {
        const logical = logicalFromDisplay(address, society) ?? address;
        return validAddress(logical) ? logical : refused("address", address);
      });
      const intent = "intent" in params ? params.intent : undefined;
      const expected = "expectedRevision" in params ? params.expectedRevision : undefined;
      if (intent !== undefined && (!channel.attached || intent !== "goal" || typeof expected !== "string" ||
          (expected !== "none" && !validFullOid(expected)) ||
          to.length !== 1 || to[0] !== "residents" || params.kind !== undefined || params.replyTo !== undefined))
        refused("GOAL mail intent", params);
      if (intent === undefined && expected !== undefined) refused("expectedRevision without GOAL intent", expected);
      const kind = params.kind ?? "message";
      if (!SEND_KINDS.has(kind)) refused("mail kind", kind);
      const key = requestKeyOf(params.request, { id, tool: "oma_mail_send", params, context });
      // AV-10: a Resident's review thread mail lives in the worker-only
      // archive; the reply path resolves the same mount the read path does.
      const reply = params.replyTo === undefined ? null : replyPathFor(archive, messageIdOf(params.replyTo));
      const temporary = mkdtempSync(join(home, "oma-tool-"));
      const body = join(temporary, "body.txt");
      try {
        writeFileSync(body, params.body, { mode: 0o600 });
        const args = [
          "send",
          "--subject", params.subject,
          "--file", body,
          ...(intent === "goal" ? ["--intent", "goal", "--expect", expected as string] : ["--kind", kind]),
          "--request", key,
          ...(reply === null ? [] : ["--reply", reply]),
          "--", ...to,
        ];
        return textResult(
          await runCli(cli, cwd, environment, channel, args, signal),
          { request: key },
        );
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  });
  if (!channel.attached) pi.registerTool({
    name: "oma_mail_ack",
    label: "Acknowledge OMA mail",
    description: "Durably acknowledge one delivered message so it stops pending. Acknowledge after you have read and acted on it.",
    parameters: Type.Object({
      messageId: Type.String(),
      request: Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP })),
    }),
    async execute(id, params, signal, _update, context) {
      const message = messageIdOf(params.messageId);
      const key = requestKeyOf(params.request, { id, tool: "oma_mail_ack", params, context });
      return textResult(
        await runCli(
          cli,
          cwd,
          environment,
          channel,
          ["ack", "--request", key, "--", message],
          signal,
        ),
        { request: key },
      );
    },
  });
  if (!channel.attached) pi.registerTool({
    name: "oma_status",
    label: "OMA status",
    description: "Read society status or one agent's row. Counts are pending deliveries, not messages read or work done.",
    parameters: Type.Object({ agent: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      return textResult(
        await runCli(
          cli,
          cwd,
          environment,
          channel,
          params.agent === undefined ? ["status"]
            : ["status", "--", actorNameOf(params.agent, society, "agent")],
          signal,
        ),
      );
    },
  });
  // mail-v1: Workers open, discuss, vote and read the merge/challenge requests
  // the broker's review module applies. The Principal's restricted pair of the
  // same names is registered in registerPrincipalTools.
  if (!channel.attached)
    registerReviewTools(pi, { principal: false,
      run: (args, signal) => runCli(cli, cwd, environment, channel, args, signal), temporaryRoot: home });
  // AV11: the Principal's other capabilities go through the same CLI, as the Principal.
  if (channel.attached)
    registerPrincipalTools(pi, { run: (args, signal, at) => runCli(cli, at ?? cwd, environment, channel, args, signal),
      workspace: cwd, society });
  // RUN-003: observe only at a persisted tool boundary, through the same
  // authenticated CLI and frozen environment as every collaboration tool.
  if (!channel.attached) return async () => {
    const value: unknown = JSON.parse(await runCli(cli, cwd, environment, channel, ["agent", "wait", "--observe", "true"]));
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 || !("accepted" in value) || typeof value.accepted !== "boolean")
      throw new Error("Run wait observation was malformed");
    return value.accepted;
  };
}
