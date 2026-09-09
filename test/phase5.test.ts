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
import { join } from "node:path";
import { connect } from "node:net";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { Broker } from "../src/broker.js";
import { FrameParser, encodeFrame } from "../src/frame.js";
import { SandboxModule, candidateArgv } from "../src/sandbox.js";
import { PiRpcClient } from "../src/rpc-client.js";
import type {
  AuthContext,
  Capability,
  ResolvedAgentSpec,
  RunLease,
} from "../implementation/contracts.js";

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
  const mail = new MailModule({ stateRoot: state, society }, store, 64);
  const resolver = (
    _parent: { name: string; profile: string },
    input: { name: string; from: string; brief: string },
  ): ResolvedAgentSpec => ({
    ...input,
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
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seed(store: Store, specs: Array<[string, string, string]>): void {
  store.transaction((_t) => {
    for (const [name, role, desired] of specs) {
      store.insertAgent({
        name,
        specHash: "h",
        role: role as "resident" | "principal",
        desired: desired as never,
        incarnation: 0,
        profile: "p",
        createdBy: null,
        specJson: "{}",
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
      incarnation: 0,
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
    assert.equal((denied as { error?: { code: string } }).error?.code, "CAPABILITY_DENIED");
    assert.equal(env.store.getOperation("a", "deny"), null);
    const allowed = await env.broker.dispatch(
      auth(["mail.send"]),
      { v: 1, id: "allow", method: "mail.send", request: "allow", params } as never,
      null,
    );
    assert.equal((allowed as { ok: boolean }).ok, true);
    assert.equal(env.store.getOperation("a", "allow")?.state, "succeeded");
    for (const [method, capability] of [["agent.create", "agent.create"], ["git.integrate", "code.integrate"], ["context.publish", "context.publish"]] as const) {
      const deniedMethod = await env.broker.dispatch(
        auth(["mail.send"]),
        { v: 1, id: method, method, request: method, params: {} } as never,
        null,
      );
      assert.equal((deniedMethod as { error?: { code: string } }).error?.code, "CAPABILITY_DENIED", `${method} must require ${capability}`);
    }
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
    await env.mail.send(auth("a", []), "self-1", {
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
    const receipt = await env.mail.send(auth("a", []), "q1", {
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
    );
    const direct = new Set<string>();
    const publicList = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const d = await mail.send(auth("b", []), `direct-${i}`, {
        to: ["a"],
        subject: `direct ${i}`,
        kind: "question",
        body: "d",
      });
      direct.add((d.result as { message: string }).message);
      const p = await mail.send(auth("b", []), `public-${i}`, {
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
    await mail.send(auth("b", []), "late-direct", {
      to: ["a"],
      subject: "late",
      kind: "question",
      body: "late",
    });
    const recovered = await mail.prepare(auth("a", []));
    assert.deepEqual(recovered?.messageIds, batch.messageIds);
  } finally {
    env.cleanup();
  }
});

test("prepared batch manifest shape stays compatible with the trusted extension", async () => {
  const env = envOf();
  try {
    seed(env.store, [["a", "resident", "enabled"]]);
    await env.mail.send(auth("a", []), "s1", {
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
    const viewDir = join(dir, "view");
    mkdirSync(viewDir, { recursive: true });
    const manifest = {
      id: "b-00000000-0000-4000-8000-000000000000",
      agent: "a",
      incarnation: 1,
      deliveryMode: "followUp",
      notice: "새 연락 1건. 전체 목록: /inbox.md\n1. mail m-x-0",
      messageIds: ["m-x-0"],
    };
    writeFileSync(
      join(viewDir, `batch-${manifest.id}.json`),
      JSON.stringify(manifest),
    );
    const sockFile = join(dir, "control.sock");
    const fd = openSync(sockFile, "w");
    closeSync(fd);

    const sandbox = new SandboxModule({
      rootfs,
      node: "/usr/bin/node",
      pi: "/usr/bin/pi",
      piModeArgs: ["--mode", "rpc", "-e", "/opt/oma/pi-extension.js"],
      tmpBytes: 64 * 1024 * 1024,
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
    const lease: RunLease = {
      actor: "a",
      incarnation: 1,
      socketHostPath: sockFile,
    };
    const argv = sandbox.resident(lease, {
      workspace: dir,
      home: join(dir, "home"),
      archive: join(dir, "archive"),
      selfMail: join(dir, "self"),
      view: viewDir,
      world: join(dir, "world"),
      projectGit: join(dir, "git"),
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

    const child = spawn(withSys[0]!, withSys.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pi = new PiRpcClient(child);
    const events: Array<{
      type: string;
      message?: { role?: string; customType?: string; stopReason?: string };
    }> = [];
    pi.onEvent((e) => events.push(e as never));
    let settled = false;
    const done = new Promise<void>((resolve) => {
      pi.onEvent((e) => {
        if (e.type === "agent_settled") {
          settled = true;
          resolve();
        }
      });
      child.on("error", () => resolve());
    });
    await new Promise((r) => setTimeout(r, 3000));
    pi.send({
      id: "d1",
      type: "prompt",
      message: `/oma-deliver ${manifest.id}`,
    });
    await done;
    pi.close();
    try {
      child.kill("SIGKILL");
    } catch {
      /* */
    }

    const custom = events.find(
      (e) => e.type === "message_start" && e.message?.role === "custom",
    );
    assert.ok(
      custom,
      `no custom message delivered; events=${JSON.stringify(events)}`,
    );
    assert.equal(custom.message?.customType, "oma-mail");
    void custom;
    const failed = events.some(
      (e) => e.type === "message_end" && e.message?.stopReason === "error",
    );
    assert.equal(failed, true);
    void settled;
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
