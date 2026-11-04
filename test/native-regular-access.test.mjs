/** Actual regular-file capabilities; no pathname reopen after selection. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, constants, mkdtempSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { openDirectory, openRegularBeneath } from "@oma/native/files";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-regular-access-"))), directory = openDirectory(root);
  t.after(() => { closeSync(directory); rmSync(root, { recursive: true }); }); return { root, directory };
}
test("001. Actual read/write regular acquisition appends to the held inode after pathname replacement", t => {
  const f = fixture(t); writeFileSync(join(f.root, "data"), "before", { mode: 0o600 });
  const fd = openRegularBeneath(f.directory, "data", { writable: true, append: true });
  try {
    const bytes = Buffer.alloc(6); assert.equal(readSync(fd, bytes, 0, bytes.length, 0), 6); assert.equal(bytes.toString(), "before");
    renameSync(join(f.root, "data"), join(f.root, "held")); writeFileSync(join(f.root, "data"), "replacement");
    writeSync(fd, Buffer.from("after"));
    assert.equal(readFileSync(join(f.root, "held"), "utf8"), "beforeafter", "ordinary writes retain append semantics");
    assert.equal(readFileSync(join(f.root, "data"), "utf8"), "replacement");
  } finally { closeSync(fd); }
});
test("002. Actual read-only acquisition cannot be upgraded and links are rejected", t => {
  const f = fixture(t); writeFileSync(join(f.root, "data"), "canary"); symlinkSync("data", join(f.root, "link"));
  const fd = openRegularBeneath(f.directory, "data");
  try { assert.throws(() => writeSync(fd, "bad"), error => error.code === "EBADF" || error.code === "EACCES"); }
  finally { closeSync(fd); }
  assert.throws(() => openRegularBeneath(f.directory, "link", { writable: true }), error => error.code === "STORE_CORRUPT");
  assert.equal(readFileSync(join(f.root, "data"), "utf8"), "canary");
});
test("003. Actual substituted FIFO is rejected without blocking or consuming queued data", t => {
  const f = fixture(t), name = join(f.root, "fifo"), create = spawnSync("/usr/bin/mkfifo", [name, join(f.root, "no-writers")], { encoding: "utf8", timeout: 10000 });
  assert.equal(create.status, 0, create.stderr);
  const held = openSync(name, constants.O_RDWR | constants.O_NONBLOCK);
  try {
    writeSync(held, "queued-canary");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import {closeSync,fstatSync} from 'node:fs';import {openDirectory,openRegularBeneath,pinBeneath} from '@oma/native/files';
      const root=openDirectory(${JSON.stringify(f.root)});try{
        const pin=pinBeneath(root,'no-writers');try{if(!fstatSync(pin).isFIFO())throw new Error('not FIFO');}finally{closeSync(pin);}
        for(const name of ['fifo','no-writers'])for(const options of [{},{writable:true,append:true}]){
          try {const fd=openRegularBeneath(root,name,options);closeSync(fd);process.exitCode=2;}
          catch(error){if(error.code!=='STORE_CORRUPT')throw error;}
        }
      }finally{closeSync(root);}`], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    const bytes = Buffer.alloc(13); assert.equal(readSync(held, bytes, 0, bytes.length, null), 13); assert.equal(bytes.toString(), "queued-canary");
  } finally { closeSync(held); }
});
