/** GIT-004/008, INT-003/004: observations are facts, never permission to commit.
 * The caller supplies the fixed host runner. Every observation retains process
 * evidence; nonzero, timeout, signal and malformed output are not absence.
 */
import { closeSync, constants, openSync, readSync } from "node:fs";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid, isValidWirePath } from "@oma/domain/identifiers";
import { decodeUtf8 } from "@oma/domain/utf8";

/** P0V-116 (G06-01, G06-02): what reaches git in an argument position is an
 * object id or a ref name -- never a word git could read as an option,
 * whatever a caller checked. A refusal here is not an observation: a ref named
 * by an option is not "absent", and a CAS of one is not "already expected". */
const REF_NAME = /^(?:HEAD|refs\/[A-Za-z0-9._/-]+)$/;
export function gitRefArgument(ref: string): string {
  if (typeof ref !== "string" || !REF_NAME.test(ref)) throw new StoreError("INVALID_REQUEST", "a git ref argument is not a ref name");
  return ref;
}
export function gitOidArgument(oid: string): string {
  if (!isValidFullOid(oid)) throw new StoreError("INVALID_REQUEST", "a git object argument is not a full object id");
  return oid;
}

import type { GitProcessEvidence, GitObservation, ChangedPath } from "@oma/contracts/git";
import type { GitReadPort } from "./read-port.js";
export type GitObservationRunner = (args: readonly string[], input?: string) => GitProcessEvidence;
/** `scope` says whose failure a refusal is: "output" is an observation that
 * is itself malformed; "candidate" is a name the candidate's content places
 * outside the grammar -- that candidate's defect, never store corruption. */
export type Parsed<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly reason: string; readonly scope: "output" | "candidate" };

/** Fixed --no-renames grammar: status NUL path NUL, never status-as-path.
 * No trimming, whitespace replacement, Unicode normalization or deduplication.
 * A well-formed record whose name the grammar cannot represent (not UTF-8, or
 * not a repository-relative path) is refused at candidate scope. */
export function parseNameStatusZ(bytes: Uint8Array): Parsed<readonly ChangedPath[]> {
  if (bytes.byteLength === 0) return { ok: true, value: [] };
  if (bytes[bytes.byteLength - 1] !== 0) return { ok: false, reason: "unterminated name-status record", scope: "output" };
  let text: string;
  try { text = decodeUtf8(bytes); } catch { return { ok: false, reason: "a changed-path name is not UTF-8", scope: "candidate" }; }
  const fields = text.split("\0");
  fields.pop();
  if (fields.length % 2 !== 0) return { ok: false, reason: "incomplete name-status pair", scope: "output" };
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (status !== "A" && status !== "M" && status !== "D" && status !== "T")
      return { ok: false, reason: "unsupported status for --no-renames", scope: "output" };
    if (!isValidWirePath(path)) return { ok: false, reason: "invalid repository-relative changed path", scope: "candidate" };
    changes.push({ status, path });
  }
  return { ok: true, value: changes };
}

/** The leaf-entry types `git ls-tree -r` can name. */
const LS_TREE_TYPES: Readonly<Record<string, string>> = {
  "100644": "blob", "100755": "blob", "120000": "blob", "160000": "commit",
};
/** A complete `<mode> <type> <oid>\t` record header, or null when the text is
 * not one — the grammar context-repository.ts and project-snapshot.ts share. */
function lsTreeHeader(text: string): { readonly mode: string; readonly prefix: number } | null {
  const header = /^(\d{6}) ([^ ]+) ([0-9a-f]+)\t/.exec(text);
  if (header === null || LS_TREE_TYPES[header[1]!] !== header[2] || !isValidFullOid(header[3] ?? "")) return null;
  return { mode: header[1]!, prefix: header[0].length };
}
type RecordOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly scope: "output" | "candidate" };
/** One ls-tree record's grammar check, shared by the buffer and stream parses. */
function gitlinkRecord(record: Uint8Array, paths: string[]): RecordOutcome {
  let text: string;
  try { text = decodeUtf8(record); } catch { return { ok: false, reason: "an ls-tree path is not UTF-8", scope: "candidate" }; }
  const header = lsTreeHeader(text);
  if (header === null) return { ok: false, reason: "malformed ls-tree record", scope: "output" };
  const path = text.slice(header.prefix);
  if (!isValidWirePath(path)) return { ok: false, reason: "invalid repository-relative tree path", scope: "candidate" };
  if (header.mode === "160000") paths.push(path);
  return { ok: true };
}
/** `ls-tree -r -z` emits one leaf record per NUL, `<mode> <type> <oid>\t<path>`
 * — the grammar context-repository.ts and project-snapshot.ts already parse.
 * A record outside it is corrupt output; a leaf whose name the grammar cannot
 * represent (not UTF-8, not repository-relative) refuses that candidate. */
