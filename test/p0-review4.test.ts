/** Priority 0, fourth review (implementation/priority-0-audit.md "4차 점검"):
 * the findings of the whole-codebase external review, each tested where its
 * decision takes effect, with the reading the fix removed as the control. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedAgentSpec } from "../implementation/contracts.js";
import { CLI_CREDENTIAL_FD_ENV } from "../src/cli/transport.js";
import { runCliProcess } from "../src/extension/cli-process.js";
import { replaceDerivedFile } from "../src/storage/durable-fs.js";
import { StatusRefresh } from "../src/views/status-refresh.js";
import { Broker } from "../src/broker.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { ViewsModule } from "../src/views.js";
import type { UnitsModule } from "../src/units.js";
import { AcceptedFailure, StoreError, normalizeStorageFailure, publicFailure } from "../src/domain/errors.js";
import { depthOf, planToolSurface, type GroupSpec } from "../src/domain/tool-surface.js";
import { PiRpcClient, type PiEvent } from "../src/runtime/pi-rpc.js";
import { validateConfig } from "../src/config.js";
import { defaultHostConfig } from "../src/config/defaults.js";
import { INITIAL_WORKERS, WORKER_INTEGRATE, WORKER_MODEL, WORKER_PROFILE, applyField, fieldsOf, settingsOf } from "../src/tui/sources/settings.js";
import type { AgentStatus } from "../implementation/contracts.js";
import { dashboardData } from "../src/tui/dashboard.js";
import { dashboardRows } from "../src/tui/view/dashboard.js";
import { NO_UNIT_REASON } from "../src/protocol/status-view.js";
import { HOST_CHANNEL_ENV } from "../src/protocol/host-channel.js";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

const CREDENTIAL = "c".repeat(64);
const HANDLE = "d".repeat(32);

/** Runs the real CLI transport in a child that holds `line` on descriptor 3,
 * as the trusted extension leaves it, and makes `calls` requests. Each result
 * is the failure's code and message; there is no broker at the path, so a
 * request that got past the credential fails only on connecting. */
function cliCalls(line: string, calls: number): Promise<string[]> {
  const script = `
    import { callActor } from ${JSON.stringify(join(process.cwd(), "dist/src/cli/transport.js"))};
    const results = [];
    for (let index = 0; index < ${calls}; index += 1) {
      try { await callActor("/nonexistent/socket", "status.get", {}); results.push("no error"); }
      catch (error) { results.push(String(error.code ?? "") + ":" + String(error.message)); }
    }
    process.stdout.write(JSON.stringify(results));
  `;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script],
      { env: { PATH: "/usr/bin:/bin", [CLI_CREDENTIAL_FD_ENV]: "3" }, stdio: ["ignore", "pipe", "inherit", "pipe"] });
    const socket = child.stdio[3] as unknown as { end(text: string): void; on(event: string, fn: () => void): void };
    socket.on("error", () => {});
    socket.end(line);
    let out = "";
    child.stdout!.on("data", chunk => { out += String(chunk); });
    child.once("close", () => { resolve(JSON.parse(out) as string[]); });
  });
}

test("P0V-25 / N01, P0-4: one CLI process reads its credential once, and every request it makes attaches with it", async () => {
  // A lookup and the resend it permits, or a query and the submission it
  // prepares: the second request must not find the descriptor already spent.
  const results = await cliCalls(`credential ${CREDENTIAL} ${HANDLE}\n`, 3);
  assert.equal(results.length, 3);
  for (const result of results) assert.match(result, /BROKER_UNAVAILABLE|ENOENT|connect/, `a later request was refused: ${JSON.stringify(results)}`);
  // A refused credential stays refused for the whole process, not "malformed"
  // on the first request and something else on the next.
  const refused = await cliCalls("ready\n", 2);
  for (const result of refused) assert.match(result, /AUTH_FAILED:.*malformed/, JSON.stringify(refused));
});

