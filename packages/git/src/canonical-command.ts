// GIT-004/008: bounded canonical command adapter. Effect exit status is never CAS proof.
import { closeSync, constants, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_ENV } from "@oma/process/policies";
import { StoreError } from "@oma/domain/errors";
import { runProcessSync, type CommandSpec } from "@oma/process/run";
import { decodeUtf8 } from "@oma/domain/utf8";
import { GitObserver, classifyRefAfterCas, gitOidArgument, gitRefArgument, type RefAfterCas } from "./observe.js";
import { type GitProcessEvidence, type GitObservation } from "@oma/contracts/git";
import { isValidFullOid } from "@oma/domain/identifiers";

export const GIT_BIN = "/usr/bin/git";
export const CANONICAL_PROCESS_LIMITS = { timeout: 120000, maxBuffer: 4 * 1024 * 1024 } as const;
/** Trusted composition controls, never decoded request fields. The caller
 * owns each directory through all observations and synchronous CAS effects. */
export interface CanonicalExecution {
  readonly executable: string;
  readonly directories: ReadonlyMap<string, number>;
}
function execute(spec: CommandSpec, execution?: CanonicalExecution) {
  if (execution === undefined) return runProcessSync(spec);
  if (!execution.executable.startsWith("/") || execution.executable.includes("\0"))
    throw new StoreError("UNSUPPORTED_PROFILE", "canonical execution requires an absolute trusted Git executable");
  // Only the adapter's fixed repository operand may be rebound. Never scan
  // arbitrary user arguments for words that happen to look like options.
  const at = spec.argv[0] === "--git-dir" ? 0 : CANONICAL_SAFE_ARGS.length;
  if (spec.argv[at] !== "--git-dir" || (at !== 0 && !CANONICAL_SAFE_ARGS.every((value, index) => spec.argv[index] === value)))
    throw new StoreError("INTERNAL_ERROR", "canonical command has no fixed repository operand");
  const directoryFd = execution.directories.get(spec.argv[at + 1]!);
  const argv = [...spec.argv];
  if (directoryFd !== undefined) argv[at + 1] = ".";
  return runProcessSync({ ...spec, executable: execution.executable, argv }, undefined, [],
    directoryFd === undefined ? {} : { directoryFd });
}

/** UX-09/DR33: `GitObserver.gitlinks` is the one observation that enumerates a
 * candidate's *whole* tree (`ls-tree -r -z --full-tree`), so its output scales
 * with leaf count, not with a diff or a ref set — a sha256 record is ~80 bytes
 * plus the path. There is no honest in-memory bound for it: the runner spools
 * the stream whole and the observer parses it one record at a time, so a tree
 * of any size answers present/refused/corrupt — output size alone can never
 * become unknown, and a truncated record can never read as "no gitlinks". */
/** Native execution is owned by process/run.ts. Both byte budgets are the same
 * single bound, so the native combined stdout+stderr cap is unchanged. */
function evidence(argv: readonly string[], timeoutMs: number, maxBuffer: number, input?: string, stdoutSpool?: string, executable = GIT_BIN, execution?: CanonicalExecution): GitProcessEvidence {
  const result = execute({ executable, argv, env: GIT_ENV,
    timeoutMs, stdoutBytes: maxBuffer, stderrBytes: maxBuffer,
    ...(input === undefined ? {} : { input }), ...(stdoutSpool === undefined ? {} : { stdoutSpool }) }, execution);
  return { status: result.kind === "exited" ? result.exitCode : null, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr,
    ...(result.stdoutSpooledTo === undefined ? {} : { stdoutSpooledTo: result.stdoutSpooledTo }) };
}
export function createCanonicalObserver(executable = GIT_BIN, execution?: CanonicalExecution): GitObserver {
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
        const observed = evidence([...args], CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer, input, join(dir, "stdout"), executable, execution);
        return { ...observed, dispose: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* diagnostic residue */ } } };
      } catch (error) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* diagnostic residue */ }
        return { status: null, signal: null, stdout: null, stderr: null,
          error: error instanceof Error ? error : new Error(String(error)) };
      }
    }
    return evidence([...args], format ? 30000 : commit ? 10000 : CANONICAL_PROCESS_LIMITS.timeout,
      format ? 1024 : commit ? 64 * 1024 : CANONICAL_PROCESS_LIMITS.maxBuffer, input, undefined, executable, execution);
  });
}
export function compareAndSwapCanonicalRef(observations: GitObserver, repository: string, ref: string,
  candidate: string, expected: string | null, execution?: CanonicalExecution): RefAfterCas {
  // P0V-116: the adapter's own invariant; a refused argument is no observation.
  evidence(["--git-dir", repository, "update-ref", gitRefArgument(ref), gitOidArgument(candidate), expected === null ? "" : gitOidArgument(expected)],
    CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer, undefined, undefined, GIT_BIN, execution);
  return classifyRefAfterCas(observations.ref(repository, ref), expected, candidate);
}
/** A ref made only from nothing. What the ref holds afterwards is the observed
 * value, as for every CAS; whether this command is the one that made it is its
 * own success, which matters only when a concurrent maker produced the same
 * object -- the ref then holds this candidate either way (P0V-85). */
