// MUST [GIT-001..009]/[INT-001..005]/[CTX-001..006]: the broker-owned Git
// boundary. Bundle validation runs in an isolated, resource-bounded namespace;
// unresolved sandbox primitives fail closed instead of parsing bundles on the host.
import { constants } from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  copyFileSync,
  readdirSync,
  statSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  Actor,
  Address,
  AuthContext,
  BlobDescriptor,
  ContextEntry,
  Json,
  Oid,
  Receipt,
  ResourceLimits,
} from "../implementation/contracts.js";
import { Store, StoreError, reused } from "./store.js";
import { MailModule, buildEml, expandAddresses } from "./mail.js";
import { generateOperationId, generateMessageId } from "./ids.js";
import {
  requestHash,
  canonicalRequestParams,
  canonicalJson,
  sha256Hex,
} from "./hash.js";
import { capabilitiesOf } from "./authority.js";

export interface GitPaths {
  stateRoot: string;
  projectGit: string; // S/repos/project.git (shared, broker-written)
  contextGit: string; // S/repos/context.git
  worldDir: string; // S/world
  society: string;
  quarantineTmpBytes: number;
  /** Resource limits for the disposable quarantine namespace. */
  quarantineResources?: {
    cpuSeconds: number;
    memoryBytes: number;
    tasks: number;
  };
  checkTimeoutSeconds: number;
  /** Trusted candidate-check sandbox inputs; absent means fail closed. */
  checkRootfs?: string;
  checkAssetsDir?: string;
  checkTmpBytes?: number;
}

export interface CheckProfile {
  argv: string[];
  env: Record<string, string>;
}

const GIT_BIN = "/usr/bin/git";
/** GIT-001: only a fixed, broker-owned environment reaches host Git. */
export const gitEnv: NodeJS.ProcessEnv = {
  HOME: "/nonexistent",
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null",
};

const ZERO = "0000000000000000000000000000000000000000";

