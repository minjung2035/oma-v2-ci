/** OMA's own tools: read, send and acknowledge mail, and read status.
 *
 * Reading goes straight to the immutable archive with bounded, no-follow file
 * access. Everything that changes state goes through the model-facing CLI with
 * a fixed argv, so the broker's request identity and receipts apply.
 */
import { closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validMessageId } from "./batch-view.js";
import { integerEnv, textResult } from "./shared.js";

/** TSP-008: tools OMA itself owns. A role projection may reorder or group the
 * extensions' tools, but it can never take these away from the agent. */
export const OMA_TOOL_NAMES: readonly string[] = Object.freeze([
  "oma_mail_read",
  "oma_mail_send",
  "oma_mail_ack",
  "oma_status",
]);
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
export function registerOmaTools(pi: ExtensionAPI, cwd: string): void {
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
