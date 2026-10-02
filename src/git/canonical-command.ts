// GIT-004/008: bounded canonical command adapter. Effect exit status is never CAS proof.
import { GIT_ENV } from "../process/policies.js";
import { StoreError } from "../domain/errors.js";
import { runProcessSync } from "../process/run.js";
import { GitObserver, classifyRefAfterCas, gitOidArgument, gitRefArgument, type GitProcessEvidence, type GitObservation, type RefAfterCas } from "./observe.js";

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

/** DR27: a no-op has no changed main ref to witness completed authorization.
 * Verify main and create one immutable operation ref in the same Git ref
 * transaction. Only that one ref changes, so there is no multi-ref crash-
 * atomicity assumption. A child exit is not proof: read the witness afterwards. */
export function authorizeCanonicalNoop(observations: GitObserver, repository: string, ref: string,
  candidate: string): GitObservation<string> {
  evidence(["--git-dir", repository, "update-ref", "--stdin"], CANONICAL_PROCESS_LIMITS.timeout,
    CANONICAL_PROCESS_LIMITS.maxBuffer, `start\nverify refs/heads/main ${gitOidArgument(candidate)}\n` +
      `create ${gitRefArgument(ref)} ${gitOidArgument(candidate)}\nprepare\ncommit\n`);
  return observations.ref(repository, ref);
}

/** The pinned safe configuration every broker-run diff/merge-tree against the
 * canonical repository carries: no hooks, no fsmonitor, no attributes, no
 * external diff driver and no network protocol. */
export const CANONICAL_SAFE_ARGS: readonly string[] = ["--no-pager", "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null", "-c", "diff.external=",
  "-c", "protocol.allow=never"];

/** mail-v1 §6: the canonical merge diff for a completion notice. Output is
 * caller-bounded; exceeding maxBytes throws LIMIT_EXCEEDED and a non-zero or
 * unobserved exit is a REF_STATE_UNKNOWN observation failure, never a diff. */
export function canonicalMergeDiff(repository: string, base: string, candidate: string, maxBytes: number): string {
  const result = runProcessSync({ executable: GIT_BIN,
    argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository,
      "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", base, candidate],
    env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: "1" },
    timeoutMs: CANONICAL_PROCESS_LIMITS.timeout, stdoutBytes: maxBytes, stderrBytes: 8192 });
  if (result.kind === "output-limited") throw new StoreError("LIMIT_EXCEEDED", "merge diff exceeds its document bound");
  if (result.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", "merge diff timed out");
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("REF_STATE_UNKNOWN", `canonical merge diff is ${result.kind}${result.exitCode !== null ? ` ${result.exitCode}` : ""}`);
  try { return result.stdout.toString("utf8"); }
  catch { throw new StoreError("INTERNAL_ERROR", "canonical merge diff is not UTF-8 text"); }
}