function git(dir: string, args: string[]): SpawnSyncReturns<string> {
  const r = spawnSync(GIT_BIN, args, { cwd: dir, env: gitEnv, encoding: "utf8" });
  if (r.status !== 0) {
    throw new StoreError(
      "INTERNAL_ERROR",
      `git ${args[0] ?? "?"} failed: ${(r.stderr ?? "").slice(0, 400)}`,
    );
  }
  return r;
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkDigest(
  checks: readonly IntegrationPolicy["checks"][number][],
 ): string {
  // SAFETY: HostConfig validation admits only JSON scalar/array/object values;
  // this cast narrows the already-closed check policy for canonical hashing.
  return sha256Hex(canonicalJson(checks as unknown as Json));
}

/**
 * MUST [INT-001..004, CFG-005]: closed host integration policy — the single
 * ownership point for policy revision, protected paths, and fixed checks.
 * Wired from HostConfig.integration at composition; never caller-supplied.
 */
export interface IntegrationPolicy {
  policyRevision: string;
  protectedPaths: string[];
  checks: Array<{
    id: string;
    argv: string[];
    env: Record<string, string>;
    timeoutSeconds: number;
    tmpBytes?: number;
    resources?: ResourceLimits;
  }>;
}

export type PolicyRevisionReader = () => string;

const EMPTY_INTEGRATION_POLICY: IntegrationPolicy = {
  policyRevision: "p1",
  protectedPaths: [],
  checks: [],
};

export class GitModule {
  private readonly integration: IntegrationPolicy;
  private readonly legacyDirect: boolean;
  private readonly policyRevisionReader: PolicyRevisionReader | null;
  // ponytail: one in-process main writer; restart recovery handles durable pending rows.
  private integrationTail: Promise<void> = Promise.resolve();
  constructor(
    private readonly paths: GitPaths,
    private readonly store: Store,
    private readonly mail: MailModule,
    /** MUST [P0-B]: host integration policy; mutable for future config reloads. */
    integration: IntegrationPolicy | null = EMPTY_INTEGRATION_POLICY,
    /** Reads the authoritative host policy immediately before CAS. */
    policyRevisionReader: PolicyRevisionReader | null = null,
  ) {
    this.legacyDirect = integration === null;
    this.integration = integration ?? EMPTY_INTEGRATION_POLICY;
    this.policyRevisionReader = policyRevisionReader;
  }
  // stream uploads carry bytes; the descriptor digest is part of the IPC-005 hash.

  // -------------------------------------------------------------------------
  // git.submit (GIT-001..009)
  // -------------------------------------------------------------------------

  async submit(
    auth: AuthContext,
    key: string,
    input: {
      candidate: Oid;
      exportRef: string;
      prerequisites: Oid[];
      to: string[];
      subject: string;
      body: string;
      paths: string[];
      bundle?: BlobDescriptor;
    },
    bytes: AsyncIterable<Uint8Array>,
  ): Promise<Receipt> {
    // MUST [IPC-005]: canonical hash (sets normalized) + fast-path claim before
    // any staging/import work.
    // SAFETY: broker-side closed-schema validation supplies JSON-only submit
    // fields; this cast widens the DTO solely for canonical hashing.
    const newHash = requestHash(
      "git.submit",
      canonicalRequestParams("git.submit", input as unknown as Json),
    );
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const opId = generateOperationId();
    const messageId = generateMessageId(opId, 0);
    const staging = join(this.paths.stateRoot, "staging", `submit-${key}`);
    mkdirSync(staging, { recursive: true });
    const bundlePath = join(staging, "upload.bundle");

    // durable bundle staging + digest check (GIT-006)
    let digest: string | null = null;
    if (input.bundle) {
      const h = createHash("sha256");
      const out = openSync(
        bundlePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        for await (const chunk of bytes) {
          h.update(chunk);
          writeFileSync(out, chunk);
        }
        fsyncSync(out);
      } finally {
        closeSync(out);
      }
      digest = h.digest("hex");
      if (digest !== input.bundle.sha256)
        throw new StoreError("STREAM_INVALID", "bundle digest mismatch");
      if (!input.bundle.bytes || statBytes(bundlePath) !== input.bundle.bytes) {
        throw new StoreError("STREAM_INVALID", "bundle byte count mismatch");
      }
    }
    const targetAddresses = (input.to.length > 0 ? input.to : ["commons"]) as Address[];
    const route = expandAddresses(
      this.store,
      targetAddresses,
      this.paths.society,
    );
    const publishedRef = `refs/oma/published/${auth.actor}/${opId}`;
    // T-submit-accept: op + frozen result-mail plan + deliveries (DB-005/009)
    const eml = await this.resultEml(
      auth.actor,
      {
        candidate: input.candidate,
        subject: input.subject,
        body: input.body,
        paths: input.paths,
        to: route.displayTo,
        publishedRef,
      },
      messageId,
    );
    const plan = {
      kind: "git.submit" as const,
      candidate: input.candidate,
      exportRef: input.exportRef,
      prerequisites: input.prerequisites,
      bundle: input.bundle
        ? { path: bundlePath, sha256: digest!, bytes: input.bundle.bytes }
        : null,
      publishedRef,
      message: {
        id: messageId,
        objectPath: `mail/objects/${messageId}.eml`,
        sha256: eml.sha256,
        bytes: eml.bytes,
        dateMs: Date.now(),
        to: [...route.displayTo],
        recipients: route.recipients,
        kind: "result" as const,
        contextRevision: null,
        replyHeaders: { replyTo: route.displayTo, inReplyTo: null, references: [] },
      },
    };
    // Freeze the immutable result object before acceptance so a crash cannot leave
    // an accepted operation without the bytes needed for reconciliation.
    this.mail.freezeObject(messageId, eml);
    // SAFETY: object property escapes the tx callback's closure narrowing.
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      const acceptedRoute = expandAddresses(
        this.store,
        targetAddresses,
        this.paths.society,
      );
      if (JSON.stringify(acceptedRoute) !== JSON.stringify(route))
        throw new StoreError("POLICY_CHANGED", "recipient route changed before acceptance");
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind: "git.submit",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify(plan),
      });
      if (claimOut.txClaim === "retry") return;
      this.store.insertDeliveries(
        route.recipients.map((r) => ({ messageId, recipient: r, operationId: opId })),
      );
    });
    if (claimOut.txClaim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);

    const receipt: Receipt = {
      operation: opId,
      state: "pending",
      result: {
        kind: "git.submit",
        candidate: input.candidate,
        publishedRef: plan.publishedRef,
        message: messageId,
        recipientCount: route.recipients.length,
      },
    };
    try {
      if (input.bundle) {
        this.quarantineImport(
          bundlePath,
          input.candidate,
          input.exportRef,
          input.prerequisites,
        );
      } else if (!this.canonicalHas(input.candidate)) {
        throw new StoreError(
          "PREREQUISITE_MISSING",
          "no bundle and candidate unknown to the broker",
        );
      }
      this.publishRef(plan.publishedRef, input.candidate);
      // effect gate (MAIL-010): publish the result mail only after the ref matches
      await this.mail.publishGated(opId);
      this.store.transaction((_tx) => {
        this.store.setOperationSucceeded(opId, JSON.stringify(receipt.result));
      });
      receipt.state = "succeeded";
    } catch (e) {
      if (
        e instanceof StoreError &&
        [
          "PUBLISHED_REF_CONFLICT",
          "BUNDLE_INVALID",
          "PREREQUISITE_MISSING",
          "INVALID_OID",
          "STREAM_INVALID",
          "SPIKE_UNRESOLVED",
        ].includes(e.code)
      ) {
        this.store.transaction((_tx) =>
          this.store.setOperationFailed(opId, e.code),
        );
        throw e;
      }
      throw e; // pending; reconcile finishes what the ref+object prove
    }
    return receipt;
  }

  private async resultEml(
    actor: Actor,
    r: {
      candidate: Oid;
      subject: string;
      body: string;
      paths: string[];
      to: string[];
      publishedRef: string;
    },
    messageId: string,
  ): Promise<{ text: string; bytes: number; sha256: string; dateMs: number }> {
    const fetchHint = `git fetch origin ${r.publishedRef}; git show FETCH_HEAD\n`;
    const bodyText = `${r.body}\n\n게시됨: ${r.publishedRef}\nCommit: ${r.candidate}\n${r.paths.length > 0 ? `경로: ${r.paths.join(", ")}\n` : ""}${fetchHint}`;
    const eml = await buildEml({
      from: `${actor}@${this.paths.society}.oma.invalid`,
      to: r.to.length > 0 ? r.to : ["commons"],
      replyTo: [],
      subject: r.subject,
      kind: "result",
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`,
      body: bodyText,
    });
    return {
      text: eml.text,
      bytes: eml.bytes,
      sha256: eml.sha256,
      dateMs: Date.now(),
    };
  }

  private canonicalHas(oid: string): boolean {
    const r = spawnSync(
      "git",
      ["--git-dir", this.paths.projectGit, "cat-file", "-e", `${oid}^{commit}`],
      { env: gitEnv, encoding: "utf8" },
    );
    return r.status === 0;
  }

  /** MUST [GIT-006/007]/[S-05]: disposable namespace with bounded resources. */
  private quarantineImport(
    bundlePath: string,
    candidate: Oid,
    exportRef: string,
    prerequisites: Oid[],
  ): void {
    const limits = this.paths.quarantineResources;
    if (!limits || !Number.isSafeInteger(limits.cpuSeconds) || limits.cpuSeconds <= 0 ||
      !Number.isSafeInteger(limits.memoryBytes) || limits.memoryBytes <= 0 ||
      !Number.isSafeInteger(limits.tasks) || limits.tasks <= 0 ||
      !Number.isSafeInteger(this.paths.quarantineTmpBytes) || this.paths.quarantineTmpBytes <= 0) {
      throw new StoreError(
        "SPIKE_UNRESOLVED",
        "quarantine resource profile is unavailable",
      );
    }
    const namespaceRoot = mkdtempSync(
      join(this.paths.stateRoot, "staging", "quarantine-ns-"),
    );
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
      "$git --git-dir=\"$repo\" init -q --bare >/dev/null 2>&1 || fail_spike",
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
      const result = spawnSync(
        "/usr/bin/prlimit",
        [
          `--cpu=${limits.cpuSeconds}`,
          `--as=${limits.memoryBytes}`,
          `--nproc=${limits.tasks}`,
          "--",
          "/usr/bin/env",
          "-i",
          "HOME=/nonexistent",
          "PATH=/usr/bin:/bin",
          "LANG=C",
          "LC_ALL=C",
          "TMPDIR=/nonexistent",
          "GIT_CONFIG_NOSYSTEM=1",
          "GIT_CONFIG_GLOBAL=/dev/null",
          "GIT_CONFIG_SYSTEM=/dev/null",
          "GIT_TERMINAL_PROMPT=0",
          "GIT_NO_REPLACE_OBJECTS=1",
          "GIT_CONFIG_COUNT=3",
          "GIT_CONFIG_KEY_0=core.hooksPath",
          "GIT_CONFIG_KEY_1=core.fsync",
          "GIT_CONFIG_KEY_2=core.fsyncMethod",
          "GIT_CONFIG_VALUE_0=/dev/null",
          "GIT_CONFIG_VALUE_1=all",
          "GIT_CONFIG_VALUE_2=fsync",
          "/usr/bin/unshare",
          "--user",
          "--map-root-user",
          "--mount",
          "--pid",
          "--net",
          "--fork",
          "--kill-child=SIGKILL",
          "--forward-signals",
          "--mount-proc",
          "/bin/sh",
          "-c",
          script,
          "oma-quarantine",
          bundlePath,
          this.paths.projectGit,
          candidate,
          exportRef,
          String(this.paths.quarantineTmpBytes),
          namespaceRoot,
          ...prerequisites,
        ],
        { encoding: "utf8", maxBuffer: 64 * 1024 },
      );
      const stderr = String(result.stderr ?? "");
      if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" || result.status === null) {
        throw new StoreError(
          "SPIKE_UNRESOLVED",
          "quarantine namespace boundary unavailable",
        );
      }
      if (result.signal)
        throw new StoreError("SPIKE_UNRESOLVED", `quarantine child terminated by ${result.signal}`);
      if (result.status !== 0) {
        if (stderr.includes("OMA_ERROR=PREREQUISITE_MISSING"))
          throw new StoreError("PREREQUISITE_MISSING", "bundle prerequisite is unavailable");
        if (stderr.includes("OMA_ERROR=BUNDLE_INVALID"))
          throw new StoreError("BUNDLE_INVALID", "bundle failed quarantine validation");
        if (stderr.includes("OMA_ERROR=SPIKE_UNRESOLVED"))
          throw new StoreError("SPIKE_UNRESOLVED", "quarantine namespace setup failed");
        throw new StoreError("INTERNAL_ERROR", "quarantine import failed");
      }
      if (String(result.stdout ?? "").trim() !== candidate)
        throw new StoreError("INTERNAL_ERROR", "quarantine candidate result mismatch");
    } finally {
      rmSync(namespaceRoot, { recursive: true, force: true });
    }
  }

  /** MUST [GIT-008]: immutable published ref; conflicting OID stops the effect. */
  private publishRef(ref: string, candidate: Oid): void {
    const cur = spawnSync(
      "git",
      ["--git-dir", this.paths.projectGit, "rev-parse", ref],
      { env: gitEnv, encoding: "utf8" },
    );
    if (cur.status === 0 && cur.stdout.trim() === candidate) return; // idempotent
    if (cur.status === 0)
      throw new StoreError(
        "PUBLISHED_REF_CONFLICT",
        `${ref} already points elsewhere`,
      );
    const upd = spawnSync(
      "git",
      ["--git-dir", this.paths.projectGit, "update-ref", ref, candidate, ZERO],
      { env: gitEnv, encoding: "utf8" },
    );
    if (upd.status !== 0)
      throw new StoreError(
        "PUBLISHED_REF_CONFLICT",
        `update-ref: ${upd.stderr.slice(0, 300)}`,
      );
  }

  // -------------------------------------------------------------------------
  // git.integrate (INT-001..005)
  // -------------------------------------------------------------------------

  async integrate(
    auth: AuthContext,
    key: string,
    input: { candidate: Oid; expected: Oid },
    currentPolicyRevision: string = this.integration.policyRevision,
    legacyProtectedPaths: readonly string[] = this.integration.protectedPaths,
  ): Promise<Receipt> {
    const previous = this.integrationTail;
    let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.integrateUnsafe(
        auth, key, input, currentPolicyRevision, legacyProtectedPaths,
      );
    } finally {
      release?.();
    }
  }

  private async integrateUnsafe(
    auth: AuthContext,
    key: string,
    input: { candidate: Oid; expected: Oid },
    currentPolicyRevision: string,
    legacyProtectedPaths: readonly string[],
  ): Promise<Receipt> {
    const newHash = requestHash("git.integrate", {
      candidate: input.candidate,
      expected: input.expected,
    });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    if (this.store.recoverableOperations().some((id) =>
      this.store.getOperationById(id)?.kind === "git.integrate")) {
      throw new StoreError("REF_STATE_UNKNOWN", "pending integrate operation requires recovery");
    }
    if (!auth.capabilities.has("code.integrate"))
      throw new StoreError("CAPABILITY_DENIED", "no code.integrate");

    const base = this.currentMain();
    const policyRevision = this.integration.policyRevision;
    const opId = generateOperationId();
    const result = {
      kind: "git.integrate" as const,
      base,
      candidate: input.candidate,
      target: "refs/heads/main" as const,
      policyRevision,
      changed: true,
    };
    // INT-003: persist the physical main-writer intent before any candidate check.
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind: "git.integrate",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify({
          kind: "git.integrate",
          repo: "project",
          target: "refs/heads/main",
          base,
          candidate: input.candidate,
          policyRevision,
          checkProfileDigest: checkDigest(this.integration.checks),
          result,
        }),
      });
    });
    if (claimOut.txClaim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);

    const terminalCodes = new Set([
      "CANDIDATE_NOT_PUBLISHED",
      "STALE_BASE",
      "NOT_DESCENDANT",
      "PROTECTED_PATH",
      "CHECK_FAILED",
      "POLICY_CHANGED",
      "CANCELLED_BEFORE_COMMIT",
      "CAPABILITY_DENIED",
      "SPIKE_UNRESOLVED",
    ]);
    const fail = (code: Parameters<Store["setOperationFailed"]>[1], message: string): never => {
      this.store.transaction((_tx) => this.store.setOperationFailed(opId, code));
      throw new StoreError(code, message);
    };
    try {
      if (!this.isPublished(input.candidate))
        fail("CANDIDATE_NOT_PUBLISHED", "candidate must be preserved by a published ref");
      if (input.expected !== base)
        fail("STALE_BASE", `expected ${input.expected} but main is ${base}`);
      const anc = spawnSync(
        "git",
        [
          "--git-dir",
          this.paths.projectGit,
          "merge-base",
          "--is-ancestor",
          input.expected,
          input.candidate,
        ],
        { env: gitEnv, encoding: "utf8" },
      );
      if (anc.status !== 0)
        fail("NOT_DESCENDANT", "candidate is not a descendant of expected main");
      const protectedPaths = legacyProtectedPaths;
      if (protectedPaths.length > 0) {
        const diff = spawnSync(
          "git",
          [
            "--git-dir",
            this.paths.projectGit,
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-z",
            "--no-renames",
            input.expected,
            input.candidate,
          ],
          { env: gitEnv, encoding: "utf8" },
        );
        const touched = (diff.stdout ?? "")
        .split("\0")
        .filter((p) => p.length > 0 && /^[^\t\n]+/.test(p));
      for (const p of touched) {
        const name = p.replace(/^[A-Z]\s+/, "");
          if (protectedPaths.some((pp) => pp.endsWith("/") ? name.startsWith(pp) : name === pp))
            fail("PROTECTED_PATH", `path ${name} is protected`);
        }
      }
      // INT-002: candidate checks are sandbox-gated and settle before CAS.
      for (const check of this.integration.checks) await this.runCheck(input.candidate, check);

      // INT-003: policy, capability, stop intent, and main are re-read at the CAS boundary.
      const head = this.currentMain();
      if (head !== base) fail("STALE_BASE", `main moved to ${head}`);
      const nowAuth = this.store.getAgent(auth.actor);
      if (!nowAuth) {
        this.store.transaction((_tx) => this.store.setOperationFailed(opId, "CAPABILITY_DENIED"));
        throw new StoreError("CAPABILITY_DENIED", "actor disappeared before commit");
      }
      if (nowAuth.desired === "retired" ||
        !(this.legacyDirect
          ? auth.capabilities.has("code.integrate")
          : capabilitiesOf(nowAuth).has("code.integrate")))
        fail("CAPABILITY_DENIED", "code.integrate was revoked before commit");
      if (nowAuth.desired === "stopped")
        fail("CANCELLED_BEFORE_COMMIT", "stop intent was accepted before commit");

      let authoritativePolicyRevision = currentPolicyRevision;
      if (this.policyRevisionReader) {
        try {
          authoritativePolicyRevision = this.policyRevisionReader();
        } catch (error) {
          fail("POLICY_CHANGED", `authoritative policy unreadable: ${(error as Error).message}`);
        }
        if (typeof authoritativePolicyRevision !== "string" || authoritativePolicyRevision.length === 0)
          fail("POLICY_CHANGED", "authoritative policy is malformed");
      }
      if (authoritativePolicyRevision !== policyRevision)
        fail("POLICY_CHANGED", `policy revision changed to ${authoritativePolicyRevision}`);

      const cas = spawnSync(
        "git",
        [
          "--git-dir",
          this.paths.projectGit,
          "update-ref",
          "refs/heads/main",
          input.candidate,
          base,
        ],
        { env: gitEnv, encoding: "utf8" },
      );
      if (cas.status !== 0) {
        const actual = this.currentMain();
        fail("STALE_BASE", `CAS failed; actual main ${actual}`);
      }
      this.store.transaction((_tx) => {
        this.store.setOperationSucceeded(opId, JSON.stringify(result));
      });
      return { operation: opId, state: "succeeded", result: result as never };
    } catch (error) {
      const op = this.store.getOperationById(opId);
      if (error instanceof StoreError && op?.state === "pending" && terminalCodes.has(error.code)) {
        this.store.transaction((_tx) => this.store.setOperationFailed(opId, error.code));
      }
      throw error;
    }
  }

  private isPublished(candidate: Oid): boolean {
    const r = spawnSync(
      "git",
      [
        "--git-dir",
        this.paths.projectGit,
        "for-each-ref",
        "--format=%(objectname)",
        "refs/oma/published/",
      ],
      { env: gitEnv, encoding: "utf8" },
    );
    return (r.stdout ?? "").split("\n").some((l) => l.trim() === candidate);
  }

  private currentMain(): Oid {
    const r = spawnSync(
      "git",
      ["--git-dir", this.paths.projectGit, "rev-parse", "refs/heads/main"],
      { env: gitEnv, encoding: "utf8" },
    );
    if (r.status !== 0)
      throw new StoreError("REF_STATE_UNKNOWN", "no main ref");
    return r.stdout.trim() as Oid;
  }

  private async runCheck(
    candidate: Oid,
    check: IntegrationPolicy["checks"][number],
  ): Promise<void> {
    void candidate;
    if (!this.paths.checkRootfs || !this.paths.checkAssetsDir)
      throw new StoreError("SPIKE_UNRESOLVED", `candidate-check sandbox unavailable for ${check.id}`);
    if (check.argv.length === 0 || !check.argv[0])
      throw new StoreError("CHECK_FAILED", `check ${check.id} has no argv`);
    const resources = check.resources;
    if (!resources || Object.values(resources).some((value) => !Number.isSafeInteger(value) || value <= 0))
      throw new StoreError("SPIKE_UNRESOLVED", `check ${check.id} has invalid resource limits`);
    // UNIT-001 permits only fixed society units; transient systemd-run is not a
    // candidate-check boundary. Until a fixed, quota-backed worker exists, fail closed.
    throw new StoreError(
      "SPIKE_UNRESOLVED",
      `candidate-check resource boundary unavailable for ${check.id}`,
    );
  }

  // -------------------------------------------------------------------------
  // context.publish (CTX-001..006)
  // -------------------------------------------------------------------------

  /**
   * MUST [CTX-001..006]: full context publish. The candidate is NOT caller
   * input: the broker commits the manifest tree with its trusted identity and
   * the resulting OID is the plan's candidate (CTX-003).
   */
  async publishContext(
    auth: AuthContext,
    key: string,
    input: {
      expected: Oid | null;
      entries: ContextEntry[];
      content: BlobDescriptor;
    },
    bytes: AsyncIterable<Uint8Array>,
  ): Promise<Receipt> {
    // MUST [IPC-005]: canonical hash + fast-path claim before staging.
    // SAFETY: Context publish input is the closed DTO validated at the broker
    // boundary; the cast widens it to the JSON domain for hashing only.
    const newHash = requestHash(
      "context.publish",
      canonicalRequestParams("context.publish", input as unknown as Json),
    );
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    // capability (context.publish) is enforced at the dispatch boundary;
    // CTX-001..006 validation below still applies to every caller.
    // CTX-001: GOAL.md is mandatory, non-empty, and paths must be plain relative
    if (!input.entries.some((e) => e.path === "GOAL.md")) {
      throw new StoreError("INVALID_REQUEST", "GOAL.md is required");
    }
    for (const e of input.entries) {
      if (!e.path || e.path.includes("..") || e.path.startsWith("/")) {
        throw new StoreError(
          "INVALID_REQUEST",
          `unsafe context path ${e.path}`,
        );
      }
    }
    const opId = generateOperationId();
    const messageId = generateMessageId(opId, 0);
    const staging = join(this.paths.stateRoot, "staging", `context-${key}`);
    const treeDir = join(staging, "tree");
    mkdirSync(treeDir, { recursive: true });
    const eml = await this.contextNoticeEml(messageId, input.entries);
    const plan = {
      kind: "context.publish" as const,
      base: input.expected,
      candidate: "", // filled after the commit below (CTX-003)
      target: "refs/heads/main" as const,
      entries: input.entries,
      stagingPath: staging,
      message: {
        id: messageId,
        objectPath: `mail/objects/${messageId}.eml`,
        sha256: eml.sha256,
        bytes: eml.bytes,
        dateMs: Date.now(),
        to: ["residents"],
        recipients: ["residents"],
        kind: "context" as const,
        contextRevision: null,
        replyHeaders: { replyTo: [], inReplyTo: null, references: [] },
      },
    };
    this.mail.freezeObject(messageId, eml);

    // CTX-002: consume the aligned content stream entry-by-entry with hash checks
    const h = createHash("sha256");
    let total = 0;
    const chunks: Uint8Array[] = [];
    for await (const c of bytes) {
      h.update(c);
      total += c.length;
      chunks.push(c);
    }
    if (
      h.digest("hex") !== input.content.sha256 ||
      total !== input.content.bytes
    ) {
      throw new StoreError(
        "STREAM_INVALID",
        "context stream digest/bytes mismatch",
      );
    }
    const data = Buffer.concat(chunks);
    let off = 0;
    for (const e of input.entries) {
      const slice = data.subarray(off, off + e.bytes);
      off += e.bytes;
      if (sha256Of(slice) !== e.sha256)
        throw new StoreError("STREAM_INVALID", `entry ${e.path} hash mismatch`);
      const target = join(treeDir, e.path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, slice, { mode: 0o644 });
    }
    if (off !== data.length)
      throw new StoreError("STREAM_INVALID", "stream longer than manifest");

    // T-context-accept: stream is fully validated before the operation exists.
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind: "context.publish",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify(plan),
      });
    });
    if (claimOut.txClaim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);

    // CTX-003/004: commit with CAS, snapshot + current symlink, notification
    const candidate = await this.commitAndPublishContext(
      opId,
      input.expected,
      input.entries,
      treeDir,
    );
    const updated = { ...plan, candidate };
    const residents = this.store
      .listAgents()
      .filter(
        (a) =>
          a.role === "resident" &&
          a.desired !== "retired" &&
          a.desired !== "provisioning",
      )
      .map((a) => a.name);
    this.store.transaction((_tx) => {
      this.store.updateOperationPlanJson(opId, JSON.stringify(updated));
      this.store.insertDeliveries(
        residents.map((r) => ({ messageId, recipient: r, operationId: opId })),
      );
      this.store.setOperationSucceeded(
        opId,
        JSON.stringify({
          kind: "context.publish",
          previous: input.expected,
          revision: candidate,
          message: messageId,
          recipientCount: residents.length,
        }),
      );
    });
    await this.mail.publishGated(opId);
    return {
      operation: opId,
      state: "succeeded",
      result: {
        kind: "context.publish",
        previous: input.expected,
        revision: candidate,
        message: messageId,
        recipientCount: residents.length,
      },
    };
  }

  private async contextNoticeEml(
    messageId: string,
    entries: ContextEntry[],
  ): Promise<{ text: string; bytes: number; sha256: string; dateMs: number }> {
    const bodyText = `GOAL이 갱신되었습니다. 전체 제약: /world/context/current/GOAL.md\n파일: ${entries.map((e) => e.path).join(", ")}`;
    const eml = await buildEml({
      from: `principal@${this.paths.society}.oma.invalid`,
      to: ["residents"],
      replyTo: [],
      subject: "공유 목표 갱신",
      kind: "context",
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`,
      body: bodyText,
    });
    return {
      text: eml.text,
      bytes: eml.bytes,
      sha256: eml.sha256,
      dateMs: Date.now(),
    };
  }

  /** CTX-003/004: commit the tree with the broker identity, CAS the context
   * branch, publish the immutable revision snapshot and the current symlink. */
  private async commitAndPublishContext(
    opId: string,
    expected: Oid | null,
    entries: ContextEntry[],
    treeDir: string,
  ): Promise<Oid> {
    void opId;
    const contextGit = this.paths.contextGit;
    mkdirSync(contextGit, { recursive: true });
    if (!existsSync(join(contextGit, "HEAD"))) {
      const init = spawnSync("git", ["init", "-q", "--bare"], {
        cwd: contextGit,
        env: gitEnv,
      });
      if (init.status !== 0)
        throw new StoreError(
          "INTERNAL_ERROR",
          `context git init failed: ${init.stderr.slice(0, 200)}`,
        );
    }
    const tmp = join(treeDir, "..", "commit-work");
    mkdirSync(tmp, { recursive: true });
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: tmp, env: gitEnv });
    for (const e of entries) {
      const dir = join(tmp, e.path, "..");
      mkdirSync(dir, { recursive: true });
      renameSync(join(treeDir, e.path), join(tmp, e.path));
    }
    const add = spawnSync("git", ["add", "-A"], { cwd: tmp, env: gitEnv });
    if (add.status !== 0)
      throw new StoreError(
        "INTERNAL_ERROR",
        `context add: ${add.stderr.slice(0, 300)}`,
      );
    const commit = spawnSync(
      "git",
      [
        "-c",
        "user.name=OMA",
        "-c",
        "user.email=oma@localhost",
        "commit",
        "-qm",
        `context update`,
      ],
      { cwd: tmp, env: gitEnv },
    );
    if (commit.status !== 0)
      throw new StoreError(
        "INTERNAL_ERROR",
        `context commit: ${commit.stderr.slice(0, 300)}`,
      );
    const oid = String(
      spawnSync("git", ["rev-parse", "HEAD"], { cwd: tmp, env: gitEnv })
        .stdout ?? "",
    ).trim();
    // transfer the commit objects into the bare context repo before the CAS
    // carrier ref only; force is safe (the tree was built and hashed by us)
    const imp = spawnSync(
      "git",
      [
        "--git-dir",
        contextGit,
        "fetch",
        "-q",
        "-f",
        "--no-tags",
        tmp,
        "+main:refs/oma/input-context",
      ],
      { env: gitEnv, encoding: "utf8" },
    );
    if (imp.status !== 0)
      throw new StoreError(
        "INTERNAL_ERROR",
        `context object import failed: ${imp.stderr.slice(0, 300)}`,
      );
    const prev = expected ?? ZERO;
    const upd = spawnSync(
      "git",
      ["--git-dir", contextGit, "update-ref", "refs/heads/main", oid, prev],
      { env: gitEnv, encoding: "utf8" },
    );
    if (upd.status !== 0)
      throw new StoreError(
        "CONTEXT_CONFLICT",
        `context CAS failed; actual revision ${this.currentContext()}`,
      );
    // CTX-004: immutable revision snapshot + relative current symlink
    const revDir = join(this.paths.worldDir, "context", "revisions", oid);
    mkdirSync(revDir, { recursive: true });
    for (const e of entries) {
      const dir = join(revDir, e.path, "..");
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(tmp, e.path), join(revDir, e.path));
    }
    fsyncAll(revDir);
    const current = join(this.paths.worldDir, "context", "current");
    mkdirSync(join(this.paths.worldDir, "context"), { recursive: true });
    const linkTmp = `${current}.tmp-${process.pid}`;
    writeFileSync(linkTmp, `revisions/${oid}`, "utf8");
    renameSync(linkTmp, current);
    fsyncAll(join(this.paths.worldDir, "context"));
    return oid as Oid;
  }

  private currentContext(): Oid {
    const r = spawnSync(
      "git",
      ["--git-dir", this.paths.contextGit, "rev-parse", "refs/heads/main"],
      { env: gitEnv, encoding: "utf8" },
    );
    return (r.stdout ?? ZERO).trim() as Oid;
  }

  /** MUST [GIT-009]/[INT-004]: reconcile accepted Git effects from durable plans. */
  async reconcile(operationId: string): Promise<void> {
    const previous = this.integrationTail;
    let release: (() => void) | undefined;
    this.integrationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      await this.reconcileUnsafe(operationId);
    } finally {
      release?.();
    }
  }

  private async reconcileUnsafe(operationId: string): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op || op.state !== "pending") return;
    if (op.kind === "git.integrate") {
      await this.reconcileIntegrate(op);
      return;
    }
    if (op.kind !== "git.submit") return;
    let plan: {
      publishedRef: string;
      candidate: Oid;
      exportRef: string;
      prerequisites: Oid[];
      bundle?: { path: string; sha256: string; bytes: number } | null;
      message?: { id: string; recipients?: string[] };
    };
    try {
      plan = JSON.parse(op.planJson) as typeof plan;
    } catch {
      throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt plan`);
    }
    const refOid = spawnSync(
      "git",
      ["--git-dir", this.paths.projectGit, "rev-parse", plan.publishedRef],
      { env: gitEnv, encoding: "utf8" },
    );
    if (refOid.status === 0 && refOid.stdout.trim() !== plan.candidate) {
      this.store.transaction((_tx) => this.store.setOperationFailed(op.id, "PUBLISHED_REF_CONFLICT"));
      return;
    }
    if (refOid.status !== 0) {
      if (plan.bundle) {
        if (!existsSync(plan.bundle.path) || statBytes(plan.bundle.path) !== plan.bundle.bytes ||
          sha256Of(readFileSync(plan.bundle.path)) !== plan.bundle.sha256) {
          this.store.transaction((_tx) => this.store.setOperationFailed(op.id, "STREAM_INVALID"));
          throw new StoreError("STREAM_INVALID", "staged bundle no longer matches its digest");
        }
        try {
          this.quarantineImport(
            plan.bundle.path,
            plan.candidate,
            plan.exportRef,
            plan.prerequisites,
          );
        } catch (error) {
          if (error instanceof StoreError && ["BUNDLE_INVALID", "PREREQUISITE_MISSING", "SPIKE_UNRESOLVED", "STREAM_INVALID"].includes(error.code))
            this.store.transaction((_tx) => this.store.setOperationFailed(op.id, error.code));
          throw error;
        }
      } else if (!this.canonicalHas(plan.candidate)) {
        throw new StoreError("REF_STATE_UNKNOWN", "accepted submit candidate is not in canonical objects");
      }
      this.publishRef(plan.publishedRef, plan.candidate);
    }
    await this.mail.publishGated(operationId);
    let receipt: unknown;
    try {
      receipt = op.resultJson ? JSON.parse(op.resultJson) : {
        kind: "git.submit",
        candidate: plan.candidate,
        publishedRef: plan.publishedRef,
        message: plan.message?.id ?? "",
        recipientCount: plan.message?.recipients?.length ?? 0,
      };
    } catch {
      receipt = { operation: operationId, state: "pending" };
    }
    this.store.transaction((_tx) =>
      this.store.setOperationSucceeded(operationId, JSON.stringify(receipt)));
  }

  private async reconcileIntegrate(op: { id: string; actor: Actor; planJson: string }): Promise<void> {
    let plan: {
      base: Oid;
      candidate: Oid;
      policyRevision: string;
      checkProfileDigest: string;
      result?: unknown;
    };
    try {
      plan = JSON.parse(op.planJson) as typeof plan;
    } catch {
      throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt plan`);
    }
    const main = this.currentMain();
    if (main === plan.candidate) {
      this.store.transaction((_tx) => this.store.setOperationSucceeded(op.id, JSON.stringify(plan.result ?? {
        kind: "git.integrate", base: plan.base, candidate: plan.candidate,
        target: "refs/heads/main", policyRevision: plan.policyRevision, changed: true,
      })));
      return;
    }
    if (main !== plan.base) {
      this.store.transaction((_tx) => this.store.setOperationUnknown(op.id));
      return;
    }
    const fail = (code: Parameters<Store["setOperationFailed"]>[1], message: string): never => {
      this.store.transaction((_tx) => this.store.setOperationFailed(op.id, code));
      throw new StoreError(code, message);
    };
    const agent = this.store.getAgent(op.actor);
    if (!agent || agent.desired === "retired" || agent.desired === "stopped" ||
      !capabilitiesOf(agent).has("code.integrate"))
      fail(agent?.desired === "stopped" ? "CANCELLED_BEFORE_COMMIT" : "CAPABILITY_DENIED", "integrate capability is unavailable during recovery");
    if (!this.isPublished(plan.candidate)) fail("CANDIDATE_NOT_PUBLISHED", "candidate is no longer published");
    const anc = spawnSync(
      "git",
      ["--git-dir", this.paths.projectGit, "merge-base", "--is-ancestor", plan.base, plan.candidate],
      { env: gitEnv, encoding: "utf8" },
    );
    if (anc.status !== 0) fail("NOT_DESCENDANT", "candidate is not a descendant of the recorded base");
    if (this.integration.protectedPaths.length > 0) {
      const diff = spawnSync(
        "git",
        ["--git-dir", this.paths.projectGit, "diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", plan.base, plan.candidate],
        { env: gitEnv, encoding: "utf8" },
      );
      for (const p of (diff.stdout ?? "").split("\0").filter(Boolean)) {
        const name = p.replace(/^[A-Z]\s+/, "");
        if (this.integration.protectedPaths.some((pp) => pp.endsWith("/") ? name.startsWith(pp) : name === pp))
          fail("PROTECTED_PATH", `path ${name} is protected`);
      }
    }
    if (plan.checkProfileDigest !== checkDigest(this.integration.checks))
      fail("POLICY_CHANGED", "integration check profile changed during recovery");
    try {
      for (const check of this.integration.checks) await this.runCheck(plan.candidate, check);
    } catch (error) {
      if (error instanceof StoreError && ["CHECK_FAILED", "SPIKE_UNRESOLVED"].includes(error.code))
        this.store.transaction((_tx) => this.store.setOperationFailed(op.id, error.code));
      throw error;
    }
    const head = this.currentMain();
    if (head !== plan.base) {
      this.store.transaction((_tx) => this.store.setOperationUnknown(op.id));
      return;
    }
    const finalAgent = this.store.getAgent(op.actor);
    if (!finalAgent) {
      this.store.transaction((_tx) => this.store.setOperationFailed(op.id, "CAPABILITY_DENIED"));
      throw new StoreError("CAPABILITY_DENIED", "actor disappeared during recovery");
    }
    if (finalAgent.desired === "stopped")
      fail("CANCELLED_BEFORE_COMMIT", "stop intent was accepted during recovery");
    if (finalAgent.desired === "retired" || !capabilitiesOf(finalAgent).has("code.integrate"))
      fail("CAPABILITY_DENIED", "integrate capability was revoked during recovery");
    let revision: string = this.integration.policyRevision;
    try {
      revision = this.policyRevisionReader ? this.policyRevisionReader() : this.integration.policyRevision;
    } catch (error) {
      fail("POLICY_CHANGED", `authoritative policy unreadable: ${(error as Error).message}`);
    }
    if (typeof revision !== "string" || revision.length === 0 || revision !== plan.policyRevision)
      fail("POLICY_CHANGED", "integration policy changed during recovery");
    const cas = spawnSync(
      "git",
      ["--git-dir", this.paths.projectGit, "update-ref", "refs/heads/main", plan.candidate, plan.base],
      { env: gitEnv, encoding: "utf8" },
    );
    if (cas.status !== 0) {
      this.store.transaction((_tx) => this.store.setOperationUnknown(op.id));
      return;
    }
    this.store.transaction((_tx) => this.store.setOperationSucceeded(op.id, JSON.stringify(plan.result ?? {
      kind: "git.integrate", base: plan.base, candidate: plan.candidate,
      target: "refs/heads/main", policyRevision: plan.policyRevision, changed: true,
    })));
  }
  /** known refs for git.known (GIT-004): main + immutable published refs. */
  knownRefs(): { main: string; published: string[] } {
    const main = this.currentMain();
    const r = spawnSync(
      "git",
      [
        "--git-dir",
        this.paths.projectGit,
        "for-each-ref",
        "--format=%(objectname)",
        "refs/oma/published/",
      ],
      { env: gitEnv, encoding: "utf8" },
    );
    return {
      main,
      published: (r.stdout ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    };
  }
}

function receiptOf(op: {
  id: string;
  state: string;
  resultJson: string | null;
  errorCode: string | null;
}): Receipt {
  const rec: Receipt = {
    operation: op.id,
    state: op.state as Receipt["state"],
  };
  if (op.resultJson) {
    try {
      rec.result = JSON.parse(op.resultJson);
    } catch {
      /* keep minimal */
    }
  }
  if (op.errorCode)
    rec.error = {
      code: op.errorCode as never,
      message: op.errorCode,
      retry: "same-key",
    };
  return rec;
}

function statBytes(p: string): number {
  return statSync(p).size;
}

function fsyncAll(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      try {
        const fd2 = openSync(p, "r");
        try {
          fsyncSync(fd2);
        } finally {
          closeSync(fd2);
        }
      } catch {
        /* files only */
      }
    }
  } catch {
    /* best effort */
  }
}