export function parseGitlinksZ(bytes: Uint8Array): Parsed<readonly string[]> {
  if (bytes.byteLength === 0) return { ok: true, value: [] };
  if (bytes[bytes.byteLength - 1] !== 0) return { ok: false, reason: "unterminated ls-tree record", scope: "output" };
  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== 0) continue;
    const outcome = gitlinkRecord(bytes.subarray(start, index), paths);
    if (!outcome.ok) return outcome;
    start = index + 1;
  }
  return { ok: true, value: paths };
}

/** One record's working-set bound: a wire path (4096) plus the ~110-byte
 * record header. A record that outgrows it can only carry a path the grammar
 * cannot represent — refused at candidate scope when its header is valid
 * ls-tree output, corrupt output when it is not. */
const LS_TREE_RECORD_BYTES = 4096 + 256;

/** The same parse over a descriptor, a record at a time — the enumeration's
 * whole output never lands in memory, so output size alone can never be the
 * refusal. The in-memory working set is one record plus one read chunk. */
export function parseGitlinksFd(fd: number): Parsed<readonly string[]> {
  const paths: string[] = [];
  const chunk = Buffer.alloc(1024 * 1024);
  let carry = Buffer.alloc(0);
  for (let position = 0;;) {
    const count = readSync(fd, chunk, 0, chunk.length, position);
    if (count === 0) break;
    position += count;
    carry = carry.byteLength === 0 ? Buffer.from(chunk.subarray(0, count))
      : Buffer.concat([carry, chunk.subarray(0, count)]);
    for (;;) {
      const end = carry.indexOf(0);
      if (end < 0) break;
      const record = carry.subarray(0, end);
      carry = carry.subarray(end + 1);
      const outcome = gitlinkRecord(record, paths);
      if (!outcome.ok) return outcome;
    }
    if (carry.byteLength > LS_TREE_RECORD_BYTES)
      return lsTreeHeader(carry.subarray(0, 128).toString("utf8")) === null
        ? { ok: false, reason: "malformed ls-tree record", scope: "output" }
        : { ok: false, reason: "invalid repository-relative tree path", scope: "candidate" };
  }
  if (carry.byteLength !== 0) return { ok: false, reason: "unterminated ls-tree record", scope: "output" };
  return { ok: true, value: paths };
}
/** `parseGitlinksFd` on a path the runner spooled; an unopenable or unreadable
 * spool is a thrown I/O failure for the caller to answer as unknown. */
