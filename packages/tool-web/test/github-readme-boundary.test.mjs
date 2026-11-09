import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

test("001. GitHub root extraction does not follow a README symlink outside its clone", { skip: process.platform === "win32" }, t => {
  const root = mkdtempSync(join(tmpdir(), "oma-clone-readme-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin"), config = join(root, "config"), outside = join(root, "private.txt");
  mkdirSync(bin); mkdirSync(config);
  writeFileSync(outside, "PRIVATE-OUTSIDE-REPOSITORY");
  writeFileSync(join(config, "web-search.json"), JSON.stringify({ githubClone: { clonePath: join(root, "clones") } }));
  writeFileSync(join(bin, "gh"), `#!${process.execPath}\nconst { mkdirSync, symlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
if (args[0] !== "repo" || args[1] !== "clone") process.exit(1);
const destination = args[3];
mkdirSync(destination, { recursive: true });
symlinkSync(process.env.OUTSIDE_README, join(destination, "README.md"));
writeFileSync(join(destination, "README.txt"), "Safe repository README");
`, { mode: 0o755 });
  const extractUrl = new URL("../dist/vendor/pi-web-access/runtime/github-extract.js", import.meta.url).href;
  const utilsUrl = new URL("../dist/vendor/pi-web-access/runtime/utils.js", import.meta.url).href;
  const code = `const { omaInstallWebPolicy } = await import(${JSON.stringify(utilsUrl)});
omaInstallWebPolicy({ egressPinned: null, gitClone: true, ghCli: true });
const { extractGitHub, clearCloneCache } = await import(${JSON.stringify(extractUrl)});
try { console.log(JSON.stringify(await extractGitHub("https://github.com/example/project", undefined, true))); }
finally { clearCloneCache(); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, PI_CODING_AGENT_DIR: config, OUTSIDE_README: outside },
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.error, null);
  assert.ok(!result.content.includes("PRIVATE-OUTSIDE-REPOSITORY"), "a remote repository README escaped the repository boundary");
  assert.ok(result.content.includes("Safe repository README"));
});
