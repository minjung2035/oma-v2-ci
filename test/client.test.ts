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
import { isValidRequestKey } from "@oma/domain/identifiers";
import { PrincipalChannel } from "@oma/extension/principal-channel";
import { encodeCredential } from "@oma/protocol/client-codecs";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { receiptChunk } from "@oma/protocol/receipt-chunks";
import { receiptNotFound } from "@oma/protocol/receipts";

const operation = "op-00000000-0000-4000-8000-000000000001";
const message = "m-00000000-0000-4000-8000-000000000001-0";
const success = { operation, state: "succeeded", result: { kind: "mail.send", message, recipientCount: 1, archivePath: `/state/mail/archive/cur/${message}:2,` } };
const scratch = () => mkdtempSync(join(process.cwd(), ".client-test-"));
test("022. An unrelated caller request at the derived submit key cannot replace publication intent",async()=>{
 const root=scratch(), candidate="a".repeat(40),base="b".repeat(40),key="collision";
 const cache=new RequestCache(root).prepare();
 cache.freeze({key:key+".submit",method:"git.submit",createdAtMs:Date.now(),params:{candidate,to:["alice"],
  subject:`merge candidate ${candidate.slice(0,12)}`,body:"unrelated payload",paths:["other"],prerequisites:[],exportRef:"refs/oma/export/other"}});
 const sent:string[]=[];
 try{
  installRuntime({...CLIENT_RUNTIME,resolveOid:v=>v,recordedBase:()=>base,workspaceDirty:()=>false,
   channel:()=>({connect:async()=>{},close(){},call:async(method)=>{sent.push(method);return {ok:true,result:{hasCandidate:false,prerequisites:[]}};}})});
  const client=new Client({cwd:root,env:{HOME:root,OMA_SOCKET:join(root,"socket"),OMA_ACTOR:"alice"}});
  await assert.rejects(client.controlReview({kind:"review.revise",name:"merge-00000002-0000-4000-8000-000000000000",expectedRevision:0,base,candidate,reason:"r"},key),
    (error:unknown)=>error instanceof ClientError && /different|conflict|reused/i.test(error.message));
  assert.deepEqual(sent,["git.known"]);
 }finally{installClientRuntime();rmSync(root,{recursive:true,force:true});}
});

