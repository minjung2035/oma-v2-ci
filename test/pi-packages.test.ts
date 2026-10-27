import { packageDirectories } from "#oma-test/app/platform/package-files";
import { PACKAGE_INDEX_KIND, encodePackageIndex } from "#oma-test/app/runtime/packages/index";
import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import { engineLoginDirectory } from "#oma-test/app/engine/start-effects";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { loadConfiguration, loadConfigurationSnapshot } from "@oma/config";
import { DurabilityFaultError, type DurabilityFault } from "@oma/storage/durable-fs";
import { CORE_EXTENSION, readExtensions, toggleExtension } from "#oma-test/app/application/extensions";
import { commitRoleSet, deriveSessionSettings, projectBundle, readSettings, readSettingsForEditing, roleSetOf, writeSettings } from "#oma-test/app/application/settings";
import { PACKAGE_INDEX, PACKAGE_INDEX_BYTES, PACKAGE_LOCAL_DIR, packageCommand, packageListLines, packageResourcePaths, readPackageIndex, reconciledEntries, writePackageIndex, type InstalledPackage } from "#oma-test/app/runtime/packages/store";
import { pruneLocalStage, stageLocalPackage } from "#oma-test/app/application/local-packages";
import { sessionArgv } from "@oma/engine/principal-session";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { decodeRunLease } from "@oma/protocol/run-lease";
import { applyPackageChange, ensureProjectSettings } from "#oma-test/app/application/project-settings";
import { RESIDENT_PATHS, confinedPath } from "@oma/domain/resident-paths";
import { actorSocketPathAt, agentRootPathAt, projectGitPathAt, projectMirrorPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "@oma/domain/paths";
import { runEngineLogin } from "@oma/engine/login";
import { assertExtensionIntegrity } from "#oma-test/app/runtime/extension-integrity";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { chmodSync, readFileSync } from "node:fs";
import { listOwnedDirectory } from "@oma/storage/directory";

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

test("DR41: the package filesystem port cannot publish an empty index when an owned file cannot be repaired", async () => {
  const f = createCompleteConfigurationFixture(), root = join(f.root, "packages"), local = join(root, "local", "hello");
  try {
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, "package.json"), JSON.stringify({ name: "hello", pi: { extensions: ["./e.ts"] } }));
    const entry = join(local, "e.ts");
    writeFileSync(entry, "export default function () {}\n");
    writeFileSync(join(root, "settings.json"), JSON.stringify({ packages: ["local/hello"] }));
    await writePackageIndex(root);
    const prior = readFileSync(join(root, PACKAGE_INDEX));
    chmodSync(entry, 0);
    let repairs = 0;
    await assert.rejects(writePackageIndex(root, { list: listOwnedDirectory, repair: () => { repairs++; return false; } }),
      { code: "BROKER_UNAVAILABLE" });
    assert.equal(repairs, 1);
    assert.deepEqual(readFileSync(join(root, PACKAGE_INDEX)), prior);
  } finally { f.close(); }
});

test("DR25: oma pi runs the engine's package commands over oma's store, and refuses what would reach past oma", () => {
  for (const args of [["install", "npm:@foo/bar@1.0.0"], ["install", "git:github.com/foo/bar"], ["install", "https://github.com/foo/bar"],
    ["remove", "npm:@foo/bar"], ["update", "npm:@foo/bar"], ["update", "--extensions"],
    ["update", "--extension", "npm:@foo/bar"], ["list"], ["install", "--help"]]) {
    const decision = packageCommand(args);
    assert.equal(decision.kind, "run", args.join(" "));
  }
  assert.equal(packageCommand(["uninstall", "npm:x"]).kind, "refused");
  // C20: a path on this machine is accepted and marked for the caller to stage
  // into the store; it is never forwarded to the engine where it lies.
  for (const [args, local] of [
    [["install", "./local"], "./local"], [["install", "/abs/ext"], "/abs/ext"], [["install", "~/ext"], "~/ext"],
    [["install", "file:///x"], "file:///x"], [["install", "pkg.tgz"], "pkg.tgz"], [["install", "ext.ts"], "ext.ts"]] as const) {
    const decision = packageCommand(args);
    assert.deepEqual(decision, { kind: "run", command: "install", args: ["install", local], local }, args.join(" "));
  }
  const refusals: [string[], RegExp][] = [
    [["install", "-l", "npm:x"], /project's local packages/], [["install", "--local", "npm:x"], /project's local packages/],
    [["remove", "-a", "npm:x"], /project's local packages/], [["install"], /one source/],
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
    const before: InstalledPackage[] = [{ source: "npm:a", entries: ["packages:a/one.ts"] , skills: [], prompts: [], themes: [] }, { source: "npm:b", entries: ["packages:b/x.ts"] , skills: [], prompts: [], themes: [] }];
    const after: InstalledPackage[] = [{ source: "npm:a", entries: ["packages:a/two.ts", "packages:a/three.ts"] , skills: [], prompts: [], themes: [] }];
    assert.deepEqual(reconciledEntries([CORE_EXTENSION, "packages:a/one.ts", "extensions/own.js", "packages:b/x.ts"], before, after),
      [CORE_EXTENSION, "packages:a/two.ts", "packages:a/three.ts", "extensions/own.js"]);
    assert.deepEqual(reconciledEntries([CORE_EXTENSION], before, after), [CORE_EXTENSION], "a package a role did not use is not turned on");
  } finally { f.close(); }
});

/** A ustar stream (as `npm pack` writes) holding the given files under
 * `package/`; `dirs` names directory members (type '5', trailing `/`), which
 * real `npm pack` output always carries. */
function tarball(files: Record<string, string>, dirs: readonly string[] = []): Buffer {
  const parts: Buffer[] = [];
  const header = (name: string, size: number, type = 0x30): Buffer => {
    const block = Buffer.alloc(512);
    block.write(name, 0, "utf8");
    block.write(`${(0o644).toString(8).padStart(7, "0")}\0`, 100);
    block.write("0000000\0", 108); block.write("0000000\0", 116);
    block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
    block.write("00000000000\0", 136);
    block.write("        ", 148);
    block[156] = type;
    block.write("ustar\0", 257); block.write("00", 263);
    let sum = 0; for (let index = 0; index < 512; index++) sum += block[index]!;
    block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    return block;
  };
  for (const name of dirs) parts.push(header(name, 0, 0x35));
  for (const [name, text] of Object.entries(files)) {
    const content = Buffer.from(text, "utf8");
    parts.push(header(name, content.length), content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

test("DR25/C20: `oma pi install` of a local path copies it into the store as `local/<name>`, indexed and synced like a remote package", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    // A directory package: manifest-declared extension + skill, conventional
    // prompt and theme directories, a `.git` left behind and a link resolved.
    const rich = join(f.root, "src", "rich");
    const target = join(f.root, "target.ts");
    writeFileSync(target, "// linked target\n");
    mkdirSync(join(rich, "extensions"), { recursive: true });
    mkdirSync(join(rich, "skills", "roll"), { recursive: true });
    mkdirSync(join(rich, "prompts"), { recursive: true });
    mkdirSync(join(rich, "themes"), { recursive: true });
    mkdirSync(join(rich, ".git", "objects"), { recursive: true });
    writeFileSync(join(rich, ".git", "objects", "x"), "git internals\n");
    writeFileSync(join(rich, "package.json"), JSON.stringify({ name: "oma-local-rich", version: "1.0.0",
      pi: { extensions: ["./extensions/e.ts"], skills: ["./skills/roll/SKILL.md"],
        prompts: ["./prompts/review.md"], themes: ["./themes/dark.json"] } }));
    writeFileSync(join(rich, "extensions", "e.ts"), "export default function () {}\n");
    writeFileSync(join(rich, "skills", "roll", "SKILL.md"), "# roll\n");
    writeFileSync(join(rich, "prompts", "review.md"), "review it\n");
    writeFileSync(join(rich, "themes", "dark.json"), "{}\n");
    symlinkSync(target, join(rich, "linked.ts"));

    assert.equal(await stageLocalPackage(store, rich), `${PACKAGE_LOCAL_DIR}/oma-local-rich`);
    const staged = join(store, "local", "oma-local-rich");
    assert.ok(existsSync(join(staged, "extensions", "e.ts")));
    // A copy, never a link: the link's target's bytes are inside the store.
    assert.equal(lstatSync(join(staged, "linked.ts")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(staged, "linked.ts"), "utf8"), "// linked target\n");
    assert.equal(existsSync(join(staged, ".git")), false, "a repository's .git does not travel");
    // Re-installing the source replaces the copy wholesale.
    writeFileSync(join(rich, "extensions", "e.ts"), "export default function () { /* v2 */ }\n");
    rmSync(join(rich, "prompts", "review.md"));
    assert.equal(await stageLocalPackage(store, rich), `${PACKAGE_LOCAL_DIR}/oma-local-rich`);
    assert.equal(existsSync(join(staged, "prompts", "review.md")), false, "a file removed upstream stays removed");
    assert.match(readFileSync(join(staged, "extensions", "e.ts"), "utf8"), /v2/);

    // A lone extension file stages under its own name.
    const lone = join(f.root, "src", "single.ts");
    writeFileSync(lone, "export default function () {}\n");
    assert.equal(await stageLocalPackage(store, lone), `${PACKAGE_LOCAL_DIR}/single.ts`);

    // A tarball of a package (real npm pack shape: directory members with a
    // trailing `/` precede the files under `package/`).
    const packed = join(f.root, "packed.tgz");
    writeFileSync(packed, gzipSync(tarball({
      "package/package.json": JSON.stringify({ name: "oma-packed",
        pi: { extensions: ["./e.ts"], skills: ["./skills/roll/SKILL.md"] } }),
      "package/e.ts": "export default function () {}\n",
      "package/skills/roll/SKILL.md": "# roll\n",
    }, ["package/", "package/skills/", "package/skills/roll/"])));
    assert.equal(await stageLocalPackage(store, packed), `${PACKAGE_LOCAL_DIR}/oma-packed`);
    assert.ok(existsSync(join(store, "local", "oma-packed", "skills", "roll", "SKILL.md")));
    // The inflated archive's spool went with the call: nothing staging-named
    // is live content, and a refused archive's spool goes the same way.
    assert.equal(readdirSync(store).some(name => name.startsWith(".staging-local-")), false,
      "the archive spool went with the call");
    // Still refused: a file member named with a trailing slash, a directory
    // name that is only slashes, and `..` anywhere.
    await assert.rejects(stageLocalPackage(store, (() => { const p = join(f.root, "bad1.tar"); writeFileSync(p, tarball({ "a/": "x" })); return p; })()),
      /not a normalized relative path/);
    await assert.rejects(stageLocalPackage(store, (() => { const p = join(f.root, "bad2.tar"); writeFileSync(p, tarball({}, ["//"])); return p; })()),
      /not a normalized relative path/);
    await assert.rejects(stageLocalPackage(store, (() => { const p = join(f.root, "bad3.tar"); writeFileSync(p, tarball({}, ["../evil/"])); return p; })()),
      /not a normalized relative path/);

    // A tar without the single top directory unpacks to the name the archive had.
    const plain = join(f.root, "plainpack.tar");
    writeFileSync(plain, tarball({
      "package.json": JSON.stringify({ name: "@scope/plain" }),
      "extensions/e.ts": "export default function () {}\n",
    }));
    assert.equal(await stageLocalPackage(store, plain), `${PACKAGE_LOCAL_DIR}/@scope/plain`);
    assert.ok(existsSync(join(store, "local", "@scope", "plain", "package.json")));

    // Refusals are loud and named: nothing there, no manifest, not a package,
    // a source that is or contains the store, an archive that is not a tar.
    const missing = join(f.root, "src", "missing");
    await assert.rejects(stageLocalPackage(store, missing), /does not exist/);
    const bare = join(f.root, "src", "bare");
    mkdirSync(bare, { recursive: true });
    await assert.rejects(stageLocalPackage(store, bare), /INVALID_REQUEST|no package\.json/);
    writeFileSync(join(bare, "package.json"), "{broken");
    await assert.rejects(stageLocalPackage(store, bare), /not readable JSON/);
    writeFileSync(join(bare, "package.json"), JSON.stringify({ name: "bare" }));
    await assert.rejects(stageLocalPackage(store, bare), /no pi manifest/);
    await assert.rejects(stageLocalPackage(store, store), /inside the package store|contains the package store/);
    await assert.rejects(stageLocalPackage(store, staged), /inside the package store/);
    const notTar = join(f.root, "src", "not-a-tar.tgz");
    writeFileSync(notTar, "this is not a tar archive at all, not even close\n");
    await assert.rejects(stageLocalPackage(store, notTar), /not a tar|ustar/);

    // The staged copies resolve through the engine's own pipeline: the same
    // settings.json entry `local/<name>` the engine's `install` records, the
    // same index, the same argv the resource sync builds.
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: [
      `${PACKAGE_LOCAL_DIR}/oma-local-rich`, `${PACKAGE_LOCAL_DIR}/single.ts`, `${PACKAGE_LOCAL_DIR}/oma-packed`, `${PACKAGE_LOCAL_DIR}/@scope/plain`] }));
    const index = await writePackageIndex(store);
    const richIndex = index.find(item => item.source === `${PACKAGE_LOCAL_DIR}/oma-local-rich`)!;
    assert.deepEqual(richIndex.entries, [`packages:${PACKAGE_LOCAL_DIR}/oma-local-rich/extensions/e.ts`]);
    assert.deepEqual(richIndex.skills, [`packages:${PACKAGE_LOCAL_DIR}/oma-local-rich/skills/roll/SKILL.md`]);
    // The prompt file removed upstream above is indexed as gone: the copy, not
    // the source as the Human remembers it, is what the engines get.
    assert.deepEqual(richIndex.prompts, []);
    assert.deepEqual(richIndex.themes, [`packages:${PACKAGE_LOCAL_DIR}/oma-local-rich/themes/dark.json`]);
    assert.deepEqual(index.find(item => item.source === `${PACKAGE_LOCAL_DIR}/single.ts`)?.entries, [`packages:${PACKAGE_LOCAL_DIR}/single.ts`]);
    assert.deepEqual(index.find(item => item.source === `${PACKAGE_LOCAL_DIR}/oma-packed`)?.skills, [`packages:${PACKAGE_LOCAL_DIR}/oma-packed/skills/roll/SKILL.md`]);
    const resources = packageResourcePaths(store);
    assert.ok(resources!.skills.some(path => path.endsWith(join("oma-local-rich", "skills", "roll", "SKILL.md"))));
    assert.ok(resources!.themes.some(path => path.endsWith(join("oma-local-rich", "themes", "dark.json"))));
    // `oma pi list` names what each package carries.
    assert.deepEqual(packageListLines(store), [
      `${PACKAGE_LOCAL_DIR}/oma-local-rich: 1 extension, 1 skill, 1 theme`,
      `${PACKAGE_LOCAL_DIR}/single.ts: 1 extension`,
      `${PACKAGE_LOCAL_DIR}/oma-packed: 1 extension, 1 skill`,
      `${PACKAGE_LOCAL_DIR}/@scope/plain: 1 extension`]);

    // Removing a local source removes its copy; nothing else goes.
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: [`${PACKAGE_LOCAL_DIR}/oma-local-rich`] }));
    pruneLocalStage(store);
    assert.equal(existsSync(staged), true);
    assert.equal(existsSync(join(store, "local", "single.ts")), false);
    assert.equal(existsSync(join(store, "local", "oma-packed")), false);
    assert.equal(existsSync(join(store, "local", "@scope")), false, "an emptied scope directory goes too");
  } finally { f.close(); }
});

