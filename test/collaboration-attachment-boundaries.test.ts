/** Original accepted Mail publication over actual native quarantine and Git CAS.
 * These are real child SIGKILL/Store-reopen/same-key tests, not filesystem
 * power-loss, whole-broker/peer authentication or macOS qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import type { MailInput, DeliveryRow } from "@oma/contracts";
import type { GitRepository } from "@oma/git/repository";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import { mailObjectPathAt } from "@oma/domain/paths";
import { attachmentRequestKey, exportRefForRequestKey, mailAttachmentRootId } from "@oma/domain/derived";
import { sha256Hex } from "@oma/domain/canonical-json";
import { isValidFullOid } from "@oma/domain/identifiers";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { gitFixture, gitAuth, seedGit, gitCommand } from "./fixtures/git-crash.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

const childScript = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { gitFixture, gitAuth } from ${JSON.stringify(new URL("./fixtures/git-crash.js", import.meta.url).href)};
const [root, point] = process.argv.slice(1);
const { key, input } = JSON.parse(fs.readFileSync(join(root, "mail-input.json"), "utf8"));
let collectedTree = null;
const die = () => { fs.writeSync(1, point + "\\n"); process.kill(process.pid, "SIGKILL"); };
const nativeFsync = fs.fsyncSync;
fs.fsyncSync = function(fd) {
  const result = nativeFsync(fd);
  if (collectedTree !== null && point !== "attachment-cas") {
    const staging = fs.statSync(join(root, "staging")), observed = fs.fstatSync(fd);
    if (observed.dev === staging.dev && observed.ino === staging.ino && !fs.existsSync(collectedTree)) {
      const retainedLease = fs.existsSync(collectedTree + ".lease");
      if (point === "quarantine-tree-flush" && retainedLease || point === "quarantine-collection-flush" && !retainedLease) die();
    }
  }
  return result;
};
syncBuiltinESMExports();
const store = new Store(join(root, "runtime.sqlite"));
const f = gitFixture(root, store, { ownerSignal: new AbortController().signal,
  afterImport: () => {
    const trees = fs.readdirSync(join(root, "staging"), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith("quarantine-ns-"));
    if (trees.length !== 1) throw new Error("the exact imported quarantine tree was not observed");
    collectedTree = join(root, "staging", trees[0].name);
    fs.writeFileSync(join(root, "imported-tree.json"), JSON.stringify(collectedTree));
  },
});
if (point === "attachment-cas") {
  const submission = f.git.repository.submission, publish = submission.publishRef;
  submission.publishRef = (ref, oid) => { publish(ref, oid); die(); };
}
const bytes = fs.readFileSync(join(root, "mail.bundle"));
await f.mail.send(gitAuth, key, input, undefined, (async function* () { yield bytes; })());
throw new Error("the requested production boundary was not reached");
`;

for (const format of ["sha1", "sha256"] as const) for (const point of ["quarantine-tree-flush", "quarantine-collection-flush", "attachment-cas"] as const) {
  test(`001. Accepted attachment: actual SIGKILL at ${point} (${format}) retains one original Mail root and publication`, async t => {
    const root = fs.mkdtempSync(join(tmpdir(), "oma-attachment-boundary-"));
    let store: Store | undefined;
    t.after(() => { store?.close(); removeTree(root); });
    seedGit(root, format);
    const info: unknown = JSON.parse(fs.readFileSync(join(root, "git-fixture.json"), "utf8"));
    assert.ok(info !== null && typeof info === "object" && "candidate" in info && "base" in info && isValidFullOid(info.candidate) && isValidFullOid(info.base));
    const key = "original-attachment", operation = mailAttachmentRootId(gitAuth.actor, key);
    const exportRef = exportRefForRequestKey(attachmentRequestKey(key, 0));
    gitCommand(join(root, "seed"), ["update-ref", exportRef, info.candidate]);
    gitCommand(join(root, "seed"), ["bundle", "create", join(root, "mail.bundle"), exportRef, `^${info.base}`]);
    const bytes = fs.readFileSync(join(root, "mail.bundle"));
    const bundle = { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/x-git-bundle" as const };
    const input: MailInput = { to: ["b"], kind: "message", subject: "Shared committed work", body: "",
      collaboration: { version: "collaboration-v1", resolutions: [info.candidate], freeze: { version: "mail-root-v1", operation, dateMs: 1700000000000 },
        attachments: [{ commit: info.candidate, objectFormat: format, stage: { exportRef, prerequisites: [info.base], bundle } }] },
      content: { bytes: bytes.length, sha256: bundle.sha256, mediaType: "application/vnd.oma.attachments-v1" } };
    fs.writeFileSync(join(root, "mail-input.json"), JSON.stringify({ key, input }));
    store = new Store(join(root, "runtime.sqlite"));
    store.transaction(tx => { for (const actor of ["a", "b"]) tx.insertAgent(makeValidAgent(actor)); });
    store.close(); store = undefined;
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childScript, root, point],
      { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
    assert.equal(child.error, undefined, child.stderr); assert.equal(child.status, null, child.stderr);
    assert.equal(child.signal, "SIGKILL", child.stderr); assert.equal(child.stdout, `${point}\n`, child.stderr);
    store = new Store(join(root, "runtime.sqlite"));
    const accepted = store.getOperation(gitAuth.actor, key); assert.equal(accepted?.kind, "mail.send");
    assert.ok(accepted?.kind === "mail.send"); assert.equal(accepted.id, operation); assert.equal(accepted.state, "pending");
    const original = { planJson: accepted.planJson, requestHash: accepted.requestHash, id: accepted.id };
    const source = accepted.plan.attachments?.sources[0]; assert.ok(source?.local);
    assert.equal(source.commit, info.candidate); assert.equal(source.objectFormat, format); assert.equal(source.publication, operation);
    assert.equal(source.publicationOrdinal, 0);
    const retainedBundle = fs.readFileSync(source.local.bundle.path);
    assert.deepEqual(retainedBundle, bytes);
    const originalObject = fs.readFileSync(mailObjectPathAt(root, accepted.plan.message.id));
    const deliveries = store.deliveriesForOperation(operation);
    assert.equal(deliveries.length, 1); assert.equal(deliveries[0]!.acknowledged, 0); assert.equal(deliveries[0]!.presented, 0);
    assert.deepEqual(ExecutionJournal.inspect(root), [], "the original native scope owner settled before collection/CAS");
    const tree: unknown = JSON.parse(fs.readFileSync(join(root, "imported-tree.json"), "utf8")); assert.equal(typeof tree, "string");
    assert.equal(fs.existsSync(String(tree)), false);
    assert.equal(fs.existsSync(`${String(tree)}.lease`), point === "quarantine-tree-flush");
    const retainedLease = point === "quarantine-tree-flush" ? fs.readFileSync(`${String(tree)}.lease`) : null;
    const canonical = gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "show-ref"]);
    assert.equal(canonical.includes(source.publishedRef), point === "attachment-cas");
    // Current sender authority can change without revoking the original accepted
    // publication. Recovery uses its fixed bundle/recipient plan, never a rebuild.
    store.transaction(tx => tx.updateAgent({ name: "a", desired: "retired" }));
    let publicationCalls = 0;
    for (let restart = 0; restart < 2; restart++) {
      const f = gitFixture(root, store, { ownerSignal: new AbortController().signal });
      const repository = Reflect.get(f.git, "repository") as { submission: GitRepository["submission"] };
      const publish = repository.submission.publishRef;
      repository.submission.publishRef = (ref, oid) => { publicationCalls++; publish(ref, oid); };
      const receipt = await f.mail.send(gitAuth, key, input);
      assert.equal(receipt.operation, operation, "same-key receipt replay does not rerun source preparation");
      await f.mail.reconcilePending();
      const completed: DecodedOperation | null = store.getOperation(gitAuth.actor, key); assert.equal(completed?.state, "succeeded");
      assert.deepEqual({ planJson: completed?.planJson, requestHash: completed?.requestHash, id: completed?.id }, original);
      assert.deepEqual(fs.readFileSync(source.local.bundle.path), retainedBundle);
      assert.deepEqual(fs.readFileSync(f.mail.objectPath(accepted.plan.message.id)), originalObject);
      const projectedDeliveries: DeliveryRow[] = store.deliveriesForOperation(operation);
      assert.deepEqual(projectedDeliveries.map(({ materialized: _m, materializedAtMs: _at, ...facts }) => facts),
        deliveries.map(({ materialized: _m, materializedAtMs: _at, ...facts }) => facts));
      assert.equal(projectedDeliveries[0]!.materialized, 1);
      const record = f.mail.readRecord("b", accepted.plan.message.id); assert.equal(record.state, "published");
      if (record.state === "published") assert.equal(record.record.body, "", "attachment-only empty body must not become the subject fallback");
      assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", source.publishedRef]), info.candidate);
      assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]), info.base);
      assert.equal(store.acceptedOperationPage().items.length, 1, "publication is not a second accepted submit");
      if (retainedLease !== null) assert.deepEqual(fs.readFileSync(`${String(tree)}.lease`), retainedLease, "a fresh import does not acquire another retained collection owner");
      store.close(); store = new Store(join(root, "runtime.sqlite"));
    }
    assert.equal(publicationCalls, point === "attachment-cas" ? 0 : 1, "observed original publication never requires a replacement CAS");
  });
}
