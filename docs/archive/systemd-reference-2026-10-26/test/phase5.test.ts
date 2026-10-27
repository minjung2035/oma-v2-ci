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
import { UnitsModule } from "@oma/platform-linux/units";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { Broker, peerCgroup } from "@oma/broker";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { candidateCheckCommand } from "#oma-test/app/runtime/candidate-checks";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import type { AuthContext, Capability, ResolvedAgentSpec, RunLease, } from "@oma/contracts";
import { cleanupOwnedSystemdUnits, requireSystemdTestManager } from "./fixtures/systemd.js";
import { writeBoundarySession } from "./fixtures/delivery-receipt.js";
import { goalPublishedAt } from "./fixtures/goal.js";
requireSystemdTestManager();
interface Env {
    dir: string;
    state: string;
    runRoot: string;
    society: string;
    store: Store;
    mail: MailModule;
    broker: Broker;
    cleanup: () => void;
}
function envOf(): Env {
    const dir = mkdtempSync(join(tmpdir(), "oma-t5-"));
    const state = join(dir, "state");
    const runRoot = join(dir, "run");
    const society = `t5${Date.now().toString(36)}`;
    mkdirSync(state, { recursive: true });
    mkdirSync(runRoot, { recursive: true });
    const store = new Store(join(state, "runtime.sqlite"));
    const units = new UnitsModule(society, {
        node: process.execPath,
        libdir: "/usr/lib/oma",
        state,
        society,
        agent: "", config: join(state, "config.json"), run: join(state, "oma", society)
    }, join(dir, "xdg"));
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
    broker.start();
    return {
        dir,
        state,
        runRoot,
        society,
        store,
        mail,
        broker,
        cleanup: () => {
            broker.drainAndClose();
            cleanupOwnedSystemdUnits(dir, society);
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
    const env = envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"], ["b", "resident", "enabled"]]);
        const auth = (capabilities: Capability[]): AuthContext => ({
            actor: "a",
            incarnation: 1,
            role: "resident",
            channel: "actor",
            capabilities: new Set(capabilities),
            peer: { pid: 0, uid: -1, gid: -1, cgroup: null },
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
            views.refreshWorld = () => { throw new Error("injected derived-view failure"); };
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
            views.refreshWorld = refresh;
        }
        const socketDirectory = Reflect.get(env.broker, "actorSocketDirectory");
        const socketOwner = { paths: { runRoot: `/run/user/1000/oma/${"s".repeat(31)}` } };
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
        env.cleanup();
    }
});
function adminCall(adminSock: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const sock = connect(adminSock, () => {
            sock.write(encodeFrame({ v: 1, id: "t", method, params }));
        });
        const parser = new FrameParser(256 * 1024);
        let partial = Buffer.alloc(0);
        const timer = setTimeout(() => {
            sock.destroy();
            reject(new Error("admin timeout"));
        }, 10000);
        sock.on("data", (d) => {
            partial = Buffer.concat([partial, Buffer.from(d)]);
            let done = false;
            try {
                for (const f of parser.feed(partial)) {
                    if (!done) {
                        done = true;
                        clearTimeout(timer);
                        sock.destroy();
                        resolve(f.raw as Record<string, unknown>);
                    }
                }
            }
            catch {
                /* incomplete frame; keep buffering */
            }
            partial = Buffer.alloc(0);
        });
        sock.on("error", (e) => {
            clearTimeout(timer);
            reject(e);
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
        peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
    };
}
// ---------------------------------------------------------------------------
test("T11-neq: non-unit process cannot open a run on the runner channel", async () => {
    const env = envOf();
    try {
        seed(env.store, [["a", "resident", "enabled"]]);
        const reply = await adminCall(join(env.runRoot, "admin.sock"), "runner.open", { agent: "a", invocationId: "00000000000000000000000000000000" });
        assert.equal(reply.ok, false);
        assert.equal((reply.error as {
            code: string;
        }).code, "AUTH_FAILED");
    }
    finally {
        env.cleanup();
    }
});
test("T31-neg: forged batch.complete from outside the owning unit is rejected", async () => {
    const env = envOf();
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
        const reply = await adminCall(join(env.runRoot, "admin.sock"), "batch.complete", {
            batchId: batch.id,
            incarnation: batch.incarnation,
            sessionPath: "/tmp/x",
            adapterRevision: "fake",
            receiptPath: "/tmp/fake.json",
        });
        assert.equal(reply.ok, false);
        assert.equal((reply.error as {
            code: string;
        }).code, "AUTH_FAILED");
    }
    finally {
        env.cleanup();
    }
});
test("T42: principal relay moves new mail to cur, counts pending, spawns no model", async () => {
    const env = envOf();
    try {
        seed(env.store, [
            ["a", "resident", "enabled"],
            ["principal", "principal", "enabled"],
        ]);
        const receipt = await env.mail.send(auth("a", ["mail.send"]), "q1", {
            to: ["principal"],
            subject: "question",
            kind: "question",
            body: "?",
        });
        assert.equal((receipt.result as {
            recipientCount: number;
        }).recipientCount, 1);
        const newDir = join(env.state, "mail", "inboxes", "principal", "new");
        assert.equal(readdirSync(newDir).length, 1);
        const forged = await adminCall(join(env.runRoot, "host.sock"), "host.principalRelay", {});
        assert.equal(forged.ok, false);
        assert.equal((forged.error as {
            code: string;
        }).code, "AUTH_FAILED");
        const helper = join(env.dir, "host-call.mjs");
        const out = join(env.dir, "host-call.json");
        writeFileSync(helper, `import { connect } from "node:net";
const request = Buffer.from(JSON.stringify({v:1,id:"h",method:"host.principalRelay",params:{}}));
const frame = Buffer.alloc(4 + request.length); frame.writeUInt32BE(request.length); request.copy(frame, 4);
let data = Buffer.alloc(0); const socket = connect(process.env.OMA_HOST_SOCK, () => socket.write(frame));
socket.on("data", chunk => { data = Buffer.concat([data, chunk]); if (data.length >= 4 && data.length >= 4 + data.readUInt32BE(0)) {
  import("node:fs").then(fs => fs.writeFileSync(process.env.OMA_OUT, data.subarray(4, 4 + data.readUInt32BE(0)))); socket.destroy();
}});`, "utf8");
        const unit = `oma-${env.society}-principal-relay.service`;
        const started = spawn("systemd-run", [
            "--user",
            "--quiet",
            "--wait",
            "--collect",
            `--unit=${unit}`,
            `--setenv=OMA_HOST_SOCK=${join(env.runRoot, "host.sock")}`,
            `--setenv=OMA_OUT=${out}`,
            process.execPath,
            helper,
        ], { env: process.env });
        const exit = new Promise<number | null>((resolve) => started.on("exit", resolve));
        for (let i = 0; i < 500 && !existsSync(out); i++)
            await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(existsSync(out), true, "host unit produced no response");
        assert.equal(await exit, 0);
        const reply = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
        assert.equal(reply.ok, true);
        const res = reply.result as {
            moved: number;
            pending: number;
        };
        assert.equal(res.moved, 1);
        assert.equal(readdirSync(newDir).length, 0);
        assert.equal(readdirSync(join(env.state, "mail", "inboxes", "principal", "cur"))
            .length, 1);
        assert.equal(env.store.preparedBatches("principal").length, 0);
    }
    finally {
        env.cleanup();
    }
});
test("RUN-001: a populated pinned old cgroup blocks incarnation handoff", async () => {
    const env = envOf();
    const cgroup = readFileSync("/proc/self/cgroup", "utf8").trim().split("::")[1]!;
    const registry = Reflect.get(env.broker, "runLeases") as RunRegistry;
    const units = Reflect.get(env.broker, "units") as UnitsModule;
    const observe = units.observe.bind(units);
    try {
        seed(env.store, [["a", "resident", "enabled"]]);
        mkdirSync(join(env.state, "world", "context", "current"), { recursive: true });
        const probe = openSync(join("/sys/fs/cgroup", cgroup), "r");
        try {
            assert.match(readFileSync(`/proc/self/fd/${probe}/cgroup.events`, "utf8"), /^populated 1$/m);
        }
        finally {
            closeSync(probe);
        }
        // Fault seam: register a genuinely populated kernel cgroup as the previous
        // run through the registry that owns the pin.
        const previous = registry.begin("a", 1, "1".repeat(32), cgroup);
        const baseline = observe("a");
        units.observe = () => ({ ...baseline, cgroup, invocationId: "2".repeat(32) });
        await assert.rejects(() => Reflect.get(env.broker, "openRun").call(env.broker, "a", "2".repeat(32)), /previous invocation cgroup/);
        assert.equal(env.store.getAgent("a")!.incarnation, 1);
        assert.equal(previous.population(), "populated", "a pinned cgroup is observed, never assumed dead");
    }
    finally {
        units.observe = observe;
        env.cleanup();
    }
});
test("AUTH-003 fault seam: actor auth requires a live lease, matching invocation and pinned cgroup inode", async () => {
    const env = envOf();
    const units = Reflect.get(env.broker, "units") as UnitsModule;
    const observe = units.observe.bind(units);
    const registry = Reflect.get(env.broker, "runLeases") as RunRegistry;
    const cg = peerCgroup(process.pid)!;
    try {
        seed(env.store, [["a", "resident", "enabled"]]);
        const baseline = observe("a");
        let invocation = "1".repeat(32);
        units.observe = () => ({ ...baseline, cgroup: cg, invocationId: invocation });
        let peerAlive = true; // Explicit peer-liveness seam; native pidfd has its own process-exit test.
        const authenticate = () => Reflect.get(env.broker, "trustedContext").call(env.broker, "a", { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), alive: () => peerAlive });
        assert.equal(authenticate(), null, "an opening run has no live lease yet");
        const record = registry.begin("a", 1, invocation, cg);
        const lease = record.publish({ socketHostPath: actorSocketPathAt(join(env.dir, "R"), "a", 1), done: () => undefined });
        const authenticated = authenticate() as AuthContext;
        assert.equal(authenticated.actor, "a");
        assert.equal(authenticated.capabilities.has("mail.send"), true);
        invocation = "2".repeat(32);
        assert.equal(authenticate(), null, "cgroup pathname alone is not invocation identity");
        invocation = record.invocationId;
        const inFlight = env.mail.send(authenticated, "lease-revoked", { to: ["a"], subject: "revoked", kind: "message", body: "body" });
        record.revoke();
        assert.equal(authenticate(), null);
        assert.equal(authenticated.capabilities.size, 0, "revocation must invalidate in-flight authorization too");
        await assert.rejects(inFlight, { code: "CAPABILITY_DENIED" });
        assert.equal(env.store.getOperation("a", "lease-revoked"), null);
        // The observed endpoint must match the pinned inode, not just a pathname.
        units.observe = () => ({ ...baseline, cgroup: env.dir, invocationId: invocation });
        assert.equal(authenticate(), null, "a different pinned inode cannot authenticate the same path");
        units.observe = () => ({ ...baseline, cgroup: cg, invocationId: invocation });
        assert.equal(authenticate(), null, "a revoked run cannot re-authenticate");
        peerAlive = false;
        assert.equal(authenticate(), null);
        assert.equal(authenticated.capabilities.size, 0);
        void lease;
    }
    finally {
        units.observe = observe;
        env.cleanup();
    }
});
test("BATCH-001: failed view publication retries the same prepared snapshot", async () => {
    const env = envOf();
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
        env.cleanup();
    }
});
test("PR-002/BATCH-001: mailbox moves reject rogue bytes and preserve valid recovery", async () => {
    const env = envOf();
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
        // A name that is not an internal message identity is refused before any move.
        assert.throws(() => env.mail.moveToCur("principal", ["rogue"]), (error: unknown) => error instanceof TypeError || (error as {
            code?: string;
        }).code === "INVALID_REQUEST");
    }
    finally {
        env.cleanup();
    }
});
test("T25 deterministic core: capped batches alternate direct and public mail", async () => {
    const env = envOf();
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
        env.cleanup();
    }
});
test("prepared batch manifest shape stays compatible with the trusted extension", async () => {
    const env = envOf();
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
        const extCheck = `node -e "
      const fs = require('node:fs');
      process.chdir('/tmp/oma-t5-view');
      const m = JSON.parse(fs.readFileSync('batch.json','utf8'));
      if (typeof m.notice !== 'string' || !Array.isArray(m.messageIds)) process.exit(1);
      console.log('manifest ok');
    "`;
        const vdir = "/tmp/oma-t5-view";
        mkdirSync(vdir, { recursive: true });
        writeFileSync(join(vdir, "batch.json"), JSON.stringify(manifest));
        const r = spawnSync("bash", ["-c", extCheck], { encoding: "utf8" });
        assert.equal(r.status, 0, r.stderr);
        rmSync(vdir, { recursive: true, force: true });
    }
    finally {
        env.cleanup();
    }
});
test("SB-005-negative: candidate argv rejects empty commands and removes execution caps", () => {
    const paths = { stateRoot: "/state", projectGit: "/state/project.git", contextGit: "/state/context.git", worldDir: "/state/world",
        society: "demo", checkRootfs: "/trusted/rootfs", checkNode: process.execPath, checkAssetsDir: "/checks" };
    const check = { id: "bounds", argv: ["/bin/true"], env: {},
    };
    const argv = candidateCheckCommand(paths, "a".repeat(40), check, []).argv;
    assert.equal(argv.includes("--size"), false);
    assert.ok(argv.includes("--share-net"));
    assert.ok(argv.includes("--property=TasksMax=infinity"));
    assert.equal(argv.some(arg => /MemoryMax|CPUQuota|RuntimeMaxSec/.test(arg)), false);
    assert.doesNotThrow(() => candidateCheckCommand(paths, "a".repeat(40), { ...check }, []));
    assert.throws(() => candidateCheckCommand(paths, "a".repeat(40), { ...check, argv: [] }, []), (e: unknown) => e instanceof Error && (e as {
        code?: string;
    }).code === "UNSUPPORTED_PROFILE");
});
test("SB-005: systemd timeout kills candidate descendants", { timeout: 10000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-t7-timeout-"));
    const marker = join(dir, "late-marker");
    try {
        const child = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 1000);`;
        const parent = `const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "ignore" }); setTimeout(() => {}, 2000);`;
        const r = spawnSync("systemd-run", [
            "--user",
            "--wait",
            "--collect",
            "--service-type=exec",
            "--property=RuntimeMaxSec=0.1s",
            "--property=KillMode=control-group",
            "--",
            process.execPath,
            "-e",
            parent,
        ], { encoding: "utf8" });
        assert.notEqual(r.status, 0);
        await new Promise((resolve) => setTimeout(resolve, 1300));
        assert.equal(existsSync(marker), false);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("DR37: real candidate checks use network, outlive legacy caps and stop their whole cgroup on owner loss or request cancellation", { timeout: 20000 }, async (t) => {
    const { residentOptions, prepareResident } = await import('./fixtures/resident.js');
    const { runGitText } = await import("@oma/process/policies");
    const { CandidateChecks } = await import("#oma-test/app/runtime/candidate-checks");
    const { runProcess } = await import("@oma/process/run");
    const { RESIDENT_PATHS } = await import('@oma/domain/resident-paths');
    const { createServer } = await import('node:http');
    const { once } = await import('node:events');
    const dir = mkdtempSync(join(tmpdir(), 'oma-unlimited-check-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const opts = residentOptions(dir, process.cwd());
    prepareResident(opts);
    const project = opts.paths.projectGit;
    const git = (argv: string[], input?: string) => {
        const result = runGitText(argv, { gitDir: project, ...(input === undefined ? {} : { input }), env: {
                GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
                GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'
            } });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    git(['init', '--bare', project]);
    const candidate = git(['commit-tree', git(['mktree'], ''), '-m', 'fixture']);
    const paths = { stateRoot: dir, projectGit: project, contextGit: join(dir, 'context.git'), worldDir: join(dir, 'world'),
        society: 'demo', checkRootfs: opts.confinement.host.rootfs,
        checkNode: opts.confinement.host.node, checkAssetsDir: process.cwd() };
    let interrupt = new AbortController();
    let hits = 0;
    let cgroup: string | undefined;
    const server = createServer((req, res) => {
        hits++;
        res.end('network-ok');
        if (req.url === '/spawned')
            void (async () => {
                const command = candidateCheckCommand(paths, candidate, make('setInterval(()=>{},1000)'));
                const unit = command.argv.find(arg => arg.startsWith('--unit='))!.slice(7);
                const observed = await runProcess({ executable: '/usr/bin/systemctl', argv: ['--user', 'show', unit, '--property=ControlGroup', '--value'],
                    env: { ...process.env }, timeoutMs: 5000, stdoutBytes: 4096, stderrBytes: 4096 });
                assert.equal(observed.kind, 'exited');
                cgroup = observed.stdout.toString().trim();
                const tasks = await runProcess({ executable: '/usr/bin/systemctl', argv: ['--user', 'show', unit, '--property=TasksMax', '--value'],
                    env: { ...process.env }, timeoutMs: 5000, stdoutBytes: 4096, stderrBytes: 4096 });
                assert.equal(tasks.kind, 'exited');
                assert.equal(tasks.stdout.toString().trim(), 'infinity');
                interrupt.abort();
            })();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const url = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    const resources = { memoryBytes: 1, tasks: 1, cpuQuotaPercent: 1, stagingBytes: 1, checkTimeoutSeconds: 1 };
    function make(code: string) { return { id: 'unrestricted', argv: [RESIDENT_PATHS.node, '--input-type=module', '-e', code], env: {},  }; }
    await new CandidateChecks(paths).run(candidate, make(`await fetch('${url}/ordinary');await new Promise(r=>setTimeout(r,1500));`));
    assert.equal(hits, 1, 'the actual checker reached the host service and passed beyond its old deadline');
    for (const reason of ['owner', 'request'] as const) {
        interrupt = new AbortController();
        cgroup = undefined;
        await assert.rejects(new CandidateChecks(paths, undefined, undefined, reason === 'owner' ? interrupt.signal : undefined).run(candidate, make(`
