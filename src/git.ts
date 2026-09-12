// MUST [GIT-001..009]/[INT-001..005]/[CTX-001..006]: broker-owned Git boundary.
// Unresolved sandbox primitives fail closed; no bundle parsing on the host.
import {
  constants, mkdirSync, mkdtempSync, writeFileSync, existsSync, openSync,
  fsyncSync, closeSync, renameSync, symlinkSync, readdirSync, statSync,
  lstatSync, chmodSync, rmSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync as nodeSpawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import type { Actor, Address, AuthContext, BlobDescriptor, ContextEntry, Json, Oid, Receipt, ResourceLimits } from "../implementation/contracts.js";
import { Store, reused } from "./store.js";
import { StoreError, classifyError } from "./domain/errors.js";
import { receiptOfOperation as receiptOf } from "./protocol/receipts.js";
import { MailModule, buildEml, expandAddresses, fsyncDir, defaultReplyTo, defaultLogicalReplyTo, actorAddress, listAddress } from "./mail.js";
import { generateOperationId, generateMessageId, isValidFullOid } from "./ids.js";
import { publishedRefFor, mailObjectRelativePath, contextRevisionDisplayPath, contextRevisionLinkFor } from "./domain/derived.js";
import { submitStagingPathAt, submitBundlePathAt, contextStagingPathAt, contextRevisionPathAt } from "./storage/paths.js";
import { requestHash, canonicalRequestParams, canonicalJson, sha256Hex } from "./hash.js";
import { capabilitiesOf, assertCurrentActor } from "./authority.js";
import { contextFileCheck, contextPathCheck } from "./validate.js";

export interface GitPaths {
  stateRoot: string;
  projectGit: string;
  contextGit: string;
  worldDir: string;
  society: string;
  quarantineTmpBytes: number;
  quarantineResources?: { cpuSeconds: number; memoryBytes: number; tasks: number };
  checkTimeoutSeconds: number;
  checkRootfs?: string;
  checkAssetsDir?: string;
  checkTmpBytes?: number;
}
export interface CheckProfile { argv: string[]; env: Record<string, string> }
const GIT_BIN = "/usr/bin/git";
const spawnSync: typeof nodeSpawnSync = ((command: string, args?: readonly string[], options?: object) =>
  nodeSpawnSync(command, args ? [...args] : [], {
    timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, ...(options ?? {}),
  } as never)) as typeof nodeSpawnSync;

/** GIT-001: fixed, broker-owned environment. */
export const gitEnv: NodeJS.ProcessEnv = {
  HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsync", GIT_CONFIG_VALUE_1: "all",
  GIT_CONFIG_KEY_2: "core.fsyncMethod", GIT_CONFIG_VALUE_2: "fsync",
};
function gitUncertain(result: { error?: Error; signal: NodeJS.Signals | null; status: number | null }): boolean {
  return Boolean(result.error) || result.signal !== null || result.status === null;
}
function gitObservationError(what: string, result: { error?: Error; signal: NodeJS.Signals | null; status: number | null; stderr?: string | Buffer | null }): StoreError {
  const detail = result.error?.message ?? (result.signal ? `signal ${result.signal}` : String(result.stderr ?? "").slice(0, 300));
  return new StoreError("REF_STATE_UNKNOWN", `${what} unavailable${detail ? `: ${detail}` : ""}`);
}
function git(dir: string, args: string[]): SpawnSyncReturns<string> {
  const result = spawnSync(GIT_BIN, args, { cwd: dir, env: gitEnv, encoding: "utf8" });
  if (gitUncertain(result) || result.status !== 0)
    throw new StoreError("INTERNAL_ERROR", `git ${args[0] ?? "?"} failed: ${result.error?.message ?? (result.stderr ?? "").slice(0, 400)}`);
  return result;
}
function sha256Of(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function checkDigest(checks: readonly IntegrationPolicy["checks"][number][]): string {
  return sha256Hex(canonicalJson(checks));
}
export interface IntegrationPolicy {
  policyRevision: string;
  protectedPaths: string[];
  checks: Array<{
    id: string; argv: string[]; env: Record<string, string>; timeoutSeconds: number;
    tmpBytes?: number; resources?: ResourceLimits;
  }>;
}
export type PolicyRevisionReader = () => string;
const EMPTY_INTEGRATION_POLICY: IntegrationPolicy = { policyRevision: "p1", protectedPaths: [], checks: [] };

export class GitModule {
  private readonly integration: IntegrationPolicy;
  private readonly legacyDirect: boolean;
  private readonly policyRevisionReader: PolicyRevisionReader | null;
  private integrationTail: Promise<void> = Promise.resolve();
  constructor(
    private readonly paths: GitPaths,
    private readonly store: Store,
    private readonly mail: MailModule,
    integration: IntegrationPolicy | null = EMPTY_INTEGRATION_POLICY,
    policyRevisionReader: PolicyRevisionReader | null = null,
  ) {
    this.legacyDirect = integration === null;
    this.integration = integration ?? EMPTY_INTEGRATION_POLICY;
    this.policyRevisionReader = policyRevisionReader;
  }
  private objectFormat(repo: string, oids: readonly string[] = []): "sha1" | "sha256" {
    const observed = spawnSync(GIT_BIN, ["--git-dir", repo, "rev-parse", "--show-object-format"],
      { env: gitEnv, encoding: "utf8", timeout: 30000, maxBuffer: 1024 });
    const format = String(observed.stdout ?? "").trim();
    if (gitUncertain(observed) || observed.status !== 0 || (format !== "sha1" && format !== "sha256"))
      throw new StoreError("INTERNAL_ERROR", "cannot observe repository object format");
    if (oids.some(oid => !isValidFullOid(oid) || oid.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", `OID does not match repository object format ${format}`);
    return format;
  }

  /** Only confirmed pre-publication rejection is eligible for a failed transition.
   * Accepted staged-byte damage is a broker-owned corruption, not client retry input.
   */
  private rejectAcceptedSubmit(operation: string, error: StoreError, phase: "accepted" | "recovering"): never {
    const policy = classifyError({
      code: error.code, phase, effectKnowledge: "none",
      observationKind: error.code === "STREAM_INVALID" ? "corrupt" : "rejected",
    });
    if (policy.terminal === "failed")
      this.store.transaction(() => this.store.setOperationFailed(operation, policy.code));
    if (policy.terminal === "unknown")
      this.store.transaction(() => this.store.setOperationUnknown(operation));
    if (policy.code !== error.code) throw new StoreError(policy.code, "accepted submit artifact failed integrity validation");
    throw error;
  }

  async submit(
    auth: AuthContext, key: string,
    input: { candidate: Oid; exportRef: string; prerequisites: Oid[]; to: string[]; subject: string; body: string; paths: string[]; bundle?: BlobDescriptor },
    bytes: AsyncIterable<Uint8Array>,
  ): Promise<Receipt> {
    const newHash = requestHash("git.submit", canonicalRequestParams("git.submit", input));
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    this.objectFormat(this.paths.projectGit, [input.candidate, ...input.prerequisites]);
    const opId = generateOperationId();
    const messageId = generateMessageId(opId, 0);
    const staging = submitStagingPathAt(this.paths.stateRoot, opId);
    mkdirSync(staging, { recursive: true });
    const bundlePath = submitBundlePathAt(this.paths.stateRoot, opId);
    let digest: string | null = null;
    if (input.bundle) {
      const hash = createHash("sha256");
      const out = openSync(bundlePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        let total = 0;
        for await (const chunk of bytes) {
          total += chunk.length;
          if (total > input.bundle.bytes) throw new StoreError("STREAM_INVALID", "bundle exceeds descriptor bytes");
          hash.update(chunk);
          writeFileSync(out, chunk);
        }
        fsyncSync(out);
      } finally { closeSync(out); }
      digest = hash.digest("hex");
      if (digest !== input.bundle.sha256) throw new StoreError("STREAM_INVALID", "bundle digest mismatch");
      if (!input.bundle.bytes || statBytes(bundlePath) !== input.bundle.bytes)
        throw new StoreError("STREAM_INVALID", "bundle byte count mismatch");
    }
    fsyncDir(staging);
    fsyncDir(join(this.paths.stateRoot, "staging"));
    const targetAddresses = (input.to.length > 0 ? input.to : ["commons"]) as Address[];
    const logicalTo = [...new Set(targetAddresses)].sort() as Address[];
    const route = expandAddresses(this.store, logicalTo, this.paths.society);
    const publishedRef = publishedRefFor(auth.actor, opId);
    const eml = await this.resultEml(auth.actor, {
      candidate: input.candidate, subject: input.subject, body: input.body, paths: input.paths,
      to: route.displayTo, publishedRef,
    }, messageId);
    const plan = {
      kind: "git.submit" as const, candidate: input.candidate, exportRef: input.exportRef,
      prerequisites: input.prerequisites,
      bundle: input.bundle ? { path: bundlePath, sha256: digest!, bytes: input.bundle.bytes } : null,
      publishedRef,
      message: {
        id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes,
        dateMs: eml.dateMs, to: logicalTo, recipients: route.recipients, kind: "result" as const,
        contextRevision: null,
        replyHeaders: { replyTo: defaultLogicalReplyTo(auth.actor, logicalTo), inReplyTo: null, references: [] },
      },
    };
    this.mail.freezeObject(messageId, eml);
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction(() => {
      assertCurrentActor(this.store, auth, "git.submit");
      claimOut.txClaim = this.store.claimOperation({
        id: opId, actor: auth.actor, requestKey: key, requestHash: newHash, kind: "git.submit",
        payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan),
      });
      if (claimOut.txClaim === "retry") return;
      route.recipients = expandAddresses(this.store, logicalTo, this.paths.society).recipients;
      plan.message.recipients = route.recipients;
      this.store.updateOperationPlanJson(opId, JSON.stringify(plan));
      this.store.insertDeliveries(route.recipients.map(recipient => ({ messageId, recipient, operationId: opId })));
    });
    if (claimOut.txClaim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    const result = {
      kind: "git.submit" as const, candidate: input.candidate, publishedRef: plan.publishedRef,
      message: messageId, recipientCount: route.recipients.length,
    };
    try {
      if (input.bundle) this.quarantineImport(bundlePath, input.candidate, input.exportRef, input.prerequisites);
      else if (!this.canonicalHas(input.candidate))
        throw new StoreError("PREREQUISITE_MISSING", "no bundle and candidate unknown to the broker");
      this.publishRef(plan.publishedRef, input.candidate);
      await this.mail.publishGated(opId);
      this.store.transaction(() => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
    } catch (error) {
      if (error instanceof StoreError && [
        "PUBLISHED_REF_CONFLICT", "BUNDLE_INVALID", "PREREQUISITE_MISSING", "INVALID_OID", "STREAM_INVALID", "SPIKE_UNRESOLVED",
      ].includes(error.code)) this.rejectAcceptedSubmit(opId, error, "accepted");
      throw error;
    }
    return receiptOf(this.store.getOperationById(opId)!);
  }

  private async resultEml(actor: Actor, result: {
    candidate: Oid; subject: string; body: string; paths: string[]; to: string[]; publishedRef: string;
  }, messageId: string): Promise<{ text: string; bytes: number; sha256: string; dateMs: number }> {
    const fetchHint = `git fetch origin ${result.publishedRef}; git show FETCH_HEAD\n`;
    const bodyText = `${result.body}\n\n게시됨: ${result.publishedRef}\nCommit: ${result.candidate}\n${result.paths.length > 0 ? `경로: ${result.paths.join(", ")}\n` : ""}${fetchHint}`;
    const eml = await buildEml({
      from: `${actor}@${this.paths.society}.oma.invalid`, to: result.to,
      replyTo: defaultReplyTo(actorAddress(actor, this.paths.society), result.to),
      subject: result.subject, kind: "result", contextRevision: null, inReplyTo: null, references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`, body: bodyText,
    });
    return { text: eml.text, bytes: eml.bytes, sha256: eml.sha256, dateMs: eml.dateMs };
  }
  private canonicalHas(oid: string): boolean {
    const expression = `${oid}^{commit}`;
    const result = spawnSync("git", ["--git-dir", this.paths.projectGit, "cat-file", "--batch-check=%(objecttype)"],
      { env: gitEnv, encoding: "utf8", input: `${expression}\n`, timeout: 10000, maxBuffer: 64 * 1024 });
    if (gitUncertain(result)) throw gitObservationError("canonical commit observation", result);
    if (result.status === 0 && !result.stderr) {
      if (result.stdout.trim() === "commit") return true;
      if (result.stdout.trim() === `${expression} missing`) return false;
    }
    throw new StoreError("REF_STATE_UNKNOWN", "cannot observe canonical commit");
  }

  /** MUST [GIT-006/007]/[S-05]: disposable namespace with bounded resources. */
  private quarantineImport(bundlePath: string, candidate: Oid, exportRef: string, prerequisites: Oid[]): void {
    const limits = this.paths.quarantineResources;
    if (!limits || !Number.isSafeInteger(limits.cpuSeconds) || limits.cpuSeconds <= 0 ||
      !Number.isSafeInteger(limits.memoryBytes) || limits.memoryBytes <= 0 ||
      !Number.isSafeInteger(limits.tasks) || limits.tasks <= 0 ||
      !Number.isSafeInteger(this.paths.quarantineTmpBytes) || this.paths.quarantineTmpBytes <= 0)
      throw new StoreError("SPIKE_UNRESOLVED", "quarantine resource profile is unavailable");
    const namespaceRoot = mkdtempSync(join(this.paths.stateRoot, "staging", "quarantine-ns-"));
    const script = [
      "set -eu",
      "bundle=$1; project=$2; candidate=$3; export_ref=$4; tmp_bytes=$5; shift 5",
      "root=$1; shift",
      "git=/usr/bin/git",
      "fail_spike() { echo OMA_ERROR=SPIKE_UNRESOLVED >&2; exit 70; }",
      "fail_bundle() { echo OMA_ERROR=BUNDLE_INVALID >&2; exit 71; }",
      "fail_prereq() { echo OMA_ERROR=PREREQUISITE_MISSING >&2; exit 72; }",
      "fail_internal() { echo OMA_ERROR=INTERNAL_ERROR >&2; exit 73; }",
      "mount --make-rprivate / || fail_spike",
      "mkdir -p \"$root/project\" \"$root/bundle\" \"$root/quarantine\"",
      "touch \"$root/bundle/input.bundle\"",
      "cleanup() { umount \"$root/project\" 2>/dev/null || true; umount \"$root/bundle/input.bundle\" 2>/dev/null || true; umount \"$root/quarantine\" 2>/dev/null || true; rmdir \"$root/project\" \"$root/bundle\" \"$root/quarantine\" \"$root/hooks\" \"$root\" 2>/dev/null || true; }",
      "trap cleanup EXIT",
      "mount --bind \"$project\" \"$root/project\" || fail_spike",
      "mount -o remount,bind,ro \"$root/project\" || fail_spike",
      "mount --bind \"$bundle\" \"$root/bundle/input.bundle\" || fail_spike",
      "mount -o remount,bind,ro \"$root/bundle/input.bundle\" || fail_spike",
      "mount -t tmpfs -o size=\"$tmp_bytes\" tmpfs \"$root/quarantine\" || fail_spike",
      "mkdir -p \"$root/quarantine/tmp\"",
      "export TMPDIR=\"$root/quarantine/tmp\"",
      "mkdir -p \"$root/hooks\"",
      "export GIT_CONFIG_VALUE_0=\"$root/hooks\"",
      "repo=\"$root/quarantine/repo\"",
      "format=$($git --git-dir=\"$root/project\" rev-parse --show-object-format) || fail_internal",
      "$git --git-dir=\"$repo\" init -q --bare --object-format=\"$format\" >/dev/null 2>&1 || fail_spike",
      "mkdir -p \"$repo/objects/info\"",
      "printf '%s\\n' \"$root/project/objects\" > \"$repo/objects/info/alternates\"",
      "$git --git-dir=\"$repo\" bundle verify \"$root/bundle/input.bundle\" >/dev/null 2>&1 || fail_bundle",
      "heads=$($git --git-dir=\"$repo\" bundle list-heads \"$root/bundle/input.bundle\" 2>/dev/null) || fail_bundle",
      "count=0; head_ref=''",
      "while IFS= read -r line; do [ -z \"$line\" ] && continue; count=$((count + 1)); head_ref=${line##* }; done <<EOF",
      "$heads",
      "EOF",
      "[ \"$count\" -eq 1 ] && [ \"$head_ref\" = \"$export_ref\" ] || fail_bundle",
      "refspec=\"$export_ref:refs/oma/input\"",
      "$git --git-dir=\"$repo\" fetch -q --no-tags \"$root/bundle/input.bundle\" \"$refspec\" >/dev/null 2>&1 || fail_bundle",
      "input=$($git --git-dir=\"$repo\" rev-parse refs/oma/input 2>/dev/null) || fail_bundle",
      "[ \"$input\" = \"$candidate\" ] || fail_bundle",
      "$git --git-dir=\"$repo\" fsck --strict --no-reflogs >/dev/null 2>&1 || fail_bundle",
      "for prerequisite in \"$@\"; do $git --git-dir=\"$repo\" cat-file -e \"$prerequisite^{commit}\" >/dev/null 2>&1 || fail_prereq; done",
      "mount -o remount,bind,rw \"$root/project\" || fail_spike",
      "$git --git-dir=\"$root/project\" fetch -q -f --no-tags \"$repo\" +refs/oma/input:refs/oma/input >/dev/null 2>&1 || fail_internal",
      "printf '%s\\n' \"$input\"",
    ].join("\n");
    try {
      const result = spawnSync("/usr/bin/prlimit", [
        `--cpu=${limits.cpuSeconds}`, `--as=${limits.memoryBytes}`, `--nproc=${limits.tasks}`, "--",
        "/usr/bin/env", "-i", "HOME=/nonexistent", "PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TMPDIR=/nonexistent",
        "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
        "GIT_TERMINAL_PROMPT=0", "GIT_NO_REPLACE_OBJECTS=1", "GIT_CONFIG_COUNT=3",
        "GIT_CONFIG_KEY_0=core.hooksPath", "GIT_CONFIG_KEY_1=core.fsync", "GIT_CONFIG_KEY_2=core.fsyncMethod",
        "GIT_CONFIG_VALUE_0=/dev/null", "GIT_CONFIG_VALUE_1=all", "GIT_CONFIG_VALUE_2=fsync",
        "/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--pid", "--net", "--fork",
        "--kill-child=SIGKILL", "--forward-signals", "--mount-proc", "/bin/sh", "-c", script, "oma-quarantine",
        bundlePath, this.paths.projectGit, candidate, exportRef, String(this.paths.quarantineTmpBytes), namespaceRoot, ...prerequisites,
      ], {
        encoding: "utf8", timeout: Math.max(1000, this.paths.checkTimeoutSeconds * 1000),
        killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, env: gitEnv,
      });
      if (result.error || result.signal || result.status === null)
        throw new StoreError("REF_STATE_UNKNOWN", `quarantine import outcome unavailable: ${result.error?.message ?? result.signal ?? "no status"}`);
      if (result.status !== 0) {
        const stderr = String(result.stderr ?? "");
        const code = /OMA_ERROR=(BUNDLE_INVALID|PREREQUISITE_MISSING|INTERNAL_ERROR|SPIKE_UNRESOLVED)/.exec(stderr)?.[1];
        if (code === "BUNDLE_INVALID" || code === "PREREQUISITE_MISSING" || code === "INTERNAL_ERROR" || code === "SPIKE_UNRESOLVED")
          throw new StoreError(code, stderr.slice(0, 400) || "quarantine failed");
        throw new StoreError("SPIKE_UNRESOLVED", "required quarantine namespace is unavailable");
      }
      const head = String(result.stdout ?? "").trim().split("\n").at(-1);
      if (head !== candidate || !this.canonicalHas(candidate))
        throw new StoreError("BUNDLE_INVALID", "bundle candidate was not imported exactly");
    } finally { rmSync(namespaceRoot, { recursive: true, force: true }); }
  }

  private publishRef(ref: string, candidate: Oid): void {
    const current = spawnSync("git", ["--git-dir", this.paths.projectGit, "rev-parse", "--verify", "--quiet", ref], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(current)) throw gitObservationError(`published ref ${ref}`, current);
    if (current.status === 0) {
      if (current.stdout.trim() !== candidate) throw new StoreError("PUBLISHED_REF_CONFLICT", `ref ${ref} already points elsewhere`);
      return;
    }
    if (current.status !== 1 || current.stderr.trim() || current.stdout.trim())
      throw new StoreError("REF_STATE_UNKNOWN", `cannot observe published ref ${ref}`);
    const result = spawnSync("git", ["--git-dir", this.paths.projectGit, "update-ref", ref, candidate, ""], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(result)) throw gitObservationError(`publish ref ${ref}`, result);
    if (result.status !== 0) {
      const after = spawnSync("git", ["--git-dir", this.paths.projectGit, "rev-parse", ref], { env: gitEnv, encoding: "utf8" });
      if (gitUncertain(after)) throw gitObservationError(`published ref ${ref}`, after);
      if (after.status === 0 && after.stdout.trim() === candidate) return;
      if (after.status === 0) throw new StoreError("PUBLISHED_REF_CONFLICT", `CAS publish failed for ${ref}`);
      throw new StoreError("REF_STATE_UNKNOWN", `published ref ${ref} cannot be observed after CAS`);
    }
  }

  async integrate(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid }): Promise<Receipt> {
    const previous = this.integrationTail;
    let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.integrateUnsafe(auth, key, input); }
    finally { release?.(); }
  }
  private async integrateUnsafe(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid }): Promise<Receipt> {
    const { candidate, expected } = input;
    const newHash = requestHash("git.integrate", { candidate, expected });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    this.objectFormat(this.paths.projectGit, [candidate, expected]);
    if (!this.isPublished(candidate)) throw new StoreError("CANDIDATE_NOT_PUBLISHED", `candidate ${candidate} not published`);
    const main = this.currentMain();
    if (main !== expected) throw new StoreError("STALE_BASE", "main differs from expected");
    const opId = generateOperationId();
    const checkProfileDigest = checkDigest(this.integration.checks);
    const policyRevision = this.integration.policyRevision;
    const result = { kind: "git.integrate" as const, base: expected, candidate, target: "refs/heads/main" as const, policyRevision, changed: main !== candidate };
    const plan = { kind: "git.integrate", repo: "project", target: "refs/heads/main", base: expected, candidate, policyRevision, checkProfileDigest, result };
    this.store.transaction(() => this.store.claimOperation({
      id: opId, actor: auth.actor, requestKey: key, requestHash: newHash, kind: "git.integrate",
      payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan),
    }));
    const fail = (code: Parameters<Store["setOperationFailed"]>[1], message: string): never => {
      this.store.transaction(() => this.store.setOperationFailed(opId, code));
      throw new StoreError(code, message);
    };
    if (main === candidate) {
      this.store.transaction(() => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
      return receiptOf(this.store.getOperationById(opId)!);
    }
    const ancestor = spawnSync("git", ["--git-dir", this.paths.projectGit, "merge-base", "--is-ancestor", expected, candidate], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(ancestor) || (ancestor.status !== 0 && ancestor.status !== 1)) throw gitObservationError("merge-base ancestry check", ancestor);
    if (ancestor.status === 1) fail("NOT_DESCENDANT", "candidate is not a descendant of expected");
    if (this.integration.protectedPaths.length > 0) {
      const diff = spawnSync("git", ["--git-dir", this.paths.projectGit, "diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", expected, candidate], { env: gitEnv, encoding: "utf8" });
      if (gitUncertain(diff) || diff.status !== 0) throw gitObservationError("protected-path diff", diff);
      for (const part of (diff.stdout ?? "").split("\0").filter(Boolean)) {
        const name = part.replace(/^[A-Z]\s+/, "");
        if (this.integration.protectedPaths.some(path => path.endsWith("/") ? name.startsWith(path) : name === path))
          fail("PROTECTED_PATH", `path ${name} is protected`);
      }
    }
    try { for (const check of this.integration.checks) await this.runCheck(candidate, check); }
    catch (error) {
      if (error instanceof StoreError && ["CHECK_FAILED", "SPIKE_UNRESOLVED"].includes(error.code))
        this.store.transaction(() => this.store.setOperationFailed(opId, error.code));
      throw error;
    }
    const finalMain = this.currentMain();
    if (finalMain !== expected) fail("STALE_BASE", "main changed before CAS");
    const agent = this.store.getAgent(auth.actor);
    if (!agent && !this.legacyDirect) fail("AUTH_FAILED", "actor identity disappeared");
    if (agent) {
      if (agent.desired === "stopped" || agent.desired === "retired") fail("CANCELLED_BEFORE_COMMIT", "stop/retire intent accepted before CAS");
      if (!capabilitiesOf(agent).has("code.integrate")) fail("CAPABILITY_DENIED", "integrate capability was revoked before CAS");
    }
    let finalRevision = this.integration.policyRevision;
    try { finalRevision = this.policyRevisionReader ? this.policyRevisionReader() : this.integration.policyRevision; }
    catch (error) { fail("POLICY_CHANGED", `authoritative policy unreadable: ${(error as Error).message}`); }
    if (typeof finalRevision !== "string" || finalRevision.length === 0 || finalRevision !== policyRevision)
      fail("POLICY_CHANGED", "policy changed before CAS");
    const cas = spawnSync("git", ["--git-dir", this.paths.projectGit, "update-ref", "refs/heads/main", candidate, expected], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(cas)) throw gitObservationError("main CAS", cas);
    if (cas.status !== 0) fail("STALE_BASE", "CAS failed");
    this.store.transaction(() => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
    return receiptOf(this.store.getOperationById(opId)!);
  }
  isPublished(oid: Oid): boolean {
    const result = spawnSync("git", ["--git-dir", this.paths.projectGit, "for-each-ref", "--format=%(objectname)", "refs/oma/published/"], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(result) || result.status !== 0) throw gitObservationError("published refs", result);
    return (result.stdout ?? "").split("\n").some(line => line.trim() === oid);
  }
  private currentMain(): Oid {
    const result = spawnSync("git", ["--git-dir", this.paths.projectGit, "rev-parse", "refs/heads/main"], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(result)) throw gitObservationError("main ref", result);
    if (result.status !== 0 || !isValidFullOid(result.stdout.trim())) throw new StoreError("REF_STATE_UNKNOWN", "cannot observe canonical main ref");
    return result.stdout.trim();
  }
  private async runCheck(_candidate: Oid, _check: IntegrationPolicy["checks"][number]): Promise<void> {
    // S-01-CANDIDATE remains closed until the bounded writable work area is proven.
    throw new StoreError("SPIKE_UNRESOLVED", "S-01-CANDIDATE bounded writable work area is not verified");
  }

  async publishContext(auth: AuthContext, key: string, input: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor }, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    const previous = this.integrationTail;
    let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.publishContextUnsafe(auth, key, input, bytes); }
    finally { release?.(); }
  }
  private async publishContextUnsafe(auth: AuthContext, key: string, input: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor }, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    const newHash = requestHash("context.publish", {
      expected: input.expected, entries: input.entries as unknown as Json, content: input.content as unknown as Json,
    });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const current = this.currentContext();
    if (current !== input.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed");
    if (existsSync(this.paths.contextGit)) this.objectFormat(this.paths.contextGit, input.expected ? [input.expected] : []);
    const streamParts: Buffer[] = [];
    let total = 0;
    for await (const chunk of bytes) {
      total += chunk.length;
      if (total > input.content.bytes) throw new StoreError("STREAM_INVALID", "context exceeds descriptor bytes");
      streamParts.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(streamParts);
    if (content.length !== input.content.bytes || sha256Of(content) !== input.content.sha256)
      throw new StoreError("STREAM_INVALID", "context digest/bytes mismatch");
    const advertised = input.entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (!Number.isSafeInteger(advertised) || advertised !== content.length)
      throw new StoreError("INVALID_REQUEST", "context entries do not consume content");
    if (!input.entries.some(entry => entry.path === "GOAL.md")) throw new StoreError("INVALID_REQUEST", "GOAL.md is required");
    const seen = new Set<string>();
    let verifyOffset = 0;
    for (const entry of input.entries) {
      const pathError = contextPathCheck(entry.path);
      if (pathError || seen.has(entry.path)) throw new StoreError("INVALID_REQUEST", pathError ?? `duplicate context path ${entry.path}`);
      seen.add(entry.path);
      const invalid = contextFileCheck(entry.path, content.subarray(verifyOffset, verifyOffset + entry.bytes));
      if (invalid) throw new StoreError("INVALID_REQUEST", `${invalid}: ${entry.path}`);
      verifyOffset += entry.bytes;
    }
    const opId = generateOperationId();
    const staging = contextStagingPathAt(this.paths.stateRoot, opId);
    const treeDir = join(staging, "tree");
    mkdirSync(treeDir, { recursive: true });
    let offset = 0;
    for (const entry of input.entries) {
      const data = content.subarray(offset, offset + entry.bytes);
      offset += entry.bytes;
      if (sha256Of(data) !== entry.sha256) throw new StoreError("STREAM_INVALID", `context file digest mismatch: ${entry.path}`);
      const absolute = join(treeDir, entry.path);
      mkdirSync(join(absolute, ".."), { recursive: true });
      const fd = openSync(absolute, "wx", 0o600);
      try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    }
    fsyncAll(treeDir);
    const candidate = this.prepareContextCandidate(treeDir, input.entries, current);
    const messageId = generateMessageId(opId, 0);
    const eml = await this.contextEml(auth.actor, messageId, candidate);
    this.mail.freezeObject(messageId, eml);
    const plan = {
      kind: "context.publish" as const, base: current, candidate, target: "refs/heads/main" as const,
      entries: input.entries, stagingPath: staging,
      message: {
        id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes,
        dateMs: eml.dateMs, to: ["residents"] as Address[], recipients: [] as Actor[], kind: "context" as const,
        contextRevision: candidate,
        replyHeaders: { replyTo: ["residents"] as Address[], inReplyTo: null, references: [] },
      },
    };
    const outcome = { claim: "inserted" as "inserted" | "retry" };
    this.store.transaction(() => {
      assertCurrentActor(this.store, auth, "context.publish");
      plan.message.recipients = expandAddresses(this.store, ["residents"], this.paths.society).recipients;
      outcome.claim = this.store.claimOperation({
        id: opId, actor: auth.actor, requestKey: key, requestHash: newHash, kind: "context.publish",
        payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan),
      });
      if (outcome.claim === "retry") return;
      this.store.insertDeliveries(plan.message.recipients.map(recipient => ({ messageId, recipient, operationId: opId })));
    });
    if (outcome.claim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    this.commitContext(opId, treeDir, input.entries, current);
    if (this.currentContext() !== candidate) throw new StoreError("REF_STATE_UNKNOWN", "context main does not match frozen candidate");
    await this.mail.publishGated(opId);
    const result = { kind: "context.publish" as const, previous: current, revision: candidate, message: messageId, recipientCount: plan.message.recipients.length };
    this.store.transaction(() => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
    return receiptOf(this.store.getOperationById(opId)!);
  }

  private prepareContextCandidate(treeDir: string, entries: ContextEntry[], expected: Oid | null): Oid {
    if (!existsSync(this.paths.contextGit)) {
      mkdirSync(this.paths.contextGit, { recursive: true });
      git(this.paths.contextGit, ["--git-dir", this.paths.contextGit, "init", "--bare"]);
    }
    const contextFormat = this.objectFormat(this.paths.contextGit, expected ? [expected] : []);
    const work = join(treeDir, "..", "commit-work");
    mkdirSync(work, { recursive: true });
    const gitdir = join(work, ".git");
    const contextEnv: NodeJS.ProcessEnv = {
      ...gitEnv, GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "broker@oma.invalid",
      GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "broker@oma.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      GIT_CONFIG_COUNT: "8", GIT_CONFIG_KEY_3: "core.autocrlf", GIT_CONFIG_VALUE_3: "false",
      GIT_CONFIG_KEY_4: "commit.gpgSign", GIT_CONFIG_VALUE_4: "false",
      GIT_CONFIG_KEY_5: "user.signingKey", GIT_CONFIG_VALUE_5: "",
      GIT_CONFIG_KEY_6: "core.fileMode", GIT_CONFIG_VALUE_6: "false",
      GIT_CONFIG_KEY_7: "core.excludesFile", GIT_CONFIG_VALUE_7: "/dev/null",
    };
    const run = (args: string[]) => {
      const result = spawnSync(GIT_BIN, args, { env: contextEnv, encoding: "utf8" });
      if (gitUncertain(result) || result.status !== 0)
        throw new StoreError("INTERNAL_ERROR", `context git failed: ${result.error?.message ?? result.stderr.slice(0, 300)}`);
      return result;
    };
    run(["-C", work, "init", "-q", `--object-format=${contextFormat}`]);
    if (expected) {
      run(["-C", work, "fetch", "--no-tags", this.paths.contextGit, "refs/heads/main"]);
      run(["-C", work, "checkout", "--detach", "FETCH_HEAD"]);
    }
    for (const entry of entries) {
      const destination = join(work, entry.path);
      mkdirSync(join(destination, ".."), { recursive: true });
      writeFileSync(destination, readFileSync(join(treeDir, entry.path)));
    }
    this.cleanContextExtras(work, entries.map(entry => entry.path));
    run(["-C", work, "add", "-f", "-A"]);
    const committed = spawnSync(GIT_BIN, ["-C", work, "commit", "-q", "--no-gpg-sign", "-m", "context"], { env: contextEnv, encoding: "utf8" });
    if (gitUncertain(committed)) throw gitObservationError("context commit", committed);
    if (committed.status !== 0) {
      const unchanged = spawnSync(GIT_BIN, ["-C", work, "diff", "--cached", "--quiet"], { env: contextEnv, encoding: "utf8" });
      if (gitUncertain(unchanged) || unchanged.status !== 0)
        throw new StoreError("INTERNAL_ERROR", `context commit failed: ${committed.stderr.slice(0, 300)}`);
    }
    const candidate = run(["--git-dir", gitdir, "rev-parse", "HEAD"]).stdout.trim();
    if (!isValidFullOid(candidate)) throw new StoreError("INTERNAL_ERROR", "invalid context candidate");
    return candidate;
  }
  private async contextEml(actor: Actor, messageId: string, candidate: Oid) {
    const residents = listAddress("residents", this.paths.society);
    return buildEml({
      from: actorAddress(actor, this.paths.society), to: [residents], replyTo: [residents],
      subject: "Shared context updated", kind: "context", contextRevision: candidate, inReplyTo: null, references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`,
      body: `Revision: ${candidate}\n${contextRevisionDisplayPath(candidate)}/GOAL.md\n참고: /world/context/current\n`,
    });
  }
  private commitContext(opId: string, treeDir: string, entries: ContextEntry[], expected: Oid | null): Oid {
    const accepted = this.store.getOperationById(opId);
    if (!accepted || accepted.kind !== "context.publish") throw new StoreError("STORE_CORRUPT", "context operation missing before publication");
    let plan: { candidate: Oid };
    try { plan = JSON.parse(accepted.planJson); }
    catch { throw new StoreError("STORE_CORRUPT", "context plan corrupt before publication"); }
    const work = join(treeDir, "..", "commit-work");
    const candidate = git(work, ["rev-parse", "HEAD"]).stdout.trim();
    if (candidate !== plan.candidate) throw new StoreError("STORE_CORRUPT", "staged context candidate differs from accepted plan");
    git(this.paths.contextGit, ["--git-dir", this.paths.contextGit, "fetch", "--no-tags", work, "HEAD"]);
    const cas = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "update-ref", "refs/heads/main", candidate, expected ?? ""], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(cas)) throw gitObservationError("context CAS", cas);
    if (cas.status !== 0) throw new StoreError("CONTEXT_CONFLICT", "context CAS failed");
    this.publishContextSnapshot(candidate, entries, work);
    return candidate;
  }

  /** CTX-004: immutable revision then durable current rename. */
  private publishContextSnapshot(candidate: Oid, entries: ContextEntry[], source: string): void {
    const revisionsDir = join(this.paths.worldDir, "context", "revisions");
    mkdirSync(revisionsDir, { recursive: true });
    const final = contextRevisionPathAt(this.paths.worldDir, candidate);
    if (!existsSync(final)) {
      const temporary = join(revisionsDir, `.prepare-${candidate}-${generateOperationId()}`);
      mkdirSync(temporary, { recursive: true });
      try {
        for (const entry of entries) {
          const destination = join(temporary, entry.path);
          mkdirSync(join(destination, ".."), { recursive: true });
          const data = readFileSync(join(source, entry.path));
          if (data.length !== entry.bytes || sha256Of(data) !== entry.sha256)
            throw new StoreError("STORE_CORRUPT", `context source mismatch ${entry.path}`);
          writeFileSync(destination, data, { flag: "wx", mode: 0o444 });
        }
        fsyncAll(temporary);
        if (existsSync(join(temporary, "decisions"))) chmodSync(join(temporary, "decisions"), 0o555);
        chmodSync(temporary, 0o555);
        renameSync(temporary, final);
        fsyncDir(revisionsDir);
      } finally {
        if (existsSync(temporary)) {
          chmodSync(temporary, 0o700);
          if (existsSync(join(temporary, "decisions"))) chmodSync(join(temporary, "decisions"), 0o700);
          rmSync(temporary, { recursive: true, force: true });
        }
      }
    }
    if (!lstatSync(final).isDirectory()) throw new StoreError("STORE_CORRUPT", "context revision is not a directory");
    const expectedPaths = new Set(entries.map(entry => entry.path));
    const verifyTree = (directory: string, relative = ""): void => {
      for (const name of readdirSync(directory)) {
        const path = relative ? `${relative}/${name}` : name;
        const stat = lstatSync(join(directory, name));
        if (stat.isDirectory() && path === "decisions" && entries.some(entry => entry.path.startsWith("decisions/")))
          verifyTree(join(directory, name), path);
        else if (!stat.isFile() || !expectedPaths.has(path))
          throw new StoreError("STORE_CORRUPT", `unexpected context entry ${path}`);
      }
    };
    verifyTree(final);
    for (const entry of entries) {
      const path = join(final, entry.path);
      if (!lstatSync(path).isFile()) throw new StoreError("STORE_CORRUPT", `context revision mismatch ${entry.path}`);
      const data = readFileSync(path);
      if (data.length !== entry.bytes || sha256Of(data) !== entry.sha256)
        throw new StoreError("STORE_CORRUPT", `context revision mismatch ${entry.path}`);
      chmodSync(path, 0o444);
    }
    if (existsSync(join(final, "decisions"))) chmodSync(join(final, "decisions"), 0o555);
    chmodSync(final, 0o555);
    fsyncAll(final);
    const contextRoot = join(this.paths.worldDir, "context");
    const link = join(contextRoot, `.current-${generateOperationId()}`);
    symlinkSync(contextRevisionLinkFor(candidate), link);
    renameSync(link, join(contextRoot, "current"));
    fsyncDir(contextRoot);
  }
  private cleanContextExtras(root: string, keep: string[], relative = ""): void {
    for (const entry of readdirSync(join(root, relative))) {
      if (relative === "" && entry === ".git") continue;
      const path = relative ? `${relative}/${entry}` : entry;
      const absolute = join(root, path);
      if (lstatSync(absolute).isDirectory()) {
        this.cleanContextExtras(root, keep, path);
        if (!keep.some(key => key.startsWith(`${path}/`))) rmSync(absolute, { recursive: true, force: true });
      } else if (!keep.includes(path)) rmSync(absolute, { force: true });
    }
  }
  repairContextMirror(): void {
    const revision = this.currentContext();
    if (!revision) return;
    const immutable = contextRevisionPathAt(this.paths.worldDir, revision);
    if (!existsSync(immutable)) throw new StoreError("REF_STATE_UNKNOWN", `immutable context revision ${revision} missing; reconcile accepted context first`);
    if (!lstatSync(immutable).isDirectory()) throw new StoreError("STORE_CORRUPT", "context revision mirror is not a directory");
    const listing = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "ls-tree", "-r", "-z", "--full-tree", revision], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(listing) || listing.status !== 0) throw gitObservationError("context revision tree", listing);
    const entries: ContextEntry[] = [];
    const expected = new Map<string, string>();
    for (const line of listing.stdout.split("\0").filter(Boolean)) {
      const match = /^(100644) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/.exec(line);
      if (!match || contextPathCheck(match[3])) throw new StoreError("STORE_CORRUPT", "context canonical tree contains an unsupported entry");
      expected.set(match[3]!, match[2]!);
    }
    if (!expected.has("GOAL.md")) throw new StoreError("STORE_CORRUPT", "context canonical tree has no GOAL.md");
    const seen = new Set<string>();
    const verify = (relative = ""): void => {
      for (const name of readdirSync(join(immutable, relative))) {
        const path = relative ? `${relative}/${name}` : name;
        const absolute = join(immutable, path);
        const stat = lstatSync(absolute);
        if (stat.isDirectory() && path === "decisions" && [...expected.keys()].some(key => key.startsWith("decisions/"))) {
          verify(path);
          continue;
        }
        if (!stat.isFile() || !expected.has(path)) throw new StoreError("STORE_CORRUPT", `unexpected context mirror entry ${path}`);
        const bytes = readFileSync(absolute);
        if (contextFileCheck(path, bytes)) throw new StoreError("STORE_CORRUPT", `context mirror policy mismatch ${path}`);
        const canonical = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "hash-object", "--stdin"], { input: bytes, env: gitEnv, encoding: "utf8" });
        if (gitUncertain(canonical) || canonical.status !== 0) throw gitObservationError("context mirror object hash", canonical);
        if (canonical.stdout.trim() !== expected.get(path)) throw new StoreError("STORE_CORRUPT", `context mirror bytes differ from canonical revision: ${path}`);
        seen.add(path);
        entries.push({ path, bytes: bytes.length, sha256: sha256Of(bytes) });
      }
    };
    verify();
    if (seen.size !== expected.size) throw new StoreError("STORE_CORRUPT", "context mirror is incomplete");
    this.publishContextSnapshot(revision, entries, immutable);
  }

  private async reconcileContext(op: { id: string; planJson: string }): Promise<void> {
    let plan: { base: Oid | null; candidate: Oid; entries: ContextEntry[]; stagingPath: string; message: { id: string; recipients?: string[] } };
    try { plan = JSON.parse(op.planJson) as typeof plan; }
    catch { throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt plan`); }
    if (!plan.candidate || !plan.message?.id) throw new StoreError("STORE_CORRUPT", "accepted context has no frozen candidate/message");
    const treeDir = join(plan.stagingPath, "tree");
    const main = this.currentContext();
    if (main !== plan.candidate && main !== plan.base) {
      this.store.transaction(() => this.store.setOperationUnknown(op.id));
      return;
    }
    if (main !== plan.candidate) {
      if (!existsSync(treeDir)) throw new StoreError("STORE_CORRUPT", "accepted context tree is missing");
      const rebuilt = this.prepareContextCandidate(treeDir, plan.entries, plan.base);
      if (rebuilt !== plan.candidate) throw new StoreError("STORE_CORRUPT", "accepted context candidate cannot be reproduced");
      const haveCandidate = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "cat-file", "-e", `${plan.candidate}^{commit}`], { env: gitEnv, encoding: "utf8" });
      if (gitUncertain(haveCandidate)) throw gitObservationError("context candidate observation", haveCandidate);
      if (haveCandidate.status !== 0) {
        const work = join(plan.stagingPath, "commit-work");
        const fetched = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "fetch", "--no-tags", work, "HEAD"], { env: gitEnv, encoding: "utf8" });
        if (gitUncertain(fetched) || fetched.status !== 0) throw new StoreError("REF_STATE_UNKNOWN", "context candidate cannot be recovered");
      }
      const updated = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "update-ref", "refs/heads/main", plan.candidate, plan.base ?? ""], { env: gitEnv, encoding: "utf8" });
      if (gitUncertain(updated)) throw gitObservationError("recovery context CAS", updated);
      if (updated.status !== 0) {
        this.store.transaction(() => this.store.setOperationUnknown(op.id));
        return;
      }
    }
    this.publishContextSnapshot(plan.candidate, plan.entries, join(plan.stagingPath, "commit-work"));
    if (this.currentContext() !== plan.candidate) {
      this.store.transaction(() => this.store.setOperationUnknown(op.id));
      return;
    }
    const recipients = (plan.message.recipients ?? []) as Actor[];
    const result = { kind: "context.publish" as const, previous: plan.base, revision: plan.candidate, message: plan.message.id, recipientCount: recipients.length };
    await this.mail.publishGated(op.id);
    this.store.transaction(() => this.store.setOperationSucceeded(op.id, JSON.stringify(result)));
  }
  private currentContext(): Oid | null {
    if (!existsSync(this.paths.contextGit)) return null;
    const result = spawnSync(GIT_BIN, ["--git-dir", this.paths.contextGit, "rev-parse", "--verify", "--quiet", "refs/heads/main"], { env: gitEnv, encoding: "utf8", timeout: 30000, maxBuffer: 1024 });
    const oid = String(result.stdout ?? "").trim();
    if (gitUncertain(result)) throw gitObservationError("context main ref", result);
    if (result.status === 0 && isValidFullOid(oid)) return oid;
    if (result.status === 1 && !oid && !String(result.stderr ?? "").trim()) return null;
    throw new StoreError("INTERNAL_ERROR", "cannot observe context main ref");
  }

  async reconcile(operationId: string): Promise<void> {
    const previous = this.integrationTail;
    let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { await this.reconcileUnsafe(operationId); }
    finally { release?.(); }
  }
  private async reconcileUnsafe(operationId: string): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op || (op.state !== "pending" && op.state !== "unknown")) return;
    if (op.kind === "git.integrate") { await this.reconcileIntegrate(op); return; }
    if (op.kind === "context.publish") { await this.reconcileContext(op); return; }
    if (op.kind !== "git.submit") return;
    let plan: {
      publishedRef: string; candidate: Oid; exportRef: string; prerequisites: Oid[];
      bundle?: { path: string; sha256: string; bytes: number } | null;
      message?: { id: string; recipients?: string[] };
    };
    try { plan = JSON.parse(op.planJson) as typeof plan; }
    catch { throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt plan`); }
    const refOid = spawnSync("git", ["--git-dir", this.paths.projectGit, "rev-parse", plan.publishedRef], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(refOid)) throw gitObservationError(`published ref ${plan.publishedRef}`, refOid);
    if (refOid.status === 0 && refOid.stdout.trim() !== plan.candidate) {
      this.store.transaction(() => this.store.setOperationFailed(op.id, "PUBLISHED_REF_CONFLICT"));
      return;
    }
    if (refOid.status !== 0) {
      if (plan.bundle) {
        if (!existsSync(plan.bundle.path) || statBytes(plan.bundle.path) !== plan.bundle.bytes || sha256Of(readFileSync(plan.bundle.path)) !== plan.bundle.sha256)
          throw new StoreError("STORE_CORRUPT", "accepted staged bundle no longer matches its frozen digest");
        try { this.quarantineImport(plan.bundle.path, plan.candidate, plan.exportRef, plan.prerequisites); }
        catch (error) {
          if (error instanceof StoreError && ["BUNDLE_INVALID", "PREREQUISITE_MISSING", "SPIKE_UNRESOLVED", "STREAM_INVALID"].includes(error.code))
            this.rejectAcceptedSubmit(op.id, error, "recovering");
          throw error;
        }
      } else if (!this.canonicalHas(plan.candidate)) {
        throw new StoreError("REF_STATE_UNKNOWN", "accepted submit candidate is not in canonical objects");
      }
      this.publishRef(plan.publishedRef, plan.candidate);
    }
    await this.mail.publishGated(operationId);
    let result: unknown;
    try {
      result = op.resultJson ? JSON.parse(op.resultJson) : {
        kind: "git.submit", candidate: plan.candidate, publishedRef: plan.publishedRef,
        message: plan.message?.id ?? "", recipientCount: plan.message?.recipients?.length ?? 0,
      };
    } catch { throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt result`); }
    this.store.transaction(() => this.store.setOperationSucceeded(operationId, JSON.stringify(result)));
  }
  private async reconcileIntegrate(op: { id: string; actor: Actor; planJson: string }): Promise<void> {
    let plan: { base: Oid; candidate: Oid; policyRevision: string; checkProfileDigest: string; result?: unknown };
    try { plan = JSON.parse(op.planJson) as typeof plan; }
    catch { throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt plan`); }
    const main = this.currentMain();
    if (main === plan.candidate) {
      this.store.transaction(() => this.store.setOperationSucceeded(op.id, JSON.stringify(plan.result ?? {
        kind: "git.integrate", base: plan.base, candidate: plan.candidate, target: "refs/heads/main", policyRevision: plan.policyRevision, changed: true,
      })));
      return;
    }
    if (main !== plan.base) { this.store.transaction(() => this.store.setOperationUnknown(op.id)); return; }
    const fail = (code: Parameters<Store["setOperationFailed"]>[1], message: string): never => {
      this.store.transaction(() => this.store.setOperationFailed(op.id, code));
      throw new StoreError(code, message);
    };
    const agent = this.store.getAgent(op.actor);
    if (!agent || agent.desired === "retired" || agent.desired === "stopped" || !capabilitiesOf(agent).has("code.integrate"))
      fail(agent?.desired === "stopped" ? "CANCELLED_BEFORE_COMMIT" : "CAPABILITY_DENIED", "integrate capability is unavailable during recovery");
    if (!this.isPublished(plan.candidate)) fail("CANDIDATE_NOT_PUBLISHED", "candidate is no longer published");
    const ancestor = spawnSync("git", ["--git-dir", this.paths.projectGit, "merge-base", "--is-ancestor", plan.base, plan.candidate], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(ancestor) || (ancestor.status !== 0 && ancestor.status !== 1)) throw gitObservationError("recovery merge-base ancestry check", ancestor);
    if (ancestor.status === 1) fail("NOT_DESCENDANT", "candidate is not a descendant of the recorded base");
    if (this.integration.protectedPaths.length > 0) {
      const diff = spawnSync("git", ["--git-dir", this.paths.projectGit, "diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", plan.base, plan.candidate], { env: gitEnv, encoding: "utf8" });
      if (gitUncertain(diff) || diff.status !== 0) throw gitObservationError("recovery protected-path diff", diff);
      for (const part of (diff.stdout ?? "").split("\0").filter(Boolean)) {
        const name = part.replace(/^[A-Z]\s+/, "");
        if (this.integration.protectedPaths.some(path => path.endsWith("/") ? name.startsWith(path) : name === path))
          fail("PROTECTED_PATH", `path ${name} is protected`);
      }
    }
    if (plan.checkProfileDigest !== checkDigest(this.integration.checks)) fail("POLICY_CHANGED", "integration check profile changed during recovery");
    try { for (const check of this.integration.checks) await this.runCheck(plan.candidate, check); }
    catch (error) {
      if (error instanceof StoreError && ["CHECK_FAILED", "SPIKE_UNRESOLVED"].includes(error.code))
        this.store.transaction(() => this.store.setOperationFailed(op.id, error.code));
      throw error;
    }
    if (this.currentMain() !== plan.base) { this.store.transaction(() => this.store.setOperationUnknown(op.id)); return; }
    const finalAgent = this.store.getAgent(op.actor);
    if (!finalAgent) {
      this.store.transaction(() => this.store.setOperationFailed(op.id, "CAPABILITY_DENIED"));
      throw new StoreError("CAPABILITY_DENIED", "actor disappeared during recovery");
    }
    if (finalAgent.desired === "stopped") fail("CANCELLED_BEFORE_COMMIT", "stop intent was accepted during recovery");
    if (finalAgent.desired === "retired" || !capabilitiesOf(finalAgent).has("code.integrate")) fail("CAPABILITY_DENIED", "integrate capability was revoked during recovery");
    let revision = this.integration.policyRevision;
    try { revision = this.policyRevisionReader ? this.policyRevisionReader() : this.integration.policyRevision; }
    catch (error) { fail("POLICY_CHANGED", `authoritative policy unreadable: ${(error as Error).message}`); }
    if (typeof revision !== "string" || revision.length === 0 || revision !== plan.policyRevision) fail("POLICY_CHANGED", "integration policy changed during recovery");
    const cas = spawnSync("git", ["--git-dir", this.paths.projectGit, "update-ref", "refs/heads/main", plan.candidate, plan.base], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(cas)) throw gitObservationError("recovery main CAS", cas);
    if (cas.status !== 0) { this.store.transaction(() => this.store.setOperationUnknown(op.id)); return; }
    this.store.transaction(() => this.store.setOperationSucceeded(op.id, JSON.stringify(plan.result ?? {
      kind: "git.integrate", base: plan.base, candidate: plan.candidate, target: "refs/heads/main", policyRevision: plan.policyRevision, changed: true,
    })));
  }
  knownRefs(): { main: string; published: string[] } {
    const main = this.currentMain();
    const result = spawnSync("git", ["--git-dir", this.paths.projectGit, "for-each-ref", "--format=%(objectname)", "refs/oma/published/"], { env: gitEnv, encoding: "utf8" });
    if (gitUncertain(result) || result.status !== 0) throw gitObservationError("known published refs", result);
    return { main, published: (result.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean) };
  }
}
function statBytes(path: string): number {
  const stat = lstatSync(path);
  return stat.isFile() && stat.nlink === 1 ? stat.size : -1;
}
function fsyncAll(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { fsyncAll(path); continue; }
    const fd = openSync(path, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  fsyncDir(dir);
}
