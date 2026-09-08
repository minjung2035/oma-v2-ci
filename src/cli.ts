// MUST [CLI-001..003]/[IPC-004..008]: model-facing `oma` CLI. Only the
// spec-defined command surface; no new commands, no preview languages, no
// result-state synthesis. Effect requests freeze key/payload/digest in the
// private cache BEFORE any network I/O; `--request <key>` re-invocation never
// re-reads the current HEAD — it replays the frozen payload or stops on
// REQUEST_KEY_REUSED (IPC-008).
import { connect } from "node:net";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { FrameParser, encodeFrame } from "./frame.js";
import { RequestCache, type CachedRequest } from "./request-cache.js";
import { isValidRequestKey, FULL_OID_RE, uuidV4 } from "./ids.js";
import type { Json, Receipt } from "../implementation/contracts.js";

type ExitCode = 0 | 2 | 3 | 4;

const HOME = process.env.HOME ?? "/tmp";
const cache = new RequestCache(HOME);

function fail(msg: string, code: ExitCode): never {
  console.error(`oma: ${msg}`);
  process.exit(code);
}

function usage(): never {
  console.error(
    [
      "usage:",
      "  oma send <address...> --subject S --file P [--kind K] [--reply P] [--request K]",
      "  oma agent create <name> --from <rev> --file <brief> [--request K]",
      "  oma agent start <name> [--request K] | oma agent stop <name> [--request K]",
      "  oma agent continue --note <text> [--request K]",
      "  oma agent wait",
      "  oma submit <revision> [--to <address> ...] [--subject S] [--file summary] [--path repo-path ...] [--request K]",
      "  oma integrate <published-full-oid> --expect <full-oid> [--request K]",
      "  oma context publish <dir> --expect <oid-or-none> [--request K]",
      "  oma status [agent]",
      "  oma logs <agent> --since <duration>",
    ].join("\n"),
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// socket client (uint32 BE length + JSON both directions; IPC-001)
// ---------------------------------------------------------------------------

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

function call(
  method: string,
  params: Record<string, unknown>,
  requestKey?: string,
  streamBytes?: Uint8Array,
): Promise<WireReply[]> {
  const path = socketPath();
  return new Promise((resolve, reject) => {
    const sock = connect(path, () => {
      // MUST [IPC-004]: durable mutations carry the idempotency key on the
      // request ENVELOPE (contracts MutationRequest), never inside params.
      const envelope: Record<string, unknown> = {
        v: 1,
        id: `cli-${uuidV4()}`,
        method,
        params,
      };
      if (requestKey !== undefined) envelope.request = requestKey;
      const meta = encodeFrame(envelope);
      sock.write(
        streamBytes ? Buffer.concat([meta, Buffer.from(streamBytes)]) : meta,
      );
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
            ok?: boolean;
            result?: unknown;
            error?: { code: string; message: string; retry: string };
          };
          const reply: WireReply = { ok: raw.ok === true };
          if (raw.result !== undefined) reply.result = raw.result;
          if (raw.error !== undefined) reply.error = raw.error;
          replies.push(reply);
        }
      } catch {
        /* incomplete frame */
      }
      buf = Buffer.alloc(0);
      if (replies.length > 0) {
        clearTimeout(timer);
        sock.destroy();
        resolve(replies);
      }
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// ---------------------------------------------------------------------------
// IPC-006 freeze cache flow
// ---------------------------------------------------------------------------

function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function paramsEqual(a: Json, b: Json): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function printReceipt(rec: Receipt, key: string): void {
  if (rec.state === "succeeded") {
    console.log(JSON.stringify(rec));
    return;
  }
  if (rec.state === "pending") {
    console.log("접수됨 / 아직 완료되지 않음");
    console.log(`재조회: 동일 command에 --request ${key}`);
  } else {
    console.log(`실패: ${rec.error?.code ?? "?"} ${rec.error?.message ?? ""}`);
  }
}

/**
 * MUST [IPC-006/008]: freeze the normalized payload BEFORE any network I/O;
 * `--request <key>` re-invocation never re-reads the current HEAD.
 * Returns the receipt path exit semantics via process.exit.
 */
async function replayOrSend(
  method: string,
  params: Record<string, unknown>,
  key: string,
  digest?: { bytes: number; sha256: string },
  streamBytes?: Uint8Array,
): Promise<never> {
  // SAFETY: every command builds params from validated CLI-001 inputs (closed
  // shapes: strings/arrays/oids only); the cast widens only so the cache can
  // freeze the normalized payload for IPC-006 comparison.
  const normalized = params as unknown as Json;
  const cached = cache.read(key);
  if (cached) {
    const sameMethod =
      cached.method === method && paramsEqual(cached.params, normalized);
    const sameDigest =
      (cached.digest === undefined && digest === undefined) ||
      (cached.digest !== undefined &&
        digest !== undefined &&
        cached.digest.bytes === digest.bytes &&
        cached.digest.sha256 === digest.sha256);
    if (!sameMethod || !sameDigest) {
      fail(
        `REQUEST_KEY_REUSED: key ${key} was already frozen for a different request`,
        2,
      );
    }
    if (cached.lastReceipt && cached.lastReceipt.state === "succeeded") {
      printReceipt(cached.lastReceipt, key);
      process.exit(0);
    }
    // IPC-008: ask acceptance before resending
    let op: WireReply[] = [];
    try {
      op = await call("operation.get", { key });
    } catch {
      fail(
        `미접수 여부 불명확: ${key} (복구: /inbox.md 경로의 원래 command 또는 --request ${key})`,
        3,
      );
    }
    if (op.length > 0 && op[0]!.ok && op[0]!.result !== undefined) {
      const rec = op[0]!.result as Receipt;
      // MUST [IPC-008]: only an ACCEPTED operation (succeeded/pending) is
      // reported; a REQUEST_NOT_FOUND receipt means nothing was accepted and
      // the frozen payload must be re-sent below.
      if (rec.state === "succeeded" || rec.state === "pending") {
        cache.write({ ...cached, lastReceipt: rec });
        printReceipt(rec, key);
        process.exit(0);
      }
    }
    // nothing accepted yet -> re-send the SAME frozen payload below
  } else {
    const entry: CachedRequest = {
      key,
      method,
      params: normalized,
      createdAtMs: Date.now(),
      lastReceipt: null,
    };
    if (digest) entry.digest = digest;
    cache.write(entry);
  }
  let replies: WireReply[] = [];
  try {
    replies = await call(method, params, key, streamBytes);
  } catch {
    fail(
      `미접수 여부 불명확: ${key} (복구: /inbox.md 경로의 원래 command 또는 --request ${key})`,
      3,
    );
  }
  const reply = replies[0]!;
  if (reply.ok && reply.result !== undefined) {
    const rec = reply.result as Receipt;
    const prev = cache.read(key);
    const entry: CachedRequest = {
      key,
      method,
      params: normalized,
      createdAtMs: prev?.createdAtMs ?? Date.now(),
      lastReceipt: rec,
    };
    if (digest) entry.digest = digest;
    cache.write(entry);
    printReceipt(rec, key);
    process.exit(0);
  }
  const code = reply.error?.code ?? "INTERNAL_ERROR";
  if (code === "REQUEST_KEY_REUSED")
    fail(`${code}: ${reply.error?.message ?? ""}`, 2);
  if (code === "SPIKE_UNRESOLVED" || code === "UNSUPPORTED_PROFILE") {
    fail(`${code}: ${reply.error?.message ?? ""}`, 4);
  }
  fail(`${code}: ${reply.error?.message ?? ""}`, 2);
}

// ---------------------------------------------------------------------------
// arg helpers
// ---------------------------------------------------------------------------

function opt(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : null;
}

/** positional tokens: everything that is not an option or an option value. */
function positional(args: string[], optionNames: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (optionNames.includes(a)) {
      i++; // skip the option's value
      continue;
    }
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
  return readFileSync(path, "utf8");
}

function randKey(): string {
  return `cli-${uuidV4()}`;
}

// ---------------------------------------------------------------------------
// commands (CLI-001 surface only)
// ---------------------------------------------------------------------------

async function cmdSend(args: string[]): Promise<void> {
  const to = positional(args, [
    "--subject",
    "--file",
    "--kind",
    "--reply",
    "--request",
  ]);
  if (to.length === 0) fail("send requires at least one address", 2);
  const subject = opt(args, "--subject");
  const reply = opt(args, "--reply");
  if (!subject && !reply)
    fail("send requires --subject (or --reply to reuse its subject)", 2);
  const kindRaw = opt(args, "--kind") ?? "message";
  if (!["message", "question", "result", "alert", "context"].includes(kindRaw))
    fail(`invalid --kind ${kindRaw}`, 2);
  const body = readBody(opt(args, "--file"));
  const key = keyOf(args) ?? randKey();
  const params: Record<string, unknown> = {
    to,
    subject: subject ?? "Re",
    kind: kindRaw,
    body,
  };
  if (reply) params.replyToMessage = reply;
  await replayOrSend("mail.send", params, key, undefined);
}

async function cmdAgent(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "create") {
    const name = args[1];
    const from = opt(args, "--from");
    const brief = readBody(opt(args, "--file"));
    if (!name || !from) usage();
    if (!FULL_OID_RE.test(from)) fail(`invalid --from ${from}`, 2);
    if (!brief) fail("agent create requires --file <brief>", 2);
    await replayOrSend(
      "agent.create",
      { name, from, brief },
      keyOf(args) ?? randKey(),
      undefined,
    );
  } else if (sub === "start" || sub === "stop") {
    const name = args[1];
    if (!name) usage();
    await replayOrSend(
      sub === "start" ? "agent.start" : "agent.stop",
      { agent: name },
      keyOf(args) ?? randKey(),
      undefined,
    );
  } else if (sub === "continue") {
    const note = opt(args, "--note");
    if (!note) usage();
    await replayOrSend(
      "agent.continue",
      { note },
      keyOf(args) ?? randKey(),
      undefined,
    );
  } else if (sub === "wait") {
    const replies = await call("agent.wait", {});
    const r = replies[0];
    console.log(
      r?.ok === true
        ? "wait accepted"
        : `wait failed: ${r?.error?.code ?? "?"}`,
    );
    process.exit(r?.ok === true ? 0 : 2);
  } else {
    usage();
  }
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    fail(`git ${args[0] ?? "?"}: ${(r.stderr ?? "").slice(0, 200)}`, 2);
  return (r.stdout ?? "").trim();
}

async function cmdSubmit(args: string[]): Promise<void> {
  const revision = args[0];
  if (!revision) usage();
  const cwd = process.cwd();
  const candidate = git(cwd, ["rev-parse", "--verify", `${revision}^{commit}`]);
  if (!FULL_OID_RE.test(candidate))
    fail(`cannot resolve ${revision} to a commit`, 2);
  const to = positional(args, [
    "--subject",
    "--file",
    "--path",
    "--request",
  ]).slice(1);
  const subject = opt(args, "--subject") ?? "Re: submit";
  const body = readBody(opt(args, "--file"));
  const pathsRaw = positional(args, [
    "--subject",
    "--file",
    "--path",
    "--request",
  ]);
  void pathsRaw;
  const pathIdx: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--path" && args[i + 1] !== undefined)
      pathIdx.push(args[i + 1]!);
  }
  // unknown --path usage keeps the manifest empty (CLI-002: never invent)
  const paths = pathIdx.filter((p) => !p.startsWith("--"));
  const key = keyOf(args) ?? randKey();
  const exportRef = `refs/oma/export/cli-${key}`;
  // CLI-002: the summary + candidate are resolved from the LOCAL repo; the
  // bundle's prerequisite is the candidate's own parent (never invented)
  git(cwd, ["update-ref", exportRef, candidate]);
  const parent = spawnSync(
    "git",
    ["rev-parse", "--verify", "-q", `${candidate}^`],
    { cwd, encoding: "utf8" },
  );
  const prerequisites: string[] =
    parent.status === 0 && parent.stdout.trim() ? [parent.stdout.trim()] : [];
  const bundleTmp = join("/tmp", `oma-submit-${key}.bundle`);
  git(cwd, [
    "bundle",
    "create",
    bundleTmp,
    exportRef,
    ...(prerequisites.length > 0 ? [`^${prerequisites[0]}`] : []),
  ]);
  const content = readFileSync(bundleTmp);
  const params: Record<string, unknown> = {
    candidate,
    exportRef,
    prerequisites,
    to: to.length > 0 ? to : ["commons"],
    subject,
    body,
    paths,
    bundle: {
      bytes: content.length,
      sha256: sha256Hex(content),
      mediaType: "application/x-git-bundle",
    },
  };
  await replayOrSend(
    "git.submit",
    params,
    key,
    { bytes: content.length, sha256: sha256Hex(content) },
    content,
  );
}

async function cmdIntegrate(args: string[]): Promise<void> {
  const candidate = args[0];
  const expected = opt(args, "--expect");
  if (!candidate || !expected) usage();
  if (!FULL_OID_RE.test(candidate) || !FULL_OID_RE.test(expected))
    fail("invalid oid", 2);
  await replayOrSend(
    "git.integrate",
    { candidate, expected },
    keyOf(args) ?? randKey(),
    undefined,
  );
}

function walk(
  dir: string,
): Array<{ path: string; bytes: number; sha256: string; data: Uint8Array }> {
  const out: Array<{
    path: string;
    bytes: number;
    sha256: string;
    data: Uint8Array;
  }> = [];
  const walker = (d: string, rel: string): void => {
    for (const f of readdirSync(d).sort()) {
      const full = join(d, f);
      const st = statSync(full);
      const relPath = rel ? `${rel}/${f}` : f;
      if (st.isDirectory()) {
        walker(full, relPath);
        continue;
      }
      if (!st.isFile()) fail(`unsupported file type at ${relPath}`, 2);
      if (relPath.includes("..") || relPath.startsWith("/"))
        fail(`unsafe path ${relPath}`, 2);
      const data = readFileSync(full);
      out.push({
        path: relPath,
        bytes: data.length,
        sha256: sha256Hex(data),
        data,
      });
    }
  };
  walker(dir, "");
  return out;
}

async function cmdContext(args: string[]): Promise<void> {
  const dir = args[0];
  const expectRaw = opt(args, "--expect");
  if (!dir) usage();
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    fail(`not a directory: ${dir}`, 2);
  if (!expectRaw || (expectRaw !== "none" && !FULL_OID_RE.test(expectRaw)))
    fail("--expect requires <oid|none>", 2);
  const entries = walk(dir);
  if (!entries.some((e) => e.path === "GOAL.md"))
    fail("GOAL.md is required", 2);
  const content = Buffer.concat(entries.map((e) => Buffer.from(e.data)));
  const params: Record<string, unknown> = {
    expected: expectRaw === "none" ? null : expectRaw,
    entries: entries.map((e) => ({
      path: e.path,
      bytes: e.bytes,
      sha256: e.sha256,
    })),
    content: {
      bytes: content.length,
      sha256: sha256Hex(content),
      mediaType: "application/vnd.oma.context-v1",
    },
  };
  await replayOrSend(
    "context.publish",
    params,
    keyOf(args) ?? randKey(),
    { bytes: content.length, sha256: sha256Hex(content) },
    content,
  );
}

async function cmdStatus(args: string[]): Promise<void> {
  const agent = args[0];
  let replies: WireReply[] = [];
  try {
    replies = await call("status.get", agent ? { agent } : {});
  } catch {
    fail("broker unreachable", 3);
  }
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
  try {
    replies = await call("logs.read", {
      agent,
      sinceSeconds: parseDuration(since),
    });
  } catch {
    fail("broker unreachable", 3);
  }
  const r = replies[0];
  if (!r?.ok) fail(`logs: ${r?.error?.code ?? "?"}`, 2);
  const res = r.result as { text: string; truncated: boolean };
  console.log(res.text);
  if (res.truncated) console.error("(truncated)");
  process.exit(0);
}

// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<never> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "send":
      await cmdSend(rest);
      break;
    case "agent":
      await cmdAgent(rest);
      break;
    case "submit":
      await cmdSubmit(rest);
      break;
    case "integrate":
      await cmdIntegrate(rest);
      break;
    case "context":
      if (rest[0] === "publish") {
        await cmdContext(rest.slice(1));
        break;
      }
      usage();
    case "status":
      await cmdStatus(rest);
      break;
    case "logs":
      await cmdLogs(rest);
      break;
    default:
      usage();
  }
  return process.exit(0) as never;
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(`oma: ${(e as Error).message}`);
  process.exit(3);
});
