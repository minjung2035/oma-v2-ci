import { createGitServices } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
/** Current reviewed and direct integration routes; canonical witness ownership. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { AuthContext, ExactCandidateIdentity, RiskTier } from "@oma/contracts";
import { GitModule } from "@oma/git";
import { MailModule } from "@oma/mail";
import { Store, readDiagnosticSnapshot } from "@oma/storage";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { StoreError, AcceptedFailure } from "@oma/domain/errors";
import { runGitText } from "@oma/process/policies";
import type { IntegrationPolicy } from "@oma/domain/integration-policy";
import { snapshotIntegrationPolicy } from "@oma/domain/integration-policy";
import { authorizeCanonicalNoop, createCanonicalObserver } from "@oma/git/canonical-command";
import { operationPlanCheck } from "@oma/domain/durable";
import { IntegrationPublicationObserver, consumeIntegrationPublication } from "@oma/git/integration-publication";
import { requestHash } from "@oma/domain/request-identity";
import { messageIdForOperation } from "@oma/domain/derived";
import { buildFrozenMessage } from "@oma/mail/serialize";
import { messagePlanFrom } from "@oma/mail/facts";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";
const code = (value: string) => (error: unknown) => (error instanceof StoreError || error instanceof AcceptedFailure) && error.code === value;
async function* empty(): AsyncIterable<Uint8Array> { }
function fixture(options: {
    tiered?: boolean;
} = {}) {
    const root = mkdtempSync(join(tmpdir(), "oma-tiered-"));
    const projectGit = join(root, "project.git");
    const git = (...args: string[]) => {
        const result = runGitText(args, { gitDir: projectGit, env: { GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@invalid",
                GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@invalid" } });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    assert.equal(runGitText(["init", "--bare", projectGit]).status, 0);
    const tree = git("mktree");
    const base = git("commit-tree", tree, "-m", "base");
    const candidate = git("commit-tree", tree, "-p", base, "-m", "candidate");
    git("update-ref", "refs/heads/main", base);
    let store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
    store.transaction(tx => {
        for (const actor of ["principal", "alice", "bob", "carol"])
            tx.insertAgent(makeValidAgent(actor, { createdBy: actor === "bob" ? "alice" : null }));
    });
    const paths = { stateRoot: root, projectGit, contextGit: join(root, "context.git"), worldDir: join(root, "world"),
        society: "demo" };
    let mail = createMailModule(paths, store, 64);
    const policy: IntegrationPolicy = { policyRevision: "p1", protectedPaths: [], checks: [],
        ...(options.tiered === false ? {} : { tiered: {
                repositoryFloor: "LOW", highPeerFloor: 2, principalDelegated: true, rules: []
            } }) };
    let services = createGitServices(paths, store, mail, policy, () => policy);
    let { git: module, reviews } = services;
    const auth = (actor = "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
        incarnation: actor === "principal" ? 0 : 1, capabilities: new Set(ALL_CAPS), channel: "actor",
        peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } });
    const identity = (oid = candidate, expected = base): ExactCandidateIdentity => ({ repo: "project", targetRef: "refs/heads/main",
        expectedBase: expected, candidate: oid, policyRevision: policy.policyRevision });
    const submit = (actor = "alice", oid = candidate, key = "submit") => module.submit(auth(actor), key, {
        candidate: oid, exportRef: "refs/oma/export/test", prerequisites: [], to: [], paths: [], subject: "candidate", body: "submitted candidate",
    }, empty());
    return { root, git, base, candidate, policy, auth, identity, submit,
        get store() { return store; }, get mail() { return mail; }, get module() { return module; }, get reviews() { return reviews; },
        reopen() {
            store.close();
            store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
            mail = createMailModule(paths, store, 64);
            ({ git: module, reviews } = createGitServices(paths, store, mail, policy, () => policy));
        },
        close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("a non-tiered society integrates a submitted candidate directly and replays the receipt", async (t) => {
    const f = fixture({ tiered: false });
    t.after(() => f.close());
    await f.submit();
    const request = { candidate: f.candidate, expected: f.base };
    const receipt = await f.module.integrate(f.auth(), "integrate", request);
    assert.equal(receipt.state, "succeeded");
    assert.equal(f.git("rev-parse", "refs/heads/main"), f.candidate);
    const row = f.store.getOperation("alice", "integrate")!;
    assert.equal(row.kind, "git.integrate");
    if (row.kind !== "git.integrate")
        return;
    assert.equal(row.plan.policyIdentity, snapshotIntegrationPolicy(f.policy).policyIdentity);
    assert.equal(row.plan.noopRef, null);
    assert.equal(row.plan.merge, undefined);
    assert.deepEqual(await f.module.integrate(f.auth(), "integrate", request), receipt);
    const report = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" }).report;
    assert.equal(report.status, "PASS", JSON.stringify(report));
});
test("a non-tiered society rejects a tier request and a tiered society rejects direct integration", async (t) => {
    const flat = fixture({ tiered: false });
    t.after(() => flat.close());
    await flat.submit();
    await assert.rejects(flat.module.integrate(flat.auth(), "tiered", { candidate: flat.candidate, expected: flat.base, tier: "LOW" }), code("UNSUPPORTED_PROFILE"));
    const f = fixture();
    t.after(() => f.close());
    await f.submit();
    await assert.rejects(f.module.integrate(f.auth(), "direct", { candidate: f.candidate, expected: f.base, tier: "LOW" }), code("UNSUPPORTED_PROFILE"));
    // And the removed legacy attestation kinds are refused at fresh acceptance.
    await assert.rejects(f.reviews.record(f.auth("alice"), "legacy", { kind: "peer" } as never), code("INVALID_REQUEST"));
});
test("a no-op witness is not created when main differs; a matching witness survives main moving later", t => {
    const f = fixture();
    t.after(() => f.close());
    const observer = createCanonicalObserver();
    const ref = "refs/oma/integrations/test";
    const repository = join(f.root, "project.git");
    assert.equal(authorizeCanonicalNoop(observer, repository, ref, f.candidate).kind, "absent");
    const first = authorizeCanonicalNoop(observer, repository, ref, f.base);
    assert.equal(first.kind, "present");
    f.git("update-ref", "refs/heads/main", f.candidate, f.base);
    const witness = observer.ref(repository, ref);
    assert.equal(witness.kind, "present");
    if (witness.kind === "present")
        assert.equal(witness.value, f.base);
});