test("DR25/C20: a staging interrupted mid-copy leaves only dead content; a retry installs whole and the next change collects it", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    // A configured package that stays, and dead content beside it: a copy no
    // settings names, a staging area an install died inside, a stray file.
    mkdirSync(join(store, "local", "live-pkg"), { recursive: true });
    writeFileSync(join(store, "local", "live-pkg", "e.ts"), "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/live-pkg"] }));
    mkdirSync(join(store, "local", "dead-pkg"), { recursive: true });
    mkdirSync(join(store, ".staging-local-interrupted"), { recursive: true });
    writeFileSync(join(store, ".staging-local-interrupted", "half.ts"), "export default function () { /* half */\n");
    writeFileSync(join(store, "local", "stray.txt"), "left\n");

    pruneLocalStage(store);
    assert.equal(existsSync(join(store, ".staging-local-interrupted")), false, "a dead staging area is collected");
    assert.equal(existsSync(join(store, "local", "dead-pkg")), false, "a copy no source names is collected");
    assert.equal(existsSync(join(store, "local", "stray.txt")), false, "a stray file is collected");
    assert.equal(existsSync(join(store, "local", "live-pkg")), true, "a package settings still names is kept");

    // A source that fails mid-copy publishes nothing: no staged name, no staging.
    const broken = join(f.root, "src", "broken");
    mkdirSync(join(broken, "extensions"), { recursive: true });
    writeFileSync(join(broken, "package.json"), JSON.stringify({ name: "broken", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(broken, "extensions", "e.ts"), "export default function () {}\n");
    symlinkSync(join(f.root, "missing-target"), join(broken, "gone.ts"));
    await assert.rejects(stageLocalPackage(store, broken), /link to nothing/);
    assert.equal(existsSync(join(store, "local", "broken")), false, "a failed install publishes no name");
    assert.equal(readdirSync(store).some(name => name.startsWith(".staging-local-")), false, "the staging area went with it");

    // The same name retried installs the whole copy.
    rmSync(join(broken, "gone.ts"));
    assert.equal(await stageLocalPackage(store, broken), "local/broken");
    assert.equal(readFileSync(join(store, "local", "broken", "extensions", "e.ts"), "utf8"), "export default function () {}\n");
  } finally { f.close(); }
});

test("DR25/C20: a configured `local/..foo` source survives the prune -- `..` decides by component, not prefix", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    // `..foo` is a name the store's own rule accepts (resourceEntryProblem
    // refuses only "", "." and ".." components), so a staged copy may live at
    // local/..foo with settings.json naming it. The old startsWith("..")
    // predicate read that relative path as an escape and deleted a copy the
    // configuration still pointed at.
    mkdirSync(join(store, "local", "..foo"), { recursive: true });
    writeFileSync(join(store, "local", "..foo", "e.ts"), "export default function () {}\n");
    mkdirSync(join(store, "local", "other"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/..foo"] }));

    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "..foo", "e.ts")), true, "a configured source under a ..-prefixed name is kept");
    assert.equal(existsSync(join(store, "local", "other")), false, "dead content beside it is still collected");
    // And a source that really does escape `local/` keeps its old answer.
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/../outside", "npm:real-pkg"] }));
    mkdirSync(join(store, "npm", "node_modules", "real-pkg"), { recursive: true });
    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "..foo")), false, "with no source naming it, the copy goes");
    assert.equal(existsSync(join(store, "npm")), true, "an escaping source never names store content outside local/");
  } finally { f.close(); }
});

