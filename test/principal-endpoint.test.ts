/** T114 / TUI-004, AUTH-003, IPC-011: the Principal's path into its society.
 *
 * The Principal is the one agent with no systemd scope, so the checks that
 * authorise a Resident cannot authorise it. These tests run the real endpoint
 * over a real unix socket: what the broker publishes, what the model-facing CLI
 * transport presents, and what each of them refuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ProtocolLimits, ResolvedAgentSpec } from "../implementation/contracts.js";
import { Broker } from "../src/broker.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { BrokerChannel } from "../src/protocol/channel.js";
import {
  PRINCIPAL_CREDENTIAL_ENV, PRINCIPAL_SESSION_ENV, credentialMatches, isPrincipalCredential,
  sessionHandleMatches,
} from "../src/protocol/principal-credential.js";
import { newSessionHandle, principalEnvironment } from "../src/tui/session.js";
import { cliEnvironment, registerOmaTools } from "../src/pi-extension.js";
import { provisionSociety } from "../src/runtime/provision.js";

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

interface Society {
  readonly broker: Broker;
  readonly store: Store;
  readonly root: string;
  readonly runRoot: string;
  /** What the broker published on the host's own channel, never a file. */
  readonly credential: string | null;
  readonly sessionHandle: string;
}

async function startSociety(prefix: string, handle = "a".repeat(32)): Promise<Society> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runRoot = join(root, "run");
  // Provisioned exactly as the product provisions it before starting a broker.
  // A harness that made only the directories it happened to need would hide a
  // missing one, which is how the engine's own working directory went missing.
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
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = new LifecycleModule(store, units,
    { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    () => null, mail);
  let published: string | null = null;
  const broker = new Broker(store, mail, units, views, lifecycle, null, null,
    { stateRoot: root, runRoot, society: "demo", hasGoal: () => true }, LIMITS, undefined,
    { sessionHandle: handle, publish: credential => { published = credential; } });
  await broker.start();
  // The publication happens once the endpoint is listening; give that
  // continuation its turn before reporting what the host received.
  await new Promise<void>(resolve => { setImmediate(resolve); });
  return { broker, store, root, runRoot, credential: published, sessionHandle: handle };
}

async function stopSociety(society: Society): Promise<void> {
  await society.broker.drainAndClose();
  rmSync(society.root, { recursive: true, force: true });
}

function channel(): BrokerChannel {
  return new BrokerChannel({ frameBytes: LIMITS.frameBytes, idleStreamSeconds: 5, receiptWaitSeconds: 5 });
}

/** The refusal code as the caller sees it. A refused request comes back as a
 * failed reply on the wire, not as a thrown transport error, and the broker
 * answers with the code alone: every way of failing to be the Principal looks
 * the same from outside, which is why these tests tell them apart by what the
 * connection can do afterwards rather than by the text. */
async function failureOf(call: Promise<unknown>): Promise<string> {
  try {
    const reply = await call;
    if (reply !== null && typeof reply === "object" && (reply as { ok?: unknown }).ok === false)
      return (reply as { error: { code: string } }).error.code;
    return "no failure";
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}

test("T114: the credential reaches the registering host and is written nowhere else", async () => {
  const society = await startSociety("oma-principal-cred-");
  try {
    assert.ok(isPrincipalCredential(society.credential), "the registering host received no credential");
    assert.ok(existsSync(join(society.runRoot, "principal.sock")));
    // PR-001 asks for a host-only channel. A file under the run directory is
    // not one: its path is derivable and every process of this user can read
    // it, which is exactly the caller the Principal's authority must exclude.
    for (const name of readdirSync(society.runRoot)) {
      const path = join(society.runRoot, name);
      if (!statSync(path).isFile()) continue;
      assert.doesNotMatch(readFileSync(path).toString("utf8"), /[0-9a-f]{64}/,
        `${name} under the run directory contains something credential-shaped`);
    }
  } finally { await stopSociety(society); }
});

test("T114: a broker nobody registered a session with opens no Principal endpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-principal-unregistered-"));
  const runRoot = join(root, "run");
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
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = new LifecycleModule(store, units,
    { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    () => null, mail);
  const broker = new Broker(store, mail, units, views, lifecycle, null, null,
    { stateRoot: root, runRoot, society: "demo", hasGoal: () => true }, LIMITS);
  try {
    await broker.start();
    // Nothing to attach to is a smaller surface than an endpoint with no
    // legitimate caller, so a broker started by systemd or by hand opens none.
    assert.equal(existsSync(join(runRoot, "principal.sock")), false);
  } finally {
    await broker.drainAndClose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T114: the endpoint refuses every request until the session attaches", async () => {
  const society = await startSociety("oma-principal-unattached-");
  const socket = join(society.runRoot, "principal.sock");
  const client = channel();
  try {
    await client.connect(socket);
    assert.equal(await failureOf(client.call("status.get", {})), "AUTH_FAILED");
    // A refused connection is finished, so the next request is not served
    // either -- the endpoint never becomes attached by being asked twice.
    assert.notEqual(await failureOf(client.call("status.get", {})), "no failure");
  } finally {
    client.close();
    await stopSociety(society);
  }
});

