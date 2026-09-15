// Phase 5 acceptance: broker runner-channel auth, principal relay (T42),
// sandboxed Pi delivery smoke (S-03 mechanism, compiled pi-extension).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  openSync,
  closeSync,
  symlinkSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connect, createServer } from "node:net";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { resolvedSpec, ALL_CAPS, storedSpec } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import type { RunRegistry } from "../src/runtime/run-registry.js";
import { actorSocketPathAt } from "../src/storage/paths.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { decodeRunLease } from "../src/protocol/run-lease.js";
import { agentRootPathAt, runnerViewPathAt, workspacePathAt } from "../src/storage/paths.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { Broker, peerCgroup } from "../src/broker.js";
import { FrameParser, encodeFrame } from "../src/frame.js";
import { SandboxModule, candidateArgv } from "../src/sandbox.js";
import { PiRpcClient } from "../src/rpc-client.js";
import type {
  AuthContext,
  Capability,
  ResolvedAgentSpec,
  RunLease,
} from "../implementation/contracts.js";

import { cleanupOwnedSystemdUnits, requireSystemdTestManager } from "./fixtures/systemd.js";
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
  const units = new UnitsModule(
    society,
    {
      node: process.execPath,
      libdir: "/usr/lib/oma",
      state,
      society,
      agent: "",
    },
    join(dir, "xdg"),
  );
  // Batch views require the host-configured frame and manifest limits; without
  // them preparation fails closed with UNSUPPORTED_PROFILE.
  const mail = new MailModule({ stateRoot: state, society }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
  const resolver = (
    _parent: { name: string; profile: string },
    input: { name: string; from: string; brief: string },
  ): ResolvedAgentSpec => ({
    ...input,
    modelProfile: "m",
    resources: { memoryBytes: 3221225472, tasks: 128, cpuQuotaPercent: 200, tmpBytes: 1048576, workspaceBytes: 1048576, stagingBytes: 1048576, checkTimeoutSeconds: 30 },
    profile: "child",
    capabilities: ["mail.send", "route.follow"],
  });
  const lifecycle = new LifecycleModule(
    store,
    units,
    {
      stateRoot: state,
      projectGit: join(state, "repos", "project.git"),
      society,
      hasGoal: () => true,
      activationAllowed: () => true,
    },
    resolver,
    mail,
  );
  const views = new ViewsModule(store, state, society, "p");
  const broker = new Broker(store, mail, units, views, lifecycle, null, null, {
    stateRoot: state,
    runRoot,
    society,
  });
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

function seed(store: Store, specs: Array<[string, string, string]>): void {
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
    const denied = await env.broker.dispatch(
      auth(["route.follow"]),
      { v: 1, id: "deny", method: "mail.send", request: "deny", params } as never,
      null,
    );
    assert.equal((denied as { ok: boolean; error?: { code: string } }).ok, false);
    if (process.env.OMA_DEBUG) console.error("DENIED:", JSON.stringify(denied));
    assert.equal((denied as { error?: { code: string } }).error?.code, "CAPABILITY_DENIED");
    assert.equal(env.store.getOperation("a", "deny"), null);
    const allowed = await env.broker.dispatch(
      auth(["mail.send"]),
      { v: 1, id: "allow", method: "mail.send", request: "allow", params } as never,
      null,
    );
    assert.equal((allowed as { ok: boolean }).ok, true);
    assert.equal(env.store.getOperation("a", "allow")?.state, "succeeded");
    const views = Reflect.get(env.broker, "views") as ViewsModule;
    const refresh = views.refreshWorld;
    try {
      views.refreshWorld = () => { throw new Error("injected derived-view failure"); };
      for (let attempt = 0; attempt < 2; attempt++) {
        const receipt = await env.broker.dispatch(auth(["mail.send"]),
          { v: 1, id: "view-fault", method: "mail.send", request: "view-fault", params } as never, null);
        assert.equal((receipt as { result: { state: string } }).result.state, "succeeded");
      }
    } finally { views.refreshWorld = refresh; }
    const socketDirectory = Reflect.get(env.broker, "actorSocketDirectory");
    const socketOwner = { paths: { runRoot: `/run/user/1000/oma/${"s".repeat(31)}` } };
    assert.equal(typeof socketDirectory.call(socketOwner, "a".repeat(31), 1), "string");
    assert.throws(() => socketDirectory.call(socketOwner, "a".repeat(31), Number.MAX_SAFE_INTEGER), /sun_path/);
    const staleAuth = auth(["mail.send"]);
    const spec = JSON.parse(env.store.getAgent("a")!.specJson);
    // A durable capability revocation keeps the row self-consistent: the stored
    // hash must still describe the stored spec, or the row is corrupt rather
    // than a valid identity whose rights were withdrawn.
    const revokedSpec = { ...spec, capabilities: [] };
    env.store.transaction(() => env.store.updateAgent({ name: "a", specJson: JSON.stringify(revokedSpec), specHash: resolvedSpecDigest(revokedSpec) }));
    const revoked = await env.broker.dispatch(staleAuth,
      { v: 1, id: "revoked", method: "mail.send", request: "revoked", params } as never, null);
    assert.equal((revoked as { error: { code: string } }).error.code, "CAPABILITY_DENIED");
    assert.equal(env.store.getOperation("a", "revoked"), null);
    for (const [method, capability] of [["agent.create", "agent.create"], ["git.integrate", "code.integrate"], ["context.publish", "context.publish"]] as const) {
      const deniedMethod = await env.broker.dispatch(
        auth(["mail.send"]),
        { v: 1, id: method, method, request: method, params: {} } as never,
        null,
      );
      assert.equal((deniedMethod as { error?: { code: string } }).error?.code, "CAPABILITY_DENIED", `${method} must require ${capability}`);
    }
    env.store.transaction(() => env.store.updateAgent({ name: "a", desired: "stopped", specJson: JSON.stringify(spec), specHash: resolvedSpecDigest(spec) }));
    const stopped = await env.broker.dispatch(staleAuth,
      { v: 1, id: "stopped", method: "mail.send", request: "stopped", params } as never, null);
    assert.equal((stopped as { error: { code: string } }).error.code, "STALE_RUN");
    assert.equal(env.store.getOperation("a", "stopped"), null);
  } finally {
    env.cleanup();
  }
});