export function parseGitlinksPath(path: string): Parsed<readonly string[]> {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return parseGitlinksFd(fd); } finally { closeSync(fd); }
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
function refused<T>(evidence: GitProcessEvidence, reason: string): GitObservation<T> { return { kind: "refused", reason, evidence }; }
function line(value: string | null): string | null {
  if (value === null) return null;
  // Git emits one LF. Whitespace around an identity is not another spelling.
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

export class GitObserver implements GitReadPort {
  constructor(private readonly run: GitObservationRunner) {}

  ref(repository: string, ref: string): GitObservation<string> {
    const evidence = this.run(["--git-dir", repository, "rev-parse", "--verify", "--quiet", gitRefArgument(ref)]);
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
    const expression = `${gitOidArgument(oid)}^{commit}`;
    const evidence = this.run(["--git-dir", repository, "cat-file", "--batch-check=%(objecttype)"], `${expression}\n`);
    if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "commit process unavailable");
    const output = line(text(evidence.stdout));
    if (output === "commit") return { kind: "present", value: true, evidence };
    if (output === `${expression} missing`) return { kind: "absent", evidence };
    return corrupt(evidence, "unexpected commit observation output");
  }

  ancestry(repository: string, base: string, candidate: string): GitObservation<boolean> {
    const evidence = this.run(["--git-dir", repository, "merge-base", "--is-ancestor", gitOidArgument(base), gitOidArgument(candidate)]);
    if (uncertain(evidence) || diagnostic(evidence) || (evidence.status !== 0 && evidence.status !== 1))
      return unknown(evidence, "ancestry process unavailable");
    if (evidence.stdout === null || evidence.stdout.byteLength !== 0) return corrupt(evidence, "unexpected ancestry output");
    return { kind: "present", value: evidence.status === 0, evidence };
  }

  commits(repository: string, base: string, candidate: string): GitObservation<readonly string[]> {
    const evidence = this.run(["--git-dir", repository, "rev-list", `${gitOidArgument(base)}..${gitOidArgument(candidate)}`]);
    if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "commit range unavailable");
    const output = text(evidence.stdout);
    if (output === null || (output !== "" && !output.endsWith("\n"))) return corrupt(evidence, "invalid commit range output");
    const commits = output === "" ? [] : output.slice(0, -1).split("\n");
    if (commits.some(oid => !isValidFullOid(oid) || oid.length !== base.length) || new Set(commits).size !== commits.length)
      return corrupt(evidence, "invalid commit range identity");
    return { kind: "present", value: commits, evidence };
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
    const evidence = this.run(["--git-dir", repository, "diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", gitOidArgument(base), gitOidArgument(candidate)]);
    if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "changed-path process unavailable");
    if (evidence.stdout === null) return corrupt(evidence, "missing changed-path output");
    const parsed = parseNameStatusZ(evidence.stdout);
    return parsed.ok ? { kind: "present", value: parsed.value, evidence }
      : parsed.scope === "candidate" ? refused(evidence, parsed.reason) : corrupt(evidence, parsed.reason);
  }

  /** INT-001/UX-09: every submodule gitlink path one commit's whole tree still
   * carries, observed whole — a gitlink the diff inherited is no less a
   * refusal than one the diff added. `-r` names only leaf entries, so the
   * grammar knows no "tree" records; an uncertain answer is never "none". */
  gitlinks(repository: string, oid: string): GitObservation<readonly string[]> {
    const evidence = this.run(["--git-dir", repository, "ls-tree", "-r", "-z", "--full-tree", gitOidArgument(oid)]);
    try {
      if (uncertain(evidence) || evidence.status !== 0 || diagnostic(evidence)) return unknown(evidence, "gitlink process unavailable");
      if (evidence.stdout === null && evidence.stdoutSpooledTo === undefined) return corrupt(evidence, "missing gitlink output");
      let parsed: Parsed<readonly string[]>;
      if (evidence.stdoutSpooledTo === undefined) parsed = parseGitlinksZ(evidence.stdout!);
      else {
        // The spool is read a record at a time: the enumeration's size can
        // never be the refusal, and an unreadable spool is unknown, never a
        // truncated "no gitlinks".
        try { parsed = parseGitlinksPath(evidence.stdoutSpooledTo); }
        catch { return unknown(evidence, "gitlink output could not be read"); }
      }
      return parsed.ok ? { kind: "present", value: parsed.value, evidence }
        : parsed.scope === "candidate" ? refused(evidence, parsed.reason) : corrupt(evidence, parsed.reason);
    } finally { evidence.dispose?.(); }
  }
}

export type RefAfterCas =
  | { readonly kind: "candidate"; readonly oid: string }
  | { readonly kind: "expected"; readonly oid: string | null }
  | { readonly kind: "third"; readonly oid: string | null }
  | { readonly kind: "unknown"; readonly observation: GitObservation<string> };
/** The caller must supply a NEW post-CAS observation, not the precheck. */
export function classifyRefAfterCas(observation: GitObservation<string>, expected: string | null, candidate: string): RefAfterCas {
  // A refused observation proves nothing of the ref either: it is unknown here.
  if (observation.kind === "unknown" || observation.kind === "corrupt" || observation.kind === "refused")
    return { kind: "unknown", observation };
  const oid = observation.kind === "absent" ? null : observation.value;
  if (oid === candidate) return { kind: "candidate", oid };
  return oid === expected ? { kind: "expected", oid } : { kind: "third", oid };
}