test("DR25/C20: a configured `local/@bare` source survives the prune -- the scope directory itself may be the package", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    // resourceEntryProblem refuses only "", "." and ".." components, so a
    // bare @-word is a lawful name: a manifest named "@bare" stages its copy
    // AT local/@bare -- the scope directory is the package, not a parent of
    // one. The old sweep descended unconditionally, deleted the children it
    // found not kept, then removed the directory it had emptied.
    const source = join(f.root, "src", "at-bare");
    mkdirSync(join(source, "extensions"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@bare", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(source, "extensions", "e.ts"), "export default function () {}\n");
    assert.equal(await stageLocalPackage(store, source), `${PACKAGE_LOCAL_DIR}/@bare`);

    // Beside it: a scoped package a source names beneath its scope, a dead
    // sibling under that same scope, and a scope no source names at all.
    mkdirSync(join(store, "local", "@scope", "pkg"), { recursive: true });
    writeFileSync(join(store, "local", "@scope", "pkg", "e.ts"), "export default function () {}\n");
    mkdirSync(join(store, "local", "@scope", "dead"), { recursive: true });
    mkdirSync(join(store, "local", "@dead", "gone"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/@bare", "local/@scope/pkg"] }));

    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "@bare", "package.json")), true, "a source naming the scope directory itself keeps it whole");
    assert.equal(existsSync(join(store, "local", "@bare", "extensions", "e.ts")), true, "the kept package's content survives with it");
    assert.equal(existsSync(join(store, "local", "@scope", "pkg", "e.ts")), true, "a source beneath a scope keeps that child");
    assert.equal(existsSync(join(store, "local", "@scope", "dead")), false, "a dead sibling under a kept scope is still collected");
    assert.equal(existsSync(join(store, "local", "@scope")), true, "the kept child's scope directory stays");
    assert.equal(existsSync(join(store, "local", "@dead")), false, "a scope no source names is collected whole");
  } finally { f.close(); }
});

test("DR25/C20: a staging-prefixed file or link is collected with dead areas -- it does not abort the prune", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(join(store, "local", "live"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/live"] }));
    // The interrupted-staging prefix on an entry that is not a directory --
    // a file an interrupted write left, a link -- used to throw inside
    // removeOwnedTree (its root opens O_DIRECTORY), aborting the sweep and
    // every later `oma pi` change that ends in this prune.
    writeFileSync(join(store, ".staging-local-stray-file"), "half\n");
    mkdirSync(join(store, ".staging-local-area"));
    writeFileSync(join(store, ".staging-local-area", "half.ts"), "export default function () { /* half */\n");
    symlinkSync(join(store, "gone-target"), join(store, ".staging-local-stray-link"));

    pruneLocalStage(store);
    assert.equal(existsSync(join(store, ".staging-local-stray-file")), false, "a staging-named file is collected as a file");
    assert.equal(existsSync(join(store, ".staging-local-area")), false, "a staging area is still collected as a tree");
    assert.equal(lstatSync(join(store, ".staging-local-stray-link"), { throwIfNoEntry: false }), undefined, "a staging-named link is collected as an entry");
    assert.equal(existsSync(join(store, "local", "live")), true, "the sweep reaches the live package after them");
  } finally { f.close(); }
});

test("DR25/C20: a dead copy holding a link is collected whole -- a non-regular entry does not wedge the prune", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(join(store, "local", "live"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/live"] }));
    // copyIntoStage resolves links, so a staged copy never holds one: a link
    // inside a dead local/<pkg> directory is corruption, but it is corruption
    // inside oma-owned content that is being deleted either way. The old
    // removeOwnedTree refused the leaf (STORE_CORRUPT), aborting the sweep --
    // this dead directory and everything sorted after it stayed forever, and
    // every later `oma pi` change ended in the same throw. Owned-tree removal
    // unlinks a non-regular leaf as the entry it is, never followed.
    mkdirSync(join(store, "local", "dead-pkg", "sub"), { recursive: true });
    writeFileSync(join(store, "local", "dead-pkg", "e.ts"), "export default function () {}\n");
    symlinkSync(join(store, "elsewhere"), join(store, "local", "dead-pkg", "link.ts"));
    symlinkSync(join(store, "gone"), join(store, "local", "dead-pkg", "sub", "nested"));
    mkdirSync(join(store, "local", "zz-dead"), { recursive: true });
    writeFileSync(join(store, "local", "zz-dead", "x.ts"), "x\n");

    pruneLocalStage(store);
    assert.equal(lstatSync(join(store, "local", "dead-pkg"), { throwIfNoEntry: false }), undefined,
      "a dead copy is collected even though it held a link");
    assert.equal(existsSync(join(store, "local", "zz-dead")), false, "the sweep reaches dead content after it");
    assert.equal(existsSync(join(store, "local", "live")), true, "a package settings still names is kept");
  } finally { f.close(); }
});

test("DR25/C20: a `local` entry that is not a directory is collected, not wedged on", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/none"] }));
    // existsSync passes on a regular file and readdirSync threw ENOTDIR; a
    // dangling link made existsSync answer false and was left behind for
    // staging to fail on forever after. `local/` can hold staged copies only
    // as a directory staging made, so a non-directory entry in its slot is
    // dead store-root content: collected for what it is, like the
    // staging-prefixed strays beside it.
    writeFileSync(join(store, "local"), "not a directory\n");
    pruneLocalStage(store);
    assert.equal(lstatSync(join(store, "local"), { throwIfNoEntry: false }), undefined, "a `local` file is collected");

    // A `local` link -- including one whose target is a real directory -- is
    // unlinked as the entry it is; removal never follows it, so the target's
    // contents are untouched.
    const real = join(store, "real-dir");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "inside.txt"), "still here\n");
    symlinkSync(real, join(store, "local"));
    pruneLocalStage(store);
    assert.equal(lstatSync(join(store, "local"), { throwIfNoEntry: false }), undefined, "a `local` link is collected as an entry");
    assert.equal(readFileSync(join(real, "inside.txt"), "utf8"), "still here\n", "the link's target is not the entry's");

    symlinkSync(join(store, "gone-target"), join(store, "local"));
    pruneLocalStage(store);
    assert.equal(lstatSync(join(store, "local"), { throwIfNoEntry: false }), undefined, "a dangling `local` link is collected");
  } finally { f.close(); }
});

test("DR25/C20: dead content that lost its owner bits is collected -- the removal walk repairs before it opens", () => {
  const f = createCompleteConfigurationFixture();
  const locked = [join(f.root, "packages", "local", "dead-pkg"), join(f.root, "packages", "local", "dead-tree", "locked"),
    join(f.root, "packages", ".staging-local-zz"), join(f.root, "packages", "local", "kept-pkg")];
  try {
    const store = join(f.root, "packages");
    mkdirSync(join(store, "local", "live"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/live"] }));
    // Every shape the removal walk used to keep forever: it opened each
    // directory O_RDONLY | O_DIRECTORY and repaired owner bits only after the
    // open, so a mode-000 directory threw EACCES out of removeOwnedTree --
    // and the sweep's per-entry catch made that silent permanent retention.
    mkdirSync(join(store, "local", "dead-pkg")); writeFileSync(join(store, "local", "dead-pkg", "e.ts"), "x\n");
    chmodSync(join(store, "local", "dead-pkg"), 0o000);
    mkdirSync(join(store, "local", "dead-tree", "locked"), { recursive: true });
    writeFileSync(join(store, "local", "dead-tree", "locked", "x"), "x");
    chmodSync(join(store, "local", "dead-tree", "locked"), 0o000);
    mkdirSync(join(store, ".staging-local-zz")); writeFileSync(join(store, ".staging-local-zz", "half"), "x");
    chmodSync(join(store, ".staging-local-zz"), 0o000);
    mkdirSync(join(store, "local", "zzz-dead"));

    pruneLocalStage(store);
    assert.equal(lstatSync(join(store, "local", "dead-pkg"), { throwIfNoEntry: false }), undefined,
      "a dead copy whose root is mode-000 is collected");
    assert.equal(lstatSync(join(store, "local", "dead-tree"), { throwIfNoEntry: false }), undefined,
      "a dead tree holding a mode-000 subdirectory is collected whole");
    assert.equal(existsSync(join(store, ".staging-local-zz")), false, "a dead staging area at mode-000 is collected");
    assert.equal(existsSync(join(store, "local", "zzz-dead")), false, "the sweep reaches dead content after them");
    assert.equal(existsSync(join(store, "local", "live")), true, "a package settings still names is kept");

    // A configured copy at mode-000 is kept while configured -- and goes when
    // it stops being named, instead of becoming uncollectable.
    mkdirSync(join(store, "local", "kept-pkg")); writeFileSync(join(store, "local", "kept-pkg", "e.ts"), "x\n");
    chmodSync(join(store, "local", "kept-pkg"), 0o000);
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/live", "local/kept-pkg"] }));
    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "kept-pkg")), true, "a configured copy is kept");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/live"] }));
    pruneLocalStage(store);
    assert.equal(lstatSync(join(store, "local", "kept-pkg"), { throwIfNoEntry: false }), undefined,
      "un-configured, the mode-000 copy is collected");
  } finally {
    for (const path of locked) try { chmodSync(path, 0o700); } catch { /* already gone */ }
    f.close();
  }
});

