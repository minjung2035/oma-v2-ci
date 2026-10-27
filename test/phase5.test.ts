import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
// Phase 5 acceptance: broker runner-channel auth, principal relay (T42),
// sandboxed Pi delivery smoke (S-03 mechanism, compiled pi-extension).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, openSync, closeSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { resolvedSpec, ALL_CAPS, storedSpec } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import type { RunRegistry } from "@oma/broker/run-registry";
import { actorSocketPathAt } from "@oma/domain/paths";
import { runnerReceiptPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { Broker } from "@oma/broker";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { candidateSandbox } from "@oma/platform-linux/candidate-sandbox";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import type { AuthContext, Capability, ResolvedAgentSpec, RunLease, } from "@oma/contracts";
import { writeBoundarySession } from "./fixtures/delivery-receipt.js";
import { goalPublishedAt } from "./fixtures/goal.js";
interface Env {
    dir: string;
    state: string;
    runRoot: string;
    society: string;
    store: Store;
    mail: MailModule;
    broker: Broker;
    cleanup: () => Promise<void>;
}
async function envOf(): Promise<Env> {
    const dir = mkdtempSync(join(tmpdir(), "oma-t5-"));
    const state = join(dir, "state");
    const runRoot = join(dir, "run");
    const society = `t5${Date.now().toString(36)}`;
    mkdirSync(state, { recursive: true });
    mkdirSync(runRoot, { recursive: true });
    const store = new Store(join(state, "runtime.sqlite"));
    const units = new PolicyExecution();
    // Batch views require the host-configured frame and manifest limits; without
    // them preparation fails closed with UNSUPPORTED_PROFILE.
    const mail = createMailModule({ stateRoot: state, society }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
    const resolver = (_parent: {
        name: string;
        profile: string;
    }, input: {
        name: string;
        from: string;
        brief: string;
    }): ResolvedAgentSpec => ({
        ...input,
        modelProfile: "m",
        profile: "child",
        capabilities: ["mail.send", "route.follow"],
    });
    const lifecycle = createLifecycleModule(store, units, {
        stateRoot: state,
        projectGit: join(state, "repos", "project.git"),
        society,
        hasGoal: () => true,
        activationAllowed: () => true,
    }, resolver, mail);
    const views = new ViewsModule(store, state, society, "p");
    const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: {
        stateRoot: state,
        runRoot,
        society,
        hasGoal: goalPublishedAt(state),
    } });
    await broker.start();
    return {
        dir,
        state,
        runRoot,
        society,
        store,
        mail,
        broker,
        cleanup: async () => {
            await broker.drainAndClose();
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
function seed(store: Store, specs: Array<[
    string,
    string,
    string
]>): void {
    store.transaction((_t) => {
        for (const [name, role, desired] of specs) {
            store.insertAgent({
                name,
                ...storedSpec(ALL_CAPS, "p", name),
                role: role as "resident" | "principal",
                desired: desired as never,
                incarnation: 1,
                profile: "p",
                createdBy: null,
            });
        }
    });
}
test("AUTH-002: durable effect requires the resolved method capability", async () => {
    const env = await envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"], ["b", "resident", "enabled"]]);
        const auth = (capabilities: Capability[]): AuthContext => ({
            actor: "a",
            incarnation: 1,
            role: "resident",
            channel: "actor",
            capabilities: new Set(capabilities),
            peer: { pid: 0, uid: -1, gid: -1 },
        });
        const params = { to: ["b"], subject: "s", kind: "message", body: "body" };
        const denied = await env.broker.dispatch(auth(["route.follow"]), { v: 1, id: "deny", method: "mail.send", request: "deny", params } as never, null);
        assert.equal((denied as {
            ok: boolean;
            error?: {
                code: string;
            };
        }).ok, false);
        if (process.env.OMA_DEBUG)
            console.error("DENIED:", JSON.stringify(denied));
        assert.equal((denied as {
            error?: {
                code: string;
            };
        }).error?.code, "CAPABILITY_DENIED");
        assert.equal(env.store.getOperation("a", "deny"), null);
        const allowed = await env.broker.dispatch(auth(["mail.send"]), { v: 1, id: "allow", method: "mail.send", request: "allow", params } as never, null);
        assert.equal((allowed as {
            ok: boolean;
        }).ok, true);
        assert.equal(env.store.getOperation("a", "allow")?.state, "succeeded");
        const views = Reflect.get(env.broker, "views") as ViewsModule;
        const refresh = views.refreshWorld;
        try {
            Reflect.set(env.broker, "views", { ...views, refreshWorld: () => { throw new Error("injected derived-view failure"); } });
            for (let attempt = 0; attempt < 2; attempt++) {
                const receipt = await env.broker.dispatch(auth(["mail.send"]), { v: 1, id: "view-fault", method: "mail.send", request: "view-fault", params } as never, null);
                assert.equal((receipt as {
                    result: {
                        state: string;
                    };
                }).result.state, "succeeded");
            }
        }
        finally {
            Reflect.set(env.broker, "views", views);
        }
        const socketDirectory = Reflect.get(env.broker, "actorSocketDirectory");
        const socketOwner = { paths: { runRoot: `/run/user/1000/oma/${"s".repeat(31)}` }, dependencies: Reflect.get(env.broker, "dependencies") };
        assert.equal(typeof socketDirectory.call(socketOwner, "a".repeat(31), 1), "string");
        assert.throws(() => socketDirectory.call(socketOwner, "a".repeat(31), Number.MAX_SAFE_INTEGER), /sun_path/);
        const staleAuth = auth(["mail.send"]);
        // P0-1/LIFE-008: the durable half of the intersection is the frozen spec,
        // fixed at creation and never rewritten. An agent created without a
        // capability is refused it however much its lease claims.
        env.store.transaction(() => env.store.insertAgent({ name: "c", ...storedSpec([], "p", "c"), role: "resident",
            desired: "enabled", incarnation: 1, profile: "p", createdBy: null }));
        const withoutDurable = await env.broker.dispatch({ ...auth(["mail.send"]), actor: "c" }, { v: 1, id: "revoked", method: "mail.send", request: "revoked", params } as never, null);
        assert.equal((withoutDurable as {
            error: {
                code: string;
            };
        }).error.code, "CAPABILITY_DENIED");
        assert.equal(env.store.getOperation("c", "revoked"), null);
        assert.throws(() => env.store.transaction(() => Reflect.apply(env.store.updateAgent, env.store, [{ name: "a", specJson: "{}", specHash: "0".repeat(64) }])), /no spec rewrite/, "the frozen spec has no write path");
        for (const [method, capability] of [["agent.create", "agent.create"], ["git.integrate", "code.integrate"], ["context.publish", "context.publish"]] as const) {
            const deniedMethod = await env.broker.dispatch(auth(["mail.send"]), { v: 1, id: method, method, request: method, params: {} } as never, null);
            assert.equal((deniedMethod as {
                error?: {
                    code: string;
                };
            }).error?.code, "CAPABILITY_DENIED", `${method} must require ${capability}`);
        }
        env.store.transaction(() => env.store.updateAgent({ name: "a", desired: "stopped" }));
        const stopped = await env.broker.dispatch(staleAuth, { v: 1, id: "stopped", method: "mail.send", request: "stopped", params } as never, null);
        assert.equal((stopped as {
            error: {
                code: string;
            };
        }).error.code, "STALE_RUN");
        assert.equal(env.store.getOperation("a", "stopped"), null);
    }
    finally {
        await env.cleanup();
    }
});
/** The retired pathname endpoint is an unconditional refusal. Only a directly
 * inherited control channel can request runner.open; EOF grants no authority. */
async function assertAdminClosed(adminSock: string, method: string, params: Record<string, unknown>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const chunks: Buffer[] = []; let connected = false, failure: Error | null = null;
        const sock = connect(adminSock, () => {
            connected = true; sock.write(encodeFrame({ v: 1, id: "t", method, params }));
        });
        const timer = setTimeout(() => { sock.destroy(); reject(new Error("admin refusal was not observed")); }, 10000);
        sock.on("data", bytes => chunks.push(Buffer.from(bytes)));
        sock.on("error", error => { failure = error; });
        sock.once("close", () => {
            clearTimeout(timer);
            try {
                assert.equal(connected, true);
                if (failure) assert.ok(["EPIPE", "ECONNRESET"].includes((failure as NodeJS.ErrnoException).code ?? ""), String(failure));
                assert.equal(Buffer.concat(chunks).length, 0, "the retired endpoint must never serve a request");
                resolve();
            } catch (error) { reject(error); }
        });
    });
}

