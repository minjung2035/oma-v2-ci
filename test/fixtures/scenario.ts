// A society and its Principal, composed the way `oma` composes them, with only
// the model scripted (./scripted-provider.ts).
//
// Real: provisioning, the Store, the mail module, the broker and its Principal,
// host, runner and actor endpoints, the bundled engine started by the
// product's PrincipalSession with the trusted core extension, the model-facing
// CLI that extension starts, the credential channel, the product's
// PrincipalDelivery, and -- when a Resident is activated -- the product's own
// runner process (dist/src/entry/runner.js) with its adapter and engine.
// Stand-ins: the host's side of the supervision channel (this process is the
// host, and registers its engine as `oma` does), and systemd: `ScenarioUnits`
// answers what a unit manager would about the one Resident being run. A runner
// runs confined in the generated rootfs through bubblewrap and the relay.
// Missing bubblewrap is explicitly NOT_RUN. A runner shares this process's
// cgroup, which a run pins, so each Resident can be activated once per broker;
// `restartBroker` makes it activatable again.
//
// Scenarios assert durable facts -- ledger rows, mailbox files, receipts, the
// session history -- not screen text.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor, AuthContext, ProtocolLimits, Request, UnitObservation } from "../../implementation/contracts.js";
import { Broker, type PrincipalHostChannel } from "../../src/broker.js";
import { Store } from "../../src/store.js";
import { MailModule } from "../../src/mail.js";
import type { UnitsModule } from "../../src/units.js";
import { validateConfig } from "../../src/config.js";
import { defaultHostConfig } from "../../src/config/defaults.js";
import { canonicalResourceLimits } from "../../src/domain/resources.js";
import { GitModule } from "../../src/git.js";
import { CandidateChecks } from "../../src/runtime/candidate-checks.js";
import { QUARANTINE_RESOURCES } from "../../src/git/quarantine.js";
import { integrationPolicyFromConfig } from "../../src/git/integration-policy.js";
import { readCurrentHostPolicy } from "../../src/config.js";
import { createChildSpecResolver } from "../../src/config/policy.js";
import { residentProjectGit } from "../../src/sandbox.js";
import type { HostConfigV1, ResolvedAgentSpec } from "../../implementation/contracts.js";
import type { NewAgent } from "../../src/store.js";
import { resolvedSpecDigest } from "../../src/domain/spec-identity.js";
import { exportRefForRequestKey } from "../../src/domain/derived.js";
import { ViewsModule } from "../../src/views.js";
import { LifecycleModule } from "../../src/lifecycle.js";
import { provisionSociety, residentRootfsPath } from "../../src/runtime/provision.js";
import { processIdentity, type ProcessIdentity } from "../../src/broker/process-ancestry.js";
import { encodeHostMessage } from "../../src/protocol/host-channel.js";
import { PrincipalSession, principalSessionProfile, newSessionHandle, principalEnvironment, principalSessionDir, principalWorkspace } from "../../src/tui/session.js";
import { PrincipalDelivery, principalHostBroker, type DeliveryOutcome } from "../../src/runtime/principal-delivery.js";
import { resolvePiRuntime } from "../../src/runtime/pi-runtime.js";
import type { VerifiedExtension } from "../../src/runtime/extension-integrity.js";
import { tryHoldSociety } from "../../src/runtime/society-lease.js";
import type { PiEvent } from "../../src/runtime/pi-rpc.js";
import { agentRootPathAt, projectGitPathAt, runnerViewPathAt, workspacePathAt } from "../../src/storage/paths.js";
import { makeValidAgent } from "./spec.js";
import { CONFINED_MODEL, CONFINED_MODEL_2, scriptedProvider, type Reply, type Script, type ScriptedProvider } from "./scripted-provider.js";
import { RESIDENT_TEST_OPTIONS } from "./resident.js";

export const SCENARIO_LIMITS: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
  idleStreamSeconds: 30, receiptWaitSeconds: 30,
};
const SOCIETY = "demo";
const REPO = process.cwd();
const OWN_CGROUP = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n")[0]!.slice(3);

/** What a user manager would answer about units: the one Resident a scenario
 * is running is an active unit in this process's cgroup, with the invocation
 * id its runner was given; everything else is not running. */
