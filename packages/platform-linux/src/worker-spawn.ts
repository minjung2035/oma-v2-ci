/** Linux sandbox option grammar. Process owns pipe delivery and child lifetime. */
import { StoreError } from "@oma/domain/errors";
import { spawnWithPrivateInputs, type ChildProcessWithoutNullStreams } from "@oma/process/async";
/** The pinned recipes' option grammar, not an allowlist of values. An option
 * value may itself be "--", "--args" or "--seccomp"; only option positions
 * carry meaning. The command and its arguments are never parsed here. */
const SANDBOX_OPTION_ARITY: Readonly<Record<string, number>> = Object.freeze({
  "--unshare-all": 0, "--share-net": 0, "--unshare-net": 0, "--unshare-pid": 0,
  "--new-session": 0, "--die-with-parent": 0, "--clearenv": 0,
  "--cap-drop": 1, "--seccomp": 1, "--proc": 1, "--dev": 1,
  "--size": 1, "--tmpfs": 1, "--remount-ro": 1, "--chdir": 1,
  "--ro-bind": 2, "--bind": 2, "--ro-bind-try": 2, "--symlink": 2, "--setenv": 2,
});
function sandboxCommandBoundary(args: readonly string[], filter: Uint8Array | undefined): number {
  let filters = 0;
  for (let index = 0; index < args.length;) {
    const option = args[index]!;
    if (option === "--") {
      if (!args[index + 1]) break;
      if (filters !== (filter === undefined ? 0 : 1))
        throw new StoreError("UNSUPPORTED_PROFILE", "a sandbox's filter and its --seccomp 3 argument come together");
      return index;
    }
    if (option === "--args")
      throw new StoreError("UNSUPPORTED_PROFILE", "sandbox arguments already have a private descriptor owner");
    if (!Object.hasOwn(SANDBOX_OPTION_ARITY, option))
      throw new StoreError("UNSUPPORTED_PROFILE", "unsupported sandbox option");
    const arity = SANDBOX_OPTION_ARITY[option]!;
    if (index + arity >= args.length)
      throw new StoreError("UNSUPPORTED_PROFILE", "sandbox option arguments are incomplete");
    if (option === "--seccomp") {
      if (args[index + 1] !== "3")
        throw new StoreError("UNSUPPORTED_PROFILE", "a sandbox's filter and its --seccomp 3 argument come together");
      filters++;
    }
    index += arity + 1;
  }
  throw new StoreError("UNSUPPORTED_PROFILE", "sandbox options require an explicit command boundary");
}

export function spawnSandboxed(argv: readonly string[], env: Readonly<Record<string, string>>, filter?: Uint8Array,
  cwd = "/"): ChildProcessWithoutNullStreams {
  if (argv.some(value => typeof value !== "string" || value.includes("\0")))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox arguments must be NUL-free strings");
  if ((argv[0] !== "bwrap" && argv[0] !== "/usr/bin/bwrap") || argv.length < 2)
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox spawn requires direct pinned bubblewrap argv");
  const args = argv.slice(1), boundary = sandboxCommandBoundary(args, filter);
  const encoded = Buffer.from(args.slice(0, boundary).map(value => value + "\0").join(""));
  return spawnWithPrivateInputs("/usr/bin/bwrap", ["--args", "5", ...args.slice(boundary)], cwd, env,
    [...(filter === undefined ? [] : [{ fd: 3, bytes: filter }]), { fd: 5, bytes: encoded }]);
}
