// GIT-004/008: bounded canonical command adapter. Effect exit status is never CAS proof.
import { closeSync, constants, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_ENV } from "@oma/process/policies";
import { StoreError } from "@oma/domain/errors";
import { runProcessSync } from "@oma/process/run";
import { decodeUtf8 } from "@oma/domain/utf8";
import { GitObserver, classifyRefAfterCas, gitOidArgument, gitRefArgument, type RefAfterCas } from "./observe.js";
import { type GitProcessEvidence, type GitObservation } from "@oma/contracts/git";
import { isValidFullOid } from "@oma/domain/identifiers";

export const GIT_BIN = "/usr/bin/git";
export const CANONICAL_PROCESS_LIMITS = { timeout: 120000, maxBuffer: 4 * 1024 * 1024 } as const;
/** UX-09/DR33: `GitObserver.gitlinks` is the one observation that enumerates a
 * candidate's *whole* tree (`ls-tree -r -z --full-tree`), so its output scales
 * with leaf count, not with a diff or a ref set — a sha256 record is ~80 bytes
 * plus the path. There is no honest in-memory bound for it: the runner spools
 * the stream whole and the observer parses it one record at a time, so a tree
 * of any size answers present/refused/corrupt — output size alone can never
 * become unknown, and a truncated record can never read as "no gitlinks". */
/** Native execution is owned by process/run.ts. Both byte budgets are the same
 * single bound, so the native combined stdout+stderr cap is unchanged. */
function evidence(argv: readonly string[], timeoutMs: number, maxBuffer: number, input?: string, stdoutSpool?: string, executable = GIT_BIN): GitProcessEvidence {
  const result = runProcessSync({ executable, argv, env: GIT_ENV,
    timeoutMs, stdoutBytes: maxBuffer, stderrBytes: maxBuffer,
    ...(input === undefined ? {} : { input }), ...(stdoutSpool === undefined ? {} : { stdoutSpool }) });
  return { status: result.kind === "exited" ? result.exitCode : null, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr,
    ...(result.stdoutSpooledTo === undefined ? {} : { stdoutSpooledTo: result.stdoutSpooledTo }) };
}
export function createCanonicalObserver(executable = GIT_BIN): GitObserver {
  if (!executable.startsWith("/") || executable.includes("\0"))
    throw new StoreError("UNSUPPORTED_PROFILE", "canonical observations require an absolute trusted Git executable");
  return new GitObserver((args, input) => {
    const format = args.includes("--show-object-format");
    const commit = args.includes("--batch-check=%(objecttype)");
    if (args.includes("ls-tree")) {
      let dir: string;
      try { dir = mkdtempSync(join(tmpdir(), "oma-ls-tree-")); }
      catch (error) {
        return { status: null, signal: null, stdout: null, stderr: null,
          error: error instanceof Error ? error : new Error(String(error)) };
      }
      // The spool is opened synchronously inside the run (stdoutSpool), so a
      // starved descriptor table reports here, not in the child. A made
      // scratch whose spool could not be opened answers the same typed
      // evidence an unmade scratch does -- and the directory is given back
      // first, since nothing downstream will own it.
      try {
        const observed = evidence([...args], CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer, input, join(dir, "stdout"), executable);
        return { ...observed, dispose: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* diagnostic residue */ } } };
      } catch (error) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* diagnostic residue */ }
        return { status: null, signal: null, stdout: null, stderr: null,
          error: error instanceof Error ? error : new Error(String(error)) };
      }
    }
    return evidence([...args], format ? 30000 : commit ? 10000 : CANONICAL_PROCESS_LIMITS.timeout,
      format ? 1024 : commit ? 64 * 1024 : CANONICAL_PROCESS_LIMITS.maxBuffer, input, undefined, executable);
  });
}
export function compareAndSwapCanonicalRef(observations: GitObserver, repository: string, ref: string,
  candidate: string, expected: string | null): RefAfterCas {
  // P0V-116: the adapter's own invariant; a refused argument is no observation.
  evidence(["--git-dir", repository, "update-ref", gitRefArgument(ref), gitOidArgument(candidate), expected === null ? "" : gitOidArgument(expected)],
    CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer);
  return classifyRefAfterCas(observations.ref(repository, ref), expected, candidate);
}
/** A ref made only from nothing. What the ref holds afterwards is the observed
 * value, as for every CAS; whether this command is the one that made it is its
 * own success, which matters only when a concurrent maker produced the same
 * object -- the ref then holds this candidate either way (P0V-85). */
export function createCanonicalRef(observations: GitObserver, repository: string, ref: string,
  candidate: string): { readonly after: RefAfterCas; readonly created: boolean } {
  const made = evidence(["--git-dir", repository, "update-ref", gitRefArgument(ref), gitOidArgument(candidate), ""],
    CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer);
  const after = classifyRefAfterCas(observations.ref(repository, ref), null, candidate);
  return { after, created: after.kind === "candidate" && made.status === 0 };
}

