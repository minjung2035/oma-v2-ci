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
import { startEgressBridge } from "@oma/extension/egress-bridge";
import { startInferenceBridge } from "@oma/extension/inference-bridge";
async function takenPort(t) {
    const blocker = createServer();
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    t.after(() => blocker.close());
    return blocker.address().port;
}
/** One env pair, restored after the test. */
function env(t, name, value) {
    const saved = process.env[name];
    process.env[name] = value;
    t.after(() => { if (saved === undefined)
        delete process.env[name];
    else
        process.env[name] = saved; });
}
/** A dead stderr for the duration of `attempt`; everything that reached the
 * process anyway is returned. */
async function withDeadStderr(t, attempt) {
    const write = process.stderr.write;
    process.stderr.write = () => { throw new Error("stderr is dead"); };
    const escaped = [];
    const onUncaught = (error) => { escaped.push(error); };
    process.once("uncaughtException", onUncaught);
    t.after(() => { process.stderr.write = write; process.off("uncaughtException", onUncaught); });
    try {
        await Promise.race([
            attempt(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("the bridge wedged behind its own error journal")), 2000)),
        ]);
    }
    finally {
        process.stderr.write = write;
    }
    return escaped;
}
test("post-listen: a dead stderr cannot make the egress bridge's error emit escape", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    env(t, "OMA_EGRESS_PROXY_SOCKET", join(dir, "egress.sock"));
    env(t, "OMA_EGRESS_PROXY_PORT", String(await takenPort(t)));
    const pi = { on: () => { } };
    const escaped = await withDeadStderr(t, () => startEgressBridge(pi));
    assert.deepEqual(escaped, [], "the journal's throw escaped the emit");
});
test("post-listen: a dead stderr cannot make the inference bridge's error emit escape either", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    env(t, "OMA_INFERENCE_SOCKET", join(dir, "inference.sock"));
    env(t, "OMA_INFERENCE_PROVIDER", "test-provider");
    env(t, "OMA_INFERENCE_KEY", "placeholder");
    env(t, "OMA_INFERENCE_PORT", String(await takenPort(t)));
    const registered = [];
    const pi = { on: () => { }, registerProvider: (_name, options) => { registered.push(options.baseUrl); } };
    const escaped = await withDeadStderr(t, () => startInferenceBridge(pi));
    assert.deepEqual(escaped, [], "a throw inside the listener escaped the emit");
    // The refused bind still retries onto port 0 and lands the provider on
    // the real address -- the guarded journal could not interrupt the retry.
    const last = registered.at(-1);
    assert.match(last, /^http:\/\/127\.0\.0\.1:\d+$/, "the fallback listener supplies its real address");
    assert.notEqual(new URL(last).port, "0");
});
test("post-listen: a refused re-register inside the 'listening' emit keeps the unreachable provider and still resolves", async (t) => {
    // 'listening' is the same synchronous emit boundary as 'error': a
    // registerProvider refusal escaping it kills the engine. The refused
    // registration leaves the unreachable provider the pre-listen register
    // installed -- the relay listens unused rather than the engine
    // bypassing it -- and the emit still reaches resolve.
    const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    env(t, "OMA_INFERENCE_SOCKET", join(dir, "inference.sock"));
    env(t, "OMA_INFERENCE_PROVIDER", "test-provider");
    env(t, "OMA_INFERENCE_KEY", "placeholder");
    // The planned bind is refused so the fallback lands 'listening' -- the
    // same emit either way, and the retry path stays deterministic.
    env(t, "OMA_INFERENCE_PORT", String(await takenPort(t)));
    const registered = [];
    const shutdownHandlers = [];
    const pi = {
        // The bridge's only handle back to its server is the shutdown hook it
        // registers: captured here so an emit that escaped (and so never
        // reached unref/resolve) can still be torn down and the process exit.
        on: (event, handler) => { if (event === "session_shutdown")
            shutdownHandlers.push(handler); },
        registerProvider: (_name, options) => {
            if (options.baseUrl !== "http://127.0.0.1:0")
                throw new Error("registerProvider refused the relay address");
            registered.push(options.baseUrl);
        },
    };
    t.after(() => { for (const handler of shutdownHandlers)
        handler(); });
    const escaped = [];
    const onUncaught = (error) => { escaped.push(error); };
    process.once("uncaughtException", onUncaught);
    t.after(() => { process.off("uncaughtException", onUncaught); });
    const lines = [];
    const write = process.stderr.write;
    process.stderr.write = ((chunk) => { lines.push(String(chunk)); return true; });
    t.after(() => { process.stderr.write = write; });
    await Promise.race([
        startInferenceBridge(pi),
        new Promise((_, reject) => setTimeout(() => reject(new Error("the emit wedged behind its own refusal")), 2000)),
    ]);
    assert.deepEqual(escaped, [], "the refused re-register escaped the 'listening' emit");
    assert.deepEqual(registered, ["http://127.0.0.1:0", "http://127.0.0.1:0"], "only the unreachable provider ever registered -- the refused re-register left it standing");
    assert.ok(lines.some(line => line.includes("provider registration refused")), "the refusal reached the journal");
});
