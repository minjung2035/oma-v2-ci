/** Principal and Worker boundary refusals happen before broker or local effects. */
import "#oma-test/app/runtime/client-preload";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerOmaTools } from "@oma/extension/mail-tools";
import { PrincipalChannel } from "@oma/extension/principal-channel";

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
const sent = (frames: readonly Record<string, unknown>[], method: string) =>
  frames.filter(frame => frame.method === method).map(frame => frame.params as Record<string, unknown>);

type Tool = { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };
function register(root: string, socket: string, principal: boolean, projectGit?: string, contextGit?: string): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const previous = { ...process.env };
  Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: socket,
    ...(projectGit === undefined ? {} : { OMA_PROJECT_GIT: projectGit }), OMA_CONTEXT_GIT: contextGit ?? "" });
  const channel = PrincipalChannel.detached();
  // The Principal's engine is the one the product starts with its channel attached.
  if (principal) {
    Object.defineProperty(channel, "attached", { value: true });
    // The peer is scripted, but a registered Principal still needs a grant.
    channel.push(`credential ${"c".repeat(64)} ${"d".repeat(32)}\n`);
  }
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root, channel);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  return tools;
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

test("Principal review authority and unavailable actions fail before effects", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-principal-boundary-"));
  const fixture = await peer(root);
  try {
    const tools = register(root, fixture.path, true);
    const name = "merge-01234567-0000-4000-8000-000000000000";
    const approval = "m-00000000-0000-4000-8000-000000000001-0";
    // Worker-only authority is absent, not an action hidden inside a shared tool.
    for (const unavailable of ["oma_merge_open", "oma_challenge_open", "oma_review_status", "oma_review_list",
      "oma_review_cancel", "oma_agent_create", "oma_agent_start", "oma_agent_stop"])
      assert.equal(tools.has(unavailable), false, unavailable);
    for (const [tool, params] of [
      ["oma_review_respond", { name, action: "approve", body: "ok" }],
      ["oma_review_respond", { name, action: "approve", body: "ok", approval: "not-a-message" }],
      ["oma_review_respond", { name, action: "comment", body: "discussion", approval }],
      ["oma_review_respond", { name, action: "approve", body: " ", approval }],
      ["oma_review_respond", { name, action: "approve", body: "ok", approval, tier: "LOW" }],
      ["oma_review_diff", { name: "topic/dev" }],
      ["oma_review_diff", { name, cursor: "0" }],
      ["oma_society", { action: "restart" }],
      ["oma_mail_send", { to: ["residents"], subject: "Goal", body: "b", intent: "goal", expectedRevision: "HEAD" }],
    ] as const) await assert.rejects(() => tools.get(tool)!.execute("invalid", params), /not valid|Invalid arguments/);
    assert.equal(fixture.frames.length, 0, "invalid calls never attach or reach the broker");
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("Worker invalid review inputs and Principal approval fields are refused before effects", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-worker-boundary-"));
  const fixture = await peer(root);
  try {
    const tools = register(root, fixture.path, false);
    const name = "merge-01234567-0000-4000-8000-000000000000";
    for (const unavailable of ["oma_society", "oma_goal_publish"])
      assert.equal(tools.has(unavailable), false, unavailable);
    for (const [tool, params] of [
      ["oma_review_respond", { name, action: "approve", body: "ok", approval: "m-00000000-0000-4000-8000-000000000001-0" }],
      ["oma_review_respond", { name, action: "comment", body: "ok", title: "leaked" }],
      ["oma_review_respond", { name, action: "approve", body: " " }],
      ["oma_merge_open", { tier: "LOW", title: "t", reason: "r", verdict: "approve" }],
      ["oma_merge_open", { tier: "LOW", title: "t", reason: "r", merge: name }],
      ["oma_merge_open", { tier: "LOW", title: "t", reason: "r", path: "x" }],
      ["oma_challenge_open", { merge: name.replace("merge-", "challenge-"), tier: "LOW", title: "t", reason: "r" }],
      ["oma_challenge_open", { merge: name, tier: "MEDIUM", title: "t", reason: "r" }],
      ["oma_challenge_open", { merge: name, tier: "LOW", title: "t", reason: "r", replacement: { candidate: "HEAD" } }],
      ["oma_review_diff", { name, cursor: -1 }],
      ["oma_review_diff", { name, cursor: 0.5 }],
      ["oma_review_diff", { name, cursor: "0" }],
      ["oma_review_list", { kind: "merge", after: name.replace("merge-", "challenge-") }],
    ] as const) await assert.rejects(() => tools.get(tool)!.execute("invalid", params), /not valid|Invalid arguments/);
    await assert.rejects(() => tools.get("oma_mail_read")!.execute("read", { messageId: "/inbox.md" }), /no delivery index/);
    assert.equal(fixture.frames.length, 0, "invalid inputs produce neither publication nor broker calls");
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});


test("AV15 / BATCH-002, INV04: a tool takes the names OMA shows -- this society's RFC address, a message's file name -- as what they display", async () => {
  const { displayAddress } = await import("@oma/mail/addresses");
  const { logicalFromDisplay } = await import("@oma/domain/display-address");
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


test("GOAL publication is explicit, validates revisions before effects, and never automatically resends unknown acceptance", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av29-")); const fixture = await peer(root);
  try {
    const previous = process.env.OMA_SOCIETY; process.env.OMA_SOCIETY = "demo";
    let tools: Map<string, Tool>;
    try { tools = register(root, fixture.path, true); }
    finally { if (previous === undefined) delete process.env.OMA_SOCIETY; else process.env.OMA_SOCIETY = previous; }
    const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
    writeFileSync(join(root, "GOAL.md"), "workspace file must not be used\n");
    for (const extra of [{ expectedRevision: "none" }, { intent: "goal" },
      { intent: "goal", expectedRevision: "none", replyTo: "m-00000000-0000-4000-8000-000000000001-0" }])
      await assert.rejects(() => call("oma_mail_send", { to: ["residents"], subject: "Plan", body: "explicit body", ...extra }), /not valid|Invalid arguments/);
    assert.equal(fixture.frames.length, 0);
    await assert.rejects(() => call("oma_goal_publish", { subject: "Plan", body: "explicit body",
      expectedRevision: null }), /Acceptance status unknown/);
    assert.equal(sent(fixture.frames, "context.publish").length, 1);
    for (const format of ["sha1", "sha256"]) {
      const contextRoot = join(root, format); mkdirSync(contextRoot);
      const { gitDir, main: expectedRevision } = canonical(contextRoot, format, "GOAL.md");
      const publisher = register(contextRoot, fixture.path, true, undefined, gitDir).get("oma_goal_publish")!;
      await assert.rejects(() => publisher.execute(`goal-${format}`, { subject: "Plan", body: "explicit body",
        expectedRevision }), /Acceptance status unknown/);
      assert.equal(sent(fixture.frames, "context.publish").at(-1)!.expected, expectedRevision);
    }
    const before = fixture.frames.length;
    for (const expectedRevision of [40, "none", "HEAD", "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65), "A".repeat(40)])
      await assert.rejects(() => call("oma_goal_publish", { subject: "Plan", body: "explicit body",
        expectedRevision }), /not valid|Invalid arguments/);
    assert.equal(fixture.frames.length, before, "invalid revisions never reach the broker");
    const publications = fixture.frames.filter(frame => frame.method === "context.publish");
    const lookups = sent(fixture.frames, "operation.get");
    assert.equal(publications.length, 3, "unknown acceptance never resends automatically");
    assert.deepEqual(lookups, publications.map(frame => ({ key: frame.request })), "one same-key lookup per unobserved publication");
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

