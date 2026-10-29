/** OMA's own tools: read, send and acknowledge mail, and read status.
 *
 * Reading goes straight to the immutable archive with bounded, no-follow file
 * access. Mutations use the typed client and its frozen request identity and receipts.
 */
import { closeSync, constants, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { logicalFromDisplay } from "@oma/domain/display-address";
import { isLogicalAddress as validAddress } from "@oma/domain/mail-values";
import { isValidFullOid as validFullOid, isValidMessageId as validMessageId } from "@oma/domain/identifiers";
import { Client } from "@oma/client";
import { decodeWaitObservation } from "@oma/protocol/client-codecs";
import { PrincipalChannel } from "./principal-channel.js";
import { registerPrincipalTools } from "./principal-tools.js";
import { registerAgentTools } from "./agent-tools.js";
import { residentToolSurfaceConfig, principalToolSurfaceConfig } from "@oma/domain/tool-surface";
import { registerReviewTools } from "./review-tools.js";
import { REQUEST_PARAMETER_HELP, integerEnv, refused, requestKeyOf, textResult, registerTypedTool, stringEnum } from "@oma/tool-runtime/shared";
import { decodeUtf8 } from "@oma/domain/utf8";

/** Ownership is distinct from initial visibility. The host surface is the
 * sole inventory owner; optional OMA tools remain owned but not always active. */
export function omaToolNames(principal: boolean): readonly string[] {
  const plan = principal ? principalToolSurfaceConfig() : residentToolSurfaceConfig();
  return [...plan.direct, ...plan.optional].filter(name => name.startsWith("oma_"));
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
 * a transfer encoding. Mirrors `readableMail` in packages/mail/src/display.ts, which
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

/** The archive root this engine's client results name paths under (DR1): the
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
 * keeps the primary path -- the client reports the missing reply target. */
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

/** INV09, PR-004: model values are data checked against domain/protocol grammars,
 * never commands or caller-selected broker methods. */
const SEND_KINDS = ["message", "question", "result", "alert", "critical", "context"] as const;

/** Normalize displayed message references to their durable id. */
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
/** Frame and stream bounds forwarded to the in-process client. */
const FRAME_BYTES = "OMA_FRAME_BYTES";
const CONTEXT_BYTES = "OMA_CONTEXT_BYTES";
const BUNDLE_BYTES = "OMA_BUNDLE_BYTES";

/** P0V-36 mirror of `storedMailBytes` in packages/domain/src/mail-values.ts: the bound
 * on a stored message is not the body bound -- it is the header block plus the
 * widest retained transfer encoding. OMA_MAIL_BYTES carries the configured
 * value; an engine that does not set it gets the same rule at the reference
 * body bound (256 KiB, the shipped default). PI-001 keeps this extension
 * import-free, so a test binds the mirror to the owner (INV04). */
const MAIL_HEADER_BYTES = 256 * 1024;
const REFERENCE_BODY_BYTES = 256 * 1024;
const storedMailBound = (bodyBytes: number): number =>
  MAIL_HEADER_BYTES + 3 * bodyBytes + 3 * Math.ceil((3 * bodyBytes) / 73) + 2;

/** The largest index `publishBatchView` (packages/mail/src/batch-view.ts) can write:
 * a fixed head and footer, and per listed message one `N. <id>\t<path>` row.
 * Each earlier revision is named on exactly one row, so the whole index is
 * linear in the batch: m rows plus at most m path mentions in tails. The
 * bound is derived from the configured batch size so a large deployment's
 * index is never refused for its size; when the environment does not carry
 * it, the most message ids a one-frame manifest could name is the floor. */
const INDEX_HEAD_BYTES = 1024;
const INDEX_ROW_BYTES = 256;
const INDEX_PATH_BYTES = 128;
function indexBound(): number {
  const messages = integerEnv("OMA_BATCH_MAX_MESSAGES")
    ?? Math.max(1, Math.floor((integerEnv(FRAME_BYTES) ?? 256 * 1024) / 40));
  return INDEX_HEAD_BYTES + messages * (INDEX_ROW_BYTES + INDEX_PATH_BYTES);
}

/** The environment the tools' client is configured with.
 *
 * It is built, never inherited, so anything else in the engine's environment
 * -- a provider key, a session path -- cannot travel with it. Nothing secret
 * is in it: a Principal credential never enters an environment at all. It
 * reaches the engine on its private host channel and lives in
 * PrincipalChannel's module memory (the credential line is the shared codec
 * in client/codecs.ts), because an environment is readable by any process of
 * this user through /proc/<pid>/environ.
 */
export function clientEnvironment(home: string, socket: string, archive: string): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: home,
    OMA_SOCKET: socket,
    // DR1: archive paths are presented in this engine's view.
    OMA_MAIL_ARCHIVE: archive,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C.UTF-8",
  };
  // Preserve the broker's frame and stream bounds rather than substituting
  // client defaults. OMA_ACTOR identifies the candidate notice's sender; it
  // is an ambient identity, never a credential.
  for (const name of [FRAME_BYTES, CONTEXT_BYTES, BUNDLE_BYTES, "OMA_ACTOR",
      "OMA_PROJECT_GIT", "OMA_CONTEXT_GIT", "OMA_WORKER_ARCHIVE"]) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) environment[name] = value;
  }
  return environment;
}