test("P0V-27 / N03, P0-4: a broker that could not be started is reported, and the host that tried keeps running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-spawn-failed-"));
  try {
    // Exists, but cannot be executed: spawn hands back a child with no pid and
    // reports EACCES afterwards, after the supervisor has already decided.
    const node = join(dir, "node"); writeFileSync(node, "not an executable\n"); chmodSync(node, 0o600);
    const script = `
      const { superviseBroker } = await import(${JSON.stringify(join(process.cwd(), "dist/src/runtime/broker-supervisor.js"))});
      const lines = [];
      const handle = await superviseBroker({ node: ${JSON.stringify(node)}, libdir: ${JSON.stringify(dir)}, society: "spawnfail",
        stateRoot: ${JSON.stringify(join(dir, "oma", "spawnfail"))}, runRoot: ${JSON.stringify(join(dir, "run", "oma", "spawnfail"))},
        configPath: ${JSON.stringify(join(dir, "config.json"))}, onEvent: line => lines.push(line) });
      await new Promise(resolve => setTimeout(resolve, 200));
      process.stdout.write(JSON.stringify({ state: handle.state, lines }));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    const code = await new Promise<number | null>(resolve => child.once("close", resolve));
    assert.equal(code, 0, `the host ended on the failed spawn: ${err}`);
    const result = JSON.parse(out) as { state: { kind: string; reason?: string }; lines: string[] };
    assert.deepEqual(result.state, { kind: "unavailable", reason: "the broker process did not start" });
    assert.ok(result.lines.some(line => /broker failed: .*EACCES/.test(line)), `the reason was not reported: ${JSON.stringify(result.lines)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("P0V-35 / N12, P0-2: a CLI's output is decoded as the bytes it wrote, wherever the pipe cut them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-cli-utf8-"));
  try {
    const text = "한글✅ 결과";
    const bytes = Buffer.from(text, "utf8");
    // Every cut inside the first character, on both streams, each written as
    // its own chunk with a pause so the pipe cannot join them again.
    for (const cut of [1, 2, 4, 5]) {
      const cli = join(dir, `split-${cut}.mjs`);
      writeFileSync(cli, `
        const bytes = Buffer.from(${JSON.stringify(text)}, "utf8");
        const pause = () => new Promise(resolve => setTimeout(resolve, 30));
        process.stdout.write(bytes.subarray(0, ${cut})); process.stderr.write(bytes.subarray(0, ${cut + 1 > bytes.length ? cut : cut + 1}));
        await pause();
        process.stdout.write(bytes.subarray(${cut})); process.stderr.write(bytes.subarray(${cut + 1 > bytes.length ? cut : cut + 1}));
      `);
      const result = await runCliProcess({ node: process.execPath, cli, args: [], cwd: dir,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, grant: null, timeoutMs: 10_000 });
      assert.equal(result.finished, true);
      assert.equal(result.stdout, text, `stdout cut at byte ${cut}`);
      assert.equal(result.stderr, text, `stderr cut at byte ${cut + 1}`);
      assert.equal(Buffer.byteLength(result.stdout), bytes.length);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("P0V-49 / F3, P0-4: a descriptor given back is never closed again when the sequence fails after it", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-close-once-"));
  let borrowed: number | null = null;
  try {
    assert.throws(() => replaceDerivedFile(join(dir, "derived"), "bytes", 0o600, fault => {
      if (fault.point !== "derived-rename" || fault.phase !== "before") return;
      // Something else in this process opens a file now and is handed the
      // number the temporary's descriptor just gave back; then the rename fails.
      borrowed = openSync(join(dir, "someone-else"), "w");
      throw new Error("rename failed");
    }), /rename failed/);
    assert.notEqual(borrowed, null);
    assert.doesNotThrow(() => fstatSync(borrowed!), "the failed replacement closed a descriptor it no longer owned");
  } finally {
    if (borrowed !== null) try { closeSync(borrowed); } catch { /* the control closed it */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P0V-52 / F6, P0-4: a broker keeps only the listener closes still in progress", async () => {
  const f = await preparedFixture(1);
  const units = { onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "" } as unknown as UnitsModule;
  const lifecycle = new LifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"), society: "demo",
    hasGoal: () => true, activationAllowed: () => true },
    (_parent: unknown, input: { name: string; from: string; brief: string }) => ({ ...input }) as unknown as ResolvedAgentSpec, f.mail);
  const broker = new Broker(f.store, f.mail, units, new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle, null, null,
    { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true });
  try {
    const listeners = Reflect.get(broker, "listeners") as Map<Server, Promise<void>>;
    const closeListener = Reflect.get(broker, "closeListener") as (server: Server) => void;
    // A run endpoint per revoked run over a long-lived broker's life.
    for (let index = 0; index < 20; index += 1) {
      const server = createServer();
      const ready = new Promise<void>(resolve => server.listen(join(f.root, `endpoint-${index}.sock`), resolve));
      listeners.set(server, ready);
      closeListener.call(broker, server);
    }
    const closes = Reflect.get(broker, "listenerCloses") as Set<Promise<void>> | Promise<void>[];
    await Promise.all([...closes]);
    await new Promise(resolve => setImmediate(resolve));
    const kept = closes instanceof Set ? closes.size : closes.length;
    assert.equal(kept, 0, `the broker kept ${kept} closes that had already finished`);
  } finally {
    await broker.drainAndClose();
    (f.store as unknown as { close(): void }).close = () => undefined;
    f.close();
  }
});

for (let gap = 0; gap < 8; gap += 1)
  test(`P0V-53 / F7, P0-2: one status observation at a time across the hand-over to its follow-up (microtask gap ${gap})`, async () => {
    const finishers: (() => void)[] = [];
    let active = 0; let most = 0;
    const observe = () => {
      active += 1; most = Math.max(most, active);
      return new Promise<ReadonlyMap<string, never>>(resolve => {
        let done = false;
        finishers.push(() => { if (done) return; done = true; active -= 1; resolve(new Map<string, never>()); });
      });
    };
    const refresh = new StatusRefresh(() => [], observe, 5000);
    const first = refresh.request();
    const second = refresh.request();
    finishers[0]!();
    for (let index = 0; index < gap; index += 1) await Promise.resolve();
    const third = refresh.request();
    for (let index = 0; index < 15; index += 1) await Promise.resolve();
    for (let at = 1; at < finishers.length; at += 1) {
      finishers[at]!();
      for (let index = 0; index < 15; index += 1) await Promise.resolve();
    }
    await Promise.all([first, second, third]);
    assert.equal(active, 0);
    assert.equal(most, 1, "a second observation ran beside the follow-up");
  });

test("P0V-33 / N09, P0-1: a failure restated beside a cleanup failure keeps its code, its facts and that it was accepted", () => {
  const actual = "a".repeat(40);
  const cleanup = new Error("owned temporary could not be removed");
  const accepted = new AcceptedFailure("STALE_BASE", "main moved", "none", { details: { actual } });
  for (const aggregate of [new AggregateError([accepted, cleanup]), new AggregateError([new AggregateError([accepted, cleanup]), cleanup])]) {
    const restated = normalizeStorageFailure(aggregate);
    assert.ok(restated instanceof AcceptedFailure, "the restated failure no longer says the operation was accepted");
    assert.equal(restated.effectKnowledge, "none");
    assert.deepEqual(restated.details, { actual });
    assert.equal(restated.cause, aggregate, "the cleanup failures are kept as the cause");
    assert.deepEqual(publicFailure(restated), publicFailure(accepted), "the caller is answered as if the cleanup had not failed");
  }
  const busy = new StoreError("BROKER_UNAVAILABLE", "busy", { details: { reason: "busy" } });
  assert.deepEqual(publicFailure(normalizeStorageFailure(new AggregateError([busy, cleanup]))), publicFailure(busy));
});

/** A chain of `levels` nested groups, the innermost holding one tool. */
function chain(levels: number): GroupSpec[] {
  return Array.from({ length: levels }, (_, index) => ({
    name: `g${index + 1}`, description: `level ${index + 1}`,
    members: index + 1 < levels ? [{ group: `g${index + 2}` }] : [{ tool: "read" }],
  }));
}
function orders<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => orders([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}

test("P0V-31 / N07, P0-2: how deep groups nest does not depend on the order they are declared in", () => {
  const plan = (groups: GroupSpec[]) => planToolSurface({ defaultMode: "DIRECT", direct: [], disabled: [], groups, roots: [] });
  const tooDeep = orders(chain(5));
  assert.equal(tooDeep.length, 120);
  for (const groups of tooDeep)
    assert.throws(() => plan(groups), /exceeds depth 4/, `accepted ${groups.map(group => group.name).join(",")}`);
  const deepest = orders(chain(4));
  for (const groups of deepest)
    assert.equal(depthOf(plan(groups)), 4, `measured ${groups.map(group => group.name).join(",")} wrong`);
  // A group shared by a shallow and a deep parent is measured from the deep one.
  const shared: GroupSpec[] = [
    { name: "shallow", description: "s", members: [{ group: "leaf" }] },
    { name: "leaf", description: "l", members: [{ tool: "read" }] },
    { name: "top", description: "t", members: [{ group: "middle" }] },
    { name: "middle", description: "m", members: [{ group: "shallow" }] },
  ];
  assert.equal(depthOf(plan(shared)), 4);
  assert.throws(() => plan([...shared, { name: "higher", description: "h", members: [{ group: "top" }] }]), /exceeds depth 4/);
});

test("P0V-48 / F2, P0-5: each partial line has its own deadline, so a line started late is not cut off by the one before it", { timeout: 10_000 }, async t => {
  // Line a starts at 0 and ends at 0.6 s in the same chunk that starts line b;
  // b ends at 1.3 s. With a 1 s line deadline both lines are in time.
  const child = spawn(process.execPath, ["-e", `
    const write = text => process.stdout.write(text);
    write('{"type":"a"');
    setTimeout(() => write('}\\n{"type":"b"'), 600);
    setTimeout(() => write('}\\n'), 1300);
    setInterval(() => {}, 1000);
  `], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new PiRpcClient(child, { frameBytes: 64 * 1024, idleStreamSeconds: 1, receiptWaitSeconds: 1 });
  t.after(() => { client.close(); child.kill("SIGKILL"); });
  const seen: string[] = [];
  client.onEvent((event: PiEvent) => { seen.push(event.type); });
  const ended = await Promise.race([client.completion, new Promise<"running">(resolve => setTimeout(() => resolve("running"), 1800))]);
  assert.equal(ended, "running", `the transport ended: ${JSON.stringify(ended)}`);
  assert.deepEqual(seen, ["a", "b"]);
});

test("P0V-51 / F5, P0-1: with no Worker profile of its own, a Worker edit is refused, never applied to the Principal", () => {
  const defaults = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma", rootfs: "/state/rootfs", deploymentDigest: "a".repeat(64) });
  const principal = defaults.agentProfiles[defaults.principalProfile]!;
  // A valid configuration with a Principal only.
  const config = validateConfig({ ...defaults, agentProfiles: { [defaults.principalProfile]: { ...principal, childProfile: null } }, initialResidents: [] });
  const settings = settingsOf("/nonexistent/config.json", config);
  assert.equal(settings.workerProfile, null, "the Principal's profile was taken for the Workers'");
  const fields = fieldsOf(config, settings.workerProfile);
  for (const id of [WORKER_MODEL, WORKER_INTEGRATE]) {
    const field = fields.find(entry => entry.id === id);
    assert.ok(field !== undefined && field.kind !== "link");
    assert.match(String(field.blocked), /Worker profile/, `${id} is offered`);
  }
  for (const [field, value] of [[WORKER_INTEGRATE, "on"], [WORKER_MODEL, defaults.agentProfiles[defaults.principalProfile]!.modelProfile], [INITIAL_WORKERS, 1]] as const)
    assert.throws(() => applyField(settings, field, value), /no worker profile/, `${field} changed something`);
  assert.throws(() => applyField({ ...settings, config: { ...config, initialResidents: [{ name: "w", profile: defaults.principalProfile, brief: "b" }] } },
    WORKER_PROFILE, defaults.principalProfile), /unknown agent profile/, "a Resident was offered the Principal's profile");
  // A profile the Principal names as its child is still the Workers' own.
  assert.equal(settingsOf("/nonexistent/config.json", defaults).workerProfile, principal.childProfile);
  assert.ok(applyField(settingsOf("/nonexistent/config.json", defaults), WORKER_INTEGRATE, "on").agentProfiles[principal.childProfile!]!.capabilities.includes("code.integrate"));
});

test("P0V-39 / N16, P0-5: a Resident whose unit was not observed leaves the Active count unknown, never 0", () => {
  const defaults = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma", rootfs: "/state/rootfs", deploymentDigest: "a".repeat(64) });
  const row = (agent: string, activeState: string | null, reason: string | null = null): AgentStatus => ({
    agent, desired: "enabled", activeState, subState: activeState === null ? null : "running", unitResult: activeState === null ? null : "success",
    execMainStatus: activeState === null ? null : 0, pending: 2, preparedBatches: 0, reason, runnerObservedAtMs: null });
  const shown = (statuses: AgentStatus[]) => {
    const data = dashboardData({ config: defaults, principalModel: { configured: "m", session: null }, unread: 0,
      observation: { kind: "observed", statuses, observedAtMs: Date.UTC(2026, 8, 26) } });
    return { data, active: dashboardRows(data).find(entry => entry.label === "Active")!.value };
  };
  // Observed: active, inactive, and a unit systemd says it does not have.
  const known = shown([row("principal", null), row("alice", "active"), row("bob", "inactive"), row("carol", null, NO_UNIT_REASON)]);
  assert.equal(known.data.status.kind === "observed" && known.data.status.active, 1);
  assert.equal(known.active, "1");
  // One Resident not observed: the count is unknown; what is known stays shown.
  for (const statuses of [[row("alice", "active"), row("bob", null)], [row("alice", null), row("bob", null)]]) {
    const unknown = shown(statuses);
    assert.equal(unknown.data.status.kind === "observed" && unknown.data.status.active, null);
    assert.match(unknown.active, /^unknown/, `shown as ${unknown.active}`);
    assert.equal(unknown.data.status.kind === "observed" && unknown.data.status.pending, 4, "known pending counts are kept");
  }
});

test("P0V-28 / N04, P0-5: a broker started as supervised whose channel cannot be established does not run on unsupervised", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-unsupervised-"));
  try {
    // Descriptor 3 declared as the host channel but a regular file: the host
    // cannot be identified, which is not the same as there being none.
    const channel = join(dir, "not-a-socket"); writeFileSync(channel, "");
    const fd = openSync(channel, "r");
    const child = spawn(process.execPath, [join(process.cwd(), "dist/src/entry/broker.js"), "--society", "unsupervised"], {
      env: { PATH: "/usr/bin:/bin", HOME: dir, XDG_DATA_HOME: join(dir, "data"), XDG_RUNTIME_DIR: join(dir, "run"), [HOST_CHANNEL_ENV]: "3" },
      stdio: ["ignore", "ignore", "pipe", fd],
    });
    closeSync(fd);
    let stderr = "";
    child.stderr!.on("data", chunk => { stderr += String(chunk); });
    const code = await new Promise<number | null>(resolve => child.once("close", resolve));
    assert.notEqual(code, 0);
    assert.match(stderr, /could not be established; this broker does not start/);
    // It stopped before configuration: nothing of the society was opened.
    assert.doesNotMatch(stderr, /startup failed|config/i, stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
