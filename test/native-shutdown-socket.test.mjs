/** Actual kernel freeze experiment. No lease identity, inherited Actor fence,
 * owner-crash recovery or product startup guarantee is inferred. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
test("001. Actual shutdown socket freezes reuse options across disconnect, reconnect and duplicate ownership", t => {
  if (process.platform !== "darwin") return;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-shutdown-socket-"))), executable = join(root, "probe");
  t.after(() => rmSync(root, { recursive: true }));
  const run = (command, args) => {
    const r = spawnSync(command, args, { encoding: "utf8", timeout: 30000 });
    assert.equal(r.error, undefined); assert.equal(r.signal, null); assert.equal(r.status, 0, r.stderr); return r;
  };
  run("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", fileURLToPath(new URL("./fixtures/darwin-shutdown-socket.c", import.meta.url)), "-o", executable]);
  run("/usr/bin/codesign", ["--force", "--sign", "-", executable]);
  const result = JSON.parse(run(executable, []).stdout);
  assert.deepEqual(result, { uid: process.getuid(), phases: 4, frozenMutations: 16, contendersExcluded: 16, lastCloseReleased: true });
  t.diagnostic(JSON.stringify(result));
});
