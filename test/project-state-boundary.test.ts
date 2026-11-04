/** #29: admission must precede any provisioning write inside project input. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGitText } from "@oma/process/policies";
import { assertProjectStateBoundary, provisionSociety } from "#oma-test/app/runtime/provision";

for (const relation of ["equal", "state-inside-project", "project-inside-state", "same-git-root"])
  test(`001. Project state boundary: ${relation} refuses before creating runtime files in project input`, t => {
    const root = mkdtempSync(join(tmpdir(), "oma-project-state-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const repo = join(root, "project");
    const project = relation === "same-git-root" ? join(repo, "subdirectory") : relation === "project-inside-state" ? join(root, "state", "project") : repo;
    const stateRoot = relation === "equal" ? project : relation === "project-inside-state" ? join(root, "state") : join(repo, "runtime");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "sentinel"), "unaltered project input");
    if (relation === "same-git-root") assert.equal(runGitText(["init", "--quiet", repo]).status, 0);
    assert.throws(() => provisionSociety(stateRoot, { projectDir: project, conversationOnly: true }), { code: "UNSUPPORTED_PROFILE" });
    assert.equal(existsSync(join(stateRoot, "repos")), false, "the refusal must precede owned-state directory creation");
    assert.equal(readFileSync(join(project, "sentinel"), "utf8"), "unaltered project input");
  });

test("002. A disjoint sibling sharing a textual path prefix remains supported", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-project-state-control-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project"), stateRoot = join(root, "project-state");
  mkdirSync(project);
  assert.doesNotThrow(() => provisionSociety(stateRoot, { projectDir: project, conversationOnly: true }));
  assert.equal(existsSync(join(stateRoot, "repos")), true);
});

/** AUD-05: the boundary is the physical trees, not the spellings. Before this
 * repair the same physical state root was refused under its canonical
 * spelling and admitted under a symlinked alias, whose Git snapshot at the
 * repository top would then carry the private state out of the project. */
test("003. A not-yet-created state root spelled through a symlinked ancestor into the project is refused", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-project-state-alias-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, "real"), project = join(real, "project"), alias = join(root, "alias");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "sentinel"), "unaltered project input");
  assert.equal(runGitText(["init", "--quiet", project]).status, 0);
  symlinkSync(real, alias);
  assert.throws(() => assertProjectStateBoundary(project, join(project, "private-state")), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => assertProjectStateBoundary(project, join(alias, "project", "private-state")), { code: "UNSUPPORTED_PROFILE" });
  symlinkSync(alias, join(root, "alias-of-alias"));
  assert.throws(() => assertProjectStateBoundary(project, join(root, "alias-of-alias", "project", "private-state")), { code: "UNSUPPORTED_PROFILE" });
  for (const projectDir of [project, join(alias, "project")])
    assert.throws(() => provisionSociety(join(alias, "project", "private-state"), { projectDir, conversationOnly: true }), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(existsSync(join(project, "private-state", "repos")), false, "the refusal precedes any state creation through the alias");
  assert.equal(readFileSync(join(project, "sentinel"), "utf8"), "unaltered project input");
});

test("004. A project inside an alias-reached state root is refused in the other direction", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-project-state-reverse-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, "real"), project = join(real, "project"), alias = join(root, "alias");
  mkdirSync(project, { recursive: true });
  assert.equal(runGitText(["init", "--quiet", project]).status, 0);
  symlinkSync(real, alias);
  assert.throws(() => assertProjectStateBoundary(join(alias, "project"), real), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => provisionSociety(real, { projectDir: join(alias, "project"), conversationOnly: true }), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(existsSync(join(project, "repos")), false, "the project input is not written through the alias");
});

test("005. A state root that is itself an existing link into the project is refused", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-project-state-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project"), target = join(project, "runtime"), link = join(root, "state");
  mkdirSync(target, { recursive: true });
  symlinkSync(target, link);
  assert.throws(() => assertProjectStateBoundary(project, link), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => provisionSociety(link, { projectDir: project, conversationOnly: true }), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(existsSync(join(target, "repos")), false);
});

test("006. A state name inside the project stays refused even while a link points outside", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-project-state-spelled-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project"), outside = join(root, "outside"), state = join(project, "state");
  mkdirSync(project); mkdirSync(outside);
  symlinkSync(outside, state);
  assert.throws(() => assertProjectStateBoundary(project, state), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => provisionSociety(state, { projectDir: project, conversationOnly: true }), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(existsSync(join(outside, "repos")), false);
});

test("007. An alias of an unrelated data root is not refused, and its not-yet-created leaf still provisions", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-project-state-legit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, "real"), project = join(real, "project"), alias = join(root, "alias"), data = join(real, "data");
  mkdirSync(project, { recursive: true }); mkdirSync(data);
  assert.equal(runGitText(["init", "--quiet", project]).status, 0);
  symlinkSync(real, alias);
  assert.doesNotThrow(() => assertProjectStateBoundary(project, join(alias, "society-a")));
  assert.doesNotThrow(() => assertProjectStateBoundary(join(alias, "project"), join(data, "society-a")));
  assert.doesNotThrow(() => provisionSociety(join(data, "society-a"), { projectDir: join(alias, "project"), conversationOnly: true }));
  assert.equal(existsSync(join(data, "society-a", "repos")), true, "the leaf is created under the physical state root");
});

test("008. An unresolvable state root link is refused, never admitted lexically", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-project-state-dangling-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project"), dangling = join(root, "dangling");
  mkdirSync(project);
  symlinkSync(join(root, "missing"), dangling);
  assert.throws(() => assertProjectStateBoundary(project, dangling), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => provisionSociety(dangling, { projectDir: project, conversationOnly: true }), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(existsSync(join(root, "missing", "repos")), false);
});
