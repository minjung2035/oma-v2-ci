import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** T114 / TUI-004, AUTH-003, IPC-011, PR-001, PR-002: the Principal's path
 * into its society, run in the topology the product runs it in.
 *
 * The test process is the host. It starts a real broker in-process, and a
 * stand-in engine as its child that loads the real compiled trusted extension,
 * is given the real environment the product builds, and holds the host's real
 * private channel on descriptor 3. OMA's tools start the real CLI as the
 * engine's child. Only the model is replaced: the test ends the turns a model
 * would end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import type { AuthContext, ProtocolLimits, Request, ResolvedAgentSpec } from "@oma/contracts";
import { Broker, type PrincipalHostChannel } from "@oma/broker";
import { PrincipalEndpoint, PrincipalHostEndpoint, type PrincipalEndpointPorts, type PrincipalHostEndpointPorts } from "@oma/broker/principal-endpoint";
import { PeerAuthenticator } from "@oma/broker/peer-authenticator";
import { type BoundPeer } from "@oma/broker/ports";
import { RunRegistry } from "@oma/broker/run-registry";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { BrokerChannel } from "@oma/client/channel";
import { credentialMatches, isPrincipalCredential, sessionHandleMatches } from "@oma/protocol/principal-credential";
import { StoreError } from "@oma/domain/errors";
import { observeStoreFailure } from "@oma/domain/admission";
import { encodeHostMessage } from "@oma/protocol/host-channel";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir, principalWorkspace } from "@oma/engine/principal-session";
import { CONVERSATION_BOUNDS } from "@oma/domain/surface-bounds";
import { TurnAdmission } from "@oma/domain/turn-admission";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { processIdentity, type ProcessIdentity } from "@oma/broker/process-ancestry";
import { PrincipalDelivery, principalHostBroker, type DeliverySession } from "#oma-test/app/runtime/principal-delivery";
import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "@oma/protocol/delivery-boundary";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { sessionDirPathAt } from "@oma/domain/paths";
import { PiRpcClient, commandWasNotWritten, type PiEvent } from "@oma/engine/pi-rpc";
import { writeBoundarySession } from "./fixtures/delivery-receipt.js";

const LIMITS: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
  idleStreamSeconds: 30, receiptWaitSeconds: 30,
};

const PRINCIPAL_SPEC: ResolvedAgentSpec = {
  name: "principal", from: "a".repeat(40), brief: "Principal", profile: "p",
  capabilities: ["mail.send"], modelProfile: "m",
};

// Plain modules, run from the source tree: the build compiles TypeScript
// fixtures only, and these must run exactly as written.
const ENGINE = join(process.cwd(), "test/fixtures/principal-engine.mjs");
const PROBE = join(process.cwd(), "test/fixtures/cli-probe.mjs");

/** The broker's view of this process as its host. Everything the real
 * supervision channel would carry is recorded, and a session is registered
 * the way the real channel delivers one. */
class HostChannel implements PrincipalHostChannel {
  readonly host: ProcessIdentity;
  closed = false;
  readonly grants: { credential: string; sessionHandle: string }[] = [];
  refusals = 0;
  ready = (): void => {
    this.readyWith.push({ principal: existsSync(join(this.runRoot, "principal.sock")),
      host: existsSync(join(this.runRoot, "principal-host.sock")) });
  };
  readonly readyWith: { principal: boolean; host: boolean }[] = [];
  private readonly listeners: ((sessionHandle: string, pid: number) => void)[] = [];
  constructor(private readonly runRoot: string, host?: ProcessIdentity) {
    this.host = host ?? processIdentity(process.pid)!;
  }
  grant = (credential: string, sessionHandle: string): void => { this.grants.push({ credential, sessionHandle }); };
  readonly refused: string[] = [];
  /** The real channel encodes the refusal, so a handle its grammar cannot
   * carry throws rather than being sent. This stand-in fails the same way: a
   * refusal that cannot name its registration must not be silently accepted. */
  refuse = (sessionHandle: string): void => {
    encodeHostMessage({ kind: "refused", sessionHandle });
    this.refusals += 1; this.refused.push(sessionHandle);
  };
  onSession = (listener: (sessionHandle: string, pid: number) => void): void => { this.listeners.push(listener); };
  close = (): void => { this.closed = true; };
  register(sessionHandle: string, pid: number): { credential: string; sessionHandle: string } | null {
    const before = this.grants.length;
    for (const listener of this.listeners) listener(sessionHandle, pid);
    return this.grants.length > before ? this.grants.at(-1)! : null;
  }
}

interface Society {
  readonly broker: Broker;
  readonly store: Store;
  readonly root: string;
  readonly runRoot: string;
  readonly host: HostChannel | null;
}

async function startSociety(prefix: string, supervised = true, host?: HostChannel): Promise<Society> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runRoot = join(root, "run");
  // Provisioned exactly as the product provisions it before starting a broker.
  provisionSociety(root);
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(() =>
    store.insertAgent({
      name: "principal", specHash: resolvedSpecDigest(PRINCIPAL_SPEC), role: "principal",
      desired: "enabled", incarnation: 0, profile: "p", createdBy: null,
      specJson: JSON.stringify(PRINCIPAL_SPEC),
    }),
  );
  const units = new PolicyExecution();
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, LIMITS.batchMaxMessages, LIMITS);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units,
    { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    () => null, mail);
  const channel = supervised ? host ?? new HostChannel(runRoot) : null;
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot, society: "demo", hasGoal: () => true }, limits: LIMITS, principalHost: channel ?? undefined });
  await broker.start();
  return { broker, store, root, runRoot, host: channel };
}

async function stopSociety(society: Society): Promise<void> {
  await society.broker.drainAndClose();
  rmSync(society.root, { recursive: true, force: true });
}

/** A running stand-in engine: the real extension in a child of this process. */
class Engine {
  readonly events: Record<string, unknown>[] = [];
  private readonly listeners = new Set<(event: Record<string, unknown>) => void>();
  private sequence = 0;
  private turning = false;
  private exited = false;
  private constructor(readonly child: ChildProcess) {
    let buffered = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffered += chunk;
      for (;;) {
        const end = buffered.indexOf("\n");
        if (end < 0) break;
        const event = JSON.parse(buffered.slice(0, end)) as Record<string, unknown>;
        buffered = buffered.slice(end + 1);
        if (event.type === "turn_start") this.turning = true;
        if (event.type === "agent_settled") this.turning = false;
        this.events.push(event);
        for (const listener of [...this.listeners]) listener(event);
      }
    });
    child.once("exit", () => { this.exited = true; });
  }

  static async start(society: Society, overrides: Record<string, string> = {}): Promise<Engine> {
    const sessionFile = join(principalSessionDir(society.root), "session.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ type: "session" })}\n`);
    const env = {
      ...principalEnvironment({ stateRoot: society.root, runRoot: society.runRoot, libdir: process.cwd() },
        { society: "demo", provider: "pi", model: "current", extensions: [] }, LIMITS),
      OMA_TEST_EXTENSION: pathToFileURL(join(process.cwd(), "packages/extension/dist/index.js")).href,
      OMA_TEST_SESSION_FILE: sessionFile,
      ...overrides,
    };
    // Exactly the private socket the product opens for its engine.
    const child = spawn(process.execPath, [ENGINE], {
      cwd: principalWorkspace(society.root), env, stdio: ["pipe", "pipe", "inherit", "pipe"],
    });
    // The product's own session ignores errors on this socket the same way: the
    // engine closing its end with a line unread resets it, which is not a fault.
    (child.stdio[3] as unknown as Socket).on("error", () => {});
    const engine = new Engine(child);
    await engine.next(event => event.type === "loaded");
    return engine;
  }

  /** Resolves once no turn is running -- at once if none is. */
  idle(): Promise<void> {
    if (!this.turning) return Promise.resolve();
    return this.next(event => event.type === "agent_settled").then(() => undefined);
  }

  get pid(): number { return this.child.pid!; }
  get running(): boolean { return !this.exited; }
  get busy(): boolean { return this.turning; }

  grant(credential: string, sessionHandle: string): void {
    (this.child.stdio[3] as unknown as Socket).write(encodeHostMessage({ kind: "credential", credential, sessionHandle }));
  }

  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  next(match: (event: Record<string, unknown>) => boolean, timeoutMs = 20000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new Error("the engine did not answer in time")); }, timeoutMs);
      const stop = this.onEvent(event => { if (match(event)) { clearTimeout(timer); stop(); resolve(event); } });
    });
  }

  send(request: Record<string, unknown>): void { this.child.stdin!.write(`${JSON.stringify(request)}\n`); }

  async tool(name: string, params: Record<string, unknown> = {}): Promise<{ ok: boolean; text?: string; error?: string }> {
    const id = `t${++this.sequence}`;
    const answer = this.next(event => event.type === "tool" && event.id === id);
    this.send({ op: "tool", id, name, params });
    return await answer as { ok: boolean; text?: string; error?: string };
  }

  stop(): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise(resolve => { this.child.once("exit", () => resolve()); this.child.kill("SIGTERM"); });
  }
}

function channel(): BrokerChannel {
  return new BrokerChannel({ frameBytes: LIMITS.frameBytes, idleStreamSeconds: 5, receiptWaitSeconds: 5 });
}

/** The refusal code as the caller sees it: the broker answers a refused
 * request with a code alone, so every way of failing to be the Principal looks
 * the same from outside. */
