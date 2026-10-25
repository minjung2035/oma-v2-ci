import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
/** Priority 0, fourth review (docs/priority-0-audit.md "4차 점검"):
 * the findings of the whole-codebase external review, each tested where its
 * decision takes effect, with the reading the fix removed as the control. */
import test from "node:test";
import { residentOptions } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedAgentSpec } from "@oma/contracts";
import { runCliProcess } from "./fixtures/cli-child.js";
import { replaceDerivedFile } from "@oma/storage/durable-fs";
import { StatusRefresh } from "@oma/broker/status-refresh";
import { Broker } from "@oma/broker";
import { LifecycleModule } from "@oma/lifecycle";
import { ViewsModule } from "#oma-test/app/views";
import type { UnitsModule } from "@oma/platform-linux/units";
import { AcceptedFailure, StoreError, normalizeStorageFailure, publicFailure } from "@oma/domain/errors";
import { depthOf, planToolSurface, type GroupSpec } from "@oma/domain/tool-surface";
import { PiRpcClient, type PiEvent } from "@oma/engine/pi-rpc";
import { validateConfig } from "@oma/config";
import { defaultHostConfig } from "@oma/config/defaults";
import { INITIAL_WORKERS, WORKER_INTEGRATE, WORKER_MODEL, WORKER_PROFILE, applyField, fieldsOf, settingsOf } from "#oma-test/app/application/settings";
import type { AgentStatus } from "@oma/contracts";
import { dashboardData } from "@oma/tui/dashboard";
import { dashboardRows } from "@oma/tui/view/dashboard";
import { NO_UNIT_REASON } from "@oma/protocol/status-view";
import { HOST_CHANNEL_ENV } from "@oma/protocol/host-channel";
import { registerOmaTools } from "@oma/extension/mail-tools";
import { mkdirSync } from "node:fs";
import { storedMailBytes } from "@oma/domain/mail-values";
import { buildEml } from "@oma/mail/serialize";
import { principalEnvironment } from "@oma/engine/principal-session";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { agentRootPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "@oma/domain/paths";
import { INITIAL, step, type ConfigField, type MailRow, type PanelData, type State } from "@oma/tui/model";
import { render } from "@oma/tui/view/index";
import type { Key } from "@oma/tui/keys";
import { readMailbox, unreadCount } from "#oma-test/app/application/mail";
import { READ_BOUNDS } from "@oma/domain/surface-bounds";
import { utimesSync } from "node:fs";
import { unknownDashboard } from "./fixtures/dashboard.js";
import { KeyDecoder } from "@oma/tui/keys";
import { UnitsModule as Units } from "@oma/platform-linux/units";
import { readFileSync } from "node:fs";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

const CREDENTIAL = "c".repeat(64);
const HANDLE = "d".repeat(32);

/** Runs the real CLI transport in a child whose environment still declares
 * the removed credential descriptor, holding `line` on descriptor 3, and makes
 * `calls` requests. Each result is the failure's code and message; there is no
 * broker at the path, so a request fails only on connecting -- never on the
 * credential, because the CLI no longer reads one from anywhere. */
function cliCalls(line: string, calls: number): Promise<string[]> {
  const script = `
    import { callActor } from ${JSON.stringify(join(process.cwd(), "apps/oma/dist/cli/transport.js"))};
    const results = [];
    for (let index = 0; index < ${calls}; index += 1) {
      try { await callActor("/nonexistent/socket", "status.get", {}); results.push("no error"); }
      catch (error) { results.push(String(error.code ?? "") + ":" + String(error.message)); }
    }
    process.stdout.write(JSON.stringify(results));
  `;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script],
      { env: { PATH: "/usr/bin:/bin", OMA_PRINCIPAL_CREDENTIAL_FD: "3" }, stdio: ["ignore", "pipe", "inherit", "pipe"] });
    const socket = child.stdio[3] as unknown as { end(text: string): void; on(event: string, fn: () => void): void };
    socket.on("error", () => {});
    socket.end(line);
    let out = "";
    child.stdout!.on("data", chunk => { out += String(chunk); });
    child.once("close", () => { resolve(JSON.parse(out) as string[]); });
  });
}

