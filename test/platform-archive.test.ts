/** macos-platform §8.4 (REC-005, MAC-619, MAC-621, MV-33): archives are of
 * stopped societies, carry every file with its sha256, and exist on the Mac
 * only sealed. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { connect, type Server } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame } from "../src/frame.js";
import { readLeadingFrame } from "../src/platform/rpc.js";
import { decryptArchive, encryptArchive } from "../src/platform/host/archive-crypto.js";
import { HostService } from "../src/platform/host/service.js";
import { newHostRecord, writeHostRecord } from "../src/platform/host/record.js";
import type { SessionLauncher } from "../src/platform/guest/host.js";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "../src/protocol/host-guest.js";
import { HOST_API_VERSION } from "../src/protocol/host-api.js";
import { LocalDriver, listenSilently } from "./fixtures/local-guest.js";

const KEY = randomBytes(32);
function sealedRoundTrip(dir: string, plain: Buffer): { sealed: string; open: () => Buffer } {
  const plainPath = join(dir, `p-${randomUUID()}`); writeFileSync(plainPath, plain);
  const sealed = join(dir, `s-${randomUUID()}`);
  encryptArchive(plainPath, sealed, KEY);
  return { sealed, open: () => { const out = join(dir, `o-${randomUUID()}`); decryptArchive(sealed, out, KEY); return readFileSync(out); } };
}
const damaged = (error: unknown) => error instanceof Error && /damaged or was changed/.test(error.message);

test("MAC-621: an archive is sealed in chunks that open only whole, in order, and to the end", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-seal-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const plain = randomBytes(200 * 1024 + 17);
  const round = sealedRoundTrip(dir, plain);
  assert.deepEqual(round.open(), plain);
  assert.equal(readFileSync(round.sealed).includes(plain.subarray(0, 64)), false, "no plain bytes at rest");
  assert.deepEqual(sealedRoundTrip(dir, Buffer.alloc(0)).open(), Buffer.alloc(0));

  const bytes = readFileSync(round.sealed);
  const flipped = Buffer.from(bytes); flipped[100] = flipped[100]! ^ 1; writeFileSync(round.sealed, flipped);
  assert.throws(() => round.open(), damaged, "a changed byte");
  const chunk = 4 + 64 * 1024 + 16;
  writeFileSync(round.sealed, bytes.subarray(0, 16 + 3 * chunk));
  assert.throws(() => round.open(), damaged, "cut after whole chunks: the last one is missing");
  const swapped = Buffer.concat([bytes.subarray(0, 16), bytes.subarray(16 + chunk, 16 + 2 * chunk), bytes.subarray(16, 16 + chunk), bytes.subarray(16 + 2 * chunk)]);
  writeFileSync(round.sealed, swapped);
  assert.throws(() => round.open(), damaged, "chunks out of order");
  writeFileSync(round.sealed, bytes);
  const other = join(dir, "other"); assert.throws(() => decryptArchive(round.sealed, other, randomBytes(32)), damaged, "another key");
});

async function world(t: import("node:test").TestContext, running: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "oma-archive-"));
  const runDir = join(dir, "run"); mkdirSync(runDir);
  const recordPath = join(dir, "host-record.json"); const record = newHostRecord(); writeHostRecord(recordPath, record);
  const societiesDir = join(dir, "data", "oma");
  const root = join(societiesDir, "demo");
  for (const part of ["mail/cur", "repos/project.git/objects", "run"]) mkdirSync(join(root, part), { recursive: true });
  writeFileSync(join(root, "config.json"), "{}"); writeFileSync(join(root, "store.db"), "db"); writeFileSync(join(root, "store.db-wal"), "wal");
  writeFileSync(join(root, "mail/cur/1"), "a letter"); writeFileSync(join(root, "run/broker.sock"), "not kept");
  const holderPath = join(dir, "demo.sock");
  const holder: Server | null = running ? await listenSilently(holderPath) : null;
  const launcher: SessionLauncher = { socketPath: () => holderPath, start: async () => {}, stop: async () => "stopped" };
  const driver = new LocalDriver(dir, { dir: societiesDir, launcher }, record.instanceId);
  const keychain = new Map<string, string>();
  const service = await HostService.start({ runDir, recordPath, driver, uid: process.getuid!(), git: "/usr/bin/git",
    archivesDir: join(dir, "archives"), keychain: { get: async a => keychain.get(a), put: async (a, v) => { keychain.set(a, v); } },
    identity: { hostVersion: "1.0.0", installationId: record.installationId, instanceId: record.instanceId, expectImage: "2026.09.1",
      protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } },
    resolve: async () => { throw new Error("unused"); },
    timings: { handshakeDeadlineMs: 2000, handshakeRetryMs: 20, drainDeadlineMs: 800, healthEveryMs: 1000, hungAfterMs: 2000, restarts: { max: 3, windowMs: 60_000, backoffMs: 20 } } });
  t.after(async () => { await service.shutdown().catch(() => undefined); await driver.dispose(); await new Promise(r => holder === null ? r(null) : holder.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const token = readFileSync(join(runDir, "token"), "utf8").trim();
  const call = async (method: string, params: Record<string, unknown>, key?: string): Promise<Record<string, unknown>> => {
    const socket = connect(join(runDir, "hostapi.sock"));
    await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
    socket.write(encodeFrame({ v: 1, id: "h", method: "hello", params: { api: { min: 1, max: HOST_API_VERSION }, token, client: "oma-cli" } }));
    const hello = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 3000);
    if (hello.rest.length > 0) socket.unshift(hello.rest);
    socket.write(encodeFrame({ v: 1, id: "r", method, params, ...(key === undefined ? {} : { key }) }));
    const answer = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 30_000);
    socket.destroy();
    return answer.frame;
  };
  return { dir, runDir, keychain, call, root };
}

test("§8.4/MV-33: a stopped society's archive holds its files and their manifest, leaves out run/, and is on the Mac only sealed", async t => {
  const { dir, runDir, keychain, call, root } = await world(t, false);
  const answer = await call("archive.create", { society: "demo" }, "archive-1");
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const made = answer.result as { path: string; files: number };
  assert.equal(made.files, 4, "config, DB, WAL and one letter; nothing under run/");
  assert.deepEqual(readdirSync(join(runDir, "transfer")), [], "no plain archive is left behind");
  const plain = join(dir, "opened.tar");
  decryptArchive(made.path, plain, Buffer.from(keychain.get("archive")!, "base64"));
  const listed = spawnSync("tar", ["-tf", plain], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  assert.ok(listed.includes("demo/store.db-wal"), "the WAL goes as a file with the DB: no checkpoint was taken outside the broker");
  assert.ok(listed.includes("manifest.json"));
  assert.equal(listed.some(entry => entry.startsWith("demo/run")), false, "run/ is not archived");
  const out = join(dir, "x"); mkdirSync(out); spawnSync("tar", ["-xf", plain, "-C", out]);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { files: Record<string, string> };
  assert.equal(manifest.files["demo/mail/cur/1"], createHash("sha256").update(readFileSync(join(root, "mail/cur/1"))).digest("hex"));
});

test("REC-005: a running society is not archived", async t => {
  const { call } = await world(t, true);
  const answer = await call("archive.create", { society: "demo" }, "archive-2");
  assert.equal((answer.error as { code: string }).code, "BATCH_CONFLICT");
});