async function failureOf(call: Promise<unknown>): Promise<string> {
  try {
    const reply = await call;
    if (reply !== null && typeof reply === "object" && (reply as { ok?: unknown }).ok === false)
      return (reply as { error: { code: string } }).error.code;
    return "no failure";
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}

async function withEngine(prefix: string, run: (society: Society, engine: Engine, grant: { credential: string; sessionHandle: string }) => Promise<void>, overrides: Record<string, string> = {}): Promise<void> {
  const society = await startSociety(prefix);
  const engine = await Engine.start(society, overrides);
  try {
    const grant = society.host!.register(newSessionHandle(), engine.pid);
    assert.ok(grant, "the broker did not accept the host's own engine");
    engine.grant(grant.credential, grant.sessionHandle);
    await run(society, engine, grant);
  } finally {
    await engine.stop();
    await stopSociety(society);
  }
}

test("T114: a broker no host started opens no Principal endpoint at all", async () => {
  const society = await startSociety("oma-principal-unsupervised-", false);
  try {
    assert.equal(existsSync(join(society.runRoot, "principal.sock")), false);
    assert.equal(existsSync(join(society.runRoot, "principal-host.sock")), false);
  } finally { await stopSociety(society); }
});

test("T114: the host is told the broker is ready only once both endpoints are listening", async () => {
  const society = await startSociety("oma-principal-ready-");
  try {
    assert.deepEqual(society.host!.readyWith, [{ principal: true, host: true }]);
  } finally { await stopSociety(society); }
});

test("T114: the broker accepts only the host's own child as the Principal's engine", async () => {
  const society = await startSociety("oma-principal-register-");
  try {
    // The test runner is this process's parent, not its child: naming it must
    // not make it the Principal.
    const first = newSessionHandle();
    assert.equal(society.host!.register(first, process.ppid), null);
    assert.equal(society.host!.refusals, 1);
    // The refusal names the registration it answers. A refusal that named
    // nothing would settle whichever registration happened to be waiting.
    assert.deepEqual(society.host!.refused, [first]);
    // Nor this process itself.
    const second = newSessionHandle();
    assert.equal(society.host!.register(second, process.pid), null);
    assert.equal(society.host!.refusals, 2);
    assert.deepEqual(society.host!.refused, [first, second]);
    // A malformed handle is refused before anything is minted. It cannot be
    // named back either, so the endpoint observes that rather than sending a
    // refusal for a handle the channel's grammar cannot carry -- and stays
    // usable afterwards.
    assert.equal(society.host!.register("nothex", process.pid), null);
    assert.equal(society.host!.grants.length, 0);
    assert.deepEqual(society.host!.refused, [first, second]);
    assert.equal(society.host!.register(newSessionHandle(), process.ppid), null);
    assert.equal(society.host!.refusals, 3);
  } finally { await stopSociety(society); }
});

test("T114: the credential is in no file and no environment -- read from outside, as an attacker would", async () => {
  await withEngine("oma-principal-secret-", async (society, engine, grant) => {
    assert.ok(isPrincipalCredential(grant.credential));
    // The engine's environment, read the way any process of this user can read
    // it: through /proc, from another process.
    const environ = readFileSync(`/proc/${engine.pid}/environ`, "latin1");
    assert.ok(!environ.includes(grant.credential), "the credential is in the engine's environment");
    assert.ok(!environ.includes(grant.sessionHandle), "the session handle is in the engine's environment");
    // And no file the broker or the product wrote holds it.
    const scan = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        // Links are not followed: the generated rootfs links into the host.
        const kind = lstatSync(path);
        if (kind.isDirectory()) { scan(path); continue; }
        if (!kind.isFile() || kind.size > 4 * 1024 * 1024) continue;
        const text = readFileSync(path, "latin1");
        assert.ok(!text.includes(grant.credential), `${path} contains the credential`);
      }
    };
    scan(society.root);
    // The descriptor it travelled on is a socket, which /proc cannot reopen: an
    // inherited pipe there could be opened and read by another process.
    assert.throws(() => readFileSync(`/proc/${engine.pid}/fd/3`), /ENXIO/);
  });
});

test("T114: the endpoint refuses every request until the session attaches", async () => {
  await withEngine("oma-principal-unattached-", async society => {
    const client = channel();
    try {
      await client.connect(join(society.runRoot, "principal.sock"));
      assert.equal(await failureOf(client.call("status.get", {})), "AUTH_FAILED");
      // A refused connection is finished; asking again is not a way in.
      assert.notEqual(await failureOf(client.call("status.get", {})), "no failure");
    } finally { client.close(); }
  });
});

test("T114: the audit's attack -- the right credential and handle from a process the engine did not start", async () => {
  await withEngine("oma-principal-stolen-", async (society, _engine, grant) => {
    // This process holds both halves of the secret, exactly as a process that
    // read them somewhere would. It is not a descendant of the engine, so it
    // is still not the Principal.
    const thief = channel();
    try {
      await thief.connect(join(society.runRoot, "principal.sock"));
      assert.equal(await failureOf(thief.call("principal.attach", {
        sessionHandle: grant.sessionHandle, credential: grant.credential,
      })), "AUTH_FAILED");
    } finally { thief.close(); }
  });
});

test("T114: another session's handle is a conflict, not a failed authentication", async () => {
  await withEngine("oma-principal-conflict-", async (society, _engine, grant) => {
    const other = channel();
    try {
      await other.connect(join(society.runRoot, "principal.sock"));
      assert.equal(await failureOf(other.call("principal.attach", {
        sessionHandle: newSessionHandle(), credential: grant.credential,
      })), "ATTACH_CONFLICT");
    } finally { other.close(); }
  });
});

test("T114: Principal mail tools work through the real CLI without orchestration tools", async () => {
  await withEngine("oma-principal-tools-", async (society, engine) => {
    for (const name of ["oma_status", "oma_logs", "oma_mail_ack", "oma_agent_create", "oma_context_publish"]) {
      const refused = await engine.tool(name);
      assert.equal(refused.ok, false);
      assert.equal(refused.error, `no tool ${name}`);
    }

    const sent = await engine.tool("oma_mail_send", { to: ["principal"], subject: "to myself", body: "evidence", kind: "message" });
    assert.ok(sent.ok, `oma_mail_send failed: ${sent.error}`);

    const names = readdirSync(join(society.root, "mail", "archive", "cur"));
    assert.equal(names.length, 1);
    const messageId = names[0]!.replace(/:2,$/, "");
    const read = await engine.tool("oma_mail_read", { messageId });
    assert.ok(read.ok, `oma_mail_read failed: ${read.error}`);
    assert.match(read.text!, /evidence/);
    const byPath = await engine.tool("oma_mail_read", { messageId: `/mail/archive/cur/${messageId}:2,` });
    assert.equal(byPath.text, read.text);
  });
});

test("T114/E27: the engine attaches in-process; credentials never enter its environment or a CLI child", async () => {
  await withEngine("oma-principal-probe-", async (society, engine, grant) => {
    const answer = await engine.tool("oma_mail_send", { to: ["principal"], subject: "credential probe", body: "local fixture", kind: "message" });
    assert.ok(answer.ok, `in-process attach did not work: ${answer.error}`);
    assert.equal(JSON.parse(answer.text!).state, "succeeded", "the CLI probe was run instead of the real client");
    assert.equal(readdirSync(join(society.root, "mail/archive/cur")).length, 1);
    const reading = engine.next(event => event.type === "environ" && event.id === "grant-env");
    engine.send({ op: "environ", id: "grant-env" });
    const environ = String((await reading).text);
    assert.ok(!environ.includes(grant.credential));
    assert.ok(!environ.includes(grant.sessionHandle));
    assert.doesNotMatch(environ, /OMA_PRINCIPAL_CREDENTIAL_FD/);
  }, { OMA_CLI_PATH: PROBE });
});

test("T114/E27: a detached engine cannot invent a Principal grant from the environment", async () => {
  await withEngine("oma-principal-resident-", async (_society, engine) => {
    const answer = await engine.tool("oma_status");
    assert.equal(answer.ok, false);
    assert.match(answer.error!, /AUTH_FAILED/);
  }, { OMA_CLI_PATH: PROBE, OMA_HOST_CHANNEL: "" });
});

test("T114: a re-registered engine gets a new credential and the old one stops working", async () => {
  await withEngine("oma-principal-rotate-", async (society, engine, first) => {
    const second = society.host!.register(first.sessionHandle, engine.pid)!;
    assert.notEqual(second.credential, first.credential);
    engine.grant(second.credential, second.sessionHandle);
    // The engine picks up the replacement without restarting.
    const status = await engine.tool("oma_mail_send", { to: ["principal"], subject: "credential probe", body: "local fixture", kind: "message" });
    assert.ok(status.ok, `the engine did not take the new credential: ${status.error}`);
    // The old one is refused, even though it was valid a moment ago.
    const stale = channel();
    try {
      await stale.connect(join(society.runRoot, "principal.sock"));
      assert.equal(await failureOf(stale.call("principal.attach", {
        sessionHandle: first.sessionHandle, credential: first.credential,
      })), "AUTH_FAILED");
    } finally { stale.close(); }
  });
});

test("T114: a credential from an earlier broker authorises nothing in a later one", async () => {
  let stale: { credential: string; sessionHandle: string } | null = null;
  await withEngine("oma-principal-restart-a-", async (_society, _engine, grant) => { stale = grant; });
  await withEngine("oma-principal-restart-b-", async (society, engine, grant) => {
    assert.notEqual(grant.credential, stale!.credential);
    // The engine is given the old broker's credential: nothing works.
    engine.grant(stale!.credential, stale!.sessionHandle);
    const status = await engine.tool("oma_mail_send", { to: ["principal"], subject: "credential probe", body: "local fixture", kind: "message" });
    assert.equal(status.ok, false, "a credential from a stopped broker was accepted");
    // Given this broker's, it works again.
    engine.grant(grant.credential, grant.sessionHandle);
    assert.ok((await engine.tool("oma_mail_send", { to: ["principal"], subject: "credential probe", body: "local fixture", kind: "message" })).ok);
    void society;
  });
});

/** Whether the Principal's copy of the one message in the archive has been
 * presented to it -- the ledger's own record of delivery, not a count of what
 * is still waiting to be batched. */
function wasPresented(society: Society): boolean {
  const names = readdirSync(join(society.root, "mail", "archive", "cur"));
  assert.equal(names.length, 1, `the archive holds ${names.length} messages`);
  const row = society.store.getDelivery(names[0]!.replace(/:2,$/, "") as never, "principal");
  assert.ok(row, "the Principal has no delivery row for its own mail");
  return row.presented === 1;
}

