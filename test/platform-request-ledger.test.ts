/** P0-7 for guesthost's request ledger (MAC-240/241): the process is killed
 * outright at each durable point, and the retry or the restart that follows
 * means what the records say. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { StoreError } from "../src/domain/errors.js";
import { PlatformError } from "../src/platform/rpc.js";
import { RequestLedger } from "../src/platform/guest/requests.js";

const ledgerModule = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "platform", "guest", "requests.js");

/** Runs one request in a child that SIGKILLs itself at `point`. */
function killedAt(dir: string, point: "during-effect" | "after-outcome", effects: string): number | null {
  const script = `
    import { appendFileSync } from "node:fs";
    const { RequestLedger } = await import(${JSON.stringify(ledgerModule)});
    const ledger = new RequestLedger(${JSON.stringify(dir)});
    await ledger.run("k1", "project.import", { branch: "main" }, async () => {
      appendFileSync(${JSON.stringify(effects)}, "effect\\n");
      if (${JSON.stringify(point)} === "during-effect") process.kill(process.pid, "SIGKILL");
      return { head: "abc" };
    });
    process.kill(process.pid, "SIGKILL");`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).status;
}
const effectsIn = (path: string): number => existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0;

test("P0-7/MAC-241: killed during its effect, a request is pending, and its retry runs it to one outcome", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const effects = join(dir, "effects.log");
  assert.equal(killedAt(join(dir, "ledger"), "during-effect", effects), null, "the child was killed");
  const ledger = new RequestLedger(join(dir, "ledger"));
  assert.deepEqual(ledger.status("k1"), { state: "pending", method: "project.import" }, "started, and not known to be done");
  return (async () => {
    let ran = 0;
    assert.deepEqual(await ledger.run("k1", "project.import", { branch: "main" }, async () => { ran += 1; return { head: "abc" }; }), { head: "abc" });
    assert.equal(ran, 1, "the idempotent effect is run again to its outcome");
    assert.deepEqual(await ledger.run("k1", "project.import", { branch: "main" }, async () => { ran += 1; return { head: "zzz" }; }), { head: "abc" });
    assert.equal(ran, 1, "and never after its outcome is recorded");
  })();
});

test("P0-7/MAC-240: killed right after its outcome, a request's retry is answered from the record", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const effects = join(dir, "effects.log");
  assert.equal(killedAt(join(dir, "ledger"), "after-outcome", effects), null);
  assert.equal(effectsIn(effects), 1);
  const ledger = new RequestLedger(join(dir, "ledger"));
  assert.deepEqual(ledger.status("k1"), { state: "done", method: "project.import", result: { head: "abc" } });
  assert.deepEqual(await ledger.run("k1", "project.import", { branch: "main" }, async () => { throw new Error("must not run"); }), { head: "abc" });
  await assert.rejects(ledger.run("k1", "project.import", { branch: "other" }, async () => ({})),
    (error: unknown) => error instanceof StoreError && error.code === "REQUEST_KEY_REUSED");
});

test("MAC-240: a refusal is an outcome too; an unanswerable failure is not, and is run again", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new RequestLedger(join(dir, "ledger"));
  const refused = (error: unknown) => error instanceof PlatformError && error.failure.code === "BUNDLE_INVALID";
  await assert.rejects(ledger.run("r1", "project.import", {}, async () => { throw new StoreError("BUNDLE_INVALID", "not a bundle"); }), refused);
  await assert.rejects(ledger.run("r1", "project.import", {}, async () => ({ head: "later" })), refused, "answered from the recorded refusal");
  await assert.rejects(ledger.run("r2", "project.import", {}, async () => { throw new StoreError("INTERNAL_ERROR", "disk hiccup"); }));
  assert.deepEqual(ledger.status("r2"), { state: "pending", method: "project.import" });
  assert.deepEqual(await ledger.run("r2", "project.import", {}, async () => ({ head: "ok" })), { head: "ok" });
});


