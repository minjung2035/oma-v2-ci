/** INT-002/007: a check reads an exact commit in a disposable sandbox.
 * systemd owns the whole process tree; there is no host execution fallback,
 * persistent checker, request file, checkout cleanup or model-facing endpoint.
 */
import type { CommandSpec, ProcessObservation } from "../process/command.js";
import { runProcess } from "../process/run.js";
import { sandboxSeccompFilter } from "./sandbox-seccomp.js";
import { hostSystemLayout } from "./resident-rootfs.js";
import { RESIDENT_PATHS, SYSTEM_BIND_CANDIDATES, nodeToolchainMounts } from "../sandbox.js";
import { trustedAbsolutePath } from "../protocol/run-lease.js";
import { isValidFullOid } from "../ids.js";
import { sha256Hex } from "../hash.js";
import { StoreError } from "../domain/errors.js";
import type { GitPaths } from "../git/paths.js";
import { assertCheckResources, type FrozenCheck } from "../git/integration-policy.js";
import { createCanonicalObserver } from "../git/canonical-command.js";
import { observed, requireNoGitlinks, type GitObserver } from "../git/observe.js";

// Fetch and checkout, rather than archive: export-ignore/export-subst must not
// omit or rewrite tracked bytes. No user Git configuration, filters or hooks.
// gitlinks need a separately pinned dependency contract and are refused —
// the refusal announces its class on stderr before the bare exit so the host
// can name it; a 125 without the marker stays an unclassified failure (the
// resource gate shares that code).
export const CHECK_CHECKOUT = [
  "set -eu",
  "candidate=$1; project=$2; workspace=$3; temp=$4; shift 4",
  "format=$(git --git-dir=\"$project\" rev-parse --show-object-format)",
  "git init -q --object-format=\"$format\" \"$workspace\"",
  "git -C \"$workspace\" fetch -q --no-tags --no-write-fetch-head --no-auto-maintenance \"$project\" \"$candidate\"",
  "git -C \"$workspace\" ls-tree -r \"$candidate\" > \"$temp/oma-tree\"",
  "if /usr/bin/grep -q '^160000 ' \"$temp/oma-tree\"; then",
  "  echo OMA_ERROR=UNSUPPORTED_PROFILE >&2",
  "  /usr/bin/awk -F '\\t' '/^160000 / { print \"OMA_GITLINK=\" $2 }' \"$temp/oma-tree\" >&2",
  "  exit 125",
  "fi",
  "printf '%s\\n' '* -text -filter -ident !eol !working-tree-encoding' > \"$workspace/.git/info/attributes\"",
  "git -C \"$workspace\" -c core.autocrlf=false -c core.symlinks=true checkout -q --detach \"$candidate\"",
  "cd \"$workspace\"",
  "exec \"$@\" </dev/null",
].join("\n");

export function candidateCheckCommand(paths: GitPaths, candidate: string, check: FrozenCheck,
  systemBinds: readonly string[] = hostSystemLayout().binds): CommandSpec {
  assertCheckResources(check);
  if (systemBinds.some(path => !SYSTEM_BIND_CANDIDATES.includes(path)))
    throw new StoreError("UNSUPPORTED_PROFILE", "integration check system mounts must be operating-system paths");
  if (!isValidFullOid(candidate) || !trustedAbsolutePath(paths.stateRoot) ||
      !trustedAbsolutePath(paths.projectGit) || !trustedAbsolutePath(paths.checkRootfs) ||
      !trustedAbsolutePath(paths.checkNode) || !trustedAbsolutePath(paths.checkAssetsDir))
    throw new StoreError("UNSUPPORTED_PROFILE", "integration checks require trusted sandbox roots and a pinned Node");
  const environment = { ...check.env, HOME: "/tmp", PATH: "/opt/oma-node:/usr/bin:/bin", LANG: "C", LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_ATTR_NOSYSTEM: "1", GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "core.attributesFile", GIT_CONFIG_VALUE_1: "/dev/null" };
  for (const [key, value] of Object.entries(environment))
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes("\0"))
      throw new StoreError("UNSUPPORTED_PROFILE", "integration check environment is invalid");
  const sandbox = ["/usr/bin/bwrap", "--unshare-all", "--share-net", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    // --pipe preserves stdin through the manager; bwrap consumes the filter
    // before starting the checked program, whose stdin is then /dev/null.
    "--seccomp", "0", "--ro-bind", paths.checkRootfs, "/",
    ...systemBinds.flatMap(path => ["--ro-bind", path, path]),
    "--ro-bind", paths.checkNode, RESIDENT_PATHS.node,
    // FI-2: a check argv of `npm test` finds the same toolchain a Worker has.
    ...nodeToolchainMounts(paths.checkNode).flatMap(([source, target]) => ["--ro-bind-try", source, target]),
    "--ro-bind", paths.checkAssetsDir, RESIDENT_PATHS.libdir,
    "--ro-bind", paths.projectGit, RESIDENT_PATHS.projectGit,
    "--proc", "/proc", "--dev", "/dev",
    "--tmpfs", "/workspace", "--tmpfs", "/tmp", "--clearenv",
    ...Object.entries(environment).flatMap(([key, value]) => ["--setenv", key, value]),
    "--", "/bin/sh", "-c", CHECK_CHECKOUT, "oma-candidate", candidate, "/git/project.git", "/workspace", "/tmp", ...check.argv];
  return {
    executable: "/usr/bin/systemd-run",
    argv: ["--user", "--quiet", "--wait", "--pipe", "--collect", "--service-type=exec", "--expand-environment=no",
      // The same society tree cannot run another check alongside an uncertain
      // previous check, even after broker restart. No caller chooses this name.
      `--unit=oma-check-${sha256Hex(paths.stateRoot).slice(0, 32)}.service`,
      ...["ExitType=cgroup", "KillMode=control-group", "SendSIGKILL=yes", "OOMPolicy=kill", "UMask=0077",
        "TimeoutStopSec=10s", "TasksMax=infinity",
      ].map(property => `--property=${property}`),
      "--", ...sandbox],
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
      ...(process.env.XDG_RUNTIME_DIR === undefined ? {} : { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }),
      ...(process.env.DBUS_SESSION_BUS_ADDRESS === undefined ? {} : { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }) },
    input: sandboxSeccompFilter(), timeoutMs: null,
    stdoutBytes: 1024 * 1024, stdoutOverflow: "discard", stderrBytes: 1024 * 1024, stderrOverflow: "discard",
  };
}

