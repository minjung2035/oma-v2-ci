/** Broker-owned merge results. Original publication and author provenance never
 * flow through this ref namespace. All expensive preparation yields the broker. */
import { join } from "node:path";
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
import { CANONICAL_SAFE_ARGS, GIT_BIN, createCanonicalObserver } from "./canonical-command.js";
export class IntegrationPreparation {
  private readonly executor = new PreparationExecutor();
  private lease: TreeLease | null = null;
  private readonly observations = createCanonicalObserver();
  constructor(private readonly repository: string, private readonly society: string) {}
  private async run(args: string[], input?: string, sink?: (b: Buffer) => void) {
    const result = await this.executor.run({ executable: GIT_BIN,
      argv: [...CANONICAL_SAFE_ARGS, "--git-dir", this.repository, ...args],
      env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: "1", GIT_AUTHOR_NAME: "OMA", GIT_COMMITTER_NAME: "OMA",
        GIT_AUTHOR_EMAIL: `oma@${this.society}`, GIT_COMMITTER_EMAIL: `oma@${this.society}` },
      timeoutMs: null, stdoutBytes: sink ? 0 : 65536, stdoutOverflow: sink ? "discard" : "limit", stderrBytes: 8192,
      ...(input === undefined ? {} : { input }) }, undefined, this.lease === null ? [] : [this.lease.descriptor], sink ? { stdoutSink: b => sink(Buffer.from(b)) } : {});
    if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `integration preparation is ${result.kind}`);
    return result;
  }
  async prepare(operation: string, base: string, candidate: string, main: string,
      own: (owner: PreacceptArtifactOwner) => void): Promise<{ candidate: string; preparedRef: string | null; reusable: boolean }> {
    if (![base,candidate,main].every(isValidFullOid) || !isValidOperationId(operation))
      throw new StoreError("INVALID_REQUEST", "invalid integration preparation identity");
    if (base === main) return { candidate, preparedRef: null, reusable: true };
    if (this.lease !== null) throw new StoreError("BROKER_UNAVAILABLE","integration preparation is busy");
    const leaseRoot = join(this.repository,"oma-preparations"); ensureOwnedDurableDirectory(leaseRoot,this.repository,0o700);
    const leasePath = join(leaseRoot,operation); this.lease = TreeLease.take(leasePath,true);
    try { return await this.prepareMerged(operation,base,candidate,main,own,leasePath); }
    finally { this.lease.release(); this.lease = null; }
  }
  private async prepareMerged(operation: string, base: string, candidate: string, main: string,
      own: (owner: PreacceptArtifactOwner) => void, leasePath: string) {
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
    own({ path: ref, retainForOperation() {}, discardUnaccepted: () => {
      if (treeQuiescence(leasePath).kind !== "quiescent") throw new StoreError("REF_STATE_UNKNOWN","prepared ref still has an active or unknown helper");
      const deleted = runProcessSync({ executable: GIT_BIN, argv: [...CANONICAL_SAFE_ARGS,"--git-dir",this.repository,"update-ref","-d",ref,result],
        env: GIT_ENV, timeoutMs: 120000, stdoutBytes: 1024, stderrBytes: 8192 });
      if (deleted.kind !== "exited" || deleted.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN", "prepared ref deletion is unproven");
    } });
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
export function collectPreparedIntegrations(repository: string, operation: (id: string) => DecodedOperation | null): void {
  const root = join(repository,"oma-preparations");
  for (const entry of listOwnedDirectory(root) ?? []) {
    if (!entry.name.endsWith(".lease")) continue;
    const id=entry.name.slice(0,-6); if (!isValidOperationId(id)) continue;
    const path=join(root,id), state=operation(id);
    if (treeQuiescence(path).kind !== "quiescent") continue;
    if (state !== null) {
      if (state.kind === "attest.record" && state.plan.fact.kind === "review.integration") collectLeasedTree(path);
      continue;
    }
    const ref=`refs/oma/prepared/${id}`, observedRef=createCanonicalObserver().ref(repository,ref);
    if (observedRef.kind === "present") {
      const result=runProcessSync({executable:GIT_BIN,argv:[...CANONICAL_SAFE_ARGS,"--git-dir",repository,"update-ref","-d",ref,observedRef.value],
        env:GIT_ENV,timeoutMs:120000,stdoutBytes:1024,stderrBytes:8192});
      if (result.kind !== "exited" || result.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN","unaccepted prepared ref collection failed");
    } else if (observedRef.kind !== "absent") observed(observedRef,"unaccepted prepared ref");
    collectLeasedTree(path);
  }
}
