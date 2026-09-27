/** P0-7 for guesthost's request ledger (MAC-240/241): the process is killed
 * outright at each durable point, and the retry or the restart that follows
 * means what the records say. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
