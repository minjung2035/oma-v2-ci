/** T114 / PR-001, PI-001: the private channel as each end reads it.
 *
 * The trusted extension may not import OMA's protocol module, so it mirrors the
 * channel's names and credential line. These tests hold the mirror to the
 * original on every line either end could see, and exercise the extension's
 * reader, the CLI's reader and the extension's bounded mail read directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  HOST_CHANNEL_ENV, HOST_CHANNEL_FD, HOST_CHANNEL_LINE_BYTES, HostChannelReader, decodeHostMessage, encodeHostMessage,
  type HostChannelMessage,
} from "../src/protocol/host-channel.js";
import { CLI_CREDENTIAL_FD_ENV as CLI_READS } from "../src/cli/transport.js";
import { CHANNEL_FD as SPAWN_CHANNEL_FD, SOCIETY_FENCE_ENV as HOST_DECLARES, SOCIETY_FENCE_FD as HOST_PLACES } from "../src/process/async.js";
import {
  CLI_CREDENTIAL_FD_ENV as EXTENSION_SETS, PRINCIPAL_CHANNEL_ENV, PRINCIPAL_CHANNEL_FD, PrincipalChannel, registerOmaTools,
  SOCIETY_FENCE_ENV as EXTENSION_READS, SOCIETY_FENCE_FD as EXTENSION_PLACES, runCliProcess,
} from "../src/pi-extension.js";

const CREDENTIAL = "c".repeat(64);
const HANDLE = "d".repeat(32);

/** Every shape a line on the channel could take: valid ones of each kind, and
 * the near misses a hand-written parser gets wrong. */
const CORPUS: readonly string[] = [
  `credential ${CREDENTIAL} ${HANDLE}`,
  `credential ${"0".repeat(64)} ${"f".repeat(32)}`,
  "ready", `refused ${HANDLE}`, `session ${HANDLE} 4242`,
  `credential ${CREDENTIAL.toUpperCase()} ${HANDLE}`,
  `credential ${CREDENTIAL.slice(1)} ${HANDLE}`,
  `credential ${CREDENTIAL}a ${HANDLE}`,
  `credential ${CREDENTIAL} ${HANDLE.slice(1)}`,
  `credential  ${CREDENTIAL} ${HANDLE}`,
  `credential ${CREDENTIAL} ${HANDLE} `,
  ` credential ${CREDENTIAL} ${HANDLE}`,
  `credential ${CREDENTIAL}`,
  `credential ${CREDENTIAL} ${HANDLE} extra`,
  `CREDENTIAL ${CREDENTIAL} ${HANDLE}`,
  "", "readyx", "session x 1", `session ${HANDLE} 0`, `session ${HANDLE} 1`, `session ${HANDLE} -5`,
  `session ${HANDLE} 99999999999`,
  // A refusal that names nothing, or names something that is not a handle, is
  // not a message: it could otherwise be read as the answer to whatever
  // registration happened to be waiting when it landed.
  "refused", "refused ", `refused ${HANDLE.slice(1)}`, `refused ${HANDLE}a`, `refused ${HANDLE.toUpperCase()}`,
  `refused ${HANDLE} ${HANDLE}`,
];

test("T114: the extension's channel names are the protocol's", () => {
  assert.equal(PRINCIPAL_CHANNEL_ENV, HOST_CHANNEL_ENV);
  assert.equal(PRINCIPAL_CHANNEL_FD, HOST_CHANNEL_FD);
  // The slot the spawn helpers lay out the channel on is the slot the protocol
  // says the channel is. They are separate constants because the spawn helper
  // may not import the protocol, and a drift between them would move the
  // credential out from under the reader waiting for it.
  assert.equal(SPAWN_CHANNEL_FD, HOST_CHANNEL_FD);
  // The descriptor the extension names for the CLI is the one the CLI reads.
  assert.equal(EXTENSION_SETS, CLI_READS);
  // And the society lease: the extension may not import OMA's process module,
  // so it mirrors the name and the number the host places the lease on. A
  // mirror that drifted would be the worst of both -- the host would hand the
  // engine a fence the extension looked for somewhere else, and the CLI would
  // start unfenced while every fence test in the suite went on passing.
  assert.equal(EXTENSION_READS, HOST_DECLARES);
  assert.equal(EXTENSION_PLACES, HOST_PLACES);
  // Nothing may share the credential's descriptor with the lease.
  assert.notEqual(EXTENSION_PLACES, PRINCIPAL_CHANNEL_FD);
});

test("T114: the extension accepts exactly the credential lines the protocol decodes", () => {
  for (const line of CORPUS) {
    const decoded = decodeHostMessage(line);
    const channel = PrincipalChannel.detached();
    channel.push(`${line}\n`);
    const held = channel.current();
    if (decoded?.kind === "credential")
      assert.deepEqual(held, { credential: decoded.credential, sessionHandle: decoded.sessionHandle }, `mirror refused ${JSON.stringify(line)}`);
    else
      assert.equal(held, null, `mirror accepted ${JSON.stringify(line)} which the protocol does not decode as a credential`);
  }
});

