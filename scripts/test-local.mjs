#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { once } from "node:events";
import { localTestFiles, systemdTestFiles } from "./verification-lanes.mjs";
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
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files],
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
process.exitCode = signal ? 1 : (code ?? 1);
