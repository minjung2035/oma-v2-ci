import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { loadConfiguration, loadConfigurationSnapshot } from "../src/config.js";
import { DurabilityFaultError, type DurabilityFault } from "../src/storage/durable-fs.js";
import { CORE_EXTENSION, readExtensions, toggleExtension } from "../src/tui/sources/extensions.js";
import { commitRoleSet, deriveSessionSettings, projectBundle, readSettings, readSettingsForEditing, roleSetOf, writeSettings } from "../src/tui/sources/settings.js";
import { PACKAGE_INDEX, PACKAGE_INDEX_BYTES, packageCommand, packageResourcePaths, readPackageIndex, reconciledEntries, writePackageIndex, type InstalledPackage } from "../src/runtime/pi-packages.js";
import { sessionArgv } from "../src/tui/session.js";
import { planPiSpawn } from "../src/runtime/pi-spawn-plan.js";
import { decodeRunLease } from "../src/protocol/run-lease.js";
import { applyPackageChange } from "../src/tui/project-settings.js";
import { RESIDENT_PATHS, confinedPath } from "../src/sandbox.js";
import { actorSocketPathAt, agentRootPathAt, projectGitPathAt, projectMirrorPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "../src/storage/paths.js";
import { runEngineLogin } from "../src/tui/login.js";
import { assertExtensionIntegrity } from "../src/runtime/extension-integrity.js";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync } from "node:fs";

const HELLO = "packages:npm/node_modules/oma-hello-ext/extensions/hello.ts";

/** A package store laid out as the engine's package manager installs into it. */
function store(root: string, packages: Record<string, Record<string, string>>): string {
  const dir = join(root, "packages");
  for (const [name, files] of Object.entries(packages)) for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, "npm", "node_modules", name, file, ".."), { recursive: true });
    writeFileSync(join(dir, "npm", "node_modules", name, file), text);
  }
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: Object.keys(packages).map(name => `npm:${name}`) }));
  return dir;
}
const hello = { "package.json": JSON.stringify({ name: "oma-hello-ext", version: "1.0.0", pi: { extensions: ["./extensions/hello.ts"] } }),
  "extensions/hello.ts": "export default function (pi) { pi.registerCommand('hello-ext', { handler: async () => {} }); }\n" };

test("DR25: oma pi runs the engine's package commands over oma's store, and refuses what would reach past oma", () => {
  for (const args of [["install", "npm:@foo/bar@1.0.0"], ["install", "git:github.com/foo/bar"], ["install", "https://github.com/foo/bar"],
    ["remove", "npm:@foo/bar"], ["uninstall", "npm:@foo/bar"], ["update", "npm:@foo/bar"], ["update", "--extensions"],
    ["update", "--extension", "npm:@foo/bar"], ["list"], ["install", "--help"]]) {
    const decision = packageCommand(args);
    assert.equal(decision.kind, "run", args.join(" "));
  }
  assert.deepEqual(packageCommand(["uninstall", "npm:x"]), { kind: "run", command: "remove", args: ["uninstall", "npm:x"] });
  const refusals: [string[], RegExp][] = [
    [["install", "-l", "npm:x"], /project's local packages/], [["install", "--local", "npm:x"], /project's local packages/],
    [["remove", "-a", "npm:x"], /project's local packages/], [["install", "./local"], /local path/], [["install", "/abs/ext"], /local path/],
    [["install", "~/ext"], /local path/], [["install", "file:///x"], /local path/], [["install"], /one source/],
    [["update"], /updated with oma/], [["update", "pi"], /updated with oma/], [["update", "self"], /updated with oma/],
    [["update", "--self"], /updated with oma/], [["update", "--all"], /updated with oma/], [["update", "--models"], /updated with oma/],
    [["update", "npm:x", "--force"], /updated with oma/], [["config"], /Ctrl\+X > Config > Extensions/], [[], /package commands/],
    [["-p", "hi"], /oma is the session/], [["--model", "x"], /oma is the session/],
  ];
  for (const [args, reason] of refusals) {
    const decision = packageCommand(args);
    assert.equal(decision.kind, "refused", args.join(" "));
    assert.match(decision.kind === "refused" ? decision.words : "", reason, args.join(" "));
  }
});

test("DR25: a role's extension may name an installed package's file, pinned by digest, only inside the package store", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    f.edit("host.json", host => { host.installation.packages = packages; });
    f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION, HELLO]; });
    const loaded = loadConfiguration(f.path);
    const pinned = loaded.roles.resident!.extensions.find(item => item.path.endsWith("hello.ts"));
    assert.equal(pinned?.path, join(packages, "npm/node_modules/oma-hello-ext/extensions/hello.ts"));
    assert.match(pinned?.sha256 ?? "", /^[0-9a-f]{64}$/);
    // Without the store named, a package entry names nothing.
    f.edit("host.json", host => { delete host.installation.packages; });
    assert.throws(() => loadConfiguration(f.path), /needs installation\.packages/);
    // Out of the store, or through a link, is refused as a libdir entry would be.
    f.edit("host.json", host => { host.installation.packages = packages; });
    f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION, "packages:../escape.ts"]; });
    assert.throws(() => loadConfiguration(f.path), /normalized relative/);
    symlinkSync(join(packages, "npm/node_modules/oma-hello-ext/extensions/hello.ts"), join(packages, "linked.ts"));
    f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION, "packages:linked.ts"]; });
    assert.throws(() => loadConfiguration(f.path), /symlink/);
  } finally { f.close(); }
});

