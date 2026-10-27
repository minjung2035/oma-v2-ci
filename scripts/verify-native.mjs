#!/usr/bin/env node
/** Native evidence driver. A reproduced counterexample remains a failed gate. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, mkdirSync, statfsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir, release, arch } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { verificationInputDigest } from "./source-digest.mjs";
import { runtimeArtifactDigest } from "./runtime-artifact-digest.mjs";
import { DARWIN_PROGRAMS, DARWIN_CASE_REPETITIONS, DARWIN_PROCESS_TIMEOUT_MS, darwinCasePlan,
  validateDarwinObservation, validateDarwinCaseSet } from "./darwin-cases.mjs";

const out = resolve(process.argv[2] ?? ".scratch/native-evidence"); mkdirSync(out, { recursive: true });
const run = (executable, argv, cwd = process.cwd()) => spawnSync(executable, argv,
  { cwd, encoding: "utf8", timeout: DARWIN_PROCESS_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
const source = run("git", ["rev-parse", "HEAD"]);
const provenance = { source: (source.stdout ?? "").trim(), platform: process.platform, arch: arch(), os: release(), node: process.version,
  versions: process.versions, image: process.env.ImageVersion, imageOS: process.env.ImageOS,
  uid: process.getuid?.(), driverDigest: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex") };
const gates = {
    "G-PROCESS": { status: "OPEN", reason: "No complete arbitrary-descendant containment/death proof; see NOTE_TRACK and escaped process observations" },
    "G-FILES": { status: "OPEN", reason: "Primitive observations do not yet prove external executable binding, entry reopens or all namespace races" },
    "G-AUTH": { status: "OPEN", reason: "Actual descriptor-transfer observations do not establish per-message origin, PID-reuse or whole authorization proof" },
  };

const result = { provenance, gates, plan: darwinCasePlan(), compilations: [], cases: [], observations: {}, status: "SETUP_FAILED" };
let compilationWorkspace;
try {
  if (source.error || source.signal || source.status !== 0 || !/^[0-9a-f]{40}$/.test(provenance.source))
    throw new Error("source HEAD could not be observed");
  if (process.platform !== "darwin") throw new Error("Darwin gate probes require a real Darwin kernel");
  provenance.verificationInput = verificationInputDigest();
  const sdk = run("xcrun", ["--show-sdk-version"]); if (sdk.status !== 0 || sdk.error || sdk.signal) throw new Error("SDK could not be observed");
  provenance.sdk = sdk.stdout.trim();
  const gitVersion = run("/usr/bin/git", ["--version"]);
  provenance.git = { exitCode: gitVersion.status, signal: gitVersion.signal, error: gitVersion.error?.message, output: gitVersion.stdout?.trim() };
  provenance.packages = {};
  for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "koffi"]) {
    try { provenance.packages[name] = JSON.parse(readFileSync(resolve("node_modules", name, "package.json"), "utf8")).version; }
    catch (error) { provenance.packages[name] = { status: "UNAVAILABLE", error: String(error) }; }
  }
  try { provenance.runtimeArtifacts = runtimeArtifactDigest(); }
  catch (error) { result.runtimeArtifactError = String(error); }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-probe-")));
  compilationWorkspace = scratch;
  provenance.filesystem = statfsSync(scratch);
  const programs = DARWIN_PROGRAMS;
  for (const program of programs) {
    const binary = join(scratch, program.name);
    const compilation = { name: program.name, status: "SETUP_FAILED" };
    try {
      const fixture = resolve("test/fixtures", program.fixture);
      provenance[program.digest] = createHash("sha256").update(readFileSync(fixture)).digest("hex");
      const compiled = program.node ? run(process.execPath, ["--check", fixture]) :
        run("xcrun", ["clang", "-Wall", "-Wextra", "-Werror", fixture, ...program.link, "-o", binary]);
      Object.assign(compilation, { exitCode: compiled.status, signal: compiled.signal, error: compiled.error?.message });
      writeFileSync(join(out, `${program.compile}.log`), (compiled.stdout ?? "") + (compiled.stderr ?? ""));
      if (compiled.error || compiled.signal || compiled.status !== 0) throw new Error(program.node ? "Darwin Node probe syntax check failed" : "Darwin SDK probe compilation failed");
      compilation.status = program.node ? "SYNTAX_CHECKED" : "COMPILED";
      if (!program.node) compilation.binaryDigest = createHash("sha256").update(readFileSync(binary)).digest("hex");
    } catch (error) { compilation.error = String(error); }
    result.compilations.push(compilation);
    writeFileSync(join(out, `${program.compile}-result.json`), JSON.stringify(compilation) + "\n");
    // A failed compilation/case must not erase unrelated observations. Every
    // real-kernel attempt has independent exit/signal/stdio and cleanup.
    for (let iteration = 0; iteration < DARWIN_CASE_REPETITIONS; iteration++) for (const name of program.names) {
      const directory = join(out, "cases", `${name}-${iteration}`);
      const attempt = { program: program.name, name, iteration, execution: "NOT_RUN", status: "SETUP_FAILED" };
      let workspace;
      try {
        mkdirSync(directory, { recursive: true });
        if (compilation.status !== (program.node ? "SYNTAX_CHECKED" : "COMPILED")) throw new Error(`probe was not executed: ${compilation.error}`);
        workspace = realpathSync(mkdtempSync(join(tmpdir(), `oma-native-${name}-`)));
        attempt.workspace = workspace;
        attempt.filesystem = statfsSync(workspace);
        const started = performance.now();
        const observed = program.node ? run(process.execPath, [resolve("test/fixtures", program.fixture), name], workspace) : run(binary, [name], workspace);
        attempt.elapsedMs = performance.now() - started;
        if (observed.pid > 0 && (observed.status !== null || observed.signal != null))
          attempt.execution = "EXECUTED";
        Object.assign(attempt, { exitCode: observed.status, signal: observed.signal, error: observed.error?.message });
        writeFileSync(join(directory, "stdout"), observed.stdout ?? "");
        writeFileSync(join(directory, "stderr"), observed.stderr ?? "");
        if (observed.error || observed.signal || observed.status !== 0)
          throw new Error(`probe did not complete: ${observed.status}/${observed.signal}`);
        const { case: actual, ...observations } = JSON.parse(observed.stdout);
        if (actual !== name) throw new Error("probe case/observation mismatch");
        validateDarwinObservation(name, observations);
        attempt.observations = observations; attempt.status = "OBSERVED";
        if (iteration === 0) Object.assign(result.observations, observations);
      } catch (error) { attempt.error = String(error); }
      finally {
        if (workspace !== undefined) {
          try { rmSync(workspace, { recursive: true, force: true }); attempt.cleanup = "returned"; }
          catch (error) { attempt.cleanupError = String(error); attempt.status = "SETUP_FAILED"; }
        }
      }
      result.cases.push(attempt);
      try { writeFileSync(join(directory, "result.json"), JSON.stringify(attempt, null, 2) + "\n"); }
      catch (error) { attempt.artifactError = String(error); attempt.status = "SETUP_FAILED"; }
    }
  }
  validateDarwinCaseSet(result.cases);
  if (result.cases.some(attempt => attempt.status !== "OBSERVED") || result.runtimeArtifactError !== undefined)
    throw new Error("at least one independent Darwin observation did not complete; other raw cases retained");
  result.status = "BLOCKED";
} catch (error) { result.error = String(error); }
finally {
  // Explicit unexecuted rows keep setup failure from hiding required cases.
  // Workspace cleanup below is not an arbitrary-descendant death assertion.
  for (const planned of result.plan) if (!result.cases.some(row => row.name === planned.name && row.iteration === planned.iteration)) {
    const attempt = { ...planned, execution: "NOT_RUN", status: "SETUP_FAILED", error: result.error ?? "driver did not reach this required attempt" };
    result.cases.push(attempt);
    try {
      const directory = join(out, "cases", `${attempt.name}-${attempt.iteration}`); mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "result.json"), JSON.stringify(attempt, null, 2) + "\n");
    } catch (error) { attempt.artifactError = String(error); }
  }
  for (const program of DARWIN_PROGRAMS) if (!result.compilations.some(row => row.name === program.name)) {
    const row = { name: program.name, status: "NOT_RUN", error: result.error ?? "driver did not reach this compilation" };
    result.compilations.push(row);
    try { writeFileSync(join(out, `${program.compile}-result.json`), JSON.stringify(row, null, 2) + "\n"); }
    catch (error) { result.artifactError = String(error); result.status = "SETUP_FAILED"; }
  }
  if (provenance.verificationInput !== undefined) {
    try {
      provenance.verificationInputAfter = verificationInputDigest();
      if (JSON.stringify(provenance.verificationInput) !== JSON.stringify(provenance.verificationInputAfter))
        throw new Error("verification inputs changed during the actual Darwin observations");
    } catch (error) { result.inputError = String(error); result.status = "SETUP_FAILED"; }
  }
  if (provenance.runtimeArtifacts !== undefined) {
    try {
      provenance.runtimeArtifactsAfter = runtimeArtifactDigest();
      if (JSON.stringify(provenance.runtimeArtifacts) !== JSON.stringify(provenance.runtimeArtifactsAfter))
        throw new Error("runtime artifacts changed during Darwin observations");
    } catch (error) { result.runtimeArtifactError = String(error); result.status = "SETUP_FAILED"; }
  }
  if (compilationWorkspace !== undefined) {
    try { rmSync(compilationWorkspace, { recursive: true, force: true }); result.compilationCleanup = "returned"; }
    catch (error) { result.cleanupError = String(error); result.status = "SETUP_FAILED"; }
  }
}
result.summary = { required: result.plan.length, observed: result.cases.filter(row => row.status === "OBSERVED").length,
  executed: result.cases.filter(row => row.execution === "EXECUTED").length,
  notRun: result.cases.filter(row => row.execution === "NOT_RUN").length, productQualification: "BLOCKED" };
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "SETUP_FAILED" ? 2 : 1;