export function createCanonicalRef(observations: GitObserver, repository: string, ref: string,
  candidate: string, execution?: CanonicalExecution): { readonly after: RefAfterCas; readonly created: boolean } {
  const made = evidence(["--git-dir", repository, "update-ref", gitRefArgument(ref), gitOidArgument(candidate), ""],
    CANONICAL_PROCESS_LIMITS.timeout, CANONICAL_PROCESS_LIMITS.maxBuffer, undefined, undefined, GIT_BIN, execution);
  const after = classifyRefAfterCas(observations.ref(repository, ref), null, candidate);
  return { after, created: after.kind === "candidate" && made.status === 0 };
}

/** DR27: a no-op has no changed main ref to witness completed authorization.
 * Verify main and create one immutable operation ref in the same Git ref
 * transaction. Only that one ref changes, so there is no multi-ref crash-
 * atomicity assumption. A child exit is not proof: read the witness afterwards. */
export function authorizeCanonicalNoop(observations: GitObserver, repository: string, ref: string,
  candidate: string, execution?: CanonicalExecution): GitObservation<string> {
  evidence(["--git-dir", repository, "update-ref", "--stdin"], CANONICAL_PROCESS_LIMITS.timeout,
    CANONICAL_PROCESS_LIMITS.maxBuffer, `start\nverify refs/heads/main ${gitOidArgument(candidate)}\n` +
      `create ${gitRefArgument(ref)} ${gitOidArgument(candidate)}\nprepare\ncommit\n`, undefined, GIT_BIN, execution);
  return observations.ref(repository, ref);
}

/** The pinned safe configuration every broker-run diff/merge-tree against the
 * canonical repository carries: no hooks, no fsmonitor, no attributes, no
 * external diff driver and no network protocol. */
export const CANONICAL_SAFE_ARGS: readonly string[] = ["--no-pager", "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null", "-c", "diff.external=",
  "-c", "protocol.allow=never"];

/** mail-v1 §7: reverse an applied merge relative to its recorded candidate.
 * Two private commit objects have the desired current/base trees and the same
 * single parent (the applied candidate), making that exact commit their merge
 * base on Git versions without merge-tree --merge-base. No temporary ref or
 * worktree is published. The final revert's only parent remains actual main. */
