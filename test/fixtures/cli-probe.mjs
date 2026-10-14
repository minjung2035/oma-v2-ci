// Stands in for the model-facing CLI to show what the CLI actually receives:
// its own environment, what arrives on descriptor 3, and whether that
// descriptor is a socket (which /proc cannot reopen) or something that can be.
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";

let channel = null;
try {
  const kind = fstatSync(3);
  let reopened = "not-attempted";
  try { closeSync(openSync("/proc/self/fd/3", "r")); reopened = "reopened"; }
  catch (error) { reopened = error.code ?? "refused"; }
  channel = { socket: kind.isSocket(), fifo: kind.isFIFO(), file: kind.isFile(), reopened, line: readFileSync(3, "latin1") };
} catch { channel = null; }
process.stdout.write(JSON.stringify({ pid: process.pid, environ: readFileSync("/proc/self/environ", "latin1"), channel }));