function auth(actor: string, caps: Capability[]): AuthContext {
    return {
        actor,
        incarnation: 1,
        role: "resident",
        channel: "actor",
        capabilities: new Set(caps),
        peer: { pid: 1, uid: 1000, gid: 1000 },
    };
}
// ---------------------------------------------------------------------------
test("T11-neq: non-unit process cannot open a run on the runner channel", async () => {
    const env = await envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"]]);
        await assertAdminClosed(join(env.runRoot, "admin.sock"), "runner.open", { agent: "a", invocationId: "00000000000000000000000000000000" });

    }
    finally {
        await env.cleanup();
    }
});
test("T31-neg: forged batch.complete from outside the owning unit is rejected", async () => {
    const env = await envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"]]);
        await env.mail.send(auth("a", ["mail.send"]), "self-1", {
            to: ["a"],
            subject: "self",
            kind: "message",
            body: "x",
        });
        const batch = await env.mail.prepare(auth("a", []));
        assert.ok(batch !== null);
        await assertAdminClosed(join(env.runRoot, "admin.sock"), "batch.complete", {
            batchId: batch.id,
            incarnation: batch.incarnation,
            sessionPath: "/tmp/x",
            adapterRevision: "fake",
            receiptPath: "/tmp/fake.json",
        });

    }
    finally {
        await env.cleanup();
    }
});



