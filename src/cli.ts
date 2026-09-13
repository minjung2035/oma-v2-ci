// MUST [CLI-001..003]/[IPC-004..008]: model-facing CLI; freeze before transport.
// Same-key replay never rebuilds from current HEAD or mutable source files.
import { readFileSync, existsSync, readdirSync, statSync, lstatSync, openSync, closeSync, fstatSync, constants } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { runGitText } from "./process/policies.js";
import { callActor } from "./cli/transport.js";
import { RequestCache, CacheError, type CachedRequest, type FreezeInput } from "./request-cache.js";
import { isValidRequestKey, isValidTopicName, FULL_OID_RE, uuidV4, parseMessageId, parseMessageFileId } from "./ids.js";
import { exportRefForRequestKey } from "./domain/derived.js";
import { errorExit, type CliExitCode } from "./domain/errors.js";
import type { Json, MutationMethod, PublicMethod, Receipt } from "../implementation/contracts.js";
import { exactCandidateCheck, isMailKind } from "./domain/mail-values.js";
import { contextFileCheck } from "./domain/context-policy.js";
import { parseEmlHeaders } from "./mail/headers.js";
import { snapshotJson } from "./domain/canonical-json.js";
import { requestParamsEqual } from "./domain/request-identity.js";
import { requestIntentConflict, explicitFullOid } from "./cli/request-intent.js";
import { decodeReceipt, decodeFailure } from "./protocol/receipt-codec.js";
import { receiptLines, receiptExit, isRequestNotFound } from "./protocol/receipts.js";

