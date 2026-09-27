/** MAC-303 (MV-34): the guest's data disk is formatted only when it was
 * handed over to be made and was never written; a disk that mounts must be
 * this instance's. The probes run against real files with the real tools. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, closeSync, existsSync, ftruncateSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { allZero, hasFilesystem, instanceCheck, makeFilesystem, parseCmdline, provisionDecision } from "../src/platform/guest/provision.js";

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
