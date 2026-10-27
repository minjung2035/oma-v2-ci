import { spawnSync } from "node:child_process";
import { prepareHostProjectDirectory } from "@oma/platform-mac/files";
/** Real Git identities over controlled bookmarks; no native Mac/VM claim. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { MacGit } from "@oma/git/host-project";
import { newHostRecord, readHostRecord, writeHostRecord, type ProjectRecord } from "@oma/platform-mac/record";
import { macProjectExtensionSeed } from "#oma-test/app/platform/host/personal-seed";
import { bundledProjectBookmarks, nativeProjectBookmarks } from "@oma/platform-mac/bookmark";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";

async function world(t: import("node:test").TestContext, format: "sha1" | "sha256" = "sha1") {
  const dir = mkdtempSync(join(tmpdir(), "oma-mac-seed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = new MacGit("/usr/bin/git", prepareHostProjectDirectory);
  const make = async (name: string) => {
    const repo = join(dir, name); mkdirSync(repo);
    const prepare = (args: string[]) => spawnSync("/usr/bin/git", ["-C", repo, ...args], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    assert.equal(prepare(["init", "-q", "-b", "main", `--object-format=${format}`]).status, 0);
    writeFileSync(join(repo, "a"), name);
    assert.equal(prepare(["add", "a"]).status, 0);
    assert.equal(prepare(["-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", name]).status, 0);
    return repo;
  };
  const repo = await make("project"), location = new Map<string, string>();
  const bookmark = Buffer.from("controlled bookmark").toString("base64"); location.set(bookmark, repo);
  const project: ProjectRecord = { ...(await git.identity(repo)), projectId: randomUUID(), society: "demo",
    displayName: "Project", bookmark };
  const record = { ...newHostRecord(), projects: [project] };
  writeHostRecord(join(dir, "host-record.json"), record);
  const bookmarks = { create: async () => bookmark, resolve: async (saved: string) => {
    const found = location.get(saved); if (!found) throw new Error("unobserved bookmark"); return found;
  } };
  const calls: string[] = [];
  const observation = { git, bookmarks, request: async (id: string) => {
    calls.push(id); return { extensions: [DEPLOYMENT_LAYOUT.extension, "extensions/user.js", "packages:pkg/tool.js"] };
  } };
  return { dir, repo, project, record, make, location, observation, calls };
}

for (const format of ["sha1", "sha256"] as const)
  test(`DR29/MAC-401,403: ${format} first choice follows its bookmark and refuses another repo`, async t => {
    const w = await world(t, format);
    assert.deepEqual(await macProjectExtensionSeed(w.dir, w.repo, "/not-a-bundle", w.observation),
      ["extensions/user.js", "packages:pkg/tool.js"]);
    const moved = join(w.dir, "moved"); renameSync(w.repo, moved); w.location.set(w.project.bookmark, moved);
    mkdirSync(join(moved, "subdir"));
    assert.deepEqual(await macProjectExtensionSeed(w.dir, join(moved, "subdir"), "/not-a-bundle", w.observation),
      ["extensions/user.js", "packages:pkg/tool.js"]);
    const other = await w.make("other"); w.location.set(w.project.bookmark, other);
    await assert.rejects(macProjectExtensionSeed(w.dir, other, "/not-a-bundle", w.observation), { code: "INVALID_REQUEST" });
    assert.equal(w.calls.length, 2, "replacement must not reach guest settings");
    assert.deepEqual(readHostRecord(join(w.dir, "host-record.json")), w.record);
  });

test("DR29/MODE-006: unknown and malformed observations never become empty project choices", async t => {
  const w = await world(t);
  const problem = new Error("guest unobserved");
  await assert.rejects(macProjectExtensionSeed(w.dir, w.repo, "/fixture", { ...w.observation,
    request: async () => { throw problem; } }), value => value === problem);
  for (const extensions of [null, ["../escape"], ["extensions/a.js", "extensions/a.js"], [false]])
    await assert.rejects(macProjectExtensionSeed(w.dir, w.repo, "/fixture", { ...w.observation,
      request: async () => ({ extensions }) }), { code: "BROKER_UNAVAILABLE" });
  assert.deepEqual(await macProjectExtensionSeed(w.dir, w.dir, "/fixture", w.observation), []);
  assert.equal(w.calls.length, 0, "a known unrelated folder needs no guest request");
  w.location.clear();
  await assert.rejects(macProjectExtensionSeed(w.dir, w.repo, "/fixture", w.observation), /unobserved bookmark/);
});

test("DR29/MAC-401: legacy absence is empty; malformed project facts remain corrupt", async t => {
  const w = await world(t);
  const path = join(w.dir, "host-record.json");
  const { projects: _projects, ...old } = w.record;
  writeFileSync(path, JSON.stringify(old));
  assert.deepEqual(readHostRecord(path)!.projects, []);
  assert.deepEqual(await macProjectExtensionSeed(w.dir, w.repo, "/not-a-bundle"), []);
  for (const projects of [null, [{}], [w.project, w.project], [{ ...w.project, rootCommits: [] }],
    [{ ...w.project, bookmark: "not base64!" }]]) {
    writeFileSync(path, JSON.stringify({ ...old, projects }));
    assert.throws(() => readHostRecord(path), { code: "STORE_CORRUPT" });
  }
});

test("DR29/MAC-401: bookmark helper is a one-shot bundle operation and invalid output is unknown", async t => {
  const w = await world(t);
  assert.throws(() => bundledProjectBookmarks("/not-a-bundle"), { code: "UNSUPPORTED_PROFILE" });
  const helper = join(w.dir, "helper");
  writeFileSync(helper, '#!/bin/sh\n[ "$#" = 1 ] && [ "$1" = --project-bookmark ] || exit 3\ncat >/dev/null\nprintf \'{"bookmark":"YQ=="}\'\n', { mode: 0o700 });
  assert.equal(await nativeProjectBookmarks(helper).create(w.repo), "YQ==");
  writeFileSync(helper, '#!/bin/sh\ncat >/dev/null\nprintf \'{"path":"/fixture"}\'\n', { mode: 0o700 });
  assert.equal(await nativeProjectBookmarks(helper).resolve("YQ=="), "/fixture");
  for (const body of ['printf \'{}\'', 'printf \'{"path":"relative"}\'', 'exit 1']) {
    writeFileSync(helper, `#!/bin/sh\ncat >/dev/null\n${body}\n`, { mode: 0o700 });
    await assert.rejects(nativeProjectBookmarks(helper).resolve("YQ=="), { code: "BROKER_UNAVAILABLE" });
  }
});