test("DR25/C20: publish replaces a staged copy that lost its mode -- a mode-000 copy cannot wedge re-install", async () => {
  const f = createCompleteConfigurationFixture();
  const staged = join(f.root, "packages", "local", "wedge");
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    const source = join(f.root, "src", "wedge");
    mkdirSync(join(source, "extensions"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "wedge", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(source, "extensions", "e.ts"), "export default function () { /* v1 */ }\n");
    assert.equal(await stageLocalPackage(store, source), "local/wedge");
    // A same-UID stray or an interrupted writer leaves the existing copy at
    // mode-000: publish's removeOwnedTree threw EACCES at the open, so every
    // `oma pi install` of the name failed until the copy was removed by hand.
    chmodSync(staged, 0o000);
    writeFileSync(join(source, "extensions", "e.ts"), "export default function () { /* v2 */ }\n");
    assert.equal(await stageLocalPackage(store, source), "local/wedge", "re-install over the mode-000 copy");
    assert.match(readFileSync(join(staged, "extensions", "e.ts"), "utf8"), /v2/, "the new copy landed whole");
    assert.equal(statSync(staged).mode & 0o777, 0o700, "the published copy has the staging root's mode");
  } finally {
    try { chmodSync(staged, 0o700); } catch { /* already gone */ }
    f.close();
  }
});

test("DR25/C20: mode-000 ancestors on the open path are repaired before they are opened -- `local/`, its scopes, the store root", async () => {
  const f = createCompleteConfigurationFixture();
  const locked = [join(f.root, "packages"), join(f.root, "packages", "local"), join(f.root, "packages", "local", "@scope")];
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    const source = join(f.root, "src", "wedge");
    mkdirSync(join(source, "extensions"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "wedge", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(source, "extensions", "e.ts"), "export default function () { /* v1 */ }\n");
    assert.equal(await stageLocalPackage(store, source), "local/wedge");

    // The publish path used to reach `local` through a by-path
    // ensureUserDirectory whose open threw EACCES before any repair could
    // run: every `oma pi install <local>` failed BROKER_UNAVAILABLE until
    // some other mutation reached the prune. The directory is made and
    // opened beneath the held store root now, through the same owner-bits
    // repair the sweeps make.
    chmodSync(join(store, "local"), 0o000);
    writeFileSync(join(source, "extensions", "e.ts"), "export default function () { /* v2 */ }\n");
    assert.equal(await stageLocalPackage(store, source), "local/wedge", "re-install over a mode-000 `local/`");
    assert.match(readFileSync(join(store, "local", "wedge", "extensions", "e.ts"), "utf8"), /v2/);
    assert.equal(statSync(join(store, "local")).mode & 0o777, 0o700, "the opened directory kept its repaired bits");

    // A mode-000 scope directory on the descend to `local/@scope/pkg` gets
    // the same repair -- the descend never leaves oma's own tree.
    mkdirSync(join(store, "local", "@scope"));
    chmodSync(join(store, "local", "@scope"), 0o000);
    const scoped = join(f.root, "src", "scoped");
    mkdirSync(join(scoped, "extensions"), { recursive: true });
    writeFileSync(join(scoped, "package.json"), JSON.stringify({ name: "@scope/pkg", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(scoped, "extensions", "e.ts"), "export default function () {}\n");
    assert.equal(await stageLocalPackage(store, scoped), "local/@scope/pkg");
    assert.equal(statSync(join(store, "local", "@scope")).mode & 0o777, 0o700);

    // The store root itself in the same shape: the staging area's open pins
    // and repairs it rather than dying on EACCES the way the plain
    // openDirectory did.
    chmodSync(store, 0o000);
    assert.equal(await stageLocalPackage(store, source), "local/wedge", "a mode-000 store root cannot wedge staging's open");
    assert.equal(statSync(store).mode & 0o777, 0o700, "the open repaired the store root");
    assert.match(readFileSync(join(store, "local", "wedge", "extensions", "e.ts"), "utf8"), /v2/);
  } finally {
    for (const path of locked) try { chmodSync(path, 0o700); } catch { /* already gone */ }
    f.close();
  }
});

test("DR25/C20: a source spelling `local` itself keeps the whole stage -- the sweep never reads it as naming nothing", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(join(store, "local", "keep-a"), { recursive: true });
    mkdirSync(join(store, "local", "keep-b", "nested"), { recursive: true });
    writeFileSync(join(store, "local", "keep-a", "e.ts"), "x\n");
    writeFileSync(join(store, "local", "keep-b", "nested", "e.ts"), "x\n");
    // `relative(local, resolved)` answers "" for a source that names the
    // stage root itself, and "" was never in `inside`: every live staged
    // copy went. `local`, `local/`, `local/.` and the absolute store path
    // all spell the same root -- a hand edit that means "the local stage",
    // so the fail-safe reading keeps everything under it, the same answer
    // an unlistable directory gets: retention beats destruction.
    for (const source of ["local", "local/", "local/.", join(store, "local")]) {
      mkdirSync(join(store, ".staging-local-dead"), { recursive: true });
      writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: [source] }));
      pruneLocalStage(store);
      assert.equal(existsSync(join(store, "local", "keep-a", "e.ts")), true, `${JSON.stringify(source)} keeps the stage`);
      assert.equal(existsSync(join(store, "local", "keep-b", "nested", "e.ts")), true, `${JSON.stringify(source)} keeps nested copies`);
      assert.equal(existsSync(join(store, ".staging-local-dead")), false, `${JSON.stringify(source)} still sweeps dead staging areas`);
    }
    // A source that really escapes `local/` keeps its old answer: it names
    // nothing inside and never switches keep-whole on, so only the copies a
    // configured source still names are kept.
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/../outside", "local/keep-a", "npm:x"] }));
    mkdirSync(join(store, "local", "dead"), { recursive: true });
    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "dead")), false, "dead content beside an escaping source is still collected");
    assert.equal(existsSync(join(store, "local", "keep-b")), false, "a copy no source names goes too");
    assert.equal(existsSync(join(store, "local", "keep-a")), true);
  } finally { f.close(); }
});

test("DR25/C20: the index repairs `local/` before the engine lists it -- and refuses a write a degraded listing would make", async t => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(join(store, "local", "wedge", "extensions"), { recursive: true });
    writeFileSync(join(store, "local", "wedge", "package.json"), JSON.stringify({ name: "wedge", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(store, "local", "wedge", "extensions", "e.ts"), "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/wedge"] }));
    // A mode-000 `local/` used to be indexed as `entries: []`: the engine's
    // resolve listed nothing it could not read, realpathSync failed on the
    // same names, and the empty answer was written silently -- a degraded
    // index a role then reconciles its entries against. The writer repairs
    // the owned tree the way the prune's listing does, before the engine is
    // asked.
    chmodSync(join(store, "local"), 0o000);
    const index = await writePackageIndex(store);
    assert.deepEqual(index.find(item => item.source === "local/wedge")?.entries,
      ["packages:local/wedge/extensions/e.ts"], "the repaired stage is indexed whole");
    assert.equal(statSync(join(store, "local")).mode & 0o777, 0o700, "the repair kept its bits");

    // What still cannot be listed after the repair is not written as an
    // empty truth: the index as last written stays the record. The staged
    // copy is forced unreadable beneath a listing that never sees the
    // repair succeed -- the same forced-unreadable the sweep's keep-whole
    // test uses.
    const previous = readFileSync(join(store, PACKAGE_INDEX), "utf8");
    const broken = join(realpathSync(store), "local", "broken");
    mkdirSync(join(store, "local", "broken"), { recursive: true });
    writeFileSync(join(store, "local", "broken", "package.json"), JSON.stringify({ name: "broken", pi: { extensions: ["./e.ts"] } }));
    writeFileSync(join(store, "local", "broken", "e.ts"), "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/wedge", "local/broken"] }));
    await assert.rejects(writePackageIndex(store, { ...packageDirectories,
      list: path => path === broken ? null : packageDirectories.list(path),
    }), { code: "BROKER_UNAVAILABLE" });
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous,
      "the degraded index was refused: the file keeps its last truth");
    // A `local`-root source names the stage whole: `local` itself unlistable
    // is the same refusal.
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local"] }));
    await assert.rejects(writePackageIndex(store, { ...packageDirectories,
      list: path => path === join(realpathSync(store), "local") ? null : packageDirectories.list(path),
    }), { code: "BROKER_UNAVAILABLE" });
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous);
    // Unmocked and readable, the same write succeeds again.
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/wedge", "local/broken"] }));
    assert.deepEqual((await writePackageIndex(store)).find(item => item.source === "local/broken")?.entries,
      ["packages:local/broken/e.ts"], "the next change indexes it whole");
  } finally { f.close(); }
});

