/** Actual inode flags + current production Seatbelt and job owner. This does
 * not yet construct, pin or recover a complete JS/dependency generation. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, constants, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { launchSeatbeltJobScope } from "@oma/platform-mac/job-scope";
import { ExecutionCoordinator } from "@oma/process/owned-execution";

test("001. Actual immutable candidate blocks writable acquisition, actor unseal and hardlink aliases while ordinary writes work", { timeout: 45000 }, async t => {
  if (process.platform !== "darwin") {
    await assert.rejects(launchSeatbeltJobScope({ executable: process.execPath, argv: [], env: {}, timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 },
      { readable: [], writable: [], denied: [], executable: [], unixSockets: [], machServices: [], environmentKeys: [] }),
    error => error.cause?.code === "UNSUPPORTED_PROFILE"); return;
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-immutable-candidate-"))), generation = join(root, "generation"), work = join(root, "work");
  mkdirSync(generation); mkdirSync(work);
  const source = join(generation, "code"), executable = join(root, "probe"), rows = [];
  writeFileSync(source, "immutable fixture bytes", { mode: 0o600 });
  let fd = openSync(source, constants.O_RDONLY), sealed = false, owner;
  const run = (command, argv) => {
    const r = spawnSync(command, argv, { encoding: "utf8", timeout: 30000 });
    assert.equal(r.error, undefined); assert.equal(r.signal, null); assert.equal(r.status, 0, r.stderr); return r;
  };
  t.after(async () => {
    // Retain flags/evidence if complete actor death cannot be established.
    await owner?.drain();
    if (fd !== undefined) { closeSync(fd); fd = undefined; }
    if (sealed) run(executable, ["--unseal", generation, source]);
    rmSync(root, { recursive: true });
  });
  run("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", fileURLToPath(new URL("./fixtures/darwin-immutable-code.c", import.meta.url)), "-o", executable]);
  run("/usr/bin/codesign", ["--force", "--sign", "-", executable]);
  sealed = true; run(executable, ["--seal", source, generation]);
  assert.throws(() => openSync(source, constants.O_RDWR), { code: "EPERM" }, "the unsandboxed owner cannot acquire writable I/O after sealing");
  assert.throws(() => linkSync(source, join(work, "host-alias")), { code: "EPERM" }, "the unsandboxed owner also cannot hardlink a sealed inode");
  owner = new ExecutionCoordinator({ entries: () => rows.map(r => ({ ...r })), reserve(slot) {
    const row = { slot, execution: "probe", witness: null }; rows.push(row);
    return { execution: row.execution, publish(witness) { row.witness = witness; }, retire() { rows.splice(rows.indexOf(row), 1); } };
  }, retire() { throw new Error("unexpected recovery"); } }, () => ({ kind: "unavailable" }));
  const result = await owner.run({ slot: "candidate", launch: () => launchSeatbeltJobScope({ executable,
    argv: [source, join(work, "actor-alias"), join(work, "control"), generation], env: {}, cwd: work,
    timeoutMs: 10000, stdoutBytes: 4096, stderrBytes: 4096 }, {
    readable: [{ path: generation, kind: "directory" }], writable: [{ path: work, kind: "directory" }], denied: [],
    executable: [{ path: executable, kind: "file" }], unixSockets: [], machServices: [], environmentKeys: [], preserveFds: [7],
  }, { files: [{ target: 7, fd }] }), authorize() {} });
  assert.equal(result.kind, "exited", result.stderr.toString()); assert.equal(result.exitCode, 0, result.stderr.toString());
  const value = JSON.parse(result.stdout.toString()); assert.equal(value.uid, process.getuid()); assert.equal(value.readBytes, 23);
  assert.equal(value.beforeFlags & 2, 2); assert.equal(value.afterFlags & 2, 2);
  assert.equal(value.directoryBeforeFlags & 2, 2); assert.equal(value.directoryAfterFlags & 2, 2);
  for (const action of ["write", "unseal", "directoryUnseal", "link"]) { assert.equal(value[action + "Status"], -1); assert.ok([1, 13].includes(value[action + "Errno"])); }
  assert.equal(value.controlWritten, true); assert.equal(readFileSync(join(work, "control"), "utf8"), "ordinary child");
  assert.equal(existsSync(join(work, "actor-alias")), false); assert.equal(readFileSync(source, "utf8"), "immutable fixture bytes");
  assert.deepEqual(rows, []); t.diagnostic(JSON.stringify(value));
});
