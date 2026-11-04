/** DR35/MCS-R01: real host provisioning, not SDK/provider or peer authentication. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { collaborationRecordRootPathAt } from "@oma/domain/paths";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "oma-private-record-root-")), root = join(base, "fixture");
  publishSessionBirth(root, newSessionBirth(root, "society", base, "collaboration-v1"));
  return { base, root, recordRoot: collaborationRecordRootPathAt(root, "principal") };
}

test("001. Conversation-only provisioning creates the permitted container, not an empty ledger observation", () => {
  const { base, root, recordRoot } = fixture();
  try {
    const birthPath = join(root, "session-mode.json"), birth = readFileSync(birthPath);
    const hostSecret = Buffer.from("host-only original bytes\r\n");
    writeFileSync(join(root, "host-secret"), hostSecret);
    provisionSociety(root, { conversationOnly: true });
    assert.equal(lstatSync(recordRoot).isDirectory(), true);
    assert.equal(statSync(recordRoot).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(recordRoot), [], "a container is not a manufactured healthy/empty projection");
    assert.deepEqual(readdirSync(join(root, "repos")), [], "private conversation does not initialize Git repositories");
    assert.equal(existsSync(join(root, "runtime.sqlite")), false, "private provisioning cannot open the broker ledger");
    assert.deepEqual(readFileSync(birthPath), birth);
    assert.deepEqual(readFileSync(join(root, "host-secret")), hostSecret);
    const original = Buffer.from("Original unavailable observation\r\n");
    writeFileSync(join(recordRoot, "health.md"), original);
    provisionSociety(root, { conversationOnly: true });
    assert.deepEqual(readdirSync(recordRoot), ["health.md"]);
    assert.deepEqual(readFileSync(join(recordRoot, "health.md")), original, "host path preparation is not a second record publisher");
    assert.deepEqual(readFileSync(birthPath), birth);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("002. Owned repair replaces a stray record-root symlink without traversing or modifying its target", () => {
  const { base, root, recordRoot } = fixture();
  try {
    const outside = join(base, "host-private");
    mkdirSync(outside, { mode: 0o750 });
    const secret = Buffer.from("do not project or repair this tree\r\n");
    writeFileSync(join(outside, "secret"), secret);
    mkdirSync(dirname(recordRoot), { recursive: true });
    symlinkSync(outside, recordRoot);
    const before = statSync(outside), birth = readFileSync(join(root, "session-mode.json"));
    provisionSociety(root, { conversationOnly: true });
    assert.equal(lstatSync(recordRoot).isDirectory(), true);
    assert.equal(lstatSync(recordRoot).isSymbolicLink(), false);
    assert.deepEqual(readdirSync(recordRoot), [], "repair creates a container, not a projection of the link target");
    assert.deepEqual(readdirSync(outside), ["secret"]);
    assert.deepEqual(readFileSync(join(outside, "secret")), secret);
    assert.equal(statSync(outside).ino, before.ino);
    assert.equal(statSync(outside).mode, before.mode);
    assert.deepEqual(readFileSync(join(root, "session-mode.json")), birth);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

function provisioningChild(root: string, phase: "before" | "after" | "retry") {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/private-record-provision.js", import.meta.url)), root, phase],
    { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let settled = false;
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve =>
    child.once("close", (code, signal) => { settled = true; resolve({ code, signal }); }));
  const observed = new Promise<unknown>((resolve, reject) => { child.once("message", resolve); child.once("error", reject); });
  const boundary = Promise.race([observed, closed.then(result => { throw new Error(`provisioning child ended before its boundary: ${JSON.stringify(result)}`); })]);
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 15_000);
  void closed.then(() => clearTimeout(watchdog));
  return { child, closed, boundary, get settled() { return settled; } };
}

for (const phase of ["before", "after"] as const)
  test(`003. SIGKILL ${phase} private provisioning preserves birth and a fresh-process retry creates no ledger observation`, { timeout: 30_000 }, async () => {
    const { base, root, recordRoot } = fixture(), owners: ReturnType<typeof provisioningChild>[] = [];
    try {
      const birthPath = join(root, "session-mode.json"), birth = readFileSync(birthPath);
      const interrupted = provisioningChild(root, phase); owners.push(interrupted);
      assert.deepEqual(await interrupted.boundary, { phase });
      assert.equal(interrupted.child.kill("SIGKILL"), true);
      assert.deepEqual(await interrupted.closed, { code: null, signal: "SIGKILL" });
      assert.deepEqual(readFileSync(birthPath), birth);
      if (phase === "before") assert.equal(lstatSync(recordRoot, { throwIfNoEntry: false }), undefined);
      else assert.deepEqual(readdirSync(recordRoot), []);
      const retry = provisioningChild(root, "retry"); owners.push(retry);
      assert.notEqual(retry.child.pid, interrupted.child.pid);
      assert.deepEqual(await retry.boundary, { phase: "retry" });
      assert.deepEqual(await retry.closed, { code: 0, signal: null });
      assert.equal(statSync(recordRoot).mode & 0o777, 0o700);
      assert.deepEqual(readdirSync(recordRoot), []);
      assert.deepEqual(readdirSync(join(root, "repos")), []);
      assert.equal(existsSync(join(root, "runtime.sqlite")), false);
      assert.deepEqual(readFileSync(birthPath), birth);
    } finally {
      // A kill request is not death. No fixture tree is deleted until every
      // acquired child has actually closed; incomplete owners retain the tree.
      for (const owner of owners) {
        if (!owner.settled) owner.child.kill("SIGKILL");
        await owner.closed;
      }
      rmSync(base, { recursive: true, force: true });
    }
  });