const HOME = process.env.HOME ?? "/tmp";
const cache = new RequestCache(HOME);
function fail(message: string, code: CliExitCode): never { console.error(`oma: ${message}`); process.exit(code); }
function usage(): never {
  console.error([
    "usage:",
    "  oma send <address...> --subject S --file P [--kind K] [--reply P] [--request K]",
    "  approval_required: send principal --kind approval_required --candidate C --expect B --policy-revision R --subject S --file P",
    "  kinds: message/question/result/alert/context/approval_required/critical (mail is not approval authority)",
    "  oma ack <mail-path-or-id> [--request K]",
    "  oma follow <topic> [--request K] | oma unfollow <topic> [--request K]",
    "  oma agent create <name> --from <revision> --file <brief> [--request K]",
    "  oma agent start <name> [--request K] | oma agent stop <name> [--request K]",
    "  oma agent continue --note <text> [--request K]",
    "  oma agent wait",
    "  oma submit <revision> [--to <address> ...] [--subject S] [--file summary] [--path repo-path ...] [--request K]",
    "  oma integrate <published-full-oid> --expect <full-oid> [--request K]",
    "  oma context publish <dir> --expect <oid-or-none> [--request K]",
    "  oma status [agent]",
    "  oma logs <agent> --since <duration>",
  ].join("\n"));
  process.exit(2);
}
function socketPath(): string {
  if (process.env.OMA_SOCKET) return process.env.OMA_SOCKET;
  if (existsSync("/run/oma/control.sock")) return "/run/oma/control.sock";
  const actor = process.env.OMA_ACTOR; const society = process.env.OMA_SOCIETY;
  if (actor && society) return `/run/user/${process.getuid?.() ?? -1}/oma/${society}/actors/${actor}/control.sock`;
  fail("no broker socket (set OMA_SOCKET, or run inside the OMA sandbox)", 4);
}
interface WireReply { ok: boolean; result?: unknown; error?: { code: string; message: string; retry: string } | undefined }
function call(method: PublicMethod, params: Record<string, unknown>, requestKey?: string, streamBytes?: Uint8Array): Promise<WireReply[]> {
  return callActor(socketPath(), method, params, requestKey, streamBytes);
}
function finishFailure(reply: WireReply | undefined, prefix = ""): never {
  const decoded = decodeFailure(reply?.error);
  if (!decoded.ok) fail(`${prefix}invalid broker failure: ${decoded.reason}`, 3);
  fail(`${prefix}${decoded.value.code}: ${decoded.value.message}`, errorExit(decoded.value.code));
}
function sha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function requestPayload(value: unknown): { [key: string]: Json } {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied)) throw new TypeError("request payload must be a JSON object");
  return copied;
}
function readFrozen(key: string): CachedRequest | null {
  const observed = cache.read(key);
  if (observed.kind === "present") return observed.value;
  if (observed.kind === "absent") return null;
  fail(`CACHE_${observed.kind === "corrupt" ? "CORRUPT" : "UNAVAILABLE"}: ${key}: ${observed.reason}; 원래 freeze를 복구하기 전에는 재전송하지 않음`, 3);
}
function frozenBody(entry: CachedRequest): Uint8Array | undefined {
  if (entry.digest === undefined) return undefined;
  const observed = cache.readBody(entry.key, entry.digest);
  if (observed.kind === "present") return observed.value;
  fail(`frozen request body ${observed.kind} for ${entry.key}${observed.kind === "absent" ? "" : `: ${observed.reason}`} (복구: 원래 freeze 보존; 새 payload 생성 금지)`, 3);
}
function finishReceipt(receipt: Receipt, key: string): never {
  for (const line of receiptLines(receipt, key)) console.log(line);
  process.exit(receiptExit(receipt));
}
/** Only an explicit, decoded REQUEST_NOT_FOUND lookup permits frozen resend. */
async function replayOrSend(
  method: MutationMethod, params: Record<string, unknown>, key: string,
  digest?: { bytes: number; sha256: string }, streamBytes?: Uint8Array,
): Promise<never> {
  const payload = requestPayload(params);
  const cached = readFrozen(key);
  let frozen: CachedRequest;
  let replay: boolean;
  if (cached !== null) {
    const sameMethod = cached.method === method && requestParamsEqual(method, cached.params, payload);
    const sameDigest = (cached.digest === undefined && digest === undefined) || (cached.digest !== undefined && digest !== undefined && cached.digest.bytes === digest.bytes && cached.digest.sha256 === digest.sha256);
    if (!sameMethod || !sameDigest) fail(`REQUEST_KEY_REUSED: key ${key} was already frozen for a different request`, 2);
    frozen = cached; replay = true;
  } else {
    const input: FreezeInput = { key, method, params: payload, createdAtMs: Date.now() };
    if (digest !== undefined) input.digest = digest;
    try {
      const publication = cache.freeze(input, streamBytes);
      frozen = publication.value; replay = publication.kind === "existing";
    } catch (error) {
      if (error instanceof CacheError) fail(`${error.code}: ${error.message}`, error.code === "INVALID_REQUEST" || error.code === "REQUEST_KEY_REUSED" ? 2 : 3);
      throw error;
    }
  }
  const body = frozenBody(frozen);
  if (replay) {
    let lookup: WireReply[];
    try { lookup = await call("operation.get", { key }); }
    catch { fail(`미접수 여부 불명확: ${key} (복구: 원래 command에 --request ${key})`, 3); }
    const reply = lookup[0];
    if (reply?.ok === true) {
      const decoded = decodeReceipt(reply.result, { expectedKind: method, allowNotFound: true });
      if (!decoded.ok) fail(`invalid operation lookup: ${decoded.reason}; --request ${key}`, 3);
      if (!isRequestNotFound(decoded.value)) {
        cache.updateReceipt(key, decoded.value);
        finishReceipt(decoded.value, key);
      }
    } else {
      const decoded = decodeFailure(reply?.error);
      if (!decoded.ok || decoded.value.code !== "REQUEST_NOT_FOUND")
        fail(`operation lookup did not prove REQUEST_NOT_FOUND: ${decoded.ok ? decoded.value.code : "invalid reply"}; --request ${key}`, 3);
    }
  }
  let replies: WireReply[];
  try { replies = await call(frozen.method, requestPayload(frozen.params), key, body); }
  catch { fail(`미접수 여부 불명확: ${key} (복구: 원래 command에 --request ${key})`, 3); }
  const reply = replies[0];
  if (reply?.ok === true) {
    const decoded = decodeReceipt(reply.result, { expectedKind: method });
    if (!decoded.ok) fail(`invalid mutation receipt: ${decoded.reason}; --request ${key}`, 3);
    cache.updateReceipt(key, decoded.value);
    finishReceipt(decoded.value, key);
  }
  finishFailure(reply);
}
function opt(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith("--") ? value : null;
}
function positional(args: string[], optionNames: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (optionNames.includes(value)) { index++; continue; }
    out.push(value);
  }
  return out;
}
function keyOf(args: string[]): string | null {
  const key = opt(args, "--request");
  if (key !== null && !isValidRequestKey(key)) fail(`invalid request key ${key}`, 2);
  return key;
}
function readBody(path: string | null): string {
  if (path === null) return "";
  if (!existsSync(path)) fail(`file not found: ${path}`, 2);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)); }
  catch { return fail(`cannot read UTF-8 text file: ${path}`, 2); }
}
function randKey(): string { return `cli-${uuidV4()}`; }
interface FreshBuild { method: MutationMethod; params: Record<string, unknown>; digest?: { bytes: number; sha256: string }; stream?: Uint8Array }
/** A corrupt/unavailable cache never reaches a source builder. */
async function effect(expectedMethod: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>, comparable: () => Record<string, unknown>): Promise<never> {
  const cached = readFrozen(key);
  if (cached !== null) {
    const mismatch = requestIntentConflict({ expectedMethod, explicitParams: comparable }, cached);
    if (mismatch !== null) fail(`REQUEST_KEY_REUSED: key ${key} conflicts with explicit argument ${mismatch}`, 2);
    return replayOrSend(cached.method, requestPayload(cached.params), key, cached.digest, frozenBody(cached));
  }
  const fresh = await build();
  if (fresh.method !== expectedMethod) throw new Error("fresh request builder returned a different method");
  return replayOrSend(fresh.method, fresh.params, key, fresh.digest, fresh.stream);
}
function multiOpt(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1] !== undefined) {
      const value = args[index + 1]!;
      if (!value.startsWith("--")) out.push(value);
    }
  }
  return out;
}
function resolveOid(revision: string): string {
  if (FULL_OID_RE.test(revision)) return revision;
  const result = runGitText(["rev-parse", "--verify", `${revision}^{commit}`], { cwd: process.cwd() });
  const oid = result.stdout.trim();
  if (result.status !== 0 || !FULL_OID_RE.test(oid)) fail(`cannot resolve ${revision} to a commit`, 2);
  return oid;
}
async function cmdSend(args: string[]): Promise<void> {
  const to = positional(args, ["--subject", "--file", "--kind", "--reply", "--request", "--candidate", "--expect", "--policy-revision"]);
  const subject = opt(args, "--subject"); const reply = opt(args, "--reply");
  if (to.length === 0 && !reply) fail("send requires an address (or --reply)", 2);
  if (!subject && !reply) fail("send requires --subject (or --reply to reuse its subject)", 2);
  const kindRaw = opt(args, "--kind") ?? "message";
  if (!isMailKind(kindRaw)) fail(`invalid --kind ${kindRaw}`, 2);
  const candidate = opt(args, "--candidate"); const expectedBase = opt(args, "--expect"); const policyRevision = opt(args, "--policy-revision");
  let approvalFor: { repo: string; targetRef: string; candidate: string | null; expectedBase: string | null; policyRevision: string | null } | undefined;
  if (kindRaw === "approval_required") {
    approvalFor = { repo: "project", targetRef: "refs/heads/main", candidate, expectedBase, policyRevision };
    const error = exactCandidateCheck(approvalFor);
    if (error || !to.includes("principal")) fail(error ?? "approval_required requires explicit principal recipient", 2);
  } else if (candidate !== null || expectedBase !== null || policyRevision !== null) fail("approval identity flags require --kind approval_required", 2);
  const key = keyOf(args) ?? randKey();
  await effect("mail.send", key, () => {
    const params: Record<string, unknown> = { to, subject: subject ?? "Re", kind: kindRaw, body: readBody(opt(args, "--file")) };
    if (reply) {
      let id: string | undefined;
      try { id = parseEmlHeaders(readBody(reply)).messageId?.split("@", 1)[0]; }
      catch { fail("reply file has invalid OMA headers", 2); }
      if (!id || !parseMessageId(id)) fail("reply file has no valid Message-ID", 2);
      params.replyToMessage = id;
    }
    if (approvalFor) params.approvalFor = approvalFor;
    return { method: "mail.send", params };
  }, () => ({ to, subject: subject ?? "Re", kind: kindRaw, ...(approvalFor ? { approvalFor } : {}) }));
}
function parseMessageArg(value: string): string {
  const id = value.startsWith("m-") ? value : basename(value).replace(/:2,$/, "");
  const parsed = parseMessageFileId(id);
  if (parsed === null) fail("ack requires a message id or mail path", 2);
  return parsed;
}
async function cmdAck(args: string[]): Promise<void> {
  const raw = args[0]; if (!raw) usage();
  const message = parseMessageArg(raw); const key = keyOf(args) ?? randKey();
  await effect("mail.ack", key, () => ({ method: "mail.ack", params: { message } }), () => ({ message }));
}
async function cmdFollow(args: string[], subscribe: boolean): Promise<void> {
  const topic = args[0];
  if (!topic || !isValidTopicName(topic)) fail("invalid topic", 2);
  const key = keyOf(args) ?? randKey(); const method = subscribe ? "route.follow" : "route.unfollow";
  await effect(method, key, () => ({ method, params: { topic } }), () => ({ topic }));
}
async function cmdAgent(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "create") {
    const name = args[1]; const from = opt(args, "--from"); const briefFile = opt(args, "--file");
    if (!name || !from || !briefFile) usage();
    const key = keyOf(args) ?? randKey();
    await effect("agent.create", key, () => {
      const oid = resolveOid(from); const brief = readBody(briefFile);
      if (!brief) fail("agent create requires --file <brief>", 2);
      return { method: "agent.create", params: { name, from: oid, brief } };
    }, () => ({ name, ...explicitFullOid("from", from) }));
  } else if (sub === "start" || sub === "stop") {
    const name = args[1]; if (!name) usage();
    const key = keyOf(args) ?? randKey(); const method = sub === "start" ? "agent.start" : "agent.stop";
    await effect(method, key, () => ({ method, params: { agent: name } }), () => ({ agent: name }));
  } else if (sub === "continue") {
    const note = opt(args, "--note"); if (!note) usage();
    const key = keyOf(args) ?? randKey();
    await effect("agent.continue", key, () => ({ method: "agent.continue", params: { note } }), () => ({ note }));
  } else if (sub === "wait") {
    const replies = await call("agent.wait", {});
    if (!replies[0]?.ok) finishFailure(replies[0], "wait: ");
    console.log("wait accepted"); process.exit(0);
  } else usage();
}
function git(cwd: string, args: string[]): string {
  const result = runGitText(args, { cwd });
  if (result.status !== 0) fail(`git ${args[0] ?? "?"}: ${result.stderr.slice(0, 200)}`, 2);
  return result.stdout.trim();
}
async function cmdSubmit(args: string[]): Promise<void> {
  const revision = args[0]; if (!revision) usage();
  const key = keyOf(args) ?? randKey();
  await effect("git.submit", key, () => {
    const cwd = process.cwd(); const candidate = resolveOid(revision); const to = multiOpt(args, "--to");
    const subject = opt(args, "--subject") ?? "Re: submit"; const body = readBody(opt(args, "--file")); const paths = multiOpt(args, "--path");
    const exportRef = exportRefForRequestKey(key);
    git(cwd, ["update-ref", exportRef, candidate]);
    // Explicit parent manifest: an unavailable command is never an empty root.
    const ancestry = git(cwd, ["rev-list", "--parents", "-n", "1", candidate]).split(" ");
    if (ancestry[0] !== candidate || ancestry.some(oid => !FULL_OID_RE.test(oid) || oid.length !== candidate.length))
      fail("cannot observe the frozen candidate's parent identities", 3);
    const prerequisites: string[] = ancestry[1] === undefined ? [] : [ancestry[1]];
    const bundleTmp = join("/tmp", `oma-submit-${key}.bundle`);
    git(cwd, ["bundle", "create", bundleTmp, exportRef, ...(prerequisites.length > 0 ? [`^${prerequisites[0]}`] : [])]);
    const content = readFileSync(bundleTmp);
    const params: Record<string, unknown> = {
      candidate, exportRef, prerequisites, to: to.length > 0 ? to : ["commons"], subject, body, paths,
      bundle: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/x-git-bundle" },
    };
    return { method: "git.submit", params, digest: { bytes: content.length, sha256: sha256Hex(content) }, stream: content };
  }, () => {
    const to = multiOpt(args, "--to");
    return { to: to.length > 0 ? to : ["commons"], subject: opt(args, "--subject") ?? "Re: submit", paths: multiOpt(args, "--path"), ...explicitFullOid("candidate", revision) };
  });
}
async function cmdIntegrate(args: string[]): Promise<void> {
  const candidate = args[0]; const expected = opt(args, "--expect");
  if (!candidate || !expected) usage();
  if (!FULL_OID_RE.test(candidate) || !FULL_OID_RE.test(expected)) fail("invalid oid", 2);
  await replayOrSend("git.integrate", { candidate, expected }, keyOf(args) ?? randKey(), undefined);
}
function walk(dir: string): Array<{ path: string; bytes: number; sha256: string; data: Uint8Array }> {
  const out: Array<{ path: string; bytes: number; sha256: string; data: Uint8Array }> = [];
  const walker = (directoryPath: string, relative: string): void => {
    if (!lstatSync(directoryPath).isDirectory()) fail(`unsupported context directory ${relative}`, 2);
    const directory = openSync(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const pinned = `/proc/self/fd/${directory}`;
      for (const file of readdirSync(pinned).sort()) {
        const full = join(pinned, file); const stat = lstatSync(full); const relPath = relative ? `${relative}/${file}` : file;
        if (stat.isDirectory()) {
          if (relPath !== "decisions") fail(`unsupported context directory ${relPath}`, 2);
          walker(full, relPath); continue;
        }
        if (!stat.isFile() || stat.nlink !== 1) fail(`unsupported file type/link at ${relPath}`, 2);
        const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.nlink !== 1) fail(`unsupported file type/link at ${relPath}`, 2);
          const data = readFileSync(fd); const invalid = contextFileCheck(relPath, data);
          if (invalid) fail(`${invalid}: ${relPath}`, 2);
          out.push({ path: relPath, bytes: data.length, sha256: sha256Hex(data), data });
        } finally { closeSync(fd); }
      }
    } finally { closeSync(directory); }
  };
  walker(dir, ""); return out;
}
async function cmdContext(args: string[]): Promise<void> {
  const dir = args[0]; const expect = opt(args, "--expect");
  if (!dir) usage();
  if (!expect || (expect !== "none" && !FULL_OID_RE.test(expect))) fail("--expect requires <oid|none>", 2);
  const key = keyOf(args) ?? randKey();
  await effect("context.publish", key, () => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`not a directory: ${dir}`, 2);
    const entries = walk(dir);
    if (!entries.some(entry => entry.path === "GOAL.md")) fail("GOAL.md is required", 2);
    const content = Buffer.concat(entries.map(entry => Buffer.from(entry.data)));
    const params: Record<string, unknown> = {
      expected: expect === "none" ? null : expect,
      entries: entries.map(entry => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 })),
      content: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/vnd.oma.context-v1" },
    };
    return { method: "context.publish", params, digest: { bytes: content.length, sha256: sha256Hex(content) }, stream: content };
  }, () => ({ expected: expect === "none" ? null : expect }));
}
async function cmdStatus(args: string[]): Promise<void> {
  const agent = args[0]; let replies: WireReply[];
  try { replies = await call("status.get", agent ? { agent } : {}); } catch { fail("broker unreachable", 3); }
  const reply = replies[0];
  if (!reply?.ok) finishFailure(reply, "status: ");
  console.log(JSON.stringify(reply.result)); process.exit(0);
}
function parseDuration(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) fail(`invalid --since ${duration} (positive integer + s/m/h/d)`, 2);
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) fail(`invalid --since ${duration}`, 2);
  const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multiplier[match[2]!]!;
}
async function cmdLogs(args: string[]): Promise<void> {
  const agent = args[0]; const since = opt(args, "--since");
  if (!agent || !since) usage();
  let replies: WireReply[];
  try { replies = await call("logs.read", { agent, sinceSeconds: parseDuration(since) }); } catch { fail("broker unreachable", 3); }
  const reply = replies[0];
  if (!reply?.ok) finishFailure(reply, "logs: ");
  const result = reply.result as { text: string; truncated: boolean };
  console.log(result.text);
  if (result.truncated) console.error("(truncated)");
  process.exit(0);
}
export async function main(argv: string[]): Promise<never> {
  const [command, ...rest] = argv;
  switch (command) {
    case "send": await cmdSend(rest); break;
    case "ack": await cmdAck(rest); break;
    case "follow": await cmdFollow(rest, true); break;
    case "unfollow": await cmdFollow(rest, false); break;
    case "agent": await cmdAgent(rest); break;
    case "submit": await cmdSubmit(rest); break;
    case "integrate": await cmdIntegrate(rest); break;
    case "context": if (rest[0] === "publish") { await cmdContext(rest.slice(1)); break; } usage();
    case "status": await cmdStatus(rest); break;
    case "logs": await cmdLogs(rest); break;
    default: usage();
  }
  return process.exit(0) as never;
}
main(process.argv.slice(2)).catch((error: unknown) => { console.error(`oma: ${(error as Error).message}`); process.exit(3); });
