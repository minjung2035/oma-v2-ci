/** GIT-004/008, INT-003/004: observations are facts, never permission to commit.
 * The caller supplies the fixed host runner. Every observation retains process
 * evidence; nonzero, timeout, signal and malformed output are not absence.
 */
import { isValidFullOid, isValidWirePath } from "../domain/identifiers.js";
import { decodeUtf8 } from "../domain/utf8.js";

export interface GitProcessEvidence {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
  readonly stdout: Uint8Array | null;
  readonly stderr: Uint8Array | null;
}
export type GitObservation<T> =
  | { readonly kind: "present"; readonly value: T; readonly evidence: GitProcessEvidence }
  | { readonly kind: "absent"; readonly evidence: GitProcessEvidence }
  | { readonly kind: "unknown"; readonly reason: string; readonly evidence: GitProcessEvidence }
  | { readonly kind: "corrupt"; readonly reason: string; readonly evidence: GitProcessEvidence };
export type GitObservationRunner = (args: readonly string[], input?: string) => GitProcessEvidence;
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };
export interface ChangedPath { readonly status: "A" | "M" | "D" | "T"; readonly path: string }

/** Fixed --no-renames grammar: status NUL path NUL, never status-as-path.
 * No trimming, whitespace replacement, Unicode normalization or deduplication.
 */
export function parseNameStatusZ(bytes: Uint8Array): Parsed<readonly ChangedPath[]> {
  if (bytes.byteLength === 0) return { ok: true, value: [] };
  if (bytes[bytes.byteLength - 1] !== 0) return { ok: false, reason: "unterminated name-status record" };
  let text: string;
  try { text = decodeUtf8(bytes); } catch { return { ok: false, reason: "name-status output is not UTF-8" }; }
  const fields = text.split("\0");
  fields.pop();
  if (fields.length % 2 !== 0) return { ok: false, reason: "incomplete name-status pair" };
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (status !== "A" && status !== "M" && status !== "D" && status !== "T")
      return { ok: false, reason: "unsupported status for --no-renames" };
    if (!isValidWirePath(path)) return { ok: false, reason: "invalid repository-relative changed path" };
    changes.push({ status, path });
  }
  return { ok: true, value: changes };
}

/** '/' stays gated by the production profile admission check. */
export function protectedPathMatches(path: string, protectedPath: string): boolean {
  // DR18: the root protects the whole tree -- every change a candidate makes.
  if (protectedPath === "/") return true;
  return protectedPath.endsWith("/") ? path.startsWith(protectedPath) : path === protectedPath;
}
function text(bytes: Uint8Array | null): string | null {
  if (bytes === null) return null;
  try { return decodeUtf8(bytes); } catch { return null; }
}
function uncertain(evidence: GitProcessEvidence): boolean {
  return evidence.error !== undefined || evidence.signal !== null || evidence.status === null;
}
function diagnostic(evidence: GitProcessEvidence): boolean { return evidence.stderr === null || evidence.stderr.byteLength !== 0; }
function unknown<T>(evidence: GitProcessEvidence, reason: string): GitObservation<T> { return { kind: "unknown", reason, evidence }; }
function corrupt<T>(evidence: GitProcessEvidence, reason: string): GitObservation<T> { return { kind: "corrupt", reason, evidence }; }
function line(value: string | null): string | null {
  if (value === null) return null;
  // Git emits one LF. Whitespace around an identity is not another spelling.
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

export class GitObserver {
  constructor(private readonly run: GitObservationRunner) {}

  ref(repository: string, ref: string): GitObservation<string> {
    const evidence = this.run(["--git-dir", repository, "rev-parse", "--verify", "--quiet", ref]);
    if (uncertain(evidence) || diagnostic(evidence)) return unknown(evidence, "ref process unavailable");
    const output = text(evidence.stdout);
    if (evidence.status === 1 && output === "") return { kind: "absent", evidence };
    if (evidence.status !== 0) return unknown(evidence, "ref command did not prove absence");
    const oid = line(output);
    return isValidFullOid(oid) ? { kind: "present", value: oid, evidence } : corrupt(evidence, "malformed ref OID");
  }

  objectFormat(repository: string): GitObservation<"sha1" | "sha256"> {
    const evidence = this.run(["--git-dir", repository, "rev-parse", "--show-object-format"]);
    if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "object format process unavailable");
    const format = line(text(evidence.stdout));
    return format === "sha1" || format === "sha256" ? { kind: "present", value: format, evidence } : corrupt(evidence, "unsupported object format output");
  }

  commit(repository: string, oid: string): GitObservation<true> {
    const expression = `${oid}^{commit}`;
    const evidence = this.run(["--git-dir", repository, "cat-file", "--batch-check=%(objecttype)"], `${expression}\n`);
    if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "commit process unavailable");
    const output = line(text(evidence.stdout));
    if (output === "commit") return { kind: "present", value: true, evidence };
    if (output === `${expression} missing`) return { kind: "absent", evidence };
    return corrupt(evidence, "unexpected commit observation output");
  }

  ancestry(repository: string, base: string, candidate: string): GitObservation<boolean> {
    const evidence = this.run(["--git-dir", repository, "merge-base", "--is-ancestor", base, candidate]);
    if (uncertain(evidence) || diagnostic(evidence) || (evidence.status !== 0 && evidence.status !== 1))
      return unknown(evidence, "ancestry process unavailable");
    if (evidence.stdout === null || evidence.stdout.byteLength !== 0) return corrupt(evidence, "unexpected ancestry output");
    return { kind: "present", value: evidence.status === 0, evidence };
  }

  published(repository: string): GitObservation<readonly string[]> {
    const evidence = this.run(["--git-dir", repository, "for-each-ref", "--format=%(objectname)", "refs/oma/published/"]);
    if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "published enumeration unavailable");
    const output = text(evidence.stdout);
    if (output === null) return corrupt(evidence, "published output is not UTF-8");
    if (output === "") return { kind: "present", value: [], evidence };
    if (!output.endsWith("\n")) return corrupt(evidence, "unterminated published enumeration");
    const oids = output.slice(0, -1).split("\n");
    if (oids.some(oid => !isValidFullOid(oid)) || new Set(oids.map(oid => oid.length)).size !== 1)
      return corrupt(evidence, "invalid or mixed-format published OIDs");
    return { kind: "present", value: oids, evidence };
  }

  changedPaths(repository: string, base: string, candidate: string): GitObservation<readonly ChangedPath[]> {
    const evidence = this.run(["--git-dir", repository, "diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", base, candidate]);
    if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "changed-path process unavailable");
    if (evidence.stdout === null) return corrupt(evidence, "missing changed-path output");
    const parsed = parseNameStatusZ(evidence.stdout);
    return parsed.ok ? { kind: "present", value: parsed.value, evidence } : corrupt(evidence, parsed.reason);
  }
}

export type RefAfterCas =
  | { readonly kind: "candidate"; readonly oid: string }
  | { readonly kind: "expected"; readonly oid: string | null }
  | { readonly kind: "third"; readonly oid: string | null }
  | { readonly kind: "unknown"; readonly observation: GitObservation<string> };
/** The caller must supply a NEW post-CAS observation, not the precheck. */
export function classifyRefAfterCas(observation: GitObservation<string>, expected: string | null, candidate: string): RefAfterCas {
  if (observation.kind === "unknown" || observation.kind === "corrupt") return { kind: "unknown", observation };
  const oid = observation.kind === "absent" ? null : observation.value;
  if (oid === candidate) return { kind: "candidate", oid };
  return oid === expected ? { kind: "expected", oid } : { kind: "third", oid };
}
