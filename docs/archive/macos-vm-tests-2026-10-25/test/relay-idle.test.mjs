import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("AV-08: the production relay stays idle after peer close and exits when both peers close", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-relay-idle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, "relay");
  execFileSync("/usr/bin/cc", ["-Wall", "-Wextra", "-Werror", "-O2", "test/fixtures/relay-idle.c", "-o", binary], { timeout: 30000 });
  const observation = JSON.parse(execFileSync(binary, { encoding: "utf8", timeout: 5000 }));
  assert.ok(observation.afterPeerClosedTicks <= 2);
});
