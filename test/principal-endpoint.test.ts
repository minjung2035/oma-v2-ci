/** T114 / TUI-004, AUTH-003, IPC-011: the Principal's path into its society.
 *
 * The Principal is the one agent with no systemd scope, so the checks that
 * authorise a Resident cannot authorise it. These tests run the real endpoint
 * over a real unix socket: what the broker publishes, what the model-facing CLI
 * transport presents, and what each of them refuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ProtocolLimits } from "../implementation/contracts.js";
import { Broker } from "../src/broker.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { BrokerChannel } from "../src/protocol/channel.js";
import {
  PRINCIPAL_CREDENTIAL_ENV, credentialMatches, isPrincipalCredential, principalCredentialPath,
} from "../src/protocol/principal-credential.js";
import { newSessionHandle, principalEnvironment } from "../src/tui/session.js";
import { provisionSociety } from "../src/runtime/provision.js";

const LIMITS: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
  idleStreamSeconds: 30, receiptWaitSeconds: 30,
};

const PRINCIPAL_SPEC = {
  name: "principal", from: "a".repeat(40), brief: "Principal", profile: "p",
  capabilities: [], modelProfile: "m",
  resources: { memoryBytes: 1, tasks: 1, cpuQuotaPercent: 1, tmpBytes: 1, workspaceBytes: 1, stagingBytes: 1, checkTimeoutSeconds: 1 },
};

interface Society {
  readonly broker: Broker;
  readonly store: Store;
  readonly root: string;
  readonly runRoot: string;
}

async function startSociety(prefix: string): Promise<Society> {
  const root = mkdtempSync(join(tmpdir(), prefix));
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
  await broker.start();
  return { broker, store, root, runRoot };
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

test("T114: a running broker publishes one private credential and withdraws it when it stops", async () => {
  const society = await startSociety("oma-principal-cred-");
  const path = principalCredentialPath(society.runRoot);
  try {
    assert.ok(existsSync(path), "the broker publishes a credential for the session it will serve");
    const credential = readFileSync(path, "utf8").trim();
    assert.ok(isPrincipalCredential(credential), "the published value is a credential");
    // Only the owning user can read it: it is the Principal's authority, and a
    // sandbox never sees the run directory it lives in.
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.ok(existsSync(join(society.runRoot, "principal.sock")));
  } finally {
    await society.broker.drainAndClose();
    assert.equal(existsSync(path), false, "a stopped broker leaves no credential behind");
    rmSync(society.root, { recursive: true, force: true });
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
  const credential = readFileSync(principalCredentialPath(society.runRoot), "utf8").trim();
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
      sessionHandle: newSessionHandle(), credential,
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

test("T114: a society keeps one Principal session, not two sharing its authority", async () => {
  const society = await startSociety("oma-principal-single-");
  const socket = join(society.runRoot, "principal.sock");
  const credential = readFileSync(principalCredentialPath(society.runRoot), "utf8").trim();
  const first = channel();
  const second = channel();
  try {
    await first.connect(socket);
    await first.call("principal.attach", { sessionHandle: "1".repeat(32), credential });
    // A second session holding the same file-published credential is still not
    // the session this broker admitted.
    await second.connect(socket);
    assert.equal(await failureOf(second.call("principal.attach", {
      sessionHandle: "2".repeat(32), credential,
    })), "AUTH_FAILED");
    assert.notEqual(await failureOf(second.call("status.get", {})), "no failure");
    // The session that did attach keeps working; refusing the other one is not
    // a reason to drop the first.
    await first.call("status.get", {});
  } finally {
    first.close(); second.close();
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
  assert.equal(principalCredentialPath("/run/x"), "/run/x/principal.cred");
  assert.equal(principalCredentialPath("/run/x/"), "/run/x/principal.cred");
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

test("T114: the model-facing CLI reaches the society only with its session's credential", async () => {
  const society = await startSociety("oma-principal-cli-");
  const socket = join(society.runRoot, "principal.sock");
  const credential = readFileSync(principalCredentialPath(society.runRoot), "utf8").trim();
  const base = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: society.root,
    OMA_SOCKET: socket,
    OMA_FRAME_BYTES: String(LIMITS.frameBytes),
    OMA_PRINCIPAL_SESSION: newSessionHandle(),
  };
  const cli = join(process.cwd(), "dist/src/cli.js");
  // Asynchronously: the broker being tested runs in this process, so a
  // synchronous child would block the loop that has to answer it.
  const run = (env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise(resolve => {
      const child = spawn(process.execPath, [cli, "status"], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", chunk => { stdout += String(chunk); });
      child.stderr.on("data", chunk => { stderr += String(chunk); });
      child.once("close", status => resolve({ status, stdout, stderr }));
    });
  try {
    // This is the exact command the Principal's OMA tools run. With the
    // credential its environment carries, it speaks for the Principal.
    const attached = await run({ ...base, [PRINCIPAL_CREDENTIAL_ENV]: credential });
    assert.equal(attached.status, 0, `the Principal's CLI failed: ${attached.stderr}`);
    assert.match(attached.stdout, /principal/);
    // The same command from an environment without the credential -- anything
    // that is not the session the host started -- reaches nothing.
    const bare = await run(base);
    assert.notEqual(bare.status, 0, "a caller with no credential was served");
    // A credential of the right shape that this broker did not mint is refused
    // exactly like none at all.
    const forged = await run({ ...base, [PRINCIPAL_CREDENTIAL_ENV]: "0".repeat(64) });
    assert.notEqual(forged.status, 0, "a forged credential was served");
  } finally {
    await stopSociety(society);
  }
});
