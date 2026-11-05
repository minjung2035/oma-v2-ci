/** Broker-owned merge results. Original publication and author provenance never
 * flow through this ref namespace. All expensive preparation yields the broker. */
import { join } from "node:path";
import { closeSync } from "node:fs";
import { directoryNames } from "@oma/file-descriptors";
import { cleanupAll, withCleanup, withAsyncCleanup } from "@oma/native/cleanup";
import { TreeLease, treeQuiescence, collectLeasedTree } from "@oma/storage/tree-lease";
import { ensureOwnedDurableDirectory } from "@oma/storage/durable-fs";
import { listOwnedDirectory } from "@oma/storage/directory";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import { createHash } from "node:crypto";
import { PreparationExecutor } from "@oma/process/preparation";
import { GIT_ENV } from "@oma/process/policies";
import { runProcessSync } from "@oma/process/run";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid, isValidOperationId } from "@oma/domain/identifiers";
import { observed } from "@oma/domain/git-facts";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import { CANONICAL_SAFE_ARGS, GIT_BIN, bindCanonicalCommand, createCanonicalObserver, type CanonicalExecution } from "./canonical-command.js";
import { openCanonicalDirectory } from "./canonical-directory.js";
import { preparedRefOwner } from "./prepared-ref-owner.js";
export class IntegrationPreparation {
  private readonly executor = new PreparationExecutor();
  private lease: TreeLease | null = null;
  private readonly observations;
  constructor(private readonly repository: string, private readonly society: string, private readonly execution?: CanonicalExecution) {
    this.observations = createCanonicalObserver(GIT_BIN, execution);
  }
  private async run(args: string[], input?: string, sink?: (b: Buffer) => void) {
    const physical = bindCanonicalCommand({ executable: GIT_BIN,
      argv: [...CANONICAL_SAFE_ARGS, "--git-dir", this.repository, ...args],
      env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: "1", GIT_AUTHOR_NAME: "OMA", GIT_COMMITTER_NAME: "OMA",
        GIT_AUTHOR_EMAIL: `oma@${this.society}`, GIT_COMMITTER_EMAIL: `oma@${this.society}` },
      timeoutMs: null, stdoutBytes: sink ? 0 : 65536, stdoutOverflow: sink ? "discard" : "limit", stderrBytes: 8192,
      ...(input === undefined ? {} : { input }) }, this.execution);
    const result = await this.executor.run(physical.command, undefined, this.lease === null ? [] : [this.lease.descriptor],
      sink ? { stdoutSink: b => sink(Buffer.from(b)) } : {}, physical.directoryFd === undefined ? {} : { directoryFd: physical.directoryFd });
    if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `integration preparation is ${result.kind}`);
    return result;
  }
  async prepare(operation: string, base: string, candidate: string, main: string,
      own: (owner: PreacceptArtifactOwner) => void): Promise<{ candidate: string; preparedRef: string | null; reusable: boolean }> {
    if (![base,candidate,main].every(isValidFullOid) || !isValidOperationId(operation))
      throw new StoreError("INVALID_REQUEST", "invalid integration preparation identity");
    if (base === main) return { candidate, preparedRef: null, reusable: true };
    if (this.lease !== null) throw new StoreError("BROKER_UNAVAILABLE","integration preparation is busy");
    const leaseRoot = join(this.repository,"oma-preparations"), directory = openCanonicalDirectory(this.repository,"oma-preparations",this.execution,true);
    return withAsyncCleanup(async () => {
      if (directory === undefined) ensureOwnedDurableDirectory(leaseRoot,this.repository,0o700);
      const leasePath = join(leaseRoot,operation);
      this.lease = TreeLease.take(leasePath,true,directory === undefined ? {} : { directoryFd: directory });
      return await this.prepareMerged(operation,base,candidate,main,own,leasePath,directory);
    }, () => {
      const lease = this.lease; this.lease = null;
      cleanupAll([() => lease?.release(), () => { if (directory !== undefined) closeSync(directory); }]);
    });
  }
  private async prepareMerged(operation: string, base: string, candidate: string, main: string,
      own: (owner: PreacceptArtifactOwner) => void, leasePath: string, directory?: number) {
    let head = Buffer.alloc(0);
    const merged = await this.run(["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", main, candidate], undefined,
      b => { if (head.length < 65536) head = Buffer.concat([head,b.subarray(0,65536-head.length)]); });
    const fields = head.toString("utf8").split("\0"), tree = fields[0]!;
    if (merged.exitCode === 1) throw new StoreError("REVERT_CONFLICT", `integration merge conflict: ${fields.slice(1).filter(Boolean).slice(0,32).join(", ")}`, { details: { paths: fields.slice(1).filter(Boolean).slice(0,32) } });
    if (merged.exitCode !== 0 || !isValidFullOid(tree)) throw new StoreError("REF_STATE_UNKNOWN", "merge-tree did not prove a clean tree");
    const commit = await this.run(["commit-tree", tree, "-p", main, "-p", candidate], `OMA integration ${operation}\n`);
    const result = commit.stdout.toString("ascii").trim();
    if (commit.exitCode !== 0 || !isValidFullOid(result)) throw new StoreError("REF_STATE_UNKNOWN", "prepared commit was not observed");
    const ref = `refs/oma/prepared/${operation}`;
    // Register before the asynchronous publication; unknown acceptance retains it.
    const artifact = preparedRefOwner(this.repository,ref,result,leasePath,directory,this.execution);
    try { own(artifact.owner); }
    catch (error) { return withCleanup(() => { throw error; }, artifact.cancelUnpublished); }
    const publication = await this.run(["update-ref",ref,result,""]);
    if (publication.exitCode !== 0 || observed(this.observations.ref(this.repository,ref),"prepared ref") !== result)
      throw new StoreError("REF_STATE_UNKNOWN", "prepared ref publication is unproven");
    // Raw records bind both path ends (renames represented as delete+add),
    // old/new object IDs, mode and type. Different deltas require context review.
    const digest = async (a: string,b: string) => {
      const hash = createHash("sha256");
      const diff = await this.run(["diff","--raw","--no-renames","--abbrev=64","-z",a,b],undefined,c => { hash.update(c); });
      if (diff.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN","raw delta comparison failed");
      return hash.digest("hex");
    };
    let reusable = await digest(base,candidate) === await digest(main,result);
    const original = observed(this.observations.changedPaths(this.repository,base,candidate),"proposal paths");
    const advanced = observed(this.observations.changedPaths(this.repository,base,main),"main paths");
    const related = (a: string,b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    if (original.some(a => advanced.some(b => related(a.path,b.path)))) reusable = false;
    return { candidate: result, preparedRef: ref, reusable };
  }
}

/** Startup collection runs only under the broker lease. Trusted Git helpers
 * inherit the per-preparation lease, so parent death cannot authorize deletion
 * while update-ref is still running. Unknown accepted reads throw and retain. */
export function collectPreparedIntegrations(repository: string, operation: (id: string) => DecodedOperation | null,
    execution?: CanonicalExecution): void {
  const root = join(repository,"oma-preparations");
  let directory: number | undefined;
  try { directory = openCanonicalDirectory(repository,"oma-preparations",execution); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    const control = directory === undefined ? {} : { directoryFd: directory };
    const names = directory === undefined ? (listOwnedDirectory(root) ?? []).map(entry => entry.name) : directoryNames(directory);
    const observations = createCanonicalObserver(GIT_BIN,execution);
    for (const name of names) {
      if (!name.endsWith(".lease")) continue;
      const id=name.slice(0,-6); if (!isValidOperationId(id)) continue;
      const path=join(root,id), state=operation(id);
      if (treeQuiescence(path,control).kind !== "quiescent") continue;
      if (state !== null) {
        if (state.kind === "attest.record" && state.plan.fact.kind === "review.integration") collectLeasedTree(path,control);
        continue;
      }
      const ref=`refs/oma/prepared/${id}`, observedRef=observations.ref(repository,ref);
      if (observedRef.kind === "present") {
        const physical=bindCanonicalCommand({executable:GIT_BIN,argv:[...CANONICAL_SAFE_ARGS,"--git-dir",repository,"update-ref","-d",ref,observedRef.value],
          env:GIT_ENV,timeoutMs:120000,stdoutBytes:1024,stderrBytes:8192},execution);
        const result=runProcessSync(physical.command,undefined,[],physical.directoryFd === undefined ? {} : { directoryFd: physical.directoryFd });
        if (result.kind !== "exited" || result.exitCode !== 0 || observations.ref(repository,ref).kind !== "absent")
          throw new StoreError("REF_STATE_UNKNOWN","unaccepted prepared ref collection failed");
      } else if (observedRef.kind !== "absent") observed(observedRef,"unaccepted prepared ref");
      collectLeasedTree(path,control);
    }
  } finally { if (directory !== undefined) closeSync(directory); }
}