test("DR25: the engine names a package's extensions; the index keeps them by package, and roles follow a package through updates", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    const index = await writePackageIndex(packages);
    assert.deepEqual(index, [{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }]);
    assert.deepEqual(readPackageIndex(packages), index);
    // The index is the engine's answer as of the last change, asked again after
    // every one: a change whose index was not written yet is picked up by the next.
    store(f.root, { "oma-hello-ext": hello, "oma-two": { "package.json": JSON.stringify({ name: "oma-two", version: "1.0.0", pi: { extensions: ["./two.ts"] } }),
      "two.ts": "export default function () {}\n" } });
    assert.deepEqual(readPackageIndex(packages), index, "the index changed without being written");
    assert.deepEqual((await writePackageIndex(packages)).map(item => item.source), ["npm:oma-hello-ext", "npm:oma-two"]);
    assert.deepEqual(readPackageIndex(packages).find(item => item.source === "npm:oma-two")?.entries, ["packages:npm/node_modules/oma-two/two.ts"]);
    // A package that moved its extension, one removed, and an entry of no package.
    const before: InstalledPackage[] = [{ source: "npm:a", entries: ["packages:a/one.ts"] }, { source: "npm:b", entries: ["packages:b/x.ts"] }];
    const after: InstalledPackage[] = [{ source: "npm:a", entries: ["packages:a/two.ts", "packages:a/three.ts"] }];
    assert.deepEqual(reconciledEntries([CORE_EXTENSION, "packages:a/one.ts", "extensions/own.js", "packages:b/x.ts"], before, after),
      [CORE_EXTENSION, "packages:a/two.ts", "packages:a/three.ts", "extensions/own.js"]);
    assert.deepEqual(reconciledEntries([CORE_EXTENSION], before, after), [CORE_EXTENSION], "a package a role did not use is not turned on");
  } finally { f.close(); }
});

