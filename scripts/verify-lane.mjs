#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, platform, release } from "node:os";
import ts from "typescript";
import { lanes, evaluateExecution } from "./verification-lanes.mjs";
import { extractExplorationParameters } from "./exploration-parameters.mjs";
import { verificationInputFiles, verificationSourceDigests } from "./source-digest.mjs";
import { workspaceTestFiles } from "./check-modules.mjs";

const [name, ...rawArgs] = process.argv.slice(2);
if (!Object.hasOwn(lanes, name ?? "")) throw new Error(`usage: verify-lane.mjs <${Object.keys(lanes).join("|")}> --out <new-directory> [--baseline <result.json>] [--seed N --actions N --fuzz-cases N --stress-cycles N --stress-seconds N --rss-bytes N]`);
const exploration = extractExplorationParameters(rawArgs), args = exploration.remaining;
const valueOf = key => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
const outputArg = valueOf("--out");
if (!outputArg) throw new Error("a new output directory is required; evidence is never overwritten");
const root = process.cwd(); const output = resolve(outputArg); const lane = lanes[name];
if (existsSync(output)) throw new Error("output directory already exists");
mkdirSync(output, { recursive: true });
const environment = {};
for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "DBUS_SESSION_BUS_ADDRESS"])
  if (process.env[key] !== undefined) environment[key] = process.env[key];
const inheritedKeys = Object.keys(environment);
Object.assign(environment, exploration.env, { OMA_TEST_ARTIFACT_DIR: join(output, "exploration") });
const report = { schema: 1, lane: name, status: "BLOCKED", execution: "NOT_RUN", proof: lane.proof,
  startedAt: new Date().toISOString(), concurrency: 1, environment: { node: process.version, platform: platform(), arch: arch(), kernel: release(), uid: process.getuid?.() ?? null,
    inheritedKeys, paidProviderCredentialsInherited: false },
  exploration: { parameters: exploration.parameters, artifacts: "exploration", defaults: "declared and reported by each test; not inferred measurements" },
  declaredTestFiles: lane.files, requiredNames: lane.requiredNames, entryQualification: null,
  commands: [], selectedFiles: [], sourceDigests: {}, sourceTestCallSites: [], runtime: null,
  limitations: ["S-03: v1 delivers each batch as a followUp; mid-run steer is not a v1 feature (DR18)", "inference is engine-owned (INF-001); v1 has no cost ceiling (DR18)", "VM power loss NOT_RUN", "host reboot and paid provider calls are outside this runner", "raw test failure does not identify product-vs-environment cause"] };
