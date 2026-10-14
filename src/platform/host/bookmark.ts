/** MAC-401/403: a one-shot Foundation operation in the signed helper. No VM. */
import { isAbsolute, join, dirname } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { decodeProcessText, runProcess } from "../../process/run.js";
import { macBundleResources } from "./bundle.js";

export interface ProjectBookmarks {
  create(path: string): Promise<string>;
  resolve(bookmark: string): Promise<string>;
}

export function bundledProjectBookmarks(libdir: string): ProjectBookmarks {
  const resources = macBundleResources(libdir);
  return nativeProjectBookmarks(join(dirname(resources), "MacOS", "oma-vmhelper"));
}

export function nativeProjectBookmarks(executable: string): ProjectBookmarks {
  const ask = async (input: Record<string, string>): Promise<Record<string, unknown>> => {
    const result = await runProcess({ executable, argv: ["--project-bookmark"], input: JSON.stringify(input),
      env: { PATH: "/usr/bin:/bin" }, timeoutMs: 10_000, stdoutBytes: 1024 * 1024, stderrBytes: 4096 });
    if (result.kind !== "exited" || result.exitCode !== 0)
      throw new StoreError("BROKER_UNAVAILABLE", "The project bookmark could not be observed");
    try {
      const value: unknown = JSON.parse(decodeProcessText(result.stdout));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid reply");
      return value as Record<string, unknown>;
    } catch { throw new StoreError("BROKER_UNAVAILABLE", "The project bookmark could not be observed"); }
  };
  return {
    async create(path) {
      if (!isAbsolute(path) || path.includes("\0")) throw new StoreError("INVALID_REQUEST", "Invalid project folder");
      const result = await ask({ op: "create", path });
      if (Object.keys(result).join(",") !== "bookmark" || typeof result.bookmark !== "string" ||
          !result.bookmark || Buffer.from(result.bookmark, "base64").toString("base64") !== result.bookmark)
        throw new StoreError("BROKER_UNAVAILABLE", "The project bookmark could not be observed");
      return result.bookmark;
    },
    async resolve(bookmark) {
      const result = await ask({ op: "resolve", bookmark });
      if (Object.keys(result).join(",") !== "path" || typeof result.path !== "string" ||
          !isAbsolute(result.path) || result.path.includes("\0"))
        throw new StoreError("BROKER_UNAVAILABLE", "The project bookmark could not be observed");
      return result.path;
    },
  };
}
