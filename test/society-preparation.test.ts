import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { fstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareSociety } from "#oma-test/app/runtime/society-preparation";
import { tryHoldSociety } from "#oma-test/app/runtime/society-lease";
import { provisionSociety, publishProjectBinding } from "#oma-test/app/runtime/provision";
import { runGitText } from "@oma/process/policies";
import { existsSync, readdirSync } from "node:fs";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { GitModule } from "@oma/git";
import { ReconcileModule } from "@oma/reconcile";
import { UnitsModule } from "@oma/platform-linux/units";
import type { LifecycleModule } from "@oma/lifecycle";
for (const healthy of [true, false]) {
    test(`AV-07/P0: canonical publication waits for concurrent history validation (${healthy})`, async (t) => {
        const root = mkdtempSync(join(tmpdir(), "oma-prepare-verify-"));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        const state = join(root, "society"), project = join(root, "project");
        mkdirSync(project);
        writeFileSync(join(project, "source.txt"), "raw\n");
        for (const args of [["init", "--quiet", project], ["-C", project, "add", "."],
            ["-C", project, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "--quiet", "-m", "parent"]]) {
            const result = runGitText(args);
            assert.equal(result.status, 0, result.stderr);
        }
        let resolve!: () => void, reject!: (error: Error) => void;
        const verification = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        let started = false;
        const prepared = provisionSociety(state, { projectDir: project, verifyHistory(repository) {
                started = true;
                assert.ok(existsSync(join(repository, "objects")));
                return verification;
            } });
        const result = healthy ? prepared : assert.rejects(prepared, /damaged history/);
        assert.equal(started, true);
        assert.equal(existsSync(join(state, "repos/project.git")), false);
        if (healthy) {
            resolve();
            const report = await prepared;
            assert.equal(report.verifiedMain, runGitText(["--git-dir", join(state, "repos/project.git"), "rev-parse", "main"]).stdout.trim());
        }
        else {
            reject(new Error("damaged history"));
            await result;
        }
        assert.equal(readdirSync(join(state, "repos")).some(name => name.startsWith(".snapshot.staging.")), false);
    });
}
test("AV-07/P0: a consumed provisioning proof cannot hide later repository corruption", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "oma-prepare-health-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectGit = join(root, "repos/project.git");
    provisionSociety(root);
    const gitCommand = (argv: string[], input?: string) => {
        const result = runGitText(argv, { gitDir: projectGit, ...(input === undefined ? {} : { input }) });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    const tree = gitCommand(["mktree"], "");
    const main = gitCommand(["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit-tree", tree, "-m", "fixture"]);
    gitCommand(["update-ref", "refs/heads/main", main]);
    gitCommand(["fsck", "--strict"]);
    const store = new Store(join(root, "runtime.sqlite"), undefined, { society: "fixture" });
    t.after(() => store.close());
    const paths = { stateRoot: root, projectGit, contextGit: join(root, "repos/context.git"),
        worldDir: join(root, "world"), society: "fixture" };
    const mail = createMailModule(paths, store, 64);
    const git = createGitModule(paths, store, mail, { policyRevision: "fixture", protectedPaths: [], checks: [] });
    const units = new UnitsModule("fixture", { node: process.execPath, libdir: process.cwd(),
        state: root, society: "fixture", agent: "" });
    // No agents or accepted operations exist; lifecycle effects are unreachable.
    const reconcile = createReconcileModule(store, mail, git, null, units, {} as LifecycleModule, { projectGit, freshVerifiedMain: main, hasGoal: () => false, activationAllowed: () => false });
    await reconcile.startup(false);
    mkdirSync(join(projectGit, "objects/aa"), { recursive: true });
    writeFileSync(join(projectGit, "objects/aa", "b".repeat(38)), "damaged object");
    await assert.rejects(reconcile.startup(false), { code: "STORE_CORRUPT" });
});
test("DR35 preparation produces the bound project's snapshot before completing", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-prepare-"));
    const stateRoot = join(root, "society"), projectDir = join(root, "project");
    mkdirSync(projectDir);
    writeFileSync(join(projectDir, "source.txt"), "raw snapshot\n");
    const lease = tryHoldSociety(stateRoot)!;
    try {
        publishProjectBinding(stateRoot, { society: "fixture", canonicalProjectPath: projectDir });
        await prepareSociety({ node: process.execPath, libdir: process.cwd(), stateRoot, society: "fixture", projectDir,
            fence: lease.fence, signal: new AbortController().signal, log() { } });
        const snapshot = runGitText(["--git-dir", join(stateRoot, "repos/project.git"), "show", "main:source.txt"]);
        assert.equal(snapshot.status, 0, snapshot.stderr);
        assert.equal(snapshot.stdout, "raw snapshot\n");
        assert.ok(readFileSync(join(stateRoot, "rootfs/etc/passwd"), "utf8").includes("agent:x:"));
        assert.equal(tryHoldSociety(stateRoot), null);
    }
    finally {
        lease.release();
        rmSync(root, { recursive: true, force: true });
    }
});
test("DR35 cancellation preserves the inherited fence until the native writer actually closes", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-prepare-cancel-"));
    const stateRoot = join(root, "society"), libdir = join(root, "install"), marker = join(root, "held.json");
    mkdirSync(join(libdir, "apps/oma/dist/entry"), { recursive: true });
    // The real async preparation owner supervises a helper blocked in native
    // spawnSync, exactly the state that made startup SIGTERM unresponsive.
    writeFileSync(join(libdir, "apps/oma/dist/entry/prepare-society.js"), `
const { spawnSync } = require('node:child_process');
spawnSync(process.execPath, ['-e', ${JSON.stringify(`
const fs = require('node:fs');
const held = fs.fstatSync(4);
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, dev: held.dev, ino: held.ino }));
setInterval(() => {}, 1000);
`)}], { stdio: ['ignore', 'ignore', 'ignore', 'ignore', 4] });
`);
    const lease = tryHoldSociety(stateRoot)!, abort = new AbortController();
    const fenceIdentity = fstatSync(lease.fence);
    const preparation = prepareSociety({ node: process.execPath, libdir, stateRoot, society: "fixture", projectDir: root,
        fence: lease.fence, signal: abort.signal, log() { } });
    // Attach rejection handling before the cancellation event.
    const stopped = assert.rejects(preparation, { code: "BROKER_UNAVAILABLE" });
    try {
        type Held = {
            pid: number;
            dev: number;
            ino: number;
        };
        let held: Held | null = null;
        const deadline = performance.now() + 3000;
        while (held === null && performance.now() < deadline) {
            try {
                held = JSON.parse(readFileSync(marker, "utf8")) as Held;
            }
            catch { /* child not at the marker yet */ }
            if (held === null)
                await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(held, "native preparation never acquired its inherited descriptor");
        assert.equal(held.dev, fenceIdentity.dev);
        assert.equal(held.ino, fenceIdentity.ino);
        lease.release();
        assert.equal(tryHoldSociety(stateRoot), null, "native preparation no longer fences the society");
        abort.abort();
        await stopped;
        // Direct-child close is not a descendant-death oracle. A killed native
        // child may get its final kernel scheduling turn later; until then its
        // inherited socket must keep refusing a successor. Observe the actual
        // kernel release rather than assuming SIGKILL or parent close proved it.
        let successor = tryHoldSociety(stateRoot);
        const releasedBy = performance.now() + 3000;
        while (successor === null && performance.now() < releasedBy) {
            await new Promise(resolve => setTimeout(resolve, 10));
            successor = tryHoldSociety(stateRoot);
        }
        assert.ok(successor, "cancelled native writer still holds ownership");
        successor.release();
    }
    finally {
        abort.abort();
        await stopped;
        lease.release();
        rmSync(root, { recursive: true, force: true });
    }
});
