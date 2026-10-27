import { join } from "node:path";
import { startProcess, SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/async";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid } from "@oma/domain/identifiers";

/** The preparation child and its ordinary Git descendants share one owned
 * process group. Cancellation waits for the direct child's actual close;
 * inherited society/tree leases still fence any descendant whose final close
 * has not yet been observed. A signal is never their death proof. */
export async function prepareSociety(options: { readonly node: string; readonly libdir: string;
  readonly stateRoot: string; readonly society: string; readonly projectDir: string; readonly fence: number;
  readonly signal: AbortSignal; readonly log: (line: string) => void }): Promise<{ verifiedMain: string | null }> {
  const task = startProcess({ executable: options.node,
    argv: [join(options.libdir, "apps/oma/dist/entry/prepare-society.js"), options.stateRoot, options.society, options.projectDir],
    env: { PATH: "/usr/bin:/bin", [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) },
    timeoutMs: null, stdoutBytes: 1024, stderrBytes: 1024 * 1024, stderrOverflow: "discard",
  // startProcess maps extra descriptors from slot 3; duplicate the held fence
  // into the reserved slot so its declared product descriptor is still 4.
  }, { signal: options.signal, processGroup: true, inheritedFds: [options.fence, options.fence] });
  const result = await task.result;
  await task.closed;
  for (const line of result.stderr.toString("utf8").split("\n")) if (line.trim()) options.log(line);
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("BROKER_UNAVAILABLE", `society preparation ${result.kind}${result.kind === "exited" ? ` (${result.exitCode})` : ""}`);
  let value: unknown;
  try { value = JSON.parse(result.stdout.toString("utf8")); } catch { /* invalid child report */ }
  if (value === null || typeof value !== "object" || Object.keys(value).length !== 1 || !("verifiedMain" in value) ||
      (value.verifiedMain !== null && !isValidFullOid(value.verifiedMain)))
    throw new StoreError("BROKER_UNAVAILABLE", "society preparation returned an invalid verification observation");
  return { verifiedMain: value.verifiedMain as string | null };
}
