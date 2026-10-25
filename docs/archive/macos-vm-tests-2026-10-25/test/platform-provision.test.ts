/** MAC-303 (MV-34): the guest's data disk is formatted only when it was
 * handed over to be made and was never written; a disk that mounts must be
 * this instance's. The probes run against real files with the real tools. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, closeSync, existsSync, ftruncateSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { allZero, hasFilesystem, instanceCheck, makeFilesystem, parseCmdline, provisionDecision, readInstance, writeInstance } from "#oma-test/app/platform/guest/provision";
import { bundleObjectFormat } from "#oma-test/app/platform/guest/project";

const ID = randomUUID();
const tools = existsSync("/usr/sbin/blkid") && existsSync("/usr/sbin/mkfs.ext4");
const never = (): boolean => { throw new Error("the whole disk was read although nothing depended on it"); };

test("MAC-303: the decision -- format only a never-written disk handed over for this instance", () => {
  assert.deepEqual(provisionDecision({ instance: ID, provision: ID, hasFilesystem: false, neverWritten: () => true }), { kind: "format" });
  assert.deepEqual(provisionDecision({ instance: ID, provision: ID, hasFilesystem: true, neverWritten: never }), { kind: "mount" });
  assert.equal(provisionDecision({ instance: ID, provision: null, hasFilesystem: false, neverWritten: never }).kind, "refuse",
    "no file system and not handed over: a damaged disk, left for repair");
  assert.equal(provisionDecision({ instance: ID, provision: randomUUID(), hasFilesystem: false, neverWritten: never }).kind, "refuse",
    "handed over for another instance");
  assert.equal(provisionDecision({ instance: ID, provision: ID, hasFilesystem: false, neverWritten: () => false }).kind, "refuse",
    "handed over, but something was written: not formatted");
  assert.equal(provisionDecision({ instance: null, provision: null, hasFilesystem: true, neverWritten: never }).kind, "refuse");
  assert.equal(instanceCheck(null, ID, true), "write");
  assert.equal(instanceCheck(ID, ID, false), "ok");
  assert.match(instanceCheck(null, ID, false), /does not say/);
  assert.match(instanceCheck(randomUUID(), ID, false), /another engine instance/);
  assert.deepEqual(parseCmdline(`console=hvc0 ro oma.instance=${ID} oma.provision=${ID}\n`), { instance: ID, provision: ID });
  assert.deepEqual(parseCmdline(`console=hvc0 oma.instance=${ID}`), { instance: ID, provision: null });
});

test("MAC-303/MV-34: the probes on real disks -- blank, made, and damaged at its start", { skip: tools ? false : "blkid and mkfs.ext4 are not installed" }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-provision-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const disk = (name: string, bytes = 32 * 1024 * 1024): string => {
    const path = join(dir, name); const fd = openSync(path, "w"); ftruncateSync(fd, bytes); closeSync(fd); return path;
  };
  const blank = disk("blank.img");
  assert.equal(await hasFilesystem(blank), false);
  assert.equal(allZero(blank), true);

  const made = disk("made.img");
  await makeFilesystem(made);
  assert.equal(await hasFilesystem(made), true);
  assert.equal(allZero(made), false);

  // A made disk whose first MiB was wiped: no signature at its start, but it
  // was written; the decision must not format it even when handed over.
  const damaged = disk("damaged.img");
  await makeFilesystem(damaged);
  const fd = openSync(damaged, "r+"); writeSync(fd, Buffer.alloc(1024 * 1024), 0, 1024 * 1024, 0); closeSync(fd);
  assert.equal(await hasFilesystem(damaged), false, "no signature is found at its start");
  assert.equal(allZero(damaged), false, "but the disk was written");
  assert.equal(provisionDecision({ instance: ID, provision: ID, hasFilesystem: false, neverWritten: () => allZero(damaged) }).kind, "refuse");

  // A disk that cannot be read is not a blank one, though blkid says 2 for both.
  const unreadable = disk("unreadable.img");
  chmodSync(unreadable, 0o000);
  if (process.getuid!() !== 0) await assert.rejects(hasFilesystem(unreadable), /could not be read/);
  await assert.rejects(hasFilesystem(join(dir, "absent.img")), /could not be read/);
});

test("P0V-106 (X2-03): the data disk's record is published whole, never replaced by another instance's, and leaves no temporary", () => {
  const mount = mkdtempSync(join(tmpdir(), "oma-instance-"));
  try {
    const instance = randomUUID();
    writeInstance(mount, instance);
    assert.equal(readInstance(mount), instance);
    writeInstance(mount, instance);
    assert.throws(() => writeInstance(mount, randomUUID()), /another instance/);
    assert.equal(readInstance(mount), instance);
    assert.deepEqual(readdirSync(mount).filter(name => name.startsWith(".")), []);
  } finally { rmSync(mount, { recursive: true, force: true }); }
});

test("P0V-106 (G13-02): a bundle's object format is read from its whole capability header, and a header that does not end is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-bundle-head-"));
  try {
    const bundle = (lines: string[]): string => { const path = join(dir, randomUUID()); writeFileSync(path, `${lines.join("\n")}\n`); return path; };
    const padding = `@filter=${"x".repeat(8000)}`;
    assert.equal(bundleObjectFormat(bundle(["# v3 git bundle", padding, "@object-format=sha256", `${"a".repeat(64)} refs/heads/main`])), "sha256",
      "past the first 4096 bytes, still the capabilities");
    assert.equal(bundleObjectFormat(bundle(["# v3 git bundle", "@object-format=sha256", `${"a".repeat(64)} refs/heads/main`])), "sha256");
    assert.equal(bundleObjectFormat(bundle(["# v2 git bundle", `${"a".repeat(40)} refs/heads/main`])), "sha1");
    // An object-format line after the capabilities is a ref line's business, not the format.
    assert.equal(bundleObjectFormat(bundle(["# v3 git bundle", `${"a".repeat(40)} refs/heads/main`, "@object-format=sha256"])), "sha1");
    assert.throws(() => bundleObjectFormat(bundle(["# v3 git bundle", `@filter=${"x".repeat(70 * 1024)}`, "@object-format=sha256"])), /longer than/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