class ScenarioUnits {
  running: { readonly agent: Actor; readonly invocationId: string } | null = null;
  onRevokeRun: ((agent: Actor) => void) | undefined = undefined;
  bindIncarnationReader(): void {}
  observe(agent: Actor): UnitObservation {
    return this.running?.agent === agent
      ? { activeState: "active", subState: "running", result: "success", execMainStatus: 0, cgroup: OWN_CGROUP, invocationId: this.running.invocationId }
      : { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, cgroup: "", invocationId: "" };
  }
  observeAsync(agent: Actor): Promise<UnitObservation> { return Promise.resolve(this.observe(agent)); }
  async observeStatus(agents: readonly Actor[]): Promise<ReadonlyMap<Actor, UnitObservation>> { return new Map(agents.map(agent => [agent, this.observe(agent)])); }
  unitCgroup(): string { return ""; }
  startLimitStatus(): string | null { return null; }
  start(): void {}
  stop(agent: Actor): UnitObservation { return this.observe(agent); }
  confirmDead(agent: Actor): boolean { return this.running?.agent !== agent; }
  ensureResident(): void {}
  ensurePrincipal(): void {}
  assertResidentNamesFree(): void {}
}

/** The host's side of the supervision channel, as `oma` holds it: grants and
 * refusals are recorded, and a session is registered through the listener the
 * broker installed, exactly as the real channel delivers one. */
class HostSide implements PrincipalHostChannel {
  readonly host: ProcessIdentity = processIdentity(process.pid)!;
  readonly grants: { credential: string; sessionHandle: string }[] = [];
  readonly refused: string[] = [];
  private listeners: ((sessionHandle: string, pid: number) => void)[] = [];
  ready = (): void => {};
  grant = (credential: string, sessionHandle: string): void => { this.grants.push({ credential, sessionHandle }); };
  refuse = (sessionHandle: string): void => { encodeHostMessage({ kind: "refused", sessionHandle }); this.refused.push(sessionHandle); };
  onSession = (listener: (sessionHandle: string, pid: number) => void): void => { this.listeners.push(listener); };
  close = (): void => {};
  /** A new broker is a new channel owner; the old broker's listener is gone. */
  reset(): void { this.listeners = []; }
  register(sessionHandle: string, pid: number): { credential: string; sessionHandle: string } | null {
    const before = this.grants.length;
    for (const listener of this.listeners) listener(sessionHandle, pid);
    return this.grants.length > before ? this.grants.at(-1)! : null;
  }
}

export interface Turn {
  /** Every event the engine emitted during the run. */
  readonly events: readonly PiEvent[];
  /** The lines the product's screen would show. */
  readonly lines: readonly string[];
}