/** DR27: a no-op has no changed main ref to witness completed authorization.
 * Verify main and create one immutable operation ref in the same Git ref
 * transaction. Only that one ref changes, so there is no multi-ref crash-
 * atomicity assumption. A child exit is not proof: read the witness afterwards. */
export function authorizeCanonicalNoop(observations: GitObserver, repository: string, ref: string,
  candidate: string): GitObservation<string> {
  evidence(["--git-dir", repository, "update-ref", "--stdin"], CANONICAL_PROCESS_LIMITS.timeout,
    CANONICAL_PROCESS_LIMITS.maxBuffer, `start\nverify refs/heads/main ${gitOidArgument(candidate)}\n` +
      `create ${gitRefArgument(ref)} ${gitOidArgument(candidate)}\nprepare\ncommit\n`);
  return observations.ref(repository, ref);
}

/** The pinned safe configuration every broker-run diff/merge-tree against the
 * canonical repository carries: no hooks, no fsmonitor, no attributes, no
 * external diff driver and no network protocol. */
export const CANONICAL_SAFE_ARGS: readonly string[] = ["--no-pager", "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null", "-c", "diff.external=",
  "-c", "protocol.allow=never"];

/** mail-v1 §7: the broker prepares a revert of an applied merge on canonical
 * main. `git merge-tree --write-tree --merge-base=<applied candidate> <main>
 * <target base>` merges the pre-merge base into main relative to the merge's
 * candidate: its tree is main with the merge's diff reversed. Exit 1 reports
 * conflicts (the conflicted paths follow the tree line with --name-only);
 * exit 0 whose tree equals main's own means the merged change is no longer
 * present. The revert commit's parent is main; author/committer is the OMA
 * identity, argv-only, no hooks or external merge drivers. */
export function canonicalRevertCommit(repository: string, input: {
  readonly mergeBase: string; readonly main: string; readonly base: string;
  readonly message: string; readonly society: string;
}): string {
  // The conflict listing scales with the tree, not with a document bound:
  // merge-tree's stdout is spooled whole and only the head the classification
  // needs -- the tree line and up to 64 conflict paths -- is read back.
  const dir = mkdtempSync(join(tmpdir(), "oma-merge-tree-"));
  try {
    const merge = runProcessSync({ executable: GIT_BIN,
      argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, "merge-tree", "--write-tree", "--name-only",
        "--no-messages",
        `--merge-base=${gitOidArgument(input.mergeBase)}`, gitOidArgument(input.main), gitOidArgument(input.base)],
      env: GIT_ENV, timeoutMs: CANONICAL_PROCESS_LIMITS.timeout,
      stdoutBytes: CANONICAL_PROCESS_LIMITS.maxBuffer, stderrBytes: 8192, stdoutSpool: join(dir, "stdout") });
    if (merge.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", "merge-tree timed out");
    if (merge.kind !== "exited" || (merge.exitCode !== 0 && merge.exitCode !== 1))
      throw new StoreError("REF_STATE_UNKNOWN", `canonical merge-tree is ${merge.kind}${merge.exitCode !== null ? ` ${merge.exitCode}` : ""}`);
    let lines: string[];
    try { lines = headLines(join(dir, "stdout"), 65); }
    catch { throw new StoreError("REF_STATE_UNKNOWN", "canonical merge-tree output could not be read"); }
    if (merge.exitCode === 1)
      throw new StoreError("REVERT_CONFLICT", "the revert conflicts with later work on main",
        { details: { paths: lines.slice(1, 65), artifact: "none" } });
    const tree = lines[0] ?? "";
    if (!isValidFullOid(tree)) throw new StoreError("REF_STATE_UNKNOWN", "merge-tree wrote no tree");
    const mainTree = runProcessSync({ executable: GIT_BIN,
      argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, "rev-parse", `${gitOidArgument(input.main)}^{tree}`],
      env: GIT_ENV, timeoutMs: CANONICAL_PROCESS_LIMITS.timeout, stdoutBytes: 256, stderrBytes: 256 });
    if (mainTree.kind !== "exited" || mainTree.exitCode !== 0)
      throw new StoreError("REF_STATE_UNKNOWN", "canonical main tree is not observable");
    if (mainTree.stdout.toString("utf8").trim() === tree)
      throw new StoreError("INVALID_REQUEST", "the merged change is no longer present on main");
    const commit = runProcessSync({ executable: GIT_BIN,
      argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, "commit-tree", gitOidArgument(tree),
        "-p", gitOidArgument(input.main), "-m", input.message],
      env: { ...GIT_ENV, GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: `oma@${input.society}.oma.invalid`,
        GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: `oma@${input.society}.oma.invalid` },
      timeoutMs: CANONICAL_PROCESS_LIMITS.timeout, stdoutBytes: 256, stderrBytes: 8192 });
    if (commit.kind !== "exited" || commit.exitCode !== 0)
      throw new StoreError("REF_STATE_UNKNOWN", `canonical commit-tree is ${commit.kind}`);
    const oid = commit.stdout.toString("utf8").trim();
    if (!isValidFullOid(oid)) throw new StoreError("REF_STATE_UNKNOWN", "commit-tree wrote no commit");
    return oid;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The first `maxLines` non-empty lines of a spooled stream, read a chunk at a
 * time — merge-tree's tree line and conflict paths without the whole listing
 * in memory. A line beyond the chunk-plus-carry working set still counts as
 * one; an unreadable spool is a thrown I/O failure for the caller. */
