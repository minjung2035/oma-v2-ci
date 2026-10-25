/** Pinned bubblewrap option grammar. Only option positions carry meaning;
 * literal values and command argv may themselves look like options. */
import { StoreError } from "@oma/domain/errors";
const ARITY: Readonly<Record<string, number>> = Object.freeze({
  "--unshare-all": 0, "--unshare-user": 0, "--share-net": 0, "--unshare-net": 0, "--unshare-pid": 0,
  "--share-pid": 0, "--as-pid-1": 0, "--new-session": 0, "--die-with-parent": 0, "--clearenv": 0,
  "--cap-drop": 1, "--seccomp": 1, "--proc": 1, "--dev": 1, "--size": 1, "--tmpfs": 1,
  "--remount-ro": 1, "--chdir": 1, "--ro-bind": 2, "--bind": 2, "--ro-bind-try": 2,
  "--symlink": 2, "--setenv": 2, "--dev-bind": 2, "--bind-fd": 2, "--ro-bind-fd": 2,
  "--ro-bind-data": 2, "--info-fd": 1, "--block-fd": 1, "--sync-fd": 1, "--args": 1,
});
export function parseBubblewrapArguments(args: readonly string[]): {
  readonly boundary: number;
  readonly options: readonly { readonly flag: string; readonly values: readonly string[] }[];
} {
  if (args.some(value => typeof value !== "string" || value.includes("\0")))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox arguments must be NUL-free strings");
  const options: { flag: string; values: readonly string[] }[] = [];
  for (let index = 0; index < args.length;) {
    const flag = args[index]!;
    if (flag === "--") {
      if (!args[index + 1]) break;
      return { boundary: index, options };
    }
    if (!Object.hasOwn(ARITY, flag)) throw new StoreError("UNSUPPORTED_PROFILE", "unsupported sandbox option");
    const arity = ARITY[flag]!;
    if (index + arity >= args.length) throw new StoreError("UNSUPPORTED_PROFILE", "sandbox option arguments are incomplete");
    options.push({ flag, values: args.slice(index + 1, index + arity + 1) }); index += arity + 1;
  }
  throw new StoreError("UNSUPPORTED_PROFILE", "sandbox options require an explicit command boundary");
}
