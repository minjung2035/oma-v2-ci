// A Pi RPC stand-in whose answers a test scripts per prompt (WP09).
//   "silent:..."  no response at all (acceptance unknown)
//   "hold:..."    accepted, and the run goes on until SIGUSR2 settles it
//   anything else accepted and settled at once
// SIGUSR1 answers the last silent prompt late (accepted) and settles its run.
// Every prompt this process reads is appended to the log named by argv[2].
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.argv[2];
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let silent = null;
createInterface({ input: process.stdin }).on("line", line => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (command.type !== "prompt") { emit({ type: "response", id: command.id, command: command.type, success: true }); return; }
  appendFileSync(log, `${command.message}\n`);
  if (command.message.includes("silent:")) { silent = command.id; return; }
  emit({ type: "response", id: command.id, command: "prompt", success: true });
  if (!command.message.includes("hold:")) setTimeout(() => emit({ type: "agent_settled" }), 5);
});
process.on("SIGUSR1", () => {
  if (silent !== null) emit({ type: "response", id: silent, command: "prompt", success: true });
  silent = null;
  setTimeout(() => emit({ type: "agent_settled" }), 5);
});
process.on("SIGUSR2", () => emit({ type: "agent_settled" }));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
