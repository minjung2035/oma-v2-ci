import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { nativeQuarantine } from "./fixtures/git-crash.js";
import type { IntegrationPolicyReader } from "@oma/domain/integration-policy";
// Phase 7 acceptance: real Git submit/integrate/context effects and recovery.
// Updated tests are NOT_RUN in this editing session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readlinkSync, lstatSync, readdirSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { MailModule } from "@oma/mail";
import { GitModule, type GitPaths } from "@oma/git";
import type { IntegrationPolicy } from "@oma/domain/integration-policy";
import { makeValidAgent } from "./fixtures/spec.js";
import type { AuthContext, Capability, Oid } from "@oma/contracts";
const G = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" };
interface Env {
    dir: string;
    society: string;
    store: Store;
    mail: MailModule;
    git: GitModule;
    paths: GitPaths;
    seal: () => void;
}
function cleanOwnedFixture(root: string): void {
    const walk = (path: string): void => {
        if (!lstatSync(path).isDirectory())
            return;
        chmodSync(path, 0o700);
        for (const name of readdirSync(path))
            walk(join(path, name));
    };
    walk(root);
    rmSync(root, { recursive: true, force: true });
}
function envOf(integration: IntegrationPolicy | null = null, policyRevisionReader: IntegrationPolicyReader | null = null): Env {
    const dir = mkdtempSync(join(tmpdir(), "oma-t7-"));
    const society = "demo";
    mkdirSync(join(dir, "state", "repos"), { recursive: true });
    const store = new Store(join(dir, "state", "runtime.sqlite"));
    store.transaction(tx => { for (const name of ["principal", "a", "b"])
        tx.insertAgent(makeValidAgent(name, { incarnation: 1 })); });
    const mail = createMailModule({ stateRoot: join(dir, "state"), society }, store, 64);
    const paths: GitPaths = {
        stateRoot: join(dir, "state"), projectGit: join(dir, "state/repos/project.git"), contextGit: join(dir, "state/repos/context.git"),
        worldDir: join(dir, "state/world"), society,
    };
    const policy = integration ?? { policyRevision: "p1", protectedPaths: [], checks: [] };
    const git = createGitModule(paths, store, mail, policy, policyRevisionReader, null, nativeQuarantine(paths));
    return { dir, society, store, mail, git, paths, seal: () => { store.close(); cleanOwnedFixture(dir); } };
}
function sh(env: Env, args: string[], cwd?: string): string {
    const result = spawnSync("/usr/bin/git", args, { cwd: cwd ?? env.dir, env: G, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" });
    if (result.error || result.signal || result.status !== 0)
        throw new Error(`git ${args.join(" ")}: ${result.error?.message ?? result.stderr}`);
    return result.stdout.trim();
}
function commit(env: Env, cwd: string, name: string): void { sh(env, ["-c", "user.name=OMA", "-c", "user.email=oma@localhost", "commit", "-qm", name], cwd); }
function seedProject(env: Env): Oid {
    const seed = join(env.dir, "seed");
    mkdirSync(seed, { recursive: true });
    sh(env, ["init", "-q", "-b", "main"], seed);
    writeFileSync(join(seed, "base.txt"), "a".repeat(262144) + "\n");
    sh(env, ["add", "-A"], seed);
    commit(env, seed, "base");
    const base = sh(env, ["rev-parse", "HEAD"], seed);
    sh(env, ["clone", "-q", "--bare", seed, env.paths.projectGit]);
    sh(env, ["--git-dir", env.paths.projectGit, "symbolic-ref", "HEAD", "refs/heads/main"]);
    return base;
}
function makeBundle(env: Env, clone: string, candidate: Oid, base: Oid): {
    content: Buffer;
    exportRef: string;
} {
    const exportRef = "refs/oma/export/req-1";
    sh(env, ["update-ref", exportRef, candidate], clone);
    const path = join(env.dir, "upload.bundle");
    sh(env, ["bundle", "create", path, exportRef, `^${base}`], clone);
    return { content: readFileSync(path), exportRef };
}
function auth(actor: string, caps: Capability[]): AuthContext {
    return { actor, incarnation: 1, role: actor === "principal" ? "principal" : "resident", channel: "actor",
        capabilities: new Set(caps), peer: { pid: 1, uid: 1000, gid: 1000 } };
}
async function* iter(bytes: Buffer): AsyncIterable<Uint8Array> { yield bytes; }
function publishedFastForward(env: Env): {
    base: Oid;
    candidate: Oid;
} {
    const base = seedProject(env);
    const work = join(env.dir, "policy-candidate");
    sh(env, ["clone", "-q", env.paths.projectGit, work]);
    writeFileSync(join(work, "policy.txt"), "candidate\n");
    sh(env, ["add", "policy.txt"], work);
    commit(env, work, "policy");
    const candidate = sh(env, ["rev-parse", "HEAD"], work);
    sh(env, ["--git-dir", env.paths.projectGit, "fetch", "-q", work, "HEAD"]);
    sh(env, ["--git-dir", env.paths.projectGit, "update-ref", "refs/oma/published/a/op-00000000-0000-4000-8000-000000000071", candidate]);
    return { base, candidate };
}
const main = (env: Env): string => sh(env, ["--git-dir", env.paths.projectGit, "rev-parse", "refs/heads/main"]);
const failure = (code: string) => (error: unknown): boolean => error instanceof StoreError && error.code === code;
function restorePendingCheckpointForTest(env: Env, id: string): void {
    const before = env.store.getOperationById(id);
    assert.ok(before);
    const raw = new DatabaseSync(env.store.path);
    try {
        raw.prepare("UPDATE operations SET state='pending', result_json=NULL, error_code=NULL WHERE id=?").run(id);
    }
    finally {
        raw.close();
    }
    const after = env.store.getOperationById(id);
    assert.ok(after);
    assert.equal(after.state, "pending");
    assert.equal(after.planJson, before.planJson);
    assert.equal(after.payloadJson, before.payloadJson);
}
test("T53: independent clones — A's refs/state never leak into B or canonical", () => {
    const env = envOf();
    try {
        const seed = join(env.dir, "seed");
        mkdirSync(seed, { recursive: true });
        sh(env, ["init", "-q", "-b", "main"], seed);
        writeFileSync(join(seed, "f.txt"), "v1\n");
        sh(env, ["add", "-A"], seed);
        commit(env, seed, "init");
        sh(env, ["clone", "-q", "--bare", seed, env.paths.projectGit]);
        sh(env, ["--git-dir", env.paths.projectGit, "symbolic-ref", "HEAD", "refs/heads/main"]);
        const a = join(env.dir, "a");
        sh(env, ["clone", "-q", env.paths.projectGit, a]);
        sh(env, ["update-ref", "refs/custom/x", "HEAD"], a);
        writeFileSync(join(a, ".git", "config"), "[core]\n\tbare = false\n");
        const b = join(env.dir, "b");
        sh(env, ["clone", "-q", env.paths.projectGit, b]);
        assert.equal(sh(env, ["rev-parse", "main"], b), sh(env, ["rev-parse", "main"], a));
        const custom = spawnSync("/usr/bin/git", ["--git-dir", join(b, ".git"), "rev-parse", "refs/custom/x"], { env: G, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" });
        assert.equal(custom.error, undefined);
        assert.equal(custom.signal, null);
        assert.notEqual(custom.status, 0);
    }
    finally {
        env.seal();
    }
});
test("T54: submit with incremental bundle creates the published ref and the result mail; peer fetches exact C", async () => {
    const env = envOf();
    try {
        const base = seedProject(env);
        const clone = join(env.dir, "clone-x");
        sh(env, ["clone", "-q", "--no-local", env.paths.projectGit, clone]);
        writeFileSync(join(clone, "fix.txt"), "fix\n");
        sh(env, ["add", "fix.txt"], clone);
        commit(env, clone, "fix");
        const candidate = sh(env, ["rev-parse", "HEAD"], clone);
        const { content, exportRef } = makeBundle(env, clone, candidate, base);
        const receipt = await env.git.submit(auth("a", ["git.submit"]), "k1", { candidate, exportRef, prerequisites: [base], to: ["commons"], subject: "fix", body: "done", paths: ["fix.txt"],
            bundle: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/x-git-bundle" } }, iter(content));
        assert.equal(receipt.state, "succeeded");
        assert.ok(receipt.result?.kind === "git.submit");
        const ref = receipt.result.publishedRef;
        assert.equal(sh(env, ["--git-dir", env.paths.projectGit, "rev-parse", ref]), candidate);
        assert.equal(existsSync(join(env.dir, "state/mail/archive/cur")), true);
        const operation = env.store.getOperation("a", "k1");
        assert.ok(operation?.kind === "git.submit");
        assert.equal(operation.state, "succeeded");
        assert.deepEqual(operation.plan.message.to, ["commons"]);
        assert.deepEqual([...operation.plan.message.recipients].sort(), ["a", "b"]);
        const peer = join(env.dir, "peer");
        sh(env, ["clone", "-q", env.paths.projectGit, peer]);
        sh(env, ["fetch", "-q", "origin", ref], peer);
        assert.equal(sh(env, ["rev-parse", "FETCH_HEAD"], peer), candidate);
    }
    finally {
        env.seal();
    }
});
test("GIT-006: bundle with an extra ref fails closed after durable intent", async () => {
    const env = envOf();
    try {
        const base = seedProject(env);
        const clone = join(env.dir, "clone-hostile");
        sh(env, ["clone", "-q", "--no-local", env.paths.projectGit, clone]);
        writeFileSync(join(clone, "hostile.txt"), "x\n");
        sh(env, ["add", "hostile.txt"], clone);
        commit(env, clone, "hostile");
        const candidate = sh(env, ["rev-parse", "HEAD"], clone);
        const exportRef = "refs/oma/export/hostile";
        sh(env, ["update-ref", exportRef, candidate], clone);
        sh(env, ["update-ref", "refs/oma/extra", candidate], clone);
        const bundlePath = join(env.dir, "hostile.bundle");
        sh(env, ["bundle", "create", bundlePath, exportRef, "refs/oma/extra", `^${base}`], clone);
        const content = readFileSync(bundlePath);
        await assert.rejects(env.git.submit(auth("a", ["git.submit"]), "hostile-bundle", { candidate, exportRef, prerequisites: [base], to: ["b"], subject: "s", body: "", paths: [],
            bundle: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/x-git-bundle" } }, iter(content)), failure("BUNDLE_INVALID"));
        assert.equal(env.store.getOperation("a", "hostile-bundle")?.state, "failed");
        assert.equal(env.store.getOperation("a", "hostile-bundle")?.errorCode, "BUNDLE_INVALID");
    }
    finally {
        env.seal();
    }
});
test("T55/T59: same key resubmits the frozen candidate; a conflicting ref OID is refused", async () => {
    const env = envOf();
    try {
        const base = seedProject(env);
        const clone = join(env.dir, "clone-y");
        sh(env, ["clone", "-q", "--no-local", env.paths.projectGit, clone]);
        writeFileSync(join(clone, "y.txt"), "y\n");
        sh(env, ["add", "y.txt"], clone);
        commit(env, clone, "y");
        const candidate = sh(env, ["rev-parse", "HEAD"], clone);
        const { content, exportRef } = makeBundle(env, clone, candidate, base);
        const input = { candidate, exportRef, prerequisites: [base], to: ["b"], subject: "y", body: "", paths: [], bundle: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/x-git-bundle" as const } };
        const receipt = await env.git.submit(auth("a", ["git.submit"]), "k1", input, iter(content));
        assert.equal(receipt.state, "succeeded");
        const again = await env.git.submit(auth("a", ["git.submit"]), "k1", input, iter(content));
        assert.equal(again.operation, receipt.operation);
        assert.ok(receipt.result?.kind === "git.submit");
        const ref = receipt.result.publishedRef;
        restorePendingCheckpointForTest(env, receipt.operation);
        sh(env, ["--git-dir", env.paths.projectGit, "update-ref", ref, base]);
        await env.git.reconcile(receipt.operation);
        assert.equal(sh(env, ["--git-dir", env.paths.projectGit, "rev-parse", ref]), base, "foreign ref is never overwritten");
        assert.equal(env.store.getOperationById(receipt.operation)?.state, "unknown");
        assert.equal(env.store.getOperationById(receipt.operation)?.errorCode, null);
        const uncertain = await env.git.submit(auth("a", ["git.submit"]), "k1", input, iter(content));
        assert.equal(uncertain.operation, receipt.operation);
        assert.equal(uncertain.state, "unknown");
        assert.equal(sh(env, ["--git-dir", env.paths.projectGit, "rev-parse", ref]), base);
        assert.equal(again.operation, receipt.operation);
    }
    finally {
        env.seal();
    }
});
test("T60/T61: integrate CAS — first wins, stale/undescendant/protected refused, main unchanged on refusal", async () => {
    const env = envOf({ policyRevision: "p1", protectedPaths: ["secret/"], checks: [] });
    try {
        const base = seedProject(env);
        const c1r = join(env.dir, "c1");
        sh(env, ["clone", "-q", env.paths.projectGit, c1r]);
        writeFileSync(join(c1r, "c1.txt"), "1\n");
        sh(env, ["add", "c1.txt"], c1r);
        commit(env, c1r, "c1");
        const c1 = sh(env, ["rev-parse", "HEAD"], c1r);
        const c2r = join(env.dir, "c2");
        sh(env, ["clone", "-q", env.paths.projectGit, c2r]);
        writeFileSync(join(c2r, "c2.txt"), "2\n");
        sh(env, ["add", "c2.txt"], c2r);
        commit(env, c2r, "c2");
        const c2 = sh(env, ["rev-parse", "HEAD"], c2r);
        for (const [candidate, clone] of [[c1, c1r], [c2, c2r]]) {
            assert.ok(candidate && clone);
            const { content, exportRef } = makeBundle(env, clone, candidate, base);
            const submitted = await env.git.submit(auth("a", ["git.submit"]), `pub-${candidate.slice(0, 8)}`, { candidate, exportRef, prerequisites: [base], to: ["b"], subject: "s", body: "", paths: [],
                bundle: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/x-git-bundle" } }, iter(content));
            assert.equal(submitted.state, "succeeded");
        }
        const first = await env.git.integrate(auth("a", ["code.integrate"]), "in1", { candidate: c1, expected: base });
        assert.equal(first.state, "succeeded");
        assert.equal(main(env), c1);
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "in2", { candidate: c2, expected: base }), failure("STALE_BASE"));
        assert.equal(main(env), c1);
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "in3", { candidate: c2, expected: c1 }), failure("NOT_DESCENDANT"));
        assert.equal(main(env), c1);
        const c3r = join(env.dir, "c3");
        sh(env, ["clone", "-q", env.paths.projectGit, c3r]);
        mkdirSync(join(c3r, "secret"));
        writeFileSync(join(c3r, "secret/key.txt"), "k\n");
        sh(env, ["add", "-A"], c3r);
        commit(env, c3r, "c3");
        const c3 = sh(env, ["rev-parse", "HEAD"], c3r);
        const { content, exportRef } = makeBundle(env, c3r, c3, c1);
        await env.git.submit(auth("a", ["git.submit"]), "pubc3", { candidate: c3, exportRef, prerequisites: [c1], to: ["b"], subject: "s", body: "", paths: [],
            bundle: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/x-git-bundle" } }, iter(content));
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "in4", { candidate: c3, expected: c1 }), failure("PROTECTED_PATH"));
        assert.equal(main(env), c1);
    }
    finally {
        env.seal();
    }
});
test("INT-003: accepted stop intent cancels before main CAS", async () => {
    const env = envOf();
    try {
        const base = seedProject(env);
        sh(env, ["--git-dir", env.paths.projectGit, "update-ref", "refs/oma/published/a/op-00000000-0000-4000-8000-000000000073", base]);
        const transaction = env.store.transaction.bind(env.store);
        env.store.transaction = body => {
            const result = transaction(body);
            if (env.store.getOperation("a", "stop-before-cas")?.state === "pending" && env.store.getAgent("a")!.desired === "enabled")
                transaction(() => env.store.updateAgent({ name: "a", desired: "stopped" }));
            return result;
        };
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "stop-before-cas", { candidate: base, expected: base }), failure("CANCELLED_BEFORE_COMMIT"));
        assert.equal(main(env), base);
        assert.equal(env.store.getOperation("a", "stop-before-cas")?.errorCode, "CANCELLED_BEFORE_COMMIT");
    }
    finally {
        env.seal();
    }
});
test("T62: policy revision is reread before CAS and a race fails closed", async () => {
    // Accepted under p1, changed to p2 before CAS: the re-check fails closed (D02).
    let reads = 0;
    const env = envOf(null, () => ({ policyRevision: ++reads === 1 ? "p1" : "p2", protectedPaths: [], checks: [] }));
    try {
        const { base, candidate } = publishedFastForward(env);
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "policy-race", { candidate, expected: base }), failure("POLICY_CHANGED"));
        assert.equal(reads, 2);
        assert.equal(main(env), base);
        assert.equal(env.store.getOperation("a", "policy-race")?.state, "failed");
    }
    finally {
        env.seal();
    }
});
test("DR8 / CFG-005, TUI-007: an integration after a revision-only edit is judged by the host's current revision", async () => {
    // The broker started under p1; the Human's edit made it p2 and left the facts
    // alone. The thirteenth functional run found every later integrate refused.
    const env = envOf(null, () => ({ policyRevision: "p2", protectedPaths: [], checks: [] }));
    try {
        const { base, candidate } = publishedFastForward(env);
        const receipt = await env.git.integrate(auth("a", ["code.integrate"]), "after-edit", { candidate, expected: base });
        assert.equal(receipt.state, "succeeded");
        assert.equal(main(env), candidate);
        const accepted = env.store.getOperation("a", "after-edit");
        assert.ok(accepted?.kind === "git.integrate");
        assert.equal(accepted.plan.policyRevision, "p2", "accepted under the revision the broker started with");
    }
    finally {
        env.seal();
    }
});
test("T62-negative, DR13: a policy that cannot be read cannot integrate, and is not called a changed one", async () => {
    const env = envOf(null, () => { throw new Error("malformed policy"); });
    try {
        const { base, candidate } = publishedFastForward(env);
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "policy-malformed", { candidate, expected: base }), failure("BROKER_UNAVAILABLE"));
        // Refused before acceptance: nothing is accepted under a policy that cannot be read.
        assert.equal(main(env), base);
        assert.equal(env.store.getOperation("a", "policy-malformed"), null);
    }
    finally {
        env.seal();
    }
});
test("DR13 / INT-003, P0-5: a policy unreadable at CAS leaves the accepted integration pending, and recovery integrates once it reads", async () => {
    // Readable at acceptance (p1), unreadable just before CAS, readable again later.
    let reads = 0;
    let readable = true;
    const env = envOf(null, () => { reads += 1; if (reads === 2)
        readable = false; if (!readable)
        throw new Error("EIO"); return { policyRevision: "p1", protectedPaths: [], checks: [] }; });
    try {
        const { base, candidate } = publishedFastForward(env);
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "policy-gone", { candidate, expected: base }), failure("BROKER_UNAVAILABLE"));
        const pending = env.store.getOperation("a", "policy-gone");
        assert.equal(pending?.state, "pending", "not knowing the policy is not a failed integration");
        assert.equal(main(env), base, "nothing moved without a policy");
        readable = true;
        await env.git.reconcile(pending!.id);
        assert.equal(env.store.getOperation("a", "policy-gone")?.state, "succeeded");
        assert.equal(main(env), candidate);
    }
    finally {
        env.seal();
    }
});
test("T62-resource / DR18: a policy with integration checks is not supported and fails closed before candidate execution", async () => {
    const env = envOf({ policyRevision: "p1", protectedPaths: [], checks: [{ id: "resource-boundary", argv: ["true"], env: {},  }] });

    env.paths.checkAssetsDir = "/trusted/checks";
    try {
        const { base, candidate } = publishedFastForward(env);
        await assert.rejects(env.git.integrate(auth("a", ["code.integrate"]), "resource-boundary", { candidate, expected: base }), failure("UNSUPPORTED_PROFILE"));
        assert.equal(main(env), base);
    }
    finally {
        env.seal();
    }
});
test("T65/T67: context publish — unsafe paths/missing GOAL rejected; concurrent same-expected one succeeds", async () => {
    const env = envOf();
    try {
        const goal = Buffer.from("# GOAL\n");
        for (const path of ["../evil", "notes.md"]) {
            await assert.rejects(env.git.publishContext(auth("principal", ["context.publish"]), `ctx-${path === "../evil" ? "traversal" : "missing-goal"}`, {
                expected: null, entries: [{ path, bytes: goal.length, sha256: sha256Hex(goal) }], content: { bytes: goal.length, sha256: sha256Hex(goal), mediaType: "application/vnd.oma.context-v1" }
            }, iter(goal)), failure("INVALID_REQUEST"));
        }
        const first = await env.git.publishContext(auth("principal", ["context.publish"]), "ctx1", { expected: null,
            entries: [{ path: "GOAL.md", bytes: goal.length, sha256: sha256Hex(goal) }], content: { bytes: goal.length, sha256: sha256Hex(goal), mediaType: "application/vnd.oma.context-v1" } }, iter(goal));
        assert.equal(first.state, "succeeded");
        assert.ok(first.result?.kind === "context.publish");
        const rev1 = first.result.revision;
        assert.equal(existsSync(join(env.paths.worldDir, "context/revisions", rev1, "GOAL.md")), true);
        assert.equal(readlinkSync(join(env.paths.worldDir, "context/current")), `revisions/${rev1}`);
        const goal2 = Buffer.from("# GOAL v2\n");
        const attempt = async (key: string, expected: string | null): Promise<"succeeded" | "conflict" | "busy" | "other"> => {
            try {
                const receipt = await env.git.publishContext(auth("principal", ["context.publish"]), key, { expected,
                    entries: [{ path: "GOAL.md", bytes: goal2.length, sha256: sha256Hex(goal2) }], content: { bytes: goal2.length, sha256: sha256Hex(goal2), mediaType: "application/vnd.oma.context-v1" } }, iter(goal2));
                return receipt.state === "succeeded" ? "succeeded" : "other";
            }
            catch (error) {
                if (failure("CONTEXT_CONFLICT")(error))
                    return "conflict";
                // One writer at a time with no waiting chain: a request that arrives
                // while another holds the repository slot is rejected before admission.
                if (failure("BROKER_UNAVAILABLE")(error))
                    return "busy";
                return "other";
            }
        };
        const results = await Promise.all([attempt("ctx2a", rev1), attempt("ctx2b", rev1)]);
        assert.equal(results.filter(outcome => outcome === "succeeded").length, 1, results.join(","));
        const loser = results.find(outcome => outcome !== "succeeded")!;
        assert.ok(["conflict", "busy"].includes(loser), loser);
        // A busy loser never entered admission, so the same key retried now observes
        // the moved base and fails closed instead of publishing a second candidate.
        if (loser === "busy") {
            const retryKey = results[0] === "busy" ? "ctx2a" : "ctx2b";
            assert.equal(await attempt(retryKey, rev1), "conflict");
        }
        const rev2 = sh(env, ["--git-dir", env.paths.contextGit, "rev-parse", "refs/heads/main"]);
        assert.equal(sh(env, ["--git-dir", env.paths.contextGit, "rev-parse", `${rev2}^`]), rev1);
    }
    finally {
        env.seal();
    }
});
test("CTX-004: pending context publication after CAS is completed by reconcile", async () => {
    const env = envOf();
    try {
        const goal = Buffer.from("# GOAL recovery\n");
        const original = env.mail.publishGated.bind(env.mail);
        env.mail.publishGated = async () => { throw new Error("simulated process loss after context effect"); };
        await assert.rejects(env.git.publishContext(auth("principal", ["context.publish"]), "ctx-recovery", { expected: null,
            entries: [{ path: "GOAL.md", bytes: goal.length, sha256: sha256Hex(goal) }], content: { bytes: goal.length, sha256: sha256Hex(goal), mediaType: "application/vnd.oma.context-v1" } }, iter(goal)));
        env.mail.publishGated = original;
        const pending = env.store.getOperation("principal", "ctx-recovery");
        assert.ok(pending?.kind === "context.publish");
        assert.equal(pending.state, "unknown", "post-CAS notification failure preserves possible effect, not a false terminal failure");
        assert.ok(pending.plan.candidate);
        assert.equal(env.git.hasCommittedContext(), false);
        assert.equal(sh(env, ["--git-dir", env.paths.contextGit, "rev-parse", "refs/heads/main"]), pending.plan.candidate);
        const originalPlan = pending.planJson;
        await env.git.reconcile(pending.id);
        assert.equal(env.store.getOperation("principal", "ctx-recovery")?.state, "succeeded");
        assert.equal(env.store.getOperation("principal", "ctx-recovery")?.planJson, originalPlan);
        assert.equal(env.git.hasCommittedContext(), true);
    }
    finally {
        env.seal();
    }
});
function sha256Hex(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
