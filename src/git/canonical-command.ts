// GIT-004/008: bounded canonical command adapter. Effect exit status is never CAS proof.
import { GIT_ENV } from "../process/policies.js";
import { runProcessSync } from "../process/run.js";
import { GitObserver, classifyRefAfterCas, gitOidArgument, gitRefArgument, type GitProcessEvidence, type RefAfterCas } from "./observe.js";

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
  // P0V-116: the adapter's own invariant; a refused argument is no observation.
  evidence(["--git-dir", repository, "update-ref", gitRefArgument(ref), gitOidArgument(candidate), expected === null ? "" : gitOidArgument(expected)],
    CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer);
  return classifyRefAfterCas(observations.ref(repository, ref), expected, candidate);
}
/** A ref made only from nothing. What the ref holds afterwards is the observed
 * value, as for every CAS; whether this command is the one that made it is its
 * own success, which matters only when a concurrent maker produced the same
 * object -- the ref then holds this candidate either way (P0V-85). */
export function createCanonicalRef(observations: GitObserver, repository: string, ref: string,
  candidate: string): { readonly after: RefAfterCas; readonly created: boolean } {
  const made = evidence(["--git-dir", repository, "update-ref", gitRefArgument(ref), gitOidArgument(candidate), ""],
    CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer);
  const after = classifyRefAfterCas(observations.ref(repository, ref), null, candidate);
  return { after, created: after.kind === "candidate" && made.status === 0 };
}
