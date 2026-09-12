// GIT/INT/CTX: composition and fixed repository observation boundaries.
// Coordinators own intent/effect ordering; no candidate gate is relaxed here.
import { constants, openSync, closeSync, readdirSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AuthContext, ContextEntry, Oid, Receipt } from "../implementation/contracts.js";
import { Store } from "./store.js";
import type { OperationOf } from "./storage/operation-codec.js";
import { assertContextDirectory } from "./storage/context-files.js";
import { StoreError } from "./domain/errors.js";
import { MailModule } from "./mail.js";
import { publishContextRevision } from "./storage/context-snapshot.js";
import { isValidFullOid } from "./ids.js";
import { contextRevisionPathAt } from "./storage/paths.js";
import { sha256Hex } from "./hash.js";
import { contextFileCheck, contextPathCheck } from "./validate.js";
import { GitObserver, classifyRefAfterCas, type GitObservation, type RefAfterCas } from "./git/observe.js";
import { IntegrationCoordinator } from "./git/integration.js";
import { SubmitCoordinator, type SubmitInput } from "./git/submit.js";
import { GitPublicationObserver } from "./git/publication.js";
import { QuarantineImporter } from "./git/quarantine.js";
import { ContextCoordinator, type ContextInput } from "./git/context.js";
import { ContextRepository } from "./git/context-repository.js";
import { ContextPublicationObserver, type ContextPublicationEvidence } from "./git/context-publication.js";
import type { GitPaths } from "./git/paths.js";
import type { IntegrationPolicy, IntegrationPolicyReader, FrozenCheck } from "./git/integration-policy.js";
import { GIT_ENV } from "./process/policies.js";
export type { GitPaths, CheckProfile } from "./git/paths.js";
export type { IntegrationPolicy } from "./git/integration-policy.js";
export type PolicyRevisionReader = IntegrationPolicyReader;
export const gitEnv = GIT_ENV;
const GIT_BIN = "/usr/bin/git";
const PROCESS_LIMITS = { timeout: 120000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" as const };
function gitUncertain(result: { error?: Error; signal: NodeJS.Signals | null; status: number | null }): boolean {
  return Boolean(result.error) || result.signal !== null || result.status === null;
}
function observed<T>(observation: GitObservation<T>, what: string): T {
  if (observation.kind === "present") return observation.value;
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", `${what}: ${observation.kind}`);
}

export class GitModule {
  private readonly integrationCoordinator: IntegrationCoordinator;
  private readonly submissionCoordinator: SubmitCoordinator;
  private readonly contextCoordinator: ContextCoordinator;
  private readonly contextRepository: ContextRepository;
  private readonly quarantine: QuarantineImporter;
  private integrationTail: Promise<void> = Promise.resolve();
  private readonly observations = new GitObserver((args, input) => {
    const format = args.includes("--show-object-format");
    const commit = args.includes("--batch-check=%(objecttype)");
    const result = spawnSync(GIT_BIN, [...args], {
      ...PROCESS_LIMITS, env: gitEnv, timeout: format ? 30000 : commit ? 10000 : 120000,
      maxBuffer: format ? 1024 : commit ? 64 * 1024 : 4 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
    });
    return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
      ...(result.error === undefined ? {} : { error: result.error }) };
  });
  constructor(
    private readonly paths: GitPaths, private readonly store: Store, mail: MailModule,
    integration: IntegrationPolicy | null = null, policyRevisionReader: PolicyRevisionReader | null = null,
  ) {
    this.store.bindRepositoryIdentity({ society: paths.society });
    this.integrationCoordinator = new IntegrationCoordinator(store, {
      verifyObjectFormat: oids => { this.objectFormat(paths.projectGit, oids); },
      main: () => this.observations.ref(paths.projectGit, "refs/heads/main"),
      published: () => this.observations.published(paths.projectGit),
      ancestry: (base, candidate) => this.observations.ancestry(paths.projectGit, base, candidate),
      changedPaths: (base, candidate) => this.observations.changedPaths(paths.projectGit, base, candidate),
      compareAndSwap: (base, candidate) => this.casRef(paths.projectGit, "refs/heads/main", candidate, base),
      runCheck: (candidate, check) => this.runCheck(candidate, check),
    }, integration, policyRevisionReader);
    this.quarantine = new QuarantineImporter(paths, candidate => this.canonicalHas(candidate));
    this.submissionCoordinator = new SubmitCoordinator(paths, store, mail, {
      verifyObjectFormat: oids => { this.objectFormat(paths.projectGit, oids); },
      canonicalHas: candidate => this.canonicalHas(candidate),
      quarantineImport: (path, candidate, exportRef, prerequisites) => this.quarantineImport(path, candidate, exportRef, prerequisites),
      publishRef: (ref, candidate) => this.publishRef(ref, candidate),
      observeRef: ref => this.observations.ref(paths.projectGit, ref),
    }, new GitPublicationObserver(this.observations, paths.projectGit));
    this.contextRepository = new ContextRepository(paths, this.observations);
    this.contextCoordinator = new ContextCoordinator(paths, store, mail, {
      current: () => this.currentContext(),
      prepareCandidate: (tree, entries, expected) => this.prepareContextCandidate(tree, entries, expected),
      ensureCandidate: operation => this.contextRepository.ensureCandidate(operation),
      compareAndSwap: (base, candidate) => this.casRef(paths.contextGit, "refs/heads/main", candidate, base),
      publishSnapshot: (operation, proof) => this.publishContextSnapshot(operation, proof),
    }, new ContextPublicationObserver(this.observations, paths.contextGit));
  }
  private objectFormat(repo: string, oids: readonly string[] = []): "sha1" | "sha256" {
    const format = observed(this.observations.objectFormat(repo), "repository object format");
    if (oids.some(oid => !isValidFullOid(oid) || oid.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", `OID does not match repository object format ${format}`);
    return format;
  }
  /** Every CAS, including exit zero, gets a NEW canonical observation. */
  private casRef(repository: string, ref: string, candidate: string, expected: string | null): RefAfterCas {
    spawnSync(GIT_BIN, ["--git-dir", repository, "update-ref", ref, candidate, expected ?? ""], { ...PROCESS_LIMITS, env: gitEnv });
    return classifyRefAfterCas(this.observations.ref(repository, ref), expected, candidate);
  }
  submit(auth: AuthContext, key: string, input: SubmitInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    return this.submissionCoordinator.submit(auth, key, input, bytes);
  }
  private canonicalHas(oid: string): boolean {
    const value = this.observations.commit(this.paths.projectGit, oid);
    return value.kind === "absent" ? false : observed(value, "canonical commit");
  }
  private quarantineImport(bundlePath: string, candidate: Oid, exportRef: string, prerequisites: readonly Oid[]): void {
    this.quarantine.importBundle(bundlePath, candidate, exportRef, prerequisites);
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
  async integrate(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid }): Promise<Receipt> {
    const previous = this.integrationTail; let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.integrationCoordinator.execute(auth, key, input); } finally { release?.(); }
  }
  isPublished(oid: Oid): boolean { return observed(this.observations.published(this.paths.projectGit), "published refs").includes(oid); }
  private currentMain(): Oid { return observed(this.observations.ref(this.paths.projectGit, "refs/heads/main"), "canonical main ref"); }
  private async runCheck(_candidate: Oid, _check: FrozenCheck): Promise<void> {
    throw new StoreError("SPIKE_UNRESOLVED", "S-01-CANDIDATE bounded writable work area is not verified");
  }
  async publishContext(auth: AuthContext, key: string, input: ContextInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    const previous = this.integrationTail; let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.contextCoordinator.publish(auth, key, input, bytes); } finally { release?.(); }
  }
  // Named physical seams remain reachable for corruption/crash oracles.
  private currentContext(): Oid | null { return this.contextRepository.current(); }
  private prepareContextCandidate(tree: string, entries: ContextEntry[], expected: Oid | null): Oid {
    return this.contextRepository.prepareCandidate(tree, entries, expected);
  }
  private publishContextSnapshot(operation: OperationOf<"context.publish">, proof: ContextPublicationEvidence): void {
    this.contextRepository.publishSnapshot(operation, proof);
  }
  private reconcileContext(operation: OperationOf<"context.publish">): Promise<void> { return this.contextCoordinator.reconcile(operation); }

  /** CTX-006: the first GOAL is usable only after canonical publication,
   * complete snapshot/current and notification settlement. Never do this I/O in T.
   */
  hasCommittedContext(): boolean {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "context activation proof cannot run inside a transaction");
    for (const id of this.store.recoverableOperations()) {
      const operation = this.store.getOperationById(id);
      if (!operation) throw new StoreError("STORE_CORRUPT", "recoverable context operation disappeared");
      if (operation.kind === "context.publish") return false;
    }
    const revision = this.currentContext();
    if (revision === null) return false;
    const operation = this.store.findSucceededContext(revision);
    return operation !== null && this.contextRepository.snapshotReady(operation.plan);
  }

  /** Read-only canonical verification precedes a derived-pointer repair.
   * Missing or corrupt immutable revisions are not silently rebuilt here.
   */
  repairContextMirror(): void {
    const revision = this.currentContext(); if (!revision) return;
    const immutable = contextRevisionPathAt(this.paths.worldDir, revision);
    if (!lstatSync(immutable, { throwIfNoEntry: false })) throw new StoreError("REF_STATE_UNKNOWN", "immutable context revision missing; reconcile accepted intent first");
    assertContextDirectory(immutable);
    const listing = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "ls-tree", "-r", "-z", "--full-tree", revision], { ...PROCESS_LIMITS, env: gitEnv });
    if (gitUncertain(listing) || listing.status !== 0) throw new StoreError("REF_STATE_UNKNOWN", "context canonical tree unavailable");
    let tree: string;
    try { tree = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(listing.stdout); }
    catch { throw new StoreError("STORE_CORRUPT", "context canonical tree metadata is malformed UTF-8"); }
    if (!tree.endsWith("\0")) throw new StoreError("STORE_CORRUPT", "context tree is unterminated");
    const entries: ContextEntry[] = []; const expected = new Map<string, string>();
    for (const line of tree.slice(0, -1).split("\0")) {
      const tab = line.indexOf("\t"); const fields = line.slice(0, tab).split(" "); const path = line.slice(tab + 1);
      const oid = fields[2];
      if (tab < 0 || fields.length !== 3 || fields[0] !== "100644" || fields[1] !== "blob" || !isValidFullOid(oid) || contextPathCheck(path) || expected.has(path))
        throw new StoreError("STORE_CORRUPT", "context canonical tree contains an unsupported entry");
      expected.set(path, oid);
    }
    if (!expected.has("GOAL.md")) throw new StoreError("STORE_CORRUPT", "context canonical tree has no GOAL.md");
    const seen = new Set<string>();
    const verify = (relative = ""): void => {
      assertContextDirectory(join(immutable, relative));
      for (const name of readdirSync(join(immutable, relative))) {
        const path = relative ? `${relative}/${name}` : name; const absolute = join(immutable, path); const stat = lstatSync(absolute);
        if (stat.isDirectory() && path === "decisions" && [...expected.keys()].some(key => key.startsWith("decisions/"))) { verify(path); continue; }
        if (!stat.isFile() || stat.nlink !== 1 || !expected.has(path)) throw new StoreError("STORE_CORRUPT", `unexpected context mirror entry ${path}`);
        const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let bytes: Buffer;
        try { bytes = readFileSync(fd); } finally { closeSync(fd); }
        if (contextFileCheck(path, bytes)) throw new StoreError("STORE_CORRUPT", `context mirror policy mismatch ${path}`);
        const canonical = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "hash-object", "--stdin"], { ...PROCESS_LIMITS, input: bytes, env: gitEnv, encoding: "utf8" });
        if (gitUncertain(canonical) || canonical.status !== 0) throw new StoreError("REF_STATE_UNKNOWN", "context mirror object hash unavailable");
        if (canonical.stdout.trim() !== expected.get(path)) throw new StoreError("STORE_CORRUPT", `context mirror bytes differ from canonical revision: ${path}`);
        seen.add(path); entries.push({ path, bytes: bytes.length, sha256: sha256Hex(bytes) });
      }
    };
    verify();
    if (seen.size !== expected.size) throw new StoreError("STORE_CORRUPT", "context mirror is incomplete");
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    publishContextRevision(this.paths.worldDir, revision, entries, immutable);
  }
  async reconcile(operationId: string): Promise<void> {
    const previous = this.integrationTail; let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const operation = this.store.getOperationById(operationId);
      if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) return;
      switch (operation.kind) {
        case "git.integrate": await this.integrationCoordinator.reconcile(operation); return;
        case "context.publish": await this.reconcileContext(operation); return;
        case "git.submit": await this.submissionCoordinator.reconcile(operation); return;
        default: return;
      }
    } finally { release?.(); }
  }
  knownRefs(): { main: string; published: string[] } {
    return { main: this.currentMain(), published: [...observed(this.observations.published(this.paths.projectGit), "known published refs")] };
  }
}