test("DR25/C20: the index walk reaches a configured copy through a degraded stage -- repairs what oma owns, refuses what it cannot read", async () => {
  const f = createCompleteConfigurationFixture();
  const locked = [join(f.root, "packages", "local", "@scope"), join(f.root, "packages", "local", "sub")];
  try {
    const store = join(f.root, "packages");
    // A scoped staged copy whose intermediate directory lost its owner
    // bits: lstatSync(local/@scope/pkg) threw EACCES, the preflight read
    // the throw as "no copy to look at", and the engine's blind resolve
    // answered `entries: []` -- committed as the package's truth, after
    // which reconciliation strips the package's entries from every role
    // that named them. The walk repairs each directory on the way, exactly
    // as the sweep's own listing does.
    mkdirSync(join(store, "local", "@scope", "pkg", "extensions"), { recursive: true });
    writeFileSync(join(store, "local", "@scope", "pkg", "package.json"),
      JSON.stringify({ name: "@scope/pkg", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(store, "local", "@scope", "pkg", "extensions", "e.ts"), "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/@scope/pkg"] }));
    chmodSync(join(store, "local", "@scope"), 0o000);
    const scoped = await writePackageIndex(store);
    assert.deepEqual(scoped.find(item => item.source === "local/@scope/pkg")?.entries,
      ["packages:local/@scope/pkg/extensions/e.ts"], "a mode-000 intermediate is repaired, never indexed absent");
    assert.equal(statSync(join(store, "local", "@scope")).mode & 0o777, 0o700, "the ancestor's owner bits were put back");

    // A configured copy that is absent is simply absent -- the walk never
    // refuses a name that is not there.
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/gone"] }));
    assert.deepEqual((await writePackageIndex(store)).find(item => item.source === "local/gone")?.entries, [],
      "an absent copy indexes absent, never a refusal");
    const previous = readFileSync(join(store, PACKAGE_INDEX), "utf8");

    // `local` itself a file: the stage's slot is occupied, nothing beneath
    // it can be observed, and the old preflight read that as "no stage" --
    // `entries: []` was committed for every configured local source.
    // Refused: the index keeps its last truth.
    rmSync(join(store, "local"), { recursive: true });
    writeFileSync(join(store, "local"), "stray\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/foo"] }));
    await assert.rejects(writePackageIndex(store), { code: "BROKER_UNAVAILABLE" });
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous, "a non-directory stage refuses the write");
    // A `local` link is the same refusal -- never followed.
    rmSync(join(store, "local"));
    symlinkSync(join(store, "elsewhere"), join(store, "local"));
    await assert.rejects(writePackageIndex(store), { code: "BROKER_UNAVAILABLE" });
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous, "a linked stage refuses the write");

    // An intermediate that is not a directory: `local/foo` can hold no
    // `bar` beneath it, so the configured copy is not "absent" -- it
    // cannot be observed at all. The engine's existsSync answers false
    // for it either way, which is exactly the silent degrade.
    rmSync(join(store, "local"));
    mkdirSync(join(store, "local"));
    writeFileSync(join(store, "local", "foo"), "stray\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/foo/bar"] }));
    await assert.rejects(writePackageIndex(store), { code: "BROKER_UNAVAILABLE" });
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous, "a non-directory intermediate refuses the write");

    // The leaf must be the staged copy itself -- a directory, or the one
    // file a lone extension stages as. A link in its slot is no copy.
    rmSync(join(store, "local", "foo"));
    symlinkSync(join(store, "elsewhere"), join(store, "local", "link"));
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/link"] }));
    await assert.rejects(writePackageIndex(store), { code: "BROKER_UNAVAILABLE" });
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous, "a link at the copy's own slot refuses the write");

    // File-mode loss inside a staged copy and at the staged-file leaf:
    // a mode-000 manifest or staged file indexed as absent while it sat
    // there was the same silent degrade one level down. The walk already
    // visits every entry of the copy, so the owner read/write bits go
    // back where a stray dropped them.
    rmSync(join(store, "local", "link"));
    mkdirSync(join(store, "local", "pkg"));
    writeFileSync(join(store, "local", "pkg", "package.json"), JSON.stringify({ name: "pkg", pi: { extensions: ["./e.ts"] } }));
    writeFileSync(join(store, "local", "pkg", "e.ts"), "export default function () {}\n");
    writeFileSync(join(store, "local", "single.ts"), "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/pkg", "local/single.ts"] }));
    chmodSync(join(store, "local", "pkg", "package.json"), 0o000);
    chmodSync(join(store, "local", "single.ts"), 0o000);
    const healed = await writePackageIndex(store);
    assert.deepEqual(healed.find(item => item.source === "local/pkg")?.entries, ["packages:local/pkg/e.ts"],
      "a copy whose manifest lost its owner bits is repaired and indexed whole");
    assert.deepEqual(healed.find(item => item.source === "local/single.ts")?.entries, ["packages:local/single.ts"],
      "a staged file that lost its owner bits is repaired and indexed whole");
    assert.equal(statSync(join(store, "local", "pkg", "package.json")).mode & 0o777, 0o600);
    assert.equal(statSync(join(store, "local", "single.ts")).mode & 0o777, 0o600);

    // A source spelling `local` itself makes the whole stage one
    // package's truth: a mode-000 directory beneath it degrades the same
    // resolve, so the whole stage gets the same repair.
    rmSync(join(store, "local"), { recursive: true });
    mkdirSync(join(store, "local", "sub"), { recursive: true });
    writeFileSync(join(store, "local", "package.json"), JSON.stringify({ name: "stage", pi: { extensions: ["./sub/e.ts"] } }));
    writeFileSync(join(store, "local", "sub", "e.ts"), "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local"] }));
    chmodSync(join(store, "local", "sub"), 0o000);
    const stage = await writePackageIndex(store);
    assert.deepEqual(stage.find(item => item.source === "local")?.entries, ["packages:local/sub/e.ts"],
      "a source naming the stage is repaired at every level too");
    assert.equal(statSync(join(store, "local", "sub")).mode & 0o777, 0o700);
  } finally {
    for (const path of locked) try { chmodSync(path, 0o700); } catch { /* already gone */ }
    try { chmodSync(join(f.root, "packages", "local", "pkg", "package.json"), 0o600); } catch { /* already gone */ }
    try { chmodSync(join(f.root, "packages", "local", "single.ts"), 0o600); } catch { /* already gone */ }
    f.close();
  }
});

test("DR25/C20: a resource the index cannot observe is refused, never indexed as absent", async t => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(join(store, "local", "wedge", "extensions"), { recursive: true });
    writeFileSync(join(store, "local", "wedge", "package.json"), JSON.stringify({ name: "wedge", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(store, "local", "wedge", "extensions", "e.ts"), "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/wedge"] }));
    await writePackageIndex(store);
    const previous = readFileSync(join(store, PACKAGE_INDEX), "utf8");
    // The engine names a resource the write then realpath's. A realpath that
    // does not answer -- EACCES on a component, an I/O error -- was `continue`d
    // past, so a still-installed package was committed as `entries: []`: the
    // same degraded truth a mode-000 `local/` used to write. Only the
    // filesystem's own ENOENT names nothing; every other failure is an
    // observation that did not finish, and the write is refused.
    const resource = join(realpathSync(store), "local", "wedge", "extensions", "e.ts");
    const original = fs.realpathSync;
    t.mock.method(fs, "realpathSync", ((path: fs.PathLike, ...rest: unknown[]) => {
      if (String(path) === resource) throw Object.assign(new Error("forced unobservable"), { code: "EACCES" });
      return (original as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.realpathSync);
    syncBuiltinESMExports();
    try { await assert.rejects(writePackageIndex(store), { code: "BROKER_UNAVAILABLE" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous,
      "the write was refused: the index keeps its last truth");
    // Unmocked and observable, the same write answers the package whole again.
    assert.deepEqual((await writePackageIndex(store)).find(item => item.source === "local/wedge")?.entries,
      ["packages:local/wedge/extensions/e.ts"]);
  } finally { f.close(); }
});

test("DR25/C20: a staged name of three or more components flushes every directory that names it", async t => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    const source = join(f.root, "src", "deep");
    mkdirSync(join(source, "extensions"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "deep/inside/pkg", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(source, "extensions", "e.ts"), "export default function () {}\n");
    // `local/deep` is made by the publish's descend and holds `inside`'s
    // dirent; `local` and `local/deep/inside` were flushed, it was not -- a
    // crash after the rename could keep the directory without the name that
    // walks to the staged copy. Every directory the name passed through is
    // flushed before the publish answers.
    const flushed = new Set<string>();
    const native = fs.fsyncSync;
    t.mock.method(fs, "fsyncSync", (fd: number) => {
      native(fd);
      try { flushed.add(fs.readlinkSync(`/proc/self/fd/${fd}`)); } catch { /* a descriptor that names nothing on disk */ }
    });
    syncBuiltinESMExports();
    try { assert.equal(await stageLocalPackage(store, source), "local/deep/inside/pkg"); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    const root = realpathSync(store);
    for (const dir of ["local", "local/deep", "local/deep/inside"])
      assert.ok(flushed.has(join(root, dir)), `the directory holding the next name was never flushed: ${dir}`);
    assert.ok(existsSync(join(root, "local", "deep", "inside", "pkg", "package.json")));
  } finally { f.close(); }
});

test("DR25/C20: a file or link in a strict-prefix slot is collected by the install itself -- the wedge never reaches the user", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(join(store, "local"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/foo/bar"] }));
    const source = join(f.root, "src", "nested");
    mkdirSync(join(source, "extensions"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "foo/bar", pi: { extensions: ["./extensions/e.ts"] } }));
    writeFileSync(join(source, "extensions", "e.ts"), "export default function () {}\n");

    // A file where the staged name needs a directory: the descend's open
    // answered containment, and the sweep that collects the stray only
    // runs after a successful engine change -- so `oma pi install` of
    // foo/bar wedged on every retry until an unrelated mutation. The
    // publish now collects the blocking entry exactly as the sweep does,
    // once, and the install proceeds.
    writeFileSync(join(store, "local", "foo"), "stray\n");
    writeFileSync(join(store, "local", "other"), "dead sibling\n");
    assert.equal(await stageLocalPackage(store, source), "local/foo/bar", "the stray prefix is collected by the install itself");
    assert.equal(lstatSync(join(store, "local", "foo"), { throwIfNoEntry: false })?.isDirectory(), true,
      "the stray file's slot is the scope directory the install needed");
    assert.ok(existsSync(join(store, "local", "foo", "bar", "package.json")), "the staged copy landed");
    assert.equal(readFileSync(join(store, "local", "other"), "utf8"), "dead sibling\n",
      "the collection stays at the blocking prefix -- a stray beside it remains the sweep's");

    // A link in the same slot is collected the same way -- unlinked as the
    // entry it is, never followed.
    const target = join(store, "real-target");
    mkdirSync(target); writeFileSync(join(target, "keep"), "kept\n");
    rmSync(join(store, "local", "foo"), { recursive: true });
    symlinkSync(target, join(store, "local", "foo"));
    assert.equal(await stageLocalPackage(store, source), "local/foo/bar", "the stray link is collected by the install itself");
    assert.equal(existsSync(join(store, "local", "foo", "bar", "extensions", "e.ts")), true);
    assert.equal(readFileSync(join(target, "keep"), "utf8"), "kept\n", "the link's target is not the entry's");

    // `local` itself as a stray file wedges the publish's own open the
    // same way -- collected, remade, staged into.
    rmSync(join(store, "local"), { recursive: true });
    writeFileSync(join(store, "local"), "the whole stage as a file\n");
    assert.equal(await stageLocalPackage(store, source), "local/foo/bar", "a stray `local` file is collected and remade");
    assert.equal(statSync(join(store, "local")).isDirectory(), true);
    assert.ok(existsSync(join(store, "local", "foo", "bar", "package.json")));

    // The sweep's own answers are unchanged: the now-configured copy is
    // kept, dead content beside it is still collected.
    writeFileSync(join(store, "local", "other"), "dead sibling\n");
    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "foo", "bar", "extensions", "e.ts")), true, "the staged copy is kept once named");
    assert.equal(existsSync(join(store, "local", "other")), false, "dead content beside it is still the sweep's");
  } finally { f.close(); }
});