test("BATCH-001: failed view publication retries the same prepared snapshot", async () => {
    const env = await envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"], ["b", "resident", "enabled"]]);
        await env.mail.send(auth("b", ["mail.send"]), "view-failure", {
            to: ["a"], subject: "recover", kind: "message", body: "original",
        });
        const view = join(env.state, "agents", "a", "runner", "view", "inbox.md");
        mkdirSync(view, { recursive: true });
        await assert.rejects(env.mail.prepare(auth("a", [])));
        const frozen = env.store.preparedBatches("a")[0]!;
        assert.ok(frozen);
        assert.equal(env.store.pendingDeliveries("a").length, 0);
        rmSync(view, { recursive: true });
        const recovered = await env.mail.prepare(auth("a", []));
        assert.equal(recovered!.id, frozen.id);
        assert.deepEqual(recovered!.messageIds, JSON.parse(frozen.messageIdsJson));
        assert.match(readFileSync(view, "utf8"), new RegExp(frozen.id));
    }
    finally {
        await env.cleanup();
    }
});
test("PR-002/BATCH-001: mailbox moves reject rogue bytes and preserve valid recovery", async () => {
    const env = await envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"], ["principal", "principal", "enabled"]]);
        const receipt = await env.mail.send(auth("a", ["mail.send"]), "relay-integrity", {
            to: ["principal"], subject: "test", kind: "question", body: "original",
        });
        const id = (receipt.result as {
            message: string;
        }).message;
        const from = env.mail.inboxNewPath("principal", id);
        const to = env.mail.inboxCurPath("principal", id);
        const bytes = readFileSync(from);
        rmSync(from);
        writeFileSync(from, "forged");
        // Rogue bytes are refused whether their size already differs or only
        // their content does.
        assert.throws(() => env.mail.moveToCur("principal", [id]), /immutable file type or size mismatch/);
        assert.equal(existsSync(to), false);
        rmSync(from);
        writeFileSync(from, Buffer.from(bytes).fill(0x78));
        assert.throws(() => env.mail.moveToCur("principal", [id]), /immutable file hash mismatch/);
        assert.equal(existsSync(to), false);
        rmSync(from);
        writeFileSync(from, bytes);
        assert.equal(env.mail.moveToCur("principal", [id]), 1);
        assert.equal(existsSync(from), false);
        assert.deepEqual(readFileSync(to), bytes);
        assert.equal(env.mail.moveToCur("principal", [id]), 0);
        writeFileSync(join(env.state, "mail", "inboxes", "principal", "new", "rogue"), bytes);
        // A mailbox name without a durable delivery cannot acquire one by moving.
        assert.throws(() => env.mail.moveToCur("principal", ["rogue"]), { code: "STORE_CORRUPT" });
        assert.deepEqual(readFileSync(join(env.state, "mail/inboxes/principal/new/rogue")), bytes);
        assert.equal(existsSync(join(env.state, "mail/inboxes/principal/cur/rogue")), false);
    }
    finally {
        await env.cleanup();
    }
});
test("T25 deterministic core: capped batches alternate direct and public mail", async () => {
    const env = await envOf();
    try {
        seed(env.store, [
            ["a", "resident", "enabled"],
            ["b", "resident", "enabled"],
        ]);
        const mail = createMailModule({ stateRoot: env.state, society: env.society }, env.store, 64, 4, TEST_VIEW_LIMITS);
        const direct = new Set<string>();
        const publicList = new Set<string>();
        for (let i = 0; i < 20; i++) {
            const d = await mail.send(auth("b", ["mail.send"]), `direct-${i}`, {
                to: ["a"],
                subject: `direct ${i}`,
                kind: "question",
                body: "d",
            });
            direct.add((d.result as {
                message: string;
            }).message);
            const p = await mail.send(auth("b", ["mail.send"]), `public-${i}`, {
                to: ["commons"],
                subject: `public ${i}`,
                kind: "message",
                body: "p",
            });
            publicList.add((p.result as {
                message: string;
            }).message);
        }
        const batch = await mail.prepare(auth("a", []));
        assert.ok(batch);
        assert.equal(batch.messageIds.length, 4);
        assert.deepEqual(batch.messageIds.map((id) => direct.has(id) ? "direct" : publicList.has(id) ? "public" : "unknown"), ["direct", "public", "direct", "public"]);
        assert.match(batch.notice, /sender=.*subject=.*kind=.*path=\/mail\/archive\/cur\//);
        assert.match(batch.notice, /Full list: \/inbox\.md/);
        await mail.send(auth("b", ["mail.send"]), "late-direct", {
            to: ["a"],
            subject: "late",
            kind: "question",
            body: "late",
        });
        const recovered = await mail.prepare(auth("a", []));
        assert.deepEqual(recovered?.messageIds, batch.messageIds);
        await assert.rejects(mail.complete(auth("a", []), {
            batchId: batch.id, incarnation: batch.incarnation, sessionPath: "/tmp/untrusted",
            adapterRevision: "unverified", receiptPath: "/tmp/untrusted",
        }), (error: unknown) => error instanceof Error && "code" in error && error.code === "SESSION_BOUNDARY_UNCONFIRMED");
        assert.equal(env.store.getDelivery(batch.messageIds[0]!, "a")!.presented, 0);
        const sessions = runnerSessionDirPathAt(env.state, "a");
        mkdirSync(sessions, { recursive: true });
        const sessionPath = writeBoundarySession(join(sessions, "settled.jsonl"), batch, "0123abcd");
        const trusted = publishDeliveryReceipt(env.state, batch, { batchId: batch.id, incarnation: batch.incarnation,
            sessionPath, entryId: "0123abcd", adapterRevision: PI_ADAPTER_REVISION }, TEST_VIEW_LIMITS.frameBytes);
        await mail.complete(auth("a", []), { batchId: batch.id, incarnation: batch.incarnation, sessionPath: trusted.sessionPath,
            adapterRevision: PI_ADAPTER_REVISION, receiptPath: runnerReceiptPathAt(env.state, "a", batch.id) });
        assert.equal(env.store.getDelivery(batch.messageIds[0]!, "a")!.presented, 1);
    }
    finally {
        await env.cleanup();
    }
});
test("prepared batch manifest shape stays compatible with the trusted extension", async () => {
    const env = await envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"]]);
        await env.mail.send(auth("a", ["mail.send"]), "s1", {
            to: ["a"],
            subject: "s",
            kind: "message",
            body: "x",
        });
        const batch = await env.mail.prepare(auth("a", []));
        assert.ok(batch !== null);
        const viewDir = join(env.state, "agents", "a", "runner", "view");
        mkdirSync(viewDir, { recursive: true });
        const manifest = {
            id: batch.id,
            agent: batch.agent,
            incarnation: batch.incarnation,
            deliveryMode: batch.deliveryMode,
            notice: batch.notice,
            messageIds: batch.messageIds,
        };
        writeFileSync(join(viewDir, `batch-${batch.id}.json`), JSON.stringify(manifest));
        const vdir = mkdtempSync(join(tmpdir(), "oma-t5-view-"));
        writeFileSync(join(vdir, "batch.json"), JSON.stringify(manifest));
        const r = spawnSync(process.execPath, ["-e", `
            const fs = require('node:fs');
            const m = JSON.parse(fs.readFileSync('batch.json','utf8'));
            if (typeof m.notice !== 'string' || !Array.isArray(m.messageIds)) process.exit(1);
            console.log('manifest ok');
        `], { cwd: vdir, encoding: "utf8" });
        assert.equal(r.status, 0, r.stderr);
        rmSync(vdir, { recursive: true, force: true });
    }
    finally {
        await env.cleanup();
    }
});
test("SB-005-negative: candidate argv rejects empty commands and removes execution caps", () => {
    const paths = { rootfs: "/trusted/rootfs", node: process.execPath, libdir: "/checks" };
    const check = { id: "bounds", argv: ["/bin/true"], env: {},
    };
    const argv = candidateSandbox(paths, "a".repeat(40), check, []).argv;
    assert.equal(argv.includes("--size"), false);
    assert.ok(argv.includes("--share-net"));
    assert.equal(argv.some(arg => /TasksMax|MemoryMax|CPUQuota|RuntimeMaxSec/.test(arg)), false);
    assert.equal(argv.some(arg => /MemoryMax|CPUQuota|RuntimeMaxSec/.test(arg)), false);
    assert.doesNotThrow(() => candidateSandbox(paths, "a".repeat(40), { ...check }, []));
    assert.throws(() => candidateSandbox(paths, "a".repeat(40), { ...check, argv: [] }, []), (e: unknown) => e instanceof Error && (e as {
        code?: string;
    }).code === "UNSUPPORTED_PROFILE");
});