// UX-09: the sandbox's refusal marker — the only bytes that make a nonzero
// exit a named refusal rather than a failed check. The marker must own its
// whole line exactly as `echo` emits it (`OMA_ERROR=UNSUPPORTED_PROFILE\n`):
// the same bytes inside a longer line are a check's own output, not the
// refusal class — stderr is bytes a check argv controls.
const GITLINK_REFUSAL = /(?:^|\n)OMA_ERROR=UNSUPPORTED_PROFILE(?:\n|$)/;

export class CandidateChecks {
  constructor(private readonly paths: GitPaths,
    private readonly execute: (command: CommandSpec) => Promise<ProcessObservation> = runProcess,
    private readonly observations: Pick<GitObserver, "gitlinks"> = createCanonicalObserver(),
    private readonly ownerSignal?: AbortSignal) {}
  async run(candidate: string, check: FrozenCheck): Promise<void> {
    if (this.ownerSignal?.aborted) throw new StoreError("REF_STATE_UNKNOWN", "check owner is stopping");
    const command = candidateCheckCommand(this.paths, candidate, check);
    let settled = false;
    let cancellation: Promise<void> | undefined;
    const stop = (): void => {
      cancellation ??= (async () => {
        // The start request can still be reaching the manager. Retry stop until
        // --wait has settled the actual cgroup, retaining the Store meanwhile.
        // Killing the systemd-run client alone would leave the check running.
        while (!settled) {
          await runProcess({ executable: "/usr/bin/systemctl", argv: ["--user", "stop",
            `oma-check-${sha256Hex(this.paths.stateRoot).slice(0, 32)}.service`],
            env: command.env, timeoutMs: 30_000, stdoutBytes: 4096, stderrBytes: 4096 });
          if (!settled) await new Promise<void>(resolve => setTimeout(resolve, 50));
        }
      })();
    };
    this.ownerSignal?.addEventListener("abort", stop, { once: true });
    let observation: ProcessObservation;
    try { observation = await this.execute(command); }
    finally { settled = true; this.ownerSignal?.removeEventListener("abort", stop); await cancellation; }
    if (this.ownerSignal?.aborted) throw new StoreError("REF_STATE_UNKNOWN", `trusted check ${check.id} was interrupted by owner shutdown`);
    if (observation.kind !== "exited")
      throw new StoreError("REF_STATE_UNKNOWN", `trusted check ${check.id} outcome is ${observation.kind}`);
    if (observation.exitCode === 0) return;
    if (GITLINK_REFUSAL.test(observation.stderr.toString("utf8"))) this.refuseGitlinks(candidate);
    throw new StoreError("CHECK_FAILED", `trusted check ${check.id} did not pass (runner exit ${observation.exitCode})`);
  }
  /** The marker is check-controlled output — a claim, not content: the paths
   * it asserts are re-observed on the immutable candidate, and only a
   * `present` answer carrying at least one earns the gitlink refusal. Every
   * other observation kind settles as itself through observed(), exactly as
   * the admission gates read it — an unanswered look stays REF_STATE_UNKNOWN
   * (reconcilable, never terminal failed), corrupt output stays STORE_CORRUPT,
   * and a candidate name outside the grammar stays the candidate-scope
   * INVALID_REQUEST. A `present` answer with no gitlinks means the marker
   * disproved itself: the run falls through to the unclassified CHECK_FAILED
   * the nonzero exit already is. Defense in depth only — requireEligible made
   * the same refusal before the check argv could run. */
  private refuseGitlinks(candidate: string): void {
    requireNoGitlinks(observed(this.observations.gitlinks(this.paths.projectGit, candidate), "candidate gitlinks"));
  }
}
