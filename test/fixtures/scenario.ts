// A society and its Principal, composed the way `oma` composes them, with only
// the model scripted (./scripted-provider.ts).
//
// Real: provisioning, the Store, the mail module, the broker and its Principal
// and host endpoints, the bundled engine started by the product's
// PrincipalSession with the trusted core extension, the model-facing CLI that
// extension starts, the credential channel, and the product's PrincipalDelivery.
// Stand-ins: the host's side of the supervision channel (this process is the
// host, and registers its engine as `oma` does), and systemd (no unit is ever
// needed by what a Principal-only scenario does).
//
// Scenarios assert durable facts -- ledger rows, mailbox files, receipts, the
// session history -- not screen text.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ProtocolLimits, Request } from "../../implementation/contracts.js";
import { Broker, type PrincipalHostChannel } from "../../src/broker.js";
import { Store } from "../../src/store.js";
import { MailModule } from "../../src/mail.js";
import { UnitsModule } from "../../src/units.js";
import { ViewsModule } from "../../src/views.js";
import { LifecycleModule } from "../../src/lifecycle.js";
import { provisionSociety } from "../../src/runtime/provision.js";
import { processIdentity, type ProcessIdentity } from "../../src/broker/process-ancestry.js";
import { encodeHostMessage } from "../../src/protocol/host-channel.js";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir, principalWorkspace } from "../../src/tui/session.js";
import { PrincipalDelivery, principalHostBroker, type DeliveryOutcome } from "../../src/runtime/principal-delivery.js";
import { resolvePiRuntime } from "../../src/runtime/pi-runtime.js";
import type { PiEvent } from "../../src/runtime/pi-rpc.js";
import { makeValidAgent } from "./spec.js";
import { scriptedProvider, type Reply, type Script, type ScriptedProvider } from "./scripted-provider.js";

export const SCENARIO_LIMITS: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
  idleStreamSeconds: 30, receiptWaitSeconds: 30,
};
const SOCIETY = "demo";
const REPO = process.cwd();

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
  close(): Promise<void>;
}

export interface ScenarioOptions {
  readonly script?: Script | readonly Reply[];
  /** Residents registered in the society (rows only; they never run here). */
  readonly residents?: readonly string[];
  readonly acceptMs?: number;
  readonly retryAfterMs?: number;
}

/** A broker over the society's state. It owns the Store it is given: its
 * drain closes it, as the product's broker process does on its way out. */
function composeBroker(root: string, runRoot: string, store: Store, host: HostSide): Broker {
  const units = new UnitsModule(SOCIETY, { node: process.execPath, libdir: REPO, state: root, society: SOCIETY, agent: "",
    config: join(root, "config.json"), run: runRoot, brokerUnit: "" }, join(root, "units"));
  const mail = new MailModule({ stateRoot: root, society: SOCIETY }, store, 64, SCENARIO_LIMITS.batchMaxMessages, SCENARIO_LIMITS);
  const views = new ViewsModule(store, root, SOCIETY, "p");
  const lifecycle = new LifecycleModule(store, units,
    { stateRoot: root, projectGit: join(root, "project.git"), society: SOCIETY, hasGoal: () => true, activationAllowed: () => true },
    () => null, mail);
  return new Broker(store, mail, units, views, lifecycle, null, null,
    { stateRoot: root, runRoot, society: SOCIETY, hasGoal: () => true }, SCENARIO_LIMITS, undefined, host);
}

export async function startScenario(options: ScenarioOptions = {}): Promise<Scenario> {
  const root = mkdtempSync(join(tmpdir(), "oma-scenario-"));
  const runRoot = join(root, "run");
  provisionSociety(root);
  const provider = await scriptedProvider(options.script ?? []);
  let store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    for (const name of options.residents ?? []) tx.insertAgent(makeValidAgent(name));
  });
  const host = new HostSide();
  let broker = composeBroker(root, runRoot, store, host);
  await broker.start();

  const runtime = resolvePiRuntime({ stateRoot: root, libdir: REPO });
  provider.configure(runtime.agentDir);
  const lines: string[] = [];
  const events: PiEvent[] = [];
  const profile = { society: SOCIETY, provider: "fake", model: "scripted", extensions: [], workspaceBytes: 64 * 1024 * 1024 };
  const handle = newSessionHandle();
  const startSession = (): PrincipalSession => {
    const started = PrincipalSession.start(
      { piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: runtime.agentDir,
        coreExtension: join(REPO, "dist/src/pi-extension.js"), sessionDir: principalSessionDir(root),
        workspace: principalWorkspace(root), home: principalWorkspace(root) },
      profile, { frameBytes: SCENARIO_LIMITS.frameBytes, idleStreamSeconds: SCENARIO_LIMITS.idleStreamSeconds, receiptWaitSeconds: SCENARIO_LIMITS.receiptWaitSeconds },
      principalEnvironment({ stateRoot: root, runRoot, libdir: REPO }, profile, SCENARIO_LIMITS),
      { onLine: line => { lines.push(line); }, onBusy: () => {}, onEnd: reason => { lines.push(`[end] ${reason}`); },
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
    root, runRoot, provider, lines, events,
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
      const agent = store.getAgent(from);
      assert.ok(agent, `no resident ${from}`);
      const auth: AuthContext = { actor: from, incarnation: agent.incarnation, role: "resident", channel: "actor",
        capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
      const request = { v: 1, id: key, method: "mail.send", request: key,
        params: { to: input.to, subject: input.subject, kind: input.kind ?? "message", body: input.body, ...(input.replyTo === undefined ? {} : { replyToMessage: input.replyTo }) } };
      return await broker.dispatch(auth, request as unknown as Request, null) as Record<string, unknown>;
    },
    async stopBroker() {
      await broker.drainAndClose();
      host.reset();
    },
    async restartBroker() {
      await scenario.stopBroker();
      store = new Store(join(root, "runtime.sqlite"));
      broker = composeBroker(root, runRoot, store, host);
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
    async close() {
      try { session.close(); } catch { /* already ended */ }
      const pid = session.pid;
      if (pid !== null) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
      await broker.drainAndClose().catch(() => undefined);
      await provider.close();
      try { store.close(); } catch { /* the broker's drain closed it */ }
      rmSync(root, { recursive: true, force: true });
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
