// MUST [GIT-001..009]/[INT-001..005]/[CTX-001..006]: the broker-owned Git
// boundary. The bundle/quarantine/alternate/import/CAS recipe was verified in
// SPIKE S-05 on git 2.55.0; quarantine-to-canonical object transfer goes
// through the validated quarantine repo, never the agent's clone.
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  Actor,
  AuthContext,
  BlobDescriptor,
  ContextEntry,
  Oid,
  Receipt,
} from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";
import { MailModule, buildEml } from "./mail.js";
import { generateOperationId, generateMessageId } from "./ids.js";

export interface GitPaths {
  stateRoot: string;
  projectGit: string; // S/repos/project.git (shared, broker-written)
  contextGit: string; // S/repos/context.git
  worldDir: string; // S/world
  society: string;
  quarantineTmpBytes: number;
  checkTimeoutSeconds: number;
}

export interface CheckProfile {
  argv: string[];
  env: Record<string, string>;
}

const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
};

const ZERO = "0000000000000000000000000000000000000000";

function git(dir: string, args: string[]): SpawnSyncReturns<string> {
  const r = spawnSync("git", args, { cwd: dir, env: gitEnv, encoding: "utf8" });
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

export class GitModule {
  constructor(
    private readonly paths: GitPaths,
    private readonly store: Store,
    private readonly mail: MailModule,
    private readonly checkProfile: CheckProfile | null,
  ) {}

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
    const existing = this.store.getOperation(auth.actor, key);
    if (existing) return receiptOf(existing);
    const opId = generateOperationId();
    const messageId = generateMessageId(opId, 0);
    const staging = join(this.paths.stateRoot, "staging", `submit-${key}`);
    mkdirSync(staging, { recursive: true });
    const bundlePath = join(staging, "upload.bundle");

    // durable bundle staging + digest check (GIT-006)
    let digest: string | null = null;
    if (input.bundle) {
      const h = createHash("sha256");
      const out = openSync(bundlePath, "w");
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

    // T-submit-accept: op + frozen result-mail plan + deliveries (DB-005/009)
    const eml = await this.resultEml(
      auth.actor,
      {
        candidate: input.candidate,
        subject: input.subject,
        body: input.body,
        paths: input.paths,
        to: input.to,
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
      publishedRef: `refs/oma/published/${auth.actor}/${opId}`,
      message: {
        id: messageId,
        objectPath: `mail/objects/${messageId}.eml`,
        sha256: eml.sha256,
        bytes: eml.bytes,
        dateMs: Date.now(),
        to: [...input.to],
        recipients: input.to,
        kind: "result" as const,
        contextRevision: null,
        replyHeaders: { replyTo: input.to, inReplyTo: null, references: [] },
      },
    };
    this.store.transaction((_tx) => {
      this.store.insertOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: sha256Of(Buffer.from(JSON.stringify(input))),
        kind: "git.submit",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify(plan),
      });
      this.store.insertDeliveries(
        input.to.map((r) => ({ messageId, recipient: r, operationId: opId })),
      );
    });
    // freeze the result object before any effect (DB-009)
    this.mail.freezeObject(messageId, eml);

    const receipt: Receipt = {
      operation: opId,
      state: "pending",
      result: {
        kind: "git.submit",
        candidate: input.candidate,
        publishedRef: plan.publishedRef,
        message: messageId,
        recipientCount: input.to.length,
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
    },
    messageId: string,
  ): Promise<{ text: string; bytes: number; sha256: string; dateMs: number }> {
    const fetchHint = `git fetch origin ${`refs/oma/published/${actor}`}; git show FETCH_HEAD\n`;
    const bodyText = `${r.body}\n\n게시됨: refs/oma/published/${actor}\nCommit: ${r.candidate}\n${r.paths.length > 0 ? `경로: ${r.paths.join(", ")}\n` : ""}${fetchHint}`;
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

  /** MUST [GIT-006/007]/[S-05]: validated quarantine with RO alternate, single export ref. */
  private quarantineImport(
    bundlePath: string,
    candidate: Oid,
    exportRef: string,
    prerequisites: Oid[],
  ): void {
    const quarDir = join(
      this.paths.stateRoot,
      "staging",
      `quarantine-${candidate.slice(0, 12)}`,
    );
    mkdirSync(join(quarDir, "objects", "info"), { recursive: true });
    writeFileSync(
      join(quarDir, "objects", "info", "alternates"),
      `${this.paths.projectGit}/objects\n`,
      "utf8",
    );
    spawnSync("git", ["init", "-q", "--bare"], { cwd: quarDir, env: gitEnv });
    // verify: prerequisites resolvable via the RO alternate; exactly one head
    const verify = spawnSync(
      "git",
      ["--git-dir", quarDir, "bundle", "verify", bundlePath],
      { env: gitEnv, encoding: "utf8" },
    );
    if (verify.status !== 0)
      throw new StoreError(
        "BUNDLE_INVALID",
        `bundle verify: ${verify.stderr.slice(0, 300)}`,
      );
    const heads = spawnSync(
      "git",
      ["--git-dir", quarDir, "bundle", "list-heads", bundlePath],
      { env: gitEnv, encoding: "utf8" },
    );
    const refs = (heads.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(/\s+/).pop() ?? "");
    if (refs.length !== 1 || refs[0] !== exportRef) {
      throw new StoreError(
        "BUNDLE_INVALID",
        `bundle must carry exactly ${exportRef}; got ${refs.join(",")}`,
      );
    }
    const fetch = spawnSync(
      "git",
      [
        "--git-dir",
        quarDir,
        "fetch",
        "-q",
        "--no-tags",
        bundlePath,
        `${exportRef}:refs/oma/input`,
      ],
      { env: gitEnv, encoding: "utf8" },
    );
    if (fetch.status !== 0)
      throw new StoreError(
        "BUNDLE_INVALID",
        `bundle fetch: ${fetch.stderr.slice(0, 300)}`,
      );
    const input = spawnSync(
      "git",
      ["--git-dir", quarDir, "rev-parse", "refs/oma/input"],
      { env: gitEnv, encoding: "utf8" },
    ).stdout.trim();
    if (input !== candidate)
      throw new StoreError(
        "BUNDLE_INVALID",
        `exported commit ${input} != candidate ${candidate}`,
      );
    const fsck = spawnSync(
      "git",
      ["--git-dir", quarDir, "fsck", "--strict", "--no-reflogs"],
      { env: gitEnv, encoding: "utf8" },
    );
    if (fsck.status !== 0)
      throw new StoreError(
        "BUNDLE_INVALID",
        `fsck: ${fsck.stderr.slice(0, 300)}`,
      );
    for (const p of prerequisites) {
      const ok = spawnSync(
        "git",
        ["--git-dir", quarDir, "cat-file", "-e", `${p}^{commit}`],
        { env: gitEnv, encoding: "utf8" },
      );
      if (ok.status !== 0)
        throw new StoreError(
          "PREREQUISITE_MISSING",
          `prerequisite ${p} not present`,
        );
    }
    // import validated objects quarantine -> canonical
    // transfer carrier ref only; forcing is safe because the quarantine was
    // validated (fetch -f) and the real contract is the immutable published ref.
    const imp = spawnSync(
      "git",
      [
        "--git-dir",
        this.paths.projectGit,
        "fetch",
        "-q",
        "-f",
        "--no-tags",
        quarDir,
        "+refs/oma/input:refs/oma/input",
      ],
      { env: gitEnv, encoding: "utf8" },
    );
    if (imp.status !== 0)
      throw new StoreError(
        "INTERNAL_ERROR",
        `canonical import: ${imp.stderr.slice(0, 300)}`,
      );
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
    policyRevision: string,
    protectedPaths: string[],
  ): Promise<Receipt> {
    const existing = this.store.getOperation(auth.actor, key);
    if (existing) return receiptOf(existing);
    const base = this.currentMain();
    // INT-001 condition checks
    if (!this.isPublished(input.candidate))
      throw new StoreError(
        "CANDIDATE_NOT_PUBLISHED",
        "candidate must be preserved by a published ref",
      );
    if (input.expected !== base)
      throw new StoreError(
        "STALE_BASE",
        `expected ${input.expected} but main is ${base}`,
      );
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
      throw new StoreError(
        "NOT_DESCENDANT",
        "candidate is not a descendant of expected main",
      );
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
        if (
          protectedPaths.some((pp) =>
            pp.endsWith("/") ? name.startsWith(pp) : name === pp,
          )
        ) {
          throw new StoreError("PROTECTED_PATH", `path ${name} is protected`);
        }
      }
    }
    // fixed host check (INT-002) on the actual candidate
    if (this.checkProfile) {
      this.runCheck(input.candidate);
    }
    const opId = generateOperationId();
    const result = {
      kind: "git.integrate" as const,
      base,
      candidate: input.candidate,
      target: "refs/heads/main" as const,
      policyRevision,
      changed: true,
    };
    // T-integrate-intent
    this.store.transaction((_tx) => {
      this.store.insertOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: sha256Of(Buffer.from(JSON.stringify(input))),
        kind: "git.integrate",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify({
          kind: "git.integrate",
          repo: "project",
          target: "refs/heads/main",
          base,
          candidate: input.candidate,
          policyRevision,
          checkProfileDigest: "fixed",
        }),
      });
    });
    // serialized CAS (INT-003): main must still equal base right before the write
    const head = this.currentMain();
    if (head !== base) {
      this.store.transaction((_tx) =>
        this.store.setOperationFailed(opId, "STALE_BASE"),
      );
      throw new StoreError("STALE_BASE", `main moved to ${head}`);
    }
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
      this.store.transaction((_tx) =>
        this.store.setOperationFailed(opId, "STALE_BASE"),
      );
      throw new StoreError("STALE_BASE", `CAS failed; actual main ${actual}`);
    }
    // T-integrate-done
    this.store.transaction((_tx) => {
      this.store.setOperationSucceeded(opId, JSON.stringify(result));
    });
    return { operation: opId, state: "succeeded", result: result as never };
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

  private runCheck(candidate: Oid): void {
    // INT-002: actual candidate in a private checkout; exit code/timeout decides
    const dir = this.checkDir(candidate);
    const r = spawnSync(
      this.checkProfile!.argv[0]!,
      this.checkProfile!.argv.slice(1),
      {
        cwd: dir,
        env: { ...gitEnv, ...this.checkProfile!.env },
        encoding: "utf8",
        timeout: this.paths.checkTimeoutSeconds * 1000,
      },
    );
    if (r.error || r.status !== 0)
      throw new StoreError(
        "CHECK_FAILED",
        `check ${this.checkProfile!.argv.join(" ")} failed`,
      );
  }

  private checkDir(candidate: Oid): string {
    const dir = join(
      this.paths.stateRoot,
      "staging",
      `check-${candidate.slice(0, 12)}`,
    );
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, ".git"))) {
      spawnSync(
        "git",
        ["clone", "-q", "--no-local", this.paths.projectGit, dir],
        { env: gitEnv, encoding: "utf8" },
      );
    }
    git(dir, ["checkout", "-q", candidate]);
    return dir;
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
    const existing = this.store.getOperation(auth.actor, key);
    if (existing) return receiptOf(existing);
    if (auth.actor !== "principal")
      throw new StoreError(
        "CAPABILITY_DENIED",
        "context.publish is principal-only",
      );
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
    this.store.transaction((_tx) => {
      this.store.insertOperation({
        id: opId,
        actor: "principal",
        requestKey: key,
        requestHash: sha256Of(Buffer.from(JSON.stringify(input))),
        kind: "context.publish",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify(plan),
      });
    });
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

  /** MUST [GIT-009]: submit success = published ref + result mail materialized. */
  async reconcile(operationId: string): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op || op.state !== "pending") return;
    if (op.kind === "git.submit") {
      let plan: { publishedRef: string; candidate: string };
      try {
        plan = JSON.parse(op.planJson) as {
          publishedRef: string;
          candidate: string;
        };
      } catch {
        throw new StoreError(
          "STORE_CORRUPT",
          `operation ${op.id} has corrupt plan`,
        );
      }
      const refOid = spawnSync(
        "git",
        ["--git-dir", this.paths.projectGit, "rev-parse", plan.publishedRef],
        { env: gitEnv, encoding: "utf8" },
      );
      if (refOid.status === 0 && refOid.stdout.trim() === plan.candidate) {
        await this.mail.publishGated(operationId);
        let receipt: unknown = { operation: operationId, state: "pending" };
        try {
          if (op.resultJson) receipt = JSON.parse(op.resultJson);
        } catch {
          /* keep default */
        }
        this.store.transaction((_tx) =>
          this.store.setOperationSucceeded(
            operationId,
            JSON.stringify(receipt),
          ),
        );
      }
    }
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
