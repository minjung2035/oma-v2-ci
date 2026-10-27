import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Store } from "@oma/storage";
import { makeValidAgent } from "./fixtures/spec.js";
import {
  CheckpointFailure,
  killAtCheckpoint,
} from "./fixtures/checkpoint-driver.js";
import { observeFile } from "./fixtures/effect-observation.js";
import {
  DERIVED_FAILURE_CASES,
  MAIL_ACCEPTANCE_EXPECTED,
  GIT_PUBLICATION_EXPECTED,
} from "./fixtures/failure-matrix.js";
import { seedGit, gitCommand } from "./fixtures/git-crash.js";

const worker = new URL("./fixtures/checkpoint-worker.js", import.meta.url);
function freshObservation(root: string) {
  const child = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./fixtures/checkpoint-observer.js", import.meta.url),
      ),
      root,
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      killSignal: "SIGKILL",
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.notEqual(result.pid, process.pid);
  return result;
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "oma-checkpoint-"));
  let safeToRemove = true;
  try {
    writeFileSync(join(root, "pointer"), "old");
    await run(root);
  } catch (error) {
    if (error instanceof CheckpointFailure && !error.terminationConfirmed)
      safeToRemove = false;
    throw error;
  } finally {
    if (safeToRemove) rmSync(root, { recursive: true, force: true });
  }
}

for (const expected of DERIVED_FAILURE_CASES) {
  const { point } = expected;
  test(`V02B: confirmed process death at ${point} has a fresh physical observer`, async (t) => {
    await fixture(async (root) => {
      const before = observeFile(join(root, "pointer"));
      const stopped = await killAtCheckpoint(
        worker,
        [root, "replace", point],
        point,
      );
      const observed = freshObservation(root);
      t.diagnostic(JSON.stringify({ expected, stopped, observed }));
      assert.notEqual(stopped.pid, observed.pid);
      assert.equal(observed.pointer, expected.pointer);
      const temporaries = Object.keys(observed.files).filter((name) =>
        name.endsWith(".tmp"),
      );
      assert.equal(temporaries.length, expected.temporaries);
      assert.equal(
        Object.keys(observed.files).length,
        1 + expected.temporaries,
      );
      if (expected.sameInode) assert.deepEqual(observed.files.pointer, before);
      else assert.notEqual(observed.files.pointer.ino, before.ino);
    });
  });
}

for (const [mode, reason] of [
  ["missing", /not reached/],
  ["wrong", /wrong checkpoint/],
  ["silent", /timeout/],
  ["throw-only", /not reached/],
] as const) {
  test(`V02B: ${mode} cannot be reported as checkpoint-qualified death`, async () => {
    await fixture(async (root) => {
      const failure = await killAtCheckpoint(
        worker,
        [root, mode, "temporary-created"],
        "temporary-created",
        mode === "silent" ? 200 : 10000,
      ).then(
        () => {
          throw new Error("negative driver unexpectedly passed");
        },
        (error) => error,
      );
      assert.ok(failure instanceof CheckpointFailure);
      if (!failure.terminationConfirmed) throw failure;
      assert.match(failure.message, reason);
      const observed = freshObservation(root);
      assert.equal(observed.pointer, "old");
      assert.equal(
        Object.keys(observed.files).some((name) => name.endsWith(".tmp")),
        false,
      );
      if (mode === "throw-only") assert.ok(observed.files["cleanup-ran"]);
    });
  });
}

test("V02B: actual death leaves the pre-rename temporary whereas ordinary throw cleaned it", async () => {
  await fixture(async (root) => {
    await killAtCheckpoint(
      worker,
      [root, "replace", "temporary-created"],
      "temporary-created",
    );
    const observed = freshObservation(root);
    assert.equal(observed.pointer, "old");
    assert.equal(
      Object.keys(observed.files).filter((name) => name.endsWith(".tmp"))
        .length,
      1,
    );
    assert.equal(observed.files["cleanup-ran"], undefined);
  });
});

test("V02B: a lying checkpoint message cannot satisfy the independent effect oracle", async () => {
  await fixture(async (root) => {
    await killAtCheckpoint(
      worker,
      [root, "false-checkpoint", "after-visible"],
      "after-visible",
    );
    const observed = freshObservation(root);
    assert.throws(() => assert.equal(observed.pointer, "new"));
  });
});

test("V02B: actual Mail acceptance survives commit-before-response in a fresh process", async (t) => {
  await fixture(async (root) => {
    const expected = MAIL_ACCEPTANCE_EXPECTED;
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      store.transaction((tx) => {
        for (const name of expected.recipients)
          tx.insertAgent(makeValidAgent(name));
      });
    } finally {
      store.close();
    }
    const stopped = await killAtCheckpoint(
      new URL("./fixtures/crash-worker.js", import.meta.url),
      [root, expected.point],
      expected.point,
    );
    const observed = freshObservation(root);
    t.diagnostic(JSON.stringify({ expected, stopped, observed }));
    assert.notEqual(stopped.pid, observed.pid);
    assert.equal(observed.ledger.operations.length, expected.operationCount);
    const operation = observed.ledger.operations[0];
    assert.equal(operation.actor, expected.actor);
    assert.equal(operation.request_key, expected.requestKey);
    assert.equal(operation.state, expected.state);
    assert.equal(observed.ledger.deliveries.length, expected.recipients.length);
    assert.deepEqual(
      observed.ledger.deliveries.map(
        (row: { recipient: string }) => row.recipient,
      ),
      expected.recipients,
    );
    assert.equal(observed.mail.objects.length, expected.objectCount);
    assert.equal(observed.mail["archive/cur"].length, expected.archiveCount);
    assert.equal(observed.ledger.batches.length, expected.batchCount);
    assert.deepEqual(
      observed.ledger.agents.map(
        (row: { incarnation: number }) => row.incarnation,
      ),
      expected.incarnations,
    );
    const messageIds = new Set(
      observed.ledger.deliveries.map(
        (row: { message_id: string }) => row.message_id,
      ),
    );
    assert.equal(messageIds.size, 1);
    for (const delivery of observed.ledger.deliveries)
      assert.equal(delivery.operation_id, operation.id);
  });
});

test("V02B: published Git CAS is observed independently before result mail and response", async (t) => {
  await fixture(async (root) => {
    const expected = GIT_PUBLICATION_EXPECTED;
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      store.transaction((tx) => {
        for (const name of ["a", "b", "c"])
          tx.insertAgent(makeValidAgent(name));
      });
    } finally {
      store.close();
    }
    seedGit(root);
    const candidate = gitCommand(join(root, "seed"), ["rev-parse", "HEAD"]);
    const stopped = await killAtCheckpoint(
      new URL("./fixtures/crash-worker.js", import.meta.url),
      [root, expected.point],
      expected.point,
    );
    const observed = freshObservation(root);
    t.diagnostic(JSON.stringify({ expected, candidate, stopped, observed }));
    assert.equal(observed.ledger.operations.length, expected.operationCount);
    assert.equal(observed.publishedRefs.length, expected.publishedRefCount);
    assert.equal(observed.publishedRefs[0].split(" ")[1], candidate);
    assert.equal(observed.mail["archive/cur"].length, expected.archiveCount);
  });
});