test("DR25: a project's inline settings become a managed bundle that runs as it did, and every session is made from it, roles and all", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    const projectPath = join(f.root, "project", "config.json");
    mkdirSync(join(f.root, "project"));
    writeSettings(projectPath, { ...f.config, installation: { ...f.config.installation, packages } });
    const before = loadConfiguration(projectPath);
    const project = projectBundle(projectPath);
    assert.equal(project.layout.kind, "operations");
    const bundle = loadConfiguration(projectPath);
    assert.deepEqual({ ...bundle.config, integration: { ...bundle.config.integration, policyRevision: "" } },
      { ...before.config, integration: { ...before.config.integration, policyRevision: "" } }, "the conversion changed the configuration");
    for (const role of Object.keys(f.config.agentProfiles)) {
      assert.deepEqual(bundle.roles[role]!.extensions.map(item => item.path), [join(f.installation, CORE_EXTENSION)], role);
      assert.equal(bundle.roles[role]!.prompt, "", role);
    }
    assert.equal(projectBundle(projectPath).layout.kind, "operations", "a bundle is left a bundle");

    // The Human turns the package on for the Workers, in the project.
    const context = readExtensions(readSettingsForEditing(projectPath).snapshot!, "principal", "resident", readPackageIndex(packages));
    assert.equal(context.rows.find(row => row.id === HELLO)?.source, undefined, "no index yet: not offered");
    const offered = readExtensions(readSettingsForEditing(projectPath).snapshot!, "principal", "resident",
      [{ source: "npm:oma-hello-ext", entries: [HELLO] }]);
    assert.deepEqual(offered.rows.find(row => row.id === HELLO), { id: HELLO, principal: false, workers: false, locked: false, source: "npm:oma-hello-ext" });
    toggleExtension(offered, HELLO, "workers", true);
    toggleExtension(readExtensions(readSettingsForEditing(projectPath).snapshot!, "principal", "resident",
      [{ source: "npm:oma-hello-ext", entries: [HELLO] }]), HELLO, "principal", true);

    // Each session, now and later, is made with the project's roles and its own installation.
    const own = { society: "demo-2", node: process.execPath, libdir: f.installation, rootfs: "/rootfs2", deploymentDigest: "b".repeat(64), packages };
    for (const society of ["demo-2", "demo-3"]) {
      const sessionPath = join(f.root, society, "config.json");
      mkdirSync(join(f.root, society), { recursive: true });
      const derived = deriveSessionSettings(readSettingsForEditing(projectPath), sessionPath, { ...own, society });
      assert.deepEqual(derived.missing, []);
      const session = loadConfiguration(sessionPath);
      assert.equal(session.config.society, society);
      assert.equal(session.config.installation.rootfs, "/rootfs2");
      for (const role of ["principal", "resident"])
        assert.ok(session.roles[role]!.extensions.some(item => item.path.endsWith("hello.ts")), `${society} ${role}`);
      assert.ok(!session.roles.verifier!.extensions.some(item => item.path.endsWith("hello.ts")), "a role the Human did not choose");
      // Made again from an unchanged project, the session is unchanged.
      const again = deriveSessionSettings(readSettingsForEditing(projectPath), sessionPath, { ...own, society });
      assert.equal(again.settings.layout.kind, "operations");
    }

    // The package's file gone: left out of the session and said, kept in the project.
    rmSync(join(packages, "npm"), { recursive: true });
    const sessionPath = join(f.root, "demo-4", "config.json");
    mkdirSync(join(f.root, "demo-4"));
    const derived = deriveSessionSettings(readSettingsForEditing(projectPath), sessionPath, { ...own, society: "demo-4" });
    assert.deepEqual(derived.missing, [HELLO]);
    assert.ok(!loadConfiguration(sessionPath).roles.resident!.extensions.some(item => item.path.endsWith("hello.ts")));
    const repair = readExtensions(readSettingsForEditing(projectPath).snapshot!, "principal", "resident", []);
    assert.equal(repair.mode, "repair", "the project's missing entry is offered for removal");
    assert.ok(repair.rows.find(row => row.id === HELLO)?.missing);
    assert.throws(() => readSettings(projectPath), "the project itself is not runnable until the entry is removed");
  } finally { f.close(); }
});

test("DR25: a Resident's paths reach the package store, and only it -- never the engine home beside it", () => {
  const host = { libdir: "/opt/install/", packages: "/data/oma/.packages" };
  const dirs = { workspace: "/s/w", home: "/s/h", archive: "/s/a", workerArchive: "/s/wa", selfMail: "/s/m", view: "/s/v", world: "/s/world",
    projectGit: "/s/git", projectMirror: "/s/mirror", sessions: "/s/sessions" };
  assert.equal(confinedPath(host, dirs, "/data/oma/.packages/npm/node_modules/x/ext.ts"), `${RESIDENT_PATHS.packages}/npm/node_modules/x/ext.ts`);
  assert.throws(() => confinedPath(host, dirs, "/data/oma/.engine/auth.json"), /outside every mount/);
  assert.throws(() => confinedPath({ libdir: host.libdir }, dirs, "/data/oma/.packages/npm/x.ts"), /outside every mount/);
});



