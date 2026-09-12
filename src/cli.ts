// MUST [CLI-001..003]/[IPC-004..008]: model-facing `oma` CLI. Only the
// spec-defined command surface; no new commands, no preview languages, no
// result-state synthesis. Effect requests freeze key/payload/digest in the
// private cache BEFORE any network I/O; `--request <key>` re-invocation never
// re-reads the current HEAD — it replays the frozen payload or stops on
// REQUEST_KEY_REUSED (IPC-008).
import { connect } from "node:net";
import { readFileSync, existsSync, readdirSync, statSync, lstatSync, openSync, closeSync, fstatSync, constants } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { FrameParser, encodeFrame } from "./frame.js";
import { RequestCache, CacheError, type CachedRequest, type FreezeInput } from "./request-cache.js";
import { isValidRequestKey, isValidTopicName, FULL_OID_RE, uuidV4, parseMessageId, parseMessageFileId } from "./ids.js";
import { exportRefForRequestKey } from "./domain/derived.js";
import type { Json, MutationMethod, Receipt } from "../implementation/contracts.js";
import { exactCandidateCheck, contextFileCheck } from "./validate.js";
import { parseEmlHeaders } from "./mail.js";
import { snapshotJson } from "./domain/canonical-json.js";
import { requestParamsEqual } from "./domain/request-identity.js";
import { requestIntentConflict, explicitFullOid } from "./cli/request-intent.js";
import { decodeReceipt } from "./protocol/receipt-codec.js";

const cliGitEnv: NodeJS.ProcessEnv = {
  HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsync", GIT_CONFIG_VALUE_1: "all",
  GIT_CONFIG_KEY_2: "core.fsyncMethod", GIT_CONFIG_VALUE_2: "fsync",
};
type ExitCode = 0 | 2 | 3 | 4;
const HOME = process.env.HOME ?? "/tmp";
const cache = new RequestCache(HOME);

function fail(msg: string, code: ExitCode): never {
  console.error(`oma: ${msg}`);
  process.exit(code);
}

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
  const actor = process.env.OMA_ACTOR;
  const society = process.env.OMA_SOCIETY;
  if (actor && society) {
    const uid = process.getuid?.() ?? -1;
    return `/run/user/${uid}/oma/${society}/actors/${actor}/control.sock`;
  }
  fail("no broker socket (set OMA_SOCKET, or run inside the OMA sandbox)", 4);
}

interface WireReply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; retry: string } | undefined;
}