test("T114: the protocol round-trips what it encodes and refuses what it cannot", () => {
  const messages: HostChannelMessage[] = [
    { kind: "ready" }, { kind: "refused", sessionHandle: HANDLE },
    { kind: "session", sessionHandle: HANDLE, pid: 4242 },
    { kind: "credential", credential: CREDENTIAL, sessionHandle: HANDLE },
  ];
  for (const message of messages) {
    const line = encodeHostMessage(message);
    assert.ok(line.endsWith("\n") && Buffer.byteLength(line) <= HOST_CHANNEL_LINE_BYTES + 1);
    assert.deepEqual(decodeHostMessage(line.slice(0, -1)), message);
  }
  for (const bad of [
    { kind: "session", sessionHandle: "x", pid: 4242 }, { kind: "session", sessionHandle: HANDLE, pid: 1 },
    { kind: "credential", credential: "x", sessionHandle: HANDLE }, { kind: "credential", credential: CREDENTIAL, sessionHandle: "x" },
    { kind: "refused", sessionHandle: "x" }, { kind: "refused", sessionHandle: "" },
  ] as HostChannelMessage[])
    assert.throws(() => encodeHostMessage(bad), TypeError);
});

test("T114: a reader splits, joins and stops at the first thing that is not a message", () => {
  const seen: HostChannelMessage[] = [];
  let broken: string | null = null;
  const reader = new HostChannelReader(message => seen.push(message), reason => { broken = reason; });
  // One message split across chunks, then two in one chunk.
  reader.push("rea"); reader.push(`dy\nrefused ${HANDLE}\nready\n`);
  assert.deepEqual(seen.map(message => message.kind), ["ready", "refused", "ready"]);
  assert.equal(broken, null);
  // A byte outside the grammar breaks the channel, and nothing after is taken.
  reader.push("ready\u0000\n");
  assert.ok(broken);
  reader.push("ready\n");
  assert.equal(seen.length, 3);
  // An over-long partial line breaks it too, without waiting for a newline.
  let longBroken = false;
  const long = new HostChannelReader(() => {}, () => { longBroken = true; });
  long.push("x".repeat(HOST_CHANNEL_LINE_BYTES + 1));
  assert.ok(longBroken, "an unbounded partial line was buffered");
});

test("T114: the extension keeps the latest credential and drops it if the channel lies", () => {
  const channel = PrincipalChannel.detached();
  channel.push(`credential ${CREDENTIAL} ${HANDLE}\ncredential ${"e".repeat(64)} ${HANDLE}\n`);
  assert.equal(channel.current()?.credential, "e".repeat(64), "a replacement credential was not taken");
  // Anything else on the channel means it is not the channel it should be: the
  // credential it held is dropped and none is taken afterwards.
  channel.push("ready\n");
  assert.equal(channel.current(), null);
  channel.push(`credential ${CREDENTIAL} ${HANDLE}\n`);
  assert.equal(channel.current(), null);
  const overlong = PrincipalChannel.detached();
  overlong.push("c".repeat(HOST_CHANNEL_LINE_BYTES + 1));
  assert.equal(overlong.current(), null);
});

test("T114: an engine started without the product's channel holds nothing", () => {
  // A Resident's engine: no marker, so descriptor 3 is not even looked at.
  assert.equal(PrincipalChannel.open({}).current(), null);
  // A marker naming another descriptor is not this product's channel.
  assert.equal(PrincipalChannel.open({ [PRINCIPAL_CHANNEL_ENV]: "4" }).current(), null);
});

/** Runs the real CLI transport's reader in a child with `fd3` as descriptor 3. */
function cliReads(fd3: "socket" | "none" | "file", line: string | null): Promise<string> {
  const script = `
    import { callActor } from ${JSON.stringify(join(process.cwd(), "dist/src/cli/transport.js"))};
    try { await callActor("/nonexistent/socket", "status.get", {}); process.stdout.write("no error"); }
    catch (error) { process.stdout.write(String(error.code ?? error.message) + ":" + String(error.message)); }
  `;
  const scratch = mkdtempSync(join(tmpdir(), "oma-cli-fd-"));
  const stdio: ("ignore" | "pipe" | "inherit" | number)[] = ["ignore", "pipe", "inherit"];
  let fileFd: number | null = null;
  if (fd3 === "socket") stdio.push("pipe");
  if (fd3 === "file") {
    writeFileSync(join(scratch, "cred"), line ?? "");
    fileFd = openSync(join(scratch, "cred"), "r");
    stdio.push(fileFd);
  }
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script],
      { env: { PATH: "/usr/bin:/bin", [CLI_READS]: "3" }, stdio });
    if (fileFd !== null) closeSync(fileFd);
    if (fd3 === "socket") {
      const socket = child.stdio[3] as unknown as { end(text?: string): void; on(event: string, fn: () => void): void };
      socket.on("error", () => {});
      if (line === null) socket.end(); else socket.end(line);
    }
    let out = "";
    child.stdout!.on("data", chunk => { out += String(chunk); });
    child.once("close", () => { rmSync(scratch, { recursive: true, force: true }); resolve(out); });
  });
}

