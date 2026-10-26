import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** V24A/V24B: Git recovery settles an effect it can prove and never invents
 * one. A failed main CAS leaves a third ref untouched in SHA-1 and SHA-256
 * repositories and recovery never reports it applied; a no-op integration
 * (base == candidate) has no CAS to prove its authorization, so its recovery
 * without a recorded witness repeats current policy, stop and authority checks, while an applied
 * non-no-op CAS is settled as history even after authority changed. Real Git
 * repositories, Store, MailModule and GitModule; faults are a one-shot
 * unavailable main observation, a failed success record and a concurrent main
 * writer.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { GitModule } from "@oma/git";
import { StoreError } from "@oma/domain/errors";
import type { IntegrationPolicy } from "@oma/domain/integration-policy";
import { makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { gitAuth, gitCommand, seedGit, submitFixture } from "./fixtures/git-crash.js";
const POLICY: IntegrationPolicy = { policyRevision: "crash-policy", protectedPaths: [], checks: [] };
function repository(t: TestContext, format: "sha1" | "sha256" = "sha1") {
    const root = mkdtempSync(join(tmpdir(), "oma-git-evidence-"));
    const store = new Store(join(root, "runtime.sqlite"));
    t.after(() => { try {
        store.close();
    }
    finally {
        removeTree(root);
    } });
    store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
    seedGit(root, format);
    const projectGit = join(root, "repos/project.git");
    const mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64);
    // The authoritative policy is reread before main moves; a hook can act there.
    const reader = { revision: POLICY.policyRevision, onRead: null as (() => void) | null };
    const git = createGitModule({ stateRoot: root, projectGit, contextGit: join(root, "repos/context.git"), worldDir: join(root, "world"),
        society: "crash" }, store, mail, POLICY, () => { reader.onRead?.(); return { ...POLICY, policyRevision: reader.revision }; });
    const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8")) as {
        base: string;
        candidate: string;
        exportRef: string;
    };
    const main = () => gitCommand(root, ["--git-dir", projectGit, "rev-parse", "refs/heads/main"]);
    const third = () => {
        const tree = gitCommand(root, ["--git-dir", projectGit, "rev-parse", `${info.base}^{tree}`]);
        return gitCommand(root, ["-c", "user.name=Third", "-c", "user.email=third@localhost", "--git-dir", projectGit,
            "commit-tree", tree, "-p", info.base, "-m", "third writer"]);
    };
    const move = (oid: string) => gitCommand(root, ["--git-dir", projectGit, "update-ref", "refs/heads/main", oid]);
    const operation = (key: string) => {
        const row = store.getOperation("a", key);
        assert.ok(row?.kind === "git.integrate");
        return row;
    };
    const reconcile = (id: string) => git.reconcile(id).then(() => null, (error: unknown) => error);
    return { root, store, git, info, reader, main, third, move, operation, reconcile };
}
type Repository = ReturnType<typeof repository>;
async function published(f: Repository): Promise<void> {
    assert.equal((await submitFixture(f.root, f.git, "publish")).state, "succeeded");
}
/** The accepted integration's first post-acceptance main observation is unavailable. */
function loseNextMainObservation(t: TestContext, f: Repository): void {
    const observations = Reflect.get(Reflect.get(f.git, "repository"), "observations") as {
        ref: (...args: unknown[]) => unknown;
    };
    const real = observations.ref.bind(observations);
    let mainReads = 0;
    t.mock.method(observations, "ref", (...args: unknown[]) => {
        if (args[1] === "refs/heads/main" && ++mainReads === 2)
            return { kind: "unknown", reason: "injected unavailable main", evidence: { status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } };
        return real(...args);
    });
}
for (const format of ["sha1", "sha256"] as const) {
    test(`V24A: ${format} a main CAS that finds a third writer leaves it untouched and recovery never reports it applied`, async (t) => {
        const f = repository(t, format);
        await published(f);
        const other = f.third();
        // The policy read immediately before CAS; admission reads the current revision first (DR8).
        let reads = 0;
        f.reader.onRead = () => { if (++reads < 2)
            return; f.reader.onRead = null; f.move(other); };
        const receipt = await f.git.integrate(gitAuth, "raced", { expected: f.info.base, candidate: f.info.candidate });
        assert.equal(receipt.state, "unknown");
        assert.equal(f.main(), other, "the third writer's main is not overwritten");
        for (let attempt = 0; attempt < 2; attempt++) {
            await f.reconcile(f.operation("raced").id);
            assert.equal(f.operation("raced").state, "unknown", "a third main is neither success nor failure");
            assert.equal(f.main(), other);
        }
        assert.equal(gitCommand(f.root, ["--git-dir", join(f.root, "repos/project.git"), "rev-parse", `refs/oma/published/a/${f.store.getOperation("a", "publish")!.id}`]), f.info.candidate, "the confirmed publication is preserved");
    });
}
// P0-1/LIFE-008: an agent's durable capabilities are its frozen spec, which
// nothing rewrites after creation; a current check can still refuse through
// the desired state and the host's policy, the two cases below.
for (const change of ["unchanged", "stop", "policy"] as const) {
    test(`V24B: a no-op integration recovered after ${change} repeats the current checks instead of trusting main == candidate`, async (t) => {
        const f = repository(t);
        await published(f);
        assert.equal((await f.git.integrate(gitAuth, "advance", { expected: f.info.base, candidate: f.info.candidate })).state, "succeeded");
        assert.equal(f.main(), f.info.candidate);
        loseNextMainObservation(t, f);
        const receipt = await f.git.integrate(gitAuth, "no-op", { expected: f.info.candidate, candidate: f.info.candidate });
        assert.equal(receipt.state, "unknown");
        t.mock.restoreAll();
        if (change === "stop")
            f.store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
        if (change === "policy")
            f.reader.revision = "changed-policy";
        const error = await f.reconcile(f.operation("no-op").id);
        const settled = f.operation("no-op");
        if (change === "unchanged") {
            assert.equal(error, null);
            assert.equal(settled.state, "succeeded");
        }
        else {
            assert.ok(error instanceof StoreError, String(error));
            assert.equal(settled.state, "failed", `a no-op has no historical effect to settle after ${change}`);
            assert.equal(settled.errorCode, { stop: "CANCELLED_BEFORE_COMMIT", policy: "POLICY_CHANGED" }[change]);
        }
        assert.equal(f.main(), f.info.candidate, "a no-op moves nothing");
    });
}
test("V24B: an applied non-no-op CAS is settled as history even after stop and policy change", async (t) => {
    const f = repository(t);
    await published(f);
    const transaction = f.store.transaction.bind(f.store);
    let calls = 0;
    t.mock.method(f.store, "transaction", ((work: Parameters<Store["transaction"]>[0]) => {
        // acceptance, then the lost success record after the CAS
        if (++calls === 2)
            throw new StoreError("DB_BUSY", "injected loss of the success record");
        return transaction(work);
    }) as Store["transaction"]);
    await assert.rejects(f.git.integrate(gitAuth, "applied", { expected: f.info.base, candidate: f.info.candidate }), { code: "DB_BUSY" });
    t.mock.restoreAll();
    assert.equal(f.main(), f.info.candidate, "the CAS happened");
    assert.equal(f.operation("applied").state, "unknown");
    f.store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
    f.reader.revision = "changed-policy";
    assert.equal(await f.reconcile(f.operation("applied").id), null);
    assert.equal(f.operation("applied").state, "succeeded", "authority changed afterwards does not undo a proven effect");
    assert.equal(f.main(), f.info.candidate);
});
test("V24A: a recovery CAS that loses to a third writer after its checks is unknown, never applied", async (t) => {
    // How many times recovery rereads the policy, so the writer can arrive at the
    // last reread -- after the still-at-base check, before the CAS.
    const reads = async (move: boolean): Promise<{
        count: number;
        f: Repository;
    }> => {
        const f = repository(t);
        await published(f);
        loseNextMainObservation(t, f);
        assert.equal((await f.git.integrate(gitAuth, "recover", { expected: f.info.base, candidate: f.info.candidate })).state, "unknown");
        t.mock.restoreAll();
        assert.equal(f.main(), f.info.base, "the live attempt moved main");
        let count = 0;
        const other = f.third();
        f.reader.onRead = () => { count += 1; if (move && count === last)
            f.move(other); };
        await f.reconcile(f.operation("recover").id);
        return { count, f };
    };
    let last = Number.POSITIVE_INFINITY;
    const probe = await reads(false);
    assert.equal(probe.f.operation("recover").state, "succeeded", "an undisturbed recovery did not apply the CAS");
    last = probe.count;
    assert.ok(last >= 2, `recovery read the policy ${last} time(s)`);
    const { f } = await reads(true);
    assert.equal(f.operation("recover").state, "unknown", "a CAS that found a third writer was settled");
    assert.notEqual(f.main(), f.info.candidate);
});
