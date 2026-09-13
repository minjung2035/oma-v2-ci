import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { sha256Hex } from "../src/hash.js";
import { gitFixture, gitAuth, gitCommand, seedGit } from "./fixtures/git-crash.js";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";

for (const format of ["sha1", "sha256"] as const) {
  test(`ID-003: ${format} rejects mismatched full OIDs before acceptance or stream consumption`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-oid-format-"));
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      seedGit(root, format);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      store.transaction(() => { for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null }); });
      const { git } = gitFixture(root, store);
      const wrong = "a".repeat(format === "sha1" ? 64 : 40);
      const bytes = Buffer.from("# GOAL\n");
      let consumed = false;
      const stream = async function* () { consumed = true; yield bytes; };
      const submit = { candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base], to: ["b"], subject: "candidate", body: "body", paths: [] };
      await assert.rejects(git.submit(gitAuth, "bad-candidate", { ...submit, candidate: wrong }, stream()), { code: "INVALID_OID" });
      await assert.rejects(git.submit(gitAuth, "bad-prerequisite", { ...submit, prerequisites: [wrong] }, stream()), { code: "INVALID_OID" });
      await assert.rejects(git.integrate(gitAuth, "bad-expected", { candidate: info.candidate, expected: wrong }), { code: "INVALID_OID" });
      await assert.rejects(git.publishContext(gitAuth, "bad-context", {
        expected: wrong, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }],
        content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" },
      }, stream()), { code: "INVALID_OID" });
      assert.equal(consumed, false);
      for (const key of ["bad-candidate", "bad-prerequisite", "bad-expected", "bad-context"]) assert.equal(store.getOperation("a", key), null);
      const overflow = async function* () { yield Buffer.from("xxx"); throw new Error("read beyond declared stream length"); };
      await assert.rejects(git.submit(gitAuth, "overflow-submit", { ...submit,
        bundle: { bytes: 2, sha256: sha256Hex(Buffer.from("xxx")), mediaType: "application/x-git-bundle" },
      }, overflow()), { code: "STREAM_INVALID" });
      await assert.rejects(git.publishContext(gitAuth, "overflow-context", {
        expected: null, entries: [{ path: "GOAL.md", bytes: 2, sha256: sha256Hex(Buffer.from("xx")) }],
        content: { bytes: 2, sha256: sha256Hex(Buffer.from("xxx")), mediaType: "application/vnd.oma.context-v1" },
      }, overflow()), { code: "STREAM_INVALID" });
      for (const key of ["overflow-submit", "overflow-context"]) assert.equal(store.getOperation("a", key), null);
      const publish = (actor: string, expected: string | null, text: string) => {
        const body = Buffer.from(text);
        return git.publishContext({ ...gitAuth, actor }, "shared-context-key", {
          expected, entries: [{ path: "GOAL.md", bytes: body.length, sha256: sha256Hex(body) }],
          content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" },
        }, (async function* () { yield body; body.fill(0); })());
      };
      const first = await publish("a", null, "# first goal\n");
      assert.ok(first.result?.kind === "context.publish");
      const second = await publish("b", first.result.revision, "# second goal\n");
      assert.ok(second.result?.kind === "context.publish");
      assert.notEqual(second.result.revision, first.result.revision);
      assert.equal(second.result.previous, first.result.revision);
      assert.equal(readFileSync(join(root, "world/context/current/GOAL.md"), "utf8"), "# second goal\n");
      assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/context.git"), "rev-parse", `${second.result.revision}^`]), first.result.revision);
      const staging = ["a", "b"].map(actor => JSON.parse(store.getOperation(actor, "shared-context-key")!.planJson).stagingPath);
      assert.notEqual(staging[0], staging[1]);
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

for (const format of ["sha1", "sha256"] as const) {
  test(`GIT-006: ${format} observation failure is not a missing commit and remains recoverable`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-git-observe-"));
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      seedGit(root, format);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      store.transaction(() => { for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null }); });
      const { git, mail, paths } = gitFixture(root, store);
      const observe = (oid: string) => Reflect.get(git, "canonicalHas").call(git, oid);
      assert.equal(observe(info.base), true);
      assert.equal(observe("0".repeat(info.base.length)), false);
      const away = join(root, "unavailable.git");
      const freeze = mail.freezeObject.bind(mail);
      mail.freezeObject = (id, eml) => {
        freeze(id, eml);
        mail.freezeObject = freeze;
        // Real filesystem fault after preflight; acceptance must not turn uncertainty into failure.
        renameSync(paths.projectGit, away);
      };
      await assert.rejects(git.submit(gitAuth, "uncertain", { candidate: info.base, exportRef: info.exportRef, prerequisites: [], to: ["b"], subject: "candidate", body: "body", paths: [] }, (async function* () {})()), { code: "REF_STATE_UNKNOWN" });
      const accepted = store.getOperation("a", "uncertain")!;
      assert.equal(accepted.state, "pending");
      renameSync(away, paths.projectGit);
      await git.reconcile(accepted.id);
      assert.equal(store.getOperation("a", "uncertain")!.id, accepted.id);
      assert.equal(store.getOperation("a", "uncertain")!.state, "succeeded");
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