function call(method: string, params: Record<string, unknown>, requestKey?: string, streamBytes?: Uint8Array): Promise<WireReply[]> {
  const path = socketPath();
  return new Promise((resolve, reject) => {
    const sock = connect(path, () => {
      const envelope: Record<string, unknown> = { v: 1, id: `cli-${uuidV4()}`, method, params };
      if (requestKey !== undefined) envelope.request = requestKey;
      const meta = encodeFrame(envelope);
      sock.write(streamBytes ? Buffer.concat([meta, Buffer.from(streamBytes)]) : meta);
    });
    const parser = new FrameParser(256 * 1024);
    let buf = Buffer.alloc(0);
    const replies: WireReply[] = [];
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("broker did not answer"));
    }, 60000);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, Buffer.from(d)]);
      try {
        for (const f of parser.feed(buf)) {
          const raw = f.raw as {
            ok?: boolean; result?: unknown; error?: { code: string; message: string; retry: string };
          };
          const reply: WireReply = { ok: raw.ok === true };
          if (raw.result !== undefined) reply.result = raw.result;
          if (raw.error !== undefined) reply.error = raw.error;
          replies.push(reply);
        }
      } catch { /* transport hardening is handled by the protocol-session card */ }
      buf = Buffer.alloc(0);
      if (replies.length > 0) {
        clearTimeout(timer);
        sock.destroy();
        resolve(replies);
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function requestPayload(value: unknown): { [key: string]: Json } {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new TypeError("request payload must be a JSON object");
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

function printReceipt(rec: Receipt, key: string): void {
  if (rec.state === "succeeded") { console.log(JSON.stringify(rec)); return; }
  if (rec.state === "pending") {
    console.log("접수됨 / 아직 완료되지 않음");
    console.log(`재조회: 동일 command에 --request ${key}`);
  } else if (rec.state === "unknown") {
    console.log(`결과 불명확: ${rec.reason ?? "authoritative evidence required"}`);
    console.log(`재조회: 동일 command에 --request ${key}; 새 key로 재실행하지 마세요`);
  } else {
    console.log(`실패: ${rec.error?.code ?? "?"} ${rec.error?.message ?? ""}`);
  }
}

function finishReceipt(rec: Receipt, key: string): never {
  printReceipt(rec, key);
  if (rec.state === "unknown") process.exit(3);
  if (rec.state === "failed")
    process.exit(rec.error?.code === "SPIKE_UNRESOLVED" || rec.error?.code === "UNSUPPORTED_PROFILE" ? 4 : 2);
  process.exit(0);
}

/** Immutable body is published before metadata; only an explicit not-found
 * observation permits replay. Cache corruption never triggers a fresh build.
 */
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
    const sameDigest = (cached.digest === undefined && digest === undefined) ||
      (cached.digest !== undefined && digest !== undefined &&
        cached.digest.bytes === digest.bytes && cached.digest.sha256 === digest.sha256);
    if (!sameMethod || !sameDigest)
      fail(`REQUEST_KEY_REUSED: key ${key} was already frozen for a different request`, 2);
    frozen = cached;
    replay = true;
  } else {
    const input: FreezeInput = { key, method, params: payload, createdAtMs: Date.now() };
    if (digest !== undefined) input.digest = digest;
    try {
      const publication = cache.freeze(input, streamBytes);
      frozen = publication.value;
      replay = publication.kind === "existing";
    } catch (error) {
      if (error instanceof CacheError)
        fail(`${error.code}: ${error.message}`, error.code === "INVALID_REQUEST" || error.code === "REQUEST_KEY_REUSED" ? 2 : 3);
      throw error;
    }
  }
  // Validate bytes even for metadata with a cached receipt. Neither the private
  // receipt nor caller buffers can manufacture a missing immutable body.
  const body = frozenBody(frozen);
  if (replay) {
    let op: WireReply[];
    try { op = await call("operation.get", { key }); }
    catch { fail(`미접수 여부 불명확: ${key} (복구: 원래 command에 --request ${key})`, 3); }
    const reply = op[0];
    if (reply?.ok === true) {
      const decoded = decodeReceipt(reply.result, { expectedKind: method, allowNotFound: true });
      if (!decoded.ok) fail(`invalid operation lookup: ${decoded.reason}; --request ${key}`, 3);
      const rec = decoded.value;
      if (!(rec.operation === "" && rec.state === "failed" && rec.error?.code === "REQUEST_NOT_FOUND")) {
        cache.updateReceipt(key, rec);
        finishReceipt(rec, key);
      }
    } else if (reply?.error?.code !== "REQUEST_NOT_FOUND") {
      fail(`operation lookup did not prove REQUEST_NOT_FOUND: ${reply?.error?.code ?? "no reply"}; --request ${key}`, 3);
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
  const code = reply?.error?.code ?? "INTERNAL_ERROR";
  if (code === "SPIKE_UNRESOLVED" || code === "UNSUPPORTED_PROFILE")
    fail(`${code}: ${reply?.error?.message ?? ""}`, 4);
  fail(`${code}: ${reply?.error?.message ?? ""}`, 2);
}

function opt(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : null;
}

function positional(args: string[], optionNames: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (optionNames.includes(a)) { i++; continue; }
    out.push(a);
  }
  return out;
}

function keyOf(args: string[]): string | null {
  const k = opt(args, "--request");
  if (k !== null && !isValidRequestKey(k)) fail(`invalid request key ${k}`, 2);
  return k;
}

function readBody(path: string | null): string {
  if (path === null) return "";
  if (!existsSync(path)) fail(`file not found: ${path}`, 2);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)); }
  catch { return fail(`cannot read UTF-8 text file: ${path}`, 2); }
}

function randKey(): string { return `cli-${uuidV4()}`; }

interface FreshBuild {
  method: MutationMethod;
  params: Record<string, unknown>;
  digest?: { bytes: number; sha256: string };
  stream?: Uint8Array;
}

