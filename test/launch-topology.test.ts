/** Actual broker entry, native Resident and restart recovery. Only model replies
 * use a scripted TLS provider; no manager, execution or authentication stand-in. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultHostConfig, DEFAULT_RESIDENT_PROFILE } from "@oma/config/defaults";
import { deploymentDigest } from "#oma-test/app/runtime/deployment-manifest";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { Store } from "@oma/storage";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { pinNamespaceInit, pinNamespaceRunner, type NamespaceInitPin, type NamespaceInitIdentity } from "@oma/native/pid-namespace";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ALL_CAPS } from "./fixtures/spec.js";
import { CONFINED_MODEL, scriptedProvider, type ScriptedProvider } from "./fixtures/scripted-provider.js";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(label: string, observe: () => T | undefined, diagnostics: () => string, timeout = 30_000): Promise<T> {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(20)) {
    const value = observe(); if (value !== undefined) return value;
  }
  assert.fail(`timed out waiting for ${label}: ${diagnostics()}`);
}
interface Running { child: ChildProcess; output(): string; exited: Promise<number | null> }
async function topology(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-topo-")), society = "demo";
  const stateRoot = join(root, "data 한", "oma", society), runRoot = join(root, "run 한", "oma", society);
  const configPath = join(root, "config 한", "custom $HOME %h.json"), seed = join(root, "seed");
  const brokers: Running[] = [], pins: NamespaceInitPin[] = [];
  let provider: ScriptedProvider | undefined;
  t.after(async () => {
    const errors: unknown[] = [];
    for (const broker of brokers) {
      try {
        if (broker.child.exitCode === null && broker.child.signalCode === null) broker.child.kill("SIGTERM");
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([broker.exited, new Promise<void>(resolve => { timeout = setTimeout(() => { broker.child.kill("SIGKILL"); resolve(); }, 10_000); })]);
        clearTimeout(timeout); await broker.exited;
      } catch (error) { errors.push(error); }
    }
    for (const pin of pins) {
      try {
        if (pin.population() === "populated") pin.terminate();
        await until("fixture scope death", () => pin.population() === "empty" ? true : undefined, () => root);
        pin.close();
      } catch (error) { errors.push(error); }
    }
    try { await provider?.close(); } catch (error) { errors.push(error); }
    try {
      if (existsSync(join(stateRoot, "execution/scopes.jsonl")) && ExecutionJournal.inspect(stateRoot).length)
        throw new Error(`unretired execution evidence retained at ${root}`);
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, `topology cleanup retained its evidence at ${root}`);
    spawnSync("chmod", ["-R", "u+rwX", root]); rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(seed);
  const git = (argv: string[]) => {
    const result = spawnSync("/usr/bin/git", argv, { cwd: seed, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init", "-q", "-b", "main"]); writeFileSync(join(seed, "README.md"), "native topology\n"); git(["add", "."]);
  git(["-c", "user.name=Topology", "-c", "user.email=topology@example.invalid", "commit", "-qm", "seed"]);
  provisionSociety(stateRoot, { projectDir: seed });
  // This test created the disposable tree and knows no earlier execution exists.
  ExecutionJournal.initialize(stateRoot);
  provider = await scriptedProvider(() => ({ kind: "hang" }), { tls: true });
  provider.configure(resolvePiRuntime({ stateRoot, libdir: process.cwd() }).agentDir);
  const config = defaultHostConfig({ society, node: process.execPath, libdir: process.cwd(),
     deploymentDigest: deploymentDigest(process.cwd()) });
  config.modelProfiles.scripted = { ...CONFINED_MODEL, inferenceTimeoutSeconds: 120 };
  config.agentProfiles[DEFAULT_RESIDENT_PROFILE]!.modelProfile = "scripted";
  config.initialResidents = [{ name: "child", profile: DEFAULT_RESIDENT_PROFILE, brief: "Keep this exact initial brief." }];
  mkdirSync(join(root, "config 한")); writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(join(stateRoot, "config.json"), JSON.stringify({ ...config, society: "wrong-society" }));
  const env: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: join(root, "wrong-data"), XDG_RUNTIME_DIR: join(root, "wrong-run"),
    XDG_CONFIG_HOME: join(root, "wrong-config"), ...(provider.caFile === null ? {} : { NODE_EXTRA_CA_CERTS: provider.caFile }) };
  delete env.OMA_HOST_CHANNEL; delete env.OMA_SOCIETY_FENCE_FD;
  const argv = [join(process.cwd(), "apps/oma/dist/entry/broker.js"), "--society", society, "--config", configPath,
    "--state-root", stateRoot, "--run-root", runRoot];

  async function start(): Promise<Running> {
    const child = spawn(process.execPath, argv, { env, stdio: ["ignore", "ignore", "pipe"] });
    let output = ""; child.stderr!.on("data", bytes => { output += String(bytes); });
    const broker = { child, output: () => output, exited: new Promise<number | null>(resolve => child.once("close", resolve)) };
    brokers.push(broker);
    await until("broker READY", () => /broker ready/.test(output) ? true : child.exitCode !== null || child.signalCode !== null ? assert.fail(output) : undefined, broker.output);
    return broker;
  }
  function scope(): { pin: NamespaceInitPin; execution: string; witness: NonNullable<ReturnType<typeof ExecutionJournal.inspect>[number]["witness"]> } | undefined {
    let entries;
    try { entries = ExecutionJournal.inspect(stateRoot); } catch { return undefined; } // a concurrent append is not a positive observation
    const entry = entries.find(entry => entry.slot === "resident:child"), witness = entry?.witness;
    if (!entry || !witness) return undefined;
    const pin = pinNamespaceInit(witness.pid); assert.deepEqual(pin.identity, witness); pins.push(pin); return { pin, witness, execution: entry.execution };
  }
  async function goal(): Promise<void> {
    const store = new Store(join(stateRoot, "runtime.sqlite"), undefined, { society });
    try {
      const mail = createMailModule({ stateRoot, society }, store, 64);
      const feature = createGitModule({ stateRoot, society, projectGit: join(stateRoot, "repos/project.git"), contextGit: join(stateRoot, "repos/context.git"), worldDir: join(stateRoot, "world") }, store, mail);
      const body = Buffer.from("# GOAL\nObserve native topology.\n");
      const receipt = await feature.publishContext({ actor: "principal", role: "principal", incarnation: store.getAgent("principal")!.incarnation,
        channel: "host", capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } }, "native-goal",
        { expected: null, entries: [{ path: "GOAL.md", bytes: body.length, sha256: sha256Hex(body) }], content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield body; })());
      assert.equal(receipt.state, "succeeded");
    } finally { store.close(); }
  }
  return { root, stateRoot, runRoot, configPath, env, argv, start, scope, goal, provider };
}

test("NATIVE-TOPO-01: actual broker entry uses its explicit roots without a user manager and drains", { timeout: 120_000 }, async t => {
  const f = await topology(t), broker = await f.start();
  assert.equal(existsSync(join(f.root, "wrong-data/oma/demo/runtime.sqlite")), false);
  assert.deepEqual(ExecutionJournal.inspect(f.stateRoot), []);
  const other = spawnSync(process.execPath, f.argv, { env: f.env, encoding: "utf8", timeout: 20_000 });
  assert.notEqual(other.status, 0); assert.match(other.stderr, /already owns this society/);
  broker.child.kill("SIGTERM"); assert.equal(await broker.exited, 0, broker.output());
  assert.deepEqual(ExecutionJournal.inspect(f.stateRoot), []);
});

test("NATIVE-TOPO-02: actual broker entry starts its runner and recovers a witnessed scope after SIGKILL", { timeout: 180_000 }, async t => {
  const f = await topology(t); let broker = await f.start();
  broker.child.kill("SIGTERM"); assert.equal(await broker.exited, 0, broker.output());
  await f.goal(); broker = await f.start();
  const owned = await until("witnessed Resident", f.scope, broker.output);
  await until("authenticated runner and provider request", () => f.provider.seen.length > 0 ? true : undefined, broker.output);
  const runner = pinNamespaceRunner(owned.witness as NamespaceInitIdentity);
  try {
    const actual = readFileSync(`/proc/${runner.pid}/cmdline`, "utf8").split("\0").slice(0, -1);
    assert.deepEqual(actual, [process.execPath, join(process.cwd(), "apps/oma/dist/entry/runner.js"), "--society", "demo", "--agent", "child",
      "--execution", owned.execution,
      "--config", f.configPath, "--state-root", f.stateRoot, "--run-root", f.runRoot]);
    assert.equal(runner.alive(), true);
  } finally { runner.close(); }
  broker.child.kill("SIGKILL"); await broker.exited;
  broker = await f.start();
  assert.equal(owned.pin.population(), "empty", "READY cannot precede independent old-scope death");
  broker.child.kill("SIGTERM"); assert.equal(await broker.exited, 0, broker.output());
  assert.deepEqual(ExecutionJournal.inspect(f.stateRoot), []);
});
