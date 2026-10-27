/** P0-1: a saved execution mode cannot be changed by a restart or an option. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureUserDirectory } from "#oma-test/app/runtime/user-files";
import { newSessionBirth, publishSessionBirth, readSessionBirth, requireSessionMode, SESSION_BIRTH,
  sessionRootForHistory } from "#oma-test/app/runtime/session-mode";

const id = "00000000-0000-4000-8000-000000000001";
function fixture(t: { after(run: () => void): void }) {
  const data = mkdtempSync(join(tmpdir(), "oma-mode-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  return { data, personal: join(data, ".personal", id), society: join(data, "demo"), cwd: join(data, "project") };
}
for (const mode of ["personal", "society"] as const) test(`session mode: ${mode} publication is repeatable but immutable`, t => {
  const w = fixture(t), root = w[mode], birth = newSessionBirth(root, mode, w.cwd);
  assert.equal(readSessionBirth(root), null);
  assert.deepEqual(publishSessionBirth(root, birth), birth);
  const first = readFileSync(join(root, SESSION_BIRTH));
  assert.deepEqual(publishSessionBirth(root, birth), birth);
  assert.deepEqual(readFileSync(join(root, SESSION_BIRTH)), first);
  assert.deepEqual(readSessionBirth(root), birth);
  assert.throws(() => publishSessionBirth(root, { ...birth, cwd: join(w.data, "other") }), { code: "INVALID_REQUEST" });
  assert.deepEqual(readSessionBirth(root), birth);
  requireSessionMode(birth, undefined); requireSessionMode(birth, mode);
  assert.throws(() => requireSessionMode(birth, mode === "personal" ? "society" : "personal"), { code: "INVALID_REQUEST" });
});
test("session mode: an existing conflicting fact is preserved byte-for-byte", t => {
  const w = fixture(t), root = w.personal, birth = newSessionBirth(root, "personal", w.cwd);
  publishSessionBirth(root, birth);
  const first = readFileSync(join(root, SESSION_BIRTH));
  assert.throws(() => publishSessionBirth(root, { ...birth, mode: "society" }), { code: "STORE_CORRUPT" });
  assert.deepEqual(readFileSync(join(root, SESSION_BIRTH)), first);
});
for (const [name, change] of [
  ["null", () => null], ["array", () => []], ["unknown mode", b => ({ ...b, mode: "other" })],
  ["unknown version", b => ({ ...b, kind: "oma-session-v2" })], ["extra field", b => ({ ...b, permissive: true })],
  ["wrong identity", b => ({ ...b, id: "elsewhere" })], ["relative cwd", b => ({ ...b, cwd: "project" })],
  ["NUL cwd", b => ({ ...b, cwd: "/tmp/\0" })], ["non-normal cwd", b => ({ ...b, cwd: "/tmp/../etc" })],
  ["foreign history", b => ({ ...b, history: "/other/history" })],
] as const satisfies readonly (readonly [string, (birth: ReturnType<typeof newSessionBirth>) => unknown])[]) {
  test(`session mode: ${name} never defaults to a mode`, t => {
    const w = fixture(t), birth = newSessionBirth(w.personal, "personal", w.cwd);
    ensureUserDirectory(w.personal);
    const text = JSON.stringify(change(birth)); writeFileSync(join(w.personal, SESSION_BIRTH), text);
    assert.throws(() => readSessionBirth(w.personal), { code: "STORE_CORRUPT" });
    assert.throws(() => publishSessionBirth(w.personal, birth), { code: "STORE_CORRUPT" });
    assert.equal(readFileSync(join(w.personal, SESSION_BIRTH), "utf8"), text);
  });
}
for (const bytes of ["", "{", " ".repeat(16385), Buffer.from([0xff])]) test("session mode: malformed/big bytes remain an error, not absence", t => {
  const w = fixture(t); ensureUserDirectory(w.personal); writeFileSync(join(w.personal, SESSION_BIRTH), bytes);
  assert.throws(() => readSessionBirth(w.personal), { code: "STORE_CORRUPT" });
});
test("session mode: neither linked file nor linked parent imports outside metadata", t => {
  const w = fixture(t), foreign = join(w.data, "foreign"); ensureUserDirectory(w.personal); ensureUserDirectory(foreign);
  const text = JSON.stringify(newSessionBirth(w.personal, "personal", w.cwd));
  writeFileSync(join(foreign, SESSION_BIRTH), text);
  symlinkSync(join(foreign, SESSION_BIRTH), join(w.personal, SESSION_BIRTH));
  assert.throws(() => readSessionBirth(w.personal));
  assert.equal(readFileSync(join(foreign, SESSION_BIRTH), "utf8"), text);
  symlinkSync(foreign, w.society); assert.throws(() => readSessionBirth(w.society));
});
test("session mode: history lookup recognizes only exact owned layouts, not existence or authority", t => {
  const w = fixture(t);
  for (const mode of ["society", "personal"] as const) {
    const birth = newSessionBirth(w[mode], mode, w.cwd), file = join(birth.history, "example.jsonl");
    assert.equal(sessionRootForHistory(w.data, file), w[mode]);
    assert.equal(readSessionBirth(w[mode]), null, "a layout is not a birth fact");
    assert.equal(sessionRootForHistory(w.data, join(birth.history, "nested", "example.jsonl")), null);
    assert.equal(sessionRootForHistory(w.data, file.replace(".jsonl", ".json")), null);
  }
  for (const file of ["relative.jsonl", "/external/history/a.jsonl", `${w.data}/../a.jsonl`,
    join(w.data, ".personal", "unknown", "history", "a.jsonl"), join(w.data, ".engine", "sessions", "a.jsonl")])
    assert.equal(sessionRootForHistory(w.data, file), null, file);
});