function adminCall(
  adminSock: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
      } catch {
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

const extPath = join(process.cwd(), "dist", "src", "pi-extension.js");

// ---------------------------------------------------------------------------

test("T11-neq: non-unit process cannot open a run on the runner channel", async () => {
  const env = envOf();
  try {
    seed(env.store, [["a", "resident", "enabled"]]);
    const reply = await adminCall(
      join(env.runRoot, "admin.sock"),
      "runner.open",
      { agent: "a", invocationId: "00000000000000000000000000000000" },
    );
    assert.equal(reply.ok, false);
    assert.equal((reply.error as { code: string }).code, "AUTH_FAILED");
  } finally {
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
    const reply = await adminCall(
      join(env.runRoot, "admin.sock"),
      "batch.complete",
      {
        batchId: batch.id,
        incarnation: batch.incarnation,
        sessionPath: "/tmp/x",
        adapterRevision: "fake",
        receiptPath: "/tmp/fake.json",
      },
    );
    assert.equal(reply.ok, false);
    assert.equal((reply.error as { code: string }).code, "AUTH_FAILED");
  } finally {
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
    assert.equal(
      (receipt.result as { recipientCount: number }).recipientCount,
      1,
    );
    const newDir = join(env.state, "mail", "inboxes", "principal", "new");
    assert.equal(readdirSync(newDir).length, 1);
    const forged = await adminCall(
      join(env.runRoot, "host.sock"),
      "host.principalRelay",
      {},
    );
    assert.equal(forged.ok, false);
    assert.equal((forged.error as { code: string }).code, "AUTH_FAILED");

    const helper = join(env.dir, "host-call.mjs");
    const out = join(env.dir, "host-call.json");
    writeFileSync(
      helper,
      `import { connect } from "node:net";
const request = Buffer.from(JSON.stringify({v:1,id:"h",method:"host.principalRelay",params:{}}));
const frame = Buffer.alloc(4 + request.length); frame.writeUInt32BE(request.length); request.copy(frame, 4);
let data = Buffer.alloc(0); const socket = connect(process.env.OMA_HOST_SOCK, () => socket.write(frame));
socket.on("data", chunk => { data = Buffer.concat([data, chunk]); if (data.length >= 4 && data.length >= 4 + data.readUInt32BE(0)) {
  import("node:fs").then(fs => fs.writeFileSync(process.env.OMA_OUT, data.subarray(4, 4 + data.readUInt32BE(0)))); socket.destroy();
}});`,
      "utf8",
    );
    const unit = `oma-${env.society}-principal-relay.service`;
    const started = spawn(
      "systemd-run",
      [
        "--user",
        "--quiet",
        "--wait",
        "--collect",
        `--unit=${unit}`,
        `--setenv=OMA_HOST_SOCK=${join(env.runRoot, "host.sock")}`,
        `--setenv=OMA_OUT=${out}`,
        process.execPath,
        helper,
      ],
      { env: process.env },
    );
    const exit = new Promise<number | null>((resolve) => started.on("exit", resolve));
    for (let i = 0; i < 500 && !existsSync(out); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(existsSync(out), true, "host unit produced no response");
    assert.equal(await exit, 0);
    const reply = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
    assert.equal(reply.ok, true);
    const res = reply.result as { moved: number; pending: number };
    assert.equal(res.moved, 1);
    assert.equal(readdirSync(newDir).length, 0);
    assert.equal(
      readdirSync(join(env.state, "mail", "inboxes", "principal", "cur"))
        .length,
      1,
    );
    assert.equal(env.store.preparedBatches("principal").length, 0);
  } finally {
    env.cleanup();
  }
});

test("RUN-001: a populated pinned old cgroup blocks incarnation handoff", () => {
  const env = envOf();
  const cgroup = readFileSync("/proc/self/cgroup", "utf8").trim().split("::")[1]!;
  const registry = Reflect.get(env.broker, "runLeases") as RunRegistry;
  const units = Reflect.get(env.broker, "units") as UnitsModule;
  const observe = units.observe.bind(units);
  try {
    seed(env.store, [["a", "resident", "enabled"]]);
    mkdirSync(join(env.state, "world", "context", "current"), { recursive: true });
    const probe = openSync(join("/sys/fs/cgroup", cgroup), "r");
    try { assert.match(readFileSync(`/proc/self/fd/${probe}/cgroup.events`, "utf8"), /^populated 1$/m); }
    finally { closeSync(probe); }
    // Fault seam: register a genuinely populated kernel cgroup as the previous
    // run through the registry that owns the pin.
    const previous = registry.begin("a", 1, "1".repeat(32), cgroup);
    const baseline = observe("a");
    units.observe = () => ({ ...baseline, cgroup, invocationId: "2".repeat(32) });
    assert.throws(() => Reflect.get(env.broker, "openRun").call(env.broker, "a", "2".repeat(32)), /previous invocation cgroup/);
    assert.equal(env.store.getAgent("a")!.incarnation, 1);
    assert.equal(previous.population(), "populated", "a pinned cgroup is observed, never assumed dead");
  } finally { units.observe = observe; env.cleanup(); }
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
  } finally { units.observe = observe; env.cleanup(); }
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
  } finally { env.cleanup(); }
});

