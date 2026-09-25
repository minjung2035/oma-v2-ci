/** OMA's own tools: read, send and acknowledge mail, and read status.
 *
 * Reading goes straight to the immutable archive with bounded, no-follow file
 * access. Everything that changes state goes through the model-facing CLI with
 * a fixed argv, so the broker's request identity and receipts apply.
 */
import { closeSync, constants, fstatSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { logicalFromDisplay, validActorName, validAddress, validMessageId } from "./batch-view.js";
export { validAddress } from "./batch-view.js";
import { runCliProcess } from "./cli-process.js";
import { PrincipalChannel } from "./principal-channel.js";
import { PRINCIPAL_TOOL_NAMES, registerPrincipalTools } from "./principal-tools.js";
import { integerEnv, refused, requestKeyOf, textResult } from "./shared.js";

/** TSP-008: tools OMA itself owns. A role projection may reorder or group the
 * extensions' tools, but it can never take these away from the agent. */
export const OMA_TOOL_NAMES: readonly string[] = Object.freeze([
  "oma_mail_read",
  "oma_mail_send",
  "oma_mail_ack",
  "oma_status",
  // Registered only for the Principal's engine (AV11).
  ...PRINCIPAL_TOOL_NAMES,
]);
/** A message by any name OMA shows for it (AV15, BATCH-002): its id, its
 * canonical archive path, that path's file name -- the Maildir name the index
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
  const prefix = "/mail/archive/cur/";
  const suffix = value.endsWith(":2,")
    ? ":2,"
    : value.endsWith(":2")
      ? ":2"
      : null;
  if (suffix === null) return null;
  const name = value.startsWith(prefix) ? value.slice(prefix.length) : value;
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
  return { id, text: readBoundedText(join(root, `${id}:2,`), maximum) };
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
    return new TextDecoder("utf-8", { fatal: true }).decode(boundedBytes(fd, maximum));
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
/** Mirrors the frame-limit name the CLI reads. The extension cannot import
 * OMA's modules (PI-001); a rule holds the names this file forwards to the
 * names the CLI reads. */
const FRAME_BYTES = "OMA_FRAME_BYTES";

/** The environment the model-facing CLI is started with.
 *
 * It is built, never inherited, so anything else in the engine's environment
 * -- a provider key, a session path -- cannot travel with it. Nothing secret
 * is in it: a Principal credential goes to the CLI on its own private
 * descriptor (see cli-process.ts), because an environment is readable by any
 * process of this user through /proc/<pid>/environ.
 */
export function cliEnvironment(home: string, socket: string): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: home,
    OMA_SOCKET: socket,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C.UTF-8",
  };
  // The frame bound the broker was configured with. Without it the CLI falls
  // back to its own default, which is not necessarily this society's.
  for (const name of [FRAME_BYTES]) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) environment[name] = value;
  }
  return environment;
}

/** How long one CLI call may take before it is stopped. The CLI enforces its
 * own shorter deadline; this bounds a child that stopped answering at all. */
const CLI_TIMEOUT_MS = 120_000;

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
    signal, timeoutMs: CLI_TIMEOUT_MS,
  });
  if (result.code !== 0)
    throw new Error(
      (result.stderr || result.stdout || `CLI exited ${result.code}`)
        .trim()
        .slice(0, 2000),
    );
  return result.stdout.trim();
}
export function registerOmaTools(pi: ExtensionAPI, cwd: string, channel: PrincipalChannel = PrincipalChannel.detached()): void {
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
  const environment = cliEnvironment(home, socket);
  pi.registerTool({
    name: "oma_mail_read",
    label: "Read OMA mail",
    description:
      "Read one immutable OMA mail message by message id or canonical /mail/archive/cur path, or the delivery's full index /inbox.md.",
    promptSnippet: "Read OMA mail using the path from the delivery notice.",
    parameters: Type.Object({
      messageId: Type.String({
        description: "Message id or canonical archive path from the notice, or /inbox.md",
      }),
    }),
    async execute(_id, params) {
      if (params.messageId === BATCH_INDEX) {
        if (batchView === undefined || !isAbsolute(batchView)) throw new Error("no delivery index is available here");
        return textResult(readBoundedText(join(batchView, "inbox.md"), maximum), { index: BATCH_INDEX });
      }
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
      // AV15: the address a header or notice shows is accepted as the logical
      // address it displays; nothing else is.
      const to = params.to.map(address => {
        const logical = logicalFromDisplay(address, society) ?? address;
        return validAddress(logical) ? logical : refused("address", address);
      });
      const kind = params.kind ?? "message";
      if (!SEND_KINDS.has(kind)) refused("mail kind", kind);
      const key = requestKeyOf(params.request);
      const reply = params.replyTo === undefined ? null : join(archive, `${messageIdOf(params.replyTo)}:2,`);
      const temporary = mkdtempSync(join(home, "oma-tool-"));
      const body = join(temporary, "body.txt");
      try {
        writeFileSync(body, params.body, { mode: 0o600 });
        const args = [
          "send",
          "--subject", params.subject,
          "--file", body,
          "--kind", kind,
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
  pi.registerTool({
    name: "oma_mail_ack",
    label: "Acknowledge OMA mail",
    description: "Durably acknowledge one OMA message.",
    parameters: Type.Object({
      messageId: Type.String(),
      request: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const message = messageIdOf(params.messageId);
      const key = requestKeyOf(params.request);
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
  pi.registerTool({
    name: "oma_status",
    label: "OMA status",
    description: "Read society or agent status.",
    parameters: Type.Object({ agent: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      return textResult(
        await runCli(
          cli,
          cwd,
          environment,
          channel,
          params.agent === undefined ? ["status"]
            : ["status", "--", validActorName(params.agent) ? params.agent : refused("agent", params.agent)],
          signal,
        ),
      );
    },
  });
  // AV11: the Principal's other capabilities go through the same CLI, as the Principal.
  if (channel.attached)
    registerPrincipalTools(pi, { run: (args, signal, at) => runCli(cli, at ?? cwd, environment, channel, args, signal),
      workspace: cwd, projectGit: process.env.OMA_PROJECT_GIT });
}