test("DR25: an inline configuration crashed at any point of becoming a bundle is the whole old one or the whole new one, and the next start finishes it", () => {
  const points: DurabilityFault[] = [];
  const probe = createCompleteConfigurationFixture();
  try {
    const snapshot = loadConfigurationSnapshot(probe.input);
    commitRoleSet(snapshot, snapshot.config, roleSetOf(snapshot), fault => { points.push(fault); });
  } finally { probe.close(); }
  const published = points.findIndex(point => point.point === "derived-rename" && point.phase === "after-visible" && point.path.endsWith("legacy.json"));
  assert.ok(points.length >= 10 && published > 0, `durability points: ${points.length}, manifest at ${published}`);
  for (let crash = 0; crash < points.length; crash++) {
    const f = createCompleteConfigurationFixture();
    try {
      const before = loadConfigurationSnapshot(f.input);
      let seen = 0;
      assert.throws(() => commitRoleSet(before, before.config, roleSetOf(before), fault => {
        if (seen++ === crash) throw new DurabilityFaultError(fault);
      }), DurabilityFaultError);
      const after = loadConfigurationSnapshot(f.input);
      assert.equal(after.layout.kind, crash >= published ? "operations" : "inline", `crash ${crash} (${points[crash]!.point}/${points[crash]!.phase})`);
      assert.deepEqual({ ...after.config, integration: { ...after.config.integration, policyRevision: "" } },
        { ...before.config, integration: { ...before.config.integration, policyRevision: "" } }, "the configuration's meaning changed");
      // Whatever the crash left behind, the next start makes it the bundle it runs as.
      assert.equal(projectBundle(f.input).layout.kind, "operations");
      assert.deepEqual(loadConfiguration(f.input).roles.resident!.extensions.map(item => item.path), [join(f.installation, CORE_EXTENSION)]);
    } finally { f.close(); }
  }
});

test("DR25: a role set is committed only against the configuration it was read as, and one already there changes nothing", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const snapshot = loadConfigurationSnapshot(f.path);
    assert.deepEqual(commitRoleSet(snapshot, snapshot.config, roleSetOf(snapshot)), { kind: "unchanged", generation: null });
    f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION]; role.agentProfile.delegable = []; });
    const changed = { ...roleSetOf(snapshot), resident: { ...roleSetOf(snapshot).resident!, prompt: Buffer.from("other") } };
    assert.throws(() => commitRoleSet(snapshot, snapshot.config, changed), /changed since it was read/);
  } finally { f.close(); }
});

test("DR25: the engine oma runs for a package command sees oma's store as its directory, never the user's own Pi settings", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    // A pinned engine that records what it was given.
    const engine = join(f.root, "engine.sh");
    const record = join(f.root, "seen.txt");
    writeFileSync(engine, `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > ${record}\nenv | grep '^PI_CODING_AGENT' >> ${record}\n`);
    chmodSync(engine, 0o755);
    const packages = join(f.root, "packages");
    const stateRoot = join(f.root, "oma", "demo");
    mkdirSync(stateRoot, { recursive: true });
    const code = await runEngineLogin({ stateRoot, libdir: f.installation, override: engine, fence: 1,
      env: { PATH: process.env.PATH, PI_CODING_AGENT_DIR: "/home/me/.pi/agent", PI_CODING_AGENT_SESSION_DIR: "/home/me/.pi/sessions" },
      packages: { store: packages, args: ["install", "npm:x"] } });
    assert.equal(code, 0);
    const seen = readFileSync(record, "utf8").trim().split("\n");
    assert.deepEqual(seen, [packages, "install", "npm:x", `PI_CODING_AGENT_DIR=${packages}`]);
  } finally { f.close(); }
});

