import { createGitServices } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** mail-v1 review fixture: a real Store, MailModule and GitModule over a
 * throwaway society with a canonical project repo. Shared by merge-review and
 * challenge-review. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { GitModule } from "@oma/git";
import { runGitText } from "@oma/process/policies";
import { reviewState as evaluate, type ReviewEntry as RE, type ReviewState as RS } from "@oma/domain/review-evaluation";
import type { ReviewFact } from "@oma/contracts/attestation";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { readableMail } from "@oma/mail/display";
import { makeValidAgent, ALL_CAPS } from "./spec.js";
import { removeTree } from "./cleanup.js";
import type { AuthContext, MessagePlan } from "@oma/contracts";
import type { IntegrationPolicy } from "@oma/domain/integration-policy";
import type { OperationOf } from "@oma/protocol/operation-codec";
export async function* empty(): AsyncIterable<Uint8Array> { }
export interface FixtureOptions {
    readonly principalDelegated?: boolean;
    readonly protectedPaths?: readonly string[];
    readonly rules?: readonly {
        path: string;
        tier: "LOW" | "MEDIUM" | "HIGH";
        statuses: ("A" | "M" | "D" | "T")[];
    }[];
    /** Overrides the live host-policy read (the bound policy stays the same). */
    readonly reader?: (policy: IntegrationPolicy) => IntegrationPolicy;
    readonly mailBodyBytes?: number;
    readonly bundleBytes?: number;
    readonly checks?: IntegrationPolicy["checks"]; // integration check fixtures
    readonly runCheck?: (candidate: string, check: unknown, cancellation?: AbortSignal) => Promise<void> | void;
}
export function fixture(options: FixtureOptions = {}) {
    const root = mkdtempSync(join(tmpdir(), "oma-merge-review-"));
    const projectGit = join(root, "repos", "project.git");
    const git = (args: readonly string[], input?: string): string => {
        const result = runGitText([...args], { gitDir: projectGit, ...(input === undefined ? {} : { input }),
            env: { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@invalid" } });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    mkdirSync(join(root, "repos"), { recursive: true });
    assert.equal(runGitText(["init", "--bare", projectGit]).status, 0);
    const emptyTree = git(["mktree"], "");
    const base = git(["commit-tree", emptyTree, "-m", "base"]);
    git(["update-ref", "refs/heads/main", base]);
    const candidateWith = (files: Record<string, string>, parent = base): string => {
        const tree = git(["mktree"], Object.entries(files).map(([name, content]) => `100644 blob ${git(["hash-object", "-w", "--stdin"], content)}\t${name}`).join("\n") + "\n");
        return git(["commit-tree", tree, "-p", parent, "-m", "candidate"]);
    };
    let store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
    for (const dir of ["new", "cur", "tmp"])
        mkdirSync(join(root, "mail", "workers", dir), { recursive: true });
    const agents = () => {
        store.transaction(tx => {
            for (const actor of ["principal", "alice", "bob", "carol", "dave", "ellen"])
                tx.insertAgent(makeValidAgent(actor, actor === "ellen" ? { desired: "stopped" } : {}));
            tx.insertAgent(makeValidAgent("frank", { desired: "retired" }));
        });
    };
    agents();
    const paths = { stateRoot: root, projectGit, contextGit: join(root, "context.git"), worldDir: join(root, "world"),
        society: "demo" };
    let mail = createMailModule(paths, store, 64);
    const policy: IntegrationPolicy = { policyRevision: "p1", protectedPaths: [...(options.protectedPaths ?? [])],
        checks: [...(options.checks ?? [])], tiered: { repositoryFloor: "LOW", highPeerFloor: 2,
            principalDelegated: options.principalDelegated ?? true, rules: [...(options.rules ?? [])] } };
    const bounds = { mailBodyBytes: options.mailBodyBytes ?? 256 * 1024, subjectBytes: 512,
        bundleBytes: options.bundleBytes ?? 256 * 1024 };
    let services = createGitServices(paths, store, mail, policy, options.reader === undefined ? () => policy : () => options.reader!(policy), options.runCheck === undefined ? null
        : (candidate, check, cancellation) => Promise.resolve(options.runCheck!(candidate, check, cancellation)), bounds);
    let { git: module, reviews } = services;
    const auth = (actor = "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
        incarnation: actor === "principal" ? 0 : 1, capabilities: new Set(ALL_CAPS), channel: "actor",
        peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } });
    const submits = new Map<string, string>();
    const submit = (actor: string, oid: string, key = `submit-${submits.size}`) => module.submit(auth(actor), key, { candidate: oid, exportRef: `refs/oma/export/${submits.size}`,
        prerequisites: [], to: [], paths: [], subject: "candidate", body: "submitted candidate" }, empty());
    const open = (actor: string, input: {
        tier: "LOW" | "MEDIUM" | "HIGH";
        candidate: string;
        base?: string;
        title?: string;
        reason?: string;
    }, key = `open-${Math.random().toString(16).slice(2)}`) => reviews.record(auth(actor), key, { kind: "merge.open", title: input.title ?? "the change",
        reason: input.reason ?? "needs to land", tier: input.tier, candidate: input.candidate, base: input.base ?? base });
    const challenge = (actor: string, input: {
        merge: string;
        tier: "LOW" | "HIGH";
        title?: string;
        reason?: string;
        candidate?: string;
        base?: string;
    }, key = `challenge-${Math.random().toString(16).slice(2)}`) => reviews.record(auth(actor), key, { kind: "challenge.open", merge: input.merge,
        title: input.title ?? "revert it", reason: input.reason ?? "revert it", tier: input.tier,
        ...(input.candidate === undefined ? {} : { candidate: input.candidate, base: input.base! }) });
    const review = (actor: string, name: string, key = `review-${Math.random().toString(16).slice(2)}`, body = `${actor} looked`) => reviews.record(auth(actor), key, { kind: "review", name, body });
    const vote = (actor: string, name: string, verdict: "approve" | "reject", body: string, key = `vote-${Math.random().toString(16).slice(2)}`, approval?: string) => reviews.record(auth(actor), key, { kind: "vote", name, verdict, body, ...(approval === undefined ? {} : { approval }) });
    const cancel = (actor: string, name: string, key = `cancel-${Math.random().toString(16).slice(2)}`) => reviews.record(auth(actor), key, { kind: "cancel", name, reason: "withdrawn" });
    const stop = (actor: string, desired: "stopped" | "retired") => store.transaction(tx => store.updateAgent({ name: actor, desired }));
    const requestName = (key: string, actor = "alice"): string => {
        const op = store.getOperation(actor, key)!;
        assert.equal(op.kind, "attest.record");
        assert.equal(op.state, "succeeded");
        const result = op.result as {
            request: string;
        };
        return result.request;
    };
    /** Rebuilds the pure decision the module computes, from the same ledger. */
    const stateOf = (name: string): RS => {
        const rows = store.attestations.all();
        const openRow = rows.find(row => "messages" in row.operation.plan &&
            isOpenish(row.operation.plan.fact) && row.operation.plan.fact.name === name);
        assert.ok(openRow !== undefined, `request ${name} exists`);
        const of = (row: {
            sequence: number;
            operation: OperationOf<"attest.record">;
        }): RE => {
            const plan = row.operation.plan as {
                fact: ReviewFact;
                messages: readonly MessagePlan[];
            };
            return { sequence: row.sequence, operation: row.operation.id, actor: row.operation.actor,
                fact: plan.fact, messages: plan.messages };
        };
        const entries = rows.filter(row => row.sequence > openRow.sequence && row.operation.id !== openRow.operation.id &&
            "messages" in row.operation.plan &&
            namesRequest(row.operation.plan.fact as {
                kind?: string;
                request?: unknown;
                target?: {
                    request?: unknown;
                };
            }, openRow.operation.id)).map(of);
        const applied = store.getOperation(openRow.operation.actor, applyRequestKeyFor(openRow.operation.id));
        return evaluate({ open: of(openRow), entries,
            integration: applied === null ? null : { operation: applied.id, state: applied.state,
                errorCode: applied.state === "failed" ? applied.errorCode : null },
            eligible: new Set(store.listAgents().filter(a => a.role === "resident" && a.desired === "enabled").map(a => a.name)),
            highPeerFloor: 2 });
    };
    return { root, base, projectGit, git, candidateWith, submit, open, challenge, review, vote, cancel, requestName, stateOf, auth, stop,
        policy, applyOp: (actor: string, openKey: string) => {
            const openOp = store.getOperation(actor, openKey)!;
            return store.getOperation(actor, applyRequestKeyFor(openOp.id));
        },
        get store() { return store; }, get mail() { return mail; }, get module() { return module; }, get reviews() { return reviews; },
        reopen() {
            store.close();
            store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
            mail = createMailModule(paths, store, 64);
            ({ git: module, reviews } = createGitServices(paths, store, mail, policy, options.reader === undefined ? () => policy : () => options.reader!(policy), options.runCheck === undefined ? null
                : (candidate, check, cancellation) => Promise.resolve(options.runCheck!(candidate, check, cancellation)), bounds));
        },
        close() { store.close(); removeTree(root); } };
}
export const isOpenish = (fact: unknown): fact is {
    name: string;
} => fact !== null && typeof fact === "object" &&
    ((fact as {
        kind?: string;
    }).kind === "merge.open" || (fact as {
        kind?: string;
    }).kind === "challenge.open");
export const namesRequest = (fact: {
    kind?: string;
    request?: unknown;
    target?: {
        request?: unknown;
    };
}, request: string): boolean => (fact.kind === "review" || fact.kind === "vote" || fact.kind === "cancel" || fact.kind === "refresh")
    ? fact.request === request : fact.kind === "challenge.open" && fact.target?.request === request;
export const messages = (f: ReturnType<typeof fixture>, actor: string, key: string): readonly MessagePlan[] => {
    const op = f.store.getOperation(actor, key)!;
    assert.equal(op.kind, "attest.record");
    return (op.plan as {
        messages: readonly MessagePlan[];
    }).messages;
};
export const inboxCount = (f: ReturnType<typeof fixture>, actor: string): number => {
    const dir = join(f.root, "mail", "inboxes", actor, "new");
    return existsSync(dir) ? readdirSync(dir).length : 0;
};
export const messageText = (root: string, id: string): string => readableMail(readFileSync(join(root, "mail", "objects", `${id}.eml`), "utf8"));
export const workerFile = (root: string, id: string): string => join(root, "mail", "workers", "cur", `${id}:2,`);
