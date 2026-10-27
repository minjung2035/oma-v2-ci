/** Linux sandbox option grammar. Process owns pipe delivery and child lifetime. */
import { parseBubblewrapArguments } from "./bubblewrap-arguments.js";
import { StoreError } from "@oma/domain/errors";
import { spawnWithPrivateInputs, type ChildProcessWithoutNullStreams } from "@oma/process/async";
/** The pinned recipes' option grammar, not an allowlist of values. An option
 * value may itself be "--", "--args" or "--seccomp"; only option positions
 * carry meaning. The command and its arguments are never parsed here. */
const WORKER_OPTIONS = new Set([
  "--unshare-all", "--share-net", "--unshare-net", "--unshare-pid", "--new-session", "--die-with-parent", "--clearenv",
  "--cap-drop", "--seccomp", "--proc", "--dev", "--size", "--tmpfs", "--remount-ro", "--chdir",
  "--ro-bind", "--bind", "--ro-bind-try", "--symlink", "--setenv",
]);
function sandboxCommandBoundary(args: readonly string[], filter: Uint8Array | undefined): number {
  const parsed = parseBubblewrapArguments(args); let filters = 0;
  for (const option of parsed.options) {
    if (option.flag === "--args") throw new StoreError("UNSUPPORTED_PROFILE", "sandbox arguments already have a private descriptor owner");
    if (!WORKER_OPTIONS.has(option.flag)) throw new StoreError("UNSUPPORTED_PROFILE", "unsupported sandbox option");
    if (option.flag === "--seccomp") {
      if (option.values[0] !== "3") throw new StoreError("UNSUPPORTED_PROFILE", "a sandbox's filter and its --seccomp 3 argument come together");
      filters++;
    }
  }
  if (filters !== (filter === undefined ? 0 : 1)) throw new StoreError("UNSUPPORTED_PROFILE", "a sandbox's filter and its --seccomp 3 argument come together");
  return parsed.boundary;
}

export function spawnSandboxed(argv: readonly string[], env: Readonly<Record<string, string>>, filter?: Uint8Array,
  cwd = "/"): ChildProcessWithoutNullStreams {
  if ((argv[0] !== "bwrap" && argv[0] !== "/usr/bin/bwrap") || argv.length < 2)
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox spawn requires direct pinned bubblewrap argv");
  const args = argv.slice(1), boundary = sandboxCommandBoundary(args, filter);
  const encoded = Buffer.from(args.slice(0, boundary).map(value => value + "\0").join(""));
  return spawnWithPrivateInputs("/usr/bin/bwrap", ["--args", "5", ...args.slice(boundary)], cwd, env,
    [...(filter === undefined ? [] : [{ fd: 3, bytes: filter }]), { fd: 5, bytes: encoded }]);
}