/** Frozen-first: no source reads or source regeneration on any non-absent cache. */
async function effect(
  expectedMethod: MutationMethod,
  key: string,
  build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>,
): Promise<never> {
  const cached = readFrozen(key);
  if (cached !== null) {
    const mismatch = requestIntentConflict({ expectedMethod, explicitParams: comparable }, cached);
    if (mismatch !== null)
      fail(`REQUEST_KEY_REUSED: key ${key} conflicts with explicit argument ${mismatch}`, 2);
    return replayOrSend(cached.method, requestPayload(cached.params), key, cached.digest, frozenBody(cached));
  }
  const b = await build();
  if (b.method !== expectedMethod) throw new Error("fresh request builder returned a different method");
  return replayOrSend(b.method, b.params, key, b.digest, b.stream);
}

function multiOpt(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1] !== undefined) {
      const v = args[i + 1]!;
      if (!v.startsWith("--")) out.push(v);
    }
  }
  return out;
}

function resolveOid(rev: string): string {
  if (FULL_OID_RE.test(rev)) return rev;
  const r = spawnSync("/usr/bin/git", ["rev-parse", "--verify", `${rev}^{commit}`], {
    cwd: process.cwd(), env: cliGitEnv, encoding: "utf8",
  });
  const oid = (r.stdout ?? "").trim();
  if (r.status !== 0 || !FULL_OID_RE.test(oid)) fail(`cannot resolve ${rev} to a commit`, 2);
  return oid;
}

async function cmdSend(args: string[]): Promise<void> {
  const to = positional(args, [
    "--subject", "--file", "--kind", "--reply", "--request", "--candidate", "--expect", "--policy-revision",
  ]);
  const subject = opt(args, "--subject");
  const reply = opt(args, "--reply");
  if (to.length === 0 && !reply) fail("send requires an address (or --reply)", 2);
  if (!subject && !reply) fail("send requires --subject (or --reply to reuse its subject)", 2);
  const kindRaw = opt(args, "--kind") ?? "message";
  if (!["message", "question", "result", "alert", "context", "approval_required", "critical"].includes(kindRaw))
    fail(`invalid --kind ${kindRaw}`, 2);
  const candidate = opt(args, "--candidate");
  const expectedBase = opt(args, "--expect");
  const policyRevision = opt(args, "--policy-revision");
  let approvalFor: {
    repo: string; targetRef: string; candidate: string | null;
    expectedBase: string | null; policyRevision: string | null;
  } | undefined;
  if (kindRaw === "approval_required") {
    approvalFor = { repo: "project", targetRef: "refs/heads/main", candidate, expectedBase, policyRevision };
    const error = exactCandidateCheck(approvalFor);
    if (error || !to.includes("principal")) fail(error ?? "approval_required requires explicit principal recipient", 2);
  } else if (candidate !== null || expectedBase !== null || policyRevision !== null) {
    fail("approval identity flags require --kind approval_required", 2);
  }
  const key = keyOf(args) ?? randKey();
  await effect("mail.send", key, () => {
    const params: Record<string, unknown> = {
      to, subject: subject ?? "Re", kind: kindRaw, body: readBody(opt(args, "--file")),
    };
    if (reply) {
      const id = parseEmlHeaders(readBody(reply)).messageId?.split("@", 1)[0];
      if (!id || !parseMessageId(id)) fail("reply file has no valid Message-ID", 2);
      params.replyToMessage = id;
    }
    if (approvalFor) params.approvalFor = approvalFor;
    return { method: "mail.send", params };
  }, () => ({
    to, subject: subject ?? "Re", kind: kindRaw,
    ...(approvalFor ? { approvalFor } : {}),
  }));
}

function parseMessageArg(value: string): string {
  const id = value.startsWith("m-") ? value : basename(value).replace(/:2,$/, "");
  const parsed = parseMessageFileId(id);
  if (parsed === null) fail("ack requires a message id or mail path", 2);
  return parsed;
}

async function cmdAck(args: string[]): Promise<void> {
  const raw = args[0];
  if (!raw) usage();
  const message = parseMessageArg(raw);
  const key = keyOf(args) ?? randKey();
  await effect("mail.ack", key, () => ({ method: "mail.ack", params: { message } }), () => ({ message }));
}

async function cmdFollow(args: string[], subscribe: boolean): Promise<void> {
  const topic = args[0];
  if (!topic || !isValidTopicName(topic)) fail("invalid topic", 2);
  const key = keyOf(args) ?? randKey();
  const method = subscribe ? "route.follow" : "route.unfollow";
  await effect(method, key, () => ({ method, params: { topic } }), () => ({ topic }));
}

