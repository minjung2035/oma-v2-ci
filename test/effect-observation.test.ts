import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import {
  readExtensions,
  toggleExtension,
} from "#oma-test/app/application/extensions";
import { loadConfiguration } from "@oma/config";
import { makeValidAgent } from "./fixtures/spec.js";
import { observeFile, observeLedger } from "./fixtures/effect-observation.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { lifecycleReplayFixture } from "./fixtures/lifecycle-replay.js";
import { gitAuth } from "./fixtures/git-crash.js";

// These are local module effects. gitAuth is synthetic fixture authority, not
// native socket/current-peer qualification; no model or systemd is invoked.
test("V02C: independent raw SQL and physical Mail effects detect duplicate replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-effect-observe-"));
  const dbPath = join(root, "runtime.sqlite");
  const store = new Store(dbPath);
  try {
    store.transaction((tx) => {
      for (const name of ["a", "b"]) tx.insertAgent(makeValidAgent(name));
    });
    const mail = createMailModule(
      { stateRoot: root, society: "crash" },
      store,
      64,
    );
    const input = {
      to: ["a", "b"],
      subject: "effect oracle",
      kind: "message" as const,
      body: "independent literal payload",
    };
    assert.equal(observeLedger(dbPath).operations.length, 0);
    const first = await mail.send(gitAuth, "one-effect", input);
    assert.equal(first.state, "succeeded");
    const before = observeLedger(dbPath);
    assert.equal(before.operations.length, 1);
    assert.equal(before.operations[0]!.state, "succeeded");
    assert.equal(before.deliveries.length, 2);
    assert.deepEqual(
      before.deliveries.map((row) => row.recipient),
      ["a", "b"],
    );
    for (const row of before.deliveries) {
      assert.equal(row.materialized, 1);
      assert.equal(row.operation_id, before.operations[0]!.id);
    }
    const locations = [
      "mail/objects",
      "mail/archive/cur",
      "mail/inboxes/a/new",
      "mail/inboxes/b/new",
    ];
    const files = locations.map((dir) => {
      const entries = readdirSync(join(root, dir));
      assert.equal(entries.length, 1, `one materialization in ${dir}`);
      return join(root, dir, entries[0]!);
    });
    const bytes = files.map(observeFile);
    for (const file of files) {
      // Independent MIME observation: no production reader may mask a writer bug.
      const raw = readFileSync(file, "utf8");
      const at = raw.indexOf("\r\n\r\n");
      assert.ok(at > 0);
      assert.match(raw.slice(0, at), /^Content-Transfer-Encoding: base64$/m);
      assert.equal(Buffer.from(raw.slice(at + 4), "base64").toString("utf8"), input.body);
    }
    assert.equal(new Set(bytes.map((value) => value.sha256)).size, 1);
    await mail.send(gitAuth, "one-effect", input);
    assert.deepEqual(observeLedger(dbPath), before);
    assert.deepEqual(
      files.map(observeFile),
      bytes,
      "replay must preserve exact published inodes/bytes",
    );
    for (const dir of locations)
      assert.equal(readdirSync(join(root, dir)).length, 1);
    // Negative oracle control: a plausible returned receipt cannot hide an extra
    // committed operation/delivery. This assertion does not call a planner.
    assert.throws(() =>
      assert.equal([...before.operations, before.operations[0]].length, 1),
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("V02A: config editor performs an observable replacement and remains loadable", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const role = join(f.output, "roles/resident.json");
    const before = observeFile(role);
    // The core extension is non-removable: a no-op must not replace the pointer.
    const context = readExtensions(f.path, "principal", "resident");
    toggleExtension(context, "packages/extension/dist/index.js", "workers", false);
    assert.deepEqual(observeFile(role), before);
    mkdirSync(join(f.installation, "extensions"));
    writeFileSync(join(f.installation, "extensions/local.js"), "export {};\n");
    toggleExtension(
      readExtensions(f.path, "principal", "resident"),
      "extensions/local.js",
      "workers",
      true,
    );
    // D02/WP13: the authored role file is preserved; the manifest is the one
    // replaced file and now names a generation holding the new selection.
    assert.deepEqual(observeFile(role), before);
    const manifest = JSON.parse(readFileSync(f.path, "utf8")) as { roles: Record<string, string> };
    assert.match(manifest.roles.resident!, /^\.oma-config\/generations\/g-[0-9a-f]{64}\/roles\/resident\.json$/);
    const after = observeFile(join(f.output, manifest.roles.resident!));
    assert.notEqual(after.sha256, before.sha256);
    assert.notEqual(after.ino, before.ino, "a generation is new bytes at a new inode");
    assert.doesNotThrow(() => loadConfiguration(f.path));
    assert.throws(() => observeFile(join(f.root, "absent")), {
      code: "ENOENT",
    });
    assert.throws(() => observeFile(f.root), /expected regular fixture file/);
    assert.throws(() => observeLedger(join(f.root, "absent.sqlite")));
  } finally {
    f.close();
  }
});

test("V02C: controlled unit requests are counted apart from committed lifecycle facts", async () => {
  const f = lifecycleReplayFixture();
  try {
    await f.dispatch("agent.stop", "stop-once");
    const effects = structuredClone(f.units.effects);
    assert.equal(effects.filter((effect) => effect.kind === "stop").length, 1);
    const ledger = observeLedger(join(f.root, "runtime.sqlite"));
    assert.equal(ledger.operations.length, 1);
    assert.equal(ledger.operations[0]!.state, "succeeded");
    await f.dispatch("agent.stop", "stop-once");
    assert.deepEqual(f.units.effects, effects);
    assert.deepEqual(observeLedger(join(f.root, "runtime.sqlite")), ledger);
  } finally {
    f.close();
  }
});
