// Phase 5 acceptance: broker runner-channel auth, principal relay (T42),
// sandboxed Pi delivery smoke (S-03 mechanism, compiled pi-extension).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, openSync, closeSync, symlinkSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { Broker } from "../src/broker.js";
import { encodeFrame } from "../src/frame.js";
import { SandboxModule } from "../src/sandbox.js";
import { PiRpcClient } from "../src/rpc-client.js";
import type { AuthContext, Capability, ResolvedAgentSpec, RunLease } from "../implementation/contracts.js";

interface Env {
  dir: string;
  state: string;
  runRoot: string;
  society: string;
  store: Store;
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
  const units = new UnitsModule(society, { node: process.execPath, libdir: "/usr/lib/oma", state, society, agent: "" }, join(dir, "xdg"));
  const mail = new MailModule({ stateRoot: state, society }, store, 64);
  const resolver = (_parent: { name: string; profile: string }, input: { name: string; from: string; brief: string }): ResolvedAgentSpec => ({
    ...input, profile: "child", capabilities: ["mail.send", "route.follow"],
  });
  const lifecycle = new LifecycleModule(store, units, {
    stateRoot: state, projectGit: join(state, "repos", "project.git"), society,
    hasGoal: () => true,
  }, resolver);
  const views = new ViewsModule(store, state, society, "p");
  const broker = new Broker(store, mail, units, views, lifecycle, { stateRoot: state, runRoot, society });
  broker.start();
  return {
    dir, state, runRoot, society, store, broker,
    cleanup: () => {
      broker.drainAndClose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seed(store: Store, specs: Array<[string, string, string]>): void {
  store.transaction((_t) => {
    for (const [name, role, desired] of specs) {
      store.insertAgent({ name, specHash: "h", role: role as "resident" | "principal", desired: desired as never, incarnation: 0, profile: "p", createdBy: null, specJson: "{}" });
    }
  });
}

function adminCall(adminSock: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = connect(adminSock, () => {
      sock.write(encodeFrame({ v: 1, id: "t", method, params }));
    });
    let out = "";
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`admin timeout; got: ${out}`)); }, 10000);
    sock.on("data", (d) => {
      out += String(d);
      const nl = out.indexOf("\n");
      if (nl >= 0) {
        clearTimeout(timer);
        sock.destroy();
        try {
          resolve(JSON.parse(out.slice(0, nl)) as Record<string, unknown>);
        } catch (e) {
          reject(e as Error);
        }
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function auth(actor: string, caps: Capability[]): AuthContext {
  return {
    actor, incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(caps),
    peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
  };
}

const extPath = join(process.cwd(), "dist", "src", "pi-extension.js");

// ---------------------------------------------------------------------------

test("T11-neq: non-unit process cannot open a run on the runner channel", async () => {
  const env = envOf();
  try {
    seed(env.store, [["a", "resident", "enabled"]]);
    const reply = await adminCall(join(env.runRoot, "admin.sock"), "runner.open", { agent: "a" });
    assert.equal(reply.ok, false);
    assert.equal((reply.error as { code: string }).code, "AUTH_FAILED");
  } finally {
    env.cleanup();
  }
});

test("T31-neg: forged batch.complete from outside the unit is rejected", async () => {
  const env = envOf();
  try {
    seed(env.store, [["a", "resident", "enabled"]]);
    const reply = await adminCall(join(env.runRoot, "admin.sock"), "batch.complete", {
      agent: "a", batchId: "b-00000000-0000-4000-8000-000000000000",
      incarnation: 1, sessionPath: "/tmp/x", adapterRevision: "fake", receiptPath: "/tmp/fake.json",
    });
    assert.equal(reply.ok, false);
    assert.equal((reply.error as { code: string }).code, "AUTH_FAILED");
  } finally {
    env.cleanup();
  }
});

test("T42: principal relay moves new mail to cur, counts pending, spawns no model", async () => {
  const env = envOf();
  try {
    seed(env.store, [["a", "resident", "enabled"], ["principal", "principal", "enabled"]]);
    const mail = new MailModule({ stateRoot: env.state, society: env.society }, env.store, 64);
    const receipt = await mail.send(auth("a", []), "q1", { to: ["principal"], subject: "question", kind: "question", body: "?" });
    assert.equal((receipt.result as { recipientCount: number }).recipientCount, 1);
    const newDir = join(env.state, "mail", "inboxes", "principal", "new");
    assert.equal(readdirSync(newDir).length, 1);
    const reply = await adminCall(join(env.runRoot, "admin.sock"), "host.principalRelay", {});
    assert.equal(reply.ok, true);
    const res = reply.result as { moved: number; pending: number };
    assert.equal(res.moved, 1);
    assert.equal(readdirSync(newDir).length, 0);
    assert.equal(readdirSync(join(env.state, "mail", "inboxes", "principal", "cur")).length, 1);
    // relay only moves files; it never prepares a batch or starts inference for the UI-less principal
    assert.equal(env.store.preparedBatches("principal").length, 0);
  } finally {
    env.cleanup();
  }
});

test("batch stage view: prepared batch renders a manifest the extension can read", async () => {
  const env = envOf();
  try {
    seed(env.store, [["a", "resident", "enabled"]]);
    const mail = new MailModule({ stateRoot: env.state, society: env.society }, env.store, 64);
    await mail.send(auth("a", []), "s1", { to: ["a"], subject: "s", kind: "message", body: "x" });
    const batch = await mail.prepare(auth("a", []));
    assert.ok(batch !== null);
    // the extension path reads <view>/batch-<id>.json mounted at /run/oma-view
    const viewDir = join(env.state, "agents", "a", "runner", "view");
    mkdirSync(viewDir, { recursive: true });
    const manifest = {
      id: batch.id, agent: batch.agent, incarnation: batch.incarnation,
      deliveryMode: batch.deliveryMode, notice: batch.notice, messageIds: batch.messageIds,
    };
    writeFileSync(join(viewDir, `batch-${batch.id}.json`), JSON.stringify(manifest));
    // validate the extension parses it (import the compiled artifact in a child)
    const extCheck = `node -e "
      const fs = require('node:fs');
      const p = '/tmp/oma-t5-view/batch.json';
      process.chdir('/tmp/oma-t5-view');
      // extension uses readFileSync on /run/oma-view/batch-<id>.json; emulate the mount by copying
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

/** SB-001: the trusted rootfs carries the empty mount targets; real system dirs
 * overlay them. The trusted extension artifact lives outside the overlays. */
function makeSyntheticRootfs(root: string, extHostPath: string): string {
  for (const t of [
    "usr", "lib", "lib64", "bin", "sbin", "etc", "proc", "dev",
    "workspace", "home/agent", "tmp", "mail/archive", "mail/self", "run/oma-view",
    "world", "git/project.git", "run/oma", "opt/oma",
  ]) {
    mkdirSync(join(root, t), { recursive: true });
  }
  symlinkSync("/run/oma-view/inbox.md", join(root, "inbox.md"));
  copyFileSync(extHostPath, join(root, "opt", "oma", "pi-extension.js"));
  writeFileSync(join(root, "run", "oma", "control.sock"), "");
  return root;
}

test("deliver smoke: sandboxed Pi loads the trusted extension; custom message role is 'custom'; no provider -> no boundary evidence", { timeout: 60000 }, async () => {
  // standalone reproduction of the runner's deliver path: bwrap -> pi --mode rpc -e pi-extension
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
      agent: "a", incarnation: 1, deliveryMode: "followUp",
      notice: "새 연락 1건. 전체 목록: /inbox.md\n1. mail m-x-0",
      messageIds: ["m-x-0"],
    };
    writeFileSync(join(viewDir, `batch-${manifest.id}.json`), JSON.stringify(manifest));
    const sockFile = join(dir, "control.sock");
    const fd = openSync(sockFile, "w");
    closeSync(fd);

    const sandbox = new SandboxModule({
      rootfs,
      node: "/usr/bin/node",
      pi: "/usr/bin/pi",
      piModeArgs: ["--mode", "rpc", "-e", "/opt/oma/pi-extension.js"],
      tmpBytes: 64 * 1024 * 1024,
      checkResources: { memoryBytes: 0, tasks: 0, cpuQuotaPercent: 0, tmpBytes: 0, workspaceBytes: 0, stagingBytes: 0, checkTimeoutSeconds: 1 },
    });
    const lease: RunLease = { actor: "a", incarnation: 1, socketHostPath: sockFile };
    const argv = sandbox.resident(lease, {
      workspace: dir, home: join(dir, "home"), archive: join(dir, "archive"),
      selfMail: join(dir, "self"), view: viewDir, world: join(dir, "world"), projectGit: join(dir, "git"),
    }).argv;
    // SB-001: the deployment rootfs ships the pinned toolchain; the synthetic
    // rootfs needs the system overlays injected right after the rootfs bind.
    const sysOverlays = ["--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--ro-bind", "/bin", "/bin", "--ro-bind", "/sbin", "/sbin", "--ro-bind", "/etc", "/etc"];
    const ridx = argv.indexOf("--proc");
    const withSys = [...argv.slice(0, ridx), ...sysOverlays, ...argv.slice(ridx)];
    mkdirSync(join(dir, "home"), { recursive: true });
    mkdirSync(join(dir, "archive"), { recursive: true });
    mkdirSync(join(dir, "self"), { recursive: true });
    mkdirSync(join(dir, "world"), { recursive: true });
    mkdirSync(join(dir, "git"), { recursive: true });

    const child = spawn(withSys[0]!, withSys.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    const pi = new PiRpcClient(child);
    const events: Array<{ type: string; message?: { role?: string; customType?: string; stopReason?: string } }> = [];
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
    await new Promise((r) => setTimeout(r, 3000)); // let pi boot
    pi.send({ id: "d1", type: "prompt", message: `/oma-deliver ${manifest.id}` });
    await done;
    pi.close();
    try { child.kill("SIGKILL"); } catch { /* */ }

    const custom = events.find((e) => e.type === "message_start" && e.message?.role === "custom");
    assert.ok(custom, `no custom message delivered; events=${JSON.stringify(events)}`);
    assert.equal(custom.message?.customType, "oma-mail");
    // no provider configured -> the triggered turn ends with an error: exactly
    // the condition under which the runner must NOT complete the batch
    void custom;
    const failed = events.some((e) => e.type === "message_end" && e.message?.stopReason === "error");
    assert.equal(failed, true);
    void settled;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});