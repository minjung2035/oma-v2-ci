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
import { createCanonicalObserver, compareAndSwapCanonicalRef, authorizeCanonicalNoop, canonicalMergeDiff, canonicalRevertCommit } from "./canonical-command.js";
import { GitPublicationObserver } from "./publication.js";
import { ContextPublicationObserver } from "./context-publication.js";
import { ContextRepository } from "./context-repository.js";
import { QuarantineImporter, type QuarantineExecution } from "./quarantine.js";

export class GitRepository implements GitRepositoryPort {
  get stateRoot(): string { return this.paths.stateRoot; }
  get society(): string { return this.paths.society; }
  private readonly observations = createCanonicalObserver();
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
  }, quarantine: QuarantineExecution | null = null) {
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
      compareAndSwap: (base, candidate) => this.casRef(paths.projectGit, "refs/heads/main", candidate, base),
      noopWitness: ref => this.observations.ref(paths.projectGit, ref),
      authorizeNoop: (ref, candidate) => this.authorizeNoop(ref, candidate),
    } satisfies GitRepositoryPort["integration"];
    this.submission = {
      verifyObjectFormat: facts.verifyObjectFormat,
      canonicalHas: candidate => this.canonicalHas(candidate),
      quarantineImport: (fd, candidate, exportRef, prerequisites, authorize) => this.quarantineImport(fd, candidate, exportRef, prerequisites, authorize),
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
    this.review = { ...facts,
      mergeDiff: (base, candidate, maxBytes) => canonicalMergeDiff(paths.projectGit, base, candidate, maxBytes),
      prepareRevert: input => canonicalRevertCommit(paths.projectGit, { ...input, society: paths.society }),
      publishCandidateRef: (ref, candidate) => this.publishRef(ref, candidate),
    } satisfies GitRepositoryPort["review"];
  }
  private objectFormat(repo: string, oids: readonly string[] = []): "sha1" | "sha256" {
    const format = observed(this.observations.objectFormat(repo), "repository object format");
    if (oids.some(oid => !isValidFullOid(oid) || oid.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", `OID does not match repository object format ${format}`);
    return format;
  }
  /** The durable no-op authorization uses the same canonical Git owner as CAS. */
  private authorizeNoop(ref: string, candidate: Oid): GitObservation<Oid> {
    return authorizeCanonicalNoop(this.observations, this.paths.projectGit, ref, candidate);
  }
  private casRef(repository: string, ref: string, candidate: string, expected: string | null): RefAfterCas {
    return compareAndSwapCanonicalRef(this.observations, repository, ref, candidate, expected);
  }
  private submitters(base: Oid, candidate: Oid): readonly string[] {
    const changed = new Set(observed(this.observations.commits(this.paths.projectGit, base, candidate), "candidate commit range"));
    const actors = new Set<string>();
    for (const submission of this.ledger.submissions()) {
      if (submission.state === "failed") continue;
      const ref = this.observations.ref(this.paths.projectGit, submission.plan.publishedRef);
      if (ref.kind === "absent" && submission.state !== "succeeded") continue;
      if (observed(ref, "authenticated submission ref") !== submission.plan.candidate)
        throw new StoreError("STORE_CORRUPT", "published submission changed identity");
      const contributed = observed(this.observations.commits(this.paths.projectGit, base, submission.plan.candidate), "submitted commit range");
      if (submission.plan.candidate === candidate || contributed.some(commit => changed.has(commit))) actors.add(submission.actor);
    }
    return [...actors].sort();
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