test("PR-002/BATCH-001: mailbox moves reject rogue bytes and preserve valid recovery", async () => {
  const env = envOf();
  try {
    seed(env.store, [["a", "resident", "enabled"], ["principal", "principal", "enabled"]]);
    const receipt = await env.mail.send(auth("a", ["mail.send"]), "relay-integrity", {
      to: ["principal"], subject: "test", kind: "question", body: "original",
    });
    const id = (receipt.result as { message: string }).message;
    const from = env.mail.inboxNewPath("principal", id);
    const to = env.mail.inboxCurPath("principal", id);
    const bytes = readFileSync(from);
    rmSync(from);
    writeFileSync(from, "forged");
    assert.throws(() => env.mail.moveToCur("principal", [id]), /integrity mismatch/);
    assert.equal(existsSync(to), false);
    writeFileSync(from, bytes);
    assert.equal(env.mail.moveToCur("principal", [id]), 1);
    assert.equal(existsSync(from), false);
    assert.deepEqual(readFileSync(to), bytes);
    assert.equal(env.mail.moveToCur("principal", [id]), 0);
    writeFileSync(join(env.state, "mail", "inboxes", "principal", "new", "rogue"), bytes);
    // A name that is not an internal message identity is refused before any move.
    assert.throws(() => env.mail.moveToCur("principal", ["rogue"]),
      (error: unknown) => error instanceof TypeError || (error as { code?: string }).code === "INVALID_REQUEST");
  } finally { env.cleanup(); }
});

