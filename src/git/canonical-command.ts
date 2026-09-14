// GIT-004/008: bounded canonical command adapter. Effect exit status is never CAS proof.
import { GIT_ENV } from "../process/policies.js";
import { runProcessSync } from "../process/run.js";
import { GitObserver, classifyRefAfterCas, type GitProcessEvidence, type RefAfterCas } from "./observe.js";

export const GIT_BIN = "/usr/bin/git";
export const CANONICAL_PROCESS_LIMITS = { timeout: 120000, maxBuffer: 4 * 1024 * 1024 } as const;
/** Native execution is owned by process/run.ts. Both byte budgets are the same
 * single bound, so the native combined stdout+stderr cap is unchanged. */
function evidence(argv: readonly string[], timeoutMs: number, maxBuffer: number, input?: string): GitProcessEvidence {
  const result = runProcessSync({ executable: GIT_BIN, argv, env: GIT_ENV,
    timeoutMs, stdoutBytes: maxBuffer, stderrBytes: maxBuffer,
    ...(input === undefined ? {} : { input }) });
  return { status: result.kind === "exited" ? result.exitCode : null, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr };
}
export function createCanonicalObserver(): GitObserver {
  return new GitObserver((args, input) => {
    const format = args.includes("--show-object-format");
    const commit = args.includes("--batch-check=%(objecttype)");
    return evidence([...args], format ? 30000 : commit ? 10000 : CANONICAL_PROCESS_LIMITS.timeout,
      format ? 1024 : commit ? 64 * 1024 : CANONICAL_PROCESS_LIMITS.maxBuffer, input);
  });
}
export function compareAndSwapCanonicalRef(observations: GitObserver, repository: string, ref: string,
  candidate: string, expected: string | null): RefAfterCas {
  evidence(["--git-dir", repository, "update-ref", ref, candidate, expected ?? ""],
    CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer);
  return classifyRefAfterCas(observations.ref(repository, ref), expected, candidate);
}
