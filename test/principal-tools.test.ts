/** Current tool input refusals, plus typed host GOAL uncertainty semantics.
 * The transport fixture supplies authentication; this is not provider evidence. */
import "#oma-test/app/runtime/client-preload";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@oma/client";
const { registerCollaborationTools } = await import(new URL("collaboration-tools.js", import.meta.resolve("@oma/extension/mail-tools")).href);
import { collaborationClient } from "./fixtures/collaboration-client.js";
import { displayAddress } from "@oma/mail/addresses";
import { logicalFromDisplay } from "@oma/domain/display-address";

function invalidTools(role: "principal" | "resident") {
  let effects = 0;
  const client = new Proxy({}, { get() { effects++; throw new Error("invalid input reached the client"); } });
  const tools = new Map<string, { execute(id: string, input: unknown): Promise<unknown> }>();
  registerCollaborationTools({ on() {}, registerTool: (tool: { name: string; execute(id: string, input: unknown): Promise<unknown> }) => tools.set(tool.name, tool) } as never,
    client as Client, role, { addresses: 64 });
  return { tools, effects: () => effects };
}
interface Peer { readonly path: string; readonly frames: Record<string, unknown>[]; close(): Promise<void> }
async function peer(root: string, answer?: (frame: Record<string, unknown>) => Record<string, unknown> | null): Promise<Peer> {
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
        const custom = frame.method === "principal.attach"
          ? { v: 1, id: frame.id, ok: true, result: { actor: "principal", incarnation: 0 } } : answer?.(frame);
        const reply = Buffer.from(JSON.stringify(custom ?? { v: 1, id: frame.id, ok: false,
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
/** A bare canonical repository whose main is one commit. */
function canonical(root: string, format = "sha1", filename = "README.md"): { gitDir: string; main: string } {
  const git = (cwd: string, ...args: string[]) => {
    const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  const work = join(root, "seed");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main", `--object-format=${format}`);
  writeFileSync(join(work, filename), "seed\n");
  git(work, "add", filename);
  git(work, "commit", "-qm", "seed");
  const gitDir = join(root, "project.git");
  git(root, "clone", "-q", "--bare", work, gitDir);
  return { gitDir, main: git(gitDir, "rev-parse", "refs/heads/main") };
}

test("001. Principal review authority and unavailable actions fail before effects", async () => {
  const h = invalidTools("principal");
  assert.deepEqual([...h.tools.keys()].sort(), ["oma_goal", "oma_review", "oma_send", "oma_society"]);
  for (const input of [
    { target: "", decision: "approve", reason: "ok" },
    { target: "target", decision: "comment", reason: "discussion" },
    { target: "target", decision: "approve", reason: " " },
    { target: "target", decision: "approve", reason: "ok", approval: "mail-id" },
  ]) await assert.rejects(h.tools.get("oma_review")!.execute("invalid", input), /INVALID_ARGUMENT/);
  await assert.rejects(h.tools.get("oma_society")!.execute("invalid", { action: "restart" }), /INVALID_ARGUMENT/);
  assert.equal(h.effects(), 0);
});

test("002. Worker invalid review inputs and Principal approval fields are refused before effects", async () => {
  const h = invalidTools("resident");
  assert.deepEqual([...h.tools.keys()].sort(), ["oma_challenge", "oma_follow", "oma_merge", "oma_review", "oma_send", "oma_spawn", "oma_wait"]);
  for (const [name, input] of [
    ["oma_review", { target: "target", decision: "approve", reason: "ok", approval: "mail" }],
    ["oma_review", { target: "target", decision: "approve", reason: " " }],
    ["oma_merge", { tier: "LOW", reason: "r", verdict: "approve" }],
    ["oma_merge", { tier: "LOW", reason: "r", change: { candidate: "HEAD", path: "/etc/shadow" } }],
    ["oma_challenge", { merge: "request-name", tier: "MEDIUM", reason: "r" }],
    ["oma_follow", { topic: "release", enabled: "true" }],
    ["oma_spawn", { name: "peer", from: "HEAD", brief: "legacy body" }],
  ] as const) await assert.rejects(h.tools.get(name)!.execute("invalid", input), /INVALID_ARGUMENT/);
  assert.equal(h.effects(), 0);
});

test("003. Current send tools preserve displayed project addresses and reject foreign display authority", async t => {
  for (const logical of ["principal", "commons", "residents", "alice", "a-b-9", "topic/dev"])
    assert.equal(logicalFromDisplay(displayAddress(logical as never, "demo"), "demo"), logical);
  for (const foreign of ["alice@other.oma.invalid", "alice@demo.oma.invalid.evil", "Alice@demo.oma.invalid", "--file@demo.oma.invalid"])
    assert.equal(logicalFromDisplay(foreign, "demo"), null);
  const h = await collaborationClient(t);
  const result = await h.call("alice", "oma_send", { to: ["principal@demo.oma.invalid", "topic-dev@demo.oma.invalid"], content: { kind: "text", value: "Exact body\r\n" } }).invokeTool();
  const envelope = JSON.parse(result.content[0]!.text!);
  assert.equal(envelope.receipt.state, "succeeded");
  const op = h.f.store.getOperationById(envelope.receipt.operation);
  assert.ok(op?.kind === "mail.send");
  assert.deepEqual(op.plan.message.to, ["principal", "topic/dev"]);
  const before = h.f.store.acceptedOperationPage().items;
  const refused = await h.call("alice", "oma_send", { to: ["principal@other.oma.invalid"], content: { kind: "text", value: "Do not route this" } }).invokeTool();
  assert.match(refused.content[0]!.text!, /INVALID_REQUEST|invalid.*recipient/i);
  assert.deepEqual(h.f.store.acceptedOperationPage().items, before);
});

test("004. GOAL publication is explicit, validates revisions before effects, and never automatically resends unknown acceptance", { timeout: 60_000 }, async t => {
  const invalid = invalidTools("principal");
  await assert.rejects(invalid.tools.get("oma_goal")!.execute("invalid", { content: { kind: "text", value: "explicit body" }, expectedRevision: 40 }), /INVALID_ARGUMENT/);
  assert.equal(invalid.effects(), 0);
  const h = await collaborationClient(t), accepted = h.f.store.acceptedOperationPage().items;
  for (const expectedRevision of ["none", "HEAD", "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65), "A".repeat(40)]) {
    const result = await h.call("principal", "oma_goal", { content: { kind: "text", value: "explicit body" }, expectedRevision }).invokeTool();
    assert.match(result.content[0]!.text!, /INVALID_REQUEST|exact full context OID/);
  }
  assert.deepEqual(h.f.store.acceptedOperationPage().items, accepted);
  const root = mkdtempSync(join(tmpdir(), "oma-goal-uncertain-")), transport = await peer(root);
  try {
    writeFileSync(join(root, "GOAL.md"), "workspace bytes must not be substituted\n");
    const publish = (home: string, expected: string | null, contextGit?: string) => new Client({ cwd: home, env: {
      HOME: home, OMA_SOCKET: transport.path, OMA_SOCIETY: "demo", OMA_MAIL_ARCHIVE: join(home, "archive"),
      OMA_CONTEXT_BYTES: "8388608", ...(contextGit ? { OMA_CONTEXT_GIT: contextGit } : {}),
    } }).publishGoal("explicit body", expected, "Plan", `goal-${expected ?? "initial"}`);
    await assert.rejects(publish(root, null), /Acceptance status unknown/);
    for (const format of ["sha1", "sha256"]) {
      const directory = join(root, format); mkdirSync(directory);
      const { gitDir, main } = canonical(directory, format, "GOAL.md");
      await assert.rejects(publish(directory, main, gitDir), /Acceptance status unknown/);
    }
    const publications = transport.frames.filter(frame => frame.method === "context.publish");
    assert.equal(publications.length, 3, "uncertain acceptance must not cause automatic replacement sends");
    assert.deepEqual(transport.frames.filter(frame => frame.method === "operation.get").map(frame => frame.params), publications.map(frame => ({ key: frame.request })));
  } finally { await transport.close(); rmSync(root, { recursive: true, force: true }); }
});