test("NATIVE-CANDIDATE-DR37: real checks use network, outlive legacy caps and stop descendants on owner loss or request cancellation", { timeout: 20000 }, async t => {
    const { residentOptions, prepareResident } = await import("./fixtures/resident.js");
    const { runGitText } = await import("@oma/process/policies");
    const { CandidateChecks } = await import("#oma-test/app/runtime/candidate-checks");
    const { ExecutionJournal } = await import("@oma/storage/execution-journal");
    const { ExecutionRuntime } = await import("#oma-test/app/runtime/execution-runtime");
    const { pinNamespaceInit } = await import("@oma/native/pid-namespace");
    const { RESIDENT_PATHS } = await import("@oma/domain/resident-paths");
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    const dir = mkdtempSync(join(tmpdir(), "oma-native-unlimited-check-"));
    const opts = residentOptions(dir, process.cwd()); prepareResident(opts);
    const project = opts.paths.projectGit;
    const git = (argv: string[], input?: string) => {
        const result = runGitText(argv, { gitDir: project, ...(input === undefined ? {} : { input }), env: {
            GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        } });
        assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    git(["init", "--bare", project]);
    const candidate = git(["commit-tree", git(["mktree"], ""), "-m", "fixture"]);
    const paths = { stateRoot: dir, projectGit: project, contextGit: join(dir, "context.git"), worldDir: join(dir, "world"), society: "demo",
         checkNode: opts.confinement.host.node, checkAssetsDir: process.cwd() };
    ExecutionJournal.initialize(dir); const executions = new ExecutionRuntime(dir); await executions.recover();
    const pins: ReturnType<typeof pinNamespaceInit>[] = [];
    let interrupt = new AbortController(), hits = 0;
    const server = createServer((req, res) => {
        hits++; res.end("network-ok");
        if (req.url === "/spawned") interrupt.abort();
    });
    t.after(async () => {
        await executions.close();
        for (const pin of pins) pin.close();
        server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        rmSync(dir, { recursive: true, force: true });
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const execute: ConstructorParameters<typeof CandidateChecks>[1] = (command, signal, authorize, fds, prepared) =>
        executions.run("candidate", command, signal, authorize, fds, undefined, () => {
            const entry = ExecutionJournal.inspect(dir).find(entry => entry.slot === "candidate");
            assert.ok(entry?.witness); const pin = pinNamespaceInit(entry.witness.pid);
            assert.deepEqual(pin.identity, entry.witness); pins.push(pin); prepared();
        });
    const make = (code: string) => ({ id: "unrestricted", argv: [RESIDENT_PATHS.node, "--input-type=module", "-e", code], env: {} });
    await new CandidateChecks(paths, execute).run(candidate, make(`await fetch('${url}/ordinary'); await new Promise(r=>setTimeout(r,1500));`), undefined, () => {});
    assert.equal(hits, 1); assert.equal(pins.at(-1)!.population(), "empty");
    for (const reason of ["owner", "request"] as const) {
        interrupt = new AbortController();
        const check = new CandidateChecks(paths, execute, undefined, reason === "owner" ? interrupt.signal : undefined);
        await assert.rejects(check.run(candidate, make(`
            const {spawn}=await import('node:child_process');
            spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
            await fetch('${url}/spawned'); setInterval(()=>{},1000);
        `), reason === "request" ? interrupt.signal : undefined, () => {}), { code: reason === "owner" ? "REF_STATE_UNKNOWN" : "CANCELLED_BEFORE_COMMIT" });
        assert.equal(pins.at(-1)!.population(), "empty", "actual namespace init death includes arbitrary descendants");
        assert.equal(executions.confirmDead("candidate"), true); assert.deepEqual(ExecutionJournal.inspect(dir), []);
    }
    assert.equal(hits, 3);
});

test("DR37: MCP command credentials execute through the installed adapter policy", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'oma-mcp-credential-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const { ExecutionJournal } = await import('@oma/storage/execution-journal');
    const { ExecutionRuntime } = await import('#oma-test/app/runtime/execution-runtime');
    const { runnerScope } = await import('@oma/platform-linux/runner-scope');
    const { withAsyncCleanup } = await import('@oma/native/cleanup');
    ExecutionJournal.initialize(dir);
    const executions = new ExecutionRuntime(dir);
    // The installed adapter intentionally runs a credential command. Own its
    // entire descendant lifetime in the real namespace, not in the test host.
    // This verifies adapter policy, not a Worker grant or G-AUTH qualification.
    const program = `
      import assert from 'node:assert/strict';
      const hooks = new Map();
      const pi = { registerTool() {}, registerCommand() {}, registerFlag() {}, registerShortcut() {}, appendEntry() {}, sendMessage() {},
        exec: async () => ({ code: 0, stdout: '', stderr: '' }), events: { on() {}, off() {}, emit() { return false; } },
        on(name, hook) { hooks.set(name, [...(hooks.get(name) ?? []), hook]); } };
      const { registerMcpTools } = await import(${JSON.stringify(import.meta.resolve('@oma/tool-mcp'))});
      try {
        await registerMcpTools(pi);
        const utils = await import(${JSON.stringify(new URL("../../packages/tool-mcp/dist/vendor/pi-mcp-adapter/runtime/utils.js", import.meta.url).href)});
        assert.equal(await utils.resolveCommandSecret('!printf helper-token'), 'helper-token');
      } finally { for (const close of hooks.get('session_shutdown') ?? []) await close(); }
    `;
    await withAsyncCleanup(async () => {
        await executions.recover();
        const result = await executions.run('preparation', runnerScope({
            executable: process.execPath, argv: ['--input-type=module', '-e', program],
            env: { PATH: '/usr/bin:/bin', HOME: dir, PI_CODING_AGENT_DIR: dir },
            timeoutMs: 10000, stdoutBytes: 65536, stderrBytes: 65536,
        }), undefined, () => {});
        assert.equal(result.kind, 'exited', result.stderr.toString());
        assert.equal(result.exitCode, 0, result.stderr.toString());
        assert.equal(executions.confirmDead('preparation'), true);
        assert.deepEqual(ExecutionJournal.inspect(dir), []);
    }, () => executions.close());
});
test("DR37: web configured and per-call proxies perform real requests under the restored policy", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'oma-web-proxy-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const prior = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    t.after(() => { if (prior === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
    else
        process.env.PI_CODING_AGENT_DIR = prior; });
    const { createServer } = await import('node:http');
    const { once } = await import('node:events');
    const requests: string[] = [];
    const proxy = createServer((req, res) => { requests.push(req.url!); res.setHeader('Connection', 'close'); res.end('proxy-ok'); });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    t.after(() => { proxy.closeAllConnections(); proxy.close(); });
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as {
        port: number;
    }).port}`;
    const pi = { registerTool() { }, registerCommand() { }, registerShortcut() { }, appendEntry() { }, sendMessage() { }, on() { }, exec: async () => ({ code: 0, stdout: '', stderr: '' }) };
    const { registerWebTools } = await import('@oma/tool-web');
    await registerWebTools(pi as never);
    const specifier = new URL("../../packages/tool-web/dist/vendor/pi-web-access/runtime/utils.js", import.meta.url).href;
    const utils = await import(specifier) as {
        runWithProxy: <T>(proxy: string | undefined, fn: () => T) => T;
    };
    const destination = 'http://private.fixture.invalid:12345/path?q=1';
    const request = async () => { const response = await fetch(destination, { signal: AbortSignal.timeout(5000) }); assert.equal(await response.text(), 'proxy-ok'); };
    await utils.runWithProxy(proxyUrl, request);
    writeFileSync(join(dir, 'web-search.json'), JSON.stringify({ proxy: proxyUrl }));
    await utils.runWithProxy(undefined, request);
    assert.deepEqual(requests, [destination, destination]);
});

// Retired relay/cgroup/runtime-limit cases keep their original IDs and bytes
// in the raw archive. Current runner/Pi, credential sender and native scope
// oracles qualify their actual mechanisms independently.