test("T114: only this broker's credential attaches, and then the society answers", async () => {
  const society = await startSociety("oma-principal-attach-");
  const socket = join(society.runRoot, "principal.sock");
  const credential = society.credential!;
  const wrong = channel();
  const right = channel();
  try {
    await wrong.connect(socket);
    assert.equal(await failureOf(wrong.call("principal.attach", {
      sessionHandle: newSessionHandle(), credential: "f".repeat(64),
    })), "AUTH_FAILED");
    // A refused attach ends that connection; it is never left half-admitted.
    assert.notEqual(await failureOf(wrong.call("status.get", {})), "no failure");

    await right.connect(socket);
    const attached = await right.call("principal.attach", {
      sessionHandle: society.sessionHandle, credential,
    });
    assert.ok(attached.ok, "the session's own credential did not attach");
    assert.equal((attached.result as { actor: string }).actor, "principal");
    // The same connection now speaks as the Principal, through the ordinary
    // public method surface -- no new method and no widened authority.
    const status = await right.call("status.get", {});
    assert.ok(status.ok, "an attached Principal could not read status");
    const agents = (status.result as { agents: { agent: string }[] }).agents;
    assert.ok(agents.some(row => row.agent === "principal"));
  } finally {
    wrong.close(); right.close();
    await stopSociety(society);
  }
});

test("T114: the session the host registered is the Principal, not whoever attaches first", async () => {
  const society = await startSociety("oma-principal-single-", "1".repeat(32));
  const socket = join(society.runRoot, "principal.sock");
  const credential = society.credential!;
  const other = channel();
  const owner = channel();
  try {
    // A caller holding this run's credential but naming another session is
    // refused even though nothing has attached yet: which session owns the
    // society was decided by the host before this broker started, so there is
    // no race for a first holder to win.
    await other.connect(socket);
    assert.equal(await failureOf(other.call("principal.attach", {
      sessionHandle: "2".repeat(32), credential,
    })), "ATTACH_CONFLICT");
    assert.notEqual(await failureOf(other.call("status.get", {})), "no failure");
    // The registered session still attaches afterwards; a refused stranger is
    // not a reason to lock the owner out.
    await owner.connect(socket);
    const attached = await owner.call("principal.attach", { sessionHandle: society.sessionHandle, credential });
    assert.ok(attached.ok, "the registered session could not attach");
    await owner.call("status.get", {});
  } finally {
    other.close(); owner.close();
    await stopSociety(society);
  }
});

test("T114: the credential comparison is fixed-shape and does not stop early", () => {
  const value = "a".repeat(64);
  assert.equal(credentialMatches(value, value), true);
  assert.equal(credentialMatches(`b${value.slice(1)}`, value), false);
  assert.equal(credentialMatches(`${value.slice(0, 63)}b`, value), false);
  for (const bad of ["", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), null, 1, {}])
    assert.equal(credentialMatches(bad, value), false, `accepted ${String(bad)}`);
  assert.equal(credentialMatches(value, "not a credential"), false);

});