function command(executable, argv, label, seconds) {
  const stdoutPath = join(output, `${label}.stdout.log`); const stderrPath = join(output, `${label}.stderr.log`);
  const stdout = openSync(stdoutPath, "wx"); const stderr = openSync(stderrPath, "wx");
  return new Promise(resolveResult => {
    const startedAt = new Date().toISOString(); let timedOut = false; let settled = false;
    const child = spawn(executable, argv, { cwd: root, env: environment, detached: process.platform !== "win32", stdio: ["ignore", stdout, stderr] });
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* only this owned group */ }
    }, seconds * 1000);
    const finish = (code, signal, error = null) => {
      if (settled) return; settled = true; clearTimeout(timer); closeSync(stdout); closeSync(stderr);
      const result = { executable, argv, label, startedAt, endedAt: new Date().toISOString(), code, signal, timedOut,
        error: error ? String(error.message ?? error) : null, stdout: relative(output, stdoutPath), stderr: relative(output, stderrPath) };
      report.commands.push(result); resolveResult(result);
    };
    child.once("error", error => finish(null, null, error)); child.once("close", (code, signal) => finish(code, signal));
  });
}
async function packageScript(name, label, seconds) {
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
  const expand = (name, active = new Set()) => {
    if (active.has(name) || typeof scripts[name] !== "string") throw new Error(`invalid direct package script: ${name}`);
    return scripts[name].split(" && ").flatMap(part => {
      if (!/^[A-Za-z0-9_./:=-]+(?: [A-Za-z0-9_./:=-]+)*$/.test(part)) throw new Error(`package script requires a shell: ${name}`);
      const [executable, ...argv] = part.split(" ");
      if (executable === "npm" && argv[0] === "run" && argv.length === 2) return expand(argv[1], new Set([...active, name]));
      if (executable === "node") return [[process.execPath, argv]];
      if (executable === "tsc") return [[process.execPath, [join(root, "node_modules/typescript/bin/tsc"), ...argv]]];
      throw new Error(`unsupported direct package command: ${executable}`);
    });
  };
  let result;
  const deadline = performance.now() + seconds * 1000;
  const commands = expand(name);
  for (const [index, [executable, argv]] of commands.entries()) {
    const remaining = (deadline - performance.now()) / 1000;
    if (remaining <= 0) throw new Error(`direct package script exceeded its deadline: ${name}`);
    result = await command(executable, argv, commands.length === 1 ? label : `${label}-${index + 1}`, remaining);
    if (result.code !== 0 || result.signal || result.error) return result;
  }
  return result;
}
function requirePreflight(executable, argv) {
  const result = spawnSync(executable, argv, { env: environment, encoding: "utf8", timeout: 10000, maxBuffer: 65536, killSignal: "SIGKILL" });
  if (result.error || result.signal || result.status !== 0) throw new Error(`environment preflight failed: ${executable} ${argv.join(" ")}`);
  return result.stdout.trim();
}
try {
  // @types/node is not a runtime support matrix. Probe the actual required API.
  const sqlite = await import("node:sqlite");
  if (typeof sqlite.DatabaseSync !== "function") throw new Error("required runtime SQLite API is unavailable");
  report.environment.sqliteApi = "DatabaseSync available; not a database-operation test";
  if (lane.environment !== "node") {
    if (process.platform !== "linux") throw new Error("real filesystem/kernel lanes require Linux");
    report.environment.git = requirePreflight("git", ["--version"]);
    if (!existsSync("/dev/shm")) throw new Error("cross-filesystem test mount missing");
  }
  if (lane.environment === "linux-native") {
    report.environment.bubblewrap = requirePreflight("/usr/bin/bwrap", ["--version"]);
    if (report.environment.bubblewrap !== "bubblewrap 0.12.0") throw new Error("native qualification requires pinned bubblewrap 0.12.0");
    report.environment.python = requirePreflight("python3", ["--version"]);
    if (!existsSync("/proc/self/fd")) throw new Error("required native process observations unavailable");
  }
  report.status = "SETUP_FAILED";
  // Build and qualification probes cannot access a manager, even for entry lanes.
  environment.NODE_OPTIONS = `--import=${new URL("./local-test-guard.mjs", import.meta.url).href}`;
  environment.DBUS_SESSION_BUS_ADDRESS = "unix:path=/nonexistent/oma-local-tests-no-user-bus";
  // AV-20261003-30: the bound source is the canonical verification-input
  // closure (source-digest.mjs) -- one definition for every consumer. The
  // committed inventory and per-file source digests the ledger and LOC checks
  // are generated from are inputs, so their bytes are bound; the LOC report
  // (`production-loc.json`) and measurement hashes are CI artifacts a
  // measurement writes into an evidence directory, never committed inputs, so
  // they are bound nowhere. A declared input that is absent throws here
  // rather than binding vacuously.
  report.sourceDigests = verificationSourceDigests(root);
  for (const rel of verificationInputFiles(root)) {
    if (rel.startsWith("test/") && rel.endsWith(".ts")) {
      const source = ts.createSourceFile(rel, readFileSync(join(root, rel), "utf8"), ts.ScriptTarget.Latest, true);
      const visit = node => {
        if (ts.isCallExpression(node) && (node.expression.getText(source) === "test" || node.expression.getText(source) === "it" || /^(?:test|it)\.(?:skip|todo|only)$/.test(node.expression.getText(source))))
          report.sourceTestCallSites.push({ file: rel, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, expression: node.arguments[0]?.getText(source) ?? null });
        ts.forEachChild(node, visit);
      }; visit(source);
    }
  }
  report.sourceTestCallSiteUnit = "AST call sites, NOT expanded executed test cases";
  const head = spawnSync("git", ["rev-parse", "HEAD"], { env: environment, encoding: "utf8", timeout: 10000, maxBuffer: 65536, killSignal: "SIGKILL" });
  const sha = head.stdout?.trim();
  report.environment.sourceHead = head.status === 0 && !head.error && !head.signal && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha ?? "") ? sha : null;
  report.environment.sourceHeadStatus = report.environment.sourceHead ? "OBSERVED" : "NOT_AVAILABLE";
  const build = await packageScript("build", "build", 600);
  if (build.code !== 0 || build.signal) { report.status = "BUILD_FAILED"; throw new Error("build failed; test execution did not begin"); }
  if (name === "fast" || name === "all") {
    for (const script of ["typecheck", "check:architecture"]) {
      const check = await packageScript(script, script.replace(":", "-"), 600);
      if (check.code !== 0 || check.signal) { report.status = "PRECHECK_FAILED"; throw new Error(`${script} failed; runtime tests did not begin`); }
    }
  }
  const compiled = readdirSync(join(root, "dist/test")).filter(file => file.endsWith(".test.js")).sort();
  const selected = lane.files === "all" ? compiled : lane.files;
  for (const file of selected) if (!compiled.includes(file)) throw new Error(`required test file missing: ${file}`);
  const sourceNames = readdirSync(join(root, "test")).filter(file => file.endsWith(".test.ts")).map(file => file.replace(/\.ts$/, ".js")).sort();
  if (JSON.stringify(compiled) !== JSON.stringify(sourceNames)) throw new Error("compiled/source test inventories differ; clean rebuild required");
  const sourceTests = name === "all"
    ? readdirSync(join(root, "test")).filter(file => file.endsWith(".test.mjs")).sort().map(file => `test/${file}`)
    : lane.sourceFiles;
  // Preserve explicitly required MJS entries even when all discovers additional
  // files; a deleted required test must fail, not disappear from the inventory.
  report.selectedFiles = [...selected.map(file => `dist/test/${file}`), ...new Set([...lane.sourceFiles, ...sourceTests,
    ...(["fast", "all"].includes(name) ? workspaceTestFiles(root) : [])])];
  for (const file of report.selectedFiles) if (!lstatSync(join(root, file)).isFile()) throw new Error(`test entry is not a file: ${file}`);
  const baselinePath = valueOf("--baseline");
  const baseline = baselinePath ? JSON.parse(readFileSync(resolve(baselinePath), "utf8")) : null;
  if (baseline && (baseline.lane !== name || baseline.status !== "PASS" || !Array.isArray(baseline.runtime?.names))) throw new Error("baseline is not a successful same-lane execution record");
  const result = await command(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...report.selectedFiles], "tests", lane.timeoutSeconds);
  report.execution = result.error ? "NOT_RUN" : "EXECUTED";
  const log = join(output, result.stdout);
  if (statSync(log).size > 64 * 1024 * 1024) throw new Error("raw test log preserved, but evidence parser's 64 MiB bound exceeded");
  report.runtime = evaluateExecution({ exitCode: result.code, signal: result.signal, tap: readFileSync(log, "utf8"), requiredNames: lane.requiredNames,
    ...(baseline ? { baselineNames: baseline.runtime.names } : {}) });
  if (baseline && report.runtime.totals.tests < baseline.runtime.totals.tests) {
    report.runtime.errors.push("executed-test-count-decreased"); report.runtime.status = "FAIL";
  }
  report.status = report.runtime.status;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  if (report.status === "PASS" || report.execution === "EXECUTED") report.status = "FAIL";
} finally {
  report.endedAt = new Date().toISOString();
  writeFileSync(join(output, "result.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.error(`${name}: ${report.status}; ${report.execution}; artifacts=${output}`);
  process.exitCode = report.status === "PASS" ? 0 : 1;
}
