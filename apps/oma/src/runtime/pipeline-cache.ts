import { StoreError } from "@oma/domain/errors";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publicDownloads, downloadCacheKey, ensureDownloadCache, readDownloadCache } from "@oma/git/download-cache";
import { PreparationExecutor } from "@oma/process/preparation";
import { CANONICAL_SAFE_ARGS, GIT_BIN } from "@oma/git/canonical-command";
import { GIT_ENV } from "@oma/process/policies";
import { nodeToolchainMounts } from "@oma/domain/resident-paths";
import type { GitPaths } from "@oma/git/paths";
import type { CheckPipeline } from "@oma/contracts/integration";
export interface PreparedPipelineCache { root: string; key: string; files: string[]; state: "hit" | "rebuilt" }
export async function preparePipelineCache(paths: GitPaths, candidate: string, pipeline: CheckPipeline, signal: AbortSignal): Promise<PreparedPipelineCache | null> {
  if (pipeline.cachePolicy.kind === "off" || !paths.checkNode || !paths.checkAssetsDir) return null;
  const executor = new PreparationExecutor();
  const result = await executor.run({ executable: GIT_BIN, argv: [...CANONICAL_SAFE_ARGS, "--git-dir", paths.projectGit, "show", `${candidate}:${pipeline.cachePolicy.lockfile}`],
    env: GIT_ENV, timeoutMs: null, stdoutBytes: 16 * 1024 * 1024, stderrBytes: 8192, stderrOverflow: "discard" }, signal);
  if (result.kind !== "exited") throw new StoreError("RUN_TERMINATION_UNKNOWN", "cache preparation scope is unconfirmed");
  if (result.exitCode !== 0) return null;
  let downloads: ReturnType<typeof publicDownloads>, packageManager: string;
  try {
    downloads = publicDownloads(result.stdout);
    const npm = nodeToolchainMounts(paths.checkNode).find(([, target]) => target.endsWith("/npm"));
    const meta = JSON.parse(readFileSync(join(npm?.[0] ?? "/usr/share/nodejs/npm", "package.json"), "utf8"));
    packageManager = `npm@${meta.version}`;
  } catch { return null; }
  const key = downloadCacheKey(paths.projectGit, pipeline, result.stdout, packageManager), root = ensureDownloadCache(paths.stateRoot, key);
  const before = readDownloadCache(root, key, downloads); let manifest = before;
  if (manifest === null) {
    const fill = await executor.run({ executable: paths.checkNode, argv: [join(paths.checkAssetsDir, "apps/oma/dist/entry/download-cache.js")],
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, input: JSON.stringify({ root, key, lockfile: result.stdout.toString("base64") }),
      timeoutMs: null, stdoutBytes: 0, stdoutOverflow: "discard", stderrBytes: 8192, stderrOverflow: "discard" }, signal);
    if (fill.kind !== "exited") throw new StoreError("RUN_TERMINATION_UNKNOWN", "cache download helper scope is unconfirmed");
    if (fill.exitCode !== 0) return null;
    manifest = readDownloadCache(root, key, downloads);
  }
  return manifest === null ? null : { root, key, files: manifest.entries.map(entry => entry.file), state: before === null ? "rebuilt" : "hit" };
}
