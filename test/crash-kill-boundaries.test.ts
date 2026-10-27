/** P0-7 (R6-08's remainder): the configuration commit and the delivery
 * receipt, stopped by a real SIGKILL at every durability point they pass.
 *
 * Their existing tests throw a DurabilityFaultError inside the test's own
 * process: what runs on the way out still runs. Here a child process runs
 * the boundary and kills itself at the chosen point, so nothing of it runs
 * after -- no finally block, no cleanup -- and the parent reads what is left
 * with the product's own loaders. Not power loss: the page cache survives a
 * process death (validation, "known limitations"). */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreparedBatch } from "@oma/contracts";
import { loadConfiguration, loadConfigurationSnapshot, validateConfig, type ConfigurationSnapshot } from "@oma/config";
import { collectManagedGenerations, commitInlineConfiguration, commitManagedGeneration, managedGenerationOf } from "@oma/config/generations";
import { applyField, commitManagedEdit, readSettings, INITIAL_WORKERS } from "#oma-test/app/application/settings";
import { replaceDerivedFile, type DurabilityFault } from "@oma/storage/durable-fs";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { deliveryDecision, observeDeliveryReceipt, publishDeliveryReceipt, readDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { type DeliveryBoundary } from "@oma/contracts";
import { runnerReceiptPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
import { generateBatchId, generateOperationId } from "@oma/native/identity";
import { messageIdForOperation } from "@oma/domain/derived";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

const TIMEOUT = { timeout: 300_000 };
const moduleUrl = (specifier: string): string => import.meta.resolve(specifier);

/** Runs `body` in a child that is SIGKILLed at its `crash`-th durability
 * point; `body` receives the observer as `faults`. */
function killedAt(crash: number, body: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    let seen = 0;
    const faults = () => { if (seen++ === ${crash}) process.kill(process.pid, "SIGKILL"); };
    ${body}
    process.stdout.write("finished");`], { encoding: "utf8", timeout: 60_000 });
}

/** Publication temporaries anywhere under `root`. */
function temporariesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(directory, entry.name));
      else if (/^\..+\.tmp$/.test(entry.name)) found.push(join(directory, entry.name));
    }
  };
  walk(root);
  return found;
}

const principalModel = (snapshot: ConfigurationSnapshot): string =>
  snapshot.config.agentProfiles[snapshot.config.principalProfile]!.modelProfile;
const withPrincipalModel = (snapshot: ConfigurationSnapshot, model: string) => validateConfig({ ...snapshot.config,
  agentProfiles: { ...snapshot.config.agentProfiles, principal: { ...snapshot.config.agentProfiles.principal!, modelProfile: model } } });

test("V13A / P0-7: a managed commit SIGKILLed at any durability point leaves the complete old or the complete new configuration", TIMEOUT, () => {
  const probe = createCompleteConfigurationFixture();
  const points: DurabilityFault[] = [];
  try {
    const snapshot = loadConfigurationSnapshot(probe.path);
    commitManagedEdit(snapshot, withPrincipalModel(snapshot, "review"), {}, fault => { points.push(fault); });
  } finally { probe.close(); }
  const published = points.findIndex(point => point.point === "derived-rename" && point.phase === "after-visible" && point.path.endsWith("/operations/config.json"));
  assert.ok(points.length >= 10 && published > 0, `durability points: ${points.length}, manifest at ${published}`);
  assert.ok(points.some(point => point.path.endsWith("/committed-v2") && point.point === "file-fsync" && point.phase === "after-visible"),
    "the current journal flush must participate in actual kill injection");
  for (let crash = 0; crash < points.length; crash++) {
    const f = createCompleteConfigurationFixture();
    try {
      const before = loadConfigurationSnapshot(f.path);
      const oldRevision = before.config.integration.policyRevision;
      const run = killedAt(crash, `
        const { loadConfigurationSnapshot, validateConfig } = await import(${JSON.stringify(import.meta.resolve("@oma/config"))});
        const { commitManagedEdit } = await import(${JSON.stringify(moduleUrl("#oma-test/app/application/settings"))});
        const snapshot = loadConfigurationSnapshot(${JSON.stringify(f.path)});
        const principal = snapshot.config.agentProfiles.principal;
        const next = validateConfig({ ...snapshot.config, agentProfiles: { ...snapshot.config.agentProfiles, principal: { ...principal, modelProfile: "review" } } });
        commitManagedEdit(snapshot, next, {}, faults);`);
      const at = `${crash} (${points[crash]!.point}/${points[crash]!.phase})`;
      assert.equal(run.signal, "SIGKILL", `not killed at ${at}: ${String(run.stdout)}${String(run.stderr)}`);
      const after = loadConfigurationSnapshot(f.path);
      const state = principalModel(after) === principalModel(before) && after.config.integration.policyRevision === oldRevision ? "old"
        : principalModel(after) === "review" && after.config.integration.policyRevision !== oldRevision ? "new" : "mixed";
      assert.equal(state, crash >= published ? "new" : "old", `killed at ${at}`);
      // The next start collects what the dead commit left, and an edit from it commits.
      collectManagedGenerations({ layout: after.layout });
      assert.deepEqual(temporariesUnder(f.output), [], `a dead commit's temporary outlived the collection, at ${at}`);
      commitManagedEdit(after, withPrincipalModel(after, state === "new" ? principalModel(before) : "review"));
      assert.doesNotThrow(() => loadConfigurationSnapshot(f.path), `after ${at}`);
    } finally { f.close(); }
  }
});

