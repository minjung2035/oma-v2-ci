/** Original Store/Mail/protected-cache facts and production receipt projection.
 * Supplied authentication/selection are fixture ports, not SDK/kernel qualification. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import type { AuthContext } from "@oma/contracts";
import { mailAttachmentRootId } from "@oma/domain/derived";
import { snapshotJson } from "@oma/domain/canonical-json";
import { collaborationInlineParameters } from "@oma/domain/collaboration-inputs";
import { collaborationRecordRootPathAt } from "@oma/domain/paths";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ResidentLogStore } from "@oma/storage/resident-logs";
import { terminalFailure } from "@oma/domain/errors";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { RequestCache } from "#oma-test/app/request-cache";
import { HostInvocations } from "#oma-test/app/runtime/host-invocations";
import { collaborationSocietyBirth, newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { CollaborationReceiptViews } from "#oma-test/app/views/collaboration-receipts";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { removeTree } from "./fixtures/cleanup.js";

async function fixture(t: TestContext, refused = false) {
  const parent = fs.mkdtempSync(join(tmpdir(), "oma-receipt-record-")), root = join(parent, "demo"); fs.mkdirSync(root);
  publishSessionBirth(root, newSessionBirth(root, "society", parent));
  const store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
  t.after(() => { store.close(); removeTree(parent); });
  store.transaction(tx => { for (const name of ["alice", "bob", "principal"]) tx.insertAgent(makeValidAgent(name)); });
  const auth: AuthContext = { actor: "alice", role: "resident", incarnation: 1, channel: "actor", capabilities: new Set(["mail.send"]),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  const cache = new RequestCache(join(root, "host-invocations/alice")).prepare();
  const args = { to: ["bob"], subject: "Exact receipt", content: { kind: "text", value: "\ufeffexact original\r\n\n" } };
  const origin = { societyBirth: collaborationSocietyBirth(root, "demo", store.getAgent("principal")), actor: "alice",
    session: "receipt-session", branch: "receipt-assistant", toolCall: "receipt-call" };
  let binding = cache.bindInvocation(origin, "oma_send", "mail.send", args);
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 16, 24, TEST_PROTOCOL_LIMITS);
  if (refused) binding = cache.rejectInvocation(binding.key, { proof: "protected-invocation-closed-before-send", source: "host-preflight",
    reason: "NEEDS_OPERATOR", failure: terminalFailure("UNSUPPORTED_PROFILE"), observedAtMs: binding.createdAtMs + 1 }, () => {
    assert.equal(store.getOperation("alice", binding.key), null); return undefined;
  });
  else {
    const normalized = collaborationInlineParameters("oma_send", args, { society: "demo", role: "resident" });
    const input = decodeMutationPayload("mail.send", normalized.params); assert.ok(input.collaboration);
    const params = { ...input, collaboration: { ...input.collaboration, freeze: { version: "mail-root-v1" as const,
      operation: mailAttachmentRootId("alice", binding.key), dateMs: Math.floor(binding.createdAtMs / 1000) * 1000 } } };
    cache.freezeInvocation({ key: binding.key, method: "mail.send", params: snapshotJson(params), createdAtMs: binding.createdAtMs });
    cache.markInvocationSending(binding.key);
    binding = cache.recordInvocationReceipt(binding.key, await mail.send(auth, binding.key, params));
  }
  const host = new HostInvocations(store, root, "demo", () => true, 1024 * 1024);
  const records = collaborationRecordRootPathAt(root, "alice"), at = "2026-11-01T00:00:00.000Z";
  const publish = () => new CollaborationReceiptViews(store, root).publish(auth, host.records(auth), new Set(), () => false, at);
  return { root, store, cache, binding, auth, records, at, publish };
}
function captureSpool(source: ResidentLogStore) {
  const files = [];
  for (const observation of source.files("alice")) {
    if (observation.kind !== "file") assert.fail("original diagnostic source unavailable");
    const file = observation.file;
    // Consume frames while the original source iterator still holds its owner.
    files.push({ name: file.name, bytes: file.sourceBytes, fingerprint: file.fingerprint, frames: [...file.frames()] });
  }
  return files;
}

test("001. Receipt records: closed-before-send refusal is not an accepted failed operation", async t => {
  const f = await fixture(t, true), original = f.cache.readInvocation(f.binding.key);
  assert.equal(f.publish(), 1);
  const text = fs.readFileSync(join(f.records, "receipts", `${f.binding.key}.md`), "utf8");
  assert.match(text, /^Disposition: refused$/m);
  assert.match(text, /^Acceptance: not-submitted$/m); assert.match(text, /^Execution: not-applicable$/m);
  assert.match(text, /^Original operation: none observed$/m);
  assert.equal(f.store.acceptedOperationPage().items.length, 0); assert.deepEqual(f.cache.readInvocation(f.binding.key), original);
  assert.equal(f.cache.read(f.binding.key).kind, "absent");
});

for (const point of ["immutable-observation", "mutable-receipt"] as const) {
  test(`002. Receipt records: actual SIGKILL after ${point} publication preserves canonical facts and same-key fresh-process recovery`, async t => {
    const f = await fixture(t), operation = f.store.getOperation("alice", f.binding.key)!;
    const accepted = f.store.acceptedOperationPage(), deliveries = f.store.deliveriesForOperation(operation.id);
    const binding = f.cache.readInvocation(f.binding.key), frozen = f.cache.read(f.binding.key);
    const paths = {
      receipt: new URL("../../apps/oma/dist/views/collaboration-receipts.js", import.meta.url).href,
      host: new URL("../../apps/oma/dist/runtime/host-invocations.js", import.meta.url).href,
    };
    const child = `import fs from "node:fs"; import { join } from "node:path"; import { syncBuiltinESMExports } from "node:module";
      import { Store } from "@oma/storage"; import { collaborationRecordRootPathAt } from "@oma/domain/paths";
      const [root, key, encoded, modules, point] = process.argv.slice(1), auth = JSON.parse(encoded), paths = JSON.parse(modules);
      const { CollaborationReceiptViews } = await import(paths.receipt), { HostInvocations } = await import(paths.host);
      auth.capabilities = new Set(auth.capabilities);
      const store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      const records = collaborationRecordRootPathAt(root, "alice"), directory = point === "immutable-observation" ? join(records, "receipts/observations") : join(records, "receipts");
      const fsync = fs.fsyncSync;
      if (point) { fs.fsyncSync = fd => {
        fsync(fd); const stat = fs.fstatSync(fd); if (!stat.isDirectory() || !fs.existsSync(directory)) return;
        const target = fs.statSync(directory); if (stat.ino !== target.ino || stat.dev !== target.dev) return;
        const published = point === "immutable-observation" ? fs.readdirSync(directory).some(name => /^[a-f0-9]{64}\\.json$/u.test(name)) : fs.existsSync(join(directory, key + ".md"));
        if (published) { fs.writeSync(1, point); process.kill(process.pid, "SIGKILL"); }
      }; syncBuiltinESMExports(); }
      try {
        const host = new HostInvocations(store, root, "demo", () => true, 1024 * 1024);
        const count = new CollaborationReceiptViews(store, root).publish(auth, host.records(auth), new Set(), () => false, "2026-11-01T00:00:00.000Z");
        fs.writeSync(1, JSON.stringify({ count }));
      } finally { store.close(); }`;
    const encoded = JSON.stringify({ ...f.auth, capabilities: [...f.auth.capabilities] });
    const run = (stop: string) => spawnSync(process.execPath, ["--input-type=module", "--eval", child, f.root, f.binding.key, encoded, JSON.stringify(paths), stop],
      { encoding: "utf8", timeout: 30_000 });
    const killed = run(point);
    assert.ifError(killed.error); assert.equal(killed.status, null, killed.stderr); assert.equal(killed.signal, "SIGKILL", killed.stderr); assert.equal(killed.stdout, point);
    assert.equal(fs.existsSync(join(f.records, "receipts/index.md")), false, "discovery cannot precede this invocation's dependencies");
    for (let retry = 0; retry < 2; retry++) {
      const restarted = run(""); assert.ifError(restarted.error); assert.equal(restarted.status, 0, restarted.stderr); assert.equal(restarted.signal, null);
      assert.deepEqual(JSON.parse(restarted.stdout), { count: 1 });
    }
    const status = fs.readFileSync(join(f.records, "receipts", `${f.binding.key}.md`), "utf8");
    assert.match(status, /^Acceptance: accepted$/m); assert.match(status, /^Execution: succeeded$/m);
    assert.match(status, new RegExp(`^Original operation: ${operation.id}$`, "m"));
    const observations = fs.readdirSync(join(f.records, "receipts/observations")).filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
    assert.equal(observations.length, 1);
    const evidence = JSON.parse(fs.readFileSync(join(f.records, "receipts/observations", observations[0]!), "utf8"));
    assert.deepEqual(evidence.receipt, f.binding.receipt); assert.equal(evidence.invocation.key, f.binding.key);
    assert.deepEqual(f.store.getOperation("alice", f.binding.key), operation); assert.deepEqual(f.store.acceptedOperationPage(), accepted);
    assert.deepEqual(f.store.deliveriesForOperation(operation.id), deliveries); assert.ok(deliveries.every(row => row.acknowledged === 0 && row.presented === 0));
    assert.deepEqual(f.cache.readInvocation(f.binding.key), binding); assert.deepEqual(f.cache.read(f.binding.key), frozen);
  });
}

for (const point of ["segment-bytes", "segment-manifest", "source-status", "log-discovery"] as const) {
  test(`003. Diagnostic records: actual SIGKILL after ${point} preserves accepted receipt and original spool through fresh-process recovery`, async t => {
    const f = await fixture(t), bytes = Buffer.from("\ufeffexact diagnostic\r\n"), invocationId = "a".repeat(32);
    const spool = new ResidentLogStore(f.root), writer = spool.open("alice", invocationId, 1000);
    writer.append({ actor: "alice", invocationId, incarnation: 1, atMs: 1001, stream: "stdout", bytes }); writer.close();
    const sourceFiles = captureSpool(spool);
    const accepted = f.store.acceptedOperationPage(), operation = f.store.getOperation("alice", f.binding.key)!;
    const deliveries = f.store.deliveriesForOperation(operation.id), binding = f.cache.readInvocation(f.binding.key), frozen = f.cache.read(f.binding.key);
    const script = `import fs from "node:fs"; import { join } from "node:path"; import { syncBuiltinESMExports } from "node:module";
      import { Store } from "@oma/storage"; import { ResidentLogStore } from "@oma/storage/resident-logs";
      import { collaborationRecordRootPathAt } from "@oma/domain/paths";
      const [root, encoded, module, point, expected, hash] = process.argv.slice(1), auth = JSON.parse(encoded), bytes = Buffer.from(expected, "base64");
      auth.capabilities = new Set(auth.capabilities);
      const { CollaborationLogViews } = await import(module), store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      const records = collaborationRecordRootPathAt(root, "alice"), source = new ResidentLogStore(root), fsync = fs.fsyncSync;
      const same = (stat, path) => { if (!fs.existsSync(path)) return false; const other = fs.statSync(path); return stat.ino === other.ino && stat.dev === other.dev; };
      if (point) { fs.fsyncSync = fd => {
        fsync(fd); const stat = fs.fstatSync(fd); if (!stat.isDirectory()) return;
        let hit = false;
        if (point === "source-status") {
          const directory = join(records, "logs/alice/sources"); hit = same(stat, directory) && fs.readdirSync(directory).some(name => name.endsWith(".md"));
        } else if (point === "log-discovery") hit = same(stat, join(records, "logs")) && fs.existsSync(join(records, "logs/index.md"));
        else {
          const segments = join(records, "logs/alice/segments");
          if (fs.existsSync(segments)) for (const prefix of fs.readdirSync(segments)) {
            const directory = join(segments, prefix); if (!same(stat, directory)) continue;
            hit = fs.readdirSync(directory).some(name => {
              if (point === "segment-bytes") return name.endsWith(".log") && fs.readFileSync(join(directory, name)).equals(bytes);
              if (!name.endsWith(".json")) return false; const evidence = JSON.parse(fs.readFileSync(join(directory, name), "utf8"));
              return evidence.outputSha256 === hash && evidence.stream === "stdout" && evidence.invocation === "a".repeat(32);
            });
          }
        }
        if (hit) { fs.writeSync(1, point); process.kill(process.pid, "SIGKILL"); }
      }; syncBuiltinESMExports(); }
      try { const result = new CollaborationLogViews(store, root, actor => source.files(actor)).publish(auth, "2026-11-01T00:00:00.000Z"); fs.writeSync(1, JSON.stringify(result)); }
      finally { store.close(); }`;
    const module = new URL("../../apps/oma/dist/views/collaboration-logs.js", import.meta.url).href;
    const encoded = JSON.stringify({ ...f.auth, capabilities: [...f.auth.capabilities] });
    const run = (stop: string) => spawnSync(process.execPath, ["--input-type=module", "--eval", script, f.root, encoded, module, stop, bytes.toString("base64"), sha256Hex(bytes)],
      { encoding: "utf8", timeout: 30_000 });
    const killed = run(point); assert.ifError(killed.error); assert.equal(killed.status, null, killed.stderr); assert.equal(killed.signal, "SIGKILL", killed.stderr); assert.equal(killed.stdout, point);
    assert.equal(fs.existsSync(join(f.records, "logs/index.md")), point === "log-discovery");
    let previous: unknown = null;
    for (let retry = 0; retry < 2; retry++) {
      const restarted = run(""); assert.ifError(restarted.error); assert.equal(restarted.status, 0, restarted.stderr); assert.equal(restarted.signal, null);
      const result = JSON.parse(restarted.stdout); assert.equal(result.files, 1); assert.equal(result.unavailable, 0); assert.equal(result.incomplete, 0); assert.ok(result.segments > 0);
      if (previous !== null) assert.deepEqual(result, previous); previous = result;
    }
    const manifests: string[] = [], segments = join(f.records, "logs/alice/segments");
    for (const prefix of fs.readdirSync(segments)) for (const name of fs.readdirSync(join(segments, prefix)))
      if (name.endsWith(".json")) manifests.push(join(segments, prefix, name));
    const matching = manifests.filter(path => JSON.parse(fs.readFileSync(path, "utf8")).outputSha256 === sha256Hex(bytes)); assert.equal(matching.length, 1);
    const path = matching[0]!, evidence = JSON.parse(fs.readFileSync(path, "utf8"));
    assert.equal(evidence.actor, "alice"); assert.equal(evidence.invocation, invocationId); assert.equal(evidence.incarnation, 1); assert.equal(evidence.stream, "stdout");
    assert.deepEqual(fs.readFileSync(path.slice(0, -5) + ".log"), bytes);
    assert.deepEqual(captureSpool(spool), sourceFiles);
    assert.deepEqual(f.store.acceptedOperationPage(), accepted); assert.deepEqual(f.store.getOperation("alice", f.binding.key), operation);
    assert.deepEqual(f.store.deliveriesForOperation(operation.id), deliveries); assert.deepEqual(f.cache.readInvocation(f.binding.key), binding); assert.deepEqual(f.cache.read(f.binding.key), frozen);
    assert.equal(f.publish(), 1, "the independent original receipt still projects from its unchanged owners");
  });
}