test("T114: the Principal's engine is told everything the trusted extension needs", () => {
  const profile = {
    society: "demo", provider: "pi", model: "current", workspaceBytes: 4096,
    extensions: [] as never[],
  };
  const paths = { stateRoot: "/state", runRoot: "/run", libdir: "/opt/oma" };
  const handle = newSessionHandle();
  const env = principalEnvironment(paths, profile, LIMITS, { credential: "c".repeat(64), sessionHandle: handle });
  // Exactly the entries the extension reads before it will register OMA's tools
  // and allow a write; a missing one is a Pi with no way into the society.
  for (const name of ["OMA_CLI_PATH", "OMA_AGENT_HOME", "OMA_MAIL_ARCHIVE", "OMA_SOCKET"])
    assert.ok(env[name]?.startsWith("/"), `${name} is not an absolute path`);
  assert.equal(env.OMA_WORKSPACE_BYTES, "4096");
  assert.equal(env.OMA_FRAME_BYTES, String(LIMITS.frameBytes));
  assert.equal(env.OMA_MAIL_BYTES, String(LIMITS.mailBodyBytes));
  assert.equal(env.OMA_ACTOR, "principal");
  assert.equal(env.OMA_SOCIETY, "demo");
  assert.equal(env.OMA_SOCKET, "/run/principal.sock");
  assert.equal(env.OMA_PRINCIPAL_SESSION, handle);
  assert.equal(env[PRINCIPAL_CREDENTIAL_ENV], "c".repeat(64));
  // The delivery command has no runner preparing batches for the Principal, so
  // it stays unavailable rather than being made to look wired.
  assert.equal(env.OMA_BATCH_VIEW, undefined);
  assert.equal(env.OMA_BATCH_MAX_MESSAGES, undefined);
  // Two sessions never share a handle.
  assert.notEqual(newSessionHandle(), newSessionHandle());
  // Without a broker there is no credential, and nothing pretends otherwise.
  const offline = principalEnvironment(paths, profile, LIMITS, { credential: null, sessionHandle: handle });
  assert.equal(PRINCIPAL_CREDENTIAL_ENV in offline, false);
});