test("DR25: executable asset bytes are not document bytes, but remain in the commit and spawn integrity checks", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    const path = join(packages, "npm/node_modules/oma-hello-ext/extensions/hello.ts");
    const content = Buffer.from(hello["extensions/hello.ts"] + "/*" + "x".repeat(12 * 1024 * 1024) + "*/");
    writeFileSync(path, content);
    f.edit("host.json", host => { host.installation.packages = packages; });
    f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION, HELLO]; });
    const snapshot = loadConfigurationSnapshot(f.path);
    const extension = snapshot.roles.resident!.extensions[1]!;
    assert.equal(extension.sha256, createHash("sha256").update(content).digest("hex"));
    assert.equal(snapshot.sourceFiles.find(file => file.path === path)?.bytes, content.length);
    assertExtensionIntegrity([extension]);
    content[100] = 0x79;
    writeFileSync(path, content);
    assert.throws(() => assertExtensionIntegrity([extension]), /changed after it was recorded/);
    const roles = { ...roleSetOf(snapshot), resident: { ...roleSetOf(snapshot).resident!, prompt: Buffer.from("changed") } };
    assert.throws(() => commitRoleSet(snapshot, snapshot.config, roles), /changed since it was read/);
  } finally { f.close(); }
});

test("DR25: a corrupt installed-package index is not an empty package store", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    for (const content of ["{broken", "{}", "[null]", JSON.stringify([{ source: "npm:x", entries: ["packages:../x.js"] }]),
      JSON.stringify([{ source: "npm:x", entries: [] }, { source: "npm:x", entries: [] }])]) {
      writeFileSync(join(packages, "oma-extensions.json"), content);
      assert.throws(() => readPackageIndex(packages), { code: "STORE_CORRUPT" });
    }
    assert.deepEqual(readPackageIndex(join(f.root, "absent")), []);
  } finally { f.close(); }
});

test("UX-20: the package index bound is a named, stated limit -- a realistic multi-megabyte index reads, an over-bound one names the bound", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    // A heavy but realistic install: tens of thousands of indexed resource files.
    // The same document was refused as "not a bounded regular file" at 1 MiB.
    const heavy = [{ source: "npm:skills-pack", entries: [],
      skills: Array.from({ length: 24_000 }, (_, i) => `packages:npm/node_modules/skills-pack/skills/skill-${i}/SKILL.md`) }];
    const text = `${JSON.stringify(heavy, null, 2)}\n`;
    assert.ok(Buffer.byteLength(text) > 1024 * 1024, "the fixture must exceed the old 1 MiB bound");
    assert.ok(Buffer.byteLength(text) <= PACKAGE_INDEX_BYTES, "the fixture must fit the configured bound");
    writeFileSync(join(packages, PACKAGE_INDEX), text);
    assert.equal(readPackageIndex(packages)[0]!.skills!.length, 24_000);

    // Over the configured bound the refusal names it -- a limit, not corrupt bytes.
    const over = [{ source: "npm:x", entries: [], skills: Array.from({ length: 200_000 },
      (_, i) => `packages:npm/node_modules/x/skills/skill-${i}/SKILL.md`) }];
    writeFileSync(join(packages, PACKAGE_INDEX), JSON.stringify(over));
    assert.ok(statSync(join(packages, PACKAGE_INDEX)).size > PACKAGE_INDEX_BYTES);
    assert.throws(() => readPackageIndex(packages),
      { code: "LIMIT_EXCEEDED", message: new RegExp(`exceeds its ${PACKAGE_INDEX_BYTES}-byte bound`) });
  } finally { f.close(); }
});


test("DR26 / P0V-51: extension install accepts a valid Principal-only project without inventing a Worker", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const source = store(f.root, { "oma-hello-ext": hello });
    const packages = join(f.root, ".packages");
    // The product's shared store location, not an alternative configuration root.
    symlinkSync(source, packages);
    const path = join(f.root, ".projects", "demo", "config.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeSettings(path, { ...f.config, installation: { ...f.config.installation, packages },
      agentProfiles: { principal: f.config.agentProfiles.principal! }, initialResidents: [] });
    const result = applyPackageChange({ dataRoot: f.root, project: "demo", libdir: f.config.installation.libdir,
      before: [], after: [{ source: "npm:oma-hello-ext", entries: [HELLO] }] });
    assert.equal(result.ok, true, result.said.join("\n"));
    assert.match(result.said.join("\n"), /Principal from their next start/);
    assert.doesNotMatch(result.said.join("\n"), /Principal and Workers from/);
    const settings = readSettingsForEditing(path);
    assert.equal(settings.workerProfile, null);
    assert.ok((settings.snapshot!.authoredRoles.principal!.value.extensions as string[]).includes(HELLO));
  } finally { f.close(); }
});

/** A package that carries every kind of resource Pi indexes: an extension by
 * manifest, and the conventional skills/, prompts/ and themes/ directories. */
