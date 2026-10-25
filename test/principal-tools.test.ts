/** AV11/DR27: the Principal reviews, reads and communicates; it does not
 * orchestrate workers or write code. Real extension -> CLI -> refusing peer. */
import "#oma-test/app/runtime/client-preload";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerOmaTools } from "@oma/extension/mail-tools";
import { PRINCIPAL_TOOL_NAMES } from "@oma/extension/principal-tools";
import { PrincipalChannel } from "@oma/extension/principal-channel";
import { isValidFullOid as validFullOid, isValidTopicName as validTopicName } from "@oma/domain/identifiers";
import { isValidFullOid, isValidTopicName } from "@oma/domain/identifiers";

const CLI = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));

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
  Object.assign(process.env, { OMA_CLI_PATH: CLI, OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: socket,
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

test("AV11/DR27: the Principal reviews and controls safety, without orchestration tools", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av11-")); const fixture = await peer(root);
  try {
    const { gitDir } = canonical(root); const tools = register(root, fixture.path, true, gitDir);
    for (const name of PRINCIPAL_TOOL_NAMES) assert.ok(tools.has(name), `${name} was not registered`);
    for (const name of ["oma_agent_create", "oma_status", "oma_logs", "oma_mail_ack", "oma_context_publish", "oma_route", "write", "edit",
      "oma_git", "oma_review_decide", "oma_challenge_finding", "oma_challenge_scope", "oma_attestation_revoke"])
      assert.equal(tools.has(name), false, `${name} must not be offered to the Principal`);
    const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
    // The Principal's merge/challenge schema has only diff and vote: no open,
    // review, status or cancel action, and no fields those actions would take.
    for (const toolName of ["oma_merge", "oma_challenge"]) {
      const schema = (tools.get(toolName)! as unknown as { parameters: { properties: Record<string, { const?: unknown; anyOf?: { const: string }[] }> } })
        .parameters.properties;
      assert.deepEqual(schema.action!.anyOf!.map(v => v.const).sort(), ["diff", "vote"], `${toolName} must only carry diff|vote`);
      assert.equal("tier" in schema || "title" in schema || "reason" in schema || "merge" in schema, false,
        `${toolName} must not carry open's fields`);
      for (const params of [
        { action: "open", tier: "LOW", title: "t", reason: "r" },
        { action: "review", name: "merge-01234567-0000-4000-8000-000000000000", body: "b" },
        { action: "status" }, { action: "cancel", name: "merge-01234567-0000-4000-8000-000000000000", reason: "r" },
      ] as const) await assert.rejects(() => call(toolName, params), /is not valid/);
    }
    assert.equal(fixture.frames.length, 0, "a refused action runs no CLI");
    for (const [name, params] of [
      ["oma_society", { action: "restart" }],
      ["oma_agent_lifecycle", { name: "worker", action: "retire" }],
      ["oma_agent_lifecycle", { name: "principal", action: "stop" }],
      ["oma_agent_lifecycle", { name: "--file", action: "stop" }],
      ["oma_merge", { action: "vote", name: "merge-01234567-0000-4000-8000-000000000000", verdict: "approve", body: "ok" }],           // vote needs its approval
      ["oma_merge", { action: "vote", name: "merge-01234567-0000-4000-8000-000000000000", verdict: "approve", body: "ok", approval: "not-a-message" }],
      ["oma_merge", { action: "diff", name: "topic/dev" }],                                              // name prefix
      ["oma_challenge", { action: "diff", name: "merge-01234567-0000-4000-8000-000000000000" }],                                     // kind prefix
      ["oma_merge", { action: "vote", name: "merge-01234567-0000-4000-8000-000000000000", verdict: "approve", body: "ok", approval: "m-00000000-0000-4000-8000-000000000001-0", tier: "LOW" }],
      ["oma_mail_send", { to: ["residents"], subject: "Goal", body: "b", intent: "goal", expectedRevision: "HEAD" }],
    ] as const) await assert.rejects(() => call(name, params), /is not valid/);
    assert.equal(fixture.frames.length, 0);
    // diff is a read: the CLI asks the broker for the request's status, which
    // is what decides visibility and identity.
    await assert.rejects(() => call("oma_merge", { action: "diff", name: "merge-01234567-0000-4000-8000-000000000000" }), /BROKER_UNAVAILABLE/);
    assert.deepEqual(sent(fixture.frames, "review.status"), [{ name: "merge-01234567-0000-4000-8000-000000000000" }]);
    await assert.rejects(() => call("oma_society", { action: "close", request: "close" }), /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
    await assert.rejects(() => call("oma_society", { action: "open", request: "open" }), /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
    assert.deepEqual(sent(fixture.frames, "society.set"), [{ state: "closed" }, { state: "open" }]);
    await assert.rejects(() => call("oma_agent_lifecycle", { name: "worker", action: "stop" }), /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
    assert.deepEqual(sent(fixture.frames, "agent.stop"), [{ agent: "worker" }]);
    // The Principal's vote carries its approval id; the exact wire fact.
    const approval = "m-00000000-0000-4000-8000-000000000001-0";
    await assert.rejects(() => call("oma_merge", { action: "vote", name: "merge-01234567-0000-4000-8000-000000000000", verdict: "reject",
      body: "needs another pass", approval, request: "vote-1" }),
      /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
    assert.deepEqual(sent(fixture.frames, "attest.record").at(-1),
      { kind: "vote", name: "merge-01234567-0000-4000-8000-000000000000", verdict: "reject", body: "needs another pass", approval });
    await assert.rejects(() => call("oma_challenge", { action: "vote", name: "challenge-01234567-0000-4000-8000-000000000000", verdict: "approve",
      body: "revert is right", approval, request: "vote-2" }), /Acceptance status unknown/);
    assert.deepEqual(sent(fixture.frames, "attest.record").at(-1),
      { kind: "vote", name: "challenge-01234567-0000-4000-8000-000000000000", verdict: "approve", body: "revert is right", approval });
    await assert.rejects(() => call("oma_mail_send", { to: ["residents"], subject: "Plan", body: "Check every feature.\n",
      intent: "goal", expectedRevision: "none", request: "goal" }), /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
    const published = sent(fixture.frames, "context.publish")[0]!;
    assert.equal(published.expected, null); assert.deepEqual(published.goalMail, { subject: "Plan" });
    assert.deepEqual((published.entries as { path: string }[]).map(entry => entry.path), ["GOAL.md"]);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("mail-v1 / CLI-001: a Worker's oma_merge and oma_challenge carry the whole review vocabulary, never approval", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-worker-tools-"));
  // A workspace clone: HEAD + the recorded origin/main, so merge open resolves.
  const gitW = (args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { cwd: root, encoding: "utf8" });
  gitW(["init", "-q", "-b", "main"]); writeFileSync(join(root, "a.txt"), "a\n"); gitW(["add", "a.txt"]);
  gitW(["commit", "-qm", "base"]); writeFileSync(join(root, "a.txt"), "b\n"); gitW(["commit", "-qam", "cand"]);
  gitW(["update-ref", "refs/remotes/origin/main", "HEAD~1"]);
  const sockdir = mkdtempSync(join(tmpdir(), "oma-worker-sock-"));
  const fixture = await peer(sockdir, frame =>
    frame.method === "git.known" ? { v: 1, id: frame.id, ok: true, result: { hasCandidate: true, prerequisites: [] } } : null);
  try {
    const tools = register(root, fixture.path, false);
    const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
    for (const toolName of ["oma_merge", "oma_challenge"]) {
      const schema = (tools.get(toolName)! as unknown as { parameters: { properties: Record<string, { const?: unknown; anyOf?: { const: string }[] }> } })
        .parameters.properties;
      assert.deepEqual(schema.action!.anyOf!.map(v => v.const).sort(), ["cancel", "diff", "open", "review", "status", "vote"],
        `${toolName} carries the six actions`);
      assert.equal("approval" in schema, false, "a Worker's vote never names an approval");
      await assert.rejects(() => call(toolName, { action: "vote", name: `${toolName.slice(4)}-01234567`, verdict: "approve", body: "b", approval: "m-00000000-0000-4000-8000-000000000001-0" }),
        /is not valid/);
      await assert.rejects(() => call(toolName, { action: "review", name: `${toolName.slice(4)}-01234567`, body: "b", title: "leaked" }), /is not valid/);
    }
    // The full action set reaches the wire with exact argv.
    await assert.rejects(() => call("oma_merge", { action: "review", name: "merge-01234567-0000-4000-8000-000000000000", body: "try this", request: "rv1" }), /Acceptance status unknown/);
    assert.deepEqual(sent(fixture.frames, "attest.record").at(-1), { kind: "review", name: "merge-01234567-0000-4000-8000-000000000000", body: "try this" });
    await assert.rejects(() => call("oma_merge", { action: "vote", name: "merge-01234567-0000-4000-8000-000000000000", verdict: "approve", body: "looks right", request: "v1" }),
      /Acceptance status unknown/);
    assert.deepEqual(sent(fixture.frames, "attest.record").at(-1), { kind: "vote", name: "merge-01234567-0000-4000-8000-000000000000", verdict: "approve", body: "looks right" });
    await assert.rejects(() => call("oma_merge", { action: "cancel", name: "merge-01234567-0000-4000-8000-000000000000", reason: "superseded", request: "c1" }), /Acceptance status unknown/);
    assert.deepEqual(sent(fixture.frames, "attest.record").at(-1), { kind: "cancel", name: "merge-01234567-0000-4000-8000-000000000000", reason: "superseded" });
    await assert.rejects(() => call("oma_challenge", { action: "review", name: "challenge-01234567-0000-4000-8000-000000000000", body: "note", request: "cr" }), /Acceptance status unknown/);
    assert.deepEqual(sent(fixture.frames, "attest.record").at(-1), { kind: "review", name: "challenge-01234567-0000-4000-8000-000000000000", body: "note" });
    await assert.rejects(() => call("oma_merge", { action: "status", name: "merge-01234567-0000-4000-8000-000000000000" }), /BROKER_UNAVAILABLE/);
    assert.deepEqual(sent(fixture.frames, "review.status").at(-1), { name: "merge-01234567-0000-4000-8000-000000000000" });
    // open writes the reason to a file the CLI reads and removes afterwards.
    await assert.rejects(() => call("oma_merge", { action: "open", tier: "MEDIUM", title: "Ship it", reason: "the fix", request: "o1" }), /Acceptance status unknown/);
    const opened = sent(fixture.frames, "attest.record").at(-1)!;
    assert.equal(opened.kind, "merge.open"); assert.equal(opened.tier, "MEDIUM"); assert.equal(opened.title, "Ship it");
    assert.equal(opened.reason, "the fix");
    await assert.rejects(() => call("oma_challenge", { action: "open", merge: "merge-01234567-0000-4000-8000-000000000000", tier: "HIGH", title: "Revert it", reason: "regress", request: "o2" }),
      /Acceptance status unknown/);
    const challenged = sent(fixture.frames, "attest.record").at(-1)!;
    assert.equal(challenged.kind, "challenge.open"); assert.equal(challenged.merge, "merge-01234567-0000-4000-8000-000000000000");
    assert.equal(challenged.candidate, undefined, "a prepared revert carries no candidate");
    assert.equal(readdirSync(root).filter(name => name.startsWith("oma-tool-")).length, 0, "evidence files are removed");
    for (const params of [
      { action: "open", tier: "LOW", title: "t", reason: "r", verdict: "approve" },                      // field is not open's
      { action: "open", tier: "MEDIUM", title: "t", reason: "r", merge: "merge-01234567-0000-4000-8000-000000000000" },              // merge has no merge field
      { action: "open", tier: "HIGH", title: "t", reason: "r", name: "merge-01234567-0000-4000-8000-000000000000" },                 // open takes no name
      { action: "open", tier: "LOW", title: "t", reason: "r", path: "x" },                               // diff field
    ] as const) {
      await assert.rejects(() => call("oma_merge", params), /is not valid|not valid/);
    }
    await assert.rejects(() => call("oma_challenge", { action: "open", merge: "challenge-01234567-0000-4000-8000-000000000000", tier: "LOW", title: "t", reason: "r" }), /is not valid/);
    await assert.rejects(() => call("oma_challenge", { action: "open", merge: "merge-01234567-0000-4000-8000-000000000000", tier: "MEDIUM", title: "t", reason: "r" }), /is not valid/);
    await assert.rejects(() => call("oma_challenge", { action: "open", merge: "merge-01234567-0000-4000-8000-000000000000", tier: "LOW", title: "t", reason: "r", candidate: "x" }), /is not valid/);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); rmSync(sockdir, { recursive: true, force: true }); }
});

test("AV11 / T114: a Resident's engine, which has no credential channel, is not given the Principal's tools", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av11-resident-"));
  try {
    const tools = register(root, join(root, "control.sock"), false);
    for (const name of PRINCIPAL_TOOL_NAMES.filter(n => n !== "oma_merge" && n !== "oma_challenge"))
      assert.equal(tools.has(name), false, `${name} was registered for a Resident`);
    assert.ok(tools.has("oma_mail_send") && tools.has("oma_status"));
    assert.ok(tools.has("oma_merge") && tools.has("oma_challenge"), "mail-v1 review tools are the Worker's");
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

test("DR27/INV04: full object ids use one grammar in host and isolated extension", () => {
  for (let size = 0; size <= 66; size++) {
    const sample = "a".repeat(size);
    for (const decode of [isValidFullOid, validFullOid])
      assert.equal(decode(sample), size === 40 || size === 64, `length ${size}`);
  }
  for (const size of [40, 64]) {
    const id = "0123456789abcdef".repeat(4).slice(0, size);
    for (const decode of [isValidFullOid, validFullOid]) {
      assert.equal(decode(id), true);
      for (const sample of [id.toUpperCase(), ` ${id}`, `${id} `, `${id}\n`, `${id}\0`, `refs/${id}`, id.slice(1)])
        assert.equal(decode(sample), false, JSON.stringify(sample));
    }
  }
  for (const sample of [null, undefined, false, 40, {}, [], ["a".repeat(40)]])
    for (const decode of [isValidFullOid, validFullOid]) assert.equal(decode(sample), false);
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


test("AV29/DR27, AV30: GOAL is explicit mail intent, and safety control accepts displayed actor addresses", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av29-")); const fixture = await peer(root);
  try {
    const previous = process.env.OMA_SOCIETY; process.env.OMA_SOCIETY = "demo";
    let tools: Map<string, Tool>;
    try { tools = register(root, fixture.path, true); }
    finally { if (previous === undefined) delete process.env.OMA_SOCIETY; else process.env.OMA_SOCIETY = previous; }
    const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
    writeFileSync(join(root, "GOAL.md"), "workspace file must not be used\n");
    for (const extra of [{ kind: "context" }, { expectedRevision: "none" }, { intent: "goal" },
      { intent: "goal", expectedRevision: "none", replyTo: "m-00000000-0000-4000-8000-000000000001-0" }])
      await assert.rejects(() => call("oma_mail_send", { to: ["residents"], subject: "Plan", body: "explicit body", ...extra }), /is not valid/);
    assert.equal(fixture.frames.length, 0);
    await assert.rejects(() => call("oma_mail_send", { to: ["residents"], subject: "Plan", body: "explicit body",
      intent: "goal", expectedRevision: "none" }), /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
    assert.equal(sent(fixture.frames, "context.publish").length, 1);
    for (const format of ["sha1", "sha256"]) {
      const contextRoot = join(root, format); mkdirSync(contextRoot);
      const { gitDir, main: expectedRevision } = canonical(contextRoot, format, "GOAL.md");
      const publisher = register(contextRoot, fixture.path, true, undefined, gitDir).get("oma_mail_send")!;
      await assert.rejects(() => publisher.execute(`goal-${format}`, { to: ["residents"], subject: "Plan", body: "explicit body",
        intent: "goal", expectedRevision }), /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
      assert.equal(sent(fixture.frames, "context.publish").at(-1)!.expected, expectedRevision);
    }
    const before = fixture.frames.length;
    for (const expectedRevision of [null, 40, "HEAD", "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65), "A".repeat(40)])
      await assert.rejects(() => call("oma_mail_send", { to: ["residents"], subject: "Plan", body: "explicit body",
        intent: "goal", expectedRevision }), /is not valid/);
    assert.equal(fixture.frames.length, before, "invalid revisions never reach the CLI");
    const publications = fixture.frames.filter(frame => frame.method === "context.publish");
    const lookups = sent(fixture.frames, "operation.get");
    assert.equal(publications.length, 3, "unknown acceptance never resends automatically");
    assert.deepEqual(lookups, publications.map(frame => ({ key: frame.request })), "one same-key lookup per unobserved publication");
    await assert.rejects(() => call("oma_agent_lifecycle", { name: "worker@demo.oma.invalid", action: "start" }), /Acceptance status unknown: .*Recovery: use --request .* with the same command; do not rerun with a new key/);
    assert.deepEqual(sent(fixture.frames, "agent.start").at(-1), { agent: "worker" });
    for (const name of ["topic-dev@demo.oma.invalid", "worker@other.oma.invalid", "commons@demo.oma.invalid"])
      await assert.rejects(() => call("oma_agent_lifecycle", { name, action: "stop" }), /is not valid/);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("DR1 / SB-002-C: the CLI a tool starts is given this engine's archive root", async () => {
  const { cliEnvironment } = await import("@oma/extension/mail-tools");
  assert.equal(cliEnvironment("/home/agent", "/run/oma/control.sock", "/mail/archive/cur").OMA_MAIL_ARCHIVE, "/mail/archive/cur");
});
