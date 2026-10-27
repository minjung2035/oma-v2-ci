/** Installed artifact probe: actual SDK settings and owned child transport. No provider turn. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { spawnOwnedRpc } from "@oma/process/async";
import { PiRpcClient } from "@oma/engine/pi-rpc";
import { preparePiRetry } from "@oma/engine/pi-runtime";
import { prepareEngineInteractiveSettings } from "@oma/engine/pi-compat/settings";

let settings = JSON.stringify({ theme: "chosen", quietStartup: "header", retry: { provider: { timeoutMs: 321 } } });
let holds = 0;
const files = {
  withOwnedFile(_dir, name, body) {
    assert.equal(name, "settings.json"); assert.equal(holds++, 0);
    try { const next = body(settings); if (next !== undefined) settings = next; }
    finally { holds--; }
  },
  withProjectSettings() { throw new Error("not a project settings operation"); },
  ensureThemes() { throw new Error("not a theme operation"); },
};
preparePiRetry(files, "/owned-engine");
prepareEngineInteractiveSettings(files, "/owned-engine");
const saved = JSON.parse(settings);
assert.equal(saved.retry.maxRetries, 5); assert.equal(saved.retry.provider.maxRetries, 0);
assert.equal(saved.retry.provider.timeoutMs, 321); assert.equal(saved.theme, "chosen");
assert.equal(saved.quietStartup, "header"); assert.equal(saved.enableAnalytics, false);
assert.equal(holds, 0);

const child = spawnOwnedRpc(process.execPath, ["--input-type=module", "-e",
  String.raw`process.stdin.once("data", data => { const request = JSON.parse(data); process.stdout.write(JSON.stringify({type:"response",command:request.type,id:request.id,success:true})+"\n"); });`], tmpdir(), {});
const exited = once(child, "close");
const rpc = new PiRpcClient(child, { frameBytes: 4096, idleStreamSeconds: 3, receiptWaitSeconds: 3 });
const response = new Promise((resolve, reject) => {
  rpc.onEvent(resolve);
  void rpc.completion.then(result => reject(new Error("installed child ended before its response", { cause: result })));
});
try {
  await rpc.send({ type: "get_state", id: "installed" });
  assert.deepEqual(await response, { type: "response", command: "get_state", id: "installed", success: true });
} finally { rpc.close(); await exited; }
assert.ok(child.exitCode !== null || child.signalCode !== null);
for (const missing of ["@oma/storage", "@oma/mail", "@oma/config", "@oma/tui", "@oma/broker"])
  assert.throws(() => import.meta.resolve(missing), { code: "ERR_MODULE_NOT_FOUND" });

// The checked adapter and its compiler-owned JSON inventory must survive packing.
const { VERSION, InteractiveMode } = await import("@earendil-works/pi-coding-agent");
const { assertInteractiveCompatibility, adaptInteractiveMode } = await import("@oma/engine/pi-compat/interactive-mode");
const shape = Object.assign(Object.create(InteractiveMode.prototype), { hideThinkingBlock: true });
assertInteractiveCompatibility(shape, VERSION);
assert.equal(adaptInteractiveMode(shape).setThinkingHidden(true), false);
assert.throws(() => assertInteractiveCompatibility(shape, "unsupported"), { code: "UNSUPPORTED_PROFILE" });
