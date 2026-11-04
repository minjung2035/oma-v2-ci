/** Only integrity-pinned public npm tarballs enter this optional cache.
 * No candidate workspace, HOME, npmrc, registry credentials or installed tree is exported. */
import { createHash } from "node:crypto";
import { readFileSync, closeSync, readSync, fstatSync } from "node:fs";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { join } from "node:path";
import { createResult } from "@oma/tool-files/results";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { replaceDerivedFile } from "@oma/storage/durable-fs";
import { canonicalJson, sha256Hex } from "@oma/domain/canonical-json";
import type { CheckPipeline } from "@oma/contracts/integration";
export interface Download { url: string; integrity: string }
export interface DownloadCacheManifest { version: 1; key: string; entries: Array<Download & { file: string; bytes: number; sha256: string }> }
export function publicDownloads(lockfile: Buffer): Download[] {
  const lock = JSON.parse(lockfile.toString("utf8")) as { packages?: Record<string, { resolved?: unknown; integrity?: unknown }> };
  const entries = new Map<string, Download>();
  for (const value of Object.values(lock.packages ?? {})) {
    if (!value || typeof value !== "object" || typeof value.resolved !== "string" || typeof value.integrity !== "string") continue;
    let url: URL; try { url = new URL(value.resolved); } catch { continue; }
    // Public anonymous downloads only; no redirect, userinfo, query or private endpoint.
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.port || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".tgz")) continue;
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.integrity)) continue;
    entries.set(url.href, { url: url.href, integrity: value.integrity });
  }
  return [...entries.values()].sort((a, b) => a.url.localeCompare(b.url));
}
export function downloadCacheKey(repository: string, pipeline: CheckPipeline, lockfile: Buffer, packageManager: string): string {
  return sha256Hex(canonicalJson({ version: 1, repository, trustScope: pipeline.cachePolicy.kind === "off" ? "" : pipeline.cachePolicy.trustScope,
    platform: process.platform, arch: process.arch, toolchain: pipeline.toolchainDigest, packageManager,
    lockfile: sha256Hex(lockfile), setup: pipeline.setupSteps, env: pipeline.env }));
}
function verify(path: string, entry: DownloadCacheManifest["entries"][number]): boolean {
  let fd: number | undefined;
  try {
    fd = withinDirectory(path, (parent, name) => openRegularBeneath(parent, name)); const buffer = Buffer.alloc(65536), hash = createHash("sha512"), hash256 = createHash("sha256"); let bytes = 0;
    for (;;) { const n = readSync(fd, buffer); if (!n) break; bytes += n; hash.update(buffer.subarray(0,n)); hash256.update(buffer.subarray(0,n)); }
    return bytes === entry.bytes && `sha512-${hash.digest("base64")}` === entry.integrity && hash256.digest("hex") === entry.sha256;
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}
export function readDownloadCache(root: string, key: string, downloads: readonly Download[]): DownloadCacheManifest | null {
  try {
    const fd = withinDirectory(join(root, "manifest.json"), (parent, name) => openRegularBeneath(parent, name));
    let value: DownloadCacheManifest;
    try {
      const stat = fstatSync(fd);
      if (stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) return null;
      value = JSON.parse(readFileSync(fd, "utf8")) as DownloadCacheManifest;
    } finally { closeSync(fd); }
    if (value.version !== 1 || value.key !== key || !Array.isArray(value.entries)) return null;
    for (const entry of value.entries) {
      if (!downloads.some(d => d.url === entry.url && d.integrity === entry.integrity) || !/^[a-f0-9-]{36}\.result$/.test(entry.file) || !verify(join(root, entry.file), entry)) return null;
    }
    return value;
  } catch { return null; }
}
export async function fillDownloadCache(root: string, key: string, downloads: readonly Download[], fetcher: typeof fetch = fetch): Promise<DownloadCacheManifest> {
  const entries: DownloadCacheManifest["entries"] = [];
  for (const item of downloads) {
    const writer = createResult(root); const hash = createHash("sha512");
    try {
      const response = await fetcher(item.url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.body) continue;
      for await (const chunk of response.body) { hash.update(chunk); writer.append(chunk); }
      if (`sha512-${hash.digest("base64")}` !== item.integrity) continue;
      const result = writer.finish(); entries.push({ ...item, file: writer.path.split("/").at(-1)!, bytes: result.bytes, sha256: result.sha256 });
    } catch { /* cache miss is not a check failure; normal setup still runs */ }
    finally { writer.close(); }
  }
  const manifest: DownloadCacheManifest = { version: 1, key, entries };
  replaceDerivedFile(join(root, "manifest.json"), canonicalJson(manifest), 0o600); return manifest;
}
export function ensureDownloadCache(parent: string, key: string): string {
  ensureOwnedDirectory(join(parent, "downloads"), parent, 0o700);
  const root = join(parent, "downloads", key); ensureOwnedDirectory(root, parent, 0o700); return root;
}
