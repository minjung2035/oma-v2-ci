import { ProvenanceIndex } from "./provenance-index.js";
import { canonicalPublishedRefs, canonicalCommitGraph, canonicalCommitRange } from "./canonical-command.js";
import { withReviewSourceRecord } from "./review-record.js";
import { IntegrationPreparation } from "./integration-preparation.js";
import { readResult } from "@oma/tool-files/results";
import { join } from "node:path";
import { ReviewArtifacts } from "./review-artifact.js";
import { readImmutableBytes } from "@oma/storage/immutable-file";
import { isResultReference } from "@oma/tool-files/results";
import type { ReviewDiffArtifact } from "@oma/contracts/files";
import type { GitRepositoryPort } from "./repository-port.js";
/** Fixed canonical Git adapter. Importing workflow/index never evaluates commands. */
import type { Oid } from "@oma/contracts";
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { GitObservation } from "@oma/contracts/git";
import { observed } from "@oma/domain/git-facts";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid } from "@oma/domain/identifiers";
import type { GitPaths } from "./paths.js";
import type { RefAfterCas } from "./observe.js";
import { createCanonicalObserver, compareAndSwapCanonicalRef, authorizeCanonicalNoop, canonicalRevertCommit, type CanonicalExecution } from "./canonical-command.js";
import { GitPublicationObserver } from "./publication.js";
import { ContextPublicationObserver } from "./context-publication.js";
import { ContextRepository } from "./context-repository.js";
import { QuarantineImporter, type QuarantineExecution } from "./quarantine.js";

