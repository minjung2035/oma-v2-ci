import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, ClientError } from "@oma/client";
import { RequestService } from "@oma/client/request-service";
import { currentContext } from "@oma/client/context";
import { installRuntime, type Reply } from "@oma/client/runtime";
import { CLIENT_RUNTIME, installClientRuntime } from "#oma-test/app/runtime/client-runtime";
import { RequestCache, CacheError } from "#oma-test/app/request-cache";
import { registerOmaTools } from "@oma/extension/mail-tools";
import { PrincipalChannel } from "@oma/extension/principal-channel";
import { encodeCredential } from "@oma/protocol/client-codecs";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { receiptChunk } from "@oma/protocol/receipt-chunks";
import { receiptNotFound } from "@oma/protocol/receipts";

const operation = "op-00000000-0000-4000-8000-000000000001";
const message = "m-00000000-0000-4000-8000-000000000001-0";
const success = { operation, state: "succeeded", result: { kind: "mail.send", message, recipientCount: 1, archivePath: `/state/mail/archive/cur/${message}:2,` } };
const scratch = () => mkdtempSync(join(process.cwd(), ".client-test-"));

test("E27/E29: tools need no CLI path, spawn no process, and attach with the current in-memory grant", async t => {
  installClientRuntime();
  const root = scratch();
  const path = join(root, "broker.sock");
  const frames: Record<string, unknown>[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    const parser = new FrameParser(256 * 1024);
    socket.on("data", (chunk: Buffer) => {
      for (const frame of parser.feed(chunk)) {
        frames.push(frame.raw);
        const result = frame.raw.method === "principal.attach" ? { actor: "principal", incarnation: 0 } : success;
        socket.write(encodeFrame({ v: 1, id: frame.raw.id, ok: true, result }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  const previous = { ...process.env };
  const channel = PrincipalChannel.detached();
  Object.defineProperty(channel, "attached", { value: true });
  const grants = ["a", "b"].map(value => ({ credential: value.repeat(64), sessionHandle: "c".repeat(32) }));
  channel.push(encodeCredential(grants[0]!));
  const tools = new Map<string, { execute(id: string, params: unknown): Promise<{ content: { text: string }[] }> }>();
  delete process.env.OMA_CLI_PATH;
  Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: path });
  try {
    registerOmaTools({ registerTool: (tool: never) => tools.set((tool as { name: string }).name, tool) } as never, root, channel);
    const spawn = t.mock.method(childProcess, "spawn", () => { throw new Error("tool tried to spawn"); });
    const exit = t.mock.method(process, "exit", () => { throw new Error("tool tried to exit"); });
    syncBuiltinESMExports();
    for (let i = 0; i < grants.length; i++) {
      channel.push(encodeCredential(grants[i]!));
      const answer = await tools.get("oma_mail_send")!.execute(`tool-${i}`, { to: ["principal"], subject: "s", body: "frozen\r\nbody", request: `tool-${i}` });
      assert.match(answer.content[0]!.text, /succeeded/);
      assert.equal(JSON.parse(answer.content[0]!.text).result.archivePath, join(root, "archive", `${message}:2,`));
    }
    assert.equal(spawn.mock.callCount(), 0); assert.equal(exit.mock.callCount(), 0);
    assert.deepEqual(frames.map(row => row.method), ["principal.attach", "mail.send", "principal.attach", "mail.send"]);
    assert.deepEqual(frames.filter(row => row.method === "principal.attach").map(row => row.params), grants.map(grant => ({ sessionHandle: grant.sessionHandle, credential: grant.credential })));
    assert.deepEqual(frames[1]!.params, { to: ["principal"], subject: "s", body: "frozen\nbody", kind: "message" });
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

const frozenParams = { to: ["b"], subject: "s", kind: "message", body: "original" };
const lookupCases: { name: string; lookup: Reply; resend: boolean; rejects?: RegExp }[] = [
  { name: "pending", lookup: { ok: true, result: { operation, state: "pending" } }, resend: false },
  { name: "unknown", lookup: { ok: true, result: { operation, state: "unknown" } }, resend: false },
  { name: "success", lookup: { ok: true, result: success }, resend: false },
  { name: "not-found receipt", lookup: { ok: true, result: receiptNotFound }, resend: true },
  { name: "not-found error", lookup: { ok: false, error: receiptNotFound.error! }, resend: true },
  { name: "unavailable", lookup: { ok: false, error: { code: "DB_BUSY", message: "busy", retry: "same-key" } }, resend: false, rejects: /did not prove/ },
  { name: "malformed", lookup: { ok: true, result: { ...receiptNotFound, extra: 1 } }, resend: false, rejects: /invalid operation lookup/ },
];
for (const scenario of lookupCases) test(`P0 replay after client restart: ${scenario.name}`, async () => {
  installClientRuntime();
  const root = scratch();
  try {
    const cache = new RequestCache(root);
    cache.freeze({ key: "k", method: "mail.send", params: frozenParams, createdAtMs: 1 });
    const before = JSON.parse(readFileSync(join(root, ".local/state/oma/requests/k.json"), "utf8"));
    const methods: string[] = [];
    const restarted = new RequestService(new RequestCache(root), async (method, params) => {
      methods.push(method);
      if (method === "operation.get") { assert.deepEqual(params, { key: "k" }); return [scenario.lookup]; }
      assert.deepEqual(params, frozenParams); return [{ ok: true, result: success }];
    });
    const done = () => restarted.requestReceipt("mail.send", "k", () => { throw new Error("source builder ran on replay"); }, () => ({ to: ["b"], subject: "s", kind: "message" }));
    if (scenario.rejects) await assert.rejects(done, scenario.rejects); else await done();
    assert.deepEqual(methods, scenario.resend ? ["operation.get", "mail.send"] : ["operation.get"]);
    const after = JSON.parse(readFileSync(join(root, ".local/state/oma/requests/k.json"), "utf8"));
    for (const field of ["key", "method", "params", "createdAtMs"]) assert.deepEqual(after[field], before[field]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0 streamed replay preserves frozen bytes; missing body does not hide an accepted receipt", async () => {
  installClientRuntime();
  const root = scratch();
  const body = Buffer.from("immutable bundle");
  const digest = { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
  const params = { candidate: "a".repeat(40), exportRef: "refs/oma/export/k", prerequisites: [], to: ["b"], subject: "s", body: "b", paths: [], bundle: { ...digest, mediaType: "application/x-git-bundle" } };
  const accepted = { operation, state: "pending" };
  try {
    const cache = new RequestCache(root);
    cache.freeze({ key: "k", method: "git.submit", params, digest, createdAtMs: 1 }, body);
    let sends = 0;
    const service = (found: boolean) => new RequestService(new RequestCache(root), async (method, actual, key, bytes) => {
      if (method === "operation.get") return [{ ok: true, result: found ? accepted : receiptNotFound }];
      sends++; assert.deepEqual(actual, params); assert.equal(key, "k"); assert.deepEqual(Buffer.from(bytes!), body);
      return [{ ok: true, result: accepted }];
    });
    const build = () => { throw new Error("current files must never rebuild the body"); };
    await service(false).requestReceipt("git.submit", "k", build, () => ({ candidate: params.candidate }));
    unlinkSync(cache.bodyPath("k"));
    assert.deepEqual(await service(true).requestReceipt("git.submit", "k", build, () => ({ candidate: params.candidate })), accepted);
    await assert.rejects(() => service(false).requestReceipt("git.submit", "k", build, () => ({ candidate: params.candidate })), /body absent/);
    assert.equal(sends, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0 lost reply performs only a lookup even when lookup reports absence", async () => {
  installClientRuntime();
  const root = scratch();
  try {
    const seen: string[] = [];
    const service = new RequestService(new RequestCache(root), async method => {
      seen.push(method); if (method === "mail.send") throw new Error("lost answer");
      return [{ ok: true, result: receiptNotFound }];
    });
    await assert.rejects(() => service.send("mail.send", frozenParams, "k"), /Acceptance status unknown.*k/);
    assert.deepEqual(seen, ["mail.send", "operation.get"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0 same-key conflicts and corrupt cache do not run builders or send", async () => {
  installClientRuntime();
  const root = scratch();
  try {
    const cache = new RequestCache(root);
    cache.freeze({ key: "k", method: "mail.send", params: frozenParams, createdAtMs: 1 });
    const service = new RequestService(cache, async () => { throw new Error("unexpected transport"); });
    const build = () => { throw new Error("unexpected builder"); };
    await assert.rejects(() => service.requestReceipt("agent.stop", "k", build, () => ({})), /REQUEST_KEY_REUSED.*method/);
    await assert.rejects(() => service.requestReceipt("mail.send", "k", build, () => ({ subject: "different" })), /REQUEST_KEY_REUSED.*subject/);
    writeFileSync(join(root, ".local/state/oma/requests/k.json"), "broken");
    await assert.rejects(() => service.requestReceipt("mail.send", "k", build, () => ({})), /CACHE_CORRUPT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const code of ["CACHE_UNAVAILABLE", "CACHE_CORRUPT"] as const) test(`P0 broker receipt is preserved when recording reports ${code}`, async () => {
  const root = scratch();
  installRuntime({ ...CLIENT_RUNTIME, cache: (home, budget) => {
    const cache = CLIENT_RUNTIME.cache(home, budget);
    cache.updateReceipt = () => { throw new CacheError(code, "fixture"); };
    return cache;
  }, channel: () => ({ connect: async () => {}, close() {}, call: async () => ({ ok: true, result: success }) }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
    const done = () => client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "k");
    if (code === "CACHE_UNAVAILABLE") {
      const text = await done(); assert.match(text, /succeeded/); assert.match(text, /CACHE_UNAVAILABLE/); assert.match(text, /--request k/);
    } else await assert.rejects(done, error => error instanceof ClientError && error.contradicted && error.receipt !== undefined && error.request === "k");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("per-client environment and cwd remain isolated across asynchronous builders", async () => {
  const roots = [scratch(), scratch()];
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {}, call: async () => ({ ok: true, result: { operation, state: "pending" } }) }) });
  try {
    await Promise.all(roots.map((root, index) => {
      const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
      return client.effect("route.follow", `k-${index}`, async () => {
        await new Promise<void>(resolve => setTimeout(resolve, index === 0 ? 5 : 1));
        assert.equal(currentContext().cwd, root); assert.equal(currentContext().env.HOME, root);
        return { method: "route.follow", params: { topic: "commons" } };
      }, () => ({ topic: "commons" }));
    }));
  } finally { installClientRuntime(); for (const root of roots) rmSync(root, { recursive: true, force: true }); }
});

test("body and answer bounds count UTF-8 bytes; pre-abort keeps the request key without a freeze", async () => {
  const root = scratch();
  let calls = 0;
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {}, call: async () => {
    calls++; return { ok: true, result: { text: "한".repeat(400_000) } };
  } }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_FRAME_BYTES: "1024" } });
    await assert.rejects(() => client.sendMail({ to: ["b"], subject: "s", body: "한".repeat(342), kind: "message" }, "large"), /larger than.*frame.*--request large/);
    assert.equal(CLIENT_RUNTIME.cache(root, 2048).read("large").kind, "absent");
    await assert.rejects(() => client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "aborted", AbortSignal.abort()), /unknown.*--request aborted/);
    assert.equal(CLIENT_RUNTIME.cache(root, 2048).read("aborted").kind, "absent");
    await assert.rejects(() => client.query("mail.send" as never, {}), /mutation requires a frozen request/);
    assert.equal(calls, 0);
    // P0: a 1.2 MiB answer is not an error -- the tool result is a marked
    // preview, and the complete text is one read away in the caller's state.
    const complete = JSON.stringify({ text: "한".repeat(400_000) });
    const text = await client.queryText("agent.wait", { observe: true });
    assert.equal(calls, 1);
    assert.match(text, /oma: \[preview\] the complete \d+-byte answer is at /);
    const file = / is at (\S+)/.exec(text)?.[1];
    assert.ok(file?.startsWith(join(root, ".local", "state", "oma", "output")), `the answer was not kept under the caller's HOME: ${file}`);
    assert.equal(readFileSync(file!, "utf8"), complete, "the saved file is not the complete answer");
    // The head is the answer's own beginning, cut at a UTF-8 boundary.
    assert.ok(complete.startsWith(text.slice(0, 1024)));
    assert.doesNotThrow(() => Buffer.from(text.slice(0, text.indexOf("\noma: [preview]")), "utf8"));
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("IPC-006 / P0: every receipt chunk buys a fresh observation window -- a many-chunk receipt over a slow link completes", async () => {
  const root = scratch();
  const big = { operation, state: "succeeded", result: { kind: "mail.send", message, recipientCount: 1,
    archivePath: `/state/${"r".repeat(12_000)}` } };
  let reads = 0;
  // One 50 ms observation window, forty-millisecond reads: on a shared
  // deadline the third read is dead before it is asked.
  installRuntime({ ...CLIENT_RUNTIME, observationSeconds: 0.05, channel: () => {
    let stopped: ((error: unknown) => void) | undefined;
    return {
      connect: async () => {},
      close(error?: unknown) { stopped?.(error); },
      call: async (method: string, params: Record<string, unknown>) => {
        if (method === "mail.send")
          return { ok: false as const, error: { code: "FRAME_TOO_LARGE", message: "the receipt is chunked", retry: "same-key" } };
        assert.equal(method, "operation.read");
        reads++;
        const { result } = receiptChunk("f", big as never, params as never, 1500);
        return await new Promise<Reply>((resolve, reject) => {
          stopped = reject;
          setTimeout(() => resolve({ ok: true, result }), 40);
        });
      },
    };
  } });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
    const text = await client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "key");
    assert.match(text, /succeeded/);
    assert.ok(reads > 3, `only ${reads} chunk reads ran`);
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("P0 an oversized answer still previews when it cannot be saved, and says why", async () => {
  const root = scratch();
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {},
    call: async () => ({ ok: true, result: { text: "x".repeat(1_100_000) } }) }) });
  try {
    // No HOME: the head and the exact byte count still reach the caller.
    const homeless = new Client({ cwd: root, env: { OMA_SOCKET: join(root, "socket") } });
    const text = await homeless.queryText("agent.wait", { observe: true });
    assert.match(text, /oma: \[preview\] the complete \d+-byte answer could not be saved \(no HOME\)/);
    assert.equal(Buffer.byteLength(text.slice(0, text.indexOf("\noma: [preview]"))), 1_048_576, "the head is not one full preview");
    // A HOME whose state directory cannot be made reports the failure.
    const file = join(root, "occupied");
    writeFileSync(file, "not a directory");
    const blocked = new Client({ cwd: root, env: { HOME: file, OMA_SOCKET: join(root, "socket") } });
    const failed = await blocked.queryText("agent.wait", { observe: true });
    assert.match(failed, /oma: \[preview\] the complete \d+-byte answer could not be saved \(/);
    // A large RECEIPT text converts the same way inside `effect`'s presentation.
    const effectText = { operation, state: "succeeded", result: { kind: "mail.send", message, recipientCount: 1, archivePath: `/state/${"p".repeat(1_100_000)}` } };
    installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {},
      call: async () => ({ ok: true, result: effectText }) }) });
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
    const receiptText = await client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "key");
    assert.match(receiptText, /oma: \[preview\] the complete \d+-byte answer is at .*; --request key/);
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("P0 the output spool is content-named: the same answer is one file, and a same-named file of other bytes is not overwritten", async () => {
  const root = scratch();
  try {
    const { spoolOutput } = await import("@oma/storage/output-spool");
    const { sha256Hex } = await import("@oma/domain/canonical-json");
    const bytes = Buffer.from("the complete answer");
    const first = spoolOutput(root, bytes);
    assert.equal(first, join(root, ".local", "state", "oma", "output", `output-${sha256Hex(bytes)}.txt`));
    assert.equal(readFileSync(first, "utf8"), "the complete answer");
    assert.equal(spoolOutput(root, bytes), first, "the same answer spooled twice");
    // A digest-named file holding other bytes is not this answer's home.
    const foreign = Buffer.from("tampered");
    writeFileSync(join(root, ".local", "state", "oma", "output", `output-${sha256Hex(bytes)}.txt`), foreign);
    const rescued = spoolOutput(root, bytes);
    assert.notEqual(rescued, first, "a name already holding other bytes was overwritten or trusted");
    assert.equal(readFileSync(rescued, "utf8"), "the complete answer");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const state of ["pending", "unknown"] as const) test(`candidate publication ${state} stops review naming the open key, while the frozen request stays <key>.submit`, async () => {
  const root = scratch(), sent: { method: string; request: string | undefined; params: Record<string, unknown> }[] = [],
    candidate = "a".repeat(40), base = "b".repeat(40);
  installRuntime({ ...CLIENT_RUNTIME, resolveOid: value => value, recordedBase: () => base, workspaceDirty: () => false,
    submit: () => ({ exportRef: "refs/oma/export/local", prerequisites: [], content: Buffer.from("bundle") }),
    channel: () => ({ connect: async () => {}, close() {}, call: async (method, params, options) => {
      sent.push({ method, params: params as Record<string, unknown>, request: options?.request });
      return { ok: true, result: method === "git.known" ? { hasCandidate: false, prerequisites: [] } : { operation, state } };
    } }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_ACTOR: "alice" } });
    const done = client.review("merge", { action: "open", candidate, base, title: "t", tier: "LOW", reason: "r" }, "open");
    // Recovery text names the request the model actually started -- never the
    // derived `<key>.submit` identity.
    if (state === "pending") {
      const text = await done;
      assert.match(text, /--request open\b/);
      assert.doesNotMatch(text, /open\.submit/);
    } else await assert.rejects(done, error =>
      error instanceof ClientError && error.request === "open" && /--request open\b/.test(error.message) && !/open\.submit/.test(error.message));
    // The frozen request itself keeps the `.submit` key on the wire and in the
    // request cache, so a replay looks up and resends `open.submit`.
    assert.deepEqual(sent.map(row => row.method), ["git.known", "git.submit"]);
    assert.equal(sent[1]!.request, "open.submit");
    assert.equal(CLIENT_RUNTIME.cache(root, 2 * 256 * 1024).read("open").kind, "absent");
    assert.equal(CLIENT_RUNTIME.cache(root, 2 * 256 * 1024).read("open.submit").kind, "present");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("a frozen submit is replayed under <key>.submit even though recovery text names the open key", async () => {
  const root = scratch(), candidate = "a".repeat(40), base = "b".repeat(40);
  const seen: { method: string; key: string | undefined; params: Record<string, unknown> }[] = [];
  installRuntime({ ...CLIENT_RUNTIME, resolveOid: value => value, recordedBase: () => base, workspaceDirty: () => false,
    submit: () => { throw new Error("a replay never rebuilds the frozen request"); },
    channel: () => ({ connect: async () => {}, close() {}, call: async (method, params, options) => {
      seen.push({ method, key: options?.request, params: params as Record<string, unknown> });
      if (method === "git.known") return { ok: true, result: { hasCandidate: false, prerequisites: [] } };
      if (method === "operation.get") return { ok: true, result: receiptNotFound };
      if (method === "git.submit") return { ok: true, result: { operation, state: "succeeded",
        result: { kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${operation}`, message: "m-00000000-0000-4000-8000-000000000002-0", recipientCount: 1 } } };
      return { ok: true, result: { operation, state: "succeeded",
        result: { kind: "attest.record", request: "merge-00000002-0000-4000-8000-000000000000", messages: ["m-00000000-0000-4000-8000-000000000003-0"], recipientCount: 1 } } };
    } }) });
  // Replay: `open.submit` is frozen, the ledger answers REQUEST_NOT_FOUND, and
  // the frozen request is resent -- under its own key, not the display key.
  const cache = new RequestCache(root);
  cache.freeze({ key: "open.submit", method: "git.submit", createdAtMs: 1,
    params: { candidate, exportRef: "refs/oma/export/local", prerequisites: [], to: ["alice"],
      subject: `merge candidate ${candidate.slice(0, 12)}`, body: "Candidate for a merge request; review happens in the request thread.", paths: [] } });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_ACTOR: "alice" } });
    const text = await client.review("merge", { action: "open", candidate, base, title: "t", tier: "LOW", reason: "r" }, "open");
    assert.match(text, /succeeded/);
    const lookup = seen.find(row => row.method === "operation.get");
    assert.deepEqual(lookup?.params, { key: "open.submit" }, "the replay lookup named the display key instead of the frozen request's");
    assert.equal(seen.find(row => row.method === "git.submit")?.key, "open.submit");
    assert.equal(seen.find(row => row.method === "attest.record")?.key, "open");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("mail-v1/E27: the tool path's submit notice names the engine's actor, like a manual `oma submit`", async () => {
  const root = scratch(), candidate = "a".repeat(40), base = "b".repeat(40);
  const path = join(root, "broker.sock");
  const frames: Record<string, unknown>[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    const parser = new FrameParser(256 * 1024);
    socket.on("data", (chunk: Buffer) => {
      for (const frame of parser.feed(chunk)) {
        frames.push(frame.raw);
        const result = frame.raw.method === "git.known" ? { hasCandidate: false, prerequisites: [] }
          : frame.raw.method === "git.submit" ? { operation, state: "succeeded",
              result: { kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${operation}`, message, recipientCount: 1 } }
          : { operation, state: "succeeded",
              result: { kind: "attest.record", request: "merge-00000002-0000-4000-8000-000000000000", messages: [message], recipientCount: 1 } };
        socket.write(encodeFrame({ v: 1, id: frame.raw.id, ok: true, result }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  installRuntime({ ...CLIENT_RUNTIME, resolveOid: value => value, recordedBase: () => base, workspaceDirty: () => false,
    submit: () => ({ exportRef: "refs/oma/export/local", prerequisites: [] }) });
  const previous = { ...process.env };
  const tools = new Map<string, { execute(id: string, params: unknown): Promise<{ content: { text: string }[] }> }>();
  try {
    // The engine's environment, as the sandbox sets it for a Resident (or the
    // host for the Principal): OMA_ACTOR is the ambient actor identity.
    Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: path, OMA_ACTOR: "alice" });
    registerOmaTools({ registerTool: (tool: never) => tools.set((tool as { name: string }).name, tool) } as never, root);
    const answer = await tools.get("oma_merge")!.execute("call-1",
      { action: "open", tier: "LOW", title: "t", reason: "r", candidate, base, request: "open" });
    assert.match(answer.content[0]!.text, /succeeded/);
    const submitted = frames.find(frame => frame.method === "git.submit");
    assert.deepEqual((submitted?.params as { to?: string[] } | undefined)?.to, ["alice"],
      "the tool path mailed the submit notice to commons while a manual `oma submit` mails the actor");
  } finally {
    installClientRuntime();
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a client whose environment has no HOME names it; no request cache is made under /tmp", async () => {
  // The cache root is the caller's own home -- the in-guest caller's agent
  // home. An environment that carries none has no root at all; the request
  // names that instead of silently placing receipts in shared space.
  const root = scratch();
  let cached = 0;
  installRuntime({ ...CLIENT_RUNTIME, cache: (home, budget) => { cached += 1; return CLIENT_RUNTIME.cache(home, budget); } });
  try {
    const client = new Client({ cwd: root, env: {} });
    await assert.rejects(client.effect("route.follow", "k",
      async () => ({ method: "route.follow", params: { topic: "work" } }), () => ({ topic: "work" })),
      (error: unknown) => error instanceof ClientError && error.exitCode === 4 && /HOME is not set/.test(error.message));
    assert.equal(cached, 0, "the cache port was never asked for a root");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});