const rich = {
  // A pi manifest lists its resources explicitly; only a manifest-less package
  // falls back to the conventional directories.
  "package.json": JSON.stringify({ name: "oma-rich", version: "1.0.0",
    pi: { extensions: ["./extensions/e.ts"], skills: ["./skills/roll/SKILL.md"],
      prompts: ["./prompts/review.md"], themes: ["./themes/dark.json"] } }),
  "extensions/e.ts": "export default function () {}\n",
  "skills/roll/SKILL.md": "---\nname: roll\ndescription: Roll.\n---\n",
  "prompts/review.md": "Review the change.\n",
  "themes/dark.json": JSON.stringify({ name: "dark", colors: {} }),
};

test("C18: the package index keeps skills, prompts and themes, not only extensions", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-rich": rich });
    const index = await writePackageIndex(packages);
    const item = index.find(entry => entry.source === "npm:oma-rich")!;
    assert.deepEqual(item.entries, ["packages:npm/node_modules/oma-rich/extensions/e.ts"]);
    assert.deepEqual(item.skills, ["packages:npm/node_modules/oma-rich/skills/roll/SKILL.md"]);
    assert.deepEqual(item.prompts, ["packages:npm/node_modules/oma-rich/prompts/review.md"]);
    assert.deepEqual(item.themes, ["packages:npm/node_modules/oma-rich/themes/dark.json"]);

    // The argv-facing view resolves each entry under the store's real root.
    const paths = packageResourcePaths(packages)!;
    const root = realpathSync(packages);
    assert.deepEqual(paths.skills, [join(root, "npm/node_modules/oma-rich/skills/roll/SKILL.md")]);
    assert.deepEqual(paths.prompts, [join(root, "npm/node_modules/oma-rich/prompts/review.md")]);
    assert.deepEqual(paths.themes, [join(root, "npm/node_modules/oma-rich/themes/dark.json")]);
    // No extensions leak into the resource lists; a store with none yields nothing.
    assert.equal(packageResourcePaths(join(f.root, "absent")), undefined);
  } finally { f.close(); }
});

test("C18: an index written before resources were indexed still reads, and a malformed list is not silently none", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    // The pre-C18 shape: source + entries only.
    writeFileSync(join(packages, PACKAGE_INDEX), JSON.stringify([{ source: "npm:oma-hello-ext", entries: [HELLO] }]));
    const legacy = readPackageIndex(packages);
    assert.deepEqual(legacy, [{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }]);
    assert.equal(packageResourcePaths(packages), undefined, "no resources means no argv");

    for (const content of [
      JSON.stringify([{ source: "npm:x", entries: [], skills: ["bare.md"] }]),
      JSON.stringify([{ source: "npm:x", entries: [], prompts: ["packages:../out.md"] }]),
      JSON.stringify([{ source: "npm:x", entries: [], themes: ["packages:a.json", "packages:a.json"] }]),
      JSON.stringify([{ source: "npm:x", entries: [], skills: "packages:x" }]),
    ]) {
      writeFileSync(join(packages, PACKAGE_INDEX), content);
      assert.throws(() => readPackageIndex(packages), { code: "STORE_CORRUPT" }, content);
    }
  } finally { f.close(); }
});

