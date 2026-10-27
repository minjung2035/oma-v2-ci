import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
// R01: actual Git bytes and real durable acceptance; no kernel/Pi gate is bypassed.
// Authored without execution (NOT_RUN). Independent expected bytes/state are literal.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { GitModule } from "@oma/git";
import { MailModule } from "@oma/mail";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
import type { AuthContext } from "@oma/contracts";
import { removeTree } from "./fixtures/cleanup.js";
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const actor = (name: string): AuthContext => ({ actor: name, incarnation: 0,
    role: name === "principal" ? "principal" : "resident", channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 } });
function seed(store: Store, name: string): void {
    store.transaction(() => store.insertAgent({ name, ...storedSpec(ALL_CAPS, "p", name),
        role: name === "principal" ? "principal" : "resident", desired: "enabled", incarnation: 0,
        profile: "p", createdBy: null }));
}
for (const scenario of [
    { title: "positive unrelated path", file: "plain.txt", existing: true, protected: ["other.txt"], rejected: false, status: "M" },
    { title: "status-like actual filename is protected", file: "M secret.txt", existing: true, protected: ["M secret.txt"], rejected: true, status: "M" },
    { title: "status token A is not a filename", file: "ordinary.txt", existing: false, protected: ["A"], rejected: false, status: "A" },
]) {
    test(`R01 INT-001: ${scenario.title}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "oma-r01-git-"));
        const repo = join(root, "project");
        const state = join(root, "state");
        mkdirSync(repo);
        mkdirSync(state);
        const git = (args: string[]): string => {
            const result = spawnSync("/usr/bin/git", args, { cwd: repo, encoding: "utf8", timeout: 10000,
                env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim();
        };
        const store = new Store(join(state, "runtime.sqlite"));
        try {
            seed(store, "alice");
            git(["init", "-q", "-b", "main"]);
            writeFileSync(join(repo, "seed.txt"), "base\n");
            if (scenario.existing)
                writeFileSync(join(repo, scenario.file), "before\n");
            git(["add", "--all"]);
            git(["-c", "user.name=R01", "-c", "user.email=r01@example.invalid", "commit", "-qm", "base"]);
            const base = git(["rev-parse", "HEAD"]);
            writeFileSync(join(repo, scenario.file), "after\n");
            git(["add", "--all"]);
            git(["-c", "user.name=R01", "-c", "user.email=r01@example.invalid", "commit", "-qm", "candidate"]);
            const candidate = git(["rev-parse", "HEAD"]);
            const bytes = spawnSync("/usr/bin/git", ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", base, candidate], { cwd: repo, timeout: 10000 });
            assert.equal(bytes.status, 0);
            assert.deepEqual(bytes.stdout, Buffer.from(`${scenario.status}\0${scenario.file}\0`));
            git(["update-ref", "refs/oma/published/alice/fixture", candidate]);
            git(["update-ref", "refs/heads/main", base]);
            const mail = createMailModule({ stateRoot: state, society: "demo" }, store, 8);
            const module = createGitModule({ stateRoot: state, society: "demo", projectGit: join(repo, ".git"),
                contextGit: join(state, "context.git"), worldDir: join(state, "world") }, store, mail, { policyRevision: "p1", protectedPaths: scenario.protected, checks: [] });
            if (scenario.rejected) {
                await assert.rejects(module.integrate(actor("alice"), "protect", { expected: base, candidate }), (error: unknown) => error instanceof StoreError && error.code === "PROTECTED_PATH");
                assert.equal(git(["rev-parse", "refs/heads/main"]), base);
                assert.equal(store.getOperation("alice", "protect")?.state, "failed");
            }
            else {
                const receipt = await module.integrate(actor("alice"), "protect", { expected: base, candidate });
                assert.equal(receipt.state, "succeeded");
                assert.equal(git(["rev-parse", "refs/heads/main"]), candidate);
            }
            assert.equal(git(["rev-parse", "refs/oma/published/alice/fixture"]), candidate);
            assert.equal(readFileSync(join(repo, scenario.file), "utf8"), "after\n");
        }
        finally {
            store.close();
            removeTree(root);
        }
    });
}
for (const corrupt of [false, true]) {
    test(`R01 CTX/DB-009: accepted context ${corrupt ? "path traversal stops before recovery effects" : "valid control recovers"}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "oma-r01-context-"));
        const path = join(root, "runtime.sqlite");
        const store = new Store(path);
        const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 8);
        const module = createGitModule({ stateRoot: root, society: "demo", projectGit: join(root, "repos/project.git"),
            contextGit: join(root, "repos/context.git"), worldDir: join(root, "world") }, store, mail, null);
        try {
            seed(store, "principal");
            const original = store.transaction.bind(store);
            let interrupted = false;
            store.transaction = ((body: Parameters<Store["transaction"]>[0]) => {
                const result = original(body);
                const op = store.getOperation("principal", "accepted-context");
                if (!interrupted && op?.state === "pending") {
                    interrupted = true;
                    throw new Error("R01 crash after durable acceptance");
                }
                return result;
            }) as Store["transaction"];
            const goal = Buffer.from("# GOAL\nvalid accepted fixture\n");
            async function* once(): AsyncIterable<Uint8Array> { yield goal; }
            await assert.rejects(module.publishContext(actor("principal"), "accepted-context", {
                expected: null, entries: [{ path: "GOAL.md", bytes: goal.length, sha256: sha(goal) }],
                content: { bytes: goal.length, sha256: sha(goal), mediaType: "application/vnd.oma.context-v1" },
            }, once()), /R01 crash after durable acceptance/);
            store.transaction = original;
            const op = store.getOperation("principal", "accepted-context");
            assert.ok(op);
            assert.equal(op.state, "pending");
            const plan = JSON.parse(op.planJson).intent as {
                entries: {
                    path: string;
                }[];
                message: {
                    id: string;
                };
            };
            const originalObject = readFileSync(mail.objectPath(plan.message.id as never));
            if (!corrupt) {
                await module.reconcile(op.id);
                assert.equal(store.getOperationById(op.id)?.state, "succeeded");
            }
            else {
                // Only one field changes, through a raw connection AFTER normal acceptance.
                plan.entries[0]!.path = "../outside.md";
                const raw = new DatabaseSync(path);
                try {
                    raw.prepare("UPDATE operations SET plan_json=? WHERE id=?").run(serializePlanIntent(plan), op.id);
                    let effectEntries = 0;
                    Reflect.set(module, "reconcileContext", async () => { effectEntries++; });
                    await assert.rejects(module.reconcile(op.id), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
                    assert.equal(effectEntries, 0, "untrusted plan reached the physical recovery boundary");
                    assert.equal(raw.prepare("SELECT state FROM operations WHERE id=?").get(op.id)?.state, "pending");
                }
                finally {
                    raw.close();
                }
            }
            assert.deepEqual(readFileSync(mail.objectPath(plan.message.id as never)), originalObject);
        }
        finally {
            store.close();
            removeTree(root);
        }
    });
}
