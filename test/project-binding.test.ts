// V16A/V16B (WP16, D05): project identity, binding and source-preserving provisioning.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSocietyFor as deriveSociety } from "@oma/config/defaults";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ACTOR_NAME_RE } from "@oma/domain/identifiers";
import {
  observeProjectBinding, projectBindingDecision, provisionSociety, publishProjectBinding, stateRootHasSociety, PROJECT_BINDING,
} from "#oma-test/app/runtime/provision";
import { StoreError } from "@oma/domain/errors";

// The entry adapter digests the canonical path; the derivation itself is pure.
const defaultSocietyFor = (path: string) => deriveSociety(path, sha256Hex(Buffer.from(path, "utf8")));
const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "oma-v16-")));
const git = (cwd: string, ...args: string[]) => {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
};
function repository(path: string, content = "x\n"): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  writeFileSync(join(path, "f.txt"), content);
  git(path, "add", ".");
  git(path, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "c");
  return git(path, "rev-parse", "HEAD");
}
const cleanup = (root: string) => { spawnSync("chmod", ["-R", "u+rwX", root]); rmSync(root, { recursive: true, force: true }); };
const code = (value: string) => (error: unknown) => error instanceof StoreError && error.code === value;

test("V16A: different canonical projects get different default societies; aliases of one project get the same", () => {
  const root = scratch();
  try {
    const a = join(root, "one", "app"); const b = join(root, "two", "app");
    repository(a); repository(b);
    const long = (tail: string) => join(root, `project-with-a-rather-long-name-${tail}`);
    const names = [a, b, join(root, "프로젝트"), join(root, "..."), long("alpha"), long("beta")];
    const societies = names.map(path => defaultSocietyFor(path));
    for (const society of societies) {
      assert.match(society, ACTOR_NAME_RE, society);
      assert.ok(society.length <= 32);
    }
    assert.equal(new Set(societies).size, names.length, "two projects shared a default society");
    assert.match(societies[2]!, /^project-[0-9a-f]{16}$/, "a name with no ASCII slug falls back to project");
    assert.equal(societies[4]!.split("-").slice(0, -1).join("-"), societies[5]!.split("-").slice(0, -1).join("-"), "both keep the same 15-character slug");
    // One project through an alias is still that project once canonicalised.
    const alias = join(root, "alias");
    symlinkSync(a, alias);
    assert.equal(defaultSocietyFor(realpathSync(alias)), societies[0]);
    assert.throws(() => deriveSociety(a, "not-a-digest"));
  } finally { cleanup(root); }
});

test("V16A: a binding is compared in full, so a truncated-identity collision cannot take over another project's society", () => {
  const root = scratch();
  try {
    const state = join(root, "oma", "same-0000000000000000");
    publishProjectBinding(state, { society: "same-0000000000000000", canonicalProjectPath: "/projects/a" });
    assert.equal(statSync(state).mode & 0o777, 0o700);
    assert.equal(statSync(join(state, PROJECT_BINDING)).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(state), [PROJECT_BINDING], "no temporary is left");
    const observation = observeProjectBinding(state);
    for (const bindRequested of [false, true]) {
      const decision = projectBindingDecision({ observation, society: "same-0000000000000000", canonicalProjectPath: "/projects/b",
        hasSociety: true, bindRequested });
      assert.equal(decision.kind, "refuse", "a colliding name was accepted for another project");
    }
    assert.equal(projectBindingDecision({ observation, society: "other", canonicalProjectPath: "/projects/a", hasSociety: true, bindRequested: false }).kind, "refuse");
    assert.equal(projectBindingDecision({ observation, society: "same-0000000000000000", canonicalProjectPath: "/projects/a", hasSociety: true, bindRequested: false }).kind, "proceed");
    // Publishing again: the same binding is adopted, another is refused.
    publishProjectBinding(state, { society: "same-0000000000000000", canonicalProjectPath: "/projects/a" });
    assert.throws(() => publishProjectBinding(state, { society: "same-0000000000000000", canonicalProjectPath: "/projects/b" }), code("POLICY_CHANGED"));
    assert.match(readFileSync(join(state, PROJECT_BINDING), "utf8"), /\/projects\/a/);
    // A binding that is not the closed record is unreadable, and refused.
    writeFileSync(join(state, PROJECT_BINDING), JSON.stringify({ kind: "oma-project-binding-v1", society: "same-0000000000000000", canonicalProjectPath: "/projects/a", extra: 1 }));
    assert.equal(observeProjectBinding(state).kind, "unreadable");
    assert.equal(projectBindingDecision({ observation: observeProjectBinding(state), society: "same-0000000000000000",
      canonicalProjectPath: "/projects/a", hasSociety: true, bindRequested: true }).kind, "refuse");
  } finally { cleanup(root); }
});

