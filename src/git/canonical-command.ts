// GIT-004/008: bounded canonical command adapter. Effect exit status is never CAS proof.
import { spawnSync } from "node:child_process";
import { GIT_ENV } from "../process/policies.js";
import { GitObserver, classifyRefAfterCas, type RefAfterCas } from "./observe.js";

export const GIT_BIN = "/usr/bin/git";
export const CANONICAL_PROCESS_LIMITS = { timeout: 120000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" as const };
export function gitUncertain(result: { error?: Error; signal: NodeJS.Signals | null; status: number | null }): boolean {
  return Boolean(result.error) || result.signal !== null || result.status === null;
}
export function createCanonicalObserver(): GitObserver {
  return new GitObserver((args, input) => {
    const format = args.includes("--show-object-format");
    const commit = args.includes("--batch-check=%(objecttype)");
    const result = spawnSync(GIT_BIN, [...args], {
      ...CANONICAL_PROCESS_LIMITS, env: GIT_ENV, timeout: format ? 30000 : commit ? 10000 : 120000,
      maxBuffer: format ? 1024 : commit ? 64 * 1024 : 4 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
    });
    return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
      ...(result.error === undefined ? {} : { error: result.error }) };
  });
}
export function compareAndSwapCanonicalRef(observations: GitObserver, repository: string, ref: string,
  candidate: string, expected: string | null): RefAfterCas {
  spawnSync(GIT_BIN, ["--git-dir", repository, "update-ref", ref, candidate, expected ?? ""], { ...CANONICAL_PROCESS_LIMITS, env: GIT_ENV });
  return classifyRefAfterCas(observations.ref(repository, ref), expected, candidate);
}