export interface Scenario {
  readonly root: string;
  readonly runRoot: string;
  readonly provider: ScriptedProvider;
  readonly store: Store;
  readonly broker: Broker;
  readonly session: PrincipalSession;
  /** Everything the product's screen would have shown, in order. */
  readonly lines: string[];
  readonly events: PiEvent[];
  /** Scripts the requests still to come. */
  script(next: Script | readonly Reply[]): void;
  /** A Human prompt, as the Control Panel submits it; resolves when the run the
   * prompt started has settled. */
  prompt(text: string, timeoutMs?: number): Promise<Turn>;
  /** One delivery step, as `oma` runs it when the session is idle. */
  deliver(): Promise<DeliveryOutcome>;
  /** One delivery step started now, not awaited: for a scenario that acts
   * while the delivery's run is going. */
  tick(): Promise<DeliveryOutcome>;
  /** The ledger's operations, read directly from the database. */
  operations(actor?: string): { id: string; actor: string; kind: string; state: string; request_key: string }[];
  /** Waits until the engine is idle (no run going). */
  idle(timeoutMs?: number): Promise<void>;
  /** A Resident writing to the society, through the broker's own dispatch. */
  residentSends(from: string, input: { to: string[]; subject: string; body: string; kind?: string; replyTo?: string }, key: string): Promise<Record<string, unknown>>;
  /** Any public method as a Resident, through the broker's own dispatch with
   * the resident profile's capabilities (mail.send, git.submit, ...). A null
   * `key` sends a read-style envelope: no top-level request key. */
  residentCall(from: string, method: string, params: Record<string, unknown>, key: string | null,
      stream?: AsyncIterable<Uint8Array> | null): Promise<Record<string, unknown>>;
  /** The trusted candidate path for a Resident: commits `change` on a clone
   * of canonical main and publishes it with git.submit. Returns the pushed
   * candidate oid and the main it was built on. */
  residentPushes(from: string, key: string, change: (workspace: string) => void): Promise<{ candidate: string; base: string }>;
  /** Stops the broker and starts a new one over the same state, as the
   * supervisor restarts it; the engine is registered with the new one. */
  restartBroker(): Promise<void>;
  /** Stops the broker without starting another. */
  stopBroker(): Promise<void>;
  /** Kills the engine outright and starts a new session over the same history. */
  restartEngine(signal?: NodeJS.Signals): Promise<void>;
  /** The Maildir names in an actor's inbox. */
  inbox(actor: string, box?: "new" | "cur"): string[];
  /** The raw stored message a mail id names. */
  archived(messageId: string): string;
  /** The society's configuration file, as the Control Panel edits it. */
  readonly configPath: string;
  /** Runs a Resident once, as systemd starts its unit: the product's runner
   * opens a run, takes one prepared batch, delivers it into a fresh engine
   * (the scripted model answers) and completes it. Resolves when it exits. */
  activate(agent: string, timeoutMs?: number): Promise<{ readonly code: number | null; readonly stderr: string }>;
  close(): Promise<void>;
}

export interface ScenarioOptions {
  /** Actual Open TUI, invoked only by a process running in the PTY harness. */
  readonly interactive?: { readonly onUi: (event: PiEvent, session: PrincipalSession) => void };
  readonly extensions?: readonly VerifiedExtension[];
  readonly script?: Script | readonly Reply[];
  /** Residents registered in the society (rows only; they never run here). */
  readonly residents?: readonly string[];
  readonly acceptMs?: number;
  readonly retryAfterMs?: number;
  /** Residents run confined, as a deployment with a rootfs runs them: under
   * bubblewrap in the society's generated rootfs, with bash, reaching the
   * (then TLS) scripted provider only through the runner's relay. */
  readonly confined?: true;
  /** Withhold git.submit, as the Control Panel can (DR4): a Resident without
   * it cannot publish candidates or open a merge request. */
  readonly submit?: boolean;
  /** mail-v1 notice splitting: a small bound makes applied-change notices
   * multi-part; the default keeps them whole. */
  readonly reviewBodyBytes?: number;
  /** Extra environment for the engines -- how an internal OMA policy such as
   * OMA_TOOL_SURFACE (D23: no longer configuration) reaches the process the
   * way OMA's own plumbing would set it. For the Principal the channel is the
   * spawn plan's explicit field, never the inherited environment: the same
   * value in this record is also spread into the engine env so a sessionEnv
   * filter still proves ambient copies are dropped. */
  readonly engineEnv?: Readonly<Record<string, string>>;
}

/** A broker over the society's state, composed as entry/broker.ts composes
 * it (mail, views, lifecycle, Git with its quarantine and the host's current
 * integration policy). It owns the Store it is given: its drain closes it, as
 * the product's broker process does on its way out. */
