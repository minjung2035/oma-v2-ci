import { TransportSpool } from "@oma/storage/transport-spool";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, lstatSync, rmSync, readdirSync, chmodSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Store } from "@oma/storage";
import { encodeFrame } from "@oma/protocol/frame";
import { RpcConnection, type RpcSocket, type SocketEvents } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { StoreError, publicFailure } from "@oma/domain/errors";
import { MailModule } from "@oma/mail";
import { GitModule } from "@oma/git";
import type { AuthContext } from "@oma/contracts";
import type { ContextInput } from "@oma/git/context";
import { makeValidAgent } from "./fixtures/spec.js";
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(["context.publish"]),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }
function input(text: string, expected: string | null): {
    request: ContextInput;
    bytes: Buffer;
} {
    const bytes = Buffer.from(text);
    return { bytes, request: { expected, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: digest(bytes) }],
            content: { bytes: bytes.length, sha256: digest(bytes), mediaType: "application/vnd.oma.context-v1" } } };
}
function cleanup(root: string): void {
    const walk = (path: string): void => {
        const stat = lstatSync(path);
        if (!stat.isDirectory())
            return;
        chmodSync(path, 0o700);
        for (const name of readdirSync(path))
            walk(join(path, name));
    };
    walk(root);
    rmSync(root, { recursive: true, force: true });
}
function fixture(format: "sha1" | "sha256") {
    const root = mkdtempSync(join(tmpdir(), "oma-r21-context-"));
    const contextGit = join(root, "repos/context.git");
    mkdirSync(join(root, "repos"));
    const env = { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    const command = (args: string[], overrides: NodeJS.ProcessEnv = {}): string => {
        const result = spawnSync("/usr/bin/git", args, { env: { ...env, ...overrides }, timeout: 10000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL", encoding: "utf8" });
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    command(["init", "--bare", `--object-format=${format}`, contextGit]);
    const store = new Store(join(root, "runtime.sqlite"));
    store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob", { desired: "stopped" })); });
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
    const git = createGitModule({ stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit,
        worldDir: join(root, "world"), society: "demo" }, store, mail, null);
    return { root, store, mail, git, command, contextGit, close() { store.close(); cleanup(root); } };
}
for (const format of ["sha1", "sha256"] as const) {
    test(`R21 ${format}: acceptance precedes no activation and holds the exact canonical candidate`, async () => {
        const f = fixture(format);
        try {
            assert.equal(f.git.hasCommittedContext(), false);
            const publish = f.mail.publishGated.bind(f.mail);
            let checked = false;
            f.mail.publishGated = async (id, proof) => {
                assert.ok(proof, "the real context facade must supply a new canonical observation");
                const operation = f.store.getOperationById(id);
                assert.ok(operation?.kind === "context.publish");
                assert.equal(operation.state, "pending");
                assert.equal(f.command(["--git-dir", f.contextGit, "rev-parse", "refs/heads/main"]), operation.plan.candidate);
                assert.equal(f.command(["--git-dir", f.contextGit, "cat-file", "-t", operation.plan.candidate]), "commit");
                assert.equal(f.git.hasCommittedContext(), false, "current link and C alone must not activate the first GOAL");
                assert.equal(readlinkSync(join(f.root, "world/context/current")), `revisions/${operation.plan.candidate}`);
                checked = true;
                await publish(id, proof);
            };
            const first = input("# first 한글 GOAL\r\n", null);
            const receipt = await f.git.publishContext(auth, "first", first.request, once(first.bytes));
            assert.equal(checked, true);
            assert.equal(receipt.state, "succeeded");
            assert.equal(f.git.hasCommittedContext(), true);
            assert.equal(f.store.getAgent("bob")?.desired, "stopped", "context publication never enables a stopped resident");
            const operation = f.store.getOperationById(receipt.operation);
            assert.ok(operation?.kind === "context.publish");
            assert.equal(operation.plan.candidate.length, format === "sha1" ? 40 : 64);
            assert.equal(lstatSync(join(operation.plan.stagingPath, "commit-work/GOAL.md")).mode & 0o777, 0o644);
            assert.equal(lstatSync(join(f.root, `world/context/revisions/${operation.plan.candidate}/GOAL.md`)).mode & 0o777, 0o644);
            assert.deepEqual(readFileSync(f.mail.archivePath(operation.plan.message.id)), readFileSync(f.mail.objectPath(operation.plan.message.id)));
            assert.throws(() => f.store.transaction(() => f.git.hasCommittedContext()), { code: "INTERNAL_ERROR" }, "activation proof must not perform I/O inside a transaction");
        }
        finally {
            f.close();
        }
    });
    test(`R21 ${format}: lost notification blocks the next writer and recovers C without recreating a commit`, async () => {
        const f = fixture(format);
        try {
            const publish = f.mail.publishGated.bind(f.mail);
            f.mail.publishGated = async () => { throw new Error("injected loss before notification"); };
            const first = input("# frozen candidate\n", null);
            await assert.rejects(f.git.publishContext(auth, "first", first.request, once(first.bytes)));
            const accepted = f.store.getOperation("alice", "first");
            assert.ok(accepted?.kind === "context.publish");
            assert.equal(accepted.state, "unknown");
            const candidate = accepted.plan.candidate;
            const canonical = f.command(["--git-dir", f.contextGit, "cat-file", "-p", candidate]);
            assert.equal(f.git.hasCommittedContext(), false);
            const next = input("# must not run\n", candidate);
            let reads = 0;
            async function* counted(): AsyncIterable<Uint8Array> { reads++; yield next.bytes; }
            await assert.rejects(f.git.publishContext(auth, "next", next.request, counted()), { code: "REF_STATE_UNKNOWN" });
            assert.equal(reads, 0);
            assert.equal(f.store.getOperation("alice", "next"), null);
            const work = join(accepted.plan.stagingPath, "commit-work");
            rmSync(work, { recursive: true });
            const originalMethod = Reflect.get(Reflect.get(Reflect.get(f.git, "repository"), "contextRepository"), "prepareCandidate");
            assert.equal(typeof originalMethod, "function");
            Object.defineProperty(Reflect.get(Reflect.get(f.git, "repository"), "contextRepository"), "prepareCandidate", { configurable: true, value: () => assert.fail("recovery must not prepare another candidate") });
            f.mail.publishGated = publish;
            await f.git.reconcile(accepted.id);
            Reflect.deleteProperty(Reflect.get(Reflect.get(f.git, "repository"), "contextRepository"), "prepareCandidate");
            const settled = f.store.getOperationById(accepted.id);
            assert.ok(settled?.kind === "context.publish");
            assert.equal(settled.state, "succeeded");
            assert.equal(settled.planJson, accepted.planJson);
            assert.equal(f.command(["--git-dir", f.contextGit, "cat-file", "-p", candidate]), canonical);
            assert.deepEqual(readFileSync(join(work, "GOAL.md")), first.bytes);
            assert.equal(f.git.hasCommittedContext(), true);
            await f.git.reconcile(accepted.id);
            assert.equal(f.store.getOperationById(accepted.id)?.resultJson, settled.resultJson);
        }
        finally {
            f.close();
        }
    });
    test(`R21 ${format}: candidate author, date, tree and parent retain the original porcelain identity`, async () => {
        const f = fixture(format);
        try {
            const first = input("# same immutable identity\n", null);
            const receipt = await f.git.publishContext(auth, "identity", first.request, once(first.bytes));
            const operation = f.store.getOperationById(receipt.operation);
            assert.ok(operation?.kind === "context.publish");
            const work = join(f.root, "independent-oracle");
            mkdirSync(work);
            // Independent old-path porcelain oracle, not ContextRepository or its env.
            f.command(["-C", work, "init", "-q", `--object-format=${format}`]);
            writeFileSync(join(work, "GOAL.md"), first.bytes, { mode: 0o644 });
            f.command(["-C", work, "add", "-f", "-A"]);
            f.command(["-C", work, "-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", "commit", "-q", "--no-gpg-sign", "-m", "context"], {
                GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "broker@oma.invalid", GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "broker@oma.invalid",
                GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
            });
            assert.equal(operation.plan.candidate, f.command(["-C", work, "rev-parse", "HEAD"]));
            const second = input("# second full snapshot\n", operation.plan.candidate);
            const updated = await f.git.publishContext(auth, "second", second.request, once(second.bytes));
            const next = f.store.getOperationById(updated.operation);
            assert.ok(next?.kind === "context.publish");
            assert.equal(f.command(["--git-dir", f.contextGit, "rev-parse", `${next.plan.candidate}^`]), operation.plan.candidate);
            assert.equal(f.command(["--git-dir", f.contextGit, "show", `${next.plan.candidate}:GOAL.md`]), "# second full snapshot");
        }
        finally {
            f.close();
        }
    });
}
class ClosedAfterAcceptanceSocket extends EventEmitter<SocketEvents> implements RpcSocket {
    destroyed = false;
    pause() { return undefined; }
    resume() { return undefined; }
    write(): boolean { return true; }
    end() { return undefined; }
    destroy() { if (this.destroyed)
        return; this.destroyed = true; this.emit("close", false); }
}
/** One real RPC connection. Its transport spool shares the broker's staging
 * root with context preparation, exactly as the broker composes it. */
function connect(f: ReturnType<typeof fixture>, observe: (receipt: Awaited<ReturnType<GitModule["publishContext"]>>, reads: number) => void) {
    const socket = new ClosedAfterAcceptanceSocket();
    const tasks: Promise<void>[] = [];
    const rpc = new RpcConnection({ socket, peer: new SharedPeerPin(() => true, () => undefined), makeSpool: descriptor => new TransportSpool(join(f.root, "staging"), descriptor),
        limits: { frameBytes: 64 * 1024, idleStreamSeconds: 30, receiptWaitSeconds: 30 }, preflight: () => undefined,
        alarms: { after: () => ({ cancel: () => undefined }) },
        handle: async (raw, body) => {
            let reads = 0;
            async function* counted(): AsyncIterable<Uint8Array> { for await (const chunk of body ?? []) {
                reads++;
                yield chunk;
            } }
            const receipt = await f.git.publishContext(auth, String(raw.request), raw.params as ContextInput, counted());
            observe(receipt, reads);
            return { v: 1, id: raw.id, ok: true, result: receipt };
        },
        onTask: task => { tasks.push(task); } });
    return { socket, rpc, tasks };
}
test("V18B: accepted context evidence outlives its RPC connection; same-key retry and reconcile reuse the frozen plan", async (t) => {
    const f = fixture("sha1");
    try {
        const key = "closed-after-acceptance";
        const first = input("# accepted before the connection closed\n", null);
        const request = Buffer.concat([encodeFrame({ v: 1, id: "publish", method: "context.publish", request: key, params: first.request }), first.bytes]);
        const opened = connect(f, () => assert.fail("the first request must not produce a receipt"));
        // The first accepted-phase effect finds its connection already closed, then loses its outcome.
        const repository = Reflect.get(Reflect.get(f.git, "repository"), "contextRepository") as {
            ensureCandidate: (operation: unknown) => void;
        };
        const ensure = repository.ensureCandidate.bind(repository);
        const interrupted = t.mock.method(repository, "ensureCandidate", (operation: unknown) => {
            if (interrupted.mock.callCount() > 0)
                return ensure(operation);
            opened.socket.destroy();
            throw new StoreError("REF_STATE_UNKNOWN", "injected loss after acceptance");
        });
        opened.socket.emit("data", request);
        await Promise.all(opened.tasks);
        assert.equal(opened.tasks.length, 1);
        assert.equal(opened.rpc.snapshot().phase, "closed");
        const accepted = f.store.getOperation("alice", key);
        assert.ok(accepted?.kind === "context.publish");
        assert.equal(accepted.state, "pending");
        assert.equal(f.command(["--git-dir", f.contextGit, "for-each-ref", "--format=%(refname)"]), "", "no canonical effect ran");
        // Connection cleanup released only its own spool; the accepted tree and object remain exact.
        assert.deepEqual(readdirSync(join(f.root, "staging")).filter(name => name !== "mail-objects"), [basename(accepted.plan.stagingPath), `${basename(accepted.plan.stagingPath)}.lease`], "the accepted tree, and the lease beside it (R6-04)");
        for (const part of ["tree", "commit-work"])
            assert.deepEqual(readFileSync(join(accepted.plan.stagingPath, part, "GOAL.md")), first.bytes);
        const object = readFileSync(f.mail.objectPath(accepted.plan.message.id));
        assert.equal(digest(object), accepted.plan.message.sha256);
        const commit = f.command(["--git-dir", f.contextGit, "cat-file", "-p", accepted.plan.candidate]);
        // Recovery must use the staged candidate, not objects fetched during preparation.
        rmSync(join(f.contextGit, "FETCH_HEAD"), { force: true });
        f.command(["--git-dir", f.contextGit, "prune", "--expire=now"]);
        const absent = spawnSync("/usr/bin/git", ["--git-dir", f.contextGit, "cat-file", "-e", accepted.plan.candidate], { encoding: "utf8" });
        assert.notEqual(absent.status, 0, "the fetched candidate must be unavailable before recovery");
        const receipts: Array<{
            operation: string;
            state: string;
        }> = [];
        let reads = -1;
        const retried = connect(f, (receipt, count) => { receipts.push(receipt); reads = count; });
        Object.defineProperty(Reflect.get(Reflect.get(f.git, "repository"), "contextRepository"), "prepareCandidate", { configurable: true, value: () => assert.fail("no new candidate may be prepared") });
        retried.socket.emit("data", request);
        await Promise.all(retried.tasks);
        assert.equal(reads, 0, "a same-key retry reads no new payload");
        assert.deepEqual(receipts.map(receipt => [receipt.operation, receipt.state]), [[accepted.id, "pending"]]);
        assert.deepEqual(readdirSync(join(f.root, "staging")).filter(name => name !== "mail-objects"), [basename(accepted.plan.stagingPath), `${basename(accepted.plan.stagingPath)}.lease`], "the accepted tree, and the lease beside it (R6-04)");
        assert.deepEqual(readdirSync(join(f.root, "mail/objects")), [`${accepted.plan.message.id}.eml`]);
        await f.git.reconcile(accepted.id);
        Reflect.deleteProperty(Reflect.get(Reflect.get(f.git, "repository"), "contextRepository"), "prepareCandidate");
        const settled = f.store.getOperationById(accepted.id);
        assert.ok(settled?.kind === "context.publish");
        assert.equal(settled.state, "succeeded");
        assert.equal(settled.planJson, accepted.planJson);
        assert.equal(f.command(["--git-dir", f.contextGit, "rev-parse", "refs/heads/main"]), accepted.plan.candidate);
        assert.equal(f.command(["--git-dir", f.contextGit, "cat-file", "-p", accepted.plan.candidate]), commit);
        assert.equal(readlinkSync(join(f.root, "world/context/current")), `revisions/${accepted.plan.candidate}`);
        assert.deepEqual(readFileSync(join(f.root, `world/context/revisions/${accepted.plan.candidate}/GOAL.md`)), first.bytes);
        assert.deepEqual(readFileSync(f.mail.archivePath(accepted.plan.message.id)), object);
        assert.equal(f.git.hasCommittedContext(), true);
    }
    finally {
        f.close();
    }
});
/** AV28 -- CTX-003 ("CAS 실패는 CONTEXT_CONFLICT+actual revision이다"). */
test("AV28 / CTX-003: a context publication on a stale revision names the revision it found", async () => {
    const f = fixture("sha1");
    try {
        const first = input("# GOAL\n", null);
        const published = await f.git.publishContext(auth, "av28-first", first.request, once(first.bytes));
        assert.equal(published.state, "succeeded");
        const revision = (published as {
            result?: {
                revision?: string;
            };
        }).result?.revision;
        assert.ok(revision);
        const again = input("# GOAL 2\n", null);
        const error = await f.git.publishContext(auth, "av28-stale", again.request, once(again.bytes)).then(() => null, (reason: unknown) => reason);
        assert.equal((error as {
            code?: string;
        } | null)?.code, "CONTEXT_CONFLICT");
        assert.deepEqual(publicFailure(error).details, { actual: revision });
    }
    finally {
        f.close();
    }
});