test("T25 deterministic core: capped batches alternate direct and public mail", async () => {
  const env = envOf();
  try {
    seed(env.store, [
      ["a", "resident", "enabled"],
      ["b", "resident", "enabled"],
    ]);
    const mail = new MailModule(
      { stateRoot: env.state, society: env.society },
      env.store,
      64,
      4,
      TEST_VIEW_LIMITS,
    );
    const direct = new Set<string>();
    const publicList = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const d = await mail.send(auth("b", ["mail.send"]), `direct-${i}`, {
        to: ["a"],
        subject: `direct ${i}`,
        kind: "question",
        body: "d",
      });
      direct.add((d.result as { message: string }).message);
      const p = await mail.send(auth("b", ["mail.send"]), `public-${i}`, {
        to: ["commons"],
        subject: `public ${i}`,
        kind: "message",
        body: "p",
      });
      publicList.add((p.result as { message: string }).message);
    }
    const batch = await mail.prepare(auth("a", []));
    assert.ok(batch);
    assert.equal(batch.messageIds.length, 4);
    assert.deepEqual(
      batch.messageIds.map((id) =>
        direct.has(id) ? "direct" : publicList.has(id) ? "public" : "unknown",
      ),
      ["direct", "public", "direct", "public"],
    );
    assert.match(batch.notice, /sender=.*subject=.*kind=.*path=\/mail\/archive\/cur\//);
    assert.match(batch.notice, /전체 목록: \/inbox\.md/);
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
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "SPIKE_UNRESOLVED");
    assert.equal(env.store.getDelivery(batch.messageIds[0]!, "a")!.presented, 0);
  } finally {
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
    writeFileSync(
      join(viewDir, `batch-${batch.id}.json`),
      JSON.stringify(manifest),
    );
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
  } finally {
    env.cleanup();
  }
});

function makeSyntheticRootfs(root: string, extHostPath: string): string {
  for (const t of [
    "usr",
    "lib",
    "lib64",
    "bin",
    "sbin",
    "etc",
    "proc",
    "dev",
    "workspace",
    "home/agent",
    "tmp",
    "mail/archive",
    "mail/self",
    "run/oma-view",
    "world",
    "git/project.git",
    "run/oma",
    "opt/oma",
    // A real rootfs carries these mountpoints; the sandbox profile mounts over
    // them, so the synthetic fixture must provide them too.
    "proc",
    "dev",
    "usr",
    "lib",
    "lib64",
    "bin",
    "sbin",
    "etc",
  ]) {
    mkdirSync(join(root, t), { recursive: true });
  }
  symlinkSync("/run/oma-view/inbox.md", join(root, "inbox.md"));
  copyFileSync(extHostPath, join(root, "opt", "oma", "pi-extension.js"));
  writeFileSync(join(root, "run", "oma", "control.sock"), "");
  return root;
}