test("T114: the CLI takes the credential only from a private socket, and only a well-formed one", async () => {
  // A well-formed line on a socket is read, and the CLI goes on to connect --
  // failing only because there is no broker at that path.
  assert.match(await cliReads("socket", `credential ${CREDENTIAL} ${HANDLE}\n`), /BROKER_UNAVAILABLE|ENOENT|connect/);
  // A regular file where the socket should be -- the kind of descriptor another
  // process could have prepared -- is refused before anything is read.
  assert.match(await cliReads("file", `credential ${CREDENTIAL} ${HANDLE}\n`), /AUTH_FAILED:.*private socket/);
  // Declared but not attached. Descriptor 3 may be closed, or be one the runtime
  // opened for itself; either way it is refused before anything is read.
  assert.match(await cliReads("none", null), /AUTH_FAILED:.*(not open|not a private socket)/);
  // Malformed, missing newline, or something other than a credential.
  for (const bad of [`credential ${CREDENTIAL} ${HANDLE}`, "ready\n", `credential x ${HANDLE}\n`, ""])
    assert.match(await cliReads("socket", bad), /AUTH_FAILED:.*malformed/, `accepted ${JSON.stringify(bad)}`);
});

test("T114: reading mail never returns more than its bound, even while the file grows", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mail-grow-"));
  const maximum = 4096;
  const id = `m-${randomUUID()}-0`;
  const path = join(root, `${id}:2,`);
  writeFileSync(path, "x".repeat(1024));
  const previous = { ...process.env };
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
  Object.assign(process.env, {
    OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: root,
    OMA_SOCKET: "/nonexistent/socket", OMA_MAIL_BYTES: String(maximum),
  });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  // Another process of the same user appends while the tool reads: read-only
  // mode does not stop it, and a read that trusted its earlier size check
  // would hand back whatever the file had grown to.
  // The writer keeps the file straddling the bound -- cut back below it, then
  // grown past it, over and over -- so every read has a window in which the
  // size it checked is under the bound and the bytes it reads are not.
  const writer = spawn(process.execPath, ["-e", `
    const fs = require("node:fs");
    const fd = fs.openSync(${JSON.stringify(path)}, "r+");
    process.stdout.write("started\\n");
    const below = ${maximum - 512}, above = ${maximum + 2048};
    for (;;) {
      fs.ftruncateSync(fd, below);
      for (let at = below; at < above; at += 64) fs.writeSync(fd, "y".repeat(64), at, "latin1");
    }
  `], { stdio: ["ignore", "pipe", "ignore"] });
  // Reads begin only once the writer is really writing; before that there is
  // no growth to race against and the test would prove nothing.
  await new Promise<void>(resolve => { writer.stdout!.once("data", () => resolve()); });
  let successes = 0; let refused = 0; let raced = 0; let largest = 0; let peak = 0;
  try {
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      // Measured here rather than on a timer: this loop never yields to one.
      peak = Math.max(peak, statSync(path).size);
      try {
        const result = await tools.get("oma_mail_read")!.execute("r", { messageId: id });
        const bytes = Buffer.byteLength(result.content[0]!.text);
        assert.ok(bytes <= maximum, `a read returned ${bytes} bytes past its ${maximum}-byte bound`);
        largest = Math.max(largest, bytes);
        successes += 1;
      } catch (error) {
        const message = String((error as Error).message);
        assert.match(message, /bounded regular file|grew|changed|truncated/);
        if (/grew|changed|truncated/.test(message)) raced += 1;
        refused += 1;
      }
    }
  } finally {
    writer.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
  // The file was read while it was growing (sizes above the starting one were
  // seen) and after it passed the bound (reads were refused), so the bound was
  // exercised on both sides. A race inside a single read shows up as "grew" or
  // "changed" and is reported, never returned.
  assert.ok(largest > 1024, `no read ever saw the file growing (largest ${largest})`);
  assert.ok(refused > 0, "no read was refused while the file changed under it");
  assert.ok(peak > maximum, `the writer never took the file past the bound (peak ${peak}); the race was not exercised`);
  process.stderr.write(`# bounded read: ${successes} within the bound, ${refused} refused, ${raced} caught mid-read\n`);
});

test("T114: the CLI's output cap counts bytes, not decoded characters", async () => {
  // A UTF-8 character is up to four bytes, so a cap on decoded string length
  // would hold several times the bytes it claims. The child writes far more
  // than the cap in three-byte characters; the owner must stop it at the
  // declared bound.
  const cap = 1024 * 1024;
  const flood = `
    const chunk = "가".repeat(64 * 1024);
    for (let i = 0; i < 64; i++) process.stdout.write(chunk);
  `;
  const result = await runCliProcess({
    node: process.execPath, cli: "--input-type=module", args: ["-e", flood],
    cwd: process.cwd(), env: { PATH: "/usr/bin:/bin" }, grant: null, timeoutMs: 30_000,
  });
  assert.ok(Buffer.byteLength(result.stdout) <= cap,
    `the CLI's output kept ${Buffer.byteLength(result.stdout)} bytes past a ${cap}-byte cap`);
});
