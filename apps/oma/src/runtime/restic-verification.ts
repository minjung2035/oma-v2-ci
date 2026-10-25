/** Checked output of the pinned Restic/GNU tar verification pair. The tar
 * stream compares data without a second full copy on disk. Restic's JSON
 * inventory independently verifies nanosecond metadata that tar rounds. */
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { cacheFileLines, type CacheTreeObservation, type CacheNodeMetadata } from "@oma/storage/cache-trees";

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

/** GNU tar --quoting-style=c, under LC_ALL=C. Decode octal as bytes rather
 * than Unicode code points, so tabs/newlines and UTF-8 names remain exact. */
export function comparisonName(line: string): { readonly name: string; readonly tail: string } {
  if (line[0] !== '"') throw invalid("unquoted comparison record");
  const bytes: number[] = []; let index = 1;
  const escapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 };
  while (index < line.length && line[index] !== '"') {
    if (line[index] === "\\") {
      const next = line[++index];
      if (next !== undefined && /[0-7]/.test(next)) {
        const octal = /^[0-7]{1,3}/.exec(line.slice(index))![0], byte = parseInt(octal, 8);
        if (byte > 255) throw invalid("invalid octal byte");
        bytes.push(byte); index += octal.length;
      } else {
        if (next === undefined || escapes[next] === undefined) throw invalid("invalid name escape");
        bytes.push(escapes[next]!); index++;
      }
    } else {
      const point = line.codePointAt(index)!; bytes.push(...Buffer.from(String.fromCodePoint(point))); index += point > 0xffff ? 2 : 1;
    }
  }
  if (line[index] !== '"') throw invalid("unfinished comparison name");
  const name = decodeUtf8(Buffer.from(bytes)).replace(/\/$/, "");
  if (!name || name.includes("\0") || name.split("/").some(part => !part || part === "." || part === "..")) throw invalid("invalid comparison path");
  return { name, tail: line.slice(index + 1) };
}
export async function verifyResticComparison(file: string, source: CacheTreeObservation): Promise<void> {
  const seen = new Set<string>(); let codes: RegExpExecArray | null = null, rounded = false;
  for await (const line of cacheFileLines(file)) {
    if (!line) continue;
    if (codes !== null) throw invalid("records after completion");
    const status = /^OMA_RESTIC_COMPARE ([0-9]+) ([0-9]+)$/.exec(line);
    if (status) { codes = status; continue; }
    const { name, tail } = comparisonName(line);
    if (!source.paths.has(name)) throw invalid(`unexpected comparison path: ${name}`);
    if (tail === "") {
      if (seen.has(name)) throw invalid(`duplicate comparison path: ${name}`);
      seen.add(name);
    } else if (tail === ": Mod time differs" && seen.has(name) && BigInt(source.metadata.get(name)!.mtimeNs) % 1_000_000_000n !== 0n) {
      rounded = true; // Exact metadata was checked against Restic's JSON.
    } else throw invalid(`source comparison differs: ${line}`);
  }
  if (codes === null || codes[1] !== "0" || !(codes[2] === "0" || (codes[2] === "1" && rounded)) || seen.size !== source.paths.size)
    throw invalid("incomplete comparison or failed reader");
}
