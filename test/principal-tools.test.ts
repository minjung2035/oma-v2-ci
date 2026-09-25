/** AV11 -- the Principal's capabilities, reachable by its model through the
 * trusted extension, each value in its slot.
 *
 * The functional run with a real provider found a society that could not start:
 * the Principal holds agent.create, agent.manage.descendants, route.follow and
 * context.publish, Residents are created when asked for and none works before
 * the GOAL is published, but the Principal's model had only mail and status
 * tools and no shell. These run the real extension tools against the real CLI
 * and a socket peer that records every frame and refuses it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerOmaTools } from "../src/extension/mail-tools.js";
import { PRINCIPAL_TOOL_NAMES } from "../src/extension/principal-tools.js";
import { PrincipalChannel } from "../src/extension/principal-channel.js";
import { validFullOid, validTopicName } from "../src/extension/batch-view.js";
import { isValidFullOid, isValidTopicName } from "../src/domain/identifiers.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

interface Peer { readonly path: string; readonly frames: Record<string, unknown>[]; close(): Promise<void> }
async function peer(root: string): Promise<Peer> {
  const frames: Record<string, unknown>[] = [];
  const path = join(root, "control.sock");
  const server: Server = createServer(socket => {
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
        const length = pending.readUInt32BE(0);
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(pending.subarray(4, 4 + length).toString("utf8")) as Record<string, unknown>; }
        catch { pending = Buffer.alloc(0); break; }
        pending = pending.subarray(4 + length);
        frames.push(frame);
        const reply = Buffer.from(JSON.stringify({ v: 1, id: frame.id, ok: false,
          error: { code: "BROKER_UNAVAILABLE", message: "fixture", retry: "same-key" } }));
        const head = Buffer.alloc(4); head.writeUInt32BE(reply.length, 0);
        socket.write(Buffer.concat([head, reply]));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => { server.listen(path, resolve); });
  return { path, frames, close: () => new Promise<void>(resolve => { server.close(() => resolve()); }) };
}
const sent = (frames: readonly Record<string, unknown>[], method: string) =>
  frames.filter(frame => frame.method === method).map(frame => frame.params as Record<string, unknown>);

type Tool = { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };
function register(root: string, socket: string, principal: boolean, projectGit?: string): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const previous = { ...process.env };
  Object.assign(process.env, { OMA_CLI_PATH: CLI, OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: socket,
    ...(projectGit === undefined ? {} : { OMA_PROJECT_GIT: projectGit }) });
  const channel = PrincipalChannel.detached();
  // The Principal's engine is the one the product starts with its channel attached.
  if (principal) Object.defineProperty(channel, "attached", { value: true });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root, channel);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  return tools;
}
/** A bare canonical repository whose main is one commit. */
function canonical(root: string): { gitDir: string; main: string } {
  const git = (cwd: string, ...args: string[]) => {
    const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  const work = join(root, "seed");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  writeFileSync(join(work, "README.md"), "seed\n");
  git(work, "add", "README.md");
  git(work, "commit", "-qm", "seed");
  const gitDir = join(root, "project.git");
  git(root, "clone", "-q", "--bare", work, gitDir);
  return { gitDir, main: git(gitDir, "rev-parse", "refs/heads/main") };
}

test("AV11 / arch §8.3, §15.1, PR-004: the Principal's model reaches its capabilities through the extension, each value in its slot", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av11-"));
  const fixture = await peer(root);
  try {
    const { gitDir, main } = canonical(root);
    const tools = register(root, fixture.path, true, gitDir);
    for (const name of PRINCIPAL_TOOL_NAMES) assert.ok(tools.has(name), `${name} was not registered for the Principal`);
    const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
    mkdirSync(join(root, "shared"));
    writeFileSync(join(root, "shared", "GOAL.md"), "Check every feature.\n");
    const outside = mkdtempSync(join(tmpdir(), "oma-av11-outside-"));
    try {
      for (const [name, params] of [
        ["oma_agent_create", { name: "--file", brief: "b" }],
        ["oma_agent_create", { name: "worker", brief: "b", from: "main" }],
        ["oma_agent_create", { name: "worker", brief: "" }],
        ["oma_agent_lifecycle", { name: "worker", action: "retire" }],
        ["oma_agent_lifecycle", { name: "principal", action: "stop" }],
        ["oma_route", { topic: "--help", action: "follow" }],
        ["oma_route", { topic: "dev", action: "subscribe" }],
        ["oma_context_publish", { directory: outside, expect: "none" }],
        ["oma_context_publish", { directory: "../elsewhere", expect: "none" }],
        ["oma_context_publish", { directory: "shared", expect: "HEAD" }],
        ["oma_logs", { agent: "worker", since: "10" }],
        ["oma_logs", { agent: "--since", since: "10m" }],
      ] as const) {
        await assert.rejects(() => call(name, params), /is not valid/, `${name} ${JSON.stringify(params)} was not refused`);
      }
    } finally { rmSync(outside, { recursive: true, force: true }); }
    assert.equal(fixture.frames.length, 0, "a refused tool call reached the broker");

    // What the model meant reaches the broker as that method and those values.
    await assert.rejects(() => call("oma_agent_create", { name: "worker", brief: "Check the mail paths." }));
    assert.deepEqual(sent(fixture.frames, "agent.create"), [{ name: "worker", from: main, brief: "Check the mail paths." }],
      "the default base was not the society's main");
    const other = "c".repeat(40);
    await assert.rejects(() => call("oma_agent_create", { name: "helper", brief: "b", from: other }));
    assert.equal(sent(fixture.frames, "agent.create")[1]!.from, other);
    await assert.rejects(() => call("oma_agent_lifecycle", { name: "worker", action: "stop" }));
    assert.deepEqual(sent(fixture.frames, "agent.stop"), [{ agent: "worker" }]);
    await assert.rejects(() => call("oma_route", { topic: "dev", action: "follow" }));
    assert.deepEqual(sent(fixture.frames, "route.follow"), [{ topic: "dev" }]);
    await assert.rejects(() => call("oma_context_publish", { directory: "shared", expect: "none" }));
    const [published] = sent(fixture.frames, "context.publish");
    assert.equal(published!.expected, null);
    assert.deepEqual((published!.entries as { path: string }[]).map(entry => entry.path), ["GOAL.md"]);
    await assert.rejects(() => call("oma_logs", { agent: "worker", since: "10m" }));
    assert.deepEqual(sent(fixture.frames, "logs.read"), [{ agent: "worker", sinceSeconds: 600 }]);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("AV11 / T114: a Resident's engine, which has no credential channel, is not given the Principal's tools", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av11-resident-"));
  try {
    const tools = register(root, join(root, "control.sock"), false);
    for (const name of PRINCIPAL_TOOL_NAMES) assert.equal(tools.has(name), false, `${name} was registered for a Resident`);
    assert.ok(tools.has("oma_mail_send") && tools.has("oma_status"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AV11 / INV04: the extension's topic and full-id grammar is the wire grammar", () => {
  const samples = ["dev", "a", "a-b-9", "Dev", "-x", "--help", "", "a".repeat(64), "a".repeat(65), "topic/dev",
    "a".repeat(40), "A".repeat(40), "a".repeat(39), "a".repeat(41), "a".repeat(64), "g".repeat(40), "none", "main"];
  for (const sample of samples) {
    assert.equal(validTopicName(sample), isValidTopicName(sample), `topic ${JSON.stringify(sample)}`);
    assert.equal(validFullOid(sample), isValidFullOid(sample), `full id ${JSON.stringify(sample)}`);
  }
});

test("AV15 / BATCH-002, INV04: a tool takes the names OMA shows -- this society's RFC address, a message's file name -- as what they display", async () => {
  const { displayAddress } = await import("../src/mail/addresses.js");
  const { logicalFromDisplay } = await import("../src/extension/batch-view.js");
  // The mirror inverts the one owner of the display form, and nothing else.
  for (const logical of ["principal", "commons", "residents", "alice", "a-b-9", "topic/dev", "topic/a"])
    assert.equal(logicalFromDisplay(displayAddress(logical as never, "demo"), "demo"), logical, logical);
  for (const other of ["alice@other.oma.invalid", "alice@demo.oma.invalid.evil", "Alice@demo.oma.invalid", "topic-@demo.oma.invalid",
    "broker@demo.oma.invalid", "--file@demo.oma.invalid", "alice", "", "@demo.oma.invalid"])
    assert.equal(logicalFromDisplay(other, "demo"), null, other);
  const root = mkdtempSync(join(tmpdir(), "oma-av15-"));
  const fixture = await peer(root);
  try {
    const previous = process.env.OMA_SOCIETY;
    process.env.OMA_SOCIETY = "demo";
    let tools: Map<string, Tool>;
    try { tools = register(root, fixture.path, false); }
    finally { if (previous === undefined) delete process.env.OMA_SOCIETY; else process.env.OMA_SOCIETY = previous; }
    const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
    await assert.rejects(() => call("oma_mail_send", { to: ["principal@demo.oma.invalid", "topic-dev@demo.oma.invalid"], subject: "s", body: "b" }));
    assert.deepEqual(sent(fixture.frames, "mail.send")[0]!.to, ["principal", "topic/dev"], "the displayed address was not taken as the logical one");
    await assert.rejects(() => call("oma_mail_send", { to: ["principal@other.oma.invalid"], subject: "s", body: "b" }), /is not valid/);
    const id = "m-00000000-0000-4000-8000-000000000001-0";
    await assert.rejects(() => call("oma_mail_ack", { messageId: `${id}:2,` }));
    assert.deepEqual(sent(fixture.frames, "mail.ack").at(-1), { message: id }, "the Maildir file name was not taken as the message");
    await assert.rejects(() => call("oma_mail_ack", { messageId: `x${id}:2,` }), /is not valid/);
    // The RFC Message-ID its headers show (In-Reply-To, References), this society's only.
    await assert.rejects(() => call("oma_mail_ack", { messageId: `<${id}@demo.oma.invalid>` }));
    assert.deepEqual(sent(fixture.frames, "mail.ack").at(-1), { message: id }, "the RFC Message-ID was not taken as the message");
    await assert.rejects(() => call("oma_mail_ack", { messageId: `${id}@other.oma.invalid` }), /is not valid/);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("AV18 / CREATE-002, arch §11, §15.1: under the default configuration a Resident the Principal creates can submit", async () => {
  const { defaultHostConfig } = await import("../src/config/defaults.js");
  const { resolveChildSpec } = await import("../src/domain/child-policy.js");
  const cfg = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma", rootfs: "/state/rootfs", deploymentDigest: "a".repeat(64) });
  const principal = cfg.agentProfiles[cfg.principalProfile]!;
  // Nothing is configured to be delegated that the delegator does not hold.
  for (const [name, profile] of Object.entries(cfg.agentProfiles))
    for (const capability of profile.delegable) assert.ok(profile.capabilities.includes(capability), `${name} delegates ${capability} it does not hold`);
  const child = resolveChildSpec(cfg, { name: "principal", profile: cfg.principalProfile, capabilities: principal.capabilities }, { name: "worker", from: "a".repeat(40), brief: "b" });
  assert.ok(child);
  assert.deepEqual(child.spec.capabilities, [...cfg.agentProfiles[principal.childProfile!]!.capabilities].sort(),
    "the default Principal cannot give its Residents the Resident profile's capabilities");
  assert.ok(child.spec.capabilities.includes("git.submit"));
  assert.equal(principal.capabilities.includes("code.integrate"), false, "the Principal was given code.integrate (AUTH-001)");
});

/** AV29 -- FS-003, CTX-002: the ninth functional run. The Principal published
 * its workspace as the context once, and the second publication was refused
 * "unsupported context directory .local": the workspace is the CLI's home, and
 * its private request cache appears there with the first CLI call. The
 * workspace itself is refused the same way every time; a directory in it that
 * holds only the context files is the one to publish.
 * AV30 -- AV15's rule for every actor slot: a status call naming
 * "principal@provtest.oma.invalid" was refused as not an agent. */
test("AV29, AV30: the workspace itself is never a context tree, and an actor slot takes the address OMA shows", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av29-"));
  const fixture = await peer(root);
  try {
    const previous = process.env.OMA_SOCIETY;
    process.env.OMA_SOCIETY = "demo";
    let tools: Map<string, Tool>;
    try { tools = register(root, fixture.path, true); }
    finally { if (previous === undefined) delete process.env.OMA_SOCIETY; else process.env.OMA_SOCIETY = previous; }
    const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
    writeFileSync(join(root, "GOAL.md"), "goal\n");
    for (const directory of [root, ".", `${root}/`])
      await assert.rejects(() => call("oma_context_publish", { directory, expect: "none" }), /not the workspace itself/, directory);
    mkdirSync(join(root, "context")); writeFileSync(join(root, "context", "GOAL.md"), "goal\n");
    await assert.rejects(() => call("oma_context_publish", { directory: "context", expect: "none" }), /BROKER_UNAVAILABLE/);
    assert.equal(sent(fixture.frames, "context.publish").length, 1, "a directory holding only the context was not published");
    await assert.rejects(() => call("oma_status", { agent: "worker@demo.oma.invalid" }), /BROKER_UNAVAILABLE/);
    assert.deepEqual(sent(fixture.frames, "status.get").at(-1), { agent: "worker" });
    await assert.rejects(() => call("oma_agent_lifecycle", { name: "worker@demo.oma.invalid", action: "start" }), /BROKER_UNAVAILABLE/);
    assert.deepEqual(sent(fixture.frames, "agent.start").at(-1), { agent: "worker" });
    await assert.rejects(() => call("oma_logs", { agent: "worker@demo.oma.invalid", since: "10m" }), /BROKER_UNAVAILABLE/);
    // Only an actor's address names an actor.
    for (const agent of ["topic-dev@demo.oma.invalid", "worker@other.oma.invalid", "commons@demo.oma.invalid"])
      await assert.rejects(() => call("oma_status", { agent }), /is not valid/, agent);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});
