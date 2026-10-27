import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Broker } from "@oma/broker";
import { ConnectionDecoder } from "@oma/protocol/frame";
import { GitModule } from "@oma/git";
import { MailModule } from "@oma/mail";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import type { AuthContext, ProtocolLimits } from "@oma/contracts";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
const GIT_ENV = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
};
function git(cwd: string, args: string[]): string {
    const result = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
}
test("P0: protected-path observation failure cannot reach main CAS", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "oma-p0-diff-"));
    const state = join(root, "state");
    const repos = join(state, "repos");
    const work = join(root, "work");
    mkdirSync(repos, { recursive: true });
    mkdirSync(work, { recursive: true });
    const store = new Store(join(state, "runtime.sqlite"));
    try {
        store.transaction(() => {
            store.insertAgent({
                name: "a",
                ...storedSpec(ALL_CAPS, "p", "a"),
                role: "resident",
                profile: "p",
                desired: "enabled",
                incarnation: 1,
                createdBy: null,
            });
        });
        git(work, ["init", "-q", "-b", "main"]);
        writeFileSync(join(work, "base.txt"), "base\n");
        git(work, ["add", "-A"]);
        git(work, ["-c", "user.name=OMA", "-c", "user.email=oma@localhost", "commit", "-qm", "base"]);
        const base = git(work, ["rev-parse", "HEAD"]);
        const projectGit = join(repos, "project.git");
        git(root, ["clone", "-q", "--bare", work, projectGit]);
        writeFileSync(join(work, "safe.txt"), "candidate\n");
        git(work, ["add", "safe.txt"]);
        git(work, ["-c", "user.name=OMA", "-c", "user.email=oma@localhost", "commit", "-qm", "candidate"]);
        const candidate = git(work, ["rev-parse", "HEAD"]);
        git(root, ["--git-dir", projectGit, "fetch", "-q", work, `HEAD:refs/oma/published/a/p0-test`]);
        // Keep the commit/ref readable so ancestry and publication checks succeed,
        // but remove its tree so the policy-critical diff-tree observation fails.
        const tree = git(work, ["rev-parse", `${candidate}^{tree}`]);
        const treeObject = join(projectGit, "objects", tree.slice(0, 2), tree.slice(2));
        if (!existsSync(treeObject)) {
            t.skip("candidate tree was packed; missing-loose-object fault seam unavailable");
            return;
        }
        rmSync(treeObject);
        const mail = createMailModule({ stateRoot: state, society: "demo" }, store, 8);
        const module = createGitModule({
            stateRoot: state,
            projectGit,
            contextGit: join(repos, "context.git"),
            worldDir: join(state, "world"),
            society: "demo",
        }, store, mail, { policyRevision: "p1", protectedPaths: ["protected/"], checks: [] });
        const auth: AuthContext = {
            actor: "a",
            incarnation: 1,
            role: "resident",
            channel: "actor",
            capabilities: new Set(["code.integrate"]),
            peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null },
        };
        await assert.rejects(module.integrate(auth, "p0-diff", { candidate: candidate as never, expected: base as never }), (error: unknown) => error instanceof StoreError && error.code === "REF_STATE_UNKNOWN");
        assert.equal(git(root, ["--git-dir", projectGit, "rev-parse", "refs/heads/main"]), base);
    }
    finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
