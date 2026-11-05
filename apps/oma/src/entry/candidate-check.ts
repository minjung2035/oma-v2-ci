/** Trusted sandbox setup; successful setup replaces this process with the check. */
import { decodeCandidateInvocation, executeCandidateCheck } from "@oma/git/candidate-check";
import { StoreError, exceptionText } from "@oma/domain/errors";
import { writeSync, readSync, closeSync } from "node:fs";
import { closeOnExec, inheritOnExec } from "@oma/native/control-socket";
import { enterDirectory } from "@oma/native/files";
closeOnExec(6);
function status(value: object): void {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  for (let at = 0; at < bytes.length;) { const count = writeSync(6, bytes, at); if (count <= 0) throw new Error("candidate exec status was not written"); at += count; }
}
try {
  if (process.argv.length !== 3) throw new StoreError("INVALID_REQUEST", "candidate check requires its closed invocation");
  // This entry owns one disposable setup process. The Broker retains its
  // independent cwd. Slot7 is the canonical directory supplied by its owner.
  if (process.platform === "darwin") { enterDirectory(7); closeSync(7); }
  process.exitCode = await executeCandidateCheck(decodeCandidateInvocation(JSON.parse(process.argv[2]!)), () => {
    // The Darwin recipe explicitly transfers only its staging lease in slot
    // 9. Node startup marks inherited descriptors CLOEXEC again; restore this
    // one cooperation hold before the final exec. Linux consumes different
    // slots in bwrap and has no staging lease in this position.
    if (process.platform === "darwin") inheritOnExec(9);
    status({ kind: "prepared" });
    const release = Buffer.alloc(1);
    if (readSync(8, release) !== 1 || release[0] !== 1)
      throw new StoreError("REF_STATE_UNKNOWN", "candidate final exec gate was not authorized");
    closeSync(8);
    status({ kind: "ready" });
  }, status, process.platform === "darwin" ? "." : undefined);
} catch (error) {
  try { process.stderr.write(`candidate setup failed: ${exceptionText(error)}\n`); } catch { /* Keep the private failure outcome. */ }
  status({ kind: "failed", code: error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" ? "UNSUPPORTED_PROFILE" : "REF_STATE_UNKNOWN" });
  process.exitCode = 125;
}