/** The engine as the delivery owner sees a live session. */
function sessionOf(engine: Engine): DeliverySession {
  // Mirrors PrincipalSession's reservation: the claim is taken synchronously,
  // before anything is written, and given back when a delivery ends unsettled.
  let owner: "human" | "delivery" | null = null;
  engine.onEvent(event => { if (event.type === "agent_settled") owner = null; });
  return {
    get running() { return engine.running; },
    get busy() { return owner !== null; },
    onEvent: listener => engine.onEvent(event => listener(event as unknown as PiEvent)),
    deliver: async batchId => {
      if (owner !== null) throw new StoreError("BATCH_CONFLICT", "the principal session is already running a turn");
      owner = "delivery";
      engine.send({ op: "prompt", id: batchId, message: `/oma-deliver ${batchId}` });
    },
  };
}

test("T114 / PR-002: mail to the Principal is delivered into its live session and completed", async () => {
  await withEngine("oma-principal-deliver-", async (society, engine) => {
    // Mail for the Principal, sent through its own tool.
    assert.ok((await engine.tool("oma_mail_send", { to: ["principal"], subject: "for you", body: "delivered?", kind: "message" })).ok);
    assert.equal(wasPresented(society), false);
    const promptsBefore = engine.events.filter(event => event.type === "response" && event.command === "prompt").length;

    const delivery = new PrincipalDelivery(sessionOf(engine), principalHostBroker(society.runRoot, LIMITS), {
      stateRoot: society.root, frameBytes: LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 60_000,
    });
    // The trusted extension presents the batch as a custom message; the model
    // then answers, which ends the turn.
    const presented = engine.next(event => event.type === "custom_message");
    const outcome = delivery.tick();
    const custom = await presented as { message: { customType: string; content: string } };
    assert.equal(custom.message.customType, "oma-mail");
    assert.match(custom.message.content, /for you|m-/);
    engine.send({ op: "turn", stopReason: "stop" });
    const result = await outcome;
    assert.equal(result.kind, "delivered", JSON.stringify(result));

    // The broker recorded it: the message is presented, a receipt exists, and
    // the session holds the boundary entry the receipt names.
    assert.equal(wasPresented(society), true);
    const receipts = readdirSync(join(society.root, "agents", "principal", "runner", "receipts"));
    assert.equal(receipts.length, 1);
    const receipt = JSON.parse(readFileSync(join(society.root, "agents", "principal", "runner", "receipts", receipts[0]!), "utf8"));
    const session = readFileSync(receipt.sessionPath, "utf8");
    assert.ok(session.includes(`"id":"${receipt.entryId}"`), "the receipt names an entry the session does not hold");
    // Nothing else to deliver.
    assert.equal((await delivery.tick()).kind, "idle");
    // V02C: observe actual stand-in engine responses, not the delivery planner.
    // A later tool reply fences this child's preceding stdin/events.
    assert.ok((await engine.tool("oma_mail_send", { to: ["principal"], subject: "credential probe", body: "local fixture", kind: "message" })).ok);
    assert.equal(engine.events.filter(event => event.type === "response" && event.command === "prompt").length, promptsBefore + 1);
  });
});

test("T114 / PR-002: a turn that does not settle cleanly leaves the mail pending, and it is retried later", async () => {
  await withEngine("oma-principal-deliver-fail-", async (society, engine) => {
    assert.ok((await engine.tool("oma_mail_send", { to: ["principal"], subject: "retry me", body: "x", kind: "message" })).ok);
    let now = 1_000_000;
    const delivery = new PrincipalDelivery(sessionOf(engine), principalHostBroker(society.runRoot, LIMITS), {
      stateRoot: society.root, frameBytes: LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 60_000, now: () => now,
    });
    const presented = engine.next(event => event.type === "custom_message");
    const first = delivery.tick();
    await presented;
    engine.send({ op: "turn", stopReason: "error" });
    assert.equal((await first).kind, "failed");
    assert.equal(wasPresented(society), false, "a failed delivery was marked delivered");
    // While the failed turn is still running down, delivery waits for it.
    await engine.idle();
    // Not retried at once...
    const early = await delivery.tick();
    assert.equal(early.kind, "deferred");
    assert.match((early as { reason: string }).reason, /failed recently/);
    // ...but after the back-off, and then it completes.
    now += 61_000;
    const again = engine.next(event => event.type === "custom_message");
    const second = delivery.tick();
    await again;
    engine.send({ op: "turn", stopReason: "stop" });
    assert.equal((await second).kind, "delivered");
    assert.equal(wasPresented(society), true);
  });
});