test("V16B: an existing unbound society is bound only on explicit request; a fresh one is bound at once", () => {
  const root = scratch();
  try {
    const fresh = join(root, "oma", "fresh");
    assert.equal(stateRootHasSociety(fresh), false);
    assert.equal(projectBindingDecision({ observation: observeProjectBinding(fresh), society: "fresh", canonicalProjectPath: "/p",
      hasSociety: false, bindRequested: false }).kind, "publish");
    const legacy = join(root, "oma", "legacy");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "runtime.sqlite"), "");
    assert.equal(stateRootHasSociety(legacy), true);
    const input = { observation: observeProjectBinding(legacy), society: "legacy", canonicalProjectPath: "/p", hasSociety: true };
    assert.equal(projectBindingDecision({ ...input, bindRequested: false }).kind, "refuse");
    assert.equal(projectBindingDecision({ ...input, bindRequested: true }).kind, "publish");
  } finally { cleanup(root); }
});

test("V16B: provisioning never reseeds an existing canonical main from another project", () => {
  const root = scratch();
  try {
    const first = repository(join(root, "a"), "a\n");
    repository(join(root, "b"), "b\n");
    const state = join(root, "state");
    assert.equal(provisionSociety(state, { projectDir: join(root, "a") }).seedSource, "project");
    const main = git(root, "--git-dir", join(state, "repos", "project.git"), "rev-parse", "refs/heads/main");
    assert.equal(main, first);
    const again = provisionSociety(state, { projectDir: join(root, "b") });
    assert.equal(again.seeded, false);
    assert.equal(git(root, "--git-dir", join(state, "repos", "project.git"), "rev-parse", "refs/heads/main"), first);
  } finally { cleanup(root); }
});

test("V16B: an unreadable project or a broken canonical repository fails provisioning instead of seeding an empty root", () => {
  const root = scratch();
  try {
    // A project whose repository cannot be read is not "a directory with no commits".
    const project = join(root, "locked");
    repository(project);
    chmodSync(join(project, ".git"), 0o000);
    const state = join(root, "state-locked");
    assert.throws(() => provisionSociety(state, { projectDir: project }), code("STORE_CORRUPT"));
    const canonical = join(state, "repos", "project.git");
    if (existsSync(canonical)) {
      const main = spawnSync("git", ["--git-dir", canonical, "rev-parse", "--verify", "--quiet", "refs/heads/main"], { encoding: "utf8" });
      assert.notEqual(main.status, 0, "an empty root was seeded over an unreadable project");
    }
    chmodSync(join(project, ".git"), 0o755);
    // A canonical repository that exists but cannot be read is not "no main".
    const broken = join(root, "state-broken");
    mkdirSync(join(broken, "repos", "project.git"), { recursive: true });
    writeFileSync(join(broken, "repos", "project.git", "HEAD"), "garbage\n");
    assert.throws(() => provisionSociety(broken, { projectDir: project }), code("STORE_CORRUPT"));
    assert.equal(readFileSync(join(broken, "repos", "project.git", "HEAD"), "utf8"), "garbage\n", "the broken repository was rewritten");
    // A readable repository whose main ref is broken is not "no main" either:
    // nothing is written into it, not even the objects an empty seed would make.
    const brokenRef = join(root, "state-ref");
    mkdirSync(join(brokenRef, "repos"), { recursive: true });
    const refRepo = join(brokenRef, "repos", "project.git");
    git(root, "init", "-q", "--bare", "-b", "main", refRepo);
    writeFileSync(join(refRepo, "refs", "heads", "main"), "garbage\n");
    const objects = () => spawnSync("find", [join(refRepo, "objects"), "-type", "f"], { encoding: "utf8" }).stdout;
    const before = objects();
    const plainProject = join(root, "plain-for-ref"); mkdirSync(plainProject);
    assert.throws(() => provisionSociety(brokenRef, { projectDir: plainProject }), code("STORE_CORRUPT"));
    assert.equal(objects(), before, "objects were written into a repository whose main could not be read");
    // A directory that is not a repository, or has no commit yet, still starts empty.
    const plain = join(root, "plain"); mkdirSync(plain);
    assert.equal(provisionSociety(join(root, "state-plain"), { projectDir: plain }).seedSource, "empty");
    const unborn = join(root, "unborn"); mkdirSync(unborn); git(unborn, "init", "-q", "-b", "main");
    assert.equal(provisionSociety(join(root, "state-unborn"), { projectDir: unborn }).seedSource, "empty");
  } finally { cleanup(root); }
});

test("V16B: a leftover staging repository from an interrupted start is neither adopted nor fatal", () => {
  const root = scratch();
  try {
    const state = join(root, "state");
    mkdirSync(join(state, "repos", ".project.git.staging.0011223344556677"), { recursive: true });
    const head = repository(join(root, "p"));
    assert.equal(provisionSociety(state, { projectDir: join(root, "p") }).seedSource, "project");
    assert.equal(git(root, "--git-dir", join(state, "repos", "project.git"), "rev-parse", "refs/heads/main"), head);
  } finally { cleanup(root); }
});
