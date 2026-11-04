/** Execute the real portable C decoder. This proves private byte framing,
 * never Mach origin, suspended exec, scope death or installed image safety. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { encodeDarwinJob } from "../dist/job-launch.js";

test("001. Frozen private job bytes reach the C decoder exactly, and malformed or partial frames refuse", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-job-config-"));
  t.after(() => rmSync(root, { recursive: true }));
  const executable = join(root, "decode"), include = fileURLToPath(new URL("../src/job-helper", import.meta.url));
  const fixture = fileURLToPath(new URL("../../../test/fixtures/darwin-job-config.c", import.meta.url));
  const built = spawnSync(process.platform === "darwin" ? "/usr/bin/xcrun" : "/usr/bin/cc",
    [...(process.platform === "darwin" ? ["clang"] : []), "-Wall", "-Wextra", "-Werror", "-I", include, fixture, "-o", executable],
    { encoding: "utf8", timeout: 30000 });
  assert.equal(built.error, undefined); assert.equal(built.signal, null); assert.equal(built.status, 0, built.stderr);
  const observe = input => spawnSync(executable, [], { input, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
  const command = { executable: "/literal/node", argv: ["", "a\nb", "한글", "$() `quoted`"],
    env: { EMPTY: "", VALUE: "x=y\nz", OMIT: undefined }, timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 };
  const slots = [0, 1, 2, 7, 3], frame = Buffer.from(encodeDarwinJob(command, slots, 2, true));
  command.argv.fill("changed"); command.env.VALUE = "changed"; slots[3] = 99;
  const original = observe(frame);
  assert.equal(original.error, undefined); assert.equal(original.signal, null); assert.equal(original.status, 0, original.stderr);
  assert.equal(original.stdout, "2 1\n0 1 2 7 3 \n13:/literal/node\n0:\n3:a\nb\n6:한글\n12:$() `quoted`\n\n6:EMPTY=\n11:VALUE=x=y\nz\n\n");
  const single = observe(encodeDarwinJob({ ...command, argv: [], env: {} }, [0, 1, 2], 1));
  assert.equal(single.status, 0, single.stderr); assert.equal(single.stdout, "1 0\n0 1 2 \n13:/literal/node\n\n\n");
  const peer = [501, 501, 20, 501, 20, 4100, 100001, 42];
  const bound = Buffer.from(encodeDarwinJob({ ...command, argv: [], env: {} }, [0, 1, 2], 1, false, peer));
  peer.fill(0);
  const boundResult = observe(bound); assert.equal(boundResult.status, 0, boundResult.stderr);
  assert.equal(boundResult.stdout, "1 0\n0 1 2 \n501 501 20 501 20 4100 100001 42 \n13:/literal/node\n\n\n");
  for (const corrupt of [bytes => bytes.writeUInt32LE(0, 44 + 5 * 4), bytes => bytes.writeUInt32LE(0, 44 + 7 * 4),
    bytes => bytes.writeUInt32LE(4, 28), bytes => bytes.write("OMAJOB1", 0, "ascii")]) {
    const bytes = Buffer.from(bound); corrupt(bytes); assert.equal(observe(bytes).status, 125);
  }
  assert.throws(() => encodeDarwinJob(command, [0, 1, 2], 1, false, peer), { code: "UNSUPPORTED_PROFILE" });
  for (const size of [0, 7, 31, 32, frame.length - 1]) {
    const refused = observe(frame.subarray(0, size)); assert.equal(refused.status, 125, refused.stderr);
  }
  const corruptions = [bytes => bytes[0] ^= 1, bytes => bytes.writeUInt32LE(262145, 8),
    bytes => bytes.writeUInt32LE(0, 12), bytes => bytes.writeUInt32LE(4097, 16),
    bytes => bytes.writeUInt32LE(129, 20), bytes => bytes.writeUInt32LE(3, 24),
    bytes => bytes.writeUInt32LE(4, 28), bytes => bytes.writeUInt32LE(65536, 32),
    bytes => bytes.writeUInt32LE(0, 36), bytes => bytes.writeUInt32LE(4, 40),
    bytes => bytes.writeUInt32LE(0xffffffff, 52), bytes => bytes[56] = 0,
    bytes => bytes[56] = 46, bytes => bytes.write("EMPTY", bytes.indexOf("VALUE=")),
    bytes => bytes[bytes.indexOf("EMPTY=")] = 61];
  for (const corrupt of corruptions) {
    const bytes = Buffer.from(frame); corrupt(bytes);
    const refused = observe(bytes); assert.equal(refused.status, 125, refused.stderr);
  }
  const trailing = observe(Buffer.concat([frame, Buffer.from([0])])); assert.equal(trailing.status, 125);
  for (const descriptors of [[0, 1], [0, 1, 1, 2], [0, 1, 2, -1], [0, 1, 2, 65536]])
    assert.throws(() => encodeDarwinJob(command, descriptors, 1), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => encodeDarwinJob({ ...command, argv: ["x".repeat(262144)] }, [0, 1, 2], 1), { code: "UNSUPPORTED_PROFILE" });
});