test("001. The typed client needs no CLI path, spawns no process, and attaches with the current in-memory grant", async t => {
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
  const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: path, OMA_MAIL_ARCHIVE: join(root, "archive") } },
    () => channel.current(), signal => channel.waitForGrant(signal));
  try {
    const spawn = t.mock.method(childProcess, "spawn", () => { throw new Error("tool tried to spawn"); });
    const exit = t.mock.method(process, "exit", () => { throw new Error("tool tried to exit"); });
    syncBuiltinESMExports();
    for (let i = 0; i < grants.length; i++) {
      channel.push(encodeCredential(grants[i]!));
      const answer = await client.sendMail({ to: ["principal"], subject: "s", body: "frozen\r\nbody", kind: "message" }, `tool-${i}`);
      const envelope = JSON.parse(answer);
      assert.equal(envelope.request, `tool-${i}`);
      assert.equal(envelope.receipt.state, "succeeded");
      assert.equal(envelope.receipt.result.archivePath, join(root, "archive", `${message}:2,`));
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
for (const scenario of lookupCases) test(`002. Replay after client restart: ${scenario.name}`, async () => {
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

test("003. Streamed replay preserves frozen bytes; missing body does not hide an accepted receipt", async () => {
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

test("004. Lost reply performs only a lookup even when lookup reports absence", async () => {
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

test("005. Same-key conflicts and corrupt cache do not run builders or send", async () => {
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

for (const code of ["CACHE_UNAVAILABLE", "CACHE_CORRUPT"] as const) test(`006. Broker receipt is preserved when recording reports ${code}`, async () => {
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
      const text = await done();
      assert.deepEqual(JSON.parse(text.split("\n")[0]!).receipt, success);
      assert.equal(JSON.parse(text.split("\n")[0]!).request, "k");
      assert.match(text, /CACHE_UNAVAILABLE/);
    } else await assert.rejects(done, error => error instanceof ClientError && error.contradicted && error.receipt !== undefined && error.request === "k");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

for (const state of ["pending", "succeeded", "failed", "unknown"] as const)
  test(`007. Typed client preserves the complete ${state} receipt and request identity`, async () => {
    const root = scratch();
    const receipt = state === "succeeded" ? success : {
      operation, state, reason: "broker observation",
      ...(state === "failed" ? { error: { code: "CAPABILITY_DENIED", message: "permission changed",
        retry: "never", details: { actor: "alice", required: ["mail.send"] } } } : {}),
    };
    installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {},
      call: async () => ({ ok: true, result: receipt }) }) });
    try {
      const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
      const send = () => client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "receipt-key");
      if (state === "pending" || state === "succeeded") {
        assert.deepEqual(JSON.parse(await send()), { request: "receipt-key", receipt });
      } else {
        await assert.rejects(send, error => {
          assert.ok(error instanceof ClientError);
          assert.equal(error.request, "receipt-key");
          assert.deepEqual(error.receipt, receipt);
          assert.deepEqual(JSON.parse(error.message), { request: "receipt-key", receipt });
          return true;
        });
      }
    } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
  });

test("008. Per-client environment and cwd remain isolated across asynchronous builders", async () => {
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

test("009. Body and answer bounds count UTF-8 bytes; pre-abort keeps the request key without a freeze", async () => {
  const root = scratch();
  let calls = 0;
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {}, call: async () => {
    calls++; return { ok: true, result: { text: "한".repeat(400_000) } };
  } }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_FRAME_BYTES: "1024" } });
    await assert.rejects(() => client.sendMail({ to: ["b"], subject: "s", body: "한".repeat(342), kind: "message" }, "large"),
      error => error instanceof ClientError && error.request === "large" && /larger than.*frame/.test(error.message));
    assert.equal(CLIENT_RUNTIME.cache(root, 2048).read("large").kind, "absent");
    await assert.rejects(() => client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "aborted", AbortSignal.abort()),
      error => error instanceof ClientError && error.request === "aborted");
    assert.equal(CLIENT_RUNTIME.cache(root, 2048).read("aborted").kind, "absent");
    await assert.rejects(() => client.query("mail.send" as never, {}), /mutation requires a frozen request/);
    assert.equal(calls, 0);
    // P0: a 1.2 MiB answer is not an error -- the tool result is a marked
    // preview, and the complete text is one read away in the caller's state.
    const complete = JSON.stringify({ text: "한".repeat(400_000) });
    const text = await client.queryText("agent.wait", { observe: true });
    assert.equal(calls, 1);
    assert.match(text, /\[preview\] the complete \d+-byte answer is at /);
    const file = / is at (\S+)/.exec(text)?.[1];
    assert.ok(file?.startsWith(join(root, ".local", "state", "oma", "output")), `the answer was not kept under the caller's HOME: ${file}`);
    assert.equal(readFileSync(file!, "utf8"), complete, "the saved file is not the complete answer");
    // The head is the answer's own beginning, cut at a UTF-8 boundary.
    assert.ok(complete.startsWith(text.slice(0, 1024)));
    assert.doesNotThrow(() => Buffer.from(text.slice(0, text.indexOf("\n[preview]")), "utf8"));
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("010. Every receipt chunk buys a fresh observation window -- a many-chunk receipt over a slow link completes", async t => {
  const root = scratch();
  const big = { operation, state: "succeeded", result: { kind: "mail.send", message, recipientCount: 1,
    archivePath: `/state/${"r".repeat(12_000)}` } };
  let reads = 0, now = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(performance, "now", () => now);
  // Virtual 50 ms observation windows and 40 ms reads: on a shared
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
          now += 40;
          t.mock.timers.tick(40);
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

test("011. An oversized answer still previews when it cannot be saved, and says why", async () => {
  const root = scratch();
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {},
    call: async () => ({ ok: true, result: { text: "x".repeat(1_100_000) } }) }) });
  try {
    // No HOME: the head and the exact byte count still reach the caller.
    const homeless = new Client({ cwd: root, env: { OMA_SOCKET: join(root, "socket") } });
    const text = await homeless.queryText("agent.wait", { observe: true });
    assert.match(text, /\[preview\] the complete \d+-byte answer could not be saved \(no HOME\)/);
    assert.equal(Buffer.byteLength(text.slice(0, text.indexOf("\n[preview]"))), 1_048_576, "the head is not one full preview");
    // A HOME whose state directory cannot be made reports the failure.
    const file = join(root, "occupied");
    writeFileSync(file, "not a directory");
    const blocked = new Client({ cwd: root, env: { HOME: file, OMA_SOCKET: join(root, "socket") } });
    const failed = await blocked.queryText("agent.wait", { observe: true });
    assert.match(failed, /\[preview\] the complete \d+-byte answer could not be saved \(/);
    // A large RECEIPT text converts the same way inside `effect`'s presentation.
    const effectText = { operation, state: "succeeded", result: { kind: "mail.send", message, recipientCount: 1, archivePath: `/state/${"p".repeat(1_100_000)}` } };
    installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {},
      call: async () => ({ ok: true, result: effectText }) }) });
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
    const receiptText = await client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "key");
    assert.match(receiptText, /\[preview\] the complete \d+-byte answer is at .*; request key/);
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("012. The output spool is content-named: the same answer is one file, and a same-named file of other bytes is not overwritten", async () => {
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

for (const state of ["pending", "unknown"] as const) test(`013. Candidate publication ${state} stops review while preserving the frozen parent and child requests`, async () => {
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
    const done = client.openMerge({ candidate, base, title: "t", tier: "LOW", reason: "r" }, "open");
    // Publication is not an opened review: preserve its state under the
    // caller's open key while the cache retains the derived submit key.
    if (state === "pending") {
      const envelope = JSON.parse(await done);
      assert.equal(envelope.request, "open");
      assert.deepEqual(envelope.receipt, { operation, state });
    } else await assert.rejects(done, error =>
      error instanceof ClientError && error.request === "open" &&
      JSON.parse(error.message).receipt.state === state && JSON.parse(error.message).request === "open");
    // The frozen request itself keeps the `.submit` key on the wire and in the
    // request cache, so a replay looks up and resends `open.submit`.
    assert.deepEqual(sent.map(row => row.method), ["git.known", "git.submit"]);
    assert.equal(sent[1]!.request, "open.submit");
    const parent = CLIENT_RUNTIME.cache(root, 2 * 256 * 1024).read("open");
    assert.equal(parent.kind, "present", "the open freezes before candidate publication");
    if (parent.kind === "present") {
      assert.equal(parent.value.method, "attest.record");
      assert.ok(parent.value.params !== null && typeof parent.value.params === "object" && !Array.isArray(parent.value.params));
      assert.equal(parent.value.params.candidate, candidate);
      assert.equal(parent.value.params.base, base);
    }
    assert.equal(CLIENT_RUNTIME.cache(root, 2 * 256 * 1024).read("open.submit").kind, "present");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("014. A frozen submit is replayed under <key>.submit even though recovery text names the open key", async () => {
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
    const text = await client.openMerge({ candidate, base, title: "t", tier: "LOW", reason: "r" }, "open");
    assert.match(text, /succeeded/);
    const lookup = seen.find(row => row.method === "operation.get");
    assert.deepEqual(lookup?.params, { key: "open.submit" }, "the replay lookup named the display key instead of the frozen request's");
    assert.equal(seen.find(row => row.method === "git.submit")?.key, "open.submit");
    assert.equal(seen.find(row => row.method === "attest.record")?.key, "open");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("015. Mail-v1: merge publication sends its candidate notice only to the engine's actor", async () => {
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
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: path, OMA_ACTOR: "alice" } });
    const answer = await client.openMerge({ tier: "LOW", title: "t", reason: "r", candidate, base }, "open");
    assert.equal(JSON.parse(answer).receipt.state, "succeeded");
    const submitted = frames.find(frame => frame.method === "git.submit");
    assert.deepEqual((submitted?.params as { to?: string[] } | undefined)?.to, ["alice"],
      "automatic merge publication must not announce an unreviewed candidate to commons");
  } finally {
    installClientRuntime();
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("016. A client whose environment has no HOME names it; no request cache is made under /tmp", async () => {
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

test("017. A maximum-length review.revise key publishes the candidate under a valid derived request", async () => {
  const root = scratch(), candidate = "a".repeat(40), base = "b".repeat(40), key = "x".repeat(96);
  const name = "merge-00000002-0000-4000-8000-000000000000";
  const sent: { method: string; request: string | undefined; params: Record<string, unknown> }[] = [];
  installRuntime({ ...CLIENT_RUNTIME, resolveOid: value => value, recordedBase: () => base, workspaceDirty: () => false,
    submit: () => ({ exportRef: "refs/oma/export/local", prerequisites: [], content: Buffer.from("bundle") }),
    channel: () => ({ connect: async () => {}, close() {},
      call: async (method, params, options) => {
        sent.push({ method, request: options?.request, params: params as Record<string, unknown> });
        if (method === "git.known") return { ok: true, result: { hasCandidate: false, prerequisites: [] } };
        if (method === "git.submit") return { ok: true, result: { operation, state: "succeeded",
          result: { kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${operation}`, message, recipientCount: 1 } } };
        return { ok: true, result: { operation, state: "succeeded",
          result: { kind: "attest.record", request: name, messages: [message], recipientCount: 1 } } };
      } }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_ACTOR: "alice" } });
    const text = await client.controlReview({ kind: "review.revise", name, expectedRevision: 0, base, candidate, reason: "r" }, key);
    assert.deepEqual(sent.map(row => row.method), ["git.known", "git.submit", "attest.record"]);
    const publication = sent[1]!.request!;
    assert.ok(isValidRequestKey(publication), `the derived publication request must fit the wire grammar: ${publication}`);
    assert.notEqual(publication, key, "candidate publication is its own request, never the revise's own key");
    assert.equal(sent[1]!.params.candidate, candidate);
    assert.equal(sent[2]!.request, key, "the revise itself keeps the caller's request key");
    const output = JSON.parse(text);
    assert.equal(output.request, key);
    assert.equal(output.receipt.state, "succeeded");
    const frozen = new RequestCache(root).read(publication);
    assert.equal(frozen.kind, "present", "the publication is frozen under its own derived request key");
    if (frozen.kind === "present") {
      assert.equal(frozen.value.method, "git.submit");
      assert.ok(frozen.value.params !== null && typeof frozen.value.params === "object" && !Array.isArray(frozen.value.params));
      assert.equal(frozen.value.params.candidate, candidate);
    }
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("018. A same-key review.revise retry replays one derived publication request and never republishes", async () => {
  const root = scratch(), candidate = "a".repeat(40), base = "b".repeat(40), key = "r".repeat(90);
  const name = "merge-00000002-0000-4000-8000-000000000000";
  const revise = { kind: "review.revise" as const, name, expectedRevision: 0, base, candidate, reason: "r" };
  const first: { method: string; request: string | undefined }[] = [];
  try {
    installRuntime({ ...CLIENT_RUNTIME, resolveOid: value => value, recordedBase: () => base, workspaceDirty: () => false,
      submit: () => ({ exportRef: "refs/oma/export/local", prerequisites: [], content: Buffer.from("bundle") }),
      channel: () => ({ connect: async () => {}, close() {},
        call: async (method, _params, options) => {
          first.push({ method, request: options?.request });
          if (method === "git.known") return { ok: true, result: { hasCandidate: false, prerequisites: [] } };
          return { ok: true, result: { operation, state: "pending" } };
        } }) });
    const pending = JSON.parse(await new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_ACTOR: "alice" } })
      .controlReview(revise, key));
    assert.equal(pending.request, key);
    assert.equal(pending.phase, "candidate-publication");
    assert.equal(pending.receipt.state, "pending");
    const publication = pending.operationRequest as string;
    assert.ok(isValidRequestKey(publication), `the derived publication request must fit the wire grammar: ${publication}`);
    assert.notEqual(publication, key);
    assert.deepEqual(first.map(row => row.method), ["git.known", "git.submit"]);
    assert.equal(first[1]!.request, publication);
    // A restarted client retrying the same key must look up the same derived
    // publication request and reuse its receipt instead of publishing again.
    const retry: { method: string; request: string | undefined; params: Record<string, unknown> }[] = [];
    installRuntime({ ...CLIENT_RUNTIME, resolveOid: () => { throw new Error("a replay resolves no revision"); }, recordedBase: () => base, workspaceDirty: () => false,
      submit: () => { throw new Error("a replay rebuilds no bundle"); },
      channel: () => ({ connect: async () => {}, close() {},
        call: async (method, params, options) => {
          retry.push({ method, request: options?.request, params: params as Record<string, unknown> });
          const asked = typeof params.key === "string" ? params.key : null;
          if (method === "operation.get") return { ok: true, result: asked === publication
            ? { operation, state: "succeeded", result: { kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${operation}`, message, recipientCount: 1 } }
            : receiptNotFound };
          if (method === "git.known") return { ok: true, result: { hasCandidate: false, prerequisites: [] } };
          return { ok: true, result: { operation, state: "succeeded",
            result: { kind: "attest.record", request: name, messages: [message], recipientCount: 1 } } };
        } }) });
    const done = JSON.parse(await new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_ACTOR: "alice" } })
      .controlReview(revise, key));
    assert.equal(done.request, key);
    assert.equal(done.receipt.state, "succeeded");
    assert.deepEqual(retry.map(row => row.method), ["operation.get", "git.known", "operation.get", "attest.record"],
      "the retry looks the publication up; it never submits the candidate a second time");
    assert.equal(retry[0]!.params.key, key);
    assert.equal(retry[2]!.params.key, publication, "the retry addressed the same derived publication request");
    assert.equal(retry[3]!.request, key);
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("019. Distinct original requests sharing a 95-character prefix publish under distinct derived requests", async () => {
  const root = scratch(), base = "b".repeat(40), name = "merge-00000002-0000-4000-8000-000000000000";
  const first = "a".repeat(40), second = "c".repeat(40), prefix = "s".repeat(95);
  const sent: { method: string; request: string | undefined; params: Record<string, unknown> }[] = [];
  const peer = (candidate: string): typeof CLIENT_RUNTIME.channel => () => ({ connect: async () => {}, close() {},
    call: async (method, params, options) => {
      sent.push({ method, request: options?.request, params: params as Record<string, unknown> });
      if (method === "git.known") return { ok: true, result: { hasCandidate: false, prerequisites: [] } };
      if (method === "git.submit") return { ok: true, result: { operation, state: "succeeded",
        result: { kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${operation}`, message, recipientCount: 1 } } };
      return { ok: true, result: { operation, state: "succeeded",
        result: { kind: "attest.record", request: name, messages: [message], recipientCount: 1 } } };
    } });
  const run = (candidate: string, key: string) => {
    installRuntime({ ...CLIENT_RUNTIME, resolveOid: value => value, recordedBase: () => base, workspaceDirty: () => false,
      submit: () => ({ exportRef: "refs/oma/export/local", prerequisites: [], content: Buffer.from("bundle") }), channel: peer(candidate) });
    return new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_ACTOR: "alice" } })
      .controlReview({ kind: "review.revise", name, expectedRevision: 0, base, candidate, reason: "r" }, key);
  };
  try {
    await run(first, `${prefix}1`);
    await run(second, `${prefix}2`);
    const submits = sent.filter(row => row.method === "git.submit");
    assert.equal(submits.length, 2, "the second original request must publish its own candidate");
    const [publicationA, publicationB] = submits.map(row => row.request!);
    assert.ok(isValidRequestKey(publicationA!) && isValidRequestKey(publicationB!));
    assert.notEqual(publicationA, publicationB, "two original requests sharing a 95-character prefix must not share a publication request");
    assert.deepEqual(submits.map(row => row.params.candidate), [first, second]);
    const cache = new RequestCache(root);
    const frozenA = cache.read(publicationA), frozenB = cache.read(publicationB);
    assert.equal(frozenA.kind, "present");
    assert.equal(frozenB.kind, "present");
    if (frozenA.kind === "present" && frozenB.kind === "present") {
      assert.ok(frozenA.value.params !== null && typeof frozenA.value.params === "object" && !Array.isArray(frozenA.value.params));
      assert.ok(frozenB.value.params !== null && typeof frozenB.value.params === "object" && !Array.isArray(frozenB.value.params));
      assert.equal(frozenA.value.params.candidate, first);
      assert.equal(frozenB.value.params.candidate, second);
    }
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("020. A maximum-length merge.open key publishes through the same derived request instead of refusing", async () => {
  const root = scratch(), candidate = "a".repeat(40), base = "b".repeat(40), key = "o".repeat(96);
  const name = "merge-00000002-0000-4000-8000-000000000000";
  const sent: { method: string; request: string | undefined; params: Record<string, unknown> }[] = [];
  installRuntime({ ...CLIENT_RUNTIME, resolveOid: value => value, recordedBase: () => base, workspaceDirty: () => false,
    submit: () => ({ exportRef: "refs/oma/export/local", prerequisites: [], content: Buffer.from("bundle") }),
    channel: () => ({ connect: async () => {}, close() {},
      call: async (method, params, options) => {
        sent.push({ method, request: options?.request, params: params as Record<string, unknown> });
        if (method === "git.known") return { ok: true, result: { hasCandidate: false, prerequisites: [] } };
        if (method === "git.submit") return { ok: true, result: { operation, state: "succeeded",
          result: { kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${operation}`, message, recipientCount: 1 } } };
        return { ok: true, result: { operation, state: "succeeded",
          result: { kind: "attest.record", request: name, messages: [message], recipientCount: 1 } } };
      } }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket"), OMA_ACTOR: "alice" } });
    const text = await client.openMerge({ tier: "LOW", title: "t", reason: "r", candidate, base }, key);
    assert.deepEqual(sent.map(row => row.method), ["git.known", "git.submit", "attest.record"]);
    assert.ok(isValidRequestKey(sent[1]!.request!), `the derived publication request must fit the wire grammar: ${sent[1]!.request!}`);
    assert.equal(sent[2]!.request, key, "the open itself keeps the caller's request key");
    assert.equal(JSON.parse(text).request, key);
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});
