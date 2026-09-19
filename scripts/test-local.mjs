#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { localTestFiles, systemdTestFiles, unrunDirectives, unrunTests } from "./verification-lanes.mjs";
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
  ...localTestFiles(compiled).map((file) => `dist/test/${file}`),
  ...readdirSync("test")
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => `test/${file}`),
];
console.error(
  `LOCAL ONLY: ${files.length} files; systemd-required NOT_RUN: ${systemdTestFiles.join(", ")}`,
);
const guard = new URL("./local-test-guard.mjs", import.meta.url).href;
// The runner's own exit code says nothing about tests that did not run: a
// suite where four sandbox tests skipped because the host has no bubblewrap
// exits zero and reads as a pass. The summary is parsed so a run that proved
// less than it claims fails here, the same way the verification lanes already
// treat a skip (R35). The spec output still reaches the terminal unchanged.
const summaryPath = join(mkdtempSync(join(tmpdir(), "oma-test-summary-")), "summary.tap");
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1",
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=tap", `--test-reporter-destination=${summaryPath}`,
    ...files],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      OMA_TEST_SYSTEMD: "0",
      NODE_OPTIONS: `--import=${guard}`,
      DBUS_SESSION_BUS_ADDRESS:
        "unix:path=/nonexistent/oma-local-tests-no-user-bus",
    },
  },
);
const [code, signal] = await once(child, "close");
let unrun = [];
try {
  const summary = readFileSync(summaryPath, "utf8");
  unrun = unrunTests(summary);
  if (unrun.length > 0) {
    console.error(`NOT A PASS: the suite left tests unrun (${unrun.join(", ")}).`);
    for (const directive of unrunDirectives(summary)) console.error(`  ${directive}`);
  }
} catch (error) {
  unrun = [`summary unreadable: ${error instanceof Error ? error.message : String(error)}`];
  console.error(`NOT A PASS: ${unrun[0]}`);
} finally {
  rmSync(dirname(summaryPath), { recursive: true, force: true });
}
process.exitCode = signal ? 1 : unrun.length > 0 ? 1 : (code ?? 1);
