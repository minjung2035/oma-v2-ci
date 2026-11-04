/** Controlled SIGKILL boundaries around the actual shared owner/journal. */
import { existsSync, statSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { DARWIN_EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { launchDarwinJobScope, launchSeatbeltJobScope } from "@oma/platform-mac/job-scope";
import { observeDarwinJobScope, acquireDarwinJobScope } from "@oma/platform-mac/job-recovery";
import { realpathSync } from "node:fs";
const [root, point] = process.argv.slice(2);
if (process.platform !== "darwin" || !["opening", "witness", "released", "released-seatbelt"].includes(point)) throw new Error("invalid recovery probe");
const die = () => process.kill(process.pid, "SIGKILL");
const journal = ExecutionJournal.open(root, DARWIN_EXECUTION_JOURNAL_VERSION);
const port = { entries: () => journal.entries(), retire: (slot, execution) => journal.retire(slot, execution), reserve(slot) {
  const row = journal.reserve(slot); if (point === "opening") die();
  return { execution: row.execution, retire: () => row.retire(), publish(witness) { row.publish(witness); if (point === "witness") die(); } };
} };
const owner = new ExecutionCoordinator(port, observeDarwinJobScope, acquireDarwinJobScope);
const descendant = "const fs=require('node:fs');fs.writeFileSync('descendant.pid',String(process.pid));setInterval(()=>fs.appendFileSync('pulse','x'),5)";
const source = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore',env:{}}).unref();setInterval(()=>{},1000)`;
const command = { executable: realpathSync(process.execPath), argv: ["-e", source], env: { HOME: root, TMPDIR: root }, cwd: root,
  timeoutMs: 20000, stdoutBytes: 0, stderrBytes: 128 };
await owner.begin({ slot: "candidate", launch: () => point === "released-seatbelt" ? launchSeatbeltJobScope(command, {
  readable: [], writable: [{ path: root, kind: "directory" }], denied: [],
  executable: [{ path: command.executable, kind: "file" }], unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR"],
}) : launchDarwinJobScope(command), authorize() {} });
const deadline = performance.now() + 10000;
while (!existsSync(root + "/pulse") || statSync(root + "/pulse").size === 0) {
  if (performance.now() >= deadline) throw new Error("controlled detached descendant did not start"); await delay(5);
}
die();
