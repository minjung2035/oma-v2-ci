/** Trusted sandbox setup; successful setup replaces this process with the check. */
import { decodeCandidateInvocation, executeCandidateCheck } from "@oma/git/candidate-check";
import { StoreError } from "@oma/domain/errors";
import { writeSync, readSync, closeSync } from "node:fs";
import { closeOnExec } from "@oma/native/control-socket";
closeOnExec(6);
function status(value: object): void {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  if (writeSync(6, bytes) !== bytes.length) throw new Error("candidate exec status was not written");
}
try {
  if (process.argv.length !== 3) throw new StoreError("INVALID_REQUEST", "candidate check requires its closed invocation");
  await executeCandidateCheck(decodeCandidateInvocation(JSON.parse(process.argv[2]!)), () => {
    status({ kind: "prepared" });
    const release = Buffer.alloc(1);
    if (readSync(8, release) !== 1 || release[0] !== 1)
      throw new StoreError("REF_STATE_UNKNOWN", "candidate final exec gate was not authorized");
    closeSync(8);
    status({ kind: "ready" });
  });
} catch (error) {
  status({ kind: "failed", code: error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" ? "UNSUPPORTED_PROFILE" : "REF_STATE_UNKNOWN" });
  process.exitCode = 125;
}
