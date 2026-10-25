import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import {
  gitCommand,
  gitFixture,
  seedGit,
  submitFixture,
} from "./fixtures/git-crash.js";
import { makeValidAgent } from "./fixtures/spec.js";

for (const format of ["sha1", "sha256"] as const) {
  test(`P07: ${format} import retains only main and immutable publication, not a scratch ref`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-import-hygiene-"));
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      store.transaction((tx) => {
        tx.insertAgent(makeValidAgent("a"));
        tx.insertAgent(makeValidAgent("b"));
      });
      seedGit(root, format);
      const { git, paths } = gitFixture(root, store);
      const receipt = await submitFixture(root, git);
      assert.equal(receipt.state, "succeeded");
      const operation = store.getOperation("a", "git-crash")!;
      if (operation.kind !== "git.submit")
        throw new Error("wrong fixture kind");
      const refs = gitCommand(root, [
        "--git-dir",
        paths.projectGit,
        "for-each-ref",
        "--format=%(refname)",
      ]).split("\n");
      assert.deepEqual(
        refs.sort(),
        ["refs/heads/main", operation.plan.publishedRef].sort(),
      );
      assert.equal(
        gitCommand(root, [
          "--git-dir",
          paths.projectGit,
          "rev-parse",
          operation.plan.publishedRef,
        ]),
        operation.plan.candidate,
      );
      const metadata = JSON.parse(
        readFileSync(join(root, "git-fixture.json"), "utf8"),
      );
      assert.equal(
        gitCommand(root, [
          "--git-dir",
          paths.projectGit,
          "rev-parse",
          "refs/heads/main",
        ]),
        metadata.base,
      );
      await git.reconcile(operation.id);
      assert.equal(
        store.getOperationById(operation.id)?.planJson,
        operation.planJson,
      );
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