test("deliver smoke: sandboxed Pi loads the trusted extension; custom message role is 'custom'; no provider -> no boundary evidence", {
  timeout: 60000,
}, async () => {
  if (!existsSync(extPath)) {
    assert.fail("dist/src/pi-extension.js missing; build first");
  }
  const dir = mkdtempSync(join(tmpdir(), "oma-t5pi-"));
  try {
    const rootfs = join(dir, "rootfs");
    mkdirSync(rootfs, { recursive: true });
    makeSyntheticRootfs(rootfs, extPath);

    // The resident profile requires the trusted roots, the configured batch view
    // limits and a decoded, root-bound lease whose mounts are exactly the paths
    // derived from the state root.
    const stateRoot = join(dir, "state");
    const runRoot = join(dir, "run");
    const viewDir = runnerViewPathAt(stateRoot, "a");
    const mailRoot = join(stateRoot, "mail");
    for (const path of [join(stateRoot, "world"), join(stateRoot, "repos", "project.git"), viewDir,
      join(mailRoot, "archive"), join(mailRoot, "inboxes", "a"), workspacePathAt(stateRoot, "a"),
      join(agentRootPathAt(stateRoot, "a"), "home"), runRoot]) mkdirSync(path, { recursive: true });
    const smokeMessageId = "m-00000000-0000-4000-8000-000000000001-0";
    const manifest = {
      id: "b-00000000-0000-4000-8000-000000000000",
      agent: "a",
      incarnation: 1,
      deliveryMode: "followUp",
      notice: `새 연락 1건. 전체 목록: /inbox.md\n1. mail ${smokeMessageId}`,
      messageIds: [smokeMessageId],
    };
    writeFileSync(
      join(viewDir, `batch-${manifest.id}.json`),
      JSON.stringify(manifest),
    );

    const sandbox = new SandboxModule({
      rootfs,
      node: "/usr/bin/node",
      pi: "/usr/bin/pi",
      piModeArgs: ["--mode", "rpc", "-e", "/opt/oma/pi-extension.js"],
      tmpBytes: 64 * 1024 * 1024,
      stateRoot,
      runRoot,
      limits: TEST_VIEW_LIMITS,
      checkResources: {
        memoryBytes: 0,
        tasks: 0,
        cpuQuotaPercent: 0,
        tmpBytes: 0,
        workspaceBytes: 0,
        stagingBytes: 0,
        checkTimeoutSeconds: 1,
      },
    });
    const lease = decodeRunLease(
      { actor: "a", incarnation: 1, socketHostPath: actorSocketPathAt(runRoot, "a", 1) },
      { actor: "a", runRoot });
    const argv = sandbox.resident(lease, {
      workspace: workspacePathAt(stateRoot, "a"),
      home: join(agentRootPathAt(stateRoot, "a"), "home"),
      archive: join(mailRoot, "archive"),
      selfMail: join(mailRoot, "inboxes", "a"),
      view: viewDir,
      world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"),
    }).argv;
    const sysOverlays = [
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/sbin",
      "/sbin",
      "--ro-bind",
      "/etc",
      "/etc",
    ];
    const ridx = argv.indexOf("--proc");
    const withSys = [
      ...argv.slice(0, ridx),
      ...sysOverlays,
      ...argv.slice(ridx),
    ];
    mkdirSync(join(dir, "home"), { recursive: true });
    mkdirSync(join(dir, "archive"), { recursive: true });
    mkdirSync(join(dir, "self"), { recursive: true });
    mkdirSync(join(dir, "world"), { recursive: true });
    mkdirSync(join(dir, "git"), { recursive: true });
    // The broker owns the actor control socket before a runner starts, and the
    // profile binds that host path into the sandbox. Without it bwrap exits
    // before exec, so the fixture creates the real endpoint.
    const controlServer = createServer();
    mkdirSync(dirname(lease.socketHostPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      controlServer.once("error", reject);
      controlServer.listen(lease.socketHostPath, resolve);
    });

    const child = spawn(withSys[0]!, withSys.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pi = new PiRpcClient(child, { frameBytes: 262144, idleStreamSeconds: 30, receiptWaitSeconds: 30 });
    const events: Array<{
      type: string;
      message?: { role?: string; customType?: string; stopReason?: string };
    }> = [];
    let stderr = "";
    let spawnFailure = "";
    child.once("error", (error) => { spawnFailure = `${(error as NodeJS.ErrnoException).code ?? ""} ${String(error.message)}`; });
    child.stderr.on("data", (data) => { stderr += String(data); });
    let customSeen = false;
    let providerErrorSeen = false;
    const evidence = new Promise<void>((resolve) => {
      pi.onEvent((e) => {
        events.push(e as never);
        if (e.type === "message_start" &&
            (e as { message?: { role?: string; customType?: string } }).message?.role === "custom" &&
            (e as { message?: { role?: string; customType?: string } }).message?.customType === "oma-mail")
          customSeen = true;
        if (e.type === "message_end" &&
            (e as { message?: { stopReason?: string } }).message?.stopReason === "error")
          providerErrorSeen = true;
        if (customSeen && providerErrorSeen) resolve();
      });
      child.once("error", () => resolve());
      // "close" runs after stdio ends, so diagnostics are complete when the
      // assertion below reports them.
      child.once("close", () => resolve());
    });
    await new Promise((r) => setTimeout(r, 3000));
    pi.send({
      id: "d1",
      type: "prompt",
      message: `/oma-deliver ${manifest.id}`,
    });
    await Promise.race([
      evidence,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`Pi delivery evidence timeout; events=${JSON.stringify(events)} stderr=${JSON.stringify(stderr)}`)),
          15000,
        ),
      ),
    ]);
    pi.close();
    try {
      child.kill("SIGKILL");
    } catch {
      /* */
    }
    controlServer.close();

    const custom = events.find(
      (e) => e.type === "message_start" && e.message?.role === "custom",
    );
    assert.ok(
      custom,
      `no custom message delivered; spawn=${JSON.stringify(spawnFailure)} code=${child.exitCode} signal=${child.signalCode} events=${JSON.stringify(events)} stderr=${JSON.stringify(stderr)}`,
    );
    assert.equal(custom.message?.customType, "oma-mail");
    const failed = events.some(
      (e) => e.type === "message_end" && e.message?.stopReason === "error",
    );
    assert.equal(failed, true, `provider error not observed; events=${JSON.stringify(events)} stderr=${JSON.stringify(stderr)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SB-005-negative: candidate argv rejects empty commands and keeps tmp cap", () => {
  const host = {
    rootfs: "/trusted/rootfs",
    node: "/usr/bin/node",
    pi: "/usr/bin/pi",
    piModeArgs: [],
    tmpBytes: 4096,
    checkResources: {
      memoryBytes: 1,
      tasks: 1,
      cpuQuotaPercent: 1,
      tmpBytes: 4096,
      workspaceBytes: 1,
      stagingBytes: 1,
      checkTimeoutSeconds: 1,
    },
  };
  const argv = candidateArgv(host, "/candidate", "/checks", 4096, ["/bin/true"]);
  const size = argv.indexOf("--size");
  assert.notEqual(size, -1);
  assert.equal(argv[size + 1], "4096");
  assert.throws(
    () => candidateArgv(host, "/candidate", "/checks", 0, ["/bin/true"]),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === "CHECK_FAILED",
  );
  assert.throws(
    () => candidateArgv(host, "/candidate", "/checks", 4096, []),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === "CHECK_FAILED",
  );
});

test("SB-005: systemd timeout kills candidate descendants", { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-t7-timeout-"));
  const marker = join(dir, "late-marker");
  try {
    const child = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 1000);`;
    const parent = `const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "ignore" }); setTimeout(() => {}, 2000);`;
    const r = spawnSync(
      "systemd-run",
      [
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
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});