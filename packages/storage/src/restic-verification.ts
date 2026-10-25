/** Exact repository metadata, independently checked beside the streaming dump. */
import { StoreError } from "@oma/domain/errors";
import { cacheFileLines, type CacheTreeObservation, type CacheNodeMetadata } from "./cache-trees.js";

const invalid = (what: string): StoreError => new StoreError("STORE_CORRUPT", `session snapshot verification failed: ${what}`);
function timestamp(value: unknown): string {
  if (typeof value !== "string") throw invalid("missing timestamp");
  const parsed = /^(.*T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (parsed === null) throw invalid("invalid timestamp");
  const base = Date.parse(parsed[1]! + parsed[3]!);
  if (!Number.isSafeInteger(base)) throw invalid("invalid timestamp");
  return String(BigInt(base) * 1_000_000n + BigInt((parsed[2] ?? "").padEnd(9, "0")));
}
function unixMode(mode: unknown): number {
  if (!Number.isSafeInteger(mode) || (mode as number) < 0) throw invalid("invalid mode");
  const bits = mode as number;
  return (bits & 0o777) | ((bits & 0x800000) ? 0o4000 : 0) | ((bits & 0x400000) ? 0o2000 : 0) | ((bits & 0x100000) ? 0o1000 : 0);
}
function checkNode(node: Record<string, unknown>, expected: CacheNodeMetadata): void {
  if (node.type !== expected.type || unixMode(node.mode) !== expected.mode ||
      String(node.uid) !== expected.uid || String(node.gid) !== expected.gid || timestamp(node.mtime) !== expected.mtimeNs ||
      (expected.type === "file" && (node.size ?? 0) !== expected.size)) throw invalid(`metadata differs at ${String(node.path)}`);
  if (expected.sourceInode !== undefined && (!Number.isSafeInteger(node.inode) || String(node.inode) !== expected.sourceInode))
    throw invalid(`hardlink identity differs at ${String(node.path)}`);
}
export async function verifyResticInventory(file: string, snapshot: string, paths: readonly string[], source: CacheTreeObservation): Promise<void> {
  const seen = new Set<string>(); let header = false;
  for await (const line of cacheFileLines(file)) {
    if (line === "") continue;
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid("invalid inventory record");
    const node = value as Record<string, unknown>;
    if (node.message_type === "snapshot") {
      if (header || node.id !== snapshot || !Array.isArray(node.paths) ||
          JSON.stringify([...node.paths].sort()) !== JSON.stringify([...paths].sort())) throw invalid("snapshot identity or source roots differ");
      header = true; continue;
    }
    if (!header || node.message_type !== "node" || typeof node.path !== "string" || !node.path.startsWith("/")) throw invalid("invalid node");
    const name = node.path.slice(1), expected = source.metadata.get(name);
    if (!expected || seen.has(name)) throw invalid(`unexpected or duplicate path: ${name}`);
    checkNode(node, expected); seen.add(name);
  }
  if (!header || seen.size !== source.paths.size) throw invalid("incomplete inventory");
}

