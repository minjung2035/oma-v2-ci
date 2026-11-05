/** Fixed trusted sandbox entry. No general command, host path or shell API. */
import { decodeQuarantineInput, executeQuarantinePhase } from "@oma/git/quarantine-worker";
import { StoreError, exceptionText } from "@oma/domain/errors";
import { closeSync } from "node:fs";
import { enterDirectory } from "@oma/native/files";
try {
  if (process.argv.length !== 3) throw new StoreError("INVALID_REQUEST", "quarantine requires its closed invocation");
  if (process.platform === "darwin") { enterDirectory(9); closeSync(9); }
  await executeQuarantinePhase(decodeQuarantineInput(JSON.parse(process.argv[2]!)), process.platform === "darwin" ? "." : undefined);
} catch (error) {
  try { process.stderr.write(`quarantine setup failed: ${exceptionText(error)}\n`); } catch { /* Keep the closed error marker. */ }
  const code = error instanceof StoreError && ["BUNDLE_INVALID", "PREREQUISITE_MISSING", "REF_STATE_UNKNOWN", "UNSUPPORTED_PROFILE", "INTERNAL_ERROR"].includes(error.code)
    ? error.code : "REF_STATE_UNKNOWN";
  process.stderr.write(`\nOMA_ERROR=${code}\n`); process.exitCode = 1;
}