test("DR46 / P0-7: SIGKILL in a short journal append preserves the manifest and exact candidate retry", TIMEOUT, () => {
  for (const cut of [1, 66, 133, 134]) {
    const f = createCompleteConfigurationFixture();
    try {
      for (const logBytes of [5, 6]) {
        const snapshot = loadConfigurationSnapshot(f.path);
        commitManagedGeneration(snapshot, { config: validateConfig({ ...snapshot.config,
          limits: { ...snapshot.config.limits, logBytes },
          integration: { ...snapshot.config.integration, policyRevision: `journal-${logBytes}` } }) });
      }
      const snapshot = loadConfigurationSnapshot(f.path);
      const previous = managedGenerationOf(snapshot)!;
      const candidate = validateConfig({ ...snapshot.config, limits: { ...snapshot.config.limits, logBytes: 7 },
        integration: { ...snapshot.config.integration, policyRevision: "journal-next" } });
      const journal = join(f.output, ".oma-config", "committed-v2");
      const manifestBytes = readFileSync(f.path), journalBytes = readFileSync(journal);
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import fs from "node:fs";
        import { syncBuiltinESMExports } from "node:module";
        import { loadConfigurationSnapshot, validateConfig } from ${JSON.stringify(import.meta.resolve("@oma/config"))};
        import { commitManagedGeneration } from ${JSON.stringify(import.meta.resolve("@oma/config/generations"))};
        const raw = fs.writeSync; let written = 0;
        fs.writeSync = function (...args) {
          const target = fs.readlinkSync("/proc/self/fd/" + args[0]) === ${JSON.stringify(journal)};
          if (target) args[3] = 1;
          const count = Reflect.apply(raw, fs, args);
          if (target && (written += count) >= ${cut}) process.kill(process.pid, "SIGKILL");
          return count;
        };
        syncBuiltinESMExports();
        commitManagedGeneration(loadConfigurationSnapshot(${JSON.stringify(f.path)}), {
          config: validateConfig(${JSON.stringify(candidate)}) });
      `], { encoding: "utf8", timeout: 60_000 });
      assert.equal(run.signal, "SIGKILL", `${cut}: ${run.stderr}`);
      assert.deepEqual(readFileSync(f.path), manifestBytes, `manifest changed after ${cut} journal bytes`);
      const partial = readFileSync(journal);
      assert.deepEqual(partial.subarray(0, journalBytes.length), journalBytes);
      assert.equal(partial.length, journalBytes.length + cut);
      const reopened = loadConfigurationSnapshot(f.path);
      assert.equal(managedGenerationOf(reopened), previous);
      const committed = commitManagedGeneration(reopened, { config: candidate });
      assert.equal(committed.kind, "committed");
      const after = loadConfigurationSnapshot(f.path);
      assert.deepEqual(after.config, candidate);
      assert.equal(managedGenerationOf(after), committed.generation);
      collectManagedGenerations(after);
      assert.deepEqual(new Set(readdirSync(join(f.output, ".oma-config", "generations"))),
        new Set([previous, committed.generation]), "retry retains the actual rollback predecessor");
    } finally { f.close(); }
  }
});

test("DR12 / P0-7: an inline commit SIGKILLed at any durability point leaves the old file or one the loader loads", TIMEOUT, () => {
  const probe = createCompleteConfigurationFixture();
  const points: DurabilityFault[] = [];
  let limit = 0;
  try {
    const settings = readSettings(probe.input);
    limit = probe.config.initialResidents.length + 1;
    commitInlineConfiguration(settings.snapshot!, validateConfig(applyField(settings, INITIAL_WORKERS, limit)), fault => { points.push(fault); });
  } finally { probe.close(); }
  const renamed = points.findIndex(point => point.point === "derived-rename" && point.phase === "after-visible");
  assert.ok(renamed > 0, "the inline commit has a rename point");
  for (let crash = 0; crash < points.length; crash++) {
    const f = createCompleteConfigurationFixture();
    try {
      const run = killedAt(crash, `
        const { validateConfig } = await import(${JSON.stringify(import.meta.resolve("@oma/config"))});
        const { commitInlineConfiguration } = await import(${JSON.stringify(import.meta.resolve("@oma/config/generations"))});
        const { applyField, readSettings, INITIAL_WORKERS } = await import(${JSON.stringify(moduleUrl("#oma-test/app/application/settings"))});
        const settings = readSettings(${JSON.stringify(f.input)});
        commitInlineConfiguration(settings.snapshot, validateConfig(applyField(settings, INITIAL_WORKERS, ${limit})), faults);`);
      const at = `${crash} (${points[crash]!.point}/${points[crash]!.phase})`;
      assert.equal(run.signal, "SIGKILL", `not killed at ${at}: ${String(run.stdout)}${String(run.stderr)}`);
      assert.equal(loadConfiguration(f.input).config.initialResidents.length, crash >= renamed ? limit : f.config.initialResidents.length, `killed at ${at}`);
      // Its temporary is collected, and the next edit commits.
      collectManagedGenerations({ layout: loadConfigurationSnapshot(f.input).layout });
      assert.deepEqual(temporariesUnder(join(f.input, "..")), [], `a dead commit's temporary outlived the collection, at ${at}`);
      const settings = readSettings(f.input);
      commitInlineConfiguration(settings.snapshot!, validateConfig(applyField(settings, INITIAL_WORKERS, limit + 1)));
      assert.equal(loadConfiguration(f.input).config.initialResidents.length, limit + 1, `after ${at}`);
    } finally { f.close(); }
  }
});

