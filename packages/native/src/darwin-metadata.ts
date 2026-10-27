/** The fixed child observes read-only metadata and has no descendants.
 * fchdir is isolated here because changing a multithreaded Node host's cwd
 * would change the meaning of unrelated pathname operations. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodeMetadataObservation, type EntryMetadataObservation } from "./metadata-observation.js";

const helper = fileURLToPath(new URL("./metadata/oma-file-metadata", import.meta.url));
export function darwinMetadata(parent: number, name: string): EntryMetadataObservation {
  const result = spawnSync(helper, [name], { stdio: ["ignore", "pipe", "pipe", parent],
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 5000, killSignal: "SIGKILL", maxBuffer: 4096 });
  if (result.error || result.signal || result.status !== 0)
    throw new Error("session metadata could not be observed", { cause: result.error ??
      new Error(`native helper status ${String(result.status)}, signal ${String(result.signal)}: ${result.stderr?.toString("utf8") ?? ""}`) });
  return decodeMetadataObservation(result.stdout);
}
