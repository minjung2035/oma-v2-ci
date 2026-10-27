/** Fixed trusted sandbox entry. No general command, host path or shell API. */
import { decodeQuarantineInput, executeQuarantinePhase } from "@oma/git/quarantine-worker";
import { StoreError } from "@oma/domain/errors";
try {
  if (process.argv.length !== 3) throw new StoreError("INVALID_REQUEST", "quarantine requires its closed invocation");
  await executeQuarantinePhase(decodeQuarantineInput(JSON.parse(process.argv[2]!)));
} catch (error) {
  const code = error instanceof StoreError && ["BUNDLE_INVALID", "PREREQUISITE_MISSING", "REF_STATE_UNKNOWN", "UNSUPPORTED_PROFILE", "INTERNAL_ERROR"].includes(error.code)
    ? error.code : "REF_STATE_UNKNOWN";
  process.stderr.write(`\nOMA_ERROR=${code}\n`); process.exitCode = 1;
}
