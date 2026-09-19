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
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import type { ProtocolLimits, ResolvedAgentSpec } from "../implementation/contracts.js";
import { Broker, type PrincipalHostChannel } from "../src/broker.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { BrokerChannel } from "../src/protocol/channel.js";
import { credentialMatches, isPrincipalCredential, sessionHandleMatches } from "../src/protocol/principal-credential.js";
import { StoreError } from "../src/domain/errors.js";
import { encodeHostMessage } from "../src/protocol/host-channel.js";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir } from "../src/tui/session.js";
import { provisionSociety } from "../src/runtime/provision.js";
import { processIdentity, type ProcessIdentity } from "../src/broker/process-ancestry.js";
import { PrincipalDelivery, principalHostBroker, type DeliverySession } from "../src/runtime/principal-delivery.js";
import type { PiEvent } from "../src/runtime/pi-rpc.js";

const LIMITS: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
  idleStreamSeconds: 30, receiptWaitSeconds: 30,
};

const PRINCIPAL_SPEC: ResolvedAgentSpec = {
  name: "principal", from: "a".repeat(40), brief: "Principal", profile: "p",
  capabilities: ["mail.send"], modelProfile: "m",
  resources: { memoryBytes: 1, tasks: 1, cpuQuotaPercent: 1, tmpBytes: 1, workspaceBytes: 1, stagingBytes: 1, checkTimeoutSeconds: 1 },
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
  refuse = (): void => { this.refusals += 1; };
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
  const units = new UnitsModule("demo",
    { node: process.execPath, libdir: "/opt/oma", state: root, society: "demo", agent: "" }, root);
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64, LIMITS.batchMaxMessages, LIMITS);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = new LifecycleModule(store, units,
    { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    () => null, mail);
  const channel = supervised ? host ?? new HostChannel(runRoot) : null;
  const broker = new Broker(store, mail, units, views, lifecycle, null, null,
    { stateRoot: root, runRoot, society: "demo", hasGoal: () => true }, LIMITS, undefined, channel ?? undefined);
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
        { society: "demo", provider: "pi", model: "current", workspaceBytes: 1024 * 1024, extensions: [] }, LIMITS),
      OMA_TEST_EXTENSION: pathToFileURL(join(process.cwd(), "dist/src/pi-extension.js")).href,
      OMA_TEST_SESSION_FILE: sessionFile,
      ...overrides,
    };
    // Exactly the private socket the product opens for its engine.
    const child = spawn(process.execPath, [ENGINE], {
      cwd: join(society.root, "principal", "private"), env, stdio: ["pipe", "pipe", "inherit", "pipe"],
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
    assert.equal(society.host!.register(newSessionHandle(), process.ppid), null);
    assert.equal(society.host!.refusals, 1);
    // Nor this process itself.
    assert.equal(society.host!.register(newSessionHandle(), process.pid), null);
    assert.equal(society.host!.refusals, 2);
    // A malformed handle is refused before anything is minted.
    assert.equal(society.host!.register("nothex", process.pid), null);
    assert.equal(society.host!.grants.length, 0);
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

test("T114: every OMA tool works from the engine, through the real CLI it starts", async () => {
  await withEngine("oma-principal-tools-", async (society, engine) => {
    const status = await engine.tool("oma_status");
    assert.ok(status.ok, `oma_status failed: ${status.error}`);
    assert.match(status.text!, /principal/);

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
    const acked = await engine.tool("oma_mail_ack", { messageId });
    assert.ok(acked.ok, `oma_mail_ack failed: ${acked.error}`);
  });
});

test("T114: the CLI receives the credential on its own socket and never in its environment", async () => {
  await withEngine("oma-principal-probe-", async (_society, engine, grant) => {
    // The tool starts this probe exactly as it starts the CLI.
    const answer = await engine.tool("oma_status");
    assert.ok(answer.ok, `the probe did not run: ${answer.error}`);
    const probe = JSON.parse(answer.text!) as {
      environ: string;
      channel: { socket: boolean; fifo: boolean; file: boolean; reopened: string; line: string } | null;
    };
    assert.ok(!probe.environ.includes(grant.credential), "the credential is in the CLI's environment");
    assert.ok(!probe.environ.includes(grant.sessionHandle), "the session handle is in the CLI's environment");
    assert.match(probe.environ, /OMA_PRINCIPAL_CREDENTIAL_FD=3/);
    // Only what the tools build reaches the CLI; nothing inherited leaks.
    assert.doesNotMatch(probe.environ, /OMA_TEST_|OMA_HOST_CHANNEL|OMA_CLI_PATH/);
    assert.deepEqual({ ...probe.channel, line: undefined },
      { socket: true, fifo: false, file: false, reopened: "ENXIO", line: undefined });
    assert.equal(probe.channel!.line, `credential ${grant.credential} ${grant.sessionHandle}\n`);
  }, { OMA_CLI_PATH: PROBE });
});

test("T114: a Resident's tools start the CLI with no credential channel at all", async () => {
  await withEngine("oma-principal-resident-", async (_society, engine) => {
    const answer = await engine.tool("oma_status");
    const probe = JSON.parse(answer.text!) as { environ: string; channel: unknown };
    assert.equal(probe.channel, null, "a descriptor 3 was opened for a caller with no session");
    assert.doesNotMatch(probe.environ, /OMA_PRINCIPAL/);
  }, { OMA_CLI_PATH: PROBE, OMA_HOST_CHANNEL: "" });
});

test("T114: a re-registered engine gets a new credential and the old one stops working", async () => {
  await withEngine("oma-principal-rotate-", async (society, engine, first) => {
    const second = society.host!.register(first.sessionHandle, engine.pid)!;
    assert.notEqual(second.credential, first.credential);
    engine.grant(second.credential, second.sessionHandle);
    // The engine picks up the replacement without restarting.
    const status = await engine.tool("oma_status");
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
    const status = await engine.tool("oma_status");
    assert.equal(status.ok, false, "a credential from a stopped broker was accepted");
    // Given this broker's, it works again.
    engine.grant(grant.credential, grant.sessionHandle);
    assert.ok((await engine.tool("oma_status")).ok);
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
    release: () => { if (owner === "delivery") owner = null; },
  };
}

test("T114 / PR-002: mail to the Principal is delivered into its live session and completed", async () => {
  await withEngine("oma-principal-deliver-", async (society, engine) => {
    // Mail for the Principal, sent through its own tool.
    assert.ok((await engine.tool("oma_mail_send", { to: ["principal"], subject: "for you", body: "delivered?", kind: "message" })).ok);
    assert.equal(wasPresented(society), false);

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
        import { BrokerChannel } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "dist/src/protocol/channel.js")).href)};
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
  const calls: string[] = [];
  const delivery = new PrincipalDelivery(
    { running: true, busy: true, onEvent: () => () => {}, deliver: async () => { calls.push("deliver"); }, release: () => { calls.push("release"); } },
    { prepare: async () => { calls.push("prepare"); return null; }, complete: async () => { calls.push("complete"); } },
    { stateRoot: "/nonexistent", frameBytes: LIMITS.frameBytes, acceptMs: 1000, retryAfterMs: 1000 },
  );
  assert.equal((await delivery.tick()).kind, "deferred");
  // It does not even prepare: a prepared batch it could not deliver would sit
  // in the broker for nothing.
  assert.deepEqual(calls, []);
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
function reservedSession(): {
  readonly session: PrincipalSession;
  readonly sent: Record<string, unknown>[];
  readonly lines: string[];
  readonly emit: (event: PiEvent) => void;
} {
  const sent: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const session = Object.create(PrincipalSession.prototype) as PrincipalSession;
  const state = session as unknown as {
    rpc: { send: (message: Record<string, unknown>) => Promise<void> };
    sink: { onLine: (line: string) => void; onBusy: (busy: boolean) => void; onEnd: (reason: string) => void };
    owner: "human" | "delivery" | null; waiting: string[]; unanswered: unknown;
    closed: boolean; sequence: number;
    observe: (event: PiEvent) => void;
  };
  state.rpc = { send: async message => { sent.push(message); } };
  state.sink = { onLine: line => lines.push(line), onBusy: () => {}, onEnd: () => {} };
  state.owner = null; state.waiting = []; state.unanswered = null;
  state.closed = false; state.sequence = 0;
  return { session, sent, lines, emit: event => { state.observe(event); } };
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
  const submitted = session.submit("what is the plan?");
  assert.equal(session.busy, true, "the session was still idle after a prompt was submitted");
  await submitted;
  await assert.rejects(session.deliver("b-00000000-0000-4000-8000-000000000000"),
    (error: unknown) => error instanceof StoreError && error.code === "BATCH_CONFLICT");
  assert.equal(sent.length, 1, "a delivery was written into a session the Human had claimed");
});

test("T114 / PR-002: a Human prompt typed during a delivery waits in the host and is not folded into the delivery's run", async () => {
  const { session, sent, emit } = reservedSession();
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  emit(accept("b-00000000-0000-4000-8000-000000000000"));
  assert.equal(session.busy, true);

  // The Human is never made to wait for mail, and never has to retype -- but
  // the prompt does not reach the engine yet. Pi drains its own follow-up
  // queue inside the run it is already performing and reports one
  // `agent_settled` for the whole of it, so a prompt queued there would have
  // run inside the delivery's run and the boundary the extension records for
  // that run would have covered the Human's turn too.
  await session.submit("meanwhile, about the release");
  assert.equal(sent.length, 1, "the Human's prompt was written into the delivery's own run");

  // The delivery's run ends. That one settle ends the whole run, and the
  // Human's prompt is written now -- as a prompt of its own, with no
  // streaming behaviour, because the engine is idle again.
  emit(settled);
  assert.equal(sent.length, 2, "the Human's prompt was never written after the delivery settled");
  assert.deepEqual(sent[1], { id: "oma-tui-1", type: "prompt", message: "meanwhile, about the release" });
  // And the session is the Human's until that prompt's own run settles.
  assert.equal(session.busy, true, "the session was released while the Human's prompt was still running");
  await assert.rejects(session.deliver("b-00000000-0000-4000-8000-000000000001"),
    (error: unknown) => error instanceof StoreError && error.code === "BATCH_CONFLICT");

  emit(accept("oma-tui-1"));
  emit(settled);
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
  for (const text of ["first", "second", "third"]) await session.submit(text);
  assert.equal(sent.length, 1, "prompts reached the engine while the delivery owned the session");

  const written: string[] = [];
  for (let run = 0; run < 3; run += 1) {
    emit(settled);
    const last = sent.at(-1)!;
    written.push(String(last.message));
    emit(accept(String(last.id)));
    assert.equal(session.busy, true, `the session was free with ${2 - run} prompts still waiting`);
  }
  emit(settled);
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
  const { session, sent, lines, emit } = reservedSession();
  await session.submit("hello");
  assert.equal(session.busy, true);
  emit({ type: "response", id: String(sent[0]!.id), command: "prompt", success: false, error: "no model selected" });
  assert.equal(session.busy, false, "a refused prompt left the session claimed");
  assert.ok(lines.some(line => line.includes("no model selected")), lines.join(" | "));
  // And the session works afterwards.
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  assert.equal(sent.length, 2);
});

test("T114 / PR-002: a refused delivery command gives the session back and lets the waiting Human through", async () => {
  const { session, sent, emit } = reservedSession();
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  await session.submit("while that runs");
  emit({ type: "response", id: "b-00000000-0000-4000-8000-000000000000", command: "prompt", success: false, error: "busy" });
  assert.equal(sent.length, 2, "the Human's waiting prompt was dropped with the refused delivery");
  assert.equal(sent[1]!.message, "while that runs");
  assert.equal(session.busy, true);
});

test("T114 / PR-002: a response for a prompt the session has moved on from changes nothing", async () => {
  const { session, sent, lines, emit } = reservedSession();
  await session.submit("hello");
  emit(settled);
  assert.equal(session.busy, false);
  // A late refusal for the prompt whose run already ended must not take a
  // claim away from whatever owns the session now.
  await session.deliver("b-00000000-0000-4000-8000-000000000000");
  emit({ type: "response", id: String(sent[0]!.id), command: "prompt", success: false, error: "stale" });
  assert.equal(session.busy, true, "a stale response released a delivery's claim");
  assert.equal(lines.length, 0, lines.join(" | "));
});

/** A stand-in session for the delivery owner: it records the claim and lets
 * the test emit exactly the events an engine would. */
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
      release: () => { claimed = false; claims.push("release"); },
    },
  };
}

