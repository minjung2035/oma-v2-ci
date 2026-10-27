import { CanonicalHealthObserver } from "@oma/git/canonical-health";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
// Resident policy fixture owns no actor execution. Quarantine uses the real
// native backend; this is no process/authentication gate substitution.
// Phase 8 acceptance: reconcile recovers pending mail/git effects, never
// overwrites moved refs, and surfaces start-limits without reset (T68 core).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Store } from "@oma/storage";
import { requestHash } from "@oma/domain/request-identity";
import { publishedRefFor } from "@oma/domain/derived";
import { MailModule } from "@oma/mail";
import { PolicyExecution } from "./fixtures/execution.js";
import { nativeQuarantine } from "./fixtures/git-crash.js";
import { ReconcileModule } from "@oma/reconcile";
import { LifecycleModule } from "@oma/lifecycle";
import { GitModule, type GitPaths } from "@oma/git";
import type { Capability } from "@oma/contracts";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
const G = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
};
interface Env {
    dir: string;
    store: Store;
    mail: MailModule;
    units: PolicyExecution;
    git: GitModule | null;
    recon: ReconcileModule;
    seal: () => void;
}
function envOf(withGit: boolean): Env {
    const dir = mkdtempSync(join(tmpdir(), "oma-t8-"));
    const society = `p8${createHash("sha256").update(dir).digest("hex").slice(0, 20)}`;
    mkdirSync(join(dir, "state", "repos"), { recursive: true });
    const store = new Store(join(dir, "state", "runtime.sqlite"));
    store.transaction((_t) => {
        for (const [name, role, desired] of [
            ["principal", "principal", "enabled"],
            ["a", "resident", "enabled"],
            ["b", "resident", "enabled"],
        ] as const) {
            store.insertAgent({
                name,
                ...storedSpec(ALL_CAPS, "p", name),
                role,
                desired,
                incarnation: 1,
                profile: "p",
                createdBy: null,
            });
        }
    });
    const mail = createMailModule({ stateRoot: join(dir, "state"), society }, store, 64);
    const units = new PolicyExecution();
    let git: GitModule | null = null;
    if (withGit) {
        const paths: GitPaths = {
            stateRoot: join(dir, "state"),
            projectGit: join(dir, "state", "repos", "project.git"),
            contextGit: join(dir, "state", "repos", "context.git"),
            worldDir: join(dir, "state", "world"),
            society,
        };
        git = createGitModule(paths, store, mail, null, null, null, nativeQuarantine(paths));
    }
    const lifecycle = createLifecycleModule(store, units, {
        stateRoot: join(dir, "state"),
        projectGit: join(dir, "state", "repos", "project.git"),
        society,
        hasGoal: () => false,
        activationAllowed: () => true,
    }, (_parent, input) => ({
        ...input,
        modelProfile: "m",
        profile: "p",
        capabilities: [],
    }), mail);
    const recon = createReconcileModule(store, mail, git, null, units, lifecycle, {
        activationAllowed: () => true,
        projectGit: join(dir, "state", "repos", "project.git"),
        hasGoal: () => false,
    });
    return {
        dir,
        store,
        mail,
        units,
        git,
        recon,
        seal: () => {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
function seedBare(env: Env): string {
    const seedDir = join(env.dir, "seed");
    mkdirSync(seedDir, { recursive: true });
    const sh = (args: string[], cwd?: string): string => {
        const r = spawnSync("git", args, { cwd, env: G, encoding: "utf8" });
        if (r.status !== 0)
            throw new Error(`git: ${r.stderr}`);
        return (r.stdout ?? "").trim();
    };
    sh(["init", "-q", "-b", "main"], seedDir);
    writeFileSync(join(seedDir, "b.txt"), "b\n", "utf8");
    sh(["add", "-A"], seedDir);
    sh([
        "-c",
        "user.name=O",
        "-c",
        "user.email=o@localhost",
        "commit",
        "-qm",
        "base",
    ], seedDir);
    const base = sh(["rev-parse", "HEAD"], seedDir);
    const projectGit = join(env.dir, "state", "repos", "project.git");
    sh(["clone", "-q", "--bare", seedDir, projectGit]);
    sh(["--git-dir", projectGit, "symbolic-ref", "HEAD", "refs/heads/main"]);
    return base;
}
const auth = {
    actor: "a",
    incarnation: 1,
    role: "resident" as const,
    channel: "actor" as const,
    capabilities: new Set<Capability>(["mail.send"]),
    peer: { pid: 1, uid: 1000, gid: 1000 },
};
async function* iter(b: Buffer): AsyncIterable<Uint8Array> {
    yield b;
}
// ---------------------------------------------------------------------------
test("T68a: reconcile startup completes a pending accepted mail (accepted-before-materialize fixture)", async () => {
    const env = envOf(false);
    try {
        const receipt = await env.mail.send(auth, "k1", {
            to: ["b"],
            subject: "s",
            kind: "message",
            body: "x",
        });
        assert.equal(receipt.state, "succeeded"); // normal path already completes
        // simulate an accepted-pending mail op: freeze object, mark deliveries pending
        await assert.rejects(sendWithStop(env.mail, env.store, auth, "kp", { to: ["b"], subject: "pending", kind: "message", body: "recover me" }, "accepted"));
        const opId = env.store.getOperation("a", "kp")!.id;
        const before = env.store.transaction((_t) => env.store.getOperationById(opId))!;
        assert.equal(before.state, "pending");
        const res = await env.recon.startup();
        void res;
        const after = env.store.transaction((_t) => env.store.getOperationById(opId))!;
        assert.equal(after.state, "succeeded");
        assert.equal(existsSync(join(env.dir, "state", "mail", "archive", "cur")), true);
    }
    finally {
        env.seal();
    }
});
test("T68b: reconcile never overwrites a moved published ref; ref==candidate recovers", async () => {
    const env = envOf(true);
    try {
        const base = seedBare(env);
        // candidate clone + bundle via the git module (T54 path)
        const clone = join(env.dir, "cl");
        const sh = (args: string[], cwd?: string): string => {
            const r = spawnSync("git", args, { cwd, env: G, encoding: "utf8" });
            if (r.status !== 0)
                throw new Error(`git: ${r.stderr}`);
            return (r.stdout ?? "").trim();
        };
        sh([
            "clone",
            "-q",
            "--no-local",
            join(env.dir, "state", "repos", "project.git"),
            clone,
        ]);
        writeFileSync(join(clone, "f.txt"), "f\n", "utf8");
        sh(["add", "f.txt"], clone);
        sh([
            "-c",
            "user.name=A",
            "-c",
            "user.email=a@localhost",
            "commit",
            "-qm",
            "f",
        ], clone);
        const C = sh(["rev-parse", "HEAD"], clone);
        sh(["update-ref", "refs/oma/export/req-1", C], clone);
        const bundle = join(env.dir, "up.bundle");
        sh(["bundle", "create", bundle, "refs/oma/export/req-1", `^${base}`], clone);
        const content = readFileSync(bundle) as Buffer;
        const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
        const receipt = await env.git!.submit({ ...auth, capabilities: new Set(["git.submit"]) }, "ks", {
            candidate: C,
            exportRef: "refs/oma/export/req-1",
            prerequisites: [base],
            to: ["b"],
            subject: "s",
            body: "",
            paths: [],
            bundle: {
                bytes: content.length,
                sha256: sha(content),
                mediaType: "application/x-git-bundle",
            },
        }, iter(content));
        assert.equal(receipt.state, "succeeded");
        // A second accepted intent whose own immutable published ref was moved by an
        // external writer: the sweep must report the conflict, never overwrite it.
        const pendId = "op-00000000-0000-4000-8000-0000000000f1";
        const pendMessage = `m-00000000-0000-4000-8000-0000000000f1-0`;
        const pendRef = publishedRefFor("a", pendId);
        const pendExport = "refs/oma/export/pend";
        sh(["--git-dir", join(env.dir, "state", "repos", "project.git"), "update-ref", pendRef, C]);
        sh(["--git-dir", join(env.dir, "state", "repos", "project.git"), "update-ref", pendRef, base]);
        const pendPayload = { candidate: C, exportRef: pendExport, prerequisites: [], to: [], subject: "moved", body: "", paths: [] };
        env.store.transaction((_t) => {
            env.store.insertOperation({
                id: pendId,
                actor: "a",
                requestKey: "km",
                requestHash: requestHash("git.submit", pendPayload),
                kind: "git.submit",
                payloadJson: JSON.stringify(pendPayload),
                planJson: serializePlanIntent({
                    kind: "git.submit",
                    candidate: C,
                    exportRef: pendExport,
                    prerequisites: [],
                    bundle: null,
                    publishedRef: pendRef,
                    message: {
                        id: pendMessage, objectPath: `mail/objects/${pendMessage}.eml`, sha256: "0".repeat(64), bytes: 1, dateMs: 1,
                        to: ["commons"], recipients: ["a"], kind: "result", contextRevision: null,
                        replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] },
                    },
                }),
            });
            env.store.insertDeliveries([{ messageId: pendMessage, recipient: "a", operationId: pendId }]);
        });
        const res = await env.recon.sweep();
        assert.equal(sh([
            "--git-dir",
            join(env.dir, "state", "repos", "project.git"),
            "rev-parse",
            pendRef,
        ]), base);
        // The recovery observer requires the published ref to be present AND equal
        // to the accepted candidate; a different value means the publication is not
        // proven, which is an ambiguous outcome (GitPublicationObserver throws
        // REF_STATE_UNKNOWN), not a proven conflict.
        const settled = env.store.transaction((_t) => env.store.getOperationById(pendId))!;
        assert.equal(settled.state, "unknown", settled.state);
        assert.equal(settled.errorCode, null);
        assert.equal(settled.resultJson, null);
        assert.ok(res.examined >= 1);
        // Repeated reconcile converges without touching the moved ref.
        await env.recon.sweep();
        assert.equal(sh(["--git-dir", join(env.dir, "state", "repos", "project.git"), "rev-parse", pendRef]), base);
        assert.equal(env.store.transaction((_t) => env.store.getOperationById(pendId))!.state, settled.state);
    }
    finally {
        env.seal();
    }
});
test("T68c: canonical repo integrity is asserted; start-limit surface reported without reset", async () => {
    const env = envOf(true);
    try {
        seedBare(env);
        await new CanonicalHealthObserver(join(env.dir, "state", "repos", "project.git")).assertHealthy(); // clean repo passes; P0-2: the one health observation
        assert.deepEqual(env.recon.startLimitState(), []); // no failed native execution => none
    }
    finally {
        env.seal();
    }
});
test("T68d: a dead run's fsck diagnostic spool is collected -- residue neither blocks nor survives the health observation", async () => {
    const env = envOf(true);
    try {
        seedBare(env);
        const diagnostics = `${join(env.dir, "state", "repos", "project.git")}.fsck.stderr`;
        writeFileSync(diagnostics, "residue of a dead observation\n");
        await new CanonicalHealthObserver(join(env.dir, "state", "repos", "project.git")).assertHealthy();
        assert.equal(existsSync(diagnostics), false, "the spool is collected when the observation ends");
        // And the next observation runs unblocked: residue never pretends one is live.
        await new CanonicalHealthObserver(join(env.dir, "state", "repos", "project.git")).assertHealthy();
    }
    finally {
        env.seal();
    }
});
