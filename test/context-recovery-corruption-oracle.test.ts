import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ResolvedAgentSpec } from "@oma/contracts";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { MailModule } from "@oma/mail";
import { GitModule } from "@oma/git";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { resolvedSpec } from "./fixtures/spec.js";
async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }
function writableDirectories(directory: string): void {
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory())
            writableDirectories(join(directory, entry.name));
    }
}
test("corrupt accepted context rows fail before Git observation or snapshot/mail publication", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-context-recovery-corruption-"));
    const stateRoot = join(root, "state");
    mkdirSync(stateRoot);
    const database = join(stateRoot, "runtime.sqlite");
    const store = new Store(database, 5, { society: "demo" });
    const mail = createMailModule({ stateRoot, society: "demo" }, store, 16);
    const git = createGitModule({
        stateRoot, society: "demo", projectGit: join(stateRoot, "repos", "project.git"),
        contextGit: join(stateRoot, "repos", "context.git"), worldDir: join(stateRoot, "world"),
    }, store, mail, null);
    const auth: AuthContext = {
        actor: "principal", incarnation: 0, role: "principal", channel: "actor",
        capabilities: new Set(["context.publish"]),
        peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() },
    };
    try {
        const specJson = resolvedSpec(["context.publish"], "p", "principal");
        const spec = JSON.parse(specJson) as ResolvedAgentSpec;
        store.transaction(() => store.insertAgent({
            name: "principal", specHash: resolvedSpecDigest(spec), role: "principal", desired: "enabled",
            incarnation: 0, profile: "p", createdBy: null, specJson,
        }));
        const goal = Buffer.from("# GOAL\nA real accepted context snapshot.\n", "utf8");
        const sha256 = createHash("sha256").update(goal).digest("hex");
        const receipt = await git.publishContext(auth, "accepted-corruption-control", {
            expected: null, entries: [{ path: "GOAL.md", bytes: goal.length, sha256 }],
            content: { bytes: goal.length, sha256, mediaType: "application/vnd.oma.context-v1" },
        }, once(goal));
        assert.equal(receipt.state, "succeeded", "the real publication is the positive control");
        const accepted = store.getOperationById(receipt.operation);
        assert.ok(accepted);
        if (accepted.kind !== "context.publish")
            assert.fail("expected context operation");
        const plan = accepted.plan;
        const first = plan.entries[0];
        assert.ok(first);
        const originalPlanJson = accepted.planJson;
        const originalResultJson = accepted.resultJson;
        const raw = new DatabaseSync(database);
        try {
            // Reproduce the legitimate crash checkpoint after effects but before the
            // final ledger transition. This is explicit fault injection, never repair.
            raw.prepare("UPDATE operations SET state='pending', result_json=NULL, error_code=NULL WHERE id=?").run(accepted.id);
            assert.equal(store.getOperationById(accepted.id)?.state, "pending");
            const calls: string[] = [];
            const repository = Reflect.get(Reflect.get(git, "repository"), "contextRepository");
            const intercepted = ["current", "prepareCandidate", "publishSnapshot"];
            for (const name of intercepted) {
                const method: unknown = Reflect.get(repository, name);
                assert.equal(typeof method, "function", `update the recovery effect seam if ${name} moves`);
                Object.defineProperty(repository, name, {
                    configurable: true,
                    value: () => { calls.push(name); throw new Error(`unexpected effect: ${name}`); },
                });
            }
            const publishGated = mail.publishGated;
            mail.publishGated = async () => { calls.push("mail.publishGated"); throw new Error("unexpected mail publication"); };
            try {
                const damagedPlans: Array<[
                    string,
                    unknown
                ]> = [
                    ["parent traversal", { ...plan, entries: [{ ...first, path: "../escape.md" }] }],
                    ["absolute path", { ...plan, entries: [{ ...first, path: "/tmp/escape.md" }] }],
                    ["Git control path", { ...plan, entries: [{ ...first, path: ".git/config" }] }],
                    ["duplicate paths", { ...plan, entries: [first, first] }],
                    ["unsorted paths", { ...plan, entries: [{ ...first, path: "RATIONALE.md" }, first] }],
                    ["missing GOAL", { ...plan, entries: [{ ...first, path: "RATIONALE.md" }] }],
                    ["byte total mismatch", { ...plan, entries: [{ ...first, bytes: first.bytes + 1 }] }],
                    ["negative bytes", { ...plan, entries: [{ ...first, bytes: -1 }] }],
                    ["unsafe aggregate", { ...plan, entries: [{ ...first, bytes: Number.MAX_SAFE_INTEGER }, { ...first, path: "RATIONALE.md" }] }],
                    ["different staging root", { ...plan, stagingPath: join(root, "outside") }],
                    ["wrong ordinal", { ...plan, message: { ...plan.message, id: `${plan.message.id.slice(0, -1)}1` } }],
                    ["wrong object path", { ...plan, message: { ...plan.message, objectPath: "mail/objects/foreign.eml" } }],
                    ["candidate relation", { ...plan, message: { ...plan.message, contextRevision: "f".repeat(40) } }],
                    ["missing recipients", { ...plan, message: { ...plan.message, recipients: undefined } }],
                ];
                for (const [label, damaged] of damagedPlans) {
                    const damagedJson = JSON.stringify(damaged);
                    raw.prepare("UPDATE operations SET plan_json=? WHERE id=?").run(damagedJson, accepted.id);
                    const isCorrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";
                    assert.throws(() => store.getOperationById(accepted.id), isCorrupt, label);
                    await assert.rejects(git.reconcile(accepted.id), isCorrupt, label);
                    assert.deepEqual(calls, [], label);
                    const retained: Record<string, unknown> | undefined = raw.prepare("SELECT plan_json FROM operations WHERE id=?").get(accepted.id);
                    assert.equal(retained?.plan_json, damagedJson, "decoding must not silently repair corruption");
                    raw.prepare("UPDATE operations SET plan_json=? WHERE id=?").run(originalPlanJson, accepted.id);
                    assert.equal(store.getOperationById(accepted.id)?.kind, "context.publish", "restored positive control");
                }
            }
            finally {
                for (const name of intercepted)
                    Reflect.deleteProperty(repository, name);
                mail.publishGated = publishGated;
                raw.prepare("UPDATE operations SET plan_json=?, state='succeeded', result_json=?, error_code=NULL WHERE id=?")
                    .run(originalPlanJson, originalResultJson, accepted.id);
            }
        }
        finally {
            raw.close();
        }
        assert.equal(store.getOperationById(accepted.id)?.state, "succeeded");
    }
    finally {
        store.close();
        if (existsSync(root)) {
            writableDirectories(root);
            rmSync(root, { recursive: true, force: true });
        }
    }
});