const ONE_BATCH = {
  id: "b-00000000-0000-4000-8000-000000000000", agent: "principal" as const, incarnation: 0,
  messageIds: [], deliveryMode: "followUp" as const, notice: "", sessionPath: null, indexPath: "/inbox.md" as const,
};

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
    { stateRoot: "/nonexistent", frameBytes: LIMITS.frameBytes, acceptMs: 60_000, retryAfterMs: 1000 });
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
    { stateRoot: "/nonexistent", frameBytes: LIMITS.frameBytes, acceptMs: 60_000, retryAfterMs: 1000 });
  const outcome = delivery.tick();
  await new Promise(resolve => setImmediate(resolve));
  emit({ type: "response", id: ONE_BATCH.id, command: "prompt", success: true });
  emit(failedMessage("error"));
  emit({ type: "agent_settled" });
  const result = await outcome;
  assert.equal(result.kind, "failed");
  assert.match((result as { reason: string }).reason, /provider failed/);
});

test("T114 / PR-002: a delivery the engine never answers gives the session back", async () => {
  // The engine accepts nothing and reports nothing -- no turn starts, so no
  // turn settles, and the session is never released by an event. Without the
  // owner giving its claim back here, the Human and every later batch would be
  // locked out of a session that is in fact idle.
  const claims: string[] = [];
  let claimed = false;
  const session: DeliverySession = {
    running: true,
    get busy() { return claimed; },
    onEvent: () => () => {},
    deliver: async () => { claimed = true; claims.push("deliver"); },
    release: () => { claimed = false; claims.push("release"); },
  };
  const batch = {
    id: "b-00000000-0000-4000-8000-000000000000", agent: "principal" as const, incarnation: 0,
    messageIds: [], deliveryMode: "followUp" as const, notice: "", sessionPath: null, indexPath: "/inbox.md" as const,
  };
  let now = 1_000;
  const delivery = new PrincipalDelivery(session, {
    prepare: async () => batch, complete: async () => { claims.push("complete"); },
  }, { stateRoot: "/nonexistent", frameBytes: LIMITS.frameBytes, acceptMs: 10, retryAfterMs: 1000, now: () => (now += 20) });
  const outcome = await delivery.tick();
  assert.equal(outcome.kind, "failed");
  assert.match((outcome as { reason: string }).reason, /accept/);
  assert.deepEqual(claims, ["deliver", "release"], "the session was left claimed by a delivery nobody answered");
  assert.equal(session.busy, false);
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

test("T114: stopping the broker releases the supervision channel it was given", async () => {
  const society = await startSociety("oma-principal-channel-close-");
  assert.equal(society.host!.closed, false);
  await society.broker.drainAndClose();
  // A broker told to stop on its own must not stay alive holding a descriptor
  // whose other end is a host that is still running.
  assert.equal(society.host!.closed, true, "the broker kept the supervision channel after it stopped");
  rmSync(society.root, { recursive: true, force: true });
});