test("DR11 / V05A / P0-7: a receipt publication SIGKILLed at any durability point leaves no receipt or the whole one, and the retry publishes it", TIMEOUT, () => {
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), "oma-receipt-kill-"));
    const operationId = generateOperationId();
    const batch: PreparedBatch = { id: generateBatchId(), agent: "alice", incarnation: 1, messageIds: [messageIdForOperation(operationId, 0)],
      sessionPath: null, deliveryMode: "steer", notice: "fixture", indexPath: "/inbox.md" };
    const sessions = runnerSessionDirPathAt(root, "alice");
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    const sessionPath = join(sessions, "session.jsonl");
    const entry = JSON.stringify({ type: "custom", customType: "oma-delivery-boundary", id: "0123abcd", parentId: null,
      timestamp: "2026-09-25T00:00:00.000Z", data: { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id,
        incarnation: batch.incarnation, messageIds: batch.messageIds, sessionPath } });
    writeFileSync(sessionPath, `{"type":"session","version":3}\n${entry}\n`);
    const boundary: DeliveryBoundary = { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation, sessionPath, entryId: "0123abcd" };
    return { root, batch, boundary, close: () => rmSync(root, { recursive: true, force: true }) };
  };
  const publish = publishDeliveryReceipt as unknown as (root: string, batch: PreparedBatch, boundary: DeliveryBoundary, maximum: number,
    faults?: (fault: DurabilityFault) => void) => ReturnType<typeof publishDeliveryReceipt>;
  const probe = fixture();
  const points: DurabilityFault[] = [];
  try { publish(probe.root, probe.batch, probe.boundary, TEST_VIEW_LIMITS.frameBytes, fault => { points.push(fault); }); }
  finally { probe.close(); }
  const linked = points.findIndex(point => point.point === "publication-link" && point.phase === "after-visible");
  assert.ok(linked > 0, "the receipt has a link point");
  for (let crash = 0; crash < points.length; crash++) {
    const f = fixture();
    try {
      const run = killedAt(crash, `
        const { publishDeliveryReceipt } = await import(${JSON.stringify(import.meta.resolve("@oma/storage/delivery-receipt"))});
        publishDeliveryReceipt(${JSON.stringify(f.root)}, ${JSON.stringify(f.batch)}, ${JSON.stringify(f.boundary)}, ${TEST_VIEW_LIMITS.frameBytes}, faults);`);
      const at = `${crash} (${points[crash]!.point}/${points[crash]!.phase})`;
      assert.equal(run.signal, "SIGKILL", `not killed at ${at}: ${String(run.stdout)}${String(run.stderr)}`);
      // What the next run's settlement decides from what is left: present the
      // batch again (no receipt) or settle it (the whole receipt) -- never hold
      // it on evidence a dead publication left half made.
      const decision = deliveryDecision(observeDeliveryReceipt(f.root, f.batch, TEST_VIEW_LIMITS.frameBytes));
      assert.equal(decision.action, crash < linked ? "present" : "settle", `killed at ${at}: ${JSON.stringify(decision)}`);
      if (decision.action === "settle") assert.equal(decision.receipt.entryId, "0123abcd");
      // The retry -- the next run's settlement -- publishes the same receipt, or finds it.
      const receipt = publish(f.root, f.batch, f.boundary, TEST_VIEW_LIMITS.frameBytes);
      assert.deepEqual(readDeliveryReceipt(f.root, f.batch, TEST_VIEW_LIMITS.frameBytes), receipt, `after ${at}`);
      const directory = join(runnerReceiptPathAt(f.root, "alice", f.batch.id), "..");
      const names = readdirSync(directory);
      assert.ok(names.every(name => !name.endsWith(".tmp")), `a dead publication's temporary is left in ${directory}: ${names.join(" ")}`);
    } finally { f.close(); }
  }
});

