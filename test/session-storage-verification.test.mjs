import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyResticInventory } from "@oma/storage/restic-verification";
import { parseStorageState } from "#oma-test/app/runtime/session-storage-state";
import { requireResticSuccess } from "@oma/process/restic";

const snapshot = "a".repeat(64);
const source = { paths: new Set(["repos", "repos/file"]), metadata: new Map([
  ["repos", { type: "dir", mode: 0o700, uid: "1000", gid: "1000", mtimeNs: "1700000000123456789" }],
  ["repos/file", { type: "file", mode: 0o600, uid: "1000", gid: "1000", mtimeNs: "1700000000123456789", size: 4 }],
]) };
function spool() {
  const root = mkdtempSync(join(tmpdir(), "oma-storage-verification-")), file = join(root, "spool");
  return { file, write: text => writeFileSync(file, text, { mode: 0o600 }), close: () => rmSync(root, { recursive: true, force: true }) };
}
test("storage inventory verifies snapshot binding, exact nanosecond metadata and all members", async () => {
  const f = spool();
  try {
    const header = { message_type: "snapshot", id: snapshot, paths: ["/source/repos"] };
    const directory = { message_type: "node", path: "/repos", type: "dir", mode: 2147483648 + 0o700, uid: 1000, gid: 1000, mtime: "2023-11-14T22:13:20.123456789Z" };
    const file = { ...directory, path: "/repos/file", type: "file", mode: 0o600, size: 4 };
    const check = async records => { f.write(records.map(value => JSON.stringify(value)).join("\n")); await verifyResticInventory(f.file, snapshot, ["/source/repos"], source); };
    await check([header, directory, file]);
    for (const records of [[header, directory], [header, directory, file, file], [{ ...header, id: "b".repeat(64) }, directory, file],
      [header, directory, { ...file, mtime: "2023-11-14T22:13:20.123456788Z" }], [header, directory, { ...file, mode: 0o644 }],
      [header, directory, { ...file, path: "/repos/extra" }], [header, directory, { ...file, size: 3 }]]) await assert.rejects(check(records));
  } finally { f.close(); }
});
test("storage selection admits only bound checkpoint roots and exact closed ledger identities", () => {
  const state = { kind: "oma-session-storage-v1", society: "first", project: "/project", checkpoint: {
    snapshot, digest: snapshot, roots: ["repos", "agents/worker/workspace"], residents: [{ name: "worker", incarnation: 2 }], ledger: [snapshot, null, null],
  } };
  const check = value => parseStorageState(JSON.stringify(value), "first", "/project");
  assert.deepEqual(check(state), state);
  for (const value of [{ ...state, society: "other" }, { ...state, project: "/other" }, { ...state, extra: true },
    { ...state, checkpoint: { ...state.checkpoint, roots: ["repos", "../escape"] } },
    { ...state, checkpoint: { ...state.checkpoint, roots: ["repos", "agents/stranger/home"] } },
    { ...state, checkpoint: { ...state.checkpoint, ledger: [null, null, null] } },
    { ...state, checkpoint: { ...state.checkpoint, residents: [{ name: "principal", incarnation: 2 }] } }]) assert.throws(() => check(value));
});
test("Restic exit 3 and unknown outcomes never count as complete backup", () => {
  const result = { kind: "exited", exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) };
  assert.equal(requireResticSuccess(result), "ok");
  for (const exitCode of [1, 2, 3, 10]) assert.throws(() => requireResticSuccess({ ...result, exitCode }));
  for (const kind of ["aborted", "unobserved", "signalled", "spawn-failed"]) assert.throws(() => requireResticSuccess({ ...result, kind }));
});
