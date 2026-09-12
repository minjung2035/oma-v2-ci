// Test exploration only. This file never creates a runtime queue or production evidence.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, release } from "node:os";
import { join } from "node:path";

export const PRNG_REVISION = "lcg32-1664525-1013904223-v1";
export class Seeded {
  private state: number;
  constructor(readonly seed: number) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be an unsigned 32-bit integer");
    this.state = seed;
  }
  next(): number { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state; }
  index(length: number): number {
    if (!Number.isSafeInteger(length) || length <= 0 || length > 0x100000000) throw new RangeError("invalid finite choice set");
    return this.next() % length;
  }
}
export function integerParameter(name: string, fallback: number, maximum: number): number {
  const text = process.env[name];
  const value = text === undefined ? fallback : /^(?:0|[1-9]\d*)$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`invalid test parameter ${name}`);
  return value;
}
/** Deletion-based delta debugging. It reports its probe cap and whether a
 * one-element deletion pass completed; it never promises a globally smallest case.
 */
export async function minimizeSequence<T>(input: readonly T[], stillFails: (candidate: readonly T[]) => Promise<boolean>, maximumProbes = 256): Promise<{
  sequence: T[]; probes: number; oneMinimal: boolean;
}> {
  if (!Number.isSafeInteger(maximumProbes) || maximumProbes < 1) throw new RangeError("invalid minimization budget");
  let sequence = [...input], probes = 0, granularity = 2;
  while (sequence.length > 0 && probes < maximumProbes) {
    const width = Math.max(1, Math.ceil(sequence.length / granularity));
    let reduced = false;
    for (let start = 0; start < sequence.length && probes < maximumProbes; start += width) {
      const candidate = [...sequence.slice(0, start), ...sequence.slice(start + width)];
      probes++;
      if (await stillFails(candidate)) { sequence = candidate; granularity = Math.max(2, granularity - 1); reduced = true; break; }
    }
    if (reduced) continue;
    if (width === 1) return { sequence, probes, oneMinimal: true };
    granularity = Math.min(sequence.length, granularity * 2);
  }
  return { sequence, probes, oneMinimal: sequence.length === 0 };
}
export function replayMetadata(seed: number, parameters: Readonly<Record<string, number | string>>) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 10000, maxBuffer: 65536, killSignal: "SIGKILL" });
  const candidate = head.stdout?.trim();
  const sourceSha = !head.error && !head.signal && head.status === 0 && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate ?? "") ? candidate : null;
  return { schema: 1, seed, prngRevision: PRNG_REVISION, parameters, sourceSha,
    sourceShaStatus: sourceSha ? "OBSERVED" : "NOT_AVAILABLE",
    environment: { node: process.version, platform: process.platform, arch: process.arch, kernel: release() } };
}
/** Called only by an actually executing failed test. Output is captured by
 * verify-lane's explicitly owned artifact directory, or an isolated OS temp dir.
 */
export function recordExplorationFailure(kind: "model" | "parser" | "stress", record: unknown): string {
  const requested = process.env.OMA_TEST_ARTIFACT_DIR;
  if (requested) mkdirSync(requested, { recursive: true });
  const root = mkdtempSync(join(requested ?? tmpdir(), `oma-r36-${kind}-`));
  const file = join(root, "replay.json");
  writeFileSync(file, JSON.stringify({ kind, recordedAt: new Date().toISOString(), record }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return file;
}
