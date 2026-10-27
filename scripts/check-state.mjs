#!/usr/bin/env node
/** P6 admin verification entry. No public oma subcommand and no repair mode. */
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readDiagnosticSnapshot } from "@oma/storage";
import { DIAGNOSTIC_READ_LIMITS } from "@oma/storage/diagnostic-snapshot";
import { inspectLedger } from "@oma/app/diagnostics/ledger";
import { inspectIntegrity } from "@oma/app/diagnostics/integrity";
import { NodeIntegrityFiles } from "@oma/app/diagnostics/files";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { canonicalJson, sha256Hex } from "@oma/domain/canonical-json";
import { createDiagnosticObservers } from "./diagnostic-observers.mjs";

export function parseDiagnosticArgs(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!["--state", "--society", "--mode", "--quiesced", "--max-rows"].includes(key) || values.has(key)) throw new TypeError("unsupported or repeated diagnostic option");
    if (key === "--quiesced") values.set(key, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new TypeError("missing diagnostic option value");
      values.set(key, value);
    }
  }
  const stateRoot = values.get("--state"), society = values.get("--society"), mode = values.get("--mode");
  if (typeof stateRoot !== "string" || !isAbsolute(stateRoot) || stateRoot.includes("\0") || stateRoot.split("/").some(p => p === "." || p === "..") ||
    !isValidSocietyName(society) || !["offline", "live"].includes(mode)) throw new TypeError("usage: check-state.mjs --state <absolute-state-root> --society <name> --mode offline|live [--quiesced] [--max-rows N]");
  if ((mode === "offline") !== values.has("--quiesced")) throw new TypeError("offline requires --quiesced; live forbids it");
  const maxRows = values.has("--max-rows") ? Number(values.get("--max-rows")) : DIAGNOSTIC_READ_LIMITS.maxRows;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > DIAGNOSTIC_READ_LIMITS.maxRows) throw new RangeError("max-rows must be within the declared diagnostic budget");
  return { context: { stateRoot, society }, mode, maxRows };
}
export function checkState(args) {
  const { context, mode, maxRows } = parseDiagnosticArgs(args);
  const limits = { ...DIAGNOSTIC_READ_LIMITS, maxRows };
  const before = readDiagnosticSnapshot(context.stateRoot, limits);
  const observations = createDiagnosticObservers(context);
  const report = inspectIntegrity(before, context, { mode, maxRows, files: new NodeIntegrityFiles(), git: observations.git,
    ...(mode === "live" ? { units: observations.units } : {}) });
  // A SQLite snapshot is atomic, but it does not freeze subsequent file reads.
  // Detect concurrent ledger changes instead of asserting coherent physical proof.
  const after = readDiagnosticSnapshot(context.stateRoot, limits);
  const changed = sha256Hex(canonicalJson(before)) !== sha256Hex(canonicalJson(after));
  const pure = inspectLedger(before, context, { maxRows }).report;
  return { ...report,
    ...(changed && pure.status !== "FAIL" ? { status: "UNKNOWN", observationWarning: "LEDGER_CHANGED_DURING_PHYSICAL_SCAN" } : {}),
    consistency: mode === "offline" ? "operator-asserted quiescence; stable ledger rechecked" : "live sequential observations, not an atomic host snapshot",
    commands: observations.commands };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = checkState(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === "PASS" ? 0 : report.status === "FAIL" ? 1 : 2;
  } catch (error) {
    const corrupt = error?.code === "STORE_CORRUPT";
    console.log(JSON.stringify({ status: corrupt ? "FAIL" : "UNKNOWN", code: corrupt ? "STORE_CORRUPT" : "DIAGNOSTIC_UNAVAILABLE",
      scope: "no repair, migration or completion was performed" }));
    process.exitCode = corrupt ? 1 : 2;
  }
}