async function cmdAgent(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "create") {
    const name = args[1];
    const from = opt(args, "--from");
    const briefFile = opt(args, "--file");
    if (!name || !from || !briefFile) usage();
    const key = keyOf(args) ?? randKey();
    await effect("agent.create", key, () => {
      const oid = resolveOid(from);
      const brief = readBody(briefFile);
      if (!brief) fail("agent create requires --file <brief>", 2);
      return { method: "agent.create", params: { name, from: oid, brief } };
    }, () => ({ name, ...explicitFullOid("from", from) }));
  } else if (sub === "start" || sub === "stop") {
    const name = args[1];
    if (!name) usage();
    const key = keyOf(args) ?? randKey();
    const method = sub === "start" ? "agent.start" : "agent.stop";
    await effect(method, key, () => ({ method, params: { agent: name } }), () => ({ agent: name }));
  } else if (sub === "continue") {
    const note = opt(args, "--note");
    if (!note) usage();
    const key = keyOf(args) ?? randKey();
    await effect("agent.continue", key, () => ({ method: "agent.continue", params: { note } }), () => ({ note }));
  } else if (sub === "wait") {
    const replies = await call("agent.wait", {});
    const r = replies[0];
    console.log(r?.ok === true ? "wait accepted" : `wait failed: ${r?.error?.code ?? "?"}`);
    process.exit(r?.ok === true ? 0 : 2);
  } else usage();
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync("/usr/bin/git", args, { cwd, env: cliGitEnv, encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args[0] ?? "?"}: ${(r.stderr ?? "").slice(0, 200)}`, 2);
  return (r.stdout ?? "").trim();
}

async function cmdSubmit(args: string[]): Promise<void> {
  const revision = args[0];
  if (!revision) usage();
  const key = keyOf(args) ?? randKey();
  await effect("git.submit", key, () => {
    const cwd = process.cwd();
    const candidate = resolveOid(revision);
    const to = multiOpt(args, "--to");
    const subject = opt(args, "--subject") ?? "Re: submit";
    const body = readBody(opt(args, "--file"));
    const paths = multiOpt(args, "--path");
    const exportRef = exportRefForRequestKey(key);
    git(cwd, ["update-ref", exportRef, candidate]);
    const parent = spawnSync("/usr/bin/git", ["rev-parse", "--verify", "-q", `${candidate}^`], {
      cwd, env: cliGitEnv, encoding: "utf8",
    });
    const prerequisites: string[] = parent.status === 0 && parent.stdout.trim() ? [parent.stdout.trim()] : [];
    const bundleTmp = join("/tmp", `oma-submit-${key}.bundle`);
    git(cwd, ["bundle", "create", bundleTmp, exportRef, ...(prerequisites.length > 0 ? [`^${prerequisites[0]}`] : [])]);
    const content = readFileSync(bundleTmp);
    const params: Record<string, unknown> = {
      candidate, exportRef, prerequisites, to: to.length > 0 ? to : ["commons"], subject, body, paths,
      bundle: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/x-git-bundle" },
    };
    return {
      method: "git.submit", params,
      digest: { bytes: content.length, sha256: sha256Hex(content) }, stream: content,
    };
  }, () => {
    const toRaw = multiOpt(args, "--to");
    return {
      to: toRaw.length > 0 ? toRaw : ["commons"],
      subject: opt(args, "--subject") ?? "Re: submit", paths: multiOpt(args, "--path"),
      ...explicitFullOid("candidate", revision),
    };
  });
}

async function cmdIntegrate(args: string[]): Promise<void> {
  const candidate = args[0];
  const expected = opt(args, "--expect");
  if (!candidate || !expected) usage();
  if (!FULL_OID_RE.test(candidate) || !FULL_OID_RE.test(expected)) fail("invalid oid", 2);
  await replayOrSend("git.integrate", { candidate, expected }, keyOf(args) ?? randKey(), undefined);
}

function walk(dir: string): Array<{ path: string; bytes: number; sha256: string; data: Uint8Array }> {
  const out: Array<{ path: string; bytes: number; sha256: string; data: Uint8Array }> = [];
  const walker = (d: string, rel: string): void => {
    if (!lstatSync(d).isDirectory()) fail(`unsupported context directory ${rel}`, 2);
    const directory = openSync(d, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const pinned = `/proc/self/fd/${directory}`;
      for (const f of readdirSync(pinned).sort()) {
        const full = join(pinned, f);
        const st = lstatSync(full);
        const relPath = rel ? `${rel}/${f}` : f;
        if (st.isDirectory()) {
          if (relPath !== "decisions") fail(`unsupported context directory ${relPath}`, 2);
          walker(full, relPath);
          continue;
        }
        if (!st.isFile() || st.nlink !== 1) fail(`unsupported file type/link at ${relPath}`, 2);
        const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.nlink !== 1) fail(`unsupported file type/link at ${relPath}`, 2);
          const data = readFileSync(fd);
          const invalid = contextFileCheck(relPath, data);
          if (invalid) fail(`${invalid}: ${relPath}`, 2);
          out.push({ path: relPath, bytes: data.length, sha256: sha256Hex(data), data });
        } finally { closeSync(fd); }
      }
    } finally { closeSync(directory); }
  };
  walker(dir, "");
  return out;
}

async function cmdContext(args: string[]): Promise<void> {
  const dir = args[0];
  const expectRaw = opt(args, "--expect");
  if (!dir) usage();
  if (!expectRaw || (expectRaw !== "none" && !FULL_OID_RE.test(expectRaw))) fail("--expect requires <oid|none>", 2);
  const key = keyOf(args) ?? randKey();
  await effect("context.publish", key, () => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`not a directory: ${dir}`, 2);
    const entries = walk(dir);
    if (!entries.some((e) => e.path === "GOAL.md")) fail("GOAL.md is required", 2);
    const content = Buffer.concat(entries.map((e) => Buffer.from(e.data)));
    const params: Record<string, unknown> = {
      expected: expectRaw === "none" ? null : expectRaw,
      entries: entries.map((e) => ({ path: e.path, bytes: e.bytes, sha256: e.sha256 })),
      content: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/vnd.oma.context-v1" },
    };
    return { method: "context.publish", params, digest: { bytes: content.length, sha256: sha256Hex(content) }, stream: content };
  }, () => ({ expected: expectRaw === "none" ? null : expectRaw }));
}

async function cmdStatus(args: string[]): Promise<void> {
  const agent = args[0];
  let replies: WireReply[] = [];
  try { replies = await call("status.get", agent ? { agent } : {}); }
  catch { fail("broker unreachable", 3); }
  const r = replies[0];
  if (!r?.ok) fail(`status: ${r?.error?.code ?? "?"}`, 2);
  console.log(JSON.stringify(r.result));
  process.exit(0);
}

function parseDuration(d: string): number {
  const m = /^(\d+)([smhd])$/.exec(d);
  if (!m) fail(`invalid --since ${d} (positive integer + s/m/h/d)`, 2);
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) fail(`invalid --since ${d}`, 2);
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * mult[m[2]!]!;
}

async function cmdLogs(args: string[]): Promise<void> {
  const agent = args[0];
  const since = opt(args, "--since");
  if (!agent || !since) usage();
  let replies: WireReply[] = [];
  try { replies = await call("logs.read", { agent, sinceSeconds: parseDuration(since) }); }
  catch { fail("broker unreachable", 3); }
  const r = replies[0];
  if (!r?.ok) fail(`logs: ${r?.error?.code ?? "?"}`, 2);
  const res = r.result as { text: string; truncated: boolean };
  console.log(res.text);
  if (res.truncated) console.error("(truncated)");
  process.exit(0);
}

export async function main(argv: string[]): Promise<never> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "send": await cmdSend(rest); break;
    case "ack": await cmdAck(rest); break;
    case "follow": await cmdFollow(rest, true); break;
    case "unfollow": await cmdFollow(rest, false); break;
    case "agent": await cmdAgent(rest); break;
    case "submit": await cmdSubmit(rest); break;
    case "integrate": await cmdIntegrate(rest); break;
    case "context":
      if (rest[0] === "publish") { await cmdContext(rest.slice(1)); break; }
      usage();
    case "status": await cmdStatus(rest); break;
    case "logs": await cmdLogs(rest); break;
    default: usage();
  }
  return process.exit(0) as never;
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(`oma: ${(e as Error).message}`);
  process.exit(3);
});