const {spawn}=await import('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
await fetch('${url}/spawned');setInterval(()=>{},1000);`), reason === 'request' ? interrupt.signal : undefined), { code: reason === 'owner' ? 'REF_STATE_UNKNOWN' : 'CANCELLED_BEFORE_COMMIT' });
        assert.ok((cgroup as string | undefined)?.startsWith('/'), 'the checker cgroup was actually observed before cancellation');
        const events = `/sys/fs/cgroup${cgroup}/cgroup.events`;
        assert.ok(!existsSync(events) || /^populated 0$/m.test(readFileSync(events, 'utf8')), `descendants survived ${reason} cancellation`);
    }
});
test("DR37: MCP command credentials execute through the installed adapter policy", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'oma-mcp-credential-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const prior = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    t.after(() => { if (prior === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
    else
        process.env.PI_CODING_AGENT_DIR = prior; });
    const hooks = new Map<string, Array<() => unknown>>();
    const pi = { registerTool() { }, registerCommand() { }, registerFlag() { }, registerShortcut() { }, appendEntry() { }, sendMessage() { },
        exec: async () => ({ code: 0, stdout: '', stderr: '' }), events: { on() { }, off() { }, emit() { return false; } },
        on(name: string, hook: () => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), hook]); } };
    const { registerMcpTools } = await import('@oma/tool-mcp');
    await registerMcpTools(pi as never);
    const specifier = new URL("../../packages/tool-mcp/dist/vendor/pi-mcp-adapter/runtime/utils.js", import.meta.url).href;
    const utils = await import(specifier) as {
        resolveCommandSecret: (value: string) => Promise<string>;
    };
    assert.equal(await utils.resolveCommandSecret('!printf helper-token'), 'helper-token');
    for (const close of hooks.get('session_shutdown') ?? [])
        await close();
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