test("DR25/C20: a configured `local/foo/sub` descends `local/foo` and keeps its child only -- the scope rule generalized", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    // resourceEntryProblem accepts multi-component names, so `local/foo/sub`
    // is a lawful configured source: the copy IS the `sub` child beneath the
    // `foo` directory, the same shape `local/@scope/pkg` has under its scope.
    // A bare prefix keep of `foo` held dead siblings forever; the entry is
    // descended and only configured children stay, as under a scope.
    mkdirSync(join(store, "local", "foo", "sub"), { recursive: true });
    writeFileSync(join(store, "local", "foo", "sub", "e.ts"), "export default function () {}\n");
    mkdirSync(join(store, "local", "foo", "dead"), { recursive: true });
    mkdirSync(join(store, "local", "whole", "child"), { recursive: true });
    writeFileSync(join(store, "local", "whole", "child", "x.ts"), "x\n");
    // `gone/b` is configured but `gone` holds only a dead sibling: the
    // descended directory is emptied and collected with it.
    mkdirSync(join(store, "local", "gone", "dead"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/foo/sub", "local/whole", "local/gone/b"] }));

    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "foo", "sub", "e.ts")), true, "the configured child is kept");
    assert.equal(existsSync(join(store, "local", "foo", "dead")), false, "a dead sibling under a descended entry is collected");
    assert.equal(existsSync(join(store, "local", "foo")), true, "the kept child's parent directory stays");
    assert.equal(existsSync(join(store, "local", "whole", "child", "x.ts")), true, "a source naming the entry itself keeps it whole");
    assert.equal(existsSync(join(store, "local", "gone")), false, "a descended directory emptied of dead children goes too");
  } finally { f.close(); }
});

test("DR25/C20: a `local/` entry or descended directory that lost its mode is repaired in place -- it never aborts the prune", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    // The store is oma's own tree, and the descended readdirSync used to
    // throw EACCES out of the sweep on a mode-000 entry -- wedging the prune
    // mid-way and every later `oma pi` change with it. removeOwnedTree
    // already repairs the same loss with fchmod inside the trees it deletes;
    // the sweep now gives a directory its owner bits back before listing --
    // only ever adding bits, never stripping what a kept directory has.
    for (const [name, mode] of [["gone-read", 0o000], ["read-only", 0o555]] as const) {
      mkdirSync(join(store, "local", name, "sub"), { recursive: true });
      writeFileSync(join(store, "local", name, "sub", "e.ts"), "export default function () {}\n");
      mkdirSync(join(store, "local", name, "dead"), { recursive: true });
      chmodSync(join(store, "local", name), mode);
    }
    mkdirSync(join(store, "local", "zzz-dead"), { recursive: true });
    mkdirSync(join(store, "local", "live"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/gone-read/sub", "local/read-only/sub", "local/live"] }));

    pruneLocalStage(store);
    // mode 000: nothing inside could even be listed.
    assert.equal(existsSync(join(store, "local", "gone-read", "sub", "e.ts")), true, "a kept child under a mode-000 directory stays");
    assert.equal(existsSync(join(store, "local", "gone-read", "dead")), false, "a dead child under a mode-000 directory is collected");
    assert.equal(statSync(join(store, "local", "gone-read")).mode & 0o777, 0o700, "the repair gives the owner its bits back");
    // mode 555: children listed but none removable without owner write.
    assert.equal(existsSync(join(store, "local", "read-only", "sub")), true, "a kept child under a read-only directory stays");
    assert.equal(existsSync(join(store, "local", "read-only", "dead")), false, "a dead child under a read-only directory is collected");
    assert.equal(statSync(join(store, "local", "read-only")).mode & 0o777, 0o755, "the repair adds the missing owner bit only");
    assert.equal(existsSync(join(store, "local", "zzz-dead")), false, "the sweep reaches dead content after them");
    assert.equal(existsSync(join(store, "local", "live")), true, "a package settings still names is kept");

    // `local/` itself in the same shape: reading it threw EACCES before the
    // first entry was ever seen -- the same wedge one level up.
    mkdirSync(join(store, "local", "late-dead"), { recursive: true });
    chmodSync(join(store, "local"), 0o000);
    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "late-dead")), false, "a mode-000 `local` is still swept");
    assert.equal(existsSync(join(store, "local", "live")), true, "and the live package is still kept");
    chmodSync(join(store, "local"), 0o755);
  } finally { f.close(); }
});

test("DR25/C20: an entry the sweep cannot read or a name that vanished is skipped or kept whole -- never an abort", t => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    // Two ways the sweep used to die on a single entry: readdirSync on an
    // entry it cannot list (here forced for `broken` even after the mode
    // repair, the keep-whole fallback the repair precedes), and lstatSync
    // ENOENT on a name that vanished between the listing and the stat --
    // simulated as phantom names the listing reports but nothing backs.
    mkdirSync(join(store, "local", "broken", "sub"), { recursive: true });
    writeFileSync(join(store, "local", "broken", "sub", "e.ts"), "export default function () {}\n");
    // A dead child beside the kept one: only a kept-whole `broken` retains it.
    mkdirSync(join(store, "local", "broken", "dead"), { recursive: true });
    mkdirSync(join(store, "local", "foo", "sub"), { recursive: true });
    mkdirSync(join(store, "local", "zzz-dead"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/broken/sub", "local/foo/sub"] }));
    // The sweep reads the store by its real path -- and beneath held
    // descriptors, so a /proc/self/fd listing name resolves back to the
    // directory it pins -- so the keys must be resolved the same way.
    const root = realpathSync(store);
    const broken = join(root, "local", "broken");
    const phantoms = new Map([[root, ".staging-local-phantom"], [join(root, "local", "foo"), "ghost-child"]]);
    const injected: string[] = [];
    pruneLocalStage(store, { list: dir => {
      if (dir === broken) return null;
      const listed = packageDirectories.list(dir);
      if (listed === null) return null;
      const phantom = phantoms.get(dir);
      if (phantom === undefined) return listed;
      injected.push(dir);
      return [...listed, { name: phantom, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }];
    } });
    assert.deepEqual([...new Set(injected)], [root, join(root, "local", "foo")],
      "the vanished names were really reported by their listings");
    assert.equal(existsSync(join(store, "local", "broken", "sub", "e.ts")), true, "an unlistable entry is kept whole");
    assert.equal(existsSync(join(store, "local", "broken", "dead")), true, "a kept-whole entry's other children stay with it");
    assert.equal(lstatSync(join(store, "local", "zzz-dead"), { throwIfNoEntry: false }), undefined,
      "dead content after the bad entries is still collected");
    assert.equal(existsSync(join(store, "local", "foo", "sub")), true, "a kept child beside the vanished name stays");
    assert.equal(existsSync(join(store, "local", "foo")), true, "the descended entry itself stays");
  } finally { f.close(); }
});

test("DR25/C20: a configured source is descended to the depth it needs -- dead content is collected at every level", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    // The one-level descend kept `a/b` whole for `local/a/b/c`, retaining
    // `a/b/dead` forever. The descend now follows configured sources to
    // whatever depth they reach: children a source names are kept, prefixes
    // of sources are descended, and the rest is collected at every level.
    mkdirSync(join(store, "local", "a", "b", "c"), { recursive: true });
    writeFileSync(join(store, "local", "a", "b", "c", "e.ts"), "export default function () {}\n");
    mkdirSync(join(store, "local", "a", "b", "dead-grandchild"), { recursive: true });
    mkdirSync(join(store, "local", "a", "dead-child"), { recursive: true });
    // `gone/x/y` is configured but `gone` holds only dead content: the chain
    // is emptied and collected at both levels.
    mkdirSync(join(store, "local", "gone", "dead"), { recursive: true });
    mkdirSync(join(store, "local", "gone", "x", "dead"), { recursive: true });
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/a/b/c", "local/gone/x/y"] }));

    pruneLocalStage(store);
    assert.equal(existsSync(join(store, "local", "a", "b", "c", "e.ts")), true, "the configured copy is kept");
    assert.equal(existsSync(join(store, "local", "a", "b", "dead-grandchild")), false, "a dead grandchild is collected");
    assert.equal(existsSync(join(store, "local", "a", "dead-child")), false, "a dead child is collected");
    assert.equal(existsSync(join(store, "local", "a")), true, "the chain holding the copy stays");
    assert.equal(existsSync(join(store, "local", "gone")), false, "a chain emptied of dead content goes at every level");
  } finally { f.close(); }
});