test("MAC-240 / P0V-119: request hashing preserves existing bytes and refuses excess nesting before intent", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new RequestLedger(dir);
  const params = { z: [null, -0, 1e21, "é"], a: { "2": true, "10": false } };
  await ledger.run("golden", "project.import", params, async () => ({ done: true }));
  const { createHash } = await import("node:crypto");
  const expected = createHash("sha256").update('project.import\n{"a":{"10":false,"2":true},"z":[null,0,1e+21,"é"]}').digest("hex");
  const intent = readdirSync(dir).find(name => name.endsWith(".intent.json"))!;
  assert.equal(JSON.parse(readFileSync(join(dir, intent), "utf8")).digest, expected);
  assert.deepEqual(await ledger.run("golden", "project.import", { a: params.a, z: params.z }, async () => { throw new Error("must remain cached"); }), { done: true });
  const before = readdirSync(dir);
  let nested: Record<string, unknown> = {};
  for (let i = 0; i < 65; i++) nested = { next: nested };
  await assert.rejects(ledger.run("deep", "project.import", nested, async () => { throw new Error("must not run"); }),
    (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
  assert.deepEqual(readdirSync(dir), before, "invalid data publishes no intent");
});


test("MAC-240: legacy export intents with an explicit absent since remain replayable", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { createHash } = await import("node:crypto");
  const { writeFileSync } = await import("node:fs");
  const name = createHash("sha256").update("export-1").digest("hex");
  const digest = createHash("sha256").update('project.export\n{"since":undefined,"society":"demo"}').digest("hex");
  writeFileSync(join(dir, `${name}.intent.json`), JSON.stringify({ key: "export-1", method: "project.export", digest }));
  writeFileSync(join(dir, `${name}.outcome.json`), JSON.stringify({ ok: true, result: { head: "existing" } }));
  assert.deepEqual(await new RequestLedger(dir).run("export-1", "project.export", { society: "demo", since: undefined },
    async () => { throw new Error("a completed export must not run again"); }), { head: "existing" });
});

for (const code of ["DB_BUSY", "DEADLINE_EXCEEDED", "RUN_TERMINATION_UNKNOWN", "SESSION_BOUNDARY_UNCONFIRMED", "BROKER_UNAVAILABLE", "STORAGE_FULL"] as const) {
  test(`DR27/MAC-241: ${code} remains pending through restart, not a durable refusal`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "oma-ledger-observation-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ledger = new RequestLedger(dir);
    const primary = new StoreError(code, "the result cannot be confirmed now");
    const error = new AggregateError([primary, new Error("cleanup")]);
    await assert.rejects(ledger.run("k", "project.import", {}, async () => { throw error; }), value => value === error);
    const restarted = new RequestLedger(dir);
    assert.deepEqual(restarted.status("k"), { state: "pending", method: "project.import" });
    let ran = 0;
    assert.deepEqual(await restarted.run("k", "project.import", {}, async () => { ran++; return { head: "confirmed" }; }), { head: "confirmed" });
    assert.deepEqual(await restarted.run("k", "project.import", {}, async () => { ran++; return { head: "must-not-replace" }; }), { head: "confirmed" });
    assert.equal(ran, 1);
  });
}

test("DR27/P0-1: a legacy terminal failure remains terminal under the new observation classifier", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-old-refusal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { createHash } = await import("node:crypto");
  const { writeFileSync } = await import("node:fs");
  const name = createHash("sha256").update("k").digest("hex");
  const digest = createHash("sha256").update("project.import\n{}").digest("hex");
  const outcome = { ok: false, error: { code: "DEADLINE_EXCEEDED", message: "old refusal", retry: "never" } };
  const path = join(dir, `${name}.outcome.json`);
  const bytes = JSON.stringify(outcome);
  writeFileSync(join(dir, `${name}.intent.json`), JSON.stringify({ key: "k", method: "project.import", digest }));
  writeFileSync(path, bytes);
  const ledger = new RequestLedger(dir);
  let ran = false;
  await assert.rejects(ledger.run("k", "project.import", {}, async () => { ran = true; return {}; }), error => {
    assert.ok(error instanceof PlatformError); assert.deepEqual(error.failure, outcome.error); return true;
  });
  assert.equal(ran, false);
  assert.equal(readFileSync(path, "utf8"), bytes);
});