test("T114 / PR-002: nothing the model runs can mark its own mail delivered", async () => {
  await withEngine("oma-principal-deliver-owner-", async society => {
    // The attached model-facing connection does not serve the runner's
    // delivery methods...
    const attached = channel();
    try {
      await attached.connect(join(society.runRoot, "principal.sock"));
      // (This process is not a descendant of the engine, so it cannot even
      // attach; the refusal below is therefore the endpoint's first answer.)
      assert.notEqual(await failureOf(attached.call("batch.prepare", {})), "no failure");
    } finally { attached.close(); }
    // ...and the host endpoint answers only the host. A child of the engine --
    // where the model's commands run -- is refused there.
    const probe = await new Promise<string>(resolve => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", `
        import { BrokerChannel } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/client/dist/channel.js")).href)};
        const channel = new BrokerChannel({ frameBytes: 262144, idleStreamSeconds: 5, receiptWaitSeconds: 5 });
        await channel.connect(${JSON.stringify(join(society.runRoot, "principal-host.sock"))});
        const reply = await channel.call("batch.prepare", {}).catch(error => ({ ok: false, error: { code: String(error.message) } }));
        process.stdout.write(reply.ok ? "served" : reply.error.code);
        channel.close();
      `], { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", chunk => { out += String(chunk); });
      child.once("close", () => resolve(out));
    });
    assert.equal(probe, "AUTH_FAILED", "a process other than the host was served delivery");
  });
});

test("T114 / PR-002: delivery waits for an idle session rather than landing inside a Human's turn", async () => {
  const root = preparedRoot("oma-principal-busy-");
  try {
    const calls: string[] = [];
    const delivery = new PrincipalDelivery(
      { running: true, busy: true, onEvent: () => () => {}, deliver: async () => { calls.push("deliver"); } },
      { prepare: async () => { calls.push("prepare"); return ONE_BATCH; }, complete: async () => { calls.push("complete"); } },
      { stateRoot: root, frameBytes: LIMITS.frameBytes, acceptMs: 1000, retryAfterMs: 1000 },
    );
    // WP08: the prepared batch's receipt is examined first; with none, a busy
    // session is never claimed and nothing is presented into the Human's turn.
    assert.equal((await delivery.tick()).kind, "deferred");
    assert.deepEqual(calls, ["prepare"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("V08B: a busy or replaced session still settles an already-produced boundary with its first receipt, starting no turn", async () => {
  const root = preparedRoot("oma-principal-settle-busy-");
  try {
    const sessions = sessionDirPathAt(root, "principal");
    mkdirSync(sessions, { recursive: true });
    const oldSession = join(sessions, "old-engine.jsonl");
    writeBoundarySession(oldSession, ONE_BATCH, "0123abcd");
    publishDeliveryReceipt(root, ONE_BATCH, { adapterRevision: PI_ADAPTER_REVISION, batchId: ONE_BATCH.id,
      incarnation: ONE_BATCH.incarnation, sessionPath: oldSession, entryId: "0123abcd" }, LIMITS.frameBytes);
    const calls: string[] = [];
    const completed: Record<string, unknown>[] = [];
    const delivery = new PrincipalDelivery(
      { running: true, busy: true, onEvent: () => () => {}, deliver: async () => { calls.push("deliver"); } },
      { prepare: async () => ONE_BATCH, complete: async evidence => { calls.push("complete"); completed.push({ ...evidence }); } },
      { stateRoot: root, frameBytes: LIMITS.frameBytes, acceptMs: 1000, retryAfterMs: 1000 },
    );
    assert.deepEqual(await delivery.tick(), { kind: "settled", batchId: ONE_BATCH.id });
    assert.deepEqual(calls, ["complete"], "a model turn was started for a batch already delivered");
    assert.equal(completed[0]!.sessionPath, oldSession, "the completion used another session than the first receipt's");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T114: the credential comparison is fixed-shape and does not stop early", () => {
  const value = "a".repeat(64);
  assert.equal(credentialMatches(value, value), true);
  assert.equal(credentialMatches(`b${value.slice(1)}`, value), false);
  assert.equal(credentialMatches(`${value.slice(0, 63)}b`, value), false);
  for (const bad of ["", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), null, 1, {}])
    assert.equal(credentialMatches(bad, value), false, `accepted ${String(bad)}`);
  const handle = "a".repeat(32);
  assert.equal(sessionHandleMatches(handle, handle), true);
  assert.equal(sessionHandleMatches(`b${handle.slice(1)}`, handle), false);
  for (const bad of ["", "A".repeat(32), "a".repeat(31), "a".repeat(33), null])
    assert.equal(sessionHandleMatches(bad, handle), false);
  // The two grammars do not overlap, so one can never pass for the other.
  assert.equal(isPrincipalCredential(handle), false);
  assert.equal(sessionHandleMatches(value, value), false);
});

test("T114: provisioning creates the directories the Principal's engine and its session use", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-principal-provision-"));
  try {
    const report = provisionSociety(root);
    assert.ok(report.created.includes(join("principal", "private")));
    assert.ok(existsSync(principalSessionDir(root)));
    assert.ok(existsSync(principalWorkspace(root)), "the Principal's scratch, where its engine starts, was not provisioned");
    assert.equal(statSync(join(root, "principal", "private")).mode & 0o777, 0o700);
    assert.equal(provisionSociety(root).created.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** The real PrincipalSession, driven without an engine.
 *
 * The transport is a stand-in that records what was written, and the engine's
 * events go through the session's own handler -- the one the constructor
 * installs -- so the ownership rules are exercised exactly as the product
 * applies them and not as a test re-states them. */
/** A rejection the real Pi transport makes before writing a byte: an
 * oversized command, taken from a live client over a real child. Only the
 * transport can mark a command as not written. */
async function unwrittenRejection(): Promise<Error> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new PiRpcClient(child as never, { ...LIMITS, frameBytes: 64 });
  try {
    await client.send({ type: "prompt", message: "x".repeat(128) });
    throw new Error("an oversized command was written");
  } catch (error) {
    assert.ok(commandWasNotWritten(error));
    return error as Error;
  } finally { client.close(); child.kill("SIGKILL"); }
}

function reservedSession(refuse?: (message: Record<string, unknown>) => Error | null): {
  readonly session: PrincipalSession;
  readonly sent: Record<string, unknown>[];
  readonly lines: string[];
  readonly busy: boolean[];
  /** Prompts the session took and could not deliver, with the text it held. */
  readonly failed: { text: string; reason: string }[];
  readonly emit: (event: PiEvent) => void;
} {
  const sent: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const busy: boolean[] = [];
  const failed: { text: string; reason: string }[] = [];
  const session = Object.create(PrincipalSession.prototype) as PrincipalSession;
  const state = session as unknown as {
    rpc: { send: (message: Record<string, unknown>) => Promise<void> };
    sink: {
      onLine: (line: string) => void; onBusy: (busy: boolean) => void; onEnd: (reason: string) => void;
      onPromptFailed: (text: string, reason: string) => void;
    };
    turns: TurnAdmission;
    ready: boolean; closed: boolean; sequence: number; frameBytes: number;
    observe: (event: PiEvent) => void;
  };
  state.rpc = { send: async message => {
    const error = refuse?.(message) ?? null;
    if (error !== null) throw error;
    sent.push(message);
  } };
  state.sink = {
    onLine: line => lines.push(line), onBusy: value => busy.push(value), onEnd: () => {},
    onPromptFailed: (text, reason) => { failed.push({ text, reason }); },
  };
  state.turns = new TurnAdmission();
  state.ready = true; state.closed = false; state.sequence = 0; state.frameBytes = LIMITS.frameBytes;
  return { session, sent, lines, busy, failed, emit: event => { state.observe(event); } };
}

/** Pi answers a prompt command at preflight, before the run it starts. */
const accept = (id: string): PiEvent => ({ type: "response", id, command: "prompt", success: true });
const settled: PiEvent = { type: "agent_settled" };

test("T114 / PR-002: a Human prompt claims the session before it is written, so delivery cannot slip in", async () => {
  const { session, sent } = reservedSession();
  assert.equal(session.busy, false);
  // The moment the Human's prompt is submitted the session is claimed --
  // without waiting for the engine to report a turn. Between those two points
  // a delivery used to see an idle session and put its command in the same
  // run, which is the mixed attribution S-03 has not settled.
  // And the answer comes back in this call: the screen shows what was taken,
  // so acceptance cannot be something it is told after it has drawn.
  assert.deepEqual(session.submit("what is the plan?"), { kind: "accepted" });
  assert.equal(session.busy, true, "the session was still idle after a prompt was submitted");
  await assert.rejects(session.deliver("b-00000000-0000-4000-8000-000000000000"),
    (error: unknown) => error instanceof StoreError && error.code === "BATCH_CONFLICT");
  assert.equal(sent.length, 1, "a delivery was written into a session the Human had claimed");
});

test("T114 / PR-002: a Human prompt typed during a delivery waits in the host and is not folded into the delivery's run", async () => {
  const { session, sent, emit } = reservedSession();
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  await emit(accept("b-00000000-0000-4000-8000-000000000000"));
  assert.equal(session.busy, true);

  // The Human is never made to wait for mail, and never has to retype -- but
  // the prompt does not reach the engine yet. Pi drains its own follow-up
  // queue inside the run it is already performing and reports one
  // `agent_settled` for the whole of it, so a prompt queued there would have
  // run inside the delivery's run and the boundary the extension records for
  // that run would have covered the Human's turn too.
  assert.deepEqual(session.submit("meanwhile, about the release"), { kind: "accepted" });
  assert.equal(sent.length, 1, "the Human's prompt was written into the delivery's own run");

  // The delivery's run ends. That one settle ends the whole run, and the
  // Human's prompt is written now -- as a prompt of its own, with no
  // streaming behaviour, because the engine is idle again.
  await emit(settled);
  assert.equal(sent.length, 2, "the Human's prompt was never written after the delivery settled");
  assert.deepEqual(sent[1], { id: "oma-tui-1", type: "prompt", message: "meanwhile, about the release" });
  // And the session is the Human's until that prompt's own run settles.
  assert.equal(session.busy, true, "the session was released while the Human's prompt was still running");
  await assert.rejects(session.deliver("b-00000000-0000-4000-8000-000000000001"),
    (error: unknown) => error instanceof StoreError && error.code === "BATCH_CONFLICT");

  await emit(accept("oma-tui-1"));
  await emit(settled);
  assert.equal(session.busy, false, "one settle did not end the Human's run");
  await session.deliver("b-00000000-0000-4000-8000-000000000001");
  assert.equal(sent.length, 3);
});

test("T114 / PR-002: every prompt typed while the session was spoken for runs, once each, in order", async () => {
  // The defect this pins: counting settles per queued prompt. Pi emits one
  // `agent_settled` per run however many messages that run drained, so a
  // session that expected one settle per queued prompt would keep a claim
  // nobody ever gave back and defer every later delivery for good.
  const { session, sent, emit } = reservedSession();
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  for (const text of ["first", "second", "third"]) assert.deepEqual(session.submit(text), { kind: "accepted" });
  assert.equal(sent.length, 1, "prompts reached the engine while the delivery owned the session");

  const written: string[] = [];
  for (let run = 0; run < 3; run += 1) {
    await emit(settled);
    const last = sent.at(-1)!;
    written.push(String(last.message));
    await emit(accept(String(last.id)));
    assert.equal(session.busy, true, `the session was free with ${2 - run} prompts still waiting`);
  }
  await emit(settled);
  assert.equal(session.busy, false, "the session never came back after its Human prompts had run");
  assert.deepEqual(written, ["first", "second", "third"]);
  assert.equal(sent.length, 4, "a prompt was written more than once");
  assert.deepEqual(sent.map(message => message.id), ["b-00000000-0000-4000-8000-000000000000", "oma-tui-1", "oma-tui-2", "oma-tui-3"]);
});

test("T114 / PR-002: a prompt the engine refuses gives the session back and is said on the screen", async () => {
  // Pi answers `prompt` at preflight and refuses before acceptance -- no model,
  // no key, a compaction in progress. No run starts, so no run settles: without
  // reading that answer the session would stay claimed for the rest of its
  // life and the Human would never learn their input was not taken.
  const { session, sent, failed, emit } = reservedSession();
  session.submit("hello");
  assert.equal(session.busy, true);
  await new Promise(resolve => setImmediate(resolve));
  await emit({ type: "response", id: String(sent[0]!.id), command: "prompt", success: false, error: "no model selected" });
  assert.equal(session.busy, false, "a refused prompt left the session claimed");
  // Named, with its text: the Human was already told this prompt was taken, so
  // "a prompt was refused" would leave them unable to tell which and with
  // nothing to resend.
  assert.deepEqual(failed.map(entry => entry.text), ["hello"]);
  assert.ok(failed[0]!.reason.includes("no model selected"), failed[0]!.reason);
  // And the session works afterwards.
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  assert.equal(sent.length, 2);
});

test("T114 / PR-002: a refused delivery command gives the session back and lets the waiting Human through", async () => {
  const { session, sent, emit } = reservedSession();
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  session.submit("while that runs");
  await emit({ type: "response", id: "b-00000000-0000-4000-8000-000000000000", command: "prompt", success: false, error: "busy" });
  assert.equal(sent.length, 2, "the Human's waiting prompt was dropped with the refused delivery");
  assert.equal(sent[1]!.message, "while that runs");
  assert.equal(session.busy, true);
});

test("T114 / PR-002: a response for a prompt the session has moved on from changes nothing", async () => {
  const { session, sent, lines, emit } = reservedSession();
  session.submit("hello");
  await emit(settled);
  assert.equal(session.busy, false);
  // A late refusal for the prompt whose run already ended must not take a
  // claim away from whatever owns the session now.
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  await emit({ type: "response", id: String(sent[0]!.id), command: "prompt", success: false, error: "stale" });
  assert.equal(session.busy, true, "a stale response released a delivery's claim");
  assert.equal(lines.length, 0, lines.join(" | "));
});

test("T114 / PR-002: a prompt the transport cannot carry stops the screen saying the session is busy", async () => {
  // A prompt larger than the configured frame is rejected before a byte is
  // written -- no run starts, and nothing will ever settle to say the session
  // is free again. If the claim comes back but the report of it does not, the
  // screen shows "생성 중" over a session that is doing nothing at all.
  // Admission is answered in the call; the write is not, and cannot be. A
  // transport that fails after the prompt was admitted is reported where every
  // other failed write is -- on the screen -- and the claim comes back with it.
  const refusal = await unwrittenRejection();
  const { session, failed, busy } = reservedSession(() => refusal);
  assert.deepEqual(session.submit("x".repeat(64)), { kind: "accepted" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.busy, false);
  assert.deepEqual(busy, [true, false], `the screen was told ${JSON.stringify(busy)}`);
  assert.deepEqual(failed.map(entry => entry.text), ["x".repeat(64)],
    "the failure did not carry the prompt it was about");
  assert.equal(failed[0]!.reason, "Pi command exceeds the configured frame bound",
    "the cause is carried bare, so the surface can say where the text went without being cut off");
});

test("V09B: a write that failed after it began is not handed back as unsent and does not free the session", async () => {
  // D06: once bytes may have reached the engine, the prompt's acceptance is
  // unknown. The transport ended with the failure; the session's end reports
  // it as unconfirmed, and never as a draft to retype and resend.
  const { session, failed, busy } = reservedSession(() => new StoreError("DEADLINE_EXCEEDED", "Pi stdin write deadline exceeded"));
  assert.deepEqual(session.submit("maybe taken"), { kind: "accepted" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failed, [], "a possibly-written prompt was handed back as unsent");
  assert.equal(session.busy, true, "the claim was given up while the prompt's run may be going");
  assert.deepEqual(busy, [true]);
});

test("T114 / PR-002: the waiting prompt that could not be sent is named, and the rest still go", async () => {
  // The defect this pins: three prompts typed while the engine was busy are
  // all echoed as taken, one of their writes later fails, and the screen says
  // only that "the input" could not be sent. Which one? What did it say? The
  // Human could not tell, and had nothing left to resend it from.
  const refusal = await unwrittenRejection();
  const { session, sent, failed, emit } = reservedSession(
    message => (message.message === "second" ? refusal : null));
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  for (const text of ["first", "second", "third"]) assert.deepEqual(session.submit(text), { kind: "accepted" });

  await emit(settled);
  assert.equal(String(sent.at(-1)!.message), "first");
  await emit(accept(String(sent.at(-1)!.id)));
  await emit(settled);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(failed, [{ text: "second", reason: refusal.message }],
    "the failure did not say which of the waiting prompts it was about");
  assert.deepEqual(sent.map(message => String(message.message)),
    ["/oma-deliver b-00000000-0000-4000-8000-000000000000", "first", "third"],
    "a prompt behind the failed one was lost with it");
  assert.equal(session.busy, true, "the session was left free while the prompt behind the failure ran");
  await emit(accept(String(sent.at(-1)!.id)));
  await emit(settled);
  assert.equal(session.busy, false);

  // Negative control: with the same queue and no failing write, nothing is
  // named, because nothing was lost.
  const clean = reservedSession();
  await clean.session.deliver("b-00000000-0000-4000-8000-000000000000");
  for (const text of ["first", "second", "third"]) clean.session.submit(text);
  for (let run = 0; run < 3; run += 1) {
    await clean.emit(settled);
    await clean.emit(accept(String(clean.sent.at(-1)!.id)));
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(clean.failed, []);
  assert.deepEqual(clean.sent.map(message => String(message.message)).slice(1), ["first", "second", "third"]);
});

test("T114 / PR-002: the busy report comes from the ownership itself, at every move of it", async () => {
  const { session, busy, emit } = reservedSession();
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  assert.deepEqual(busy, [true]);
  // A prompt that only waits does not move the ownership, so it says nothing
  // new; the screen is already showing a session at work.
  session.submit("meanwhile");
  assert.deepEqual(busy, [true]);
  // The delivery's run ends and the waiting prompt takes the session in the
  // same step: the screen is never told the session went idle in between.
  await emit({ type: "agent_settled" });
  assert.deepEqual(busy, [true, true]);
  await emit({ type: "agent_settled" });
  assert.deepEqual(busy, [true, true, false]);
});

test("T120 / TUI-023: the host never retains a Human prompt beyond its UTF-8 frame admission", async () => {
  const { session, sent, busy } = reservedSession();
  const state = session as unknown as { frameBytes: number };
  state.frameBytes = 96;
  const refused = session.submit("가".repeat(12));
  assert.equal(refused.kind, "refused");
  assert.match(refused.kind === "refused" ? refused.reason : "", /prompt limit/);
  assert.equal(session.busy, false, "a rejected prompt claimed the session");
  assert.deepEqual(busy, [], "a rejected prompt changed the screen's busy state");
  assert.deepEqual(sent, [], "an oversized prompt reached the Pi transport");
});

test("T120 / TUI-023: only so many prompts wait, and the Human is told which one was not taken", async () => {
  // The Human can keep typing through a run they cannot interrupt, so the
  // length of that run would otherwise decide how much this process holds.
  const { session, sent } = reservedSession();
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  const bound = CONVERSATION_BOUNDS.waitingPrompts.value;
  for (let index = 0; index < bound; index += 1)
    assert.deepEqual(session.submit(`prompt ${index}`), { kind: "accepted" }, `prompt ${index} was not taken`);
  const refused = session.submit("one too many");
  assert.equal(refused.kind, "refused", "a prompt past the waiting bound was taken anyway");
  assert.match(refused.kind === "refused" ? refused.reason : "", new RegExp(String(bound)));
  assert.equal(sent.length, 1, "a waiting prompt reached the engine");
});

/** A stand-in session for the delivery owner: it records the claim and lets
 * the test emit exactly the events an engine would. */
/** A state root as the broker's prepare leaves it: the batch view is published
 * under the Principal's runner root, so a receipt's absence is observable. */
function preparedRoot(prefix = "oma-principal-delivery-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "agents", "principal", "runner", "view"), { recursive: true });
  return root;
}

function stubSession(): {
  readonly session: DeliverySession;
  readonly claims: string[];
  readonly emit: (event: PiEvent) => void;
} {
  const claims: string[] = [];
  const listeners = new Set<(event: PiEvent) => void>();
  let claimed = false;
  return {
    claims,
    emit: event => { for (const listener of [...listeners]) listener(event); },
    session: {
      running: true,
      get busy() { return claimed; },
      onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      deliver: async () => { claimed = true; claims.push("deliver"); },
    },
  };
}

const ONE_BATCH = {
  id: "b-00000000-0000-4000-8000-000000000000", agent: "principal" as const, incarnation: 0,
  messageIds: [], deliveryMode: "followUp" as const, notice: "", sessionPath: null, indexPath: "/inbox.md" as const,
};

test("V05B: Principal completion uses the first receipt returned by EEXIST publication", async () => {
  const root = preparedRoot("oma-principal-first-receipt-");
  try {
    const sessions = sessionDirPathAt(root, "principal");
    mkdirSync(sessions, { recursive: true });
    const firstSession = join(sessions, "first.jsonl");
    const laterSession = join(sessions, "later.jsonl");
    writeBoundarySession(firstSession, ONE_BATCH, "0123abcd");
    writeBoundarySession(laterSession, ONE_BATCH, "89abcdef");
    const completed: Record<string, unknown>[] = [];
    const { session, emit } = stubSession();
    const delivery = new PrincipalDelivery(session, {
      prepare: async () => ONE_BATCH,
      complete: async evidence => { completed.push({ ...evidence }); },
    }, { stateRoot: root, frameBytes: LIMITS.frameBytes, acceptMs: 60_000, retryAfterMs: 0 });
    const outcome = delivery.tick();
    await new Promise(resolve => setImmediate(resolve));
    // The receipt appears first from elsewhere while this delivery runs.
    publishDeliveryReceipt(root, ONE_BATCH, {
      adapterRevision: PI_ADAPTER_REVISION, batchId: ONE_BATCH.id, incarnation: ONE_BATCH.incarnation,
      sessionPath: firstSession, entryId: "0123abcd",
    }, LIMITS.frameBytes);
    emit({ type: "response", id: ONE_BATCH.id, command: "prompt", success: true });
    emit(failedMessage("stop"));
    emit({
      type: "extension_ui_request", method: "notify",
      message: `${PI_BOUNDARY_PREFIX}${JSON.stringify({
        adapterRevision: PI_ADAPTER_REVISION, batchId: ONE_BATCH.id, incarnation: ONE_BATCH.incarnation,
        sessionPath: laterSession, entryId: "89abcdef",
      })}`,
    } as PiEvent);
    emit({ type: "agent_settled" });
    assert.equal((await outcome).kind, "delivered");
    assert.equal(completed.length, 1);
    assert.equal(completed[0]!.sessionPath, firstSession);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function failedMessage(stopReason: string): PiEvent {
  return { type: "message_end", message: { role: "assistant", stopReason, content: [] } };
}

test("T114 / PR-002: a failed assistant message does not end the delivery -- the run settling does", async () => {
  // `message_end` comes before `agent_settled`, and Pi retries a retryable
  // failure and compacts before continuing. Giving the session back at the
  // first failed message would release a claim on a run Pi is still
  // performing, and the next thing written would be refused by an engine that
  // is in fact streaming.
  const { session, claims, emit } = stubSession();
  const delivery = new PrincipalDelivery(session,
    { prepare: async () => ONE_BATCH, complete: async () => {} },
    { stateRoot: preparedRoot(), frameBytes: LIMITS.frameBytes, acceptMs: 60_000, retryAfterMs: 1000 });
  const outcome = delivery.tick();
  let finished = false;
  void outcome.then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  emit({ type: "response", id: ONE_BATCH.id, command: "prompt", success: true });
  emit(failedMessage("error"));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(finished, false, "the delivery gave up on a failed message before the run had settled");
  assert.deepEqual(claims, ["deliver"], "the session was released while the engine was still running");

  // Pi retried and this run ended in a terminal stop; the failure is over.
  // With no boundary the batch is still not delivered, but the reason is the
  // missing boundary -- not the provider.
  emit(failedMessage("stop"));
  emit({ type: "agent_settled" });
  const result = await outcome;
  assert.equal(result.kind, "failed");
  assert.match((result as { reason: string }).reason, /without a delivery boundary/);
  assert.deepEqual(claims, ["deliver"], "the delivery released a claim the settled run had already given back");
});

test("T114 / PR-002: a run that settles on a failed assistant message is reported as the provider failing", async () => {
  const { session, emit } = stubSession();
  const delivery = new PrincipalDelivery(session,
    { prepare: async () => ONE_BATCH, complete: async () => {} },
    { stateRoot: preparedRoot(), frameBytes: LIMITS.frameBytes, acceptMs: 60_000, retryAfterMs: 1000 });
  const outcome = delivery.tick();
  await new Promise(resolve => setImmediate(resolve));
  emit({ type: "response", id: ONE_BATCH.id, command: "prompt", success: true });
  emit(failedMessage("error"));
  emit({ type: "agent_settled" });
  const result = await outcome;
  assert.equal(result.kind, "failed");
  assert.match((result as { reason: string }).reason, /provider failed/);
});

test("T114 / D06: a delivery the engine never answers keeps the session", async () => {
  // The engine answers nothing. The command was written, so a run may be
  // going; giving the session back on the owner's timeout would hand the
  // Human's next prompt into it. Only settlement, the engine's refusal or the
  // session's end ends the claim (WP09).
  const claims: string[] = [];
  let claimed = false;
  const session: DeliverySession = {
    running: true,
    get busy() { return claimed; },
    onEvent: () => () => {},
    deliver: async () => { claimed = true; claims.push("deliver"); },
  };
  const batch = {
    id: "b-00000000-0000-4000-8000-000000000000", agent: "principal" as const, incarnation: 0,
    messageIds: [], deliveryMode: "followUp" as const, notice: "", sessionPath: null, indexPath: "/inbox.md" as const,
  };
  let now = 1_000;
  const delivery = new PrincipalDelivery(session, {
    prepare: async () => batch, complete: async () => { claims.push("complete"); },
  }, { stateRoot: preparedRoot(), frameBytes: LIMITS.frameBytes, acceptMs: 10, retryAfterMs: 1000, now: () => (now += 20) });
  const outcome = await delivery.tick();
  assert.equal(outcome.kind, "failed");
  assert.match((outcome as { reason: string }).reason, /accept/);
  assert.deepEqual(claims, ["deliver"], "the delivery gave up a claim whose run may be going");
  assert.equal(session.busy, true);
});

test("T114 / PR-002: the extension is ready for the next batch however a turn ended", async () => {
  // The engine reports a session path that is not absolute, so the extension
  // cannot name a boundary however the turn ends. The batch stays prepared in
  // the broker; what is tested here is that this engine still accepts the next
  // delivery of it. A long-lived Principal session that held the batch after
  // an unreported boundary would refuse every later one.
  await withEngine("oma-principal-pending-release-", async (society, engine) => {
    assert.ok((await engine.tool("oma_mail_send", { to: ["principal"], subject: "s", body: "b", kind: "message" })).ok);
    const delivery = new PrincipalDelivery(sessionOf(engine), principalHostBroker(society.runRoot, LIMITS), {
      stateRoot: society.root, frameBytes: LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 0,
    });
    for (const attempt of [1, 2]) {
      // Presented again on the second attempt: the extension released its claim.
      const presented = engine.next(event => event.type === "custom_message", 10_000);
      const outcome = delivery.tick();
      await presented;
      engine.send({ op: "turn", stopReason: "stop" });
      assert.equal((await outcome).kind, "failed", `attempt ${attempt} was not the expected unreported boundary`);
      await engine.idle();
    }
  }, { OMA_TEST_SESSION_FILE: "relative/session.jsonl" });
});

test("T114: the Principal's session stays in its own private space", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-principal-private-"));
  try {
    provisionSociety(root);
    // PR-003: the Human's history is not kept beside other agents' runner
    // artifacts, and the receipt validator asks the same owner where it is.
    assert.equal(principalSessionDir(root), join(root, "principal", "private", "sessions"));
    assert.ok(existsSync(principalSessionDir(root)));
    assert.equal(existsSync(join(root, "agents", "principal", "runner", "sessions")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T114: the host is answered on its identity, not on a number another process may hold", async () => {
  // The same pid, a different process: a pid is reused, and everything else in
  // this repo pins identity rather than trusting a number. A caller whose start
  // time is not the registered host's is refused delivery.
  const impostor = new HostChannel("/nonexistent/run", { pid: process.pid, startTime: "1" });
  const society = await startSociety("oma-principal-hostpin-", true, impostor);
  try {
    const client = channel();
    try {
      await client.connect(join(society.runRoot, "principal-host.sock"));
      assert.equal(await failureOf(client.call("batch.prepare", {})), "AUTH_FAILED");
    } finally { client.close(); }
  } finally { await stopSociety(society); }
});

test("T114 / IPC-012: a method the host endpoint does not serve is an unknown method, not a refused host", async () => {
  // The host is already known by this point, so answering AUTH_FAILED would
  // tell a caller its identity was rejected when in fact its identity was
  // accepted and the method does not exist. Error class is what decides
  // whether a caller may retry, so the two are not interchangeable.
  const society = await startSociety("oma-principal-unknown-method-");
  try {
    // Real protocol methods this endpoint does not serve: one internal, one
    // public. A refused request ends its connection, so each gets its own.
    for (const method of ["runner.open", "status.get"] as const) {
      const client = channel();
      try {
        await client.connect(join(society.runRoot, "principal-host.sock"));
        assert.equal(await failureOf(client.call(method, {})), "UNKNOWN_METHOD", method);
      } finally { client.close(); }
    }
    // What it does serve still works on a connection of its own -- once this
    // host has a registered Principal to deliver to, which is a separate
    // question from whether the method exists.
    await withRegisteredEngine(society, async () => {
      const client = channel();
      try {
        await client.connect(join(society.runRoot, "principal-host.sock"));
        assert.equal((await client.call("batch.prepare", {})).ok, true);
      } finally { client.close(); }
    });
  } finally { await stopSociety(society); }
});

/** Registers a real child of this process as the Principal engine, the way the
 * host does over the supervision channel, for the body of `run`. */
async function withRegisteredEngine(society: Society, run: (enginePid: number) => Promise<void>): Promise<void> {
  const engine = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000);"], { stdio: "ignore" });
  try {
    await new Promise<void>(resolve => { engine.once("spawn", () => resolve()); });
    const granted = society.host!.register(newSessionHandle(), engine.pid!);
    assert.ok(granted, "the broker refused a registration this test depends on");
    await run(engine.pid!);
  } finally { engine.kill("SIGKILL"); }
}

test("T114 / PR-002: the host is served delivery only while this broker holds a registration for its engine", async () => {
  // The defect this closes: the host endpoint checked who was calling and
  // nothing else, so a host whose registration had been refused -- or had not
  // been answered yet -- was served `batch.prepare` exactly like a host with a
  // live Principal. Mail was then prepared, and a boundary recorded, against a
  // session that did not exist.
  const society = await startSociety("oma-principal-unregistered-");
  try {
    const before = channel();
    try {
      await before.connect(join(society.runRoot, "principal-host.sock"));
      assert.equal(await failureOf(before.call("batch.prepare", {})), "AUTH_FAILED",
        "delivery was prepared for a host with no registered Principal");
    } finally { before.close(); }

    const complete = channel();
    try {
      await complete.connect(join(society.runRoot, "principal-host.sock"));
      // The other half of the pair. Completing a boundary with no registration
      // would write evidence about a session this broker never accepted.
      assert.equal(await failureOf(complete.call("batch.complete",
        { boundary: { sessionFile: "/tmp/x.jsonl", offset: 0 } })), "AUTH_FAILED");
    } finally { complete.close(); }

    // The negative control, on the same broker and the same socket: restore
    // the one missing fact and the very same call is served. Without this the
    // test above would also pass if delivery were refused for some unrelated
    // reason -- a broken socket, a wrong method, a draining broker.
    await withRegisteredEngine(society, async () => {
      const after = channel();
      try {
        await after.connect(join(society.runRoot, "principal-host.sock"));
        assert.equal((await after.call("batch.prepare", {})).ok, true,
          "the control did not reproduce: delivery was refused even with a registration");
      } finally { after.close(); }
    });
  } finally { await stopSociety(society); }
});

test("T114 / PR-002: a registration that ends closes delivery again, without anything telling the endpoint", async () => {
  // A registration is retired by events the delivery endpoint never sees: the
  // engine dies, or the host registers another one and the first is dropped.
  // The endpoint therefore asks on every request rather than remembering an
  // answer, and this is what that difference looks like from outside.
  const society = await startSociety("oma-principal-registration-ends-");
  try {
    const engine = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000);"], { stdio: "ignore" });
    await new Promise<void>(resolve => { engine.once("spawn", () => resolve()); });
    assert.ok(society.host!.register(newSessionHandle(), engine.pid!));
    const served = channel();
    try {
      await served.connect(join(society.runRoot, "principal-host.sock"));
      assert.equal((await served.call("batch.prepare", {})).ok, true);
    } finally { served.close(); }

    // The engine is gone. Nothing re-registers, nothing closes, nothing tells
    // the broker: the only event is that a process stopped existing.
    await new Promise<void>(resolve => { engine.once("exit", () => resolve()); engine.kill("SIGKILL"); });
    const refused = channel();
    try {
      await refused.connect(join(society.runRoot, "principal-host.sock"));
      assert.equal(await failureOf(refused.call("batch.prepare", {})), "AUTH_FAILED",
        "delivery stayed open to an engine that no longer exists");
    } finally { refused.close(); }
  } finally { await stopSociety(society); }
});

test("T114: stopping the broker releases the supervision channel it was given", async () => {
  const society = await startSociety("oma-principal-channel-close-");
  assert.equal(society.host!.closed, false);
  await society.broker.drainAndClose();
  // A broker told to stop on its own must not stay alive holding a descriptor
  // whose other end is a host that is still running.
  assert.equal(society.host!.closed, true, "the broker kept the supervision channel after it stopped");
  rmSync(society.root, { recursive: true, force: true });
});

/** The endpoint driven through its ports alone, with a real process standing
 * in for the engine.
 *
 * The broker-level tests above watch connections from outside, and every
 * process allowed to attach is a descendant of the engine -- a child of a
 * child of this one. That is the wrong vantage point for the question here.
 * It is not "who may attach?" but "what happens to a connection that already
 * attached, at the instant it stops being the Principal's?", and answering it
 * means holding that connection open across the event.
 */
class Bench {
  readonly grants: { credential: string; sessionHandle: string }[] = [];
  readonly refused: string[] = [];
  readonly observed: string[] = [];
  readonly dispatched: string[] = [];
  readonly preflighted: string[] = [];
  readonly failed: string[] = [];
  /** What each authority the endpoint handed on was told to keep asking. */
  readonly lives: (() => boolean)[] = [];
  readonly endpoint: PrincipalEndpoint;
  private deliver: ((sessionHandle: string, pid: number) => void) | null = null;
  private capture: ((handle: Held["raw"], preflight: Held["check"]) => void) | null = null;
  private sequence = 0;

  /** `peer` is the process at the other end of a connection. It defaults to
   * the engine itself, which is what the tests about registration need; the
   * tests about the engine's death need a real descendant of it, because the
   * question there is what happens to a process the engine started once the
   * engine is gone. */
  constructor(readonly engine: number, readonly peerPid = engine) {
    const uid = process.getuid?.() ?? -1;
    const gid = process.getgid?.() ?? -1;
    const channel: PrincipalHostChannel = {
      host: processIdentity(process.pid)!,
      ready: () => {},
      grant: (credential, sessionHandle) => { this.grants.push({ credential, sessionHandle }); },
      refuse: sessionHandle => { this.refused.push(sessionHandle); },
      onSession: listener => { this.deliver = listener; },
      close: () => {},
    };
    // Liveness is the peer's own, as the real authenticator answers it: a
    // descendant that outlives its engine is alive, and must be refused for
    // the reason it is actually refused for.
    const peer = { pid: peerPid, uid, gid, alive: () => processIdentity(peerPid) !== null, sameSender: () => false,
      retainForExecution: () => () => {}, releaseConnection: () => {} } as BoundPeer;
    const context = (): AuthContext => ({ actor: "principal", incarnation: 1, role: "principal",
      channel: "actor", capabilities: new Set(), peer: { pid: peerPid, uid, gid } });
    const ports: PrincipalEndpointPorts = {
      isDraining: () => false,
      bindPeer: () => peer,
      principalContext: (_peer, live) => { this.lives.push(live); return context(); },
      serveFrames: (_socket, _peer, handle, preflight) => { this.capture?.(handle, preflight); },
      fail: (_socket, failure) => { this.failed.push(failure.code); },
      observe: error => { this.observed.push(error instanceof StoreError ? error.code : String(error)); },
      cleanupError: error => { this.observed.push(`cleanup: ${String(error)}`); },
      dispatch: async (_auth, request: Request) => {
        this.dispatched.push(request.method);
        return { v: 1, id: request.id, ok: true, result: {} };
      },
      preflight: (_auth, raw) => { this.preflighted.push(String(raw.method)); },
    };
    this.endpoint = new PrincipalEndpoint(channel, ports);
  }

  /** A session as the host would register it: through the channel listener,
   * never by calling `register` directly, so the refusal path is the real one. */
  register(sessionHandle: string, pid = this.engine): void { this.deliver!(sessionHandle, pid); }

  /** One connection, held open for as long as the test wants it. */
  open(): Held {
    let raw: Held["raw"] | null = null;
    let check: Held["check"] | null = null;
    this.capture = (handle, preflight) => { raw = handle; check = preflight; };
    const socket = { destroyed: false, destroy(): void { this.destroyed = true; }, once(): void {} };
    this.endpoint.serve(socket as unknown as Socket);
    this.capture = null;
    const handle = raw as Held["raw"] | null;
    const preflight = check as Held["check"] | null;
    assert.ok(handle && preflight, "the endpoint did not serve the connection");
    return {
      socket, raw: handle, check: preflight,
      call: (method, params = {}) => handle({ v: 1, id: `r${++this.sequence}`, method, params }, null),
      preflight: method => { preflight({ v: 1, id: "p", method, params: {} }); },
    };
  }
}

interface Held {
  readonly socket: { destroyed: boolean };
  readonly raw: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>;
  readonly check: (raw: Record<string, unknown>) => void;
  readonly call: (method: string, params?: Record<string, unknown>) => Promise<object>;
  readonly preflight: (method: string) => void;
}

/** The code a refused call carries. The endpoint throws below the envelope, so
 * the code is read off the error rather than a reply. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    const reply = await call;
    if (reply !== null && typeof reply === "object" && (reply as { ok?: unknown }).ok === false)
      return (reply as { error: { code: string } }).error.code;
    return "no failure";
  } catch (error) { return error instanceof StoreError ? error.code : String(error); }
}

/** A process of this test's own, so the endpoint's `/proc` checks are answered
 * by a real parent-child relation rather than a stub. */
async function withEngineProcess(run: (bench: Bench) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000);"], { stdio: "ignore" });
  try {
    await new Promise<void>(resolve => { child.once("spawn", () => resolve()); });
    await run(new Bench(child.pid!));
  } finally { child.kill("SIGKILL"); }
}

/** Attaches `held` under the latest grant and proves it is serving. */
async function attachAndUse(bench: Bench, held: Held, sessionHandle: string): Promise<void> {
  const grant = bench.grants.at(-1)!;
  const attached = await held.call("principal.attach", { sessionHandle, credential: grant.credential });
  assert.equal((attached as { ok: boolean }).ok, true, "the connection did not attach");
  const before = bench.dispatched.length;
  assert.equal((await held.call("status.get") as { ok: boolean }).ok, true);
  assert.equal(bench.dispatched.length, before + 1, "the attached connection was not served");
}

/** Frames whose envelope no internal channel accepts, whatever they name. */
function malformed(method: string, params: Record<string, unknown>): Record<string, unknown>[] {
  return [
    { id: "e1", method, params },
    { v: 2, id: "e2", method, params },
    { v: 1, method, params },
    { v: 1, id: "e4", method },
    { v: 1, id: "e5", method, params: [] },
    { v: 1, id: "e6", method, params, extra: true },
    { v: 1, id: "e7", method, params, request: "k" },
  ];
}

test("P0V-32 / N08, P0-2: the Principal's endpoint reads a request's envelope the way every internal channel does", async () => {
  await withEngineProcess(async bench => {
    const handle = newSessionHandle();
    bench.register(handle);
    const held = bench.open();
    const attach = { sessionHandle: handle, credential: bench.grants.at(-1)!.credential };
    for (const frame of malformed("principal.attach", attach))
      assert.equal(await codeOf(held.raw(frame, null)), "INVALID_REQUEST", JSON.stringify(frame));
    // None of them attached the connection.
    assert.equal(await codeOf(held.call("status.get")), "AUTH_FAILED");
    await attachAndUse(bench, held, handle);
    for (const frame of malformed("principal.detach", {}))
      assert.equal(await codeOf(held.raw(frame, null)), "INVALID_REQUEST", JSON.stringify(frame));
    // None of them detached it, and a well-formed detach answers as declared.
    const served = bench.dispatched.length;
    assert.equal((await held.call("status.get") as { ok: boolean }).ok, true);
    assert.equal(bench.dispatched.length, served + 1);
    assert.deepEqual((await held.call("principal.detach") as { result: unknown }).result, { detached: true });
  });
});

test("P0V-32 / N08, P0-2: the host's delivery endpoint reads the envelope before any delivery method runs", async () => {
  const host = processIdentity(process.pid)!;
  const peer = { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), alive: () => true, sameSender: () => false,
    retainForExecution: () => () => {}, releaseConnection: () => {} } as unknown as BoundPeer;
  const served: { handle?: (raw: Record<string, unknown>, stream: null) => Promise<object> } = {};
  const ran: string[] = [];
  const ports: PrincipalHostEndpointPorts = {
    isDraining: () => false, bindPeer: () => peer,
    principalContext: () => ({ actor: "principal", incarnation: 1, role: "principal", channel: "actor", capabilities: new Set(),
      peer: { pid: process.pid, uid: peer.uid, gid: peer.gid } }),
    serveFrames: (_socket, _peer, handle) => { served.handle = handle; },
    fail: () => {}, observe: () => {}, cleanupError: () => {},
    registeredEngine: () => process.pid,
    prepare: async () => { ran.push("prepare"); return null; },
    complete: async () => { ran.push("complete"); },
  };
  const endpoint = new PrincipalHostEndpoint({ host, ready: () => {}, grant: () => {}, refuse: () => {}, onSession: () => {}, close: () => {} }, ports);
  endpoint.serve({ destroyed: false, destroy() {}, once() {} } as unknown as Socket);
  const handle = served.handle;
  assert.ok(handle !== undefined);
  for (const method of ["batch.prepare", "batch.complete"])
    for (const frame of malformed(method, {}))
      assert.equal(await codeOf(handle(frame, null)), "INVALID_REQUEST", JSON.stringify(frame));
  assert.deepEqual(ran, [], "a delivery method ran for a malformed frame");
  await handle({ v: 1, id: "ok", method: "batch.prepare", params: {} }, null);
  assert.deepEqual(ran, ["prepare"]);
});

test("T114: re-registering the session revokes the connections the old one already had", async () => {
  await withEngineProcess(async bench => {
    const handle = newSessionHandle();
    bench.register(handle);
    const held = bench.open();
    await attachAndUse(bench, held, handle);
    const served = bench.dispatched.length;

    // The host registers the engine again. The connection is not told, is not
    // asked anything, and does nothing: this is the whole event.
    bench.register(handle);
    assert.equal(bench.grants.length, 2);
    assert.notEqual(bench.grants[1]!.credential, bench.grants[0]!.credential);

    // It is not the Principal any more. Removing the generation binding in
    // `PrincipalEndpoint` -- authorising on what the connection was handed at
    // attach -- makes exactly this line pass a request through.
    assert.equal(await codeOf(held.call("status.get")), "AUTH_FAILED");
    assert.equal(bench.dispatched.length, served, "a revoked connection reached dispatch");
    // The other way in is preflight, which never reaches dispatch at all.
    assert.equal(bench.preflighted.length, 0);
    assert.throws(() => held.preflight("context.put"), /no longer registered/);
    assert.equal(bench.preflighted.length, 0, "a revoked connection reached preflight");
    // And it is not left open to keep trying.
    assert.equal(held.socket.destroyed, true, "the revoked connection was left open");

    // The new session is serving, so this is revocation and not a dead endpoint.
    const fresh = bench.open();
    await attachAndUse(bench, fresh, handle);
    // The replaced credential does not work on a connection of its own either.
    const stale = bench.open();
    assert.equal(await codeOf(stale.call("principal.attach",
      { sessionHandle: handle, credential: bench.grants[0]!.credential })), "AUTH_FAILED");
  });
});

test("T114: a registration the broker refuses leaves no attached Principal behind", async () => {
  await withEngineProcess(async bench => {
    const handle = newSessionHandle();
    bench.register(handle);
    const held = bench.open();
    await attachAndUse(bench, held, handle);
    const served = bench.dispatched.length;

    // The host names a process that is not its child. Nothing is minted -- and
    // the session that was registered is gone all the same, because the host
    // has said the engine it had is not the engine it has.
    const refusedHandle = newSessionHandle();
    bench.register(refusedHandle, process.ppid);
    assert.equal(bench.grants.length, 1, "a refused registration minted a credential");
    assert.deepEqual(bench.refused, [refusedHandle]);
    assert.deepEqual(bench.observed, ["AUTH_FAILED"]);

    assert.equal(await codeOf(held.call("status.get")), "AUTH_FAILED");
    assert.equal(bench.dispatched.length, served, "a connection survived a refused registration");
    assert.equal(held.socket.destroyed, true);
    // Nothing can attach at all while there is no session.
    const late = bench.open();
    assert.equal(await codeOf(late.call("principal.attach",
      { sessionHandle: handle, credential: bench.grants[0]!.credential })), "AUTH_FAILED");
  });
});

test("T114: closing the endpoint revokes the connections that are already attached", async () => {
  await withEngineProcess(async bench => {
    const handle = newSessionHandle();
    bench.register(handle);
    const held = bench.open();
    await attachAndUse(bench, held, handle);
    const served = bench.dispatched.length;

    bench.endpoint.close();
    assert.equal(await codeOf(held.call("status.get")), "AUTH_FAILED");
    assert.equal(bench.dispatched.length, served, "a closed endpoint served a request");
    assert.equal(held.socket.destroyed, true);
    // A closed endpoint registers nothing, so a host that keeps talking to it
    // cannot bring a session back.
    bench.register(newSessionHandle());
    assert.equal(bench.grants.length, 1);
  });
});

test("T114: detaching gives up authority rather than parking it for later", async () => {
  await withEngineProcess(async bench => {
    const handle = newSessionHandle();
    bench.register(handle);
    const held = bench.open();
    await attachAndUse(bench, held, handle);
    const served = bench.dispatched.length;

    assert.equal((await held.call("principal.detach") as { ok: boolean }).ok, true);
    // A detached connection is back to being a connection: the next frame must
    // be an attach, and a request is refused rather than served.
    assert.equal(await codeOf(held.call("status.get")), "AUTH_FAILED");
    assert.equal(bench.dispatched.length, served);
    // It is no longer held for revocation either -- there is nothing to revoke.
    bench.register(handle);
    assert.equal(held.socket.destroyed, false, "a detached connection was destroyed");
    // It may attach again, but only with what the current session was granted.
    assert.equal(await codeOf(held.call("principal.attach",
      { sessionHandle: handle, credential: bench.grants[0]!.credential })), "AUTH_FAILED");
    await attachAndUse(bench, held, handle);
  });
});

/** An engine of this test's own with a child of its own, so both the descent
 * walk and the engine's death are real events in `/proc` rather than stubs.
 * `kill` ends the engine and resolves once it has been reaped -- a zombie
 * still has a `/proc` entry with the same start time, so a test that did not
 * wait for the reap would be asserting against a process that is, as far as
 * the kernel is concerned, still there. */
async function withEngineAndChild(
  run: (engine: number, child: number, killEngine: () => Promise<void>) => Promise<void>,
): Promise<void> {
  // The engine is a script on disk rather than a `-e` argument: the child it
  // has to start is itself a `-e` argument, and nesting the two is a quoting
  // trap, not a test of anything.
  const scratchRoot = mkdtempSync(join(tmpdir(), "oma-engine-death-"));
  const script = join(scratchRoot, "engine.mjs");
  writeFileSync(script, [
    'import { spawn } from "node:child_process";',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore" });',
    'process.stdout.write(`${child.pid}\n`);',
    "setInterval(() => {}, 60000);",
  ].join("\n"));
  const engine = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
  let childPid = 0;
  try {
    childPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("the stand-in engine never named its child")); }, 20000);
      engine.stdout!.setEncoding("utf8");
      engine.stdout!.once("data", (chunk: string) => { clearTimeout(timer); resolve(Number(chunk.trim())); });
    });
    assert.ok(Number.isSafeInteger(childPid) && childPid > 1);
    const reaped = new Promise<void>(resolve => { engine.once("exit", () => { resolve(); }); });
    await run(engine.pid!, childPid, async () => { engine.kill("SIGKILL"); await reaped; });
  } finally {
    engine.kill("SIGKILL");
    if (childPid > 1) { try { process.kill(childPid, "SIGKILL"); } catch { /* already gone */ } }
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

test("T114 / AUTH-003: an engine that dies takes the authority of the processes it started with it", async () => {
  // Descent was checked once, at attach, and the answer was kept for the life
  // of the connection. So a process the engine started went on acting as the
  // Principal after the engine was gone: nothing re-registered, so the
  // generation was unchanged; the process was still alive, so its peer was
  // still valid; and the only thing that had changed -- that its ancestor no
  // longer existed -- was never looked at again. The connection outlived the
  // engine whose authority it was borrowing.
  await withEngineAndChild(async (enginePid, childPid, killEngine) => {
    const bench = new Bench(enginePid, childPid);
    const handle = newSessionHandle();
    bench.register(handle);
    const held = bench.open();
    const idle = bench.open();
    await attachAndUse(bench, held, handle);
    const served = bench.dispatched.length;

    await killEngine();
    // Nothing told the endpoint. No re-registration, no close, no detach: the
    // only event is that a process outside it stopped existing.
    assert.equal(bench.grants.length, 1, "something re-registered the session");
    assert.equal(bench.refused.length, 0);

    assert.equal(await codeOf(held.call("status.get")), "AUTH_FAILED");
    assert.equal(bench.dispatched.length, served, "an orphaned connection reached dispatch");
    assert.throws(() => held.preflight("context.put"), /no longer registered/);
    assert.equal(bench.preflighted.length, 0, "an orphaned connection reached preflight");

    // And the refusal is not once per connection: the session itself is gone,
    // so every connection attached under it loses authority at the same
    // instant -- after the refusal is written, so the caller is told why
    // rather than finding a closed socket.
    await new Promise<void>(resolve => { setImmediate(() => { resolve(); }); });
    assert.equal(held.socket.destroyed, true, "the orphaned connection was left open and attached");
    assert.equal(idle.socket.destroyed, false, "a connection that never attached was destroyed");

    // Nothing can attach under the dead engine's session either, credential or
    // not: the session is not there to attach to.
    assert.equal(await codeOf(idle.call("principal.attach",
      { sessionHandle: handle, credential: bench.grants[0]!.credential })), "AUTH_FAILED");
  });
});

test("T114: revocation reaches every attached connection, and only attached ones", async () => {
  await withEngineProcess(async bench => {
    const handle = newSessionHandle();
    bench.register(handle);
    const first = bench.open();
    const second = bench.open();
    await attachAndUse(bench, first, handle);
    await attachAndUse(bench, second, handle);
    // A connection that never attached is not the endpoint's to destroy: it
    // holds no authority to take away.
    const idle = bench.open();

    bench.register(handle);
    assert.equal(first.socket.destroyed, true);
    assert.equal(second.socket.destroyed, true);
    assert.equal(idle.socket.destroyed, false, "an unattached connection was destroyed");
    assert.equal(await codeOf(first.call("status.get")), "AUTH_FAILED");
    assert.equal(await codeOf(second.call("status.get")), "AUTH_FAILED");
    // The idle one can still attach -- with the current credential.
    await attachAndUse(bench, idle, handle);
  });
});

test("P0V-57 / R02, P0-2: after corruption is observed the host's delivery endpoint is fenced like the runner channel", async () => {
  const society = await startSociety("oma-host-fenced-");
  try {
    await withRegisteredEngine(society, async () => {
      const before = channel();
      try {
        await before.connect(join(society.runRoot, "principal-host.sock"));
        assert.equal((await before.call("batch.prepare", {})).ok, true, "a healthy broker serves the host");
      } finally { before.close(); }
      // Any owner of this Store observing corruption closes the broker's fence.
      observeStoreFailure(society.store, new StoreError("STORE_CORRUPT", "injected"));
      for (const method of ["batch.prepare", "batch.complete"] as const) {
        const client = channel();
        try {
          await client.connect(join(society.runRoot, "principal-host.sock"));
          const params = method === "batch.prepare" ? {} : { batchId: "b-00000000-0000-4000-8000-000000000001", incarnation: 0,
            sessionPath: "/s", adapterRevision: "r", receiptPath: "/r" };
          assert.equal(await failureOf(client.call(method, params)), "STORE_CORRUPT", `${method} passed a fenced store`);
        } finally { client.close(); }
      }
    });
  } finally { await stopSociety(society); }
});

test("P0V-60 / R05, P0-2: the authority a request was handed stops standing when its registration is retired", async () => {
  await withEngineProcess(async bench => {
    const first = newSessionHandle();
    bench.register(first);
    const held = bench.open();
    await attachAndUse(bench, held, first);
    // The authority the dispatched request carries into its awaits.
    const live = bench.lives.at(-1)!;
    assert.equal(live(), true);
    // The host registers another session; the request is still running.
    bench.register(newSessionHandle());
    assert.equal(live(), false, "a request authorised under a retired registration can still accept");
  });
});

test("P0V-60 / R05, P0-2: the Principal's capabilities are read against what the caller was authorised under, at every read", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-principal-live-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  store.transaction(() => store.insertAgent({ name: "principal", specHash: resolvedSpecDigest(PRINCIPAL_SPEC), role: "principal",
    desired: "enabled", incarnation: 0, profile: "p", createdBy: null, specJson: JSON.stringify(PRINCIPAL_SPEC) }));
  const peers = new PeerAuthenticator(store, {} as PolicyExecution, new RunRegistry(() => { throw new Error("this Principal-only test has no Worker scope"); }), "demo", () => undefined,
    () => { throw new Error("Principal context checks do not acquire a connection"); });
  const peer = { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), alive: () => true, sameSender: () => false,
    retainForExecution: () => () => undefined, releaseConnection: () => undefined } as BoundPeer;
  let standing = true;
  const auth = peers.principalContext(peer, () => standing)!;
  assert.ok(auth.capabilities.size > 0);
  standing = false;
  assert.equal(auth.capabilities.size, 0, "a retired registration kept its capabilities");
  assert.equal(peers.principalContext(peer, () => false), null);
});