test("DR25/C20: a stray at the package-store slot itself is collected -- never swept into or staged into", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    const victim = join(f.root, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "kept\n");
    // The sweep and the staging opens reached the store through its real
    // path, so a stray at the store's own slot was never in either's
    // collection: the prune realpath'd past a link and swept inside its
    // target, and the ensured open wedged on a file or link there for good.
    // The slot is oma's to keep; what occupies it is collected as the entry
    // it is -- a link is unlinked, never followed.
    rmSync(store, { recursive: true });
    symlinkSync(victim, store);
    pruneLocalStage(store);
    assert.equal(lstatSync(store, { throwIfNoEntry: false }), undefined, "the stray link is unlinked");
    assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "kept\n", "the link's target is never the sweep's");
    assert.equal(existsSync(join(victim, "local")), false, "no stage is made inside a link's target");
    writeFileSync(store, "stray\n");
    pruneLocalStage(store);
    assert.equal(lstatSync(store, { throwIfNoEntry: false }), undefined, "a stray file is collected the same way");

    // The install path takes the same answer: the slot is collected and the
    // store then answers absent -- the next `oma pi`'s ensure remakes it --
    // rather than the staging opening inside whatever a link named.
    symlinkSync(victim, store);
    const source = join(f.root, "src", "pkg");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "pkg", pi: { extensions: ["./e.ts"] } }));
    writeFileSync(join(source, "e.ts"), "export default function () {}\n");
    await assert.rejects(stageLocalPackage(store, source), /does not exist/);
    assert.equal(lstatSync(store, { throwIfNoEntry: false }), undefined, "the stray link is collected");
    assert.deepEqual(readdirSync(victim), ["keep.txt"], "nothing was staged into the link's target");
  } finally { f.close(); }
});