test("C18: an engine's argv names the package resources -- host paths unconfined, mounted paths inside", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-rich": rich });
    await writePackageIndex(packages);
    const resources = packageResourcePaths(packages)!;
    const root = realpathSync(packages);
    const skill = join(root, "npm/node_modules/oma-rich/skills/roll/SKILL.md");

    // The Principal's argv.
    const argv = sessionArgv({ piCommand: "/x/pi", coreExtension: "/x/core.js", sessionDir: "/s", workspace: "/w", home: "/h" },
      { society: "s", provider: "p", model: "m", extensions: [], workspaceBytes: 1, packageResources: resources });
    assert.deepEqual(argv.slice(argv.indexOf("--skill"), argv.indexOf("--skill") + 2), ["--skill", skill]);
    assert.ok(argv.includes("--prompt-template")); assert.ok(argv.includes("--theme"));

    // The Resident plan is confined only: w11/U1 retired the unconfined
    // profile, so "host paths" argv coverage is the Principal's sessionArgv
    // above. Confined directories must be the canonical actor paths -- the
    // sandbox checks them against the lease.
    const state = join(f.root, "state"); mkdirSync(state, { recursive: true });
    const dirs = { workspace: workspacePathAt(state, "a"), home: join(agentRootPathAt(state, "a"), "home"),
      archive: join(state, "mail", "archive"), workerArchive: join(state, "mail", "workers"),
      selfMail: join(state, "mail", "inboxes", "a"), view: runnerViewPathAt(state, "a"), world: join(state, "world"),
      projectGit: projectGitPathAt(state), projectMirror: projectMirrorPathAt(state), sessions: runnerSessionDirPathAt(state, "a") };
    for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
    const runRoot = join(f.root, "run"); mkdirSync(join(runRoot, "actors", "a", "1"), { recursive: true });
    const paths = { piCommand: "/usr/bin/node", coreExtension: join(f.installation, CORE_EXTENSION), cli: join(f.installation, "cli.js"),
      workspace: dirs.workspace, sessionDir: dirs.sessions, agentHome: dirs.home, mailArchive: dirs.archive,
      workerArchive: dirs.workerArchive, projectGit: dirs.projectGit, batchView: dirs.view,
      socket: actorSocketPathAt(runRoot, "a", 1) };
    const profile = { provider: "pi", model: "current", inferenceSeconds: 1, prompt: "", workspaceBytes: 1,
      extensions: [], packageResources: resources };
    const limits = { frameBytes: 1, idleStreamSeconds: 1, receiptWaitSeconds: 1, batchMaxMessages: 1, mailBodyBytes: 1, contextBytes: 1, bundleBytes: 1 };

    const confinement = {
      host: { rootfs: join(f.root, "rootfs"), libdir: f.installation, packages: root, node: "/usr/bin/node",
        pi: `${RESIDENT_PATHS.libdir}/engine/cli.js`, piModeArgs: [],
        tmpBytes: 1024, stateRoot: state, runRoot: join(f.root, "run"),
        limits: { frameBytes: 1, batchMaxMessages: 1 } },
      lease: decodeRunLease({ actor: "a", incarnation: 1, socketHostPath: paths.socket }, { actor: "a", runRoot }),
      directories: dirs,
    };
    const confined = planPiSpawn({ actor: "a", society: "s", paths, profile, limits, confinement } as never);
    const mounted = `${RESIDENT_PATHS.packages}/npm/node_modules/oma-rich`;
    for (const [flag, suffix] of [["--skill", "/skills/roll/SKILL.md"], ["--prompt-template", "/prompts/review.md"], ["--theme", "/themes/dark.json"]] as const) {
      const at = confined.args.indexOf(flag);
      assert.ok(at > 0, `${flag} was never passed`);
      assert.equal(confined.args[at + 1], `${mounted}${suffix}`, `${flag} was not translated through the package mount`);
    }
    // The trusted extension's readable root travels as the guest-visible
    // mount point -- never the host path, which does not exist inside.
    const storeEnv = confined.args.indexOf("OMA_PACKAGE_STORE");
    assert.ok(storeEnv > 0 && confined.args[storeEnv - 1] === "--setenv", "OMA_PACKAGE_STORE was never set inside the sandbox");
    assert.equal(confined.args[storeEnv + 1], RESIDENT_PATHS.packages);
    // Without a mounted store the variable is absent rather than misleading.
    // (No mount can coexist with resources beneath it: the plan would rightly
    // refuse, so the no-store profile carries no package resources either.)
    const unmounted = planPiSpawn({ actor: "a", society: "s", paths,
      profile: { ...profile, packageResources: undefined }, limits,
      confinement: { ...confinement, host: { ...confinement.host, packages: undefined } } } as never);
    assert.equal(unmounted.args.includes("OMA_PACKAGE_STORE"), false);
    // A resource under no mount must not reach a confined engine at all.
    const stray = { ...resources, skills: [join(f.root, "elsewhere", "SKILL.md")] };
    assert.throws(() => planPiSpawn({ actor: "a", society: "s", paths,
      profile: { ...profile, packageResources: stray }, limits, confinement } as never), /outside every mount/);
  } finally { f.close(); }
});
