import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultSocietyFor, sessionSocietyName } from "../src/config/defaults.js";
import { isValidSocietyName } from "../src/domain/identifiers.js";
import { removeUnusedTree } from "../src/storage/directory.js";
import { projectSettingsPath, sessionConfigOf } from "../src/tui/sources/settings.js";
import { defaultHostConfig } from "../src/config/defaults.js";

test("DR24: every session of a project has a society name of its own, valid, and named for its project", () => {
  const project = defaultSocietyFor("/home/me/a-very-long-project-directory-name", "f".repeat(64));
  const first = sessionSocietyName(project, Date.UTC(2026, 8, 29));
  const second = sessionSocietyName(project, Date.UTC(2026, 8, 29) + 1);
  for (const name of [first, second]) {
    assert.ok(isValidSocietyName(name), name);
    assert.ok(name.length <= 32, name);
    assert.ok(name.startsWith("a-very-long-p"), name);
  }
  assert.notEqual(first, second);
  assert.equal(sessionSocietyName("demo", 0), "demo-0");
});

test("DR24: a session's configuration is the project's, with its own name, rootfs and installation", () => {
  const project = defaultHostConfig({ society: "proj", node: "/old/node", libdir: "/old/", rootfs: "/data/proj/rootfs", deploymentDigest: "a".repeat(64) });
  const own = { society: "proj-1", node: "/usr/bin/node", libdir: "/opt/oma/", rootfs: "/data/proj-1/rootfs", deploymentDigest: "b".repeat(64) };
  const session = sessionConfigOf({ ...project, quota: { ...project.quota, societyAgents: 6 } }, own);
  assert.equal(session.society, "proj-1");
  assert.deepEqual(session.installation, { node: own.node, libdir: own.libdir, rootfs: own.rootfs, deploymentDigest: own.deploymentDigest });
  assert.equal(session.quota.societyAgents, 6, "a project setting holds in the session");
  assert.equal(projectSettingsPath("/data/oma", "proj"), "/data/oma/.projects/proj/config.json");
});

test("DR24: an unused session's tree goes whole -- its links and sockets unlinked, never followed", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-unused-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const outside = join(root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "keep"), "kept");
  const session = join(root, "session");
  mkdirSync(join(session, "rootfs", "usr", "bin"), { recursive: true });
  writeFileSync(join(session, "config.json"), "{}");
  symlinkSync("usr/bin", join(session, "rootfs", "bin"));
  symlinkSync(outside, join(session, "rootfs", "escape"));
  const server = createServer();
  await new Promise<void>(resolve => server.listen(join(session, "broker.sock"), resolve));
  t.after(() => server.close());
  removeUnusedTree(session);
  assert.equal(existsSync(session), false);
  assert.equal(existsSync(join(outside, "keep")), true, "a link was followed out of the tree");
  removeUnusedTree(session); // gone already: nothing to do
});
