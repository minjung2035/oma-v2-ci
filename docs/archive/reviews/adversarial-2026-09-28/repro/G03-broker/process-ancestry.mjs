// G03-broker process-ancestry probe. Uses real child processes under /proc.
// Validates: descendsFrom self, descendsFrom child, reparent-after-parent-death
// (the documented weakness where a child of a dead engine keeps descending
// from... nothing -- becomes reparented to pid 1), processEnded semantics.
import { spawn } from "node:child_process";
import { descendsFrom, processIdentity, processEnded, parentOf } from "../../../../dist/src/broker/process-ancestry.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// self identity
const selfId = processIdentity(process.pid);
ok(selfId !== null, "self observed running");
ok(descendsFrom(process.pid, selfId), "descendsFrom self == true");

// A direct child descends from us.
const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1e9)"], { stdio: "ignore" });
await sleep(200);
ok(descendsFrom(child.pid, selfId), `direct child ${child.pid} descends from self`);

// processEnded on a running child == running
const childId = processIdentity(child.pid);
ok(childId !== null && processEnded(childId) === "running", "child processEnded == running");

// Grandchild: child spawns its own child; grandchild descends from us too.
const gp = spawn(process.execPath, ["-e", `
  const { spawn } = require("node:child_process");
  const g = spawn(process.execPath, ["-e", "setInterval(()=>{},1e9)"], { stdio: "ignore" });
  process.stdout.write(String(g.pid));
  setInterval(()=>{},1e9);
`], { stdio: ["ignore", "pipe", "ignore"] });
let gpOut = "";
gp.stdout.on("data", d => gpOut += d);
await sleep(400);
const grandPid = Number(gpOut.trim());
ok(Number.isInteger(grandPid) && grandPid > 0, `grandchild pid captured (${grandPid})`);
ok(descendsFrom(grandPid, selfId), `grandchild ${grandPid} descends from self (through parent)`);

// Now kill the middle process (gp). The grandchild is reparented (to 1 or a
// subreaper). It no longer descends from selfId. This mirrors the documented
// "engine dies, children reparent" concern in principal-endpoint.
gp.kill("SIGKILL");
await sleep(500);
const stillDesc = descendsFrom(grandPid, selfId);
ok(stillDesc === false, `after middle death, reparented grandchild no longer descends from self (got ${stillDesc})`);
// but the grandchild is still alive
const gAlive = processIdentity(grandPid) !== null;
ok(gAlive, "reparented grandchild still alive");
console.log(`  reparented grandchild ${grandPid} parent now: ${parentOf(grandPid)}`);

// processEnded for a dead pin -> "ended"
const gpId = { pid: gp.pid, startTime: "0" }; // wrong startTime forces mismatch even if reused
ok(processEnded(gpId) === "ended", "killed proc with mismatched startTime -> ended");

// cleanup
try { child.kill("SIGKILL"); } catch {}
try { process.kill(grandPid, "SIGKILL"); } catch {}

console.log(`\nprocess-ancestry: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
