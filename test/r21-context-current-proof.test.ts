// R21: a derived path alone must not be treated as a completed GOAL.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, lstatSync, readdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { sha256Hex } from "@oma/domain/canonical-json";
import { makeValidAgent } from "./fixtures/spec.js";
import { seedGit, gitFixture, gitAuth } from "./fixtures/git-crash.js";

function cleanup(root: string): void {
  const walk = (path: string): void => {
    if (!lstatSync(path).isDirectory()) return;
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) walk(join(path, name));
  };
  walk(root); rmSync(root, { recursive: true, force: true });
}

test("R21: forged current path never activates GOAL and corruption does not silently repair it", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r21-activation-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b", { desired: "stopped" })); });
    seedGit(root);
    const { git, paths } = gitFixture(root, store);
    const orphan = "f".repeat(40);
    const orphanDirectory = join(paths.worldDir, "context/revisions", orphan);
    mkdirSync(orphanDirectory, { recursive: true });
    writeFileSync(join(orphanDirectory, "GOAL.md"), "forged preparation");
    const current = join(paths.worldDir, "context/current");
    symlinkSync(`revisions/${orphan}`, current);
    assert.equal(git.hasCommittedContext(), false, "neither a real file nor a well-formed relative pointer is acceptance evidence");
    assert.equal(readlinkSync(current), `revisions/${orphan}`);
    const bytes = Buffer.from("# accepted goal\n");
    const hash = sha256Hex(bytes);
    const receipt = await git.publishContext(gitAuth, "real", {
      expected: null, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: hash }],
      content: { bytes: bytes.length, sha256: hash, mediaType: "application/vnd.oma.context-v1" },
    }, (async function* () { yield bytes; })());
    assert.equal(receipt.state, "succeeded");
    assert.equal(git.hasCommittedContext(), true);
    assert.equal(store.getAgent("b")?.desired, "stopped");
    const acceptedTarget = readlinkSync(current);
    unlinkSync(current); symlinkSync(`revisions/${orphan}`, current);
    assert.throws(() => git.hasCommittedContext(), { code: "STORE_CORRUPT" });
    assert.equal(readlinkSync(current), `revisions/${orphan}`, "read-only activation checks never repair a pointer");
    assert.equal(readFileSync(join(orphanDirectory, "GOAL.md"), "utf8"), "forged preparation");
    unlinkSync(current); symlinkSync(acceptedTarget, current);
    assert.equal(git.hasCommittedContext(), true);
  } finally { store.close(); cleanup(root); }
});
