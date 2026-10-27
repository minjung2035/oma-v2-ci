/** Build/installation contract on every host. Actual Swift process cases are
 * registered only on Darwin and never read/write a Keychain credential. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { once } from "node:events";
import { setImmediate } from "node:timers/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { darwinExecutables } from "../scripts/workspace-executables.mjs";
import { bundledKeychainHelper } from "@oma/platform-mac/keychain-client";
import { MAC_HELPER_SOURCES } from "@oma/platform-mac/native-assets";
import { controlSocketPair } from "@oma/native/control-socket";
import { closeEvery } from "@oma/native/files";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "packages/platform-mac/package.json"), "utf8"));
test("Keychain helper build produces the executable selected by the installed client", () => {
  const output = relative(join(root, "packages/platform-mac/dist"), bundledKeychainHelper(root));
  const recipe = darwinExecutables(manifest).find(row => row.output === output);
  assert.ok(recipe, "Personal requires a compiled helper, not only copied Swift sources");
  assert.equal(resolve(root, "packages/platform-mac/src", recipe.source), resolve(root, "packages/platform-mac/src/keychain/main.swift"));
});

if (process.platform === "darwin") {
  const executable = join(MAC_HELPER_SOURCES, "oma-keychain");
  async function run(t, fragments) {
    assert.ok(statSync(executable).isFile());
    const pair = controlSocketPair();
    let parent = pair.parent, childFd = pair.child, channel, child;
    let closed, output = Buffer.alloc(0), stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
    try {
      channel = new Socket({ fd: parent, readable: true, writable: true }); parent = undefined;
      channel.on("error", () => {});
      channel.on("data", bytes => { output = Buffer.concat([output, bytes]); });
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
    const answer = await run(t, [...request].map(byte => Buffer.from([byte])));
    assert.equal(answer.code, 0);
    assert.deepEqual(JSON.parse(answer.output.toString("utf8")), { id: 1, ok: false, error: "Unknown credential operation" });
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
