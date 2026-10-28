/** Actual Swift child framing and EOF, without accessing credentials.
 * Registered only on Darwin; source recipe inspection is not runtime proof. */
import test from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { once } from "node:events";
import { setImmediate } from "node:timers/promises";
import { join } from "node:path";
import { MAC_HELPER_SOURCES } from "@oma/platform-mac/native-assets";
import { controlSocketPair } from "@oma/native/control-socket";
import { closeEvery } from "@oma/native/files";


if (process.platform === "darwin") {
  const executable = join(MAC_HELPER_SOURCES, "oma-keychain");
  async function run(t, fragments, replyBeforeEOF = false) {
    assert.ok(statSync(executable).isFile());
    const pair = controlSocketPair();
    let parent = pair.parent, childFd = pair.child, channel, child;
    let closed, output = Buffer.alloc(0), stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
    let frameSeen;
    const completeFrame = new Promise(resolve => { frameSeen = resolve; });
    try {
      channel = new Socket({ fd: parent, readable: true, writable: true }); parent = undefined;
      channel.on("error", () => {});
      channel.on("data", bytes => {
        output = Buffer.concat([output, bytes]);
        if (output.includes(10)) frameSeen();
      });
      const channelClosed = new Promise(resolve => channel.once("close", resolve));
      child = spawn(executable, [], { env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe", childFd] });
      closed = once(child, "close");
      void closed.catch(() => {});
      const transferred = childFd; childFd = undefined; closeEvery(transferred);
      child.stdout.on("data", bytes => { stdout = Buffer.concat([stdout, bytes]); });
      child.stderr.on("data", bytes => { stderr = Buffer.concat([stderr, bytes]); });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5000); deadline.unref();
      t.after(async () => {
        clearTimeout(deadline); channel.destroy();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await Promise.allSettled([closed, channelClosed]);
      });
      for (const bytes of fragments) { channel.write(bytes); await setImmediate(); }
      if (replyBeforeEOF) {
        await Promise.race([completeFrame, closed.then(() => {
          throw new Error("Keychain helper closed before answering the complete frame on its live channel");
        })]);
        assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      }
      channel.end();
      const [code, signal] = await closed; await channelClosed;
      assert.equal(signal, null); assert.equal(stdout.length, 0); assert.equal(stderr.length, 0);
      t.diagnostic(JSON.stringify({ executable, code, signal, responseBytes: output.length }));
      return { code, output };
    } catch (error) {
      channel?.destroy(); child?.kill("SIGKILL");
      if (closed) await Promise.allSettled([closed]);
      throw error;
    } finally { closeEvery(parent, childFd); }
  }
  test("Darwin Keychain helper: compiled image answers fragmented control without credential access", { timeout: 10000 }, async t => {
    const request = Buffer.from(JSON.stringify({ id: 1, op: "fixture-only", account: "fixture-한글" }) + "\n");
    const answer = await run(t, [...request].map(byte => Buffer.from([byte])), true);
    assert.equal(answer.code, 0);
    const response = JSON.parse(answer.output.toString("utf8"));
    assert.equal(response.id, 1); assert.equal(response.ok, false);
    assert.equal(typeof response.error, "string");
  });
  test("Darwin Keychain helper: supervision EOF ends the actual child", { timeout: 10000 }, async t => {
    const answer = await run(t, []); assert.equal(answer.code, 0); assert.equal(answer.output.length, 0);
  });
  for (const [name, input] of [
    ["malformed JSON", Buffer.from("not-json\n")],
    ["unterminated frame", Buffer.from('{"id":1')],
    ["invalid UTF-8", Buffer.from([0xff, 10])],
    ["unexpected credential request fields", Buffer.from('{"id":1,"op":"keychain.get","account":"fixture-only","extra":true}\n')],
  ]) test(`Darwin Keychain helper: ${name} exits before credential access`, { timeout: 10000 }, async t => {
    const answer = await run(t, [input]); assert.equal(answer.code, 2); assert.equal(answer.output.length, 0);
  });
}
