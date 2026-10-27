import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { NodeIntegrityFiles } from "#oma-test/app/diagnostics/files";
import { receiptExit, receiptLines } from "@oma/protocol/receipts";
import { sha256Hex } from "@oma/domain/canonical-json";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { MAIL_HEADER_BYTES } from "@oma/domain/mail-values";
import { rfc5322Date } from "@oma/mail/headers";
import type { MailHeaderExpectation } from "#oma-test/app/diagnostics/mail";

test("NB-28: receipt presentation cannot invent a failed outcome without a failure", () => {
  const invalid = { operation: generateOperationId(), state: "failed" as const };
  assert.throws(() => receiptExit(invalid), /failed receipt.*failure/);
  assert.throws(() => receiptLines(invalid, "original"), /failed receipt.*failure/);
});

for (const action of ["finishReceipt", "finishUnrecordedReceipt"] as const) {
  test(`NB-28: ${action} refuses a failed receipt without error as unknown`, () => {
    const exits = fileURLToPath(new URL(import.meta.resolve("#oma-test/app/cli/exit")));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { ${action} } from ${JSON.stringify(exits)}; ${action}({operation:${JSON.stringify(generateOperationId())},state:'failed'}, 'original', 'cache unavailable', false);`],
    { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /invalid.*receipt/);
    assert.match(result.stderr, /--request original/);
    assert.doesNotMatch(result.stdout, /Failed:\?/);
  });
}

test("NB-28: immutable mail over the production header bound is corrupt, observation budget stays unknown", t => {
  const home = mkdtempSync(join(tmpdir(), "oma-nb28-header-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const message = generateMessageId(generateOperationId(), 0);
  const mail: MailHeaderExpectation = { society: "fixture", actorNames: new Set(["alice"]), message: {
    id: message, objectPath: `mail/objects/${message}.eml`, bytes: 1, sha256: "a".repeat(64), dateMs: 0,
    to: ["alice"], recipients: ["alice"], kind: "message", contextRevision: null,
    replyHeaders: { replyTo: [], inReplyTo: null, references: [] },
  } };
  const path = join(home, "mail.eml");
  for (const bytes of [Buffer.alloc(256 * 1024 + 1, 120), Buffer.from("x".repeat(256 * 1024 + 1) + "\r\n\r\nbody")]) {
    writeFileSync(path, bytes);
    const expected = { bytes: bytes.length, sha256: sha256Hex(bytes), mail };
    assert.deepEqual(new NodeIntegrityFiles().file(path, expected), { kind: "corrupt", reason: "MAIL_HEADER_INVALID" });
    assert.deepEqual(new NodeIntegrityFiles({ maxFileBytes: 1, maxTotalBytes: 1, maxEntries: 1 }).file(path, expected),
      { kind: "unknown", reason: "FILE_BYTE_BUDGET" });
    assert.deepEqual(readFileSync(path), bytes);
  }
  for (const offset of [-1, 0, 1]) {
    let header = [`Date: ${rfc5322Date(0)}`, "To: alice@fixture.oma.invalid",
      `Message-ID: <${message}@fixture.oma.invalid>`, "X-OMA-Kind: message", "Subject: padding"].join("\r\n");
    let remaining = MAIL_HEADER_BYTES + offset - Buffer.byteLength(header);
    while (remaining > 900) { header += "\r\n " + "x".repeat(897); remaining -= 900; }
    header += remaining < 3 ? "x".repeat(remaining) : "\r\n " + "x".repeat(remaining - 3);
    assert.equal(Buffer.byteLength(header), MAIL_HEADER_BYTES + offset);
    const bytes = Buffer.from(header + "\r\n\r\n" + "body".repeat(1024));
    writeFileSync(path, bytes);
    assert.equal(new NodeIntegrityFiles().file(path, { bytes: bytes.length, sha256: sha256Hex(bytes), mail }).kind,
      offset > 0 ? "corrupt" : "present", `header offset ${offset}`);
  }
});

test("NB-28: actual Mac CLI status is stdout, consistent with list", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-nb28-mac-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "run"));
  writeFileSync(join(home, "run/token"), "fixture-token");
  const methods: string[] = [];
  const server = createServer(socket => {
    const parser = new FrameParser(256 * 1024);
    socket.on("error", () => {});
    socket.on("data", (bytes: Buffer) => {
      for (const frame of parser.feed(bytes)) {
        methods.push(String(frame.raw.method));
        socket.write(encodeFrame({ v: 1, id: frame.raw.id, ok: true,
          result: frame.raw.method === "engine.status" ? { state: "ready" }
            : frame.raw.method === "society.list" ? { societies: [{ society: "demo", running: true }] } : {} }));
      }
    });
  });
  t.after(() => server.close());
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(join(home, "run/hostapi.sock"), resolve); });
  const entry = fileURLToPath(new URL("../../apps/oma/dist/entry/oma-mac.js", import.meta.url));
  for (const [command, expected] of [["status", "OMA engine: Running\n"], ["list", "demo\tRunning\n"]]) {
    const result = await new Promise<{ code: number | string; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, [entry, command!], { cwd: home, encoding: "utf8", timeout: 10000,
        env: { ...process.env, HOME: home, OMA_HOST_HOME: home } },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  }
  assert.deepEqual(methods, ["hello", "engine.status", "hello", "society.list"]);
});
