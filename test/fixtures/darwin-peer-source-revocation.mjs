/** Controlled source change; markers synchronize, never prove identity. */
import assert from "node:assert/strict";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pinInheritedDarwinPeer } from "@oma/native/audit-session";

const change = new URL(import.meta.url).searchParams.get("change"), root = process.env.HOME;
assert.ok(change === "exec" || change === "death");
const pin = pinInheritedDarwinPeer();
try {
  writeFileSync(join(root, "source-ready.tmp"), JSON.stringify({ token: pin.token, alive: pin.alive() }));
  renameSync(join(root, "source-ready.tmp"), join(root, "source-ready.json"));
  while (!existsSync(join(root, "source-changed"))) await delay(5);
  assert.equal(pin.alive(), false, "an already bound source must revoke");
  // A cache in this Node process cannot make this oracle pass. A new client
  // inherits the original kernel capability after the source changed.
  const script = `import assert from 'node:assert/strict';import {pinInheritedDarwinPeer} from ${JSON.stringify(import.meta.resolve("@oma/native/audit-session"))};
    let unexpected;try{assert.throws(()=>{unexpected=pinInheritedDarwinPeer();},{code:'AUTH_FAILED'});}finally{unexpected?.close();}`;
  const fresh = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  assert.equal(fresh.status, 0, JSON.stringify(fresh)); assert.equal(fresh.signal, null);
  console.log(JSON.stringify({ nativeRevoke: change, freshProcessRefused: true }));
} finally { pin.close(); }