export function canonicalRevertCommit(repository: string, input: {
  readonly mergeBase: string; readonly main: string; readonly base: string;
  readonly message: string; readonly society: string;
}, execution?: CanonicalExecution): string {
  // The conflict listing scales with the tree, not with a document bound:
  // merge-tree's stdout is spooled whole and only the head the classification
  // needs -- the tree line and up to 64 conflict paths -- is read back.
  const dir = mkdtempSync(join(tmpdir(), "oma-merge-tree-"));
  try {
    const plumbing = (argv: readonly string[], env: Readonly<NodeJS.ProcessEnv> = GIT_ENV): string => {
      const result = execute({ executable: GIT_BIN, argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, ...argv],
        env, timeoutMs: CANONICAL_PROCESS_LIMITS.timeout, stdoutBytes: 256, stderrBytes: 8192 }, execution);
      if (result.kind !== "exited" || result.exitCode !== 0)
        throw new StoreError("REF_STATE_UNKNOWN", `canonical revert plumbing is ${result.kind}`);
      const oid = result.stdout.toString("utf8").trim();
      if (!isValidFullOid(oid)) throw new StoreError("REF_STATE_UNKNOWN", "canonical revert plumbing wrote no object id");
      return oid;
    };
    const currentTree = plumbing(["rev-parse", `${gitOidArgument(input.main)}^{tree}`]);
    const baseTree = plumbing(["rev-parse", `${gitOidArgument(input.base)}^{tree}`]);
    const syntheticEnv = { ...GIT_ENV, GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "revert@oma.invalid",
      GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "revert@oma.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
    const view = (tree: string, label: string): string => plumbing(["commit-tree", gitOidArgument(tree),
      "-p", gitOidArgument(input.mergeBase), "-m", label], syntheticEnv);
    const currentView = view(currentTree, "OMA revert current view"), baseView = view(baseTree, "OMA revert base view");
    const merge = execute({ executable: GIT_BIN,
      argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, "merge-tree", "--write-tree", "--name-only",
        "--no-messages",
        currentView, baseView],
      env: GIT_ENV, timeoutMs: CANONICAL_PROCESS_LIMITS.timeout,
      stdoutBytes: CANONICAL_PROCESS_LIMITS.maxBuffer, stderrBytes: 8192, stdoutSpool: join(dir, "stdout") }, execution);
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
    if (currentTree === tree)
      throw new StoreError("INVALID_REQUEST", "the merged change is no longer present on main");
    const commit = execute({ executable: GIT_BIN,
      argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, "commit-tree", gitOidArgument(tree),
        "-p", gitOidArgument(input.main), "-m", input.message],
      env: { ...GIT_ENV, GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: `oma@${input.society}.oma.invalid`,
        GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: `oma@${input.society}.oma.invalid` },
      timeoutMs: CANONICAL_PROCESS_LIMITS.timeout, stdoutBytes: 256, stderrBytes: 8192 }, execution);
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
function batchLines(repository: string, args: readonly string[], input: string | undefined, consume: (line: string) => void, execution?: CanonicalExecution): void {
  const scratch=mkdtempSync(join(tmpdir(),"oma-git-batch-")), spool=join(scratch,"stdout");
  try {
    const result=execute({executable:GIT_BIN,argv:[...CANONICAL_SAFE_ARGS,"--git-dir",repository,...args],env:GIT_ENV,
      timeoutMs:CANONICAL_PROCESS_LIMITS.timeout,stdoutBytes:0,stderrBytes:8192,stdoutSpool:spool,...(input === undefined ? {} : {input})}, execution);
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
export function canonicalPublishedRefs(repository: string, execution?: CanonicalExecution): ReadonlyMap<string,string> {
  const refs=new Map<string,string>();
  batchLines(repository,["for-each-ref","--format=%(refname)%00%(objectname)","refs/oma/published/"],undefined,line=>{
    const parts=line.split("\0");
    if(parts.length!==2 || !parts[0]!.startsWith("refs/oma/published/") || !isValidFullOid(parts[1]) || refs.has(parts[0]!))
      throw new StoreError("STORE_CORRUPT","malformed canonical published ref set");
    refs.set(parts[0]!,parts[1]!);
  }, execution);return refs;
}
export function canonicalCommitGraph(repository: string,candidates: readonly string[], execution?: CanonicalExecution): ReadonlyMap<string,readonly string[]> {
  const graph=new Map<string,readonly string[]>();
  batchLines(repository,["rev-list","--parents","--stdin"],candidates.map(gitOidArgument).join("\n")+"\n",line=>{
    const [oid,...parents]=line.split(" ");
    if(!isValidFullOid(oid)||parents.some(p=>!isValidFullOid(p))||graph.has(oid))throw new StoreError("REF_STATE_UNKNOWN","malformed commit graph");
    graph.set(oid,parents);
  }, execution);return graph;
}
export function canonicalCommitRange(repository: string,base: string,candidate: string, execution?: CanonicalExecution): readonly string[] {
  const commits:string[]=[];
  batchLines(repository,["rev-list",`${gitOidArgument(base)}..${gitOidArgument(candidate)}`],undefined,line=>{
    if(!isValidFullOid(line)) throw new StoreError("REF_STATE_UNKNOWN","malformed candidate range");commits.push(line);
  }, execution);return commits;
}