export function registerOmaTools(pi: ExtensionAPI, cwd: string, channel: PrincipalChannel = PrincipalChannel.detached()): (() => Promise<boolean>) | undefined {
  const home = process.env.OMA_AGENT_HOME;
  const archive = process.env.OMA_MAIL_ARCHIVE;
  const socket = process.env.OMA_SOCKET;
  const maximum = integerEnv("OMA_MAIL_BYTES") ?? storedMailBound(REFERENCE_BODY_BYTES);
  // The delivery index is not a stored message; its bound is derived from the
  // batch size the host publishes (publishBatchView), not the body limit.
  const indexMaximum = indexBound();
  // The wire's own address bound (config `addresses`; 64 by default) -- the
  // schema tells the model the same bound the broker will enforce.
  const addresses = integerEnv("OMA_MAIL_ADDRESSES") ?? 64;
  const batchView = process.env.OMA_BATCH_VIEW;
  const society = process.env.OMA_SOCIETY;
  if (
    !home ||
    !archive ||
    !socket ||
    !isAbsolute(home) ||
    !isAbsolute(archive) ||
    !isAbsolute(socket)
  )
    return;
  // Read once, here, where every other value this extension needs is read. A
  // command assembled later from whatever the environment happens to hold then
  // would not be the environment the engine was started with.
  const environment = clientEnvironment(home, socket, archive);
  const client = new Client({ cwd, env: environment }, () => channel.current(), signal => channel.waitForGrant(signal));
  registerTypedTool(pi, {
    name: "oma_mail_read",
    label: "Read OMA mail",
    description:
      "Read one durable message by its id, displayed archive path, archive filename or project-qualified RFC Message-ID. Use /inbox.md for the current delivery batch's index, then read the messages needed for the task. Reading does not acknowledge delivery, cast a vote or complete the requested work.",
    promptSnippet: "Read durable mail by message reference; /inbox.md lists the current delivery batch.",
    parameters: Type.Object({
      messageId: Type.String({
        description: "Message id, displayed archive path or filename, project-qualified RFC Message-ID, or /inbox.md for the current batch index.",
      }),
    }),
    async execute(_id, params) {
      if (params.messageId === BATCH_INDEX) {
        if (batchView === undefined || !isAbsolute(batchView)) throw new Error("no delivery index is available here");
        return textResult(readBoundedText(join(batchView, "inbox.md"), indexMaximum), { index: BATCH_INDEX });
      }
      const mail = readBoundedMail(archive, params.messageId, maximum);
      return textResult(readableMail(mail.text), { messageId: mail.id });
    },
  });
  const recipients = (values: string[]) => values.map(value => {
    const address = logicalFromDisplay(value, society) ?? value;
    return validAddress(address) ? address : refused("address", value);
  });
  const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
  const to = Type.Array(Type.String({ description: "Worker name, principal, commons/residents, topic/<name>, or a displayed project address." }), {
    minItems: 1, maxItems: addresses, description: "Recipients within this project; commons and residents address all Workers. Audience restrictions still apply.",
  });
  const subject = Type.String({ maxLength: 998, description: "Single-line message subject." });
  const kind = Type.Optional({ ...stringEnum(SEND_KINDS), description: "Message classification; defaults to message. Classification grants no review or approval authority." });
  registerTypedTool(pi, {
    name: "oma_mail_send", label: "Send OMA mail",
    description: "Send durable coordination mail with explicit recipients, subject and inline body. Use it to share assignments, interface decisions, reusable evidence, blockers or results; replyTo keeps a related discussion threaded. A successful send is not proof of recipient action. Mail records neither a review vote nor GOAL publication.",
    promptSnippet: "Send durable assignments, evidence and decisions to the relevant Workers or Principal.",
    parameters: Type.Object({
      to, subject, body: Type.String({ description: "Inline message text with the context, evidence or requested action recipients need." }), kind,
      replyTo: Type.Optional(Type.String({ description: "Optional existing message reference to thread this message: id, displayed archive path/filename or project RFC Message-ID." })), request,
    }),
    async execute(id, params, signal, _update, context) {
      const addresses = recipients(params.to);
      const reply = params.replyTo === undefined ? undefined : replyPathFor(archive, messageIdOf(params.replyTo));
      const key = requestKeyOf(params.request, { id, tool: "oma_mail_send", params, context });
      return textResult(await client.sendMail({ to: addresses, subject: params.subject, body: params.body, kind: params.kind ?? "message",
        ...(reply === undefined ? {} : { replyFile: reply }) }, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_mail_reply", label: "Reply to OMA mail",
    description: "Reply to an existing message with an inline body. Omitted to uses the original reply routing; omitted subject inherits the original subject. Audience restrictions still apply. A reply neither acknowledges the original delivery nor records a review vote.",
    parameters: Type.Object({
      messageId: Type.String({ description: "Original message id, displayed archive path/filename or project-qualified RFC Message-ID." }),
      body: Type.String({ description: "Inline response, including requested evidence, decisions or next actions." }),
      to: Type.Optional(to), subject: Type.Optional(subject), kind, request,
    }),
    async execute(id, params, signal, _update, context) {
      const replyFile = replyPathFor(archive, messageIdOf(params.messageId));
      const key = requestKeyOf(params.request, { id, tool: "oma_mail_reply", params, context });
      return textResult(await client.replyMail({ replyFile, body: params.body,
        ...(params.to === undefined ? {} : { to: recipients(params.to) }),
        ...(params.subject === undefined ? {} : { subject: params.subject }),
        ...(params.kind === undefined ? {} : { kind: params.kind }) }, key, signal), { request: key });
    },
  });
  if (!channel.attached) registerTypedTool(pi, {
    name: "oma_mail_approval_notice", label: "Send a candidate approval notice",
    description: "Send the Principal an informational notice about an already published candidate/base/policy tuple, with optional cc. This creates no peer vote, quorum or actionable approval request; only the broker issues the current approval mail used by oma_review_respond, including capacity fallback. Use ordinary mail when an exact candidate-tuple notice is unnecessary.",
    parameters: Type.Object({
      subject, body: Type.String({ description: "Inline context and evidence for the candidate notice; this is not a binding approval request." }),
      candidate: Type.String({ description: "Full OID of the already published candidate commit." }),
      base: Type.String({ description: "Full expected base commit OID for this candidate tuple." }),
      policyRevision: Type.String({ minLength: 1, description: "Policy revision identifying the candidate tuple." }),
      cc: Type.Optional({ ...to, description: "Additional recipients; principal is always included." }),
      replyTo: Type.Optional(Type.String({ description: "Optional existing message id, displayed archive path/filename or project RFC Message-ID for threading." })), request,
    }),
    async execute(id, params, signal, _update, context) {
      if (!validFullOid(params.candidate) || !validFullOid(params.base)) refused("candidate/base OIDs", params);
      const key = requestKeyOf(params.request, { id, tool: "oma_mail_approval_notice", params, context });
      return textResult(await client.approvalNotice({ subject: params.subject, body: params.body, candidate: params.candidate,
        base: params.base, policyRevision: params.policyRevision,
        ...(params.cc === undefined ? {} : { cc: recipients(params.cc) }),
        ...(params.replyTo === undefined ? {} : { replyFile: replyPathFor(archive, messageIdOf(params.replyTo)) }) }, key, signal), { request: key });
    },
  });
  if (!channel.attached) registerTypedTool(pi, {
    name: "oma_mail_ack",
    label: "Acknowledge OMA mail",
    description: "Durably acknowledge one message delivered to you so it is no longer pending. Do this after reading it and acting on it or preserving the necessary follow-up. Acknowledgment records delivery handling, not task completion, review approval or project completion.",
    parameters: Type.Object({
      messageId: Type.String({ description: "Delivered message id, displayed archive path/filename or project-qualified RFC Message-ID." }),
      request: Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP })),
    }),
    async execute(id, params, signal, _update, context) {
      const message = messageIdOf(params.messageId);
      const key = requestKeyOf(params.request, { id, tool: "oma_mail_ack", params, context });
      return textResult(
        await client.effect("mail.ack", key, () => ({ method: "mail.ack", params: { message } }), () => ({ message }), signal),
        { request: key },
      );
    },
  });
  registerAgentTools(pi, client, channel.attached, society);
  registerReviewTools(pi, { principal: channel.attached, client });
  if (channel.attached) registerPrincipalTools(pi, client);
  // Observe only at a persisted tool boundary using this caller's frozen context.
  if (!channel.attached) return async () => {
    return decodeWaitObservation(await client.query("agent.wait", { observe: true })).accepted;
  };
}
