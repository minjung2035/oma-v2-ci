/** The sixth review's regressions (implementation/priority-0-audit.md,
 * "6차 점검", P0V-74 on): each is the review's counterexample, run against
 * the code that fixed it. */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";
import { errorCodeOf, publicFailure } from "../src/domain/errors.js";
import { AdmissionGate } from "../src/domain/admission.js";

const schemaPath = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "implementation", "schema-v1.sql");

test("P0V-75 / R6-02, P0-5: an INTEGER the driver cannot hand over is corruption the fence sees, and nothing else with that code is", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-overflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "runtime.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode=WAL;");
  raw.exec(readFileSync(schemaPath, "utf8"));
  raw.prepare(`INSERT INTO agents (name,spec_hash,role,desired,incarnation,profile,created_by,spec_json,created_at_ms,updated_at_ms)
    VALUES ('principal',?,'principal','enabled',0,'p',NULL,'{}',1,1)`).run("0".repeat(64));
  // A value the file itself now holds, and no writer of this product makes.
  raw.prepare("UPDATE agents SET updated_at_ms=? WHERE name='principal'").run(9007199254740993n);
  raw.close();
  const store = new Store(path);
  t.after(() => store.close());
  let native: unknown = null;
  try { store.getAgent("principal"); } catch (error) { native = error; }
  assert.equal(errorCodeOf(native), "STORE_CORRUPT");
  assert.equal(publicFailure(native).retry, "after-repair");
  const gate = new AdmissionGate(); gate.observe(native);
  assert.equal(gate.state, "corrupt", "new acceptance stays open on a ledger that says it is not intact");
  // The same Node code from something that is not the database is not storage.
  let buffer: unknown = null;
  try { Buffer.alloc(4).writeUInt32BE(-1, 0); } catch (error) { buffer = error; }
  assert.equal((buffer as { code: string }).code, "ERR_OUT_OF_RANGE");
  assert.equal(errorCodeOf(buffer), "INTERNAL_ERROR");
  const healthy = new AdmissionGate(); healthy.observe(buffer);
  assert.equal(healthy.state, "healthy");
});

test("P0V-76 / R6-03: an Enter after a paste's burst submits even when the wall clock was set back meanwhile", async () => {
  const { KeyDecoder } = await import("../src/tui/keys.js");
  const { TERMINAL_BOUNDS } = await import("../src/tui/limits.js");
  const wall = Date.now;
  let offset = 0;
  // The wall clock is under the test's hand from before the decoder exists.
  Date.now = () => wall() + offset;
  try {
    const decoder = new KeyDecoder();
    decoder.push(Buffer.from("\u001b[200~pasted\u001b[201~"));
    offset = -3600_000;
    await new Promise(resolve => setTimeout(resolve, TERMINAL_BOUNDS.pasteBurstMs.value + 30));
    assert.deepEqual(decoder.push(Buffer.from("\r")), [{ kind: "enter" }], "the Enter was held as a newline by a clock set back an hour");
  } finally { Date.now = wall; }
});
