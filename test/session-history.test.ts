/** MODE-005 / P0-1: explicit resume observes identity before engine repair or
 * settings writes. These histories are fixtures, never the Human's sessions. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSessionHistory } from "#oma-test/app/runtime/session-history";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { sessionBirthForHistory, sessionHistoryDirectories } from "#oma-test/app/runtime/session-catalog";
import { modelWorkspacePathAt } from "@oma/domain/paths";

function fixture(t: { after(run: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "oma-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, "data", "oma"), cwd = join(root, "project"), personal = join(data, ".personal", "00000000-0000-4000-8000-000000000001");
  mkdirSync(cwd); const birth = publishSessionBirth(personal, newSessionBirth(personal, "personal", cwd));
  mkdirSync(birth.history); const file = join(birth.history, "fixture.jsonl");
  const header = { type: "session", id: "fixture-pi-id", version: 3, timestamp: "2026-10-01T00:00:00.000Z", cwd };
  return { root, data, cwd, personal, birth, file, header };
}
for (const [name, make] of [
  ["empty", () => ""], ["malformed", () => "{\n"], ["null", () => "null\n"], ["array", () => "[]\n"],
  ["missing identity", h => JSON.stringify({ ...h, id: "" })], ["wrong cwd", h => JSON.stringify({ ...h, cwd: "/other" })],
  ["old version", h => JSON.stringify({ ...h, version: 2 })], ["missing version", h => { const { version, ...rest } = h; return JSON.stringify(rest); }],
  ["future version", h => JSON.stringify({ ...h, version: 999 })], ["invalid version", h => JSON.stringify({ ...h, version: "3" })],
  ["invalid timestamp", h => JSON.stringify({ ...h, timestamp: "bad" })], ["wrong type", h => JSON.stringify({ ...h, type: "message" })],
  ["invalid UTF-8", () => Buffer.from([255])], ["oversized header", () => " ".repeat(1048577)],
] as const satisfies readonly (readonly [string, (header: { type: string; id: string; version: number; timestamp: string; cwd: string }) => string | Buffer])[])
  test(`Session history: ${name} cannot become a new identity or change preferences`, async t => {
    const w = fixture(t), bytes = Buffer.from(make(w.header)); writeFileSync(w.file, bytes);
    const prefs = join(w.data, ".personal", "settings.json"), saved = '{"sentinel":"unchanged"}'; writeFileSync(prefs, saved);
    await assert.rejects(sessionBirthForHistory(w.data, w.file, w.cwd), { code: "STORE_CORRUPT" });
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "../../apps/oma/dist/entry/oma.js"), "--resume", w.file], {
      cwd: w.cwd, env: { PATH: "/usr/bin:/bin", HOME: join(w.root, "home"), XDG_DATA_HOME: join(w.root, "data"), XDG_RUNTIME_DIR: join(w.root, "run"), PI_OFFLINE: "1" },
      encoding: "utf8", timeout: 5000,
    });
    assert.notEqual(result.status, 0, result.stderr); assert.match(result.stderr, /history|metadata|UTF-8/);
    assert.deepEqual(readFileSync(w.file), bytes); assert.equal(readFileSync(prefs, "utf8"), saved);
    assert.equal(existsSync(join(w.data, ".engine")), false); assert.equal(existsSync(join(w.personal, "history.lock")), false);
    assert.equal(existsSync(join(w.root, "run")), false);
  });
for (const version of [3]) test(`Session history: engine-owned version ${version} is observed without migration`, async t => {
  const w = fixture(t), bytes = JSON.stringify({ ...w.header, version }); writeFileSync(w.file, bytes);
  assert.deepEqual(await sessionBirthForHistory(w.data, w.file, "/another-window"), w.birth);
  assert.equal(readFileSync(w.file, "utf8"), bytes, "observation does not append a newline or migrate entries");
});
test("Session history: header bound does not limit the engine-owned conversation", async t => {
  const w = fixture(t); writeFileSync(w.file, JSON.stringify(w.header) + "\n" + "x".repeat(2 * 1024 * 1024));
  await assertSessionHistory(w.file, w.birth);
  assert.equal(readFileSync(w.file).length > 2 * 1024 * 1024, true);
});
test("Session history: missing, directory and symlink are not repaired or imported", async t => {
  const w = fixture(t); await assert.rejects(assertSessionHistory(w.file, w.birth), { code: "INVALID_REQUEST" });
  mkdirSync(w.file); await assert.rejects(assertSessionHistory(w.file, w.birth)); rmSync(w.file, { recursive: true });
  const target = join(w.root, "outside.jsonl"), text = JSON.stringify(w.header); writeFileSync(target, text); symlinkSync(target, w.file);
  await assert.rejects(assertSessionHistory(w.file, w.birth)); assert.equal(readFileSync(target, "utf8"), text);
});
for (const recorded of [false, true]) test(`Session history: ${recorded ? "recorded" : "missing birth"} Society requires identity before resume`, async t => {
  const w = fixture(t), society = join(w.data, "demo"), birth = newSessionBirth(society, "society", w.cwd);
  if (recorded) publishSessionBirth(society, birth); else mkdirSync(society);
  writeFileSync(join(society, "project-binding.json"), JSON.stringify({ kind: "oma-project-binding-v1", society: "demo", canonicalProjectPath: w.cwd }));
  mkdirSync(birth.history, { recursive: true }); const file = join(birth.history, "fixture.jsonl");
  writeFileSync(file, JSON.stringify({ ...w.header, cwd: modelWorkspacePathAt(society, "principal") }));
  if (!recorded) {
    const bytes = readFileSync(file);
    await assert.rejects(sessionBirthForHistory(w.data, file, w.cwd), { code: "INVALID_REQUEST" });
    assert.equal(sessionHistoryDirectories(w.data, w.cwd).some(entry => entry.root === society), false);
    assert.deepEqual(readFileSync(file), bytes);
    assert.equal(existsSync(join(society, "session-mode.json")), false, "observation cannot invent a birth");
    return;
  }
  assert.deepEqual(await sessionBirthForHistory(w.data, file, w.cwd), birth);
  assert.equal(sessionHistoryDirectories(w.data, w.cwd).some(entry => entry.root === society && entry.mode === "society"), true);
  await assert.rejects(sessionBirthForHistory(w.data, file, "/other-project"), { code: "INVALID_REQUEST" });
  writeFileSync(file, JSON.stringify(w.header));
  await assert.rejects(sessionBirthForHistory(w.data, file, w.cwd), { code: "STORE_CORRUPT" }, "project path is not the Principal's private cwd");
  assert.equal(existsSync(join(society, "session-mode.json")), recorded, "legacy observation does not publish a new fact");
});

for (const version of [undefined, 1, 2]) test(`DR46 Session history: unsupported header version ${version} refuses without changing saved bytes`, async t => {
  const w = fixture(t), bytes = JSON.stringify({ ...w.header, version }); writeFileSync(w.file, bytes);
  await assert.rejects(sessionBirthForHistory(w.data, w.file, "/another-window"), { code: "STORE_CORRUPT" });
  assert.equal(readFileSync(w.file, "utf8"), bytes);
  assert.deepEqual(await import("#oma-test/app/runtime/session-mode").then(({ readSessionBirth }) => readSessionBirth(w.personal)), w.birth);
});