test("P0V-96 / P0-7: a derived-file replacement SIGKILLed at any point leaves the old or the new bytes, and the next replacement collects what it left", TIMEOUT, () => {
  const probe = mkdtempSync(join(tmpdir(), "oma-derived-kill-"));
  const points: DurabilityFault[] = [];
  try {
    writeFileSync(join(probe, "view.md"), "old\n");
    replaceDerivedFile(join(probe, "view.md"), "new\n", 0o600, fault => { points.push(fault); });
  } finally { rmSync(probe, { recursive: true, force: true }); }
  const renamed = points.findIndex(point => point.point === "derived-rename" && point.phase === "after-visible");
  assert.ok(renamed > 0);
  for (let crash = 0; crash < points.length; crash++) {
    const root = mkdtempSync(join(tmpdir(), "oma-derived-kill-"));
    try {
      const target = join(root, "view.md");
      writeFileSync(target, "old\n");
      const run = killedAt(crash, `
        const { replaceDerivedFile } = await import(${JSON.stringify(import.meta.resolve("@oma/storage/durable-fs"))});
        replaceDerivedFile(${JSON.stringify(target)}, "new\\n", 0o600, faults);`);
      const at = `${crash} (${points[crash]!.point}/${points[crash]!.phase})`;
      assert.equal(run.signal, "SIGKILL", `not killed at ${at}: ${String(run.stdout)}${String(run.stderr)}`);
      assert.equal(readFileSync(target, "utf8"), crash >= renamed ? "new\n" : "old\n", `killed at ${at}`);
      replaceDerivedFile(target, "newer\n");
      assert.deepEqual(readdirSync(root), ["view.md"], `a dead writer's temporary was left, at ${at}`);
      assert.equal(readFileSync(target, "utf8"), "newer\n");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("T23 / P0V-96: an immutable publication copied across filesystems and SIGKILLed at any point publishes nothing partial, and the next one collects what it left", TIMEOUT, (t) => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "oma-immutable-kill-source-"));
  const shm = "/dev/shm";
  const crossDevice = (() => { try { return statSync(shm).dev !== statSync(sourceRoot).dev; } catch { return false; } })();
  if (!crossDevice) { rmSync(sourceRoot, { recursive: true, force: true }); t.skip("no second filesystem at /dev/shm"); return; }
  t.after(() => rmSync(sourceRoot, { recursive: true, force: true }));
  const source = join(sourceRoot, "source");
  writeFileSync(source, "complete immutable bytes");
  const probe = mkdtempSync(join(shm, "oma-immutable-kill-"));
  const points: DurabilityFault[] = [];
  try { publishImmutableFile(source, join(probe, "object.eml"), undefined, fault => { points.push(fault); }); }
  finally { rmSync(probe, { recursive: true, force: true }); }
  const linked = points.findIndex(point => point.point === "publication-link" && point.phase === "after-visible");
  assert.ok(points.some(point => point.point === "file-write"), "the probe did not take the copying path");
  for (let crash = 0; crash < points.length; crash++) {
    const root = mkdtempSync(join(shm, "oma-immutable-kill-"));
    try {
      const destination = join(root, "object.eml");
      const run = killedAt(crash, `
        const { publishImmutableFile } = await import(${JSON.stringify(import.meta.resolve("@oma/storage/immutable-file"))});
        publishImmutableFile(${JSON.stringify(source)}, ${JSON.stringify(destination)}, undefined, faults);`);
      const at = `${crash} (${points[crash]!.point}/${points[crash]!.phase})`;
      assert.equal(run.signal, "SIGKILL", `not killed at ${at}: ${String(run.stdout)}${String(run.stderr)}`);
      if (existsSync(destination)) assert.equal(readFileSync(destination, "utf8"), "complete immutable bytes", `a partial destination at ${at}`);
      else assert.ok(crash < linked, `the destination vanished after its link, at ${at}`);
      publishImmutableFile(source, destination);
      assert.deepEqual(readdirSync(root), ["object.eml"], `a dead copy's temporary was left, at ${at}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

/** A child that is SIGKILLed right before (even `crash`) or right after (odd)
 * its `crash >> 1`-th fsync. For the paths with no durability observer, every
 * fsync is a point where the order of what is durable changes. */
function killedAtFsync(crash: number, body: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const fsync = fs.fsyncSync;
    let seen = 0;
    fs.fsyncSync = fd => {
      const at = seen++;
      if (at * 2 === ${crash}) process.kill(process.pid, "SIGKILL");
      fsync(fd);
      if (at * 2 + 1 === ${crash}) process.kill(process.pid, "SIGKILL");
    };
    syncBuiltinESMExports();
    ${body}
    process.stdout.write("finished:" + seen);`], { encoding: "utf8", timeout: 60_000 });
}
const fsyncCount = (body: string): number => {
  const run = killedAtFsync(-1, body);
  const count = /finished:(\d+)/.exec(String(run.stdout))?.[1];
  assert.ok(count !== undefined, `the probe did not finish: ${String(run.stdout)}${String(run.stderr)}`);
  return Number(count);
};

test("V26B / P0-7: a request freeze SIGKILLed at any flush leaves no request, the whole request, or an orphan body it refuses to rebuild from", TIMEOUT, async () => {
  const { RequestCache } = await import("#oma-test/app/request-cache");
  const { makeValidFrozenRequest } = await import("./fixtures/valid.js");
  const input = makeValidFrozenRequest("kill-1", "hello");
  const freeze = (home: string) => `
    const { RequestCache } = await import(${JSON.stringify(moduleUrl("#oma-test/app/request-cache"))});
    new RequestCache(${JSON.stringify(home)}).freeze(${JSON.stringify(input)}, Buffer.from("hello"));`;
  const probe = mkdtempSync(join(tmpdir(), "oma-freeze-kill-"));
  let flushes = 0;
  try { flushes = fsyncCount(freeze(probe)); } finally { rmSync(probe, { recursive: true, force: true }); }
  assert.ok(flushes >= 4, `a freeze flushed only ${flushes} times`);
  const seen = new Set<string>();
  for (let crash = 0; crash < flushes * 2; crash++) {
    const home = mkdtempSync(join(tmpdir(), "oma-freeze-kill-"));
    try {
      const run = killedAtFsync(crash, freeze(home));
      assert.equal(run.signal, "SIGKILL", `not killed at ${crash}: ${String(run.stdout)}${String(run.stderr)}`);
      const cache = new RequestCache(home);
      const left = cache.read(input.key);
      seen.add(left.kind);
      if (left.kind === "present") {
        assert.deepEqual(left.value, { ...input, lastReceipt: null }, `at ${crash}`);
        assert.equal(cache.readBody(input.key, input.digest!).kind, "present", `a frozen request without its body, at ${crash}`);
        assert.equal(cache.freeze(input, Buffer.from("hello")).kind, "existing");
      } else if (left.kind === "absent") {
        assert.equal(cache.freeze(input, Buffer.from("hello")).kind, "created", `at ${crash}`);
        const names = readdirSync(join(home, ".local/state/oma/requests"));
        assert.deepEqual(names.sort(), ["kill-1.body", "kill-1.json"], `a dead freeze's temporary outlived the retry, at ${crash}`);
      } else {
        // A body published without its metadata: the payload it was frozen for
        // is not known, and nothing is rebuilt from it (V26B's design).
        assert.equal(left.kind, "corrupt", `at ${crash}: ${JSON.stringify(left)}`);
        assert.match(left.reason, /orphan body/);
        assert.throws(() => cache.freeze(input, Buffer.from("hello")), /CACHE_CORRUPT|orphan body/);
      }
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
  assert.ok(seen.has("absent") && seen.has("present"), `the kill points did not span the freeze: ${[...seen].join(" ")}`);
});

test("D05 / P0-7: a project binding SIGKILLed at any flush is absent or whole, and the next start collects what it left", TIMEOUT, async () => {
  const { collectBindingTemporaries, observeProjectBinding, publishProjectBinding } = await import("#oma-test/app/runtime/provision");
  const binding = { society: "demo", canonicalProjectPath: "/project" };
  const publish = (root: string) => `
    const { publishProjectBinding } = await import(${JSON.stringify(moduleUrl("#oma-test/app/runtime/provision"))});
    publishProjectBinding(${JSON.stringify(root)}, ${JSON.stringify(binding)});`;
  const probe = mkdtempSync(join(tmpdir(), "oma-binding-kill-"));
  let flushes = 0;
  try { flushes = fsyncCount(publish(probe)); } finally { rmSync(probe, { recursive: true, force: true }); }
  const seen = new Set<string>();
  for (let crash = 0; crash < flushes * 2; crash++) {
    const root = mkdtempSync(join(tmpdir(), "oma-binding-kill-"));
    try {
      const run = killedAtFsync(crash, publish(root));
      assert.equal(run.signal, "SIGKILL", `not killed at ${crash}: ${String(run.stdout)}${String(run.stderr)}`);
      const left = observeProjectBinding(root);
      seen.add(left.kind);
      assert.ok(left.kind === "absent" || left.kind === "bound", `killed at ${crash}: ${JSON.stringify(left)}`);
      collectBindingTemporaries(root);
      assert.deepEqual(readdirSync(root).filter(name => name.endsWith(".tmp")), [], `a temporary outlived the collection, at ${crash}`);
      publishProjectBinding(root, binding);
      assert.equal(observeProjectBinding(root).kind, "bound");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  assert.ok(seen.has("absent") && seen.has("bound"), `the kill points did not span the publication: ${[...seen].join(" ")}`);
});
