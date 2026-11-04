/** A counterexample can pass this observation test while rejecting a candidate.
 * Launchd labels/JSON/PIDs below coordinate this controlled fixture only. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { currentDarwinAuditToken, pinDarwinProcess } from "@oma/native/audit-session";
import { lookupMachService } from "@oma/native/mach-message";

const OWNER = 0x4f4d4140;
const xml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
function launchctl(...argv) {
  const result = spawnSync("/bin/launchctl", argv, { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, JSON.stringify({ argv, ...result })); return result;
}
async function until(read, description, milliseconds = 30000) {
  const limit = performance.now() + milliseconds;
  for (;;) { const value = read(); if (value) return value;
    assert.ok(performance.now() < limit, description); await delay(20); }
}
function observations(path) {
  try { return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return []; throw error; }
}

test("001. Actual queued Mach owner survives keeper crash; same-UID job withdrawal defeats the lease name", { timeout: 90000 }, async t => {
  if (process.platform !== "darwin") {
    assert.throws(currentDarwinAuditToken, error => error.code === "UNSUPPORTED_PROFILE"); return;
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-mach-lease-candidate-")));
  const executable = join(root, "keeper"), service = "org.oma.lease-probe." + randomUUID(), domain = "user/" + process.getuid();
  const registrations = new Set(), outputs = [], rights = [], pins = [], children = [];
  t.after(async () => {
    t.diagnostic(JSON.stringify({ keepers: outputs.map(path => ({
      observations: observations(path), stderr: (() => { try { return readFileSync(path + ".err", "utf8").slice(-8192); }
        catch (error) { if (error.code === "ENOENT") return null; throw error; } })(),
    })) }));
    try { for (const label of registrations) launchctl("bootout", domain + "/" + label); }
    finally {
      for (const child of children) { child.process.kill("SIGKILL"); await child.closed; }
      for (const right of rights) right.close(); for (const pin of pins) pin.close(); rmSync(root, { recursive: true });
    }
  });
  const compile = spawnSync("/usr/bin/clang", ["-Wall", "-Wextra", "-Werror", fileURLToPath(new URL("./fixtures/darwin-mach-lease.c", import.meta.url)), "-o", executable], { encoding: "utf8", timeout: 30000 });
  assert.equal(compile.status, 0, compile.stderr);
  function register() {
    const label = "org.oma.lease-keeper." + randomUUID(), output = join(root, label + ".out"), definition = join(root, label + ".plist");
    writeFileSync(definition, `<?xml version="1.0"?><plist version="1.0"><dict>
      <key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array><string>${xml(executable)}</string><string>${xml(service)}</string></array>
      <key>MachServices</key><dict><key>${xml(service)}</key><true/></dict><key>SessionCreate</key><true/>
      <key>LimitLoadToSessionType</key><string>Background</string><key>ThrottleInterval</key><integer>1</integer>
      <key>StandardOutPath</key><string>${xml(output)}</string><key>StandardErrorPath</key><string>${xml(output)}.err</string>
      </dict></plist>`);
    launchctl("bootstrap", domain, definition); registrations.add(label); outputs.push(output); return { label, output };
  }
  const first = register(), token = currentDarwinAuditToken(), old = lookupMachService(service); rights.push(old);
  assert.equal(old.send(OWNER, Buffer.from("owner")), "sent");
  const [one] = await until(() => { const rows = observations(first.output); return rows.length ? rows : null; }, "initial keeper did not peek");
  assert.deepEqual(one.token, token); assert.equal(one.id, OWNER);
  const pin = pinDarwinProcess(one.pid); pins.push(pin); assert.equal(pin.terminate(), true);
  const restarted = await until(() => observations(first.output).find(row => row.pid !== one.pid), "launchd did not return the queued owner to a replacement keeper");
  assert.deepEqual(restarted.token, token); assert.equal(restarted.id, OWNER);
  // This process still owns the original claim. Namespace withdrawal is an
  // operation available at the same UID, not a kernel death of that owner.
  launchctl("bootout", domain + "/" + first.label); registrations.delete(first.label);
  assert.deepEqual(currentDarwinAuditToken(), token);
  const replacement = register();
  const second = spawn(process.execPath, ["--input-type=module", "-e", `
    import {currentDarwinAuditToken} from '@oma/native/audit-session';
    import {lookupMachService} from '@oma/native/mach-message';
    const port=lookupMachService(${JSON.stringify(service)});
    if(port.send(${OWNER},Buffer.from('second-owner'))!=='sent')throw new Error('second claim not enqueued');
    console.log(JSON.stringify(currentDarwinAuditToken()));port.close();setTimeout(()=>{},60000);`], { stdio: ["ignore", "pipe", "pipe"] });
  const childClosed = once(second, "close"); void childClosed.catch(() => {});
  children.push({ process: second, closed: childClosed });
  let stdout = "", stderr = "";
  let childError;
  second.on("error", error => { childError = error; });
  second.stdout.on("data", bytes => { stdout += bytes; }); second.stderr.on("data", bytes => { stderr += bytes; });
  const secondToken = await until(() => {
    if (childError) throw childError;
    assert.equal(second.exitCode, null, stderr);
    return stdout.includes("\n") ? JSON.parse(stdout.trim()) : null;
  }, "second owner did not enqueue");
  const [two] = await until(() => { const value = observations(replacement.output); return value.length ? value : null; }, "replacement registration did not acquire the same name");
  assert.notEqual(secondToken[5], process.pid); assert.deepEqual(two.token, secondToken);
  assert.deepEqual(currentDarwinAuditToken(), token); assert.equal(second.exitCode, null);
  t.diagnostic(JSON.stringify({ keeperCrashPreservedQueuedKernelSender: true,
    sameUidWithdrawalAllowedNameReuseWhileOriginalOwnerAlive: true, societyLeaseCandidate: "REJECTED" }));
});
