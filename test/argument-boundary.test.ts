/** AV1 -- INV04 and INV09 applied to CLI-001 and PR-004: a value one party
 * supplies is data, never an option of the program it is handed to.
 *
 * The CLI runs for people and, through the trusted extension, for models; both
 * pass it values chosen by someone else. These run the real CLI against a
 * socket peer that records the one frame it receives, and the real extension
 * tools against that CLI: a pass means the bytes a value named never left its
 * slot. The peer is a protocol fixture, not a broker.
 */
import "#oma-test/app/runtime/client-preload";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerOmaTools } from "@oma/extension/mail-tools";
import { isLogicalAddress as validAddress } from "@oma/domain/mail-values";
import { isValidActorName as validActorName, isValidRequestKey as validRequestKey } from "@oma/domain/identifiers";
import { isLogicalAddress } from "@oma/domain/mail-values";
import { isValidActorName, isValidRequestKey } from "@oma/domain/identifiers";

const CLI = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));
const MESSAGE = "m-00000000-0000-4000-8000-000000000001-0";

interface Peer { readonly path: string; readonly frames: Record<string, unknown>[]; close(): Promise<void> }
/** Records every request frame and refuses it, so nothing is ever accepted. */
async function peer(root: string): Promise<Peer> {
  const frames: Record<string, unknown>[] = [];
  const path = join(root, "control.sock");
  const server: Server = createServer(socket => {
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
        const length = pending.readUInt32BE(0);
        const frame = JSON.parse(pending.subarray(4, 4 + length).toString("utf8")) as Record<string, unknown>;
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
/** Asynchronous, because the socket peer answers from this same event loop. */
function cli(root: string, socket: string, args: string[]): Promise<{ status: number | null; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: root, stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin", HOME: root, OMA_SOCKET: socket } });
    let stderr = "";
    child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", status => { clearTimeout(timer); resolve({ status, stderr }); });
  });
}
const sent = (frames: readonly Record<string, unknown>[], method: string) =>
  frames.filter(frame => frame.method === method).map(frame => frame.params as Record<string, unknown>);

test("AV1 / INV04, CLI-001: the CLI admits each declared option once, refuses unknown ones and takes a value verbatim", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av1-cli-"));
  const fixture = await peer(root);
  try {
    const body = join(root, "body.txt"); writeFileSync(body, "the body the caller chose\n");
    const other = join(root, "other.txt"); writeFileSync(other, "bytes nobody sent\n");
    // A second --file is refused, not decided by position.
    let run = await cli(root, fixture.path, ["send", "commons", "--file", other, "--subject", "s", "--file", body]);
    assert.equal(run.status, 2, run.stderr); assert.match(run.stderr, /--file must be given once/);
    // An option the command does not declare is refused, not skipped.
    run = await cli(root, fixture.path, ["send", "commons", "--subject", "s", "--file", body, "--bogus", "x"]);
    assert.equal(run.status, 2, run.stderr); assert.match(run.stderr, /unknown option --bogus/);
    // A duplicated request key, for a command other than send.
    run = await cli(root, fixture.path, ["ack", MESSAGE, "--request", "a", "--request", "b"]);
    assert.equal(run.status, 2, run.stderr);
    // A positional that looks like an option is refused before `--`...
    run = await cli(root, fixture.path, ["status", "--weird"]);
    assert.equal(run.status, 2, run.stderr);
    assert.deepEqual(fixture.frames, [], "a refused command line reached the broker");
    // ...and after `--` it is only a value: an address spelled "--file" is an
    // address, refused as one, and no file is read on its account.
    run = await cli(root, fixture.path, ["send", "--subject", "s", "--file", body, "--request", "k0", "--", "commons", "--file", other]);
    assert.notEqual(run.status, 0, run.stderr);
    assert.match(run.stderr, /invalid cached caller DTO for mail\.send|INVALID_REQUEST/);
    assert.deepEqual(fixture.frames, [], "an invalid address reached the broker");
    // An option's value is taken verbatim, whatever it looks like.
    run = await cli(root, fixture.path, ["send", "--subject", "--looks-like-an-option", "--file", body, "--request", "k1", "--", "commons"]);
    const [params] = sent(fixture.frames, "mail.send");
    assert.ok(params, run.stderr);
    assert.deepEqual(params.to, ["commons"]);
    assert.equal(params.subject, "--looks-like-an-option", "an option's value is taken verbatim");
    assert.equal(params.body, "the body the caller chose\n");
    assert.ok(!JSON.stringify(fixture.frames).includes("bytes nobody sent"));
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("AV1 / INV09, PR-004: a value the model supplies cannot leave its slot through OMA's tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av1-tools-"));
  const fixture = await peer(root);
  const secret = join(root, "host-secret.txt");
  writeFileSync(secret, "PRIVATE-HOST-FILE\n");
  const previous = { ...process.env };
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }>();
  Object.assign(process.env, { OMA_CLI_PATH: CLI, OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: fixture.path });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
  const A = "a".repeat(40); const B = "b".repeat(40);
  try {
    for (const [name, params] of [
      // The recorded counterexamples: a host file as the body, and an approval
      // request the tool's own schema does not offer.
      ["oma_mail_send", { to: ["commons", "--file", secret], subject: "s", body: "b" }],
      ["oma_mail_send", { to: ["principal", "--kind", "approval_required", "--candidate", A, "--expect", B, "--policy-revision", "r"], subject: "s", body: "b" }],
      ["oma_mail_send", { to: ["commons"], subject: "s", body: "b", replyTo: secret }],
      ["oma_mail_send", { to: ["commons"], subject: "s", body: "b", kind: "approval_required" }],
      ["oma_mail_send", { to: ["commons"], subject: "s", body: "b", request: "not a key" }],
      ["oma_mail_ack", { messageId: "--request" }],
      ["oma_status", { agent: "--help" }],
    ] as const) {
      await assert.rejects(() => call(name, params), /is not valid/, `${name} ${JSON.stringify(params)} was not refused`);
    }
    assert.deepEqual(fixture.frames, [], "a refused tool call reached the broker");
    // The same tool still sends what the model meant, with the subject it wrote.
    await assert.rejects(() => call("oma_mail_send", { to: ["commons", "topic/dev"], subject: "--odd subject", body: "hello", replyTo: `/mail/archive/cur/${MESSAGE}:2,` }));
    // The reply path is the archive's copy of that message, not a path the model named.
    assert.deepEqual(sent(fixture.frames, "mail.send"), [], "the reply file does not exist here, so nothing was sent");
    await assert.rejects(() => call("oma_mail_send", { to: ["commons", "topic/dev"], subject: "--odd subject", body: "hello" }));
    const [params] = sent(fixture.frames, "mail.send");
    assert.deepEqual(params!.to, ["commons", "topic/dev"]);
    assert.equal(params!.subject, "--odd subject");
    assert.equal(params!.body, "hello");
    assert.ok(!JSON.stringify(fixture.frames).includes("PRIVATE-HOST-FILE"), "the host file left through a tool");
    assert.equal(readFileSync(secret, "utf8"), "PRIVATE-HOST-FILE\n");
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("AV1 / INV04: the extension's address and actor grammar is the wire grammar", () => {
  const samples = ["principal", "commons", "residents", "alice", "a", "a-b-9", "topic/dev", "topic/a", "topic/",
    "topic/Dev", "topic/-x", "topic-dev", "broker", "reconcile", "principal-relay", "topic", "Alice", "-x", "--file",
    "", "a".repeat(32), "a".repeat(33), "a.b_c-9", "a".repeat(96), "a".repeat(97), "not a key", "k/1", `topic/${"a".repeat(64)}`, `topic/${"a".repeat(65)}`, "alice@demo.oma.invalid", "a/b"];
  for (const sample of samples) {
    assert.equal(validAddress(sample), isLogicalAddress(sample), `address ${JSON.stringify(sample)}`);
    assert.equal(validActorName(sample), isValidActorName(sample), `actor ${JSON.stringify(sample)}`);
    assert.equal(validRequestKey(sample), isValidRequestKey(sample), `request key ${JSON.stringify(sample)}`);
  }
});
