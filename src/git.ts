// MUST [GIT-001..009]/[INT-001..005]/[CTX-001..006]: broker-owned Git boundary.
// Unresolved sandbox primitives fail closed; no bundle parsing on the host.
import {
  constants, writeFileSync, existsSync, openSync,
  fsyncSync, closeSync, readdirSync, lstatSync, rmSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync as nodeSpawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import type { Actor, Address, AuthContext, BlobDescriptor, ContextEntry, Json, Oid, Receipt } from "../implementation/contracts.js";
import { Store, reused } from "./store.js";
import type { OperationOf, ValidatedPlan } from "./storage/operation-codec.js";
import { assertContextDirectory, readContextEntry } from "./storage/context-files.js";
import { contextEntriesCheck } from "./domain/context-policy.js";
import { StoreError } from "./domain/errors.js";
import { receiptOfOperation as receiptOf } from "./protocol/receipts.js";
import { MailModule, buildEml, expandAddresses, actorAddress, listAddress } from "./mail.js";
import { fsyncTree, ensureDurableDirectory } from "./storage/durable-fs.js";
import { publishContextRevision } from "./storage/context-snapshot.js";
import { generateOperationId, generateMessageId, isValidFullOid } from "./ids.js";
import { mailObjectRelativePath, contextRevisionDisplayPath } from "./domain/derived.js";
import { contextStagingPathAt, contextRevisionPathAt } from "./storage/paths.js";
import { requestHash } from "./hash.js";
import { assertCurrentActor } from "./authority.js";
import { contextFileCheck, contextPathCheck } from "./validate.js";
import { GitObserver, classifyRefAfterCas, type GitObservation, type RefAfterCas } from "./git/observe.js";
import { IntegrationCoordinator } from "./git/integration.js";
import { SubmitCoordinator, type SubmitInput } from "./git/submit.js";
import { GitPublicationObserver } from "./git/publication.js";
import { QuarantineImporter } from "./git/quarantine.js";
import type { GitPaths } from "./git/paths.js";
import type { IntegrationPolicy, IntegrationPolicyReader, FrozenCheck } from "./git/integration-policy.js";
import { GIT_ENV } from "./process/policies.js";
export type { GitPaths, CheckProfile } from "./git/paths.js";
export type { IntegrationPolicy } from "./git/integration-policy.js";
export type PolicyRevisionReader = IntegrationPolicyReader;

const GIT_BIN = "/usr/bin/git";
const spawnSync: typeof nodeSpawnSync = ((command: string, args?: readonly string[], options?: object) =>
  nodeSpawnSync(command, args ? [...args] : [], {
    timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, ...(options ?? {}),
  } as never)) as typeof nodeSpawnSync;
export const gitEnv = GIT_ENV;
function gitUncertain(result: { error?: Error; signal: NodeJS.Signals | null; status: number | null }): boolean {
  return Boolean(result.error) || result.signal !== null || result.status === null;
}
function gitObservationError(what: string, result: { error?: Error; signal: NodeJS.Signals | null; status: number | null; stderr?: string | Buffer | null }): StoreError {
  const detail = result.error?.message ?? (result.signal ? `signal ${result.signal}` : String(result.stderr ?? "").slice(0, 300));
  return new StoreError("REF_STATE_UNKNOWN", `${what} unavailable${detail ? `: ${detail}` : ""}`);
}
function observed<T>(observation: GitObservation<T>, what: string): T {
  if (observation.kind === "present") return observation.value;
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN",
    `${what}: ${observation.kind}${observation.kind === "absent" ? "" : ` (${observation.reason})`}`);
}
function git(dir: string, args: string[]): SpawnSyncReturns<string> {
  const result = spawnSync(GIT_BIN, args, { cwd: dir, env: gitEnv, encoding: "utf8" });
  if (gitUncertain(result) || result.status !== 0)
    throw new StoreError("INTERNAL_ERROR", `git ${args[0] ?? "?"} failed: ${result.error?.message ?? (result.stderr ?? "").slice(0, 400)}`);
  return result;
}
function sha256Of(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

export class GitModule {
  private readonly integrationCoordinator: IntegrationCoordinator;
  private readonly submissionCoordinator: SubmitCoordinator;
  private readonly quarantine: QuarantineImporter;
  private integrationTail: Promise<void> = Promise.resolve();
  private readonly observations = new GitObserver((args, input) => {
    const format = args.includes("--show-object-format");
    const commit = args.includes("--batch-check=%(objecttype)");
    const result = spawnSync(GIT_BIN, [...args], {
      env: gitEnv, timeout: format ? 30000 : commit ? 10000 : 120000,
      maxBuffer: format ? 1024 : commit ? 64 * 1024 : 4 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
    });
    return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
      ...(result.error === undefined ? {} : { error: result.error }) };
  });
  constructor(
    private readonly paths: GitPaths, private readonly store: Store, private readonly mail: MailModule,
    integration: IntegrationPolicy | null = null,
    policyRevisionReader: PolicyRevisionReader | null = null,
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
  }
  private repositoryExists(repository: string): boolean {
    try {
      const stat = lstatSync(repository);
      if (!stat.isDirectory()) throw new StoreError("REF_STATE_UNKNOWN", "repository root is not a directory");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      if (error instanceof StoreError) throw error;
      throw new StoreError("REF_STATE_UNKNOWN", "repository root observation unavailable");
    }
  }
  private objectFormat(repo: string, oids: readonly string[] = []): "sha1" | "sha256" {
    const format = observed(this.observations.objectFormat(repo), "repository object format");
    if (oids.some(oid => !isValidFullOid(oid) || oid.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", `OID does not match repository object format ${format}`);
    return format;
  }
  /** Every CAS, including exit zero, gets a new canonical observation. */
  private casRef(repository: string, ref: string, candidate: string, expected: string | null): RefAfterCas {
    spawnSync(GIT_BIN, ["--git-dir", repository, "update-ref", ref, candidate, expected ?? ""], { env: gitEnv, encoding: "utf8" });
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
  isPublished(oid: Oid): boolean {
    return observed(this.observations.published(this.paths.projectGit), "published refs").includes(oid);
  }
  private currentMain(): Oid {
    return observed(this.observations.ref(this.paths.projectGit, "refs/heads/main"), "canonical main ref");
  }
  private async runCheck(_candidate: Oid, _check: FrozenCheck): Promise<void> {
    throw new StoreError("SPIKE_UNRESOLVED", "S-01-CANDIDATE bounded writable work area is not verified");
  }
  async publishContext(auth: AuthContext, key: string, input: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor }, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    const previous = this.integrationTail; let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.publishContextUnsafe(auth, key, input, bytes); } finally { release?.(); }
  }
  private async publishContextUnsafe(auth: AuthContext, key: string, input: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor }, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    const newHash = requestHash("context.publish", { expected: input.expected, entries: input.entries as unknown as Json, content: input.content as unknown as Json });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const manifestError = contextEntriesCheck(input.entries, { requireSorted: true, contentBytes: input.content.bytes });
    if (manifestError) throw new StoreError("INVALID_REQUEST", manifestError);
    const current = this.currentContext();
    if (current !== input.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed");
    if (this.repositoryExists(this.paths.contextGit)) this.objectFormat(this.paths.contextGit, input.expected ? [input.expected] : []);
    const streamParts: Buffer[] = []; let total = 0;
    for await (const chunk of bytes) {
      total += chunk.length;
      if (total > input.content.bytes) throw new StoreError("STREAM_INVALID", "context exceeds descriptor bytes");
      streamParts.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(streamParts);
    if (content.length !== input.content.bytes || sha256Of(content) !== input.content.sha256) throw new StoreError("STREAM_INVALID", "context digest/bytes mismatch");
    let verifyOffset = 0;
    for (const entry of input.entries) {
      const data = content.subarray(verifyOffset, verifyOffset + entry.bytes);
      const invalid = contextFileCheck(entry.path, data);
      if (invalid) throw new StoreError("INVALID_REQUEST", `${invalid}: ${entry.path}`);
      if (sha256Of(data) !== entry.sha256) throw new StoreError("STREAM_INVALID", `context file digest mismatch: ${entry.path}`);
      verifyOffset += entry.bytes;
    }
    const opId = generateOperationId(); const staging = contextStagingPathAt(this.paths.stateRoot, opId);
    const treeDir = join(staging, "tree"); ensureDurableDirectory(treeDir); assertContextDirectory(treeDir);
    let offset = 0;
    for (const entry of input.entries) {
      const data = content.subarray(offset, offset + entry.bytes); offset += entry.bytes;
      const absolute = join(treeDir, entry.path); const parent = join(absolute, "..");
      ensureDurableDirectory(parent); assertContextDirectory(parent);
      const fd = openSync(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    }
    fsyncAll(treeDir);
    const candidate = this.prepareContextCandidate(treeDir, input.entries, current);
    const messageId = generateMessageId(opId, 0); const eml = await this.contextEml(auth.actor, messageId, candidate);
    this.mail.freezeObject(messageId, eml);
    const plan = { kind: "context.publish" as const, base: current, candidate, target: "refs/heads/main" as const, entries: input.entries, stagingPath: staging,
      message: { id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes,
        dateMs: eml.dateMs, to: ["residents"] as Address[], recipients: [] as Actor[], kind: "context" as const,
        contextRevision: candidate, replyHeaders: { replyTo: ["residents"] as Address[], inReplyTo: null, references: [] } } };
    const outcome = { claim: "inserted" as "inserted" | "retry" };
    this.store.transaction(() => {
      assertCurrentActor(this.store, auth, "context.publish");
      plan.message.recipients = expandAddresses(this.store, ["residents"], this.paths.society).recipients;
      outcome.claim = this.store.claimOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: newHash, kind: "context.publish", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
      if (outcome.claim === "retry") return;
      this.store.insertDeliveries(plan.message.recipients.map(recipient => ({ messageId, recipient, operationId: opId })));
    });
    if (outcome.claim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    this.commitContext(opId);
    if (this.currentContext() !== candidate) throw new StoreError("REF_STATE_UNKNOWN", "context main does not match frozen candidate");
    await this.mail.publishGated(opId);
    const result = { kind: "context.publish" as const, previous: current, revision: candidate, message: messageId, recipientCount: plan.message.recipients.length };
    this.store.transaction(() => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
    return receiptOf(this.store.getOperationById(opId)!);
  }
  private prepareContextCandidate(treeDir: string, entries: ContextEntry[], expected: Oid | null): Oid {
    const invalid = contextEntriesCheck(entries, { requireSorted: true });
    if (invalid) throw new StoreError("STORE_CORRUPT", invalid);
    assertContextDirectory(treeDir);
    for (const entry of entries) readContextEntry(treeDir, entry);
    if (!this.repositoryExists(this.paths.contextGit)) {
      ensureDurableDirectory(this.paths.contextGit);
      git(this.paths.contextGit, ["--git-dir", this.paths.contextGit, "init", "--bare"]);
    }
    const contextFormat = this.objectFormat(this.paths.contextGit, expected ? [expected] : []);
    const work = join(treeDir, "..", "commit-work"); ensureDurableDirectory(work); assertContextDirectory(work);
    const gitdir = join(work, ".git");
    const contextEnv: NodeJS.ProcessEnv = {
      ...gitEnv, GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "broker@oma.invalid", GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "broker@oma.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      GIT_CONFIG_COUNT: "8", GIT_CONFIG_KEY_3: "core.autocrlf", GIT_CONFIG_VALUE_3: "false",
      GIT_CONFIG_KEY_4: "commit.gpgSign", GIT_CONFIG_VALUE_4: "false", GIT_CONFIG_KEY_5: "user.signingKey", GIT_CONFIG_VALUE_5: "",
      GIT_CONFIG_KEY_6: "core.fileMode", GIT_CONFIG_VALUE_6: "false", GIT_CONFIG_KEY_7: "core.excludesFile", GIT_CONFIG_VALUE_7: "/dev/null",
    };
    const run = (args: string[]) => {
      const result = spawnSync(GIT_BIN, args, { env: contextEnv, encoding: "utf8" });
      if (gitUncertain(result) || result.status !== 0) throw new StoreError("INTERNAL_ERROR", `context git failed: ${result.error?.message ?? result.stderr.slice(0, 300)}`);
      return result;
    };
    run(["-C", work, "init", "-q", `--object-format=${contextFormat}`]);
    if (expected) { run(["-C", work, "fetch", "--no-tags", this.paths.contextGit, "refs/heads/main"]); run(["-C", work, "checkout", "--detach", "FETCH_HEAD"]); }
    for (const entry of entries) {
      const data = readContextEntry(treeDir, entry);
      const destination = join(work, entry.path); const parent = join(destination, "..");
      ensureDurableDirectory(parent); assertContextDirectory(parent);
      const existing = lstatSync(destination, { throwIfNoEntry: false });
      if (existing && !existing.isFile()) throw new StoreError("STORE_CORRUPT", `context work entry is not regular: ${entry.path}`);
      const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    }
    this.cleanContextExtras(work, entries.map(entry => entry.path));
    run(["-C", work, "add", "-f", "-A"]);
    const committed = spawnSync(GIT_BIN, ["-C", work, "commit", "-q", "--no-gpg-sign", "-m", "context"], { env: contextEnv, encoding: "utf8" });
    if (gitUncertain(committed)) throw gitObservationError("context commit", committed);
    if (committed.status !== 0) {
      const unchanged = spawnSync(GIT_BIN, ["-C", work, "diff", "--cached", "--quiet"], { env: contextEnv, encoding: "utf8" });
      if (gitUncertain(unchanged) || unchanged.status !== 0) throw new StoreError("INTERNAL_ERROR", `context commit failed: ${committed.stderr.slice(0, 300)}`);
    }
    return observed(this.observations.ref(gitdir, "HEAD"), "context candidate");
  }
  private async contextEml(actor: Actor, messageId: string, candidate: Oid) {
    const residents = listAddress("residents", this.paths.society);
    return buildEml({ from: actorAddress(actor, this.paths.society), to: [residents], replyTo: [residents],
      subject: "Shared context updated", kind: "context", contextRevision: candidate, inReplyTo: null, references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`, body: `Revision: ${candidate}\n${contextRevisionDisplayPath(candidate)}/GOAL.md\n참고: /world/context/current\n` });
  }
  private commitContext(opId: string): Oid {
    const accepted = this.store.getOperationById(opId);
    if (!accepted || accepted.kind !== "context.publish") throw new StoreError("STORE_CORRUPT", "context operation missing before publication");
    const plan = accepted.plan;
    const work = join(plan.stagingPath, "commit-work"); assertContextDirectory(work);
    const candidate = observed(this.observations.ref(join(work, ".git"), "HEAD"), "staged context candidate");
    if (candidate !== plan.candidate) throw new StoreError("STORE_CORRUPT", "staged context candidate differs from accepted plan");
    git(this.paths.contextGit, ["--git-dir", this.paths.contextGit, "fetch", "--no-tags", work, "HEAD"]);
    const after = this.casRef(this.paths.contextGit, plan.target, candidate, plan.base);
    if (after.kind !== "candidate") {
      this.store.transaction(() => this.store.setOperationUnknown(opId));
      throw new StoreError("REF_STATE_UNKNOWN", `context CAS observation: ${after.kind}`);
    }
    this.publishContextSnapshot(plan, work);
    return candidate;
  }
  private publishContextSnapshot(plan: ValidatedPlan<"context.publish">, source: string): void {
    this.publishSnapshotFiles(plan.candidate, plan.entries, source);
  }
  private publishSnapshotFiles(candidate: Oid, entries: ContextEntry[], source: string): void {
    publishContextRevision(this.paths.worldDir, candidate, entries, source);
  }
  private cleanContextExtras(root: string, keep: string[], relative = ""): void {
    assertContextDirectory(join(root, relative));
    for (const entry of readdirSync(join(root, relative))) {
      if (relative === "" && entry === ".git") continue;
      const path = relative ? `${relative}/${entry}` : entry; const absolute = join(root, path);
      if (lstatSync(absolute).isDirectory()) {
        this.cleanContextExtras(root, keep, path);
        if (!keep.some(key => key.startsWith(`${path}/`))) rmSync(absolute, { recursive: true, force: true });
      } else if (!keep.includes(path)) rmSync(absolute, { force: true });
    }
  }
  repairContextMirror(): void {
    const revision = this.currentContext(); if (!revision) return;
    const immutable = contextRevisionPathAt(this.paths.worldDir, revision);
    if (!existsSync(immutable)) throw new StoreError("REF_STATE_UNKNOWN", `immutable context revision ${revision} missing; reconcile accepted context first`);
    assertContextDirectory(immutable);
    const listing = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "ls-tree", "-r", "-z", "--full-tree", revision], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(listing) || listing.status !== 0) throw gitObservationError("context revision tree", listing);
    const entries: ContextEntry[] = []; const expected = new Map<string, string>();
    for (const line of listing.stdout.split("\0").filter(Boolean)) {
      const match = /^(100644) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/.exec(line);
      if (!match || contextPathCheck(match[3])) throw new StoreError("STORE_CORRUPT", "context canonical tree contains an unsupported entry");
      expected.set(match[3]!, match[2]!);
    }
    if (!expected.has("GOAL.md")) throw new StoreError("STORE_CORRUPT", "context canonical tree has no GOAL.md");
    const seen = new Set<string>();
    const verify = (relative = ""): void => {
      assertContextDirectory(join(immutable, relative));
      for (const name of readdirSync(join(immutable, relative))) {
        const path = relative ? `${relative}/${name}` : name; const absolute = join(immutable, path); const stat = lstatSync(absolute);
        if (stat.isDirectory() && path === "decisions" && [...expected.keys()].some(key => key.startsWith("decisions/"))) { verify(path); continue; }
        if (!stat.isFile() || !expected.has(path)) throw new StoreError("STORE_CORRUPT", `unexpected context mirror entry ${path}`);
        const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes: Buffer;
        try { bytes = readFileSync(fd); } finally { closeSync(fd); }
        if (contextFileCheck(path, bytes)) throw new StoreError("STORE_CORRUPT", `context mirror policy mismatch ${path}`);
        const canonical = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "hash-object", "--stdin"], { input: bytes, env: gitEnv, encoding: "utf8" });
        if (gitUncertain(canonical) || canonical.status !== 0) throw gitObservationError("context mirror object hash", canonical);
        if (canonical.stdout.trim() !== expected.get(path)) throw new StoreError("STORE_CORRUPT", `context mirror bytes differ from canonical revision: ${path}`);
        seen.add(path); entries.push({ path, bytes: bytes.length, sha256: sha256Of(bytes) });
      }
    };
    verify();
    if (seen.size !== expected.size) throw new StoreError("STORE_CORRUPT", "context mirror is incomplete");
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    this.publishSnapshotFiles(revision, entries, immutable);
  }
  private async reconcileContext(op: OperationOf<"context.publish">): Promise<void> {
    const plan = op.plan; const treeDir = join(plan.stagingPath, "tree"); const main = this.currentContext();
    if (main !== plan.candidate && main !== plan.base) { this.store.transaction(() => this.store.setOperationUnknown(op.id)); return; }
    if (main !== plan.candidate) {
      assertContextDirectory(treeDir);
      const rebuilt = this.prepareContextCandidate(treeDir, plan.entries, plan.base);
      if (rebuilt !== plan.candidate) throw new StoreError("STORE_CORRUPT", "accepted context candidate cannot be reproduced");
      const haveCandidate = this.observations.commit(this.paths.contextGit, plan.candidate);
      if (haveCandidate.kind === "absent") {
        const work = join(plan.stagingPath, "commit-work");
        const fetched = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "fetch", "--no-tags", work, "HEAD"], { env: gitEnv, encoding: "utf8" });
        if (gitUncertain(fetched) || fetched.status !== 0) throw new StoreError("REF_STATE_UNKNOWN", "context candidate cannot be recovered");
      } else observed(haveCandidate, "context candidate");
      const after = this.casRef(this.paths.contextGit, plan.target, plan.candidate, plan.base);
      if (after.kind !== "candidate") { this.store.transaction(() => this.store.setOperationUnknown(op.id)); return; }
    }
    this.publishContextSnapshot(plan, join(plan.stagingPath, "commit-work"));
    if (this.currentContext() !== plan.candidate) { this.store.transaction(() => this.store.setOperationUnknown(op.id)); return; }
    const result = { kind: "context.publish" as const, previous: plan.base, revision: plan.candidate, message: plan.message.id, recipientCount: plan.message.recipients.length };
    await this.mail.publishGated(op.id);
    this.store.transaction(() => this.store.setOperationSucceeded(op.id, JSON.stringify(result)));
  }
  private currentContext(): Oid | null {
    if (!this.repositoryExists(this.paths.contextGit)) return null;
    const value = this.observations.ref(this.paths.contextGit, "refs/heads/main");
    return value.kind === "absent" ? null : observed(value, "context main ref");
  }
  async reconcile(operationId: string): Promise<void> {
    const previous = this.integrationTail; let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { await this.reconcileUnsafe(operationId); } finally { release?.(); }
  }
  private async reconcileUnsafe(operationId: string): Promise<void> {
    const operation = this.store.getOperationById(operationId);
    if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) return;
    switch (operation.kind) {
      case "git.integrate": await this.integrationCoordinator.reconcile(operation); return;
      case "context.publish": await this.reconcileContext(operation); return;
      case "git.submit": await this.submissionCoordinator.reconcile(operation); return;
      default: return;
    }
  }
  knownRefs(): { main: string; published: string[] } {
    const main = this.currentMain();
    return { main, published: [...observed(this.observations.published(this.paths.projectGit), "known published refs")] };
  }
}
function fsyncAll(dir: string): void { fsyncTree(dir, "context-single-link"); }
