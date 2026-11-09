import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("001. Publication collection skips a named pipe without waiting for a writer", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-publication-fifo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pipe = join(root, ".value.12345678-1234-4123-8123-123456789abc.held.tmp");
  const deadFile = join(root, ".value.12345678-1234-4123-8123-123456789abd.held.tmp");
  execFileSync("mkfifo", [pipe]);
  writeFileSync(deadFile, "unaccepted temporary");
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { publishNoReplace } from '@oma/storage/durable-fs';
    import { join } from 'node:path';
    publishNoReplace(join(process.argv[1], 'value'), 'published');
  `, root], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  assert.equal(probe.error, undefined, `publication did not finish: ${probe.error?.message}`);
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(readFileSync(join(root, "value"), "utf8"), "published");
  assert.equal(lstatSync(pipe).isFIFO(), true);
  assert.equal(lstatSync(deadFile, { throwIfNoEntry: false }), undefined);
});