test("T114: provisioning creates the directory the Principal's engine runs in", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-principal-provision-"));
  try {
    // A process cannot be started in a directory that does not exist, so the
    // private space is part of the tree, not something the first run discovers.
    const report = provisionSociety(root);
    assert.ok(report.created.includes(join("principal", "private")));
    assert.ok(existsSync(join(root, "principal", "private", "sessions")));
    assert.equal(statSync(join(root, "principal", "private")).mode & 0o777, 0o700);
    // Idempotent: a second run creates nothing and does not fail.
    assert.equal(provisionSociety(root).created.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T114: the Principal's own OMA tool reaches the society through the real extension", async () => {
  const society = await startSociety("oma-principal-tool-");
  const previous = { ...process.env };
  try {
    // Exactly what the product puts in the engine's environment, from the same
    // function `oma` uses -- no hand-written subset.
    Object.assign(process.env, principalEnvironment(
      { stateRoot: society.root, runRoot: society.runRoot, libdir: process.cwd() },
      { society: "demo", provider: "pi", model: "current", workspaceBytes: 4096, extensions: [] },
      LIMITS,
      { credential: society.credential, sessionHandle: society.sessionHandle },
    ));
    // The registered tool is driven, not a command assembled by the test. The
    // engine's `exec` is the only stand-in, and it really starts the process,
    // so the environment the tool built is the environment the CLI receives.
    // A test that spawned the CLI itself would pass while the tool was broken,
    // because the tool starts it through `env -i` and can only pass on what it
    // remembered to list.
    const tools = new Map<string, (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>();
    const pi = {
      registerTool: (tool: { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }) => {
        tools.set(tool.name, (id, params) => tool.execute(id, params));
      },
      exec: (executable: string, argv: readonly string[], options: { cwd: string }) =>
        new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
          const child = spawn(executable, [...argv], { cwd: options.cwd, env: {}, stdio: ["ignore", "pipe", "pipe"] });
          let stdout = ""; let stderr = "";
          child.stdout.on("data", chunk => { stdout += String(chunk); });
          child.stderr.on("data", chunk => { stderr += String(chunk); });
          child.once("close", code => resolve({ code: code ?? 1, stdout, stderr }));
        }),
    };
    // SAFETY: the tool registry only uses the two members supplied above.
    registerOmaTools(pi as unknown as Parameters<typeof registerOmaTools>[0], society.root);
    const status = tools.get("oma_status");
    assert.ok(status, "the Principal's environment did not register OMA's tools");
    const answer = await status("t-1", {});
    assert.match(answer.content[0]!.text, /principal/);

    // Without the credential the same tool, built the same way, reaches
    // nothing: authority comes from the session, never from being the CLI.
    delete process.env[PRINCIPAL_CREDENTIAL_ENV];
    const bare = new Map<string, (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>();
    registerOmaTools({ ...pi, registerTool: (tool: { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }) => {
      bare.set(tool.name, (id, params) => tool.execute(id, params));
    } } as unknown as Parameters<typeof registerOmaTools>[0], society.root);
    await assert.rejects(bare.get("oma_status")!("t-2", {}));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await stopSociety(society);
  }
});

test("T114: the environment the tools build carries what the CLI needs to attach", () => {
  const previous = { ...process.env };
  try {
    process.env[PRINCIPAL_CREDENTIAL_ENV] = "c".repeat(64);
    process.env[PRINCIPAL_SESSION_ENV] = "d".repeat(32);
    process.env.OMA_FRAME_BYTES = "65536";
    const entries = cliEnvironment("/home/agent", "/run/principal.sock");
    // `env -i` clears everything, so an entry absent from this list is absent
    // from the CLI. These three are what the attach handshake and the frame
    // bound are made of.
    assert.ok(entries.includes(`${PRINCIPAL_CREDENTIAL_ENV}=${"c".repeat(64)}`));
    assert.ok(entries.includes(`${PRINCIPAL_SESSION_ENV}=${"d".repeat(32)}`));
    assert.ok(entries.includes("OMA_FRAME_BYTES=65536"));
    assert.ok(entries.includes("HOME=/home/agent"));
    assert.ok(entries.includes("OMA_SOCKET=/run/principal.sock"));

    // A Resident has none of them, and its command is unchanged: nothing is
    // invented for a caller that has no session.
    delete process.env[PRINCIPAL_CREDENTIAL_ENV];
    delete process.env[PRINCIPAL_SESSION_ENV];
    const resident = cliEnvironment("/w/home", "/run/oma-control.sock");
    for (const entry of resident)
      assert.doesNotMatch(entry, /OMA_PRINCIPAL/, `a Resident was given ${entry}`);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

/** Registers the real tools against a real process boundary.
 *
 * The engine's `exec` is the only stand-in and it genuinely starts the child,
 * so whatever the tools failed to put in the command is missing from the
 * process too. Anything less than this -- a test that builds the command
 * itself, or one that passes the environment straight to the CLI -- cannot see
 * a tool that forgot to forward something, which is exactly how the Principal
 * shipped unable to authenticate.
 */
function toolsFor(society: Society, environment: Record<string, string>): {
  readonly tools: Map<string, (params: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>;
  readonly commands: string[][];
} {
  const tools = new Map<string, (params: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>();
  const commands: string[][] = [];
  const previous = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith("OMA_")) delete process.env[key];
  Object.assign(process.env, environment);
  // A value no part of OMA put there. `env -i` must keep it out of the child.
  process.env.OMA_UNRELATED_SECRET = "must-not-travel";
  process.env.PROVIDER_API_KEY = "must-not-travel";
  try {
    const pi = {
      registerTool: (tool: { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }) => {
        tools.set(tool.name, params => tool.execute(`t-${tools.size}`, params));
      },
      exec: (executable: string, argv: readonly string[], options: { cwd: string }) => {
        commands.push([executable, ...argv]);
        return new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
          const child = spawn(executable, [...argv], { cwd: options.cwd, env: {}, stdio: ["ignore", "pipe", "pipe"] });
          let stdout = ""; let stderr = "";
          child.stdout.on("data", chunk => { stdout += String(chunk); });
          child.stderr.on("data", chunk => { stderr += String(chunk); });
          child.once("close", code => resolve({ code: code ?? 1, stdout, stderr }));
        });
      },
    };
    // SAFETY: the registry uses only the two members supplied above.
    registerOmaTools(pi as unknown as Parameters<typeof registerOmaTools>[0], society.root);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  return { tools, commands };
}

function principalEnvironmentFor(society: Society): Record<string, string> {
  return principalEnvironment(
    { stateRoot: society.root, runRoot: society.runRoot, libdir: process.cwd() },
    { society: "demo", provider: "pi", model: "current", workspaceBytes: 4096, extensions: [] },
    LIMITS,
    { credential: society.credential, sessionHandle: society.sessionHandle },
  );
}

test("T114: every OMA tool the Principal owns works through the real command it builds", async () => {
  const society = await startSociety("oma-principal-tools-");
  try {
    const { tools, commands } = toolsFor(society, principalEnvironmentFor(society));
    for (const name of ["oma_status", "oma_mail_send", "oma_mail_ack", "oma_mail_read"])
      assert.ok(tools.has(name), `${name} did not register`);

    const status = await tools.get("oma_status")!({});
    assert.match(status.content[0]!.text, /principal/);

    const sent = await tools.get("oma_mail_send")!({
      to: ["principal"], subject: "to myself", body: "evidence", kind: "message",
    });
    assert.match(sent.content[0]!.text, /\S/, "send returned nothing");

    // The whole round trip, through the tools the model actually holds: the
    // message that was sent is in the immutable archive, reads back with its
    // body, and can be acknowledged. Anything short of this leaves three of the
    // four tools untried on the path that broke.
    const archive = join(society.root, "mail", "archive", "cur");
    const names = readdirSync(archive);
    assert.equal(names.length, 1, `the archive holds ${names.length} messages`);
    const messageId = names[0]!.replace(/:2,$/, "");
    const read = await tools.get("oma_mail_read")!({ messageId });
    assert.match(read.content[0]!.text, /evidence/, "the message did not read back");
    assert.match(read.content[0]!.text, /to myself/, "the subject did not read back");
    // The canonical path spelling the delivery notice uses is accepted too.
    const byPath = await tools.get("oma_mail_read")!({ messageId: `/mail/archive/cur/${messageId}:2,` });
    assert.equal(byPath.content[0]!.text, read.content[0]!.text);
    const acked = await tools.get("oma_mail_ack")!({ messageId });
    assert.match(acked.content[0]!.text, /\S/, "ack returned nothing");

    // The command really did run through `env -i`, and nothing outside the
    // list the tools build travelled with it.
    assert.ok(commands.length >= 2);
    for (const command of commands) {
      assert.equal(command[0], "/usr/bin/env");
      assert.equal(command[1], "-i");
      for (const entry of command.slice(2)) {
        if (!entry.includes("=")) break;
        assert.doesNotMatch(entry, /must-not-travel/, `the child was given ${entry}`);
      }
      assert.ok(command.some(entry => entry.startsWith(`${PRINCIPAL_CREDENTIAL_ENV}=`)),
        "the command carried no credential");
      assert.ok(command.some(entry => entry.startsWith(`${PRINCIPAL_SESSION_ENV}=`)),
        "the command carried no session handle");
      assert.ok(command.some(entry => entry.startsWith("OMA_FRAME_BYTES=")),
        "the command carried no frame bound");
    }
  } finally { await stopSociety(society); }
});

test("T114: each entry the Principal's environment carries is one the path actually needs", async () => {
  const society = await startSociety("oma-principal-envmatrix-");
  try {
    const complete = principalEnvironmentFor(society);
    // Without these the trusted extension registers no OMA tools at all: the
    // engine would come up looking healthy and owning nothing.
    for (const name of ["OMA_CLI_PATH", "OMA_AGENT_HOME", "OMA_MAIL_ARCHIVE", "OMA_SOCKET"]) {
      const reduced = { ...complete };
      delete reduced[name];
      const { tools } = toolsFor(society, reduced);
      assert.equal(tools.size, 0, `the tools registered without ${name}`);
    }
    // Without either half of the attach handshake the tools register but every
    // call that reaches the broker is refused -- the failure this audit found.
    for (const name of [PRINCIPAL_CREDENTIAL_ENV, PRINCIPAL_SESSION_ENV]) {
      const reduced = { ...complete };
      delete reduced[name];
      const { tools } = toolsFor(society, reduced);
      assert.ok(tools.has("oma_status"), `${name} should not gate registration`);
      await assert.rejects(tools.get("oma_status")!({}), `a call succeeded without ${name}`);
    }
    // And with everything, it works: the matrix above is not vacuous.
    const { tools } = toolsFor(society, complete);
    await assert.doesNotReject(tools.get("oma_status")!({}));
  } finally { await stopSociety(society); }
});

test("T114: a credential from an earlier broker run authorises nothing", async () => {
  const first = await startSociety("oma-principal-rotate-a-");
  const stale = first.credential!;
  await stopSociety(first);
  const second = await startSociety("oma-principal-rotate-b-");
  try {
    assert.notEqual(second.credential, stale, "a restarted broker reused its credential");
    const client = channel();
    try {
      await client.connect(join(second.runRoot, "principal.sock"));
      assert.equal(await failureOf(client.call("principal.attach", {
        sessionHandle: second.sessionHandle, credential: stale,
      })), "AUTH_FAILED");
    } finally { client.close(); }
  } finally { await stopSociety(second); }
});

test("T114: the session handle is the second half of the secret and is compared like one", () => {
  const handle = "a".repeat(32);
  assert.equal(sessionHandleMatches(handle, handle), true);
  assert.equal(sessionHandleMatches(`b${handle.slice(1)}`, handle), false);
  assert.equal(sessionHandleMatches(`${handle.slice(0, 31)}b`, handle), false);
  for (const bad of ["", "A".repeat(32), "a".repeat(31), "a".repeat(33), "g".repeat(32), null, 1, {}, handle.toUpperCase()])
    assert.equal(sessionHandleMatches(bad, handle), false, `accepted ${String(bad)}`);
  assert.equal(sessionHandleMatches(handle, "not a handle"), false);
  // A credential is not a handle and a handle is not a credential: the two
  // grammars do not overlap, so one can never be presented as the other.
  assert.equal(isPrincipalCredential(handle), false);
  assert.equal(sessionHandleMatches("c".repeat(64), "c".repeat(64)), false);
});
