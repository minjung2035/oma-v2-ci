/** The bridge listeners' own journals must not be able to throw out of
 * their 'error' emits: a dead or failing stderr inside the handler is the
 * same synchronous escape the listener exists to absorb. A refused bind is
 * how the emit is reached honestly; the oracle is that each bridge's
 * degraded answer still resolves instead of wedging behind the write. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { startEgressBridge } from "../src/extension/egress-bridge.js";
import { startInferenceBridge } from "../src/extension/inference-bridge.js";

async function takenPort(t: { after(fn: () => void): void }): Promise<number> {
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  t.after(() => blocker.close());
  return (blocker.address() as { port: number }).port;
}

/** One env pair, restored after the test. */
function env(t: { after(fn: () => void): void }, name: string, value: string): void {
  const saved = process.env[name];
  process.env[name] = value;
  t.after(() => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; });
}

/** A dead stderr for the duration of `attempt`; everything that reached the
 * process anyway is returned. */
async function withDeadStderr(t: { after(fn: () => void): void }, attempt: () => Promise<unknown>): Promise<unknown[]> {
  const write = process.stderr.write;
  process.stderr.write = () => { throw new Error("stderr is dead"); };
  const escaped: unknown[] = [];
  const onUncaught = (error: Error) => { escaped.push(error); };
  process.once("uncaughtException", onUncaught);
  t.after(() => { process.stderr.write = write; process.off("uncaughtException", onUncaught); });
  try {
    await Promise.race([
      attempt(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the bridge wedged behind its own error journal")), 2000)),
    ]);
  } finally { process.stderr.write = write; }
  return escaped;
}

test("post-listen: a dead stderr cannot make the egress bridge's error emit escape", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  env(t, "OMA_EGRESS_PROXY_SOCKET", join(dir, "egress.sock"));
  env(t, "OMA_EGRESS_PROXY_PORT", String(await takenPort(t)));
  const pi = { on: () => {} };
  const escaped = await withDeadStderr(t, () => startEgressBridge(pi as never));
  assert.deepEqual(escaped, [], "the journal's throw escaped the emit");
});

test("post-listen: a dead stderr cannot make the inference bridge's error emit escape either", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  env(t, "OMA_INFERENCE_SOCKET", join(dir, "inference.sock"));
  env(t, "OMA_INFERENCE_PROVIDER", "test-provider");
  env(t, "OMA_INFERENCE_KEY", "placeholder");
  env(t, "OMA_INFERENCE_PORT", String(await takenPort(t)));
  const registered: string[] = [];
  const pi = { on: () => {}, registerProvider: (_name: string, options: { baseUrl: string }) => { registered.push(options.baseUrl); } };
  const escaped = await withDeadStderr(t, () => startInferenceBridge(pi as never));
  assert.deepEqual(escaped, [], "a throw inside the listener escaped the emit");
  // The refused bind still retries onto port 0 and lands the provider on
  // the real address -- the guarded journal could not interrupt the retry.
  const last = registered.at(-1)!;
  assert.match(last, /^http:\/\/127\.0\.0\.1:\d+$/, "the fallback listener supplies its real address");
  assert.notEqual(new URL(last).port, "0");
});