for (const code of ["EACCES", "EIO", "EMFILE"] as const) {
  test(`DR27/P0-5: ledger read ${code} cannot become corruption or an absent result`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "oma-ledger-read-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ledger = new RequestLedger(dir);
    await ledger.run("k", "project.import", {}, async () => ({ head: "kept" }));
    const files = readdirSync(dir).sort().map(name => [name, readFileSync(join(dir, name), "utf8")]);
    const read = fs.readFileSync;
    t.mock.method(fs, "readFileSync", (...args: Parameters<typeof read>) => {
      if (String(args[0]).endsWith(".outcome.json")) throw Object.assign(new Error("read failed"), { code });
      return read(...args);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const unavailable = (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE";
    assert.throws(() => ledger.status("k"), unavailable);
    let ran = false;
    await assert.rejects(ledger.run("k", "project.import", {}, async () => { ran = true; return {}; }), unavailable);
    assert.equal(ran, false);
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.deepEqual(readdirSync(dir).sort().map(name => [name, readFileSync(join(dir, name), "utf8")]), files);
    assert.deepEqual(ledger.status("k"), { state: "done", method: "project.import", result: { head: "kept" } });
  });
}

test("DR27: a nested remote refusal remains upstream evidence, not a new local terminal outcome", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-remote-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new RequestLedger(dir);
  const error = new AggregateError([new AggregateError([new PlatformError({ code: "AUTH_FAILED", message: "the request is not authorized", retry: "never" })]), new Error("close")]);
  await assert.rejects(ledger.run("k", "project.import", {}, async () => { throw error; }), value => value === error);
  assert.deepEqual(ledger.status("k"), { state: "pending", method: "project.import" });
});

for (const finish of ["success", "unknown", "refusal"] as const) {
  test(`DR27/MAC-240: concurrent same-key ${finish} has one active effect and no waiting queue`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "oma-ledger-concurrent-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ledger = new RequestLedger(dir);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let effects = 0;
    const primary = new StoreError(finish === "refusal" ? "BUNDLE_INVALID" : "RUN_TERMINATION_UNKNOWN", "original result");
    const first = ledger.run("k", "project.import", { branch: "main" }, async () => {
      effects++;
      await gate;
      if (finish !== "success") throw primary;
      return { head: "accepted" };
    });
    // Attach the rejection observer before any other await.
    const observed = first.then(result => ({ result, error: null }), error => ({ result: null, error }));
    try {
      assert.deepEqual(ledger.status("k"), { state: "pending", method: "project.import" });
      await assert.rejects(ledger.run("k", "project.import", { branch: "other" }, async () => { effects++; return {}; }),
        { code: "REQUEST_KEY_REUSED" });
      await assert.rejects(ledger.run("k", "archive.create", { branch: "main" }, async () => { effects++; return {}; }),
        { code: "REQUEST_KEY_REUSED" });
      for (let i = 0; i < 4; i++) await assert.rejects(
        ledger.run("k", "project.import", { branch: "main" }, async () => { effects++; return { head: "duplicate" }; }),
        { code: "BROKER_UNAVAILABLE" }, "a retry observes or retries the same key; it never starts beside its owner");
      assert.equal(effects, 1);
      assert.deepEqual(ledger.status("k"), { state: "pending", method: "project.import" });
      assert.deepEqual(await ledger.run("other", "project.export", {}, async () => ({ independent: true })), { independent: true });
    } finally { release(); await observed; }
    const end = await observed;
    const retry = () => ledger.run("k", "project.import", { branch: "main" }, async () => { effects++; return { head: "recovered" }; });
    if (finish === "success") {
      assert.deepEqual(end.result, { head: "accepted" });
      assert.deepEqual(await retry(), end.result);
      assert.equal(effects, 1);
    } else if (finish === "refusal") {
      assert.ok(end.error instanceof PlatformError);
      await assert.rejects(retry(), error => error instanceof PlatformError && error.failure.code === "BUNDLE_INVALID");
      assert.equal(effects, 1);
    } else {
      assert.equal(end.error, primary);
      assert.deepEqual(ledger.status("k"), { state: "pending", method: "project.import" });
      await assert.doesNotReject(async () => { assert.deepEqual(await retry(), { head: "recovered" }); });
      assert.equal(effects, 2, "the owner released after unknown; only the explicit retry reexecutes");
    }
  });
}

test("DR27/MAC-240: synchronous reentry cannot take the request owner's slot", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-ledger-reentry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new RequestLedger(dir);
  let duplicate = false;
  const result = await ledger.run("k", "project.import", {}, async () => {
    await assert.rejects(ledger.run("k", "project.import", {}, async () => { duplicate = true; return {}; }), { code: "BROKER_UNAVAILABLE" });
    return { head: "accepted" };
  });
  assert.equal(duplicate, false);
  assert.deepEqual(result, { head: "accepted" });
});
