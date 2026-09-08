// Phase 7 acceptance: git.submit (bundle quarantine/import/publish), integrate
// (CAS, race, protected paths), context.publish (commit/CAS/snapshot) — on real
// git repos (S-05 recipe).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Store, StoreError } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { GitModule, type GitPaths, type IntegrationPolicy } from "../src/git.js";
import type {
  AuthContext,
  Capability,
  Oid,
} from "../implementation/contracts.js";

const G = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
};

interface Env {
  dir: string;
  society: string;
  store: Store;
  mail: MailModule;
  git: GitModule;
  paths: GitPaths;
  seal: () => void;
}

function envOf(integration: IntegrationPolicy | null = null): Env {
  const dir = mkdtempSync(join(tmpdir(), "oma-t7-"));
  const society = "demo";
  mkdirSync(join(dir, "state", "repos"), { recursive: true });
  const store = new Store(join(dir, "state", "runtime.sqlite"));
  store.transaction((_t) => {
    for (const [name, role, desired] of [
      ["principal", "principal", "enabled"],
      ["a", "resident", "enabled"],
      ["b", "resident", "enabled"],
    ] as const) {
      store.insertAgent({
        name,
        specHash: "h",
        role,
        desired,
        incarnation: 0,
        profile: "p",
        createdBy: null,
        specJson: "{}",
      });
    }
  });
  const mail = new MailModule(
    { stateRoot: join(dir, "state"), society },
    store,
    64,
  );
  const paths: GitPaths = {
    stateRoot: join(dir, "state"),
    projectGit: join(dir, "state", "repos", "project.git"),
    contextGit: join(dir, "state", "repos", "context.git"),
    worldDir: join(dir, "state", "world"),
    society,
    quarantineTmpBytes: 256 * 1024 * 1024,
    checkTimeoutSeconds: 30,
  };
  const git = new GitModule(paths, store, mail, integration);
  return {
    dir,
    society,
    store,
    mail,
    git,
    paths,
    seal: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function sh(env: Env, args: string[], cwd?: string): string {
  const r = spawnSync("git", args, {
    cwd: cwd ?? env.dir,
    env: G,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return (r.stdout ?? "").trim();
}

/** seed project.git with a main branch holding base.txt. */
function seedProject(env: Env): Oid {
  const seedDir = join(env.dir, "seed");
  mkdirSync(seedDir, { recursive: true });
  sh(env, ["init", "-q", "-b", "main"], seedDir);
  writeFileSync(join(seedDir, "base.txt"), "a".repeat(262144) + "\n", "utf8");
  sh(env, ["add", "-A"], seedDir);
  sh(
    env,
    [
      "-c",
      "user.name=OMA",
      "-c",
      "user.email=oma@localhost",
      "commit",
      "-qm",
      "base",
    ],
    seedDir,
  );
  const base = sh(env, ["rev-parse", "HEAD"], seedDir);
  sh(env, ["clone", "-q", "--bare", seedDir, env.paths.projectGit]);
  sh(env, [
    "--git-dir",
    env.paths.projectGit,
    "symbolic-ref",
    "HEAD",
    "refs/heads/main",
  ]);
  return base as Oid;
}

/** bundle for candidate C with base prerequisite; returns {bytes} as iterator input. */
function makeBundle(
  env: Env,
  clone: string,
  C: Oid,
  base: Oid,
): { content: Buffer; exportRef: string } {
  const exportRef = "refs/oma/export/req-1";
  sh(env, ["update-ref", exportRef, C], clone);
  const bpath = join(env.dir, "upload.bundle");
  sh(env, ["bundle", "create", bpath, exportRef, `^${base}`], clone);
  return { content: Buffer.from(readFileSync(bpath)), exportRef };
}

function auth(actor: string, caps: Capability[]): AuthContext {
  return {
    actor,
    incarnation: 1,
    role: actor === "principal" ? "principal" : "resident",
    channel: "actor",
    capabilities: new Set(caps),
    peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
  };
}

async function* iter(b: Buffer): AsyncIterable<Uint8Array> {
  yield b;
}

// ---------------------------------------------------------------------------

test("T53: independent clones — A's refs/state never leak into B or canonical", () => {
  const env = envOf();
  try {
    const seedDir = join(env.dir, "seed");
    mkdirSync(seedDir, { recursive: true });
    sh(env, ["init", "-q", "-b", "main"], seedDir);
    writeFileSync(join(seedDir, "f.txt"), "v1\n", "utf8");
    sh(env, ["add", "-A"], seedDir);
    sh(
      env,
      [
        "-c",
        "user.name=O",
        "-c",
        "user.email=o@localhost",
        "commit",
        "-qm",
        "init",
      ],
      seedDir,
    );
    sh(env, ["clone", "-q", "--bare", seedDir, env.paths.projectGit]);
    sh(env, [
      "--git-dir",
      env.paths.projectGit,
      "symbolic-ref",
      "HEAD",
      "refs/heads/main",
    ]);
    const a = join(env.dir, "a");
    sh(env, ["clone", "-q", env.paths.projectGit, a]);
    // A mutates its own refs/index/config
    sh(env, ["update-ref", "refs/custom/x", "HEAD"], a);
    writeFileSync(
      join(a, ".git", "config"),
      "[core]\n\tbare = false\n",
      "utf8",
    );
    // B: fresh clone sees only canonical main
    const b = join(env.dir, "b");
    sh(env, ["clone", "-q", env.paths.projectGit, b]);
    assert.equal(
      sh(env, ["rev-parse", "main"], b),
      sh(env, ["rev-parse", "main"], a),
    );
    const custom = spawnSync(
      "git",
      ["--git-dir", join(b, ".git"), "rev-parse", "refs/custom/x"],
      { env: G, encoding: "utf8" },
    );
    assert.notEqual(custom.status, 0);
  } finally {
    env.seal();
  }
});

test("T54: submit with incremental bundle creates the published ref and the result mail; peer fetches exact C", async () => {
  const env = envOf();
  try {
    const base = seedProject(env);
    const clone = join(env.dir, "clone-x");
    sh(env, ["clone", "-q", "--no-local", env.paths.projectGit, clone]);
    writeFileSync(join(clone, "fix.txt"), "fix\n", "utf8");
    sh(env, ["add", "fix.txt"], clone);
    sh(
      env,
      [
        "-c",
        "user.name=A",
        "-c",
        "user.email=a@localhost",
        "commit",
        "-qm",
        "fix",
      ],
      clone,
    );
    const C = sh(env, ["rev-parse", "HEAD"], clone) as Oid;
    const { content, exportRef } = makeBundle(env, clone, C, base);
    const receipt = await env.git.submit(
      auth("a", ["git.submit"]),
      "k1",
      {
        candidate: C,
        exportRef,
        prerequisites: [base],
        to: ["b"],
        subject: "fix",
        body: "done",
        paths: ["fix.txt"],
        bundle: {
          bytes: content.length,
          sha256: sha256Hex(content),
          mediaType: "application/x-git-bundle",
        },
      },
      iter(content),
    );
    assert.equal(receipt.state, "succeeded");
    const ref = (receipt.result as { publishedRef: string }).publishedRef;
    assert.equal(
      sh(env, ["--git-dir", env.paths.projectGit, "rev-parse", ref]),
      C,
    );
    // result mail materialized (archive + b inbox)
    assert.equal(
      existsSync(join(env.dir, "state", "mail", "archive", "cur")),
      true,
    );
    const op = env.store.transaction((_t) =>
      env.store.getOperation("a", "k1"),
    )!;
    assert.equal(op.state, "succeeded");
    // peer B fetches exactly C
    const b = join(env.dir, "peer");
    sh(env, ["clone", "-q", env.paths.projectGit, b]);
    sh(env, ["fetch", "-q", "origin", ref], b);
    assert.equal(sh(env, ["rev-parse", "FETCH_HEAD"], b), C);
  } finally {
    env.seal();
  }
});

test("T55/T59: same key resubmits the frozen candidate; a conflicting ref OID is refused", async () => {
  const env = envOf();
  try {
    const base = seedProject(env);
    const clone = join(env.dir, "clone-y");
    sh(env, ["clone", "-q", "--no-local", env.paths.projectGit, clone]);
    writeFileSync(join(clone, "y.txt"), "y\n", "utf8");
    sh(env, ["add", "y.txt"], clone);
    sh(
      env,
      [
        "-c",
        "user.name=A",
        "-c",
        "user.email=a@localhost",
        "commit",
        "-qm",
        "y",
      ],
      clone,
    );
    const C = sh(env, ["rev-parse", "HEAD"], clone) as Oid;
    const { content, exportRef } = makeBundle(env, clone, C, base);
    const receipt = await env.git.submit(
      auth("a", ["git.submit"]),
      "k1",
      {
        candidate: C,
        exportRef,
        prerequisites: [base],
        to: ["b"],
        subject: "y",
        body: "",
        paths: [],
        bundle: {
          bytes: content.length,
          sha256: sha256Hex(content),
          mediaType: "application/x-git-bundle",
        },
      },
      iter(content),
    );
    assert.equal(receipt.state, "succeeded");
    // same key + same payload -> same receipt (idempotent)
    const again = await env.git.submit(
      auth("a", ["git.submit"]),
      "k1",
      {
        candidate: C,
        exportRef,
        prerequisites: [base],
        to: ["b"],
        subject: "y",
        body: "",
        paths: [],
        bundle: {
          bytes: content.length,
          sha256: sha256Hex(content),
          mediaType: "application/x-git-bundle",
        },
      },
      iter(content),
    );
    assert.equal(again.operation, receipt.operation);
    // T59: manually move the published ref elsewhere -> next publish of the same ref conflicts
    // T59: a pending submit whose published ref was moved to a different OID is
    // never auto-overwritten by reconcile (immutability, GIT-008).
    const pubRef = (receipt.result as { publishedRef: string }).publishedRef;
    sh(env, ["--git-dir", env.paths.projectGit, "update-ref", pubRef, base]);
    const pendId = "op-manual-pend";
    const planForPend = JSON.stringify({
      kind: "git.submit",
      candidate: C,
      exportRef,
      prerequisites: [],
      bundle: null,
      publishedRef: pubRef,
      message: {
        id: "m-x-0",
        objectPath: "o",
        sha256: "0".repeat(64),
        bytes: 1,
        dateMs: 1,
        to: [],
        recipients: [],
        kind: "result",
        contextRevision: null,
        replyHeaders: null,
      },
    });
    env.store.transaction((_t) => {
      env.store.insertOperation({
        id: pendId,
        actor: "a",
        requestKey: "k-manual",
        requestHash: "h",
        kind: "git.submit",
        payloadJson: "{}",
        planJson: planForPend,
      });
    });
    await env.git.reconcile(pendId);
    assert.equal(
      sh(env, ["--git-dir", env.paths.projectGit, "rev-parse", pubRef]),
      base,
    ); // untouched
    assert.equal(
      env.store.transaction((_t) => env.store.getOperationById(pendId))!.state,
      "pending",
    );
    // idempotent resubmit with the same key still returns the original receipt
    assert.equal(again.operation, receipt.operation);
  } finally {
    env.seal();
  }
});

test("T60/T61: integrate CAS — first wins, stale/undescendant/protected refused, main unchanged on refusal", async () => {
  const env = envOf();
  try {
    const base = seedProject(env);
    // two candidates C1 (fast-forward) and C2 (also from base)
    const c1r = join(env.dir, "c1");
    sh(env, ["clone", "-q", env.paths.projectGit, c1r]);
    writeFileSync(join(c1r, "c1.txt"), "1\n", "utf8");
    sh(env, ["add", "c1.txt"], c1r);
    sh(
      env,
      [
        "-c",
        "user.name=1",
        "-c",
        "user.email=1@localhost",
        "commit",
        "-qm",
        "c1",
      ],
      c1r,
    );
    const C1 = sh(env, ["rev-parse", "HEAD"], c1r) as Oid;
    const c2r = join(env.dir, "c2");
    sh(env, ["clone", "-q", env.paths.projectGit, c2r]);
    writeFileSync(join(c2r, "c2.txt"), "2\n", "utf8");
    sh(env, ["add", "c2.txt"], c2r);
    sh(
      env,
      [
        "-c",
        "user.name=2",
        "-c",
        "user.email=2@localhost",
        "commit",
        "-qm",
        "c2",
      ],
      c2r,
    );
    const C2 = sh(env, ["rev-parse", "HEAD"], c2r) as Oid;
    // publish both candidates
    for (const [C, clone] of [
      [C1, c1r],
      [C2, c2r],
    ] as const) {
      const { content, exportRef } = makeBundle(env, clone, C, base);
      await env.git.submit(
        auth("a", ["git.submit"]),
        `pub-${C.slice(0, 8)}`,
        {
          candidate: C,
          exportRef,
          prerequisites: [base],
          to: ["b"],
          subject: "s",
          body: "",
          paths: [],
          bundle: {
            bytes: content.length,
            sha256: sha256Hex(content),
            mediaType: "application/x-git-bundle",
          },
        },
        iter(content),
      );
    }
    const r1 = await env.git.integrate(
      auth("a", ["code.integrate"]),
      "in1",
      { candidate: C1, expected: base },
      "p1",
      [],
    );
    assert.equal(r1.state, "succeeded");
    assert.equal(
      sh(env, [
        "--git-dir",
        env.paths.projectGit,
        "rev-parse",
        "refs/heads/main",
      ]),
      C1,
    );
    // C2 from stale base -> STALE_BASE, main untouched
    await assert.rejects(
      env.git.integrate(
        auth("a", ["code.integrate"]),
        "in2",
        { candidate: C2, expected: base },
        "p1",
        [],
      ),
      (e: unknown) => e instanceof StoreError && e.code === "STALE_BASE",
    );
    assert.equal(
      sh(env, [
        "--git-dir",
        env.paths.projectGit,
        "rev-parse",
        "refs/heads/main",
      ]),
      C1,
    );
    // not a descendant of current main -> NOT_DESCENDANT
    await assert.rejects(
      env.git.integrate(
        auth("a", ["code.integrate"]),
        "in3",
        { candidate: C2, expected: C1 },
        "p1",
        [],
      ),
      (e: unknown) => e instanceof StoreError && e.code === "NOT_DESCENDANT",
    );
    // protected path: candidate touching secret/ -> PROTECTED_PATH
    const c3r = join(env.dir, "c3");
    sh(env, ["clone", "-q", env.paths.projectGit, c3r]);
    mkdirSync(join(c3r, "secret"), { recursive: true });
    writeFileSync(join(c3r, "secret", "key.txt"), "k\n", "utf8");
    sh(env, ["add", "-A"], c3r);
    sh(
      env,
      [
        "-c",
        "user.name=3",
        "-c",
        "user.email=3@localhost",
        "commit",
        "-qm",
        "c3",
      ],
      c3r,
    );
    const C3 = sh(env, ["rev-parse", "HEAD"], c3r) as Oid;
    const { content, exportRef } = makeBundle(env, c3r, C3, C1);
    await env.git.submit(
      auth("a", ["git.submit"]),
      "pubc3",
      {
        candidate: C3,
        exportRef,
        prerequisites: [C1],
        to: ["b"],
        subject: "s",
        body: "",
        paths: [],
        bundle: {
          bytes: content.length,
          sha256: sha256Hex(content),
          mediaType: "application/x-git-bundle",
        },
      },
      iter(content),
    );
    await assert.rejects(
      env.git.integrate(
        auth("a", ["code.integrate"]),
        "in4",
        { candidate: C3, expected: C1 },
        "p1",
        ["secret/"],
      ),
      (e: unknown) => e instanceof StoreError && e.code === "PROTECTED_PATH",
    );
    assert.equal(
      sh(env, [
        "--git-dir",
        env.paths.projectGit,
        "rev-parse",
        "refs/heads/main",
      ]),
      C1,
    );
  } finally {
    env.seal();
  }
});

test("T65/T67: context publish — unsafe paths/missing GOAL rejected; concurrent same-expected one succeeds", async () => {
  const env = envOf();
  try {
    for (const entries of [
      [{ path: "../evil", bytes: 1, sha256: "0".repeat(64) }],
      [{ path: "notes.md", bytes: 2, sha256: "1".repeat(64) }], // no GOAL.md
    ] as const) {
      await assert.rejects(
        env.git.publishContext(
          auth("principal", ["context.publish"]),
          `ctx-${Math.random()}`,
          {
            expected: null,
            entries: entries as never,
            content: {
              bytes: 0,
              sha256: "0".repeat(64),
              mediaType: "application/vnd.oma.context-v1",
            },
          },
          iter(Buffer.alloc(0)),
        ),
        (e: unknown) => e instanceof StoreError && e.code === "INVALID_REQUEST",
      );
    }
    // valid first publish: GOAL.md only
    const goal = Buffer.from("# GOAL\n", "utf8");
    const r1 = await env.git.publishContext(
      auth("principal", ["context.publish"]),
      "ctx1",
      {
        expected: null,
        entries: [
          { path: "GOAL.md", bytes: goal.length, sha256: sha256Hex(goal) },
        ],
        content: {
          bytes: goal.length,
          sha256: sha256Hex(goal),
          mediaType: "application/vnd.oma.context-v1",
        },
      },
      iter(goal),
    );
    assert.equal(r1.state, "succeeded");
    const rev1 = (r1.result as { revision: string }).revision;
    assert.equal(
      existsSync(
        join(
          env.dir,
          "state",
          "world",
          "context",
          "revisions",
          rev1,
          "GOAL.md",
        ),
      ),
      true,
    );
    assert.equal(
      readFileSync(
        join(env.dir, "state", "world", "context", "current"),
        "utf8",
      ),
      `revisions/${rev1}`,
    );
    // T67: concurrent publish of the SAME expected -> one succeeds, the other CONTEXT_CONFLICT
    const g2 = Buffer.from("# GOAL v2\n", "utf8");
    const attempt = async (
      key: string,
      expected: string | null,
    ): Promise<"succeeded" | "conflict" | "other"> => {
      try {
        const r = await env.git.publishContext(
          auth("principal", ["context.publish"]),
          key,
          {
            expected: expected as Oid | null,
            entries: [
              { path: "GOAL.md", bytes: g2.length, sha256: sha256Hex(g2) },
            ],
            content: {
              bytes: g2.length,
              sha256: sha256Hex(g2),
              mediaType: "application/vnd.oma.context-v1",
            },
          },
          iter(g2),
        );
        return r.state === "succeeded" ? "succeeded" : "other";
      } catch (e) {
        return e instanceof StoreError && e.code === "CONTEXT_CONFLICT"
          ? "conflict"
          : "other";
      }
    };
    const [ok1, ok2] = await Promise.all([
      attempt("ctx2a", rev1 as Oid),
      attempt("ctx2b", rev1 as Oid),
    ]);
    // with the same expected revision only one CAS can win; the loser is CONTEXT_CONFLICT
    assert.deepEqual([ok1, ok2].sort(), ["conflict", "succeeded"]);
  } finally {
    env.seal();
  }
});

function sha256Hex(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}
