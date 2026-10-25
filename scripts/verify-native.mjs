#!/usr/bin/env node
/** Native evidence driver. A reproduced counterexample remains a failed gate. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, release, arch } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const out = resolve(process.argv[2] ?? ".scratch/native-evidence"); mkdirSync(out, { recursive: true });
const run = (executable, argv, cwd = process.cwd()) => spawnSync(executable, argv,
  { cwd, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
const source = run("git", ["rev-parse", "HEAD"]);
const provenance = { source: source.stdout.trim(), platform: process.platform, arch: arch(), os: release(), node: process.version,
  versions: process.versions, image: process.env.ImageVersion, imageOS: process.env.ImageOS };
const result = { provenance, gates: {}, status: "SETUP_FAILED" };
try {
  if (process.platform !== "darwin") throw new Error("Darwin gate probes require a real Darwin kernel");
  const sdk = run("xcrun", ["--show-sdk-version"]); if (sdk.status !== 0 || sdk.error || sdk.signal) throw new Error("SDK could not be observed");
  provenance.sdk = sdk.stdout.trim();
  const fixture = resolve("test/fixtures/darwin-native-probe.c");
  provenance.probeDigest = createHash("sha256").update(readFileSync(fixture)).digest("hex");
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-probe-")));
  const binary = join(scratch, "probe");
  const compiled = run("xcrun", ["clang", "-Wall", "-Wextra", "-Werror", fixture, "-o", binary]);
  writeFileSync(join(out, "compile.log"), compiled.stdout + compiled.stderr);
  if (compiled.error || compiled.signal || compiled.status !== 0) throw new Error("Darwin SDK probe compilation failed");
  const observed = run(binary, [], scratch);
  writeFileSync(join(out, "probe.stdout"), observed.stdout); writeFileSync(join(out, "probe.stderr"), observed.stderr);
  if (observed.error || observed.signal || observed.status !== 0) throw new Error(`probe did not complete: ${observed.status}/${observed.signal}`);
  result.observations = JSON.parse(observed.stdout);
  result.gates = {
    "G-PROCESS": { status: "OPEN", reason: "No complete arbitrary-descendant containment/death proof; see NOTE_TRACK and escaped process observations" },
    "G-FILES": { status: "OPEN", reason: "Primitive observations do not yet prove external executable binding, entry reopens or all namespace races" },
    "G-AUTH": { status: "OPEN", reason: "Peer PID observations require further SCM_RIGHTS/socket-transfer and PID-reuse authorization proof" },
  };
  result.status = "BLOCKED";
} catch (error) { result.error = String(error); }
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "SETUP_FAILED" ? 2 : 1;