test("P0V-25 / N01, P0-4: a credential descriptor named in the environment is not a CLI credential source", async () => {
  // E27 removed the extension-spawned CLI and with it the only producer of
  // this contract; the Principal's credential lives in the engine's
  // PrincipalChannel now. A leftover declaration -- even a well-formed line
  // waiting on the descriptor -- is inert: every call the process makes goes
  // unattached and fails only on connecting.
  const results = await cliCalls(`credential ${CREDENTIAL} ${HANDLE}\n`, 3);
  assert.equal(results.length, 3);
  for (const result of results) assert.match(result, /BROKER_UNAVAILABLE|ENOENT|connect/, `a request read the descriptor: ${JSON.stringify(results)}`);
  const refused = await cliCalls("ready\n", 2);
  for (const result of refused) assert.match(result, /BROKER_UNAVAILABLE|ENOENT|connect/, JSON.stringify(refused));
});

test("P0V-27 / N03, P0-4: a broker that could not be started is reported, and the host that tried keeps running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-spawn-failed-"));
  try {
    // Exists, but cannot be executed: spawn hands back a child with no pid and
    // reports EACCES afterwards, after the supervisor has already decided.
    const node = join(dir, "node"); writeFileSync(node, "not an executable\n"); chmodSync(node, 0o600);
    const script = `
      const { superviseBroker } = await import(${JSON.stringify(join(process.cwd(), "apps/oma/dist/runtime/broker-supervisor.js"))});
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
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, timeoutMs: 10_000 });
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
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"), society: "demo",
    hasGoal: () => true, activationAllowed: () => true },
    (_parent: unknown, input: { name: string; from: string; brief: string }) => ({ ...input }) as unknown as ResolvedAgentSpec, f.mail);
  const broker = testBroker({ store: f.store, mail: f.mail, units: units, views: new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true } });
  try {
    const listeners = Reflect.get(broker, "listeners") as import("@oma/broker/listeners").BrokerListeners;
    // A run endpoint per revoked run over a long-lived broker's life.
    for (let index = 0; index < 20; index += 1) {
      const server = createServer();
      listeners.listen(server, join(f.root, `endpoint-${index}.sock`));
      listeners.close(server);
    }
    await Promise.all(listeners.pendingCloses);
    await new Promise(resolve => setImmediate(resolve));
    const kept = listeners.pendingCloses.length;
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
    assert.match(String(field.blocked), /worker profile/i, `${id} is offered`);
  }
  for (const [field, value] of [[WORKER_INTEGRATE, "on"], [WORKER_MODEL, defaults.agentProfiles[defaults.principalProfile]!.modelProfile], [INITIAL_WORKERS, 1]] as const)
    assert.throws(() => applyField(settings, field, value), /no worker profile/, `${field} changed something`);
  assert.throws(() => applyField({ ...settings, config: { ...config, initialResidents: [{ name: "w", profile: defaults.principalProfile, brief: "b" }] } },
    WORKER_PROFILE, defaults.principalProfile), /unknown agent profile/, "a Resident was offered the Principal's profile");
  // DR27: host seeds select the Worker profile without giving the Principal creation authority.
  const worker = defaults.initialResidents[0]!.profile;
  assert.equal(settingsOf("/nonexistent/config.json", defaults).workerProfile, worker);
  assert.ok(applyField(settingsOf("/nonexistent/config.json", defaults), WORKER_INTEGRATE, "on").agentProfiles[worker]!.capabilities.includes("code.integrate"));
  // A legacy profile the Principal names as its child is still the Workers' own.
  const legacy = validateConfig({ ...defaults, initialResidents: [], agentProfiles: {
    ...defaults.agentProfiles, [defaults.principalProfile]: { ...principal, childProfile: worker },
  } });
  assert.equal(settingsOf("/nonexistent/config.json", legacy).workerProfile, worker);
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
    const child = spawn(process.execPath, [join(process.cwd(), "apps/oma/dist/entry/broker.js"), "--society", "unsupervised"], {
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

test("P0V-37 / N14, P0-2: a message path the Principal was shown reads back through the same mail tool", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-shown-path-"));
  const archive = join(root, "state", "mail", "archive", "cur");
  mkdirSync(archive, { recursive: true });
  const id = "m-00000000-0000-4000-8000-0000000000aa-0";
  writeFileSync(join(archive, `${id}:2,`), "Subject: shown\r\n\r\nthe body\r\n");
  const previous = { ...process.env };
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
  // The Principal's engine: its archive root is the host's own path (DR1).
  Object.assign(process.env, { OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive,
    OMA_SOCKET: "/nonexistent/socket", OMA_SOCIETY: "demo" });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root);
    const read = tools.get("oma_mail_read")!;
    for (const shown of [join(archive, `${id}:2,`), `/mail/archive/cur/${id}:2,`, `${id}:2,`, id])
      assert.match((await read.execute("t", { messageId: shown })).content[0]!.text, /the body/, `could not read back ${shown}`);
    // Only the root it was shown with: the same file name under another directory names nothing.
    await assert.rejects(read.execute("t", { messageId: join(root, `${id}:2,`) }), /message id or canonical archive path|expected a message id/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("P0V-36 / N13, P0-2: a message whose body is within the body limit is read back whole by the mail tool", async () => {
  const bodyBytes = 16 * 1024;
  // Both engines are told the bound of a stored message, not the body's.
  const principal = principalEnvironment({ stateRoot: "/srv/oma-n13", runRoot: "/run/oma-n13", libdir: "/opt/oma" },
    { society: "demo", provider: "pi", model: "current", extensions: [] }, { frameBytes: 256 * 1024, mailBodyBytes: bodyBytes, batchMaxMessages: 4, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 });
  assert.equal(Number(principal.OMA_MAIL_BYTES), storedMailBytes(bodyBytes));
  const state = "/srv/oma-n13";
  const options = residentOptions(state);
  const plan = planPiSpawn(residentEngineEffects.sandbox, { ...options, limits: { ...options.limits, mailBodyBytes: bodyBytes } });
  const told = plan.env.OMA_MAIL_BYTES ?? plan.args[plan.args.indexOf("OMA_MAIL_BYTES") + 1];
  assert.equal(Number(told), storedMailBytes(bodyBytes), "the Resident's engine was told the body limit");

  // The widest bodies the writer can be given: every byte a quoted-printable
  // escape, Korean and emoji text, and line breaks.
  const bodies: Record<string, string> = {
    equals: `a${"=".repeat(bodyBytes - 1)}`, korean: "가a".repeat(bodyBytes / 4), emoji: "😀abc".repeat(Math.floor(bodyBytes / 7)), lines: "a\n".repeat(bodyBytes / 2),
  };
  const root = mkdtempSync(join(tmpdir(), "oma-n13-"));
  const archive = join(root, "archive"); mkdirSync(archive);
  const previous = { ...process.env };
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
  Object.assign(process.env, { OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive,
    OMA_SOCKET: "/nonexistent/socket", OMA_SOCIETY: "demo", OMA_MAIL_BYTES: principal.OMA_MAIL_BYTES });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root);
    let index = 0;
    for (const [name, body] of Object.entries(bodies)) {
      assert.ok(Buffer.byteLength(body) <= bodyBytes, name);
      const id = `m-00000000-0000-4000-8000-0000000001${String(index++).padStart(2, "0")}-0`;
      const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [], subject: name, kind: "message",
        contextRevision: null, inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, body });
      assert.ok(eml.bytes <= storedMailBytes(bodyBytes), `${name}: ${eml.bytes} stored bytes exceed the bound`);
      writeFileSync(join(archive, `${id}:2,`), eml.text);
      const shown = (await tools.get("oma_mail_read")!.execute("t", { messageId: id })).content[0]!.text;
      // The writer ends the stored body with a line break of its own.
      const read = shown.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n/g, "\n");
      assert.ok(read === body || read === `${body}\n`, `${name} was not read back whole (${read.length} of ${body.length} characters)`);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

const mailRow = (id: string, subject: string): MailRow => ({ id, from: "worker-a", kind: "message", subject, unread: true, path: `/mail/${id}` });
const panel = (mail: MailRow[], config: ConfigField[] = []): PanelData => Object.freeze({
  dashboard: unknownDashboard(), config: Object.freeze(config), extensions: Object.freeze([]), mail: Object.freeze(mail), mailUnreadable: null, mailOmitted: 0,
});
function drive(data: PanelData, keys: Key["kind"][]): State {
  let state = step(INITIAL, { kind: "panel" } as Key, data, 262144).state;
  for (const kind of keys) state = step(state, { kind } as Key, data, 262144).state;
  return state;
}
const screen = (state: State, data: PanelData, rows: number, body: string | null = null, truncated = false) =>
  render({ state, data, transcript: [], body: body === null ? null : { text: body, truncated }, notice: null, busy: false, columns: 60, rows }).join("\n");

test("P0V-41 / N18, P0-1: the message a Human opened stays open when a refresh reorders the list or moves it to cur", () => {
  const before = panel([mailRow("m-a", "first"), mailRow("m-b", "second")]);
  const opened = drive(before, ["right", "right", "down", "enter"]);
  assert.match(screen(opened, before, 20), /Subject: second/);
  // A new message arrives at the top, and the opened one has moved to cur/.
  const after = panel([mailRow("m-new", "newest"), mailRow("m-a", "first"), mailRow("m-b:2,", "second")]);
  assert.match(screen(opened, after, 20), /Subject: second/, "the refresh opened a different message");
});

test("P0V-40 / N17: a list longer than the screen keeps its selection on screen, and a long body scrolls", () => {
  const rows = 12;
  const mail = Array.from({ length: 50 }, (_, index) => mailRow(`m-${index}`, `subject ${index}`));
  const list = panel(mail);
  const down = (count: number): Key["kind"][] => Array.from({ length: count }, () => "down");
  assert.match(screen(drive(list, ["right", "right", ...down(40)]), list, rows), /^>.*subject 40\s*$/m, "the selected message is off the screen");
  const config = Array.from({ length: 30 }, (_, index): ConfigField =>
    ({ kind: "number", id: `f${index}`, label: `field ${index}`, value: index, min: 0, max: 99, apply: "restart", blocked: null }));
  const fields = panel([], config);
  assert.match(screen(drive(fields, ["right", ...down(25)]), fields, rows), /^> field 25 /m, "the selected field is off the screen");
  // The open message's body: its later lines are reachable, and the foot stays.
  const body = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n");
  const opened = drive(list, ["right", "right", "enter", ...down(50)]);
  const shown = screen(opened, list, rows, body);
  assert.match(shown, /^line 51\s*$/m, "the body cannot be scrolled");
  assert.match(shown, /Esc Back/, "the foot was pushed off the screen");
  assert.equal(shown.split("\n").length, rows);
});

test("P0V-42 / N19, P0-5: a body read only in part is shown as partial, not as the whole message", () => {
  const list = panel([mailRow("m-a", "large")]);
  const opened = drive(list, ["right", "right", "enter"]);
  assert.match(screen(opened, list, 20, "beginning", true), /showing the beginning only/i);
  assert.doesNotMatch(screen(opened, list, 20, "whole", false), /showing the beginning only/i);
});

test("P0V-43 / N20: one refresh reads the headers of a bounded number of messages, the most recent, and counts the rest", { skip: process.getuid?.() === 0 }, () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mailbox-budget-"));
  try {
    const box = { newDir: join(root, "new"), curDir: join(root, "cur") };
    mkdirSync(box.newDir); mkdirSync(box.curDir);
    const budget = READ_BOUNDS.mailListRows.value;
    const total = budget + 50;
    for (let index = 0; index < total; index += 1) {
      const path = join(box.curDir, `m-${String(index).padStart(4, "0")}:2,`);
      writeFileSync(path, `Subject: message ${index}\n\nbody\n`);
      utimesSync(path, 1_700_000_000 + index, 1_700_000_000 + index);
      // The oldest ones cannot be read at all: a refresh that opened them would say so.
      if (index < 50) chmodSync(path, 0o000);
    }
    for (let index = 0; index < 3; index += 1) writeFileSync(join(box.newDir, `m-new-${index}`), "Subject: waiting\n\nbody\n");
    const read = readMailbox(box);
    assert.equal(read.rows.length, budget);
    assert.equal(read.omitted, total + 3 - budget);
    assert.equal(read.unreadable, null, "a message beyond the budget was opened");
    assert.deepEqual(read.rows.slice(0, 3).map(row => row.subject), ["waiting", "waiting", "waiting"], "waiting messages come first");
    assert.equal(read.rows[3]!.subject, `message ${total - 1}`, "the most recent settled message is not first after them");
    assert.equal(unreadCount(box), 3);
  } finally {
    for (const name of readdirSync(join(root, "cur"))) chmodSync(join(root, "cur", name), 0o600);
    rmSync(root, { recursive: true, force: true });
  }
});

test("P0V-46 / N23, P0-2: typed and pasted text are read by one rule -- a typed U+FFFD is kept, broken bytes are dropped", () => {
  const typed = (...reads: number[][]): string => {
    const decoder = new KeyDecoder(() => 0);
    const keys = [...reads.flatMap(read => decoder.push(Uint8Array.from(read))), ...decoder.finish()];
    return keys.map(key => (key.kind === "char" ? key.value : "")).join("");
  };
  const pasted = (bytes: number[]): string => {
    const decoder = new KeyDecoder(() => 0);
    const keys = decoder.push(Uint8Array.from([...Buffer.from("\u001b[200~"), ...bytes, ...Buffer.from("\u001b[201~")]));
    const paste = keys.find(key => key.kind === "paste");
    return paste !== undefined && paste.kind === "paste" ? paste.value : "";
  };
  const replacement = [...Buffer.from("\ufffd", "utf8")];
  const cases: [number[], string][] = [
    [[...Buffer.from("a"), ...replacement, ...Buffer.from("b")], "a\ufffdb"],   // a character a Human can type
    [[...Buffer.from("a"), 0xff, ...Buffer.from("b")], "ab"],                    // never UTF-8
    [[...Buffer.from("a"), 0xc3, 0x28], "a("],                                   // a lead with no continuation
    [[0xed, 0xa0, 0x80, ...Buffer.from("z")], "z"],                              // an encoded surrogate
    [[0xe0, 0x80, 0x80, ...Buffer.from("z")], "z"],                              // an overlong form
    [[...Buffer.from("한")], "한"],
  ];
  for (const [bytes, text] of cases) {
    assert.equal(typed(bytes), text, `typed ${JSON.stringify(bytes)}`);
    assert.equal(pasted(bytes), text, `pasted ${JSON.stringify(bytes)}`);
  }
  // A character split between two reads is one character, typed or pasted.
  const han = [...Buffer.from("한")];
  assert.equal(typed(han.slice(0, 1), han.slice(1)), "한");
  // One the terminal never finishes is dropped, not turned into U+FFFD.
  assert.equal(typed([...Buffer.from("x"), han[0]!]), "x");
});

test("P0V-26 / N02, P0-1: a unit name that is another society's or agent's is refused, never replaced", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-unit-owner-"));
  try {
    const units = new Units("a-b", { node: process.execPath, libdir: process.cwd(), state: join(dir, "a-b"), society: "a-b", agent: "",
      config: join(dir, "config.json"), run: join(dir, "run", "a-b") }, dir);
    const conflict = (error: unknown) => error instanceof StoreError && error.code === "AGENT_CONFLICT";
    // Society a's Resident b-c holds the name society a-b's Resident c would take.
    const theirs = "[Unit]\nDescription=OMA a resident b-c\n";
    writeFileSync(join(dir, "oma-a-b-c.service"), theirs);
    assert.throws(() => units.assertResidentNamesFree("c"), conflict, "a create would be accepted onto another society's unit");
    assert.throws(() => units.ensureResident("c", "p", "md"), conflict);
    assert.equal(readFileSync(join(dir, "oma-a-b-c.service"), "utf8"), theirs, "another society's unit was replaced");
    // The owner's own unit is its to replace, and a free name is free.
    writeFileSync(join(dir, "oma-a-b-d.service"), `[Unit]\nDescription=OMA a-b resident d\nX-OMA-Owner=${join(dir, "a-b")}\n`);
    assert.doesNotThrow(() => units.assertResidentNamesFree("d"));
    // P0V-95 (R6-20): one that names no owner and no tree is not known to be
    // its by the Description alone -- two trees' societies share names.
    writeFileSync(join(dir, "oma-a-b-f.service"), "[Unit]\nDescription=OMA a-b resident f\n");
    assert.throws(() => units.assertResidentNamesFree("f"), conflict);
    assert.doesNotThrow(() => units.assertResidentNamesFree("e"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