function headLines(path: string, maxLines: number): string[] {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const lines: string[] = [];
    const chunk = Buffer.alloc(1024 * 1024);
    let carry = Buffer.alloc(0);
    while (lines.length < maxLines) {
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      carry = Buffer.concat([carry, chunk.subarray(0, count)]);
      for (;;) {
        const at = carry.indexOf(0x0a);
        if (at < 0) break;
        const line = carry.subarray(0, at).toString("utf8");
        carry = carry.subarray(at + 1);
        if (line.length > 0) lines.push(line);
        if (lines.length >= maxLines) break;
      }
      // A single line beyond this cannot be a tree oid or a wire path.
      if (carry.byteLength > 16 * 1024 * 1024) break;
    }
    if (lines.length < maxLines && carry.byteLength > 0 && carry.byteLength <= 16 * 1024 * 1024) {
      const line = carry.toString("utf8");
      if (line.length > 0) lines.push(line);
    }
    return lines;
  } finally { closeSync(fd); }
}


/** Batch traversal output is spooled, so the process count is independent of
 * submission history and an arbitrary in-memory output cap is not correctness. */
function batchLines(repository: string, args: readonly string[], input: string | undefined, consume: (line: string) => void): void {
  const scratch=mkdtempSync(join(tmpdir(),"oma-git-batch-")), spool=join(scratch,"stdout");
  try {
    const result=runProcessSync({executable:GIT_BIN,argv:[...CANONICAL_SAFE_ARGS,"--git-dir",repository,...args],env:GIT_ENV,
      timeoutMs:CANONICAL_PROCESS_LIMITS.timeout,stdoutBytes:0,stderrBytes:8192,stdoutSpool:spool,...(input === undefined ? {} : {input})});
    if(result.kind !== "exited" || result.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN",`batch Git observation is ${result.kind}`);
    const fd=openSync(spool,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const bytes=Buffer.alloc(65536);let tail=Buffer.alloc(0);
      for(;;){const count=readSync(fd,bytes,0,bytes.length,null);if(count===0)break;
        const chunk=Buffer.concat([tail,bytes.subarray(0,count)]);let start=0;
        for(;;){const end=chunk.indexOf(10,start);if(end<0)break;consume(decodeUtf8(chunk.subarray(start,end)));start=end+1;}
        tail=Buffer.from(chunk.subarray(start));
      }
      if(tail.length) throw new StoreError("REF_STATE_UNKNOWN","unterminated batch Git record");
    } finally {closeSync(fd);}
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
export function canonicalPublishedRefs(repository: string): ReadonlyMap<string,string> {
  const refs=new Map<string,string>();
  batchLines(repository,["for-each-ref","--format=%(refname)%00%(objectname)","refs/oma/published/"],undefined,line=>{
    const parts=line.split("\0");
    if(parts.length!==2 || !parts[0]!.startsWith("refs/oma/published/") || !isValidFullOid(parts[1]) || refs.has(parts[0]!))
      throw new StoreError("STORE_CORRUPT","malformed canonical published ref set");
    refs.set(parts[0]!,parts[1]!);
  });return refs;
}
export function canonicalCommitGraph(repository: string,candidates: readonly string[]): ReadonlyMap<string,readonly string[]> {
  const graph=new Map<string,readonly string[]>();
  batchLines(repository,["rev-list","--parents","--stdin"],candidates.map(gitOidArgument).join("\n")+"\n",line=>{
    const [oid,...parents]=line.split(" ");
    if(!isValidFullOid(oid)||parents.some(p=>!isValidFullOid(p))||graph.has(oid))throw new StoreError("REF_STATE_UNKNOWN","malformed commit graph");
    graph.set(oid,parents);
  });return graph;
}
export function canonicalCommitRange(repository: string,base: string,candidate: string): readonly string[] {
  const commits:string[]=[];
  batchLines(repository,["rev-list",`${gitOidArgument(base)}..${gitOidArgument(candidate)}`],undefined,line=>{
    if(!isValidFullOid(line)) throw new StoreError("REF_STATE_UNKNOWN","malformed candidate range");commits.push(line);
  });return commits;
}