test("DR25/C20: a staged file whose stat fails -- or answers as another kind -- refuses the index write", async t => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    mkdirSync(join(store, "local", "pkg"), { recursive: true });
    writeFileSync(join(store, "local", "pkg", "package.json"),
      JSON.stringify({ name: "pkg", pi: { extensions: ["./e.ts"] } }));
    const leaf = join(store, "local", "pkg", "e.ts");
    writeFileSync(leaf, "export default function () {}\n");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["local/pkg"] }));
    await writePackageIndex(store);
    const previous = readFileSync(join(store, PACKAGE_INDEX), "utf8");
    const path = realpathSync(leaf);
    const real = fs.lstatSync;
    // Between the listing and the stat the copy's file became something
    // else -- or stopped answering. Either is "cannot be read whole", never
    // the "absent" lstat's own ENOENT reports for a name that is not there.
    const bait = join(f.root, "bait");
    symlinkSync("nothing", bait);
    t.mock.method(fs, "lstatSync", ((given: fs.PathLike, ...rest: unknown[]) => {
      if (String(given) === path) return (real as (...args: unknown[]) => unknown)(bait);
      return (real as (...args: unknown[]) => unknown)(given, ...rest);
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    try { await assert.rejects(writePackageIndex(store), { code: "BROKER_UNAVAILABLE" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous,
      "a leaf swapped to a link between listing and stat is no committed empty truth");

    t.mock.method(fs, "lstatSync", ((given: fs.PathLike, ...rest: unknown[]) => {
      if (String(given) === path) throw Object.assign(new Error("no answer"), { code: "EACCES" });
      return (real as (...args: unknown[]) => unknown)(given, ...rest);
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    try { await assert.rejects(writePackageIndex(store), { code: "BROKER_UNAVAILABLE" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous,
      "a leaf whose stat cannot be observed is no committed empty truth");
  } finally { f.close(); }
});

test("DR25/C20: a source spelled absolutely or denormalized still names its staged copy -- degraded, it is repaired or refused, never committed empty", async t => {
  const f = createCompleteConfigurationFixture();
  try {
    const store = join(f.root, "packages");
    mkdirSync(store, { recursive: true });
    const copy = join(realpathSync(store), "local", "pkg");
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, "package.json"), JSON.stringify({ name: "pkg", pi: { extensions: ["./e.ts"] } }));
    const ext = join(copy, "e.ts");
    writeFileSync(ext, "export default function () {}\n");
    // The engine resolves every spelling that lands on the copy -- absolute,
    // `..`-, `.`-, `//`- or trailing-slash-spelled -- so the prune resolves
    // them all onto the same kept path. The index's preflight asked the
    // source's own string instead and never reached the copy: a degrade
    // under any of these spellings committed as the empty truth.
    const absolute = join(realpathSync(store), "local", "pkg");
    for (const spelling of [absolute, "local/../local/pkg", "local/./pkg", "local//pkg", "local/pkg/"]) {
      chmodSync(ext, 0o000);
      writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: [spelling] }));
      const indexed = await writePackageIndex(store);
      assert.equal(statSync(ext).mode & 0o777, 0o600, `${spelling}: the staged file's owner bits went back before the commit`);
      assert.deepEqual(indexed.find(item => item.source === spelling)?.entries,
        [`packages:local/pkg/e.ts`], `${spelling}: the copy indexed whole`);
    }

    // `local/../local` names the stage itself the way the sweep's
    // `relative`-is-"" reading keeps it whole -- under the lexical equality
    // that spelling never reached `whole` and the degraded stage committed.
    mkdirSync(join(store, "local", "sub"), { recursive: true });
    writeFileSync(join(store, "local", "package.json"),
      JSON.stringify({ name: "stage", pi: { extensions: ["./pkg/e.ts"] } }));
    const wholeSpelling = `${realpathSync(store)}/local/../local`;
    writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: [wholeSpelling] }));
    chmodSync(copy, 0o000);
    chmodSync(join(store, "local", "sub"), 0o000);
    await writePackageIndex(store);
    assert.equal(statSync(copy).mode & 0o777, 0o700, "the whole-stage spelling repairs `local` through every level");
    assert.equal(statSync(join(store, "local", "sub")).mode & 0o777, 0o700);

    // The same reach, degraded past repair: refused, the index keeping its
    // last truth rather than committing an empty one.
    const previous = readFileSync(join(store, PACKAGE_INDEX), "utf8");
    const stagePath = join(realpathSync(store), "local");
    await assert.rejects(writePackageIndex(store, { ...packageDirectories,
      list: path => path === stagePath ? null : packageDirectories.list(path),
    }), { code: "BROKER_UNAVAILABLE" });
    assert.equal(readFileSync(join(store, PACKAGE_INDEX), "utf8"), previous,
      "an unlistable stage under a whole-stage spelling refuses the write");
  } finally {
    try { chmodSync(join(f.root, "packages", "local", "sub"), 0o700); } catch { /* already gone */ }
    try { chmodSync(join(f.root, "packages", "local", "pkg"), 0o700); } catch { /* already gone */ }
    try { chmodSync(join(f.root, "packages", "local", "pkg", "e.ts"), 0o600); } catch { /* already gone */ }
    f.close();
  }
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
      [{ source: "npm:oma-hello-ext", entries: [HELLO] , skills: [], prompts: [], themes: [] }]);
    assert.deepEqual(offered.rows.find(row => row.id === HELLO), { id: HELLO, principal: false, workers: false, locked: false, source: "npm:oma-hello-ext" });
    toggleExtension(offered, HELLO, "workers", true);
    toggleExtension(readExtensions(readSettingsForEditing(projectPath).snapshot!, "principal", "resident",
      [{ source: "npm:oma-hello-ext", entries: [HELLO] , skills: [], prompts: [], themes: [] }]), HELLO, "principal", true);

    // Each session, now and later, is made with the project's roles and its own installation.
    const own = { society: "demo-2", node: process.execPath, libdir: f.installation,  deploymentDigest: "b".repeat(64), packages };
    for (const society of ["demo-2", "demo-3"]) {
      const sessionPath = join(f.root, society, "config.json");
      mkdirSync(join(f.root, society), { recursive: true });
      const derived = deriveSessionSettings(readSettingsForEditing(projectPath), sessionPath, { ...own, society });
      assert.deepEqual(derived.missing, []);
      const session = loadConfiguration(sessionPath);
      assert.equal(session.config.society, society);
      assert.equal(Object.hasOwn(session.config.installation, "rootfs"), false);
      assert.equal(session.config.installation.deploymentDigest, own.deploymentDigest);
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

test("P0-8/DR25: settings hidden by a degraded oma-owned ancestor are repaired and read -- never seeded over", () => {
  // A mode-000 `.projects` component makes existsSync answer false for the
  // settings file it hides; the create branch then seeded a new generation
  // over the committed bundle. The repair must restore observability, never
  // content: after it runs, the path is observed again.
  const f = createCompleteConfigurationFixture();
  try {
    const dataRoot = join(f.root, "oma");
    const project = "demo";
    const settingsDir = join(dataRoot, ".projects", project);
    const societyDir = join(dataRoot, project);
    mkdirSync(settingsDir, { recursive: true });
    mkdirSync(societyDir, { recursive: true });
    // The committed project settings (quota 4), as the managed bundle the
    // ensure maintains, and the first society's own configuration the
    // create branch would have seeded from (quota 5).
    writeSettings(join(settingsDir, "config.json"), { ...f.config, society: project }, dataRoot);
    assert.equal(projectBundle(join(settingsDir, "config.json"), dataRoot).layout.kind, "operations");
    const grown = f.config.limits.logBytes + 1;
    writeSettings(join(societyDir, "config.json"), { ...f.config, society: project,
      limits: { ...f.config.limits, logBytes: grown } }, dataRoot);
    for (const degraded of [settingsDir, join(dataRoot, ".projects")]) {
      chmodSync(degraded, 0o000);
      try {
        assert.equal(existsSync(join(settingsDir, "config.json")), false, "the ancestor really hides the settings file");
        const ensured = ensureProjectSettings(dataRoot, project, f.installation);
        assert.equal(ensured.config.limits.logBytes, f.config.limits.logBytes,
          "the committed settings were not replaced by the seed the hidden probe could not see");
      } finally { chmodSync(degraded, 0o700); }
      assert.equal(loadConfiguration(join(settingsDir, "config.json")).config.limits.logBytes, f.config.limits.logBytes);
    }
  } finally { f.close(); }
});

test("P0-8/DR25: a seed candidate that cannot be observed refuses, never reads as no earlier settings", () => {
  // The society root is oma's own under the data root but is not the
  // settings ensure's to repair, so an unobservable seed is an unknown --
  // refused, not silently answered with the product's defaults.
  const f = createCompleteConfigurationFixture();
  try {
    const dataRoot = join(f.root, "oma");
    const project = "demo";
    // The defaults path computes the deployment digest, so the fixture's
    // installation carries the inventory files it enumerates -- without
    // them the ensure refused there first and the hidden seed was never
    // the thing being judged.
    for (const asset of ["packages/contracts/dist/index.js", "packages/storage/src/schema-v4.sql",
      "dist/libexec/oma", "package.json", "package-lock.json"]) {
      mkdirSync(join(f.installation, dirname(asset)), { recursive: true });
      writeFileSync(join(f.installation, asset), "{}\n");
    }
    mkdirSync(join(f.installation, "packages/platform-linux/dist/systemd"), { recursive: true });
    const societyDir = join(dataRoot, project);
    mkdirSync(societyDir, { recursive: true });
    writeSettings(join(societyDir, "config.json"), { ...f.config, society: project }, dataRoot);
    chmodSync(societyDir, 0o000);
    try { assert.throws(() => ensureProjectSettings(dataRoot, project, f.installation)); }
    finally { chmodSync(societyDir, 0o700); }
    assert.equal(existsSync(join(dataRoot, ".projects", project, "config.json")), false,
      "no settings were seeded over a society configuration that could not be observed");
  } finally { f.close(); }
});

test("P0-8/DR25: a package change still reaches a project its degraded settings directory hid", () => {
  // applyPackageChange's per-project probe had the same blind spot: a
  // mode-000 `.projects/<name>` read as absent settings and the project was
  // skipped whole -- the committed role kept an extension the removal had
  // ended. The owned repair runs before the probe.
  const f = createCompleteConfigurationFixture();
  try {
    const dataRoot = join(f.root, "oma");
    const packages = store(f.root, { "oma-hello-ext": hello });
    const other = "other";
    const otherDir = join(dataRoot, ".projects", other);
    mkdirSync(otherDir, { recursive: true });
    const otherPath = join(otherDir, "config.json");
    writeSettings(otherPath, { ...f.config, society: other, installation: { ...f.config.installation, packages } }, dataRoot);
    projectBundle(otherPath, dataRoot);
    // The Workers chose the package's extension; it is committed.
    const context = readExtensions(readSettingsForEditing(otherPath).snapshot!, "principal", "resident",
      [{ source: "npm:oma-hello-ext", entries: [HELLO] , skills: [], prompts: [], themes: [] }]);
    toggleExtension(context, HELLO, "workers", true);
    const installed: InstalledPackage[] = [{ source: "npm:oma-hello-ext", entries: [HELLO] , skills: [], prompts: [], themes: [] }];
    chmodSync(otherDir, 0o000);
    try {
      const applied = applyPackageChange({ dataRoot, project: null, libdir: f.installation, before: installed, after: [] });
      assert.equal(applied.ok, true, JSON.stringify(applied.said));
    } finally { chmodSync(otherDir, 0o700); }
    const roles = loadConfigurationSnapshot(otherPath).authoredRoles;
    assert.ok(!(roles.resident!.value.extensions as string[]).includes(HELLO),
      "the removal reached the hidden project's committed roles instead of skipping it");
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
    const code = await runEngineLogin(engineLoginDirectory, { stateRoot, libdir: f.installation, override: engine, fence: 1,
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
    for (const content of ["{broken", "{}", JSON.stringify({kind: PACKAGE_INDEX_KIND, packages:[null]}), JSON.stringify({kind: PACKAGE_INDEX_KIND, packages:[{ source: "npm:x", entries: ["packages:../x.js"], skills: [], prompts: [], themes: [] }]}),
      JSON.stringify({kind: PACKAGE_INDEX_KIND, packages:[{ source: "npm:x", entries: [], skills: [], prompts: [], themes: [] }, { source: "npm:x", entries: [], skills: [], prompts: [], themes: [] }]})]) {
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
    const heavy = [{ source: "npm:skills-pack", entries: [], prompts: [], themes: [],
      skills: Array.from({ length: 24_000 }, (_, i) => `packages:npm/node_modules/skills-pack/skills/skill-${i}/SKILL.md`) }];
    const text = encodePackageIndex(heavy);
    assert.ok(Buffer.byteLength(text) > 1024 * 1024, "the fixture must exceed the old 1 MiB bound");
    assert.ok(Buffer.byteLength(text) <= PACKAGE_INDEX_BYTES, "the fixture must fit the configured bound");
    writeFileSync(join(packages, PACKAGE_INDEX), text);
    assert.equal(readPackageIndex(packages)[0]!.skills!.length, 24_000);

    // Over the configured bound the refusal names it -- a limit, not corrupt bytes.
    const over = [{ source: "npm:x", entries: [], skills: Array.from({ length: 200_000 },
      (_, i) => `packages:npm/node_modules/x/skills/skill-${i}/SKILL.md`) , prompts: [], themes: [] }];
    writeFileSync(join(packages, PACKAGE_INDEX), JSON.stringify({kind: PACKAGE_INDEX_KIND, packages: over}));
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
      before: [], after: [{ source: "npm:oma-hello-ext", entries: [HELLO] , skills: [], prompts: [], themes: [] }] });
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

test("DR46: previous package-index shapes refuse without rewriting bytes, current malformed lists remain errors", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const packages = store(f.root, { "oma-hello-ext": hello });
    const old = JSON.stringify([{ source: "npm:oma-hello-ext", entries: [HELLO] }]);
    writeFileSync(join(packages, PACKAGE_INDEX), old);
    assert.throws(() => readPackageIndex(packages), { code: "UNSUPPORTED_PROFILE" });
    assert.equal(readFileSync(join(packages, PACKAGE_INDEX), "utf8"), old);

    for (const content of [
      JSON.stringify({kind: PACKAGE_INDEX_KIND, packages:[{ source: "npm:x", entries: [], skills: ["bare.md"], prompts: [], themes: [] }]}),
      JSON.stringify({kind: PACKAGE_INDEX_KIND, packages:[{ source: "npm:x", entries: [], skills: [], prompts: ["packages:../out.md"], themes: [] }]}),
      JSON.stringify({kind: PACKAGE_INDEX_KIND, packages:[{ source: "npm:x", entries: [], skills: [], prompts: [], themes: ["packages:a.json", "packages:a.json"] }]}),
      JSON.stringify({kind: PACKAGE_INDEX_KIND, packages:[{ source: "npm:x", entries: [], skills: "packages:x", prompts: [], themes: [] }]}),
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
      { society: "s", provider: "p", model: "m", extensions: [], packageResources: resources });
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
    const profile = { provider: "pi", model: "current", inferenceSeconds: 1, prompt: "", extensions: [], packageResources: resources };
    const limits = { frameBytes: 1, idleStreamSeconds: 1, receiptWaitSeconds: 1, batchMaxMessages: 1, mailBodyBytes: 1, contextBytes: 1, bundleBytes: 1 };

    const confinement = {
      host: {  libdir: f.installation, packages: root, node: "/usr/bin/node",
        pi: `${RESIDENT_PATHS.libdir}/engine/cli.js`, piModeArgs: [],
        stateRoot: state, runRoot: join(f.root, "run"),
        limits: { frameBytes: 1, batchMaxMessages: 1 } },
      lease: decodeRunLease({ actor: "a", incarnation: 1, socketHostPath: paths.socket }, { actor: "a", runRoot }),
      directories: dirs,
    };
    const confined = planPiSpawn(residentEngineEffects.sandbox, { actor: "a", society: "s", paths, profile, limits, confinement } as never);
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
    const unmounted = planPiSpawn(residentEngineEffects.sandbox, { actor: "a", society: "s", paths,
      profile: { ...profile, packageResources: undefined }, limits,
      confinement: { ...confinement, host: { ...confinement.host, packages: undefined } } } as never);
    assert.equal(unmounted.args.includes("OMA_PACKAGE_STORE"), false);
    // A resource under no mount must not reach a confined engine at all.
    const stray = { ...resources, skills: [join(f.root, "elsewhere", "SKILL.md")] };
    assert.throws(() => planPiSpawn(residentEngineEffects.sandbox, { actor: "a", society: "s", paths,
      profile: { ...profile, packageResources: stray }, limits, confinement } as never), { code: "AUTH_FAILED" });
  } finally { f.close(); }
});