function composeBroker(root: string, runRoot: string, store: Store, host: HostSide, stand: ScenarioUnits, config: HostConfigV1, configPath: string,
    reviewBodyBytes?: number): Broker {
  const units = stand as unknown as UnitsModule;
  const mail = new MailModule({ stateRoot: root, society: SOCIETY }, store, 64, SCENARIO_LIMITS.batchMaxMessages, SCENARIO_LIMITS);
  const views = new ViewsModule(store, root, SOCIETY, "p");
  const gitPaths = { stateRoot: root, projectGit: projectGitPathAt(root), contextGit: join(root, "repos", "context.git"),
    worldDir: join(root, "world"), society: SOCIETY, quarantineTmpBytes: config.limits.bundleBytes, quarantineResources: QUARANTINE_RESOURCES,
    checkRootfs: config.installation.rootfs, checkNode: config.installation.node, checkAssetsDir: config.installation.libdir,
  };
  const checks = new CandidateChecks(gitPaths);
  const git = new GitModule(gitPaths, store, mail, integrationPolicyFromConfig(config.integration),
    () => integrationPolicyFromConfig(readCurrentHostPolicy(configPath, SOCIETY).integration),
    (candidate, check) => checks.run(candidate, check),
    ...(reviewBodyBytes === undefined ? [] : [{ mailBodyBytes: reviewBodyBytes, subjectBytes: 512, bundleBytes: 256 * 1024 * 1024 }]));
  const resolveSpec = createChildSpecResolver(() => readCurrentHostPolicy(configPath, SOCIETY), () => store.inTransaction);
  const lifecycle = new LifecycleModule(store, units,
    { stateRoot: root, projectGit: projectGitPathAt(root), society: SOCIETY, hasGoal: () => true, activationAllowed: () => true,
      residentProjectGit: residentProjectGit() },
    resolveSpec, mail, config.quota);
  return new Broker(store, mail, units, views, lifecycle, git, null,
    { stateRoot: root, runRoot, society: SOCIETY, hasGoal: () => true }, SCENARIO_LIMITS, undefined, host);
}

