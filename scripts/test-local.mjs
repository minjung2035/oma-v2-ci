#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { localTestFiles, serialTestFiles, nativeExecutionTestFiles, unrunDirectives, unrunTests } from "./verification-lanes.mjs";
import { workspaceTestFiles } from "./check-modules.mjs";
// This runner has no selection surface: any argument is a mistake (or `npm
// test -- foo`), and silently running the whole suite is the exact behavior
// the mistake would not expect.
const args = process.argv.slice(2);
if (args.length > 0)
  throw new Error(`test-local.mjs takes no arguments; refusing to run the suite on: ${args.join(" ")}`);
const compiled = readdirSync("dist/test")
  .filter((file) => file.endsWith(".test.js"))
  .sort();
const sources = readdirSync("test")
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => file.replace(/\.ts$/, ".js"))
  .sort();
if (JSON.stringify(compiled) !== JSON.stringify(sources))
  throw new Error("compiled/source test inventories differ; rebuild required");
const files = [
  ...workspaceTestFiles(process.cwd()),
  ...localTestFiles(compiled).map((file) => `dist/test/${file}`),
  ...readdirSync("test")
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => `test/${file}`),
];

/** Test files that must not share the host with other running test files.
 *
 * `node --test` parallelizes across *files* in separate processes, so the only
 * cross-file races are through host-global resources: fixed ports or socket
 * paths, non-mkdtemp temp dirs, the abstract AF_UNIX namespace, /proc or
 * cgroup scans that see sibling processes, repo files written in place, and
 * wall-clock budgets that CPU contention can exhaust. A file belongs here
 * only when one of those is inherent to what it proves -- the entry must say
 * which resource and why it cannot be namespaced per test.
 *
 * The suite was audited for each of those resources and most files were found
 * namespaced -- ephemeral ports, mkdtemp roots, abstract names hashed from
 * unique state roots, and lock files beside the data they guard. What remains
 * below is what a host cannot namespace: a sibling's CPU is always shared. */
const SERIAL = new Set([
  // The oracle is event-loop lag itself: reads must stay under 50 ms and
  // mixed work under 100 ms. Seven sibling test processes can stall the loop
  // past the budget without the broker doing anything wrong, so the assertion
  // is only measurable while nothing else of ours runs.
  "dist/test/status-responsiveness.test.js",
  // The delayed-wait tests scale the runner's control-idle budget to 2 s and
  // then answer after 3.5 s; under load the runner process cannot even start
  // inside the idle window, so the observation it must issue never happens
  // (observed === 0). The ordering margin is what is being proved, so it runs
  // alone rather than weakened.
  "dist/test/scenario-agent-wait.test.js",
  // The PTY files (mac-new-handoff-pty, open-tui-pty, personal-pty) used to
  // live here because their writes raced fixed wall-clock windows against the
  // engine's draw and birth times. Every timing-sensitive step now waits on a
  // deterministic screen marker (see "expect" in pty-harness.py) instead of a
  // fixed pause, so sibling CPU only stretches real work, not a lost race:
  // each file passed 2/2 runs in a full parallel sibling batch before moving.
]);

/** How many test files may run at once in the parallel phase. Override with
 * OMA_TEST_CONCURRENCY; the default is the value validated on the development
 * host, capped at the machine's parallelism so a large machine does not turn
 * CPU contention into timing flakes. */
const DEFAULT_CONCURRENCY = Math.min(8, availableParallelism());
const requested = Number.parseInt(process.env.OMA_TEST_CONCURRENCY ?? "", 10);
const concurrency = Number.isInteger(requested) && requested > 0
  ? requested
  : DEFAULT_CONCURRENCY;

const serialFiles = serialTestFiles(files, SERIAL);
const parallelFiles = files.filter((file) => !SERIAL.has(file));
const guard = new URL("./local-test-guard.mjs", import.meta.url).href;
const childEnv = {
  ...process.env,
  NODE_OPTIONS: `--import=${guard}`,
  DBUS_SESSION_BUS_ADDRESS:
    "unix:path=/nonexistent/oma-local-tests-no-user-bus",
};

console.error(
  `LOCAL ONLY: ${files.length} files (${parallelFiles.length} parallel at concurrency ${concurrency}, ${serialFiles.length} serial); ` +
  `native execution regressions included: ${nativeExecutionTestFiles.length}`,
);

// The runner's own exit code says nothing about tests that did not run: a
// suite where four sandbox tests skipped because the host has no bubblewrap
// exits zero and reads as a pass. Each phase writes its own TAP summary, and
// every summary is parsed so a run that proved less than it claims fails
// here, the same way the verification lanes already treat a skip (R35). The
// spec output still reaches the terminal unchanged.
const summaryDir = mkdtempSync(join(tmpdir(), "oma-test-summary-"));
// Serial first: its files exist on this list because host-global state or a
// wall-clock budget is what they prove, so they run before the parallel
// phase can put any sibling process or leftover grandchild on the host.
const phases = [
  { name: "serial", files: serialFiles, concurrency: 1 },
  { name: "parallel", files: parallelFiles, concurrency },
].filter((phase) => phase.files.length > 0);

// Exit semantics match the former single-child runner: a signal or an unread
// summary is 1, unrun tests are 1, otherwise the first nonzero phase code is
// propagated so the suite's own answer is never rewritten here.
let phaseCode = 0;
let signaled = false;
const unrun = [];
const directives = [];
try {
  for (const phase of phases) {
    const summaryPath = join(summaryDir, `summary-${phase.name}.tap`);
    const child = spawn(
      process.execPath,
      ["--test", `--test-concurrency=${phase.concurrency}`,
        "--test-reporter=spec", "--test-reporter-destination=stdout",
        "--test-reporter=tap", `--test-reporter-destination=${summaryPath}`,
        ...phase.files],
      { stdio: "inherit", env: childEnv },
    );
    const [code, signal] = await once(child, "close");
    if (signal) signaled = true;
    else if ((code ?? 1) !== 0 && phaseCode === 0) phaseCode = code ?? 1;
    try {
      const summary = readFileSync(summaryPath, "utf8");
      for (const entry of unrunTests(summary)) unrun.push(`${phase.name}: ${entry}`);
      for (const directive of unrunDirectives(summary)) directives.push(`${phase.name}: ${directive}`);
    } catch (error) {
      unrun.push(`${phase.name}: summary unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  rmSync(summaryDir, { recursive: true, force: true });
}
if (unrun.length > 0) {
  console.error(`NOT A PASS: the suite left tests unrun (${unrun.join(", ")}).`);
  for (const directive of directives) console.error(`  ${directive}`);
}
process.exitCode = signaled || unrun.length > 0 ? 1 : phaseCode;
