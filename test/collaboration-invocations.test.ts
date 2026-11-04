import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RequestCache } from "#oma-test/app/request-cache";
import { CLIENT_RUNTIME } from "#oma-test/app/runtime/client-runtime";
import { invocationKey, type InvocationIdentity } from "#oma-test/app/runtime/invocation-codec";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { RequestService, type RequestOptions, type RequestCall } from "@oma/client/request-service";
import { ClientError } from "@oma/client/errors";
import { installRuntime } from "@oma/client/runtime";
import { Store } from "@oma/storage";
import type { AuthContext, MailInput } from "@oma/contracts";
import { StoreError, publicFailure, terminalFailure } from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { removeTree } from "./fixtures/cleanup.js";
import { sha256Hex } from "@oma/domain/canonical-json";
import { exportRefForRequestKey } from "@oma/domain/derived";
import { submissionPublicationKey } from "@oma/protocol/invocation-submission";

installRuntime(CLIENT_RUNTIME);
const identity: InvocationIdentity = { societyBirth: "birth-demo", actor: "alice", session: "original-session", branch: "assistant-entry", toolCall: "call-1" };
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-invocation-"));
  const home = join(root, "host-private", "alice");
  const source = join(root, "workspace", "message.txt");
  fs.mkdirSync(join(root, "workspace"));
  fs.writeFileSync(source, "\ufeffexact body\r\n\n");
  const store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
  store.transaction(tx => { for (const name of ["alice", "bob"]) tx.insertAgent(makeValidAgent(name)); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 16, 24, TEST_PROTOCOL_LIMITS);
  const auth: AuthContext = { actor: "alice", role: "resident", incarnation: 1, channel: "actor", capabilities: new Set(["mail.send"]),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  const control = { dropBefore: false, dropAfter: false, lookupUnavailable: false, builds: 0, sends: 0, lookups: 0 };
  const call: RequestCall = async (method, params, key) => {
    if (method === "operation.get") {
      control.lookups++;
      if (control.lookupUnavailable) throw new Error("lookup unavailable");
      const operation = store.getOperation("alice", String(params.key));
      return operation === null ? [{ ok: false, error: publicFailure(new StoreError("REQUEST_NOT_FOUND", "original request absent")) }]
        : [{ ok: true, result: receiptOfOperation(operation) }];
    }
    assert.equal(method, "mail.send");
    assert.ok(key);
    const observed = new RequestCache(home).readInvocation(key);
    assert.equal(observed.kind, "present");
    if (observed.kind === "present") assert.equal(observed.value.phase, "sending", "marker precedes transport");
    control.sends++;
    if (control.dropBefore) throw new Error("transport failed before acceptance");
    const receipt = await mail.send(auth, key, params as unknown as MailInput);
    if (control.dropAfter) { control.lookupUnavailable = true; throw new Error("accepted answer was lost"); }
    return [{ ok: true, result: receipt }];
  };
  const args = { to: ["bob"], content: { kind: "file", value: source } };
  const options = (cache: RequestCache, key: string): RequestOptions => cache.invocationOptions(key);
  const invoke = async (origin: InvocationIdentity = identity, raw = args) => {
    const cache = new RequestCache(home).prepare();
    const binding = cache.bindInvocation(origin, "oma_send", "mail.send", raw);
    return new RequestService(cache, call).requestReceipt("mail.send", binding.key, () => {
      control.builds++;
      return { method: "mail.send", params: { to: [...raw.to], kind: "message", subject: "exact", body: fs.readFileSync(source, "utf8") } };
    }, () => ({}), options(cache, binding.key));
  };
  t.after(() => { store.close(); removeTree(root); });
  return { root, home, source, store, mail, control, call, args, options, invoke, cache: () => new RequestCache(home).prepare() };
}

test("001. Invocation: original call survives a lost accepted answer, while a later successful identical intent is new", async t => {
  const f = fixture(t);
  f.control.dropAfter = true;
  await assert.rejects(f.invoke(), /Acceptance status unknown/);
  const key = invocationKey(identity);
  const operation = f.store.getOperation("alice", key)!;
  assert.ok(operation);
  assert.equal(f.cache().pendingInvocations().length, 1);
  fs.writeFileSync(f.source, "changed mutable input");
  f.control.lookupUnavailable = false;
  const recovered = await f.invoke();
  assert.equal(recovered.operation, operation.id);
  assert.equal(operation.kind, "mail.send");
  if (operation.kind === "mail.send") {
    const delivery = f.store.deliveriesForOperation(operation.id);
    const original = f.mail.readRecord("bob", operation.plan.message.id);
    assert.equal(original.state, "published");
    if (original.state === "published") assert.equal(original.record.body, "\ufeffexact body\r\n\n");
    assert.deepEqual(f.store.deliveriesForOperation(operation.id), delivery, "reading the exact body does not acknowledge or settle delivery");
  }
  assert.equal(f.control.builds, 1);
  assert.equal(f.control.sends, 1);
  assert.equal(f.cache().pendingInvocations().length, 0);
  f.control.dropAfter = false;
  const next = await f.invoke({ ...identity, toolCall: "call-2" });
  assert.notEqual(next.operation, recovered.operation);
  assert.equal(f.control.sends, 2, "successful content is not permanently deduplicated");
  assert.equal(f.store.acceptedOperationPage().items.length, 2);
});

test("002. Invocation: unknown send fences another key and changed wording; original absence resends only the original freeze", async t => {
  const f = fixture(t);
  f.control.dropBefore = true;
  await assert.rejects(f.invoke(), /Acceptance status unknown/);
  const key = invocationKey(identity);
  fs.writeFileSync(f.source, "not the frozen body");
  await assert.rejects(f.invoke({ ...identity, toolCall: "call-2" }, { ...f.args, to: ["bob", "alice"] }), /unresolved; no new execution/);
  assert.equal(f.control.sends, 1);
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
  f.control.dropBefore = false;
  const receipt = await f.invoke();
  const operation = f.store.getOperation("alice", key)!;
  assert.equal(receipt.operation, operation.id);
  assert.equal(f.control.builds, 2, "blocked new invocation prepared once; original was not rebuilt");
  const cached = f.cache().read(key);
  assert.equal(cached.kind, "present");
  if (cached.kind === "present") assert.equal((cached.value.params as { body: string }).body, "\ufeffexact body\r\n\n");
  assert.equal(f.control.sends, 2);
});

test("003. Invocation: arguments and tool changes under one call cannot escape to another key", async t => {
  const f = fixture(t);
  const cache = f.cache();
  const original = cache.bindInvocation(identity, "oma_send", "mail.send", f.args);
  assert.equal(cache.bindInvocation(identity, "oma_send", "mail.send", f.args).key, original.key);
  assert.throws(() => cache.bindInvocation(identity, "oma_send", "mail.send", { ...f.args, urgent: true }), /different tool or arguments/);
  assert.throws(() => cache.bindInvocation(identity, "oma_spawn", "agent.create", { name: "child", from: "a".repeat(40), brief: { kind: "text", value: "original task" } }), /different tool or arguments/);
  assert.notEqual(invocationKey({ ...identity, actor: "bob" }), original.key);
  assert.notEqual(invocationKey({ ...identity, societyBirth: "other-birth" }), original.key);
  assert.notEqual(invocationKey({ ...identity, branch: "other-assistant" }), original.key);
  assert.throws(() => cache.bindInvocation({ ...identity, actor: "principal" }, "oma_spawn", "agent.create", {}), /tool\/role/);
});

test("004. Invocation: missing completed freeze cannot invoke a source builder or publish replacement metadata", async t => {
  const f = fixture(t);
  f.control.dropBefore = true;
  await assert.rejects(f.invoke(), /Acceptance status unknown/);
  const key = invocationKey(identity);
  const path = f.cache().bodyPath(key).replace(/\.body$/, ".json");
  fs.unlinkSync(path);
  fs.writeFileSync(f.source, "new source must not be frozen");
  await assert.rejects(f.invoke(), /no source reconstruction permitted/);
  assert.equal(f.control.builds, 1);
  assert.equal(f.control.sends, 1);
  assert.equal(fs.existsSync(path), false);
});

test("005. Invocation: corrupted frozen input refuses resend but does not prevent canonical original-receipt observation", async t => {
  const f = fixture(t);
  f.control.dropBefore = true;
  await assert.rejects(f.invoke(), /Acceptance status unknown/);
  const key = invocationKey(identity);
  const cache = f.cache();
  const frozen = cache.read(key);
  assert.equal(frozen.kind, "present");
  if (frozen.kind !== "present") return;
  const changed = { ...frozen.value, params: { ...(frozen.value.params as object), body: "different bytes" } };
  fs.writeFileSync(cache.bodyPath(key).replace(/\.body$/, ".json"), JSON.stringify(changed));
  f.control.dropBefore = false;
  await assert.rejects(f.invoke(), /freeze identity changed/);
  assert.equal(f.control.sends, 1);
  assert.equal(f.control.builds, 1);
  fs.writeFileSync(cache.bodyPath(key).replace(/\.body$/, ".json"), JSON.stringify(frozen.value));
  f.control.dropAfter = true;
  f.control.lookupUnavailable = false;
  await assert.rejects(f.invoke(), /Acceptance status unknown/);
  fs.writeFileSync(cache.bodyPath(key).replace(/\.body$/, ".json"), "corrupt");
  f.control.lookupUnavailable = false;
  const replies = await f.call("operation.get", { key });
  assert.equal(replies[0]?.ok, true);
  if (!replies[0]?.ok) return;
  const canonical = receiptOfOperation(f.store.getOperation("alice", key)!);
  cache.recordInvocationReceipt(key, canonical);
  assert.equal(cache.pendingInvocations().length, 0);
  assert.equal(cache.read(key).kind, "corrupt", "observation never reconstructs frozen input");
});

test("006. Invocation: accepted receipt contradictions remain fenced and cannot replace the original observation", async t => {
  const f = fixture(t);
  const receipt = await f.invoke();
  const key = invocationKey(identity);
  assert.throws(() => f.cache().markInvocationSending(key), /already observed original receipt/);
  const conflicting = { operation: receipt.operation, state: "failed", error: terminalFailure("INTEGRATION_CONDITIONS") };
  assert.throws(() => f.cache().recordInvocationReceipt(key, conflicting as typeof receipt), /contradict/);
  const result = receipt.result;
  assert.equal(result?.kind, "mail.send");
  if (result?.kind !== "mail.send") return;
  assert.throws(() => f.cache().recordInvocationReceipt(key, { ...receipt, result: { ...result,
    recipientCount: result.recipientCount + 1 } }), /contradict/);
  assert.throws(() => f.cache().recordInvocationReceipt(key, { operation: receipt.operation, state: "unknown" }), /contradict/);
  assert.deepEqual(f.cache().recordInvocationReceipt(key, receipt).receipt, receipt, "identical terminal reobservation is not corruption");
  const binding = f.cache().readInvocation(key);
  assert.equal(binding.kind, "present");
  if (binding.kind === "present") assert.deepEqual(binding.value.receipt, receipt);
});

function compoundMetadataFixture(t: TestContext) {
  const f = fixture(t), cache = f.cache(), bundle = Buffer.from("original frozen bundle bytes");
  const candidate = "b".repeat(40), base = "a".repeat(40), reason = "Original submission reason", title = "Original change";
  const binding = cache.bindInvocation({ ...identity, toolCall: "call-submission" }, "oma_merge", "attest.record", { change: { candidate, base }, reason, tier: "LOW", title });
  const child = submissionPublicationKey(binding.key), digest = { bytes: bundle.byteLength, sha256: sha256Hex(bundle) };
  const input = { key: binding.key, method: "attest.record" as const, createdAtMs: binding.createdAtMs, digest,
    params: { kind: "collaboration.submission", review: { kind: "merge.open", candidate, base, reason, tier: "LOW", title },
      publication: { key: child, params: { candidate, to: ["alice"], subject: title, body: reason, paths: [],
        exportRef: exportRefForRequestKey(child), prerequisites: [], bundle: { mediaType: "application/x-git-bundle", ...digest } } } } };
  cache.freezeInvocation(input, bundle);
  const sending = cache.markInvocationSending(binding.key), frozen = cache.read(binding.key);
  assert.ok(frozen.kind === "present");
  return { f, cache, binding, digest, input, sending, frozen: frozen.value };
}

/** Observe only this test's actual metadata inode/parent; never choose an effect path from an FD spelling. */
function metadataPublicationPoint(fd: number, directory: string, key: string): string | null {
  const stat = fs.fstatSync(fd), parent = fs.statSync(directory);
  if (stat.isDirectory() && stat.ino === parent.ino && stat.dev === parent.dev && fs.existsSync(join(directory, `${key}.json`)))
    return "published-directory-flush";
  if (stat.isFile() && fs.readdirSync(directory).some(name => {
    if (!name.startsWith(`.${key}.json.`) && name !== `${key}.json`) return false;
    const entry = fs.statSync(join(directory, name)); return entry.ino === stat.ino && entry.dev === stat.dev;
  })) return "metadata-file-flush";
  return null;
}

function metadataHandoffChildScript(): string {
  return `import fs from "node:fs"; import { join } from "node:path"; import { syncBuiltinESMExports } from "node:module";
    const [module, home, encoded, point] = process.argv.slice(1), input = JSON.parse(encoded);
    const { RequestCache } = await import(module), cache = new RequestCache(home), directory = join(home, ".local/state/oma/requests");
    const observe = ${metadataPublicationPoint.toString()}, fsync = fs.fsyncSync;
    const kill = () => { fs.writeSync(1, point); process.kill(process.pid, "SIGKILL"); };
    if (point) { fs.fsyncSync = fd => {
      if (point === "before-published-directory-flush" && observe(fd, directory, input.key) === "published-directory-flush") kill();
      fsync(fd); if (observe(fd, directory, input.key) === point) kill();
    }; syncBuiltinESMExports(); }
    const result = cache.restorePublishedSubmissionMetadata(input); fs.writeSync(1, JSON.stringify(result.value));`;
}

test("007. Metadata handoff: a competing publisher killed after link cannot bypass the post-observation durability barrier", t => {
  const { f, cache, binding, digest, input, sending, frozen } = compoundMetadataFixture(t);
  fs.unlinkSync(cache.bodyPath(binding.key));
  const home = join(f.root, "caller-home"); new RequestCache(home).prepare();
  const directory = join(home, ".local/state/oma/requests"), expected = `${binding.key}.json`;
  const module = new URL("../../apps/oma/dist/request-cache.js", import.meta.url).href;
  let observed = false, faulted = false;
  const local = new RequestCache(home, path => {
    assert.equal(path, join(directory, expected)); assert.equal(observed, false);
    // This writer links only AFTER the reader's prepare() barrier has completed.
    const killed = spawnSync(process.execPath, ["--input-type=module", "--eval", metadataHandoffChildScript(), module, home,
      JSON.stringify(input), "before-published-directory-flush"], { encoding: "utf8", timeout: 30_000 });
    assert.ifError(killed.error); assert.equal(killed.status, null); assert.equal(killed.signal, "SIGKILL", killed.stderr);
    assert.equal(killed.stdout, "before-published-directory-flush");
    const bytes = fs.readFileSync(path); observed = true; return { kind: "present", value: bytes };
  });
  const fsync = fs.fsyncSync, parent = fs.statSync(directory);
  t.mock.method(fs, "fsyncSync", (fd: number) => {
    fsync(fd); const stat = fs.fstatSync(fd);
    if (observed && !faulted && stat.isDirectory() && stat.ino === parent.ino && stat.dev === parent.dev) {
      faulted = true; throw Object.assign(new Error("injected post-observation directory flush failure"), { code: "EIO" });
    }
  });
  syncBuiltinESMExports();
  try { assert.throws(() => local.restorePublishedSubmissionMetadata(input), { code: "CACHE_UNAVAILABLE" }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(observed, true); assert.equal(faulted, true);
  assert.deepEqual(new RequestCache(home).restorePublishedSubmissionMetadata(input).value, frozen);
  assert.deepEqual(cache.readInvocation(binding.key), { kind: "present", value: sending });
  assert.equal(new RequestCache(home).readBody(binding.key, digest).kind, "absent");
  assert.equal(new RequestCache(home).readInvocation(binding.key).kind, "absent");
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
});

for (const point of ["metadata-file-flush", "published-directory-flush"]) {
  test(`008. Metadata handoff: ${point} EIO preserves original identity and retry without an obsolete bundle`, t => {
    const { f, cache, binding, digest, input, sending, frozen } = compoundMetadataFixture(t);
    fs.unlinkSync(cache.bodyPath(binding.key));
    const originalPath = cache.bodyPath(binding.key).replace(/\.body$/u, ".json"), originalBytes = fs.readFileSync(originalPath);
    const home = join(f.root, "caller-home"), local = new RequestCache(home).prepare();
    const directory = join(home, ".local/state/oma/requests"), fsync = fs.fsyncSync; let faulted = false;
    t.mock.method(fs, "fsyncSync", (fd: number) => {
      fsync(fd);
      if (!faulted && metadataPublicationPoint(fd, directory, binding.key) === point) {
        faulted = true; throw Object.assign(new Error(`injected ${point} failure`), { code: "EIO" });
      }
    });
    syncBuiltinESMExports();
    try { assert.throws(() => local.restorePublishedSubmissionMetadata(input), { code: "CACHE_UNAVAILABLE" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(faulted, true);
    assert.equal(local.read(binding.key).kind, point === "metadata-file-flush" ? "absent" : "present");
    assert.deepEqual(new RequestCache(home).restorePublishedSubmissionMetadata(input).value, frozen);
    assert.deepEqual(new RequestCache(home).restorePublishedSubmissionMetadata(input).value, frozen);
    assert.deepEqual(fs.readFileSync(originalPath), originalBytes);
    assert.deepEqual(cache.readInvocation(binding.key), { kind: "present", value: sending });
    assert.equal(local.readBody(binding.key, digest).kind, "absent"); assert.equal(cache.readBody(binding.key, digest).kind, "absent");
    assert.equal(local.readInvocation(binding.key).kind, "absent"); assert.equal(f.store.acceptedOperationPage().items.length, 0);
    assert.throws(() => local.prepareReplay(input), /frozen body/);
  });

  test(`009. Metadata handoff: actual SIGKILL at ${point} preserves exact same-key restart without bundle reconstruction`, t => {
    const { f, cache, binding, digest, input, sending, frozen } = compoundMetadataFixture(t);
    fs.unlinkSync(cache.bodyPath(binding.key));
    const originalPath = cache.bodyPath(binding.key).replace(/\.body$/u, ".json"), originalBytes = fs.readFileSync(originalPath);
    const home = join(f.root, "caller-home"); new RequestCache(home).prepare();
    const module = new URL("../../apps/oma/dist/request-cache.js", import.meta.url).href;
    const child = metadataHandoffChildScript();
    const killed = spawnSync(process.execPath, ["--input-type=module", "--eval", child, module, home, JSON.stringify(input), point], { encoding: "utf8", timeout: 30_000 });
    assert.ifError(killed.error); assert.equal(killed.status, null); assert.equal(killed.signal, "SIGKILL", killed.stderr);
    assert.equal(killed.stdout, point);
    const local = new RequestCache(home);
    assert.equal(local.read(binding.key).kind, point === "metadata-file-flush" ? "absent" : "present");
    for (let retry = 0; retry < 2; retry++) {
      const restarted = spawnSync(process.execPath, ["--input-type=module", "--eval", child, module, home, JSON.stringify(input), ""], { encoding: "utf8", timeout: 30_000 });
      assert.ifError(restarted.error); assert.equal(restarted.status, 0, restarted.stderr); assert.equal(restarted.signal, null);
      assert.deepEqual(JSON.parse(restarted.stdout), frozen);
    }
    assert.deepEqual(fs.readFileSync(originalPath), originalBytes);
    assert.deepEqual(cache.readInvocation(binding.key), { kind: "present", value: sending });
    assert.equal(local.readBody(binding.key, digest).kind, "absent"); assert.equal(cache.readBody(binding.key, digest).kind, "absent");
    assert.equal(local.readInvocation(binding.key).kind, "absent"); assert.equal(f.store.acceptedOperationPage().items.length, 0);
    assert.throws(() => local.prepareReplay(input), /frozen body/);
  });
}

for (const state of ["different-date", "corrupt-metadata", "unreadable-metadata", "body-only-orphan"] as const) {
  test(`010. Metadata handoff: ${state} caller evidence is retained, not repaired or promoted to acceptance`, t => {
    const { f, cache, binding, input, sending, frozen } = compoundMetadataFixture(t);
    fs.unlinkSync(cache.bodyPath(binding.key));
    const home = join(f.root, "caller-home"), local = new RequestCache(home).prepare();
    const path = local.bodyPath(binding.key).replace(/\.body$/u, ".json");
    const sentinel = state === "different-date" ? JSON.stringify({ ...frozen, createdAtMs: frozen.createdAtMs + 1 }) : "retained invalid or unreadable metadata";
    const retainedPath = state === "body-only-orphan" ? local.bodyPath(binding.key) : path;
    fs.writeFileSync(retainedPath, sentinel);
    const observed = state === "unreadable-metadata" ? new RequestCache(home, () => ({ kind: "unavailable", reason: "injected metadata read EIO" })) : local;
    const code = state === "different-date" ? "REQUEST_KEY_REUSED" : state === "unreadable-metadata" ? "CACHE_UNAVAILABLE" : "CACHE_CORRUPT";
    assert.throws(() => observed.restorePublishedSubmissionMetadata(input), { code });
    assert.equal(fs.readFileSync(retainedPath, "utf8"), sentinel);
    if (state === "body-only-orphan") assert.equal(fs.existsSync(path), false);
    else assert.equal(fs.existsSync(local.bodyPath(binding.key)), false);
    assert.equal(local.readInvocation(binding.key).kind, "absent");
    assert.deepEqual(cache.readInvocation(binding.key), { kind: "present", value: sending });
    assert.equal(f.store.acceptedOperationPage().items.length, 0);
  });
}

test("011. Invocation cache: original compound metadata handoff neither rebuilds an obsolete bundle nor creates acceptance", t => {
  const { f, cache, binding, digest, input, sending, frozen } = compoundMetadataFixture(t);
  fs.unlinkSync(cache.bodyPath(binding.key));
  const local = new RequestCache(join(f.root, "caller-home"));
  const restored = local.restorePublishedSubmissionMetadata(input);
  assert.deepEqual(restored.value, frozen);
  assert.deepEqual(local.restorePublishedSubmissionMetadata(input).value, frozen);
  assert.equal(local.readBody(binding.key, digest).kind, "absent");
  assert.equal(cache.readBody(binding.key, digest).kind, "absent");
  assert.equal(local.readInvocation(binding.key).kind, "absent", "transport handoff cannot establish original ownership");
  assert.deepEqual(cache.readInvocation(binding.key), { kind: "present", value: sending });
  assert.equal(f.store.acceptedOperationPage().items.length, 0, "copying metadata is not an accepted publication or Review");
  assert.throws(() => local.prepareReplay(input), /frozen body/, "ordinary replay still requires its original bytes");
  assert.throws(() => cache.sealInvocation(binding.key), /frozen body/, "cache state alone cannot declare a publication complete");
  const conflict = { ...restored.value, params: { ...input.params, review: { ...input.params.review, reason: "Changed reason" },
    publication: { ...input.params.publication, params: { ...input.params.publication.params, body: "Changed reason" } } } };
  const path = local.bodyPath(binding.key).replace(/\.body$/u, ".json"), bytes = JSON.stringify(conflict);
  fs.writeFileSync(path, bytes);
  assert.throws(() => local.restorePublishedSubmissionMetadata(input), { code: "REQUEST_KEY_REUSED" });
  assert.equal(fs.readFileSync(path, "utf8"), bytes, "a conflicting caller cache is never repaired by handoff");
});

for (const point of ["bound", "frozen", "sending", "observed"] as const) {
  test(`012. Invocation: interrupted ${point} publication retains the original key for a fresh owner`, async t => {
    const f = fixture(t);
    const fsync = fs.fsyncSync;
    let faulted = false;
    t.mock.method(fs, "fsyncSync", (fd: number) => {
      if (!faulted && fs.fstatSync(fd).isFile()) {
        const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
        if (path.startsWith(f.home)) {
          const body = fs.readFileSync(`/proc/self/fd/${fd}`, "utf8");
          if (body.includes('"version":"collaboration-v1"') && body.includes(`"phase":"${point}"`)) {
            faulted = true;
            throw Object.assign(new Error(`injected ${point} publication failure`), { code: "EIO" });
          }
        }
      }
      fsync(fd);
    });
    syncBuiltinESMExports();
    let failure: unknown;
    try { await f.invoke(); } catch (error) { failure = error; }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.ok(faulted, "actual file fsync fault reached");
    assert.ok(failure);
    const before = f.control.sends;
    assert.equal(before, point === "observed" ? 1 : 0);
    if (point === "observed") {
      assert.ok(failure instanceof ClientError);
      assert.ok(failure.receipt, "known original receipt survives linkage failure");
    }
    const recovered = await f.invoke();
    assert.equal(recovered.operation, f.store.getOperation("alice", invocationKey(identity))!.id);
    assert.equal(f.control.sends, 1);
    assert.equal(f.store.acceptedOperationPage().items.length, 1);
  });
}
