/** Actual Linux image execution, not Darwin qualification. A trusted preload
 * schedules namespace mutations; it never fabricates process/descriptor facts. */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESTIC_RELEASE, resticReleaseFor } from "@oma/domain/deployment";
import { managedResticPath } from "@oma/storage/restic-tool";

if (process.platform === "linux") {
  const pin = resticReleaseFor(process.platform, process.arch);
  const binary = process.env.OMA_RESTIC_COMMAND ?? managedResticPath();
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fixture = name => join(root, "test/fixtures", name);
  let work, replacement, archive;
  before(() => {
    assert.ok(pin && binary && existsSync(binary), "Install the pinned host dependency: npm run setup:storage");
    assert.equal(hash(readFileSync(binary)), pin.binarySha256, "the oracle requires the actual pinned release");
    work = mkdtempSync(join(tmpdir(), "oma-restic-setup-oracle-"));
    replacement = join(work, "replacement"); archive = join(work, "release.bz2");
    const compiled = spawnSync("/usr/bin/cc", ["-Wall", "-Wextra", "-Werror", fixture("restic-setup-replacement.c"), "-o", replacement], { encoding: "utf8", timeout: 30000, killSignal: "SIGKILL" });
    assert.equal(compiled.error, undefined); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, compiled.stderr);
    // Recompression is byte-for-byte the pinned upstream archive, not a
    // substitute checksum. No test fetches mutable network data.
    const packed = spawnSync("/usr/bin/bzip2", ["-9", "--stdout", binary], { timeout: 30000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(packed.error, undefined); assert.equal(packed.signal, null); assert.equal(packed.status, 0, packed.stderr?.toString());
    assert.equal(hash(packed.stdout), pin.archiveSha256);
    writeFileSync(archive, packed.stdout);
  });
  after(() => { if (work) rmSync(work, { recursive: true, force: true }); });
  function run(t, { action = "none", install = false, corrupt = false, mode = 0o755, corruptArchive = false } = {}) {
    const dataHome = mkdtempSync(join(work, "case-"));
    t.after(() => rmSync(dataHome, { recursive: true, force: true }));
    const target = managedResticPath({ XDG_DATA_HOME: dataHome });
    if (!install) {
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      if (corrupt) copyFileSync(replacement, target); else copyFileSync(binary, target);
      chmodSync(target, mode);
    }
    let packed = archive;
    if (corruptArchive) { packed = join(dataHome, "bad.bz2"); writeFileSync(packed, "unverified archive"); }
    const observation = join(dataHome, "observation.json"), config = join(dataHome, "case.json");
    writeFileSync(config, JSON.stringify({ action, target, replacement, observation, archive: install ? packed : null,
      url: `https://github.com/restic/restic/releases/download/v${RESTIC_RELEASE.version}/${pin.archive}` }));
    const result = spawnSync(process.execPath, ["--import", fixture("restic-setup-interposition.mjs"), join(root, "scripts/install-restic.mjs")], {
      env: { ...process.env, XDG_DATA_HOME: dataHome, OMA_RESTIC_SETUP_TEST: config },
      encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    const observed = JSON.parse(readFileSync(observation, "utf8"));
    t.diagnostic(JSON.stringify(observed));
    return { result, observed, target };
  }
  function assertPinned({ result, observed }) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^restic ${RESTIC_RELEASE.version.replaceAll(".", "\\.")} compiled with `));
    assert.doesNotMatch(result.stdout, /OMA_RESTIC_REPLACEMENT_EXECUTED/);
    assert.equal(observed.execution.status, 0); assert.equal(observed.execution.error, null);
    assert.equal(observed.descriptorClosed, true, "the owning installer closes its descriptor after execution");
  }
  for (const [name, options] of [
    ["verified executable survives pathname replacement", { action: "replace" }],
    ["verified executable survives pathname unlink", { action: "unlink" }],
    ["newly installed executable survives pathname replacement", { action: "replace", install: true }],
  ]) test(`Restic setup: ${name}`, t => {
    const value = run(t, options); assertPinned(value);
    assert.equal(value.observed.mutations, 1);
    assert.deepEqual(value.observed.held, value.observed.before);
    assert.notDeepEqual(value.observed.before, value.observed.after);
    assert.equal(value.observed.heldLinksAtLaunch, options.action === "unlink" ? "0" : "1");
    assert.equal(value.observed.downloads, options.install ? 1 : 0);
  });
  test("Restic setup: a replacement before published-file verification is retained and never executed", t => {
    const { result, observed, target } = run(t, { action: "replace-publication", install: true });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /differs from the pinned release/);
    assert.equal(observed.mutations, 1); assert.equal(observed.execution, null);
    assert.equal(hash(readFileSync(target)), hash(readFileSync(replacement)));
  });
  test("Restic setup: an existing mismatched executable is retained and never executed", t => {
    const { result, observed, target } = run(t, { corrupt: true });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /differs from the pinned release/);
    assert.equal(observed.execution, null); assert.equal(observed.downloads, 0);
    assert.equal(hash(readFileSync(target)), hash(readFileSync(replacement)));
  });
  test("Restic setup: mode-zero repair still verifies and executes the same installed file", t => {
    const value = run(t, { mode: 0 }); assertPinned(value);
    assert.equal(lstatSync(value.target).mode & 0o777, 0o755); assert.equal(value.observed.downloads, 0);
  });
  test("Restic setup: a real execution failure closes the verified descriptor", t => {
    const { result, observed } = run(t, { action: "deny-execution" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Installed Restic could not run/);
    assert.equal(observed.execution.error, "EACCES"); assert.equal(observed.descriptorClosed, true);
  });
  test("Restic setup: an unverified archive is never published or executed", t => {
    const { result, observed, target } = run(t, { install: true, corruptArchive: true });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Restic archive checksum mismatch/);
    assert.equal(observed.execution, null); assert.equal(observed.downloads, 1); assert.equal(existsSync(target), false);
  });
}