class FakeSocket {
    readonly writes: Buffer[] = [];
    destroyed = false;
    private handlers = new Map<string, Array<(...args: never[]) => void>>();
    write(value: Uint8Array): boolean {
        this.writes.push(Buffer.from(value));
        return true;
    }
    /** Fatal protocol errors close the transport with a final error frame. */
    ended = false;
    paused = false;
    end(value?: Uint8Array): this {
        this.ended = true;
        if (value !== undefined)
            this.writes.push(Buffer.from(value));
        return this;
    }
    pause(): this { this.paused = true; return this; }
    off(): this { return this; }
    destroy(): this {
        this.destroyed = true;
        return this;
    }
    on(name: string, fn: (...args: never[]) => void): this {
        const list = this.handlers.get(name) ?? [];
        list.push(fn);
        this.handlers.set(name, list);
        return this;
    }
    once(name: string, fn: (...args: never[]) => void): this {
        return this.on(name, fn);
    }
    setTimeout(_ms: number, _fn: () => void): this {
        return this;
    }
    emitData(data: Buffer): void {
        for (const fn of this.handlers.get("data") ?? [])
            fn(data as never);
    }
}
const TEST_LIMITS: ProtocolLimits = {
    frameBytes: 256 * 1024,
    mailBodyBytes: 64 * 1024,
    subjectBytes: 8 * 1024,
    addresses: 64,
    replyReferences: 64,
    contextFiles: 1024,
    contextBytes: 8 * 1024 * 1024,
    bundleBytes: 256 * 1024 * 1024,
    logBytes: 1024 * 1024,
    batchMaxMessages: 64,
    idleStreamSeconds: 30,
    receiptWaitSeconds: 30,
};
const untilTrue = async (predicate: () => boolean, budgetMs: number): Promise<boolean> => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        if (predicate())
            return true;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return predicate();
};
test("P0: 20,000 malformed frames close one connection without recursive drain", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-p0-frames-"));
    try {
        const broker = Object.create(Broker.prototype) as Broker;
        Object.assign(broker, {
            paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo" },
            // A short deadline makes the close alarm observable; production uses the
            // configured stream deadline.
            limits: { ...TEST_LIMITS, idleStreamSeconds: 0.05 },
            // The connection registry and task set are part of serveFrames' contract.
            connections: new Map(),
            executingTasks: new Set(),
            health: { observe: () => undefined },
        });
        const socket = new FakeSocket();
        const serveFrames = Reflect.get(broker, "serveFrames") as (sock: FakeSocket, peer: {
            pid: number;
            uid: number;
            gid: number;
            cgroup: string | null;
            releaseConnection: () => void;
        }, handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => unknown, preflight: (raw: Record<string, unknown>) => void) => void;
        const peer = { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null, releaseConnection: () => undefined };
        serveFrames.call(broker, socket, peer, () => assert.fail("malformed input must not dispatch"), () => undefined);
        const malformed = Buffer.from([0, 0, 0, 1, 0x7b]); // one-byte "{" JSON body
        socket.emitData(Buffer.concat(Array.from({ length: 20000 }, () => malformed)));
        // MAINTENANCE §19: after a fatal framing error the connection is poisoned and
        // closed. One error frame is emitted, the socket stops reading, and the
        // remaining 19,999 frames never create work or another connection.
        assert.equal(socket.writes.length, 1);
        assert.equal(socket.paused, true);
        assert.equal(socket.ended, true);
        assert.equal((Reflect.get(broker, "connections") as Map<unknown, unknown>).size, 1);
        // The paused transport must not be left dangling: the armed alarm closes it.
        assert.equal(await untilTrue(() => socket.destroyed, 2000), true, "the fatal connection must be closed");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("P0: decoder stream sink does not rebuild the body in memory", () => {
    const source = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const expected = createHash("sha256").update(source).digest("hex");
    const sinkHash = createHash("sha256");
    let sinkBytes = 0;
    const decoder = new ConnectionDecoder(256 * 1024, (chunk) => {
        sinkBytes += chunk.length;
        sinkHash.update(chunk);
    });
    assert.deepEqual(decoder.beginStream(source.length), []);
    let terminal: ReturnType<ConnectionDecoder["push"]> = [];
    for (let offset = 0; offset < source.length; offset += 16 * 1024) {
        terminal = decoder.push(source.subarray(offset, offset + 16 * 1024));
    }
    const event = terminal.find((value) => value.kind === "stream");
    assert.ok(event && event.kind === "stream");
    assert.equal(event.bytes.length, 0, "sink mode must not Buffer.concat the raw body");
    assert.equal(sinkBytes, source.length);
    assert.equal(sinkHash.digest("hex"), expected);
});
