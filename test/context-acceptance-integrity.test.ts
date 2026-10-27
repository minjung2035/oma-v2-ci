import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { MailModule, parseEmlHeaders } from "@oma/mail";
import { GitModule } from "@oma/git";
import { isValidFullOid } from "@oma/domain/identifiers";
import { makeValidAgent } from "./fixtures/spec.js";
import type { AuthContext } from "@oma/contracts";
import type { OperationOf } from "@oma/protocol/operation-codec";
import { removeTree } from "./fixtures/cleanup.js";
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }
test("CTX-003/DB-009: T-context-accept already freezes candidate and matching EML context", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-context-accept-"));
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    const store = new Store(join(state, "runtime.sqlite"));
    const mail = createMailModule({ stateRoot: state, society: "demo" }, store, 16);
    const git = createGitModule({
        stateRoot: state, projectGit: join(state, "repos", "project.git"), contextGit: join(state, "repos", "context.git"),
        worldDir: join(state, "world"), society: "demo",
    }, store, mail, null);
    const auth: AuthContext = { actor: "principal", incarnation: 0, role: "principal", channel: "actor", capabilities: new Set(["context.publish"]),
        peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
    try {
        store.transaction(() => store.insertAgent(makeValidAgent("principal")));
        assert.equal(store.getAgent("principal")?.name, "principal", "normal fixture must decode before acceptance observation");
        const accepted: {
            plan: OperationOf<"context.publish">["plan"] | null;
        } = { plan: null };
        const transaction = store.transaction.bind(store);
        store.transaction = new Proxy(transaction, {
            apply(target, receiver, args) {
                const result = Reflect.apply(target, receiver, args);
                if (accepted.plan === null) {
                    const operation = store.getOperation("principal", "ctx-preaccept");
                    if (operation?.kind === "context.publish" && operation.state === "pending")
                        accepted.plan = operation.plan;
                }
                return result;
            },
        });
        const goal = Buffer.from("# GOAL\nfreeze candidate before acceptance\n", "utf8");
        const receipt = await git.publishContext(auth, "ctx-preaccept", {
            expected: null, entries: [{ path: "GOAL.md", bytes: goal.length, sha256: sha256(goal) }],
            content: { bytes: goal.length, sha256: sha256(goal), mediaType: "application/vnd.oma.context-v1" },
        }, once(goal));
        assert.equal(receipt.state, "succeeded");
        assert.ok(accepted.plan, "context operation was never observed at T-context-accept");
        assert.ok(isValidFullOid(accepted.plan.candidate), "candidate must be frozen before acceptance");
        assert.equal(accepted.plan.message.contextRevision, accepted.plan.candidate, "MessagePlan contextRevision must equal the accepted candidate");
        const object = mail.objectPath(accepted.plan.message.id);
        assert.equal(existsSync(object), true);
        const headers = parseEmlHeaders(readFileSync(object, "utf8"));
        assert.equal(headers.omaContext, accepted.plan.candidate);
        assert.equal(headers.dateMs, Math.floor(accepted.plan.message.dateMs / 1000) * 1000);
        assert.ok(receipt.result?.kind === "context.publish");
        assert.equal(receipt.result.revision, accepted.plan.candidate);
    }
    finally {
        store.close();
        removeTree(root);
    }
});
