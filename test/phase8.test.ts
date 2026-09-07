// Phase 8 acceptance: reconcile recovers pending mail/git effects, never
// overwrites moved refs, and surfaces start-limits without reset (T68 core).
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
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule } from "../src/units.js";
import { ReconcileModule } from "../src/reconcile.js";
import { GitModule, type GitPaths } from "../src/git.js";
import type { Capability } from "../implementation/contracts.js";
import { generateOperationId, generateMessageId } from "../src/ids.js";

const G = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

interface Env {
  dir: string;
  store: Store;
  mail: MailModule;
  units: UnitsModule;
  git: GitModule | null;
  recon: ReconcileModule;
  seal: () => void;
}

function envOf(withGit: boolean): Env {
  const dir = mkdtempSync(join(tmpdir(), "oma-t8-"));
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
    { stateRoot: join(dir, "state"), society: "demo" },
    store,
    64,
  );
  const units = new UnitsModule(
    "demo",
    {
      node: process.execPath,
      libdir: "/l",
      state: join(dir, "state"),
      society: "demo",
      agent: "",
    },
    join(dir, "xdg"),
  );
  let git: GitModule | null = null;
  if (withGit) {
    const paths: GitPaths = {
      stateRoot: join(dir, "state"),
      projectGit: join(dir, "state", "repos", "project.git"),
      contextGit: join(dir, "state", "repos", "context.git"),
      worldDir: join(dir, "state", "world"),
      society: "demo",
      quarantineTmpBytes: 1,
      checkTimeoutSeconds: 30,
    };
    git = new GitModule(paths, store, mail, null);
  }
  const recon = new ReconcileModule(store, mail, git, units, {
    projectGit: join(dir, "state", "repos", "project.git"),
  });
  return {
    dir,
    store,
    mail,
    units,
    git,
    recon,
    seal: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedBare(env: Env): string {
  const seedDir = join(env.dir, "seed");
  mkdirSync(seedDir, { recursive: true });
  const sh = (args: string[], cwd?: string): string => {
    const r = spawnSync("git", args, { cwd, env: G, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git: ${r.stderr}`);
    return (r.stdout ?? "").trim();
  };
  sh(["init", "-q", "-b", "main"], seedDir);
  writeFileSync(join(seedDir, "b.txt"), "b\n", "utf8");
  sh(["add", "-A"], seedDir);
  sh(
    [
      "-c",
      "user.name=O",
      "-c",
      "user.email=o@localhost",
      "commit",
      "-qm",
      "base",
    ],
    seedDir,
  );
  const base = sh(["rev-parse", "HEAD"], seedDir);
  const projectGit = join(env.dir, "state", "repos", "project.git");
  sh(["clone", "-q", "--bare", seedDir, projectGit]);
  sh(["--git-dir", projectGit, "symbolic-ref", "HEAD", "refs/heads/main"]);
  return base;
}

const auth = {
  actor: "a",
  incarnation: 1,
  role: "resident" as const,
  channel: "actor" as const,
  capabilities: new Set<Capability>(),
  peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
};

async function* iter(b: Buffer): AsyncIterable<Uint8Array> {
  yield b;
}

// ---------------------------------------------------------------------------

test("T68a: reconcile startup completes a pending accepted mail (accepted-before-materialize fixture)", async () => {
  const env = envOf(false);
  try {
    const receipt = await env.mail.send(auth, "k1", {
      to: ["b"],
      subject: "s",
      kind: "message",
      body: "x",
    });
    assert.equal(receipt.state, "succeeded"); // normal path already completes
    // simulate an accepted-pending mail op: freeze object, mark deliveries pending
    const opId = generateOperationId();
    const mid = generateMessageId(opId, 0);
    const eml = { text: "test eml" };
    env.mail.freezeObject(mid, eml);
    env.store.transaction((_t) => {
      env.store.insertOperation({
        id: opId,
        actor: "a",
        requestKey: "kp",
        requestHash: "h",
        kind: "mail.send",
        payloadJson: "{}",
        planJson: JSON.stringify({ kind: "mail.send", message: { id: mid } }),
      });
      env.store.insertDeliveries([
        { messageId: mid, recipient: "b", operationId: opId },
      ]);
    });
    const before = env.store.transaction((_t) =>
      env.store.getOperationById(opId),
    )!;
    assert.equal(before.state, "pending");
    const res = await env.recon.startup();
    void res;
    const after = env.store.transaction((_t) =>
      env.store.getOperationById(opId),
    )!;
    assert.equal(after.state, "succeeded");
    assert.equal(
      existsSync(join(env.dir, "state", "mail", "archive", "cur")),
      true,
    );
  } finally {
    env.seal();
  }
});

test("T68b: reconcile never overwrites a moved published ref; ref==candidate recovers", async () => {
  const env = envOf(true);
  try {
    const base = seedBare(env);
    // candidate clone + bundle via the git module (T54 path)
    const clone = join(env.dir, "cl");
    const sh = (args: string[], cwd?: string): string => {
      const r = spawnSync("git", args, { cwd, env: G, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git: ${r.stderr}`);
      return (r.stdout ?? "").trim();
    };
    sh([
      "clone",
      "-q",
      "--no-local",
      join(env.dir, "state", "repos", "project.git"),
      clone,
    ]);
    writeFileSync(join(clone, "f.txt"), "f\n", "utf8");
    sh(["add", "f.txt"], clone);
    sh(
      [
        "-c",
        "user.name=A",
        "-c",
        "user.email=a@localhost",
        "commit",
        "-qm",
        "f",
      ],
      clone,
    );
    const C = sh(["rev-parse", "HEAD"], clone);
    sh(["update-ref", "refs/oma/export/req-1", C], clone);
    const bundle = join(env.dir, "up.bundle");
    sh(
      ["bundle", "create", bundle, "refs/oma/export/req-1", `^${base}`],
      clone,
    );
    const content = readFileSync(bundle) as Buffer;
    const sha = (b: Buffer): string =>
      createHash("sha256").update(b).digest("hex");
    const receipt = await env.git!.submit(
      { ...auth, capabilities: new Set(["git.submit"]) },
      "ks",
      {
        candidate: C,
        exportRef: "refs/oma/export/req-1",
        prerequisites: [base],
        to: ["b"],
        subject: "s",
        body: "",
        paths: [],
        bundle: {
          bytes: content.length,
          sha256: sha(content),
          mediaType: "application/x-git-bundle",
        },
      },
      iter(content),
    );
    assert.equal(receipt.state, "succeeded");
    // moved ref + a fresh pending op: sweep must not touch it
    const pubRef = (receipt.result as { publishedRef: string }).publishedRef;
    sh([
      "--git-dir",
      join(env.dir, "state", "repos", "project.git"),
      "update-ref",
      pubRef,
      base,
    ]);
    const pendId = "op-reconcile-pend";
    env.store.transaction((_t) => {
      env.store.insertOperation({
        id: pendId,
        actor: "a",
        requestKey: "km",
        requestHash: "h",
        kind: "git.submit",
        payloadJson: "{}",
        planJson: JSON.stringify({
          kind: "git.submit",
          candidate: C,
          exportRef: "x",
          prerequisites: [],
          bundle: null,
          publishedRef: pubRef,
          message: null,
        }),
      });
    });
    const res = await env.recon.sweep();
    assert.equal(
      sh([
        "--git-dir",
        join(env.dir, "state", "repos", "project.git"),
        "rev-parse",
        pubRef,
      ]),
      base,
    );
    assert.equal(
      env.store.transaction((_t) => env.store.getOperationById(pendId))!.state,
      "pending",
    );
    assert.ok(res.examined >= 1);
  } finally {
    env.seal();
  }
});

test("T68c: canonical repo integrity is asserted; start-limit surface reported without reset", () => {
  const env = envOf(true);
  try {
    seedBare(env);
    env.recon.assertCanonicalHealthy(); // clean repo passes
    assert.deepEqual(env.recon.startLimitState(), []); // no units installed => none
  } finally {
    env.seal();
  }
});