export async function startScenario(options: ScenarioOptions = {}): Promise<Scenario> {
  // D03: a launched runner checks that its roots name this society under `oma`.
  const base = mkdtempSync(join(tmpdir(), "oma-scn-"));
  const root = join(base, "oma", SOCIETY);
  const runDirectory = join(base, "run"), physicalRunRoot = join(runDirectory, "oma", SOCIETY);
  mkdirSync(root, { recursive: true }); mkdirSync(physicalRunRoot, { recursive: true });
  // Linux Unix-socket names must fit sun_path; use a bounded test TMPDIR.
  // All bytes stay under base; parent /proc/fd links cannot cross bwrap's user namespace.
  const runRoot = physicalRunRoot;
  provisionSociety(root);
  // The society's configuration: the product's defaults with the scripted
  // model for Residents and the generated rootfs, so every runner is confined.
  const defaults = defaultHostConfig({ society: SOCIETY, node: process.execPath, libdir: REPO,
    rootfs: residentRootfsPath(root), deploymentDigest: "a".repeat(64) });
  const residentProfile = Object.keys(defaults.agentProfiles).find(name => name !== defaults.principalProfile)!;
  const config = validateConfig({ ...defaults,
    modelProfiles: { ...defaults.modelProfiles, scripted: { ...CONFINED_MODEL, inferenceTimeoutSeconds: 120 },
      "scripted-2": { ...CONFINED_MODEL_2, inferenceTimeoutSeconds: 120 } },
    agentProfiles: { ...defaults.agentProfiles, [residentProfile]: { ...defaults.agentProfiles[residentProfile]!, modelProfile: "scripted",
      capabilities: [...defaults.agentProfiles[residentProfile]!.capabilities
        .filter(capability => options.submit !== false || capability !== "git.submit")] } } });
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const residentResources = config.agentProfiles[residentProfile]!.resources;
  const units = new ScenarioUnits();
  const provider = await scriptedProvider(options.script ?? [], { tls: true });
  // The engines and the runner's relay trust the scripted provider's own
  // certificate; certificate checking stays on.
  const trust: Record<string, string> = provider.caFile === null ? {} : { NODE_EXTRA_CA_CERTS: provider.caFile };
  let store = new Store(join(root, "runtime.sqlite"));
  // Agents as the product records them: the configuration's profiles, their
  // capabilities, model and resources, based on the canonical main.
  const main = execFileSync("/usr/bin/git", ["--git-dir", projectGitPathAt(root), "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
  const agentRow = (name: string): NewAgent => {
    const profileName = name === "principal" ? config.principalProfile : residentProfile;
    const profile = config.agentProfiles[profileName]!;
    const spec: ResolvedAgentSpec = { name, from: main, brief: name === "principal" ? "Principal" : `${name}의 역할`, profile: profileName,
      capabilities: [...profile.capabilities], modelProfile: profile.modelProfile, resources: { ...profile.resources } };
    // Seeded Residents are the Principal's children, as bootstrap records them.
    return { ...makeValidAgent(name), specHash: resolvedSpecDigest(spec), profile: profileName, specJson: JSON.stringify(spec),
      createdBy: name === "principal" ? null : "principal" };
  };
  store.transaction(tx => {
    tx.insertAgent(agentRow("principal"));
    for (const name of options.residents ?? []) tx.insertAgent(agentRow(name));
  });
  const host = new HostSide();
  let broker = composeBroker(root, runRoot, store, host, units, config, configPath, options.reviewBodyBytes);
  await broker.start();

  const runtime = resolvePiRuntime({ stateRoot: root, libdir: REPO });
  provider.configure(runtime.agentDir);
  const lines: string[] = [];
  const events: PiEvent[] = [];
  const handle = newSessionHandle();
  const fence = options.interactive ? tryHoldSociety(root) : null;
  if (options.interactive) assert.ok(fence);
  const startSession = (): PrincipalSession => {
    const profile = { ...principalSessionProfile(configPath, SOCIETY), provider: "fake", model: "scripted", workspaceBytes: 64 * 1024 * 1024,
      ...(options.extensions === undefined ? {} : { extensions: options.extensions }) };
    const started = PrincipalSession.start(
      { piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: runtime.agentDir,
        ...(options.interactive && fence ? { interactiveEntry: join(REPO, "dist/src/entry/pi-interactive.js"), fence: fence.fence, project: REPO } : {}),
        coreExtension: join(REPO, "dist/src/pi-extension.js"), sessionDir: principalSessionDir(root),
        workspace: principalWorkspace(root), home: principalWorkspace(root),
        // The deliberate plan travels the plumbing field, not the inherited
        // env -- the runner's own hop, applied to the host engine.
        ...(options.engineEnv?.OMA_TOOL_SURFACE === undefined ? {} : { toolSurface: options.engineEnv.OMA_TOOL_SURFACE }) },
      profile, { frameBytes: SCENARIO_LIMITS.frameBytes, idleStreamSeconds: SCENARIO_LIMITS.idleStreamSeconds, receiptWaitSeconds: SCENARIO_LIMITS.receiptWaitSeconds },
      { ...principalEnvironment({ stateRoot: root, runRoot, libdir: REPO }, profile, SCENARIO_LIMITS), ...trust, ...options.engineEnv },
      { onLine: line => { lines.push(line); }, onBusy: () => {}, onEnd: reason => { lines.push(`[end] ${reason}`); },
        onUi: event => options.interactive?.onUi(event, started),
        onPromptFailed: (_text, reason) => { lines.push(`[prompt failed] ${reason}`); },
        onPromptUnconfirmed: (_text, reason) => { lines.push(`[prompt unconfirmed] ${reason}`); } },
    );
    started.onEvent(event => { events.push(event); });
    return started;
  };
  let session = startSession();
  const register = (): void => {
    const pid = session.pid;
    assert.ok(pid !== null, "the engine is not running");
    const grant = host.register(handle, pid);
    assert.ok(grant !== null, `the broker did not accept the host's engine: ${JSON.stringify(host.refused)}`);
    session.grant(grant.credential, grant.sessionHandle);
  };
  register();
  // Bound to the session it was made with, as `oma` binds it (`live`): a
  // delivery in flight when that engine dies must see that engine end.
  const makeDelivery = (): PrincipalDelivery => { const live = session; return new PrincipalDelivery({
    get running() { return live.running; },
    get busy() { return live.busy; },
    onEvent: listener => live.onEvent(listener),
    deliver: batchId => live.deliver(batchId),
  }, principalHostBroker(runRoot, SCENARIO_LIMITS), {
    stateRoot: root, frameBytes: SCENARIO_LIMITS.frameBytes,
    acceptMs: options.acceptMs ?? 20_000, retryAfterMs: options.retryAfterMs ?? 0,
  }); };
  let delivery = makeDelivery();

  const waitFor = (match: (event: PiEvent) => boolean, timeoutMs: number): Promise<void> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`the engine did not settle within ${timeoutMs} ms; last lines: ${JSON.stringify(lines.slice(-5))}`)); }, timeoutMs);
    const stop = session.onEvent(event => { if (match(event)) { clearTimeout(timer); stop(); resolve(); } });
  });
  const idle = async (timeoutMs = 30_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (session.busy) {
      if (Date.now() > deadline) throw new Error(`the session stayed busy; last lines: ${JSON.stringify(lines.slice(-5))}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };

  const scenario: Scenario = {
    root, runRoot, provider, lines, events, configPath,
    get store() { return store; },
    get broker() { return broker; },
    get session() { return session; },
    script: next => { provider.script(next); },
    async prompt(text, timeoutMs = 30_000) {
      await idle(timeoutMs);
      const from = events.length; const fromLines = lines.length;
      const settled = waitFor(event => event.type === "agent_settled", timeoutMs);
      const outcome = session.submit(text);
      assert.equal(outcome.kind, "accepted", `the session did not take the prompt: ${JSON.stringify(outcome)}`);
      await settled;
      await idle(timeoutMs);
      return { events: events.slice(from), lines: lines.slice(fromLines) };
    },
    async deliver() {
      await idle();
      const outcome = await delivery.tick();
      await idle();
      return outcome;
    },
    tick: () => delivery.tick(),
    operations(actor) {
      const db = new DatabaseSync(join(root, "runtime.sqlite"), { readOnly: true });
      try {
        const rows = db.prepare("SELECT id, actor, kind, state, request_key FROM operations ORDER BY created_at_ms, id").all() as
          { id: string; actor: string; kind: string; state: string; request_key: string }[];
        return actor === undefined ? rows : rows.filter(row => row.actor === actor);
      } finally { db.close(); }
    },
    idle,
    async residentSends(from, input, key) {
      return await scenario.residentCall(from, "mail.send", {
        to: input.to, subject: input.subject, kind: input.kind ?? "message", body: input.body,
        ...(input.replyTo === undefined ? {} : { replyToMessage: input.replyTo }) }, key);
    },
    async residentCall(from, method, params, key, stream = null) {
      const agent = store.getAgent(from);
      assert.ok(agent, `no resident ${from}`);
      const auth: AuthContext = { actor: from, incarnation: agent.incarnation, role: "resident", channel: "actor",
        capabilities: new Set(["mail.send", "route.follow", "git.submit", "agent.manage.self"]),
        peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
      const request = { v: 1, id: key ?? method, method, ...(key === null ? {} : { request: key }), params };
      return await broker.dispatch(auth, request as unknown as Request, stream) as Record<string, unknown>;
    },
    async residentPushes(from, key, change) {
      const workspace = join(root, "scratch", `push-${from}-${key}`);
      mkdirSync(join(root, "scratch"), { recursive: true });
      // A private clone of canonical main, as a Resident's workspace is.
      execFileSync("git", ["clone", "--no-local", "--single-branch", "--branch", "main", projectGitPathAt(root), workspace]);
      const work = (argv: string[]): string => execFileSync("git", argv, { cwd: workspace, encoding: "utf8" }).trim();
      work(["config", "user.email", `${from}@demo.oma.invalid`]);
      work(["config", "user.name", from]);
      const base = work(["rev-parse", "HEAD"]);
      change(workspace);
      work(["add", "-A"]);
      work(["commit", "-m", `${from} change ${key}`]);
      const candidate = work(["rev-parse", "HEAD"]);
      // The same publication oma submit runs: an export ref bundled off the
      // clone and handed to the broker as a git.submit stream.
      const exportRef = exportRefForRequestKey(key);
      work(["update-ref", exportRef, candidate]);
      const bundlePath = join(root, "scratch", `bundle-${from}-${key}`);
      work(["bundle", "create", bundlePath, exportRef]);
      const content = readFileSync(bundlePath);
      const digest = { bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
      const reply = await scenario.residentCall(from, "git.submit", {
        candidate, exportRef, prerequisites: [], to: [from],
        subject: `merge candidate ${candidate.slice(0, 12)}`,
        body: "Candidate for a merge request; review happens in the request thread.",
        paths: [], bundle: { ...digest, mediaType: "application/x-git-bundle" },
      }, `${key}.submit`, (async function* () { yield content; })());
      assert.equal(reply.ok, true, `git.submit refused: ${JSON.stringify(reply).slice(0, 400)}`);
      return { candidate, base };
    },
    async stopBroker() {
      await broker.drainAndClose();
      host.reset();
    },
    async restartBroker() {
      await scenario.stopBroker();
      store = new Store(join(root, "runtime.sqlite"));
      broker = composeBroker(root, runRoot, store, host, units, readCurrentHostPolicy(configPath, SOCIETY), configPath, options.reviewBodyBytes);
      await broker.start();
      register();
    },
    async restartEngine(signal = "SIGKILL") {
      const pid = session.pid;
      if (pid !== null) {
        const ended = new Promise<void>(resolve => { const timer = setInterval(() => { if (!session.running) { clearInterval(timer); resolve(); } }, 20); });
        process.kill(pid, signal);
        await ended;
      }
      session = startSession();
      register();
      delivery = makeDelivery();
    },
    inbox(actor, box = "new") {
      const directory = join(root, "mail", "inboxes", actor, box);
      return existsSync(directory) ? readdirSync(directory).sort() : [];
    },
    archived(messageId) {
      const name = readdirSync(join(root, "mail", "archive", "cur")).find(entry => entry.startsWith(messageId));
      assert.ok(name, `no archived message ${messageId}`);
      return readFileSync(join(root, "mail", "archive", "cur", name), "utf8");
    },
    async activate(agent, timeoutMs = 90_000) {
      assert.equal(RESIDENT_TEST_OPTIONS.skip, false, String(RESIDENT_TEST_OPTIONS.skip));
      assert.notEqual(readCurrentHostPolicy(configPath, SOCIETY).installation.rootfs, "/");
      // What provisioning a created Resident leaves: its home and its workspace.
      const home = join(agentRootPathAt(root, agent), "home");
      for (const path of [home, runnerViewPathAt(root, agent)]) mkdirSync(path, { recursive: true });
      // The workspace lifecycle creates (LIFE-002): a private clone of the
      // canonical repository whose origin is that repository as the Resident sees it.
      const workspace = workspacePathAt(root, agent);
      if (!existsSync(join(workspace, ".git"))) {
        const git = (args: string[], cwd?: string): void => { execFileSync("/usr/bin/git", args, { cwd, stdio: "ignore" }); };
        git(["clone", "--no-local", "--single-branch", "--branch", "main", projectGitPathAt(root), workspace]);
        git(["remote", "set-url", "origin", residentProjectGit()], workspace);
      }
      units.running = { agent, invocationId: randomBytes(16).toString("hex") };
      try {
        const child = spawn(process.execPath, [join(REPO, "dist/src/entry/runner.js"), "--society", SOCIETY, "--agent", agent,
          "--config", configPath, "--state-root", root, "--run-root", runRoot], {
          env: { ...trust, ...options.engineEnv, PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, INVOCATION_ID: units.running.invocationId,
            OMA_PROFILE_HEX: Buffer.from(residentProfile, "utf8").toString("hex"),
            OMA_RESOURCES_HEX: Buffer.from(canonicalResourceLimits(residentResources), "utf8").toString("hex") },
          stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr!.on("data", chunk => { stderr += String(chunk); });
        const code = await new Promise<number | null>((resolve) => {
          const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
          child.once("close", status => { clearTimeout(timer); resolve(status); });
        });
        return { code, stderr };
      } finally { units.running = null; }
    },
    async close() {
      try { session.close(); } catch { /* already ended */ }
      const pid = session.pid;
      if (options.interactive) await session.exited;
      else if (pid !== null) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
      fence?.release();
      await broker.drainAndClose().catch(() => undefined);
      await provider.close();
      try { store.close(); } catch { /* the broker's drain closed it */ }
      // Published context revisions are sealed read-only (CTX); open them to remove.
      execFileSync("chmod", ["-R", "u+rwX", base]);
      rmSync(base, { recursive: true, force: true });
    },
  };
  return scenario;
}

/** Runs `body` over a fresh scenario and always tears it down. */
export async function withScenario(options: ScenarioOptions, body: (scenario: Scenario) => Promise<void>): Promise<void> {
  const scenario = await startScenario(options);
  try { await body(scenario); }
  finally { await scenario.close(); }
}