export class GitRepository implements GitRepositoryPort {
  get stateRoot(): string { return this.paths.stateRoot; }
  get society(): string { return this.paths.society; }
  private readonly observations;
  private readonly provenance: ProvenanceIndex;
  private readonly quarantine: QuarantineImporter;
  private readonly contextRepository: ContextRepository;
  readonly integration: GitRepositoryPort["integration"];
  readonly submission: GitRepositoryPort["submission"];
  readonly context: GitRepositoryPort["context"];
  readonly review: GitRepositoryPort["review"];
  readonly submissionPublication: GitRepositoryPort["submissionPublication"];
  readonly contextPublication: GitRepositoryPort["contextPublication"];
  constructor(private readonly paths: GitPaths, private readonly ledger: {
    submissions(): readonly OperationOf<"git.submit">[];
    attachmentRoots?(): readonly (OperationOf<"mail.send"> | OperationOf<"agent.create">)[];
  }, quarantine: QuarantineExecution | null = null, private readonly canonicalExecution?: CanonicalExecution) {
    this.observations = createCanonicalObserver(canonicalExecution?.executable, canonicalExecution);
    this.provenance = new ProvenanceIndex({refs:()=>canonicalPublishedRefs(paths.projectGit, canonicalExecution),graph:tips=>canonicalCommitGraph(paths.projectGit,tips,canonicalExecution),range:(base,candidate)=>canonicalCommitRange(paths.projectGit,base,candidate,canonicalExecution)});
    this.quarantine = new QuarantineImporter(paths, candidate => this.canonicalHas(candidate), quarantine);
    this.contextRepository = new ContextRepository(paths, this.observations);
    this.submissionPublication = new GitPublicationObserver(this.observations, paths.projectGit);
    this.contextPublication = new ContextPublicationObserver(this.observations, paths.contextGit);
    const facts = {
      verifyObjectFormat: (oids: readonly Oid[]) => { this.objectFormat(paths.projectGit, oids); },
      main: () => this.observations.ref(paths.projectGit, "refs/heads/main"),
      published: () => this.observations.published(paths.projectGit),
      ancestry: (base: Oid, candidate: Oid) => this.observations.ancestry(paths.projectGit, base, candidate),
      changedPaths: (base: Oid, candidate: Oid) => this.observations.changedPaths(paths.projectGit, base, candidate),
      gitlinks: (candidate: Oid) => this.observations.gitlinks(paths.projectGit, candidate),
      submitters: (base: Oid, candidate: Oid) => this.submitters(base, candidate),
    };
    this.integration = { ...facts,
      preparedRef: ref => this.observations.ref(paths.projectGit, ref),
      verifyDiff: diff => {
        try { const page = readResult(join(paths.projectGit, "oma-results"), diff.reference, { byteLimit: 4, encoding: "base64" });
          if (page.bytes !== diff.bytes || page.sha256 !== diff.sha256) throw new Error("diff metadata changed"); }
        catch (cause) { throw new StoreError("INTEGRATION_CONDITIONS", "exact diff attachment is unavailable or changed", { cause }); }
      },
      compareAndSwap: (base, candidate) => this.casRef(paths.projectGit, "refs/heads/main", candidate, base),
      noopWitness: ref => this.observations.ref(paths.projectGit, ref),
      authorizeNoop: (ref, candidate) => this.authorizeNoop(ref, candidate),
    } satisfies GitRepositoryPort["integration"];
    this.submission = {
      verifyObjectFormat: facts.verifyObjectFormat,
      canonicalHas: candidate => this.canonicalHas(candidate),
      quarantineImport: (fd, candidate, exportRef, prerequisites, authorize) => this.quarantineImport(fd, candidate, exportRef, prerequisites, authorize),
      quarantineVerify: (fd, candidate, exportRef, prerequisites, authorize) => this.quarantine.verifyBundle(fd, candidate, exportRef, prerequisites, authorize),
      assertOwner: () => {
        if (!paths.ownerSignal) throw new StoreError("UNSUPPORTED_PROFILE", "broker publication ownership was not bound");
        if (paths.ownerSignal?.aborted) throw new StoreError("BROKER_UNAVAILABLE", "broker publication owner is stopping");
        return undefined;
      },
      publishRef: (ref, candidate) => this.publishRef(ref, candidate),
      observeRef: ref => this.observations.ref(paths.projectGit, ref),
    } satisfies GitRepositoryPort["submission"];
    this.context = {
      current: () => this.contextRepository.current(),
      observedObjectFormat: () => this.contextRepository.observedObjectFormat(),
      prepareCandidate: (tree, entries, expected) => this.contextRepository.prepareCandidate(tree, entries, expected),
      assertGoalOnly: (candidate, expected) => this.contextRepository.assertGoalOnly(candidate, expected),
      preparationQuiescent: tree => this.contextRepository.preparationQuiescent(tree),
      ensureCandidate: operation => this.contextRepository.ensureCandidate(operation),
      compareAndSwap: (base, candidate) => this.casRef(paths.contextGit, "refs/heads/main", candidate, base),
      publishSnapshot: (operation, proof) => this.contextRepository.publishSnapshot(operation, proof),
    } satisfies GitRepositoryPort["context"];
    const artifacts = new ReviewArtifacts(paths.projectGit);
    const preparation = new IntegrationPreparation(paths.projectGit, paths.society);
    this.review = { ...facts,
      prepareIntegration: (id, base, candidate, main, own) => preparation.prepare(id,base,candidate,main,own),
      prepareDiff: (operation, base, candidate, own) => artifacts.prepare(operation, base, candidate, own),
      prepareRevert: input => canonicalRevertCommit(paths.projectGit, { ...input, society: paths.society }, canonicalExecution),
      publishCandidateRef: (ref, candidate) => this.publishRef(ref, candidate),
    } satisfies GitRepositoryPort["review"];
  }
  readDiffPatch(diff: ReviewDiffArtifact): Buffer {
    if (diff.version !== 1 || !isResultReference(diff.reference) || !isValidFullOid(diff.base) || !isValidFullOid(diff.candidate) ||
        diff.base.length !== diff.candidate.length || !Number.isSafeInteger(diff.bytes) || diff.bytes < 0)
      throw new StoreError("STORE_CORRUPT", "invalid frozen review diff descriptor");
    const [, id, digest] = diff.reference.split(":");
    if (digest !== diff.sha256) throw new StoreError("STORE_CORRUPT", "review diff reference and manifest have different digests");
    return readImmutableBytes(join(this.paths.projectGit, "oma-results", `${id}.result`), diff.sha256, diff.bytes);
  }
  readDiffRecord(diff: ReviewDiffArtifact) {
    const patch = this.readDiffPatch(diff);
    const paths = observed(this.review.changedPaths(diff.base, diff.candidate), "frozen review changed paths");
    return { patch, paths };
  }
  withReviewSourceRecord(base: Oid, candidate: Oid, consume: (source: import("@oma/contracts/files").ReviewSourceRecord) => undefined): void {
    const format = this.objectFormat(this.paths.projectGit, [base, candidate]);
    observed(this.observations.commit(this.paths.projectGit, base), "recorded review base");
    observed(this.observations.commit(this.paths.projectGit, candidate), "recorded review candidate");
    withReviewSourceRecord(this.paths.projectGit, base, candidate, format, consume);
  }
  private objectFormat(repo: string, oids: readonly string[] = []): "sha1" | "sha256" {
    const format = observed(this.observations.objectFormat(repo), "repository object format");
    if (oids.some(oid => !isValidFullOid(oid) || oid.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", `OID does not match repository object format ${format}`);
    return format;
  }
  /** The durable no-op authorization uses the same canonical Git owner as CAS. */
  private authorizeNoop(ref: string, candidate: Oid): GitObservation<Oid> {
    return authorizeCanonicalNoop(this.observations, this.paths.projectGit, ref, candidate, this.canonicalExecution);
  }
  private casRef(repository: string, ref: string, candidate: string, expected: string | null): RefAfterCas {
    return compareAndSwapCanonicalRef(this.observations, repository, ref, candidate, expected, this.canonicalExecution);
  }
  private submitters(base: Oid, candidate: Oid): readonly string[] {
    return this.provenance.authors(base,candidate,this.ledger.submissions(), this.ledger.attachmentRoots?.() ?? []);
  }
  private canonicalHas(oid: string): boolean {
    const value = this.observations.commit(this.paths.projectGit, oid);
    return value.kind === "absent" ? false : observed(value, "canonical commit");
  }
  private quarantineImport(bundleFd: number, candidate: Oid, exportRef: string, prerequisites: readonly Oid[], authorize: () => void): Promise<void> {
    return this.quarantine.importBundle(bundleFd, candidate, exportRef, prerequisites, authorize);
  }
  private publishRef(ref: string, candidate: Oid): void {
    const current = this.observations.ref(this.paths.projectGit, ref);
    if (current.kind === "present") {
      if (current.value !== candidate) throw new StoreError("PUBLISHED_REF_CONFLICT", `ref ${ref} already points elsewhere`);
      return;
    }
    if (current.kind !== "absent") observed(current, `published ref ${ref}`);
    const after = this.casRef(this.paths.projectGit, ref, candidate, null);
    if (after.kind === "candidate") return;
    if (after.kind === "third" && after.oid !== null) throw new StoreError("PUBLISHED_REF_CONFLICT", `CAS publish found another value for ${ref}`);
    throw new StoreError("REF_STATE_UNKNOWN", `published ref ${ref} is not proven after CAS`);
  }

  snapshotReady(plan: OperationOf<"context.publish">["plan"]): boolean { return this.contextRepository.snapshotReady(plan); }
}
