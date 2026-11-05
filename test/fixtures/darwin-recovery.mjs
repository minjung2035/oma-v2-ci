/** Controlled SIGKILL boundaries around the actual shared owner/journal. */
import { existsSync, statSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { DARWIN_EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { PreparationExecutor } from "@oma/process/preparation";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { launchDarwinJobScope, launchSeatbeltJobScope } from "@oma/platform-mac/job-scope";
import { observeDarwinJobScope, acquireDarwinJobScope } from "@oma/platform-mac/job-recovery";
import { realpathSync } from "node:fs";
import { claimSocietyFence } from "#oma-test/app/runtime/society-lease";
import { SOCIETY_FENCE_ENV } from "@oma/process/async";
import { once } from "node:events";
const [root, point] = process.argv.slice(2);
if (process.platform !== "darwin" || !["opening", "witness", "released", "released-seatbelt", "released-preparation", "released-society", "released-society-closed"].includes(point)) throw new Error("invalid recovery probe");
const fenced = point === "released-society" || point === "released-society-closed", closedFence = point === "released-society-closed";
if (fenced && claimSocietyFence(root).kind !== "inherited") throw new Error("recovery owner did not inherit its Host's Society");
const die = () => process.kill(process.pid, "SIGKILL");
function controlledOwner() {
const journal = ExecutionJournal.open(root, DARWIN_EXECUTION_JOURNAL_VERSION);
const port = { entries: () => journal.entries(), retire: (slot, execution) => journal.retire(slot, execution), reserve(slot) {
  const row = journal.reserve(slot); if (point === "opening") die();
  return { execution: row.execution, retire: () => row.retire(), publish(witness) { row.publish(witness); if (point === "witness") die(); } };
} };
return new ExecutionCoordinator(port, observeDarwinJobScope, acquireDarwinJobScope);
}
const descendant = "const fs=require('node:fs');" + (fenced ? "require('node:assert/strict').equal(fs.fstatSync(4).isSocket(),true);" : "") + (closedFence ? "fs.closeSync(4);" : "") + "fs.writeFileSync('descendant.pid',String(process.pid));setInterval(()=>fs.appendFileSync('pulse','x'),5)";
const source = `const {spawn}=require('node:child_process');${closedFence ? "require('node:fs').writeFileSync('workload.pid',String(process.pid));" : ""}spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:${fenced ? "['ignore','ignore','ignore','ignore',4]" : "'ignore'"},env:${fenced ? JSON.stringify({[SOCIETY_FENCE_ENV]:"4"}) : "{}"}}).unref();setInterval(()=>{},1000)`;
const command = { executable: realpathSync(process.execPath), argv: ["-e", source], env: { HOME: root, TMPDIR: root }, cwd: root,
  timeoutMs: 20000, stdoutBytes: 0, stderrBytes: 128 };
let preparationFailure;
if (point === "released-preparation") {
  const runtime = new ExecutionRuntime(root, launchDarwinJobScope);
  const run = new PreparationExecutor().run(command); void run.catch(error => { preparationFailure = error; });
} else await controlledOwner().begin({ slot: "candidate", launch: () => point === "released-seatbelt" ? launchSeatbeltJobScope(command, {
  readable: [], writable: [{ path: root, kind: "directory" }], denied: [],
  executable: [{ path: command.executable, kind: "file" }], unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR"],
}) : launchDarwinJobScope(command), authorize() {} });
const deadline = performance.now() + 10000;
while (!existsSync(root + "/pulse") || statSync(root + "/pulse").size === 0) {
  if (preparationFailure !== undefined) throw preparationFailure;
  if (performance.now() >= deadline) throw new Error("controlled detached descendant did not start"); await delay(5);
}
if (closedFence) { process.send({ kind: "closed-fence-ready" }); await once(process, "message"); }
die();
