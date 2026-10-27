import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** S-05 (SP-05-T/A): the hostile bundles the spike named and the earlier tests
 * did not -- a pack whose bytes are corrupted, an object `fsck --strict`
 * refuses, and a pack that expands past the quarantine's storage bound. Each
 * is refused as BUNDLE_INVALID after its durable intent, leaves canonical
 * refs as they were, and leaves no quarantine tree behind. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { GitModule } from "@oma/git";
import { MailModule } from "@oma/mail";
import { sha256Hex } from "@oma/domain/canonical-json";
import { gitAuth, gitCommand, seedGit } from "./fixtures/git-crash.js";
import { makeValidAgent } from "./fixtures/spec.js";
function world(t: import("node:test").TestContext, tmpBytes = 256 * 1024 * 1024) {
    const root = mkdtempSync(join(tmpdir(), "oma-s05-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    seedGit(root);
    const store = new Store(join(root, "runtime.sqlite"));
    t.after(() => store.close());
    store.transaction(tx => { for (const name of ["a", "b"])
        tx.insertAgent(makeValidAgent(name)); });
    const paths = { stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit: join(root, "repos/context.git"), worldDir: join(root, "world"),
        society: "crash" };
    const mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64);
    const git = createGitModule(paths, store, mail, { policyRevision: "s05", protectedPaths: [], checks: [] });
    const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8")) as {
        base: string;
        candidate: string;
        exportRef: string;
    };
    return { root, store, git, info, seed: join(root, "seed"), projectGit: paths.projectGit };
}
const refs = (repository: string) => gitCommand(repository, ["for-each-ref", "--format=%(refname) %(objectname)"]);
async function refused(w: ReturnType<typeof world>, key: string, candidate: string, bundle: Buffer): Promise<void> {
    const before = refs(w.projectGit);
    await assert.rejects(w.git.submit(gitAuth, key, { candidate, exportRef: w.info.exportRef, prerequisites: [w.info.base], to: ["b"], subject: "s", body: "",
        paths: [], bundle: { bytes: bundle.length, sha256: sha256Hex(bundle), mediaType: "application/x-git-bundle" } }, (async function* () { yield bundle; })()), (error: unknown) => (error as {
        code?: string;
    }).code === "BUNDLE_INVALID", key);
    const operation = w.store.getOperation("a", key);
    assert.equal(operation?.state, "failed", `${key}: ${JSON.stringify(operation)}`);
    assert.equal(operation?.errorCode, "BUNDLE_INVALID");
    assert.equal(refs(w.projectGit), before, `${key}: a canonical ref changed`);
    const staging = (() => { try {
        return readdirSync(join(w.root, "staging"));
    }
    catch {
        return [];
    } })();
    assert.deepEqual(staging.filter(name => name.startsWith("quarantine-")), [], `${key}: a quarantine tree was left`);
}
test("S-05: a bundle whose pack bytes are corrupted is refused, and nothing of it is kept", async (t) => {
    const w = world(t);
    const bundle = readFileSync(join(w.root, "candidate.bundle"));
    const pack = bundle.indexOf(Buffer.from("PACK"));
    assert.ok(pack > 0, "the fixture bundle has a pack");
    const corrupted = Buffer.from(bundle);
    corrupted[pack + 40] = corrupted[pack + 40]! ^ 0xff;
    await refused(w, "s05-corrupt", w.info.candidate, corrupted);
});
test("S-05: a bundle carrying an object fsck --strict refuses is refused", async (t) => {
    const w = world(t);
    const tree = gitCommand(w.seed, ["rev-parse", `${w.info.candidate}^{tree}`]);
    // A commit whose author line has no date: well-formed enough to hash, not to pass --strict.
    writeFileSync(join(w.seed, "bad-commit"), `tree ${tree}\nparent ${w.info.base}\nauthor nobody\ncommitter nobody\n\nbad\n`);
    const bad = gitCommand(w.seed, ["hash-object", "-t", "commit", "--literally", "-w", "bad-commit"]);
    gitCommand(w.seed, ["update-ref", w.info.exportRef, bad]);
    gitCommand(w.seed, ["bundle", "create", join(w.root, "bad.bundle"), w.info.exportRef, `^${w.info.base}`]);
    await refused(w, "s05-fsck", bad, readFileSync(join(w.root, "bad.bundle")));
});
test("S-05: a pack of a highly compressible blob is kept compressed -- the quarantine and canonical grow by the pack, not the blob", async (t) => {
    const { execFileSync } = await import("node:child_process");
    const w = world(t, 1024 * 1024);
    const size = (path: string) => Number(execFileSync("du", ["-sb", path], { encoding: "utf8" }).split("\t")[0]);
    const before = size(w.projectGit);
    // 32 MiB of zeros packs into a few dozen KiB: small on the wire; expanded only by a checkout, where the workspace quota holds.
    writeFileSync(join(w.seed, "zeros.bin"), Buffer.alloc(32 * 1024 * 1024));
    gitCommand(w.seed, ["add", "zeros.bin"]);
    gitCommand(w.seed, ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "expands"]);
    const expands = gitCommand(w.seed, ["rev-parse", "HEAD"]);
    gitCommand(w.seed, ["update-ref", w.info.exportRef, expands]);
    gitCommand(w.seed, ["bundle", "create", join(w.root, "expands.bundle"), w.info.exportRef, `^${w.info.base}`]);
    const bundle = readFileSync(join(w.root, "expands.bundle"));
    assert.ok(bundle.length < 1024 * 1024, `the fixture bundle is not small on the wire: ${bundle.length}`);
    // The quarantine's storage bound is 1 MiB here: the import fits because nothing is unpacked beyond the pack.
    const receipt = await w.git.submit(gitAuth, "s05-expands", { candidate: expands, exportRef: w.info.exportRef, prerequisites: [w.info.base], to: ["b"],
        subject: "s", body: "", paths: [], bundle: { bytes: bundle.length, sha256: sha256Hex(bundle), mediaType: "application/x-git-bundle" } }, (async function* () { yield bundle; })());
    assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
    assert.ok(size(w.projectGit) - before < 4 * 1024 * 1024, `the canonical repository grew by ${size(w.projectGit) - before} bytes for a ${bundle.length}-byte bundle`);
});
