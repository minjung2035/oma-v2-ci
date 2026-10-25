// VIEW-002/003: the unit log view is bounded and explicit about truncation.
// A chatty diagnostic stream must not turn a successful bounded read into an
// error, and a failed command must not be reported as an empty log.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUnitLogs } from "@oma/broker/logs";
import { StoreError } from "@oma/domain/errors";
import { removeTree } from "./fixtures/cleanup.js";

/** A fake journalctl on PATH: stdout bytes, stderr bytes, exit code. */
function withFakeJournal(fake: { stdoutBytes: number; stderrBytes: number; exitCode: number }, run: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "oma-journal-"));
  const script = join(dir, "journalctl");
  writeFileSync(script, `#!/bin/sh
i=0
while [ $i -lt ${fake.stdoutBytes} ]; do printf 'L'; i=$((i+1)); done
i=0
while [ $i -lt ${fake.stderrBytes} ]; do printf 'E' >&2; i=$((i+1)); done
exit ${fake.exitCode}
`, { mode: 0o755 });
  chmodSync(script, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${dir}:${previous ?? ""}`;
  return run().finally(() => { process.env.PATH = previous; removeTree(dir); });
}

test("VIEW-002: a truncated stdout prefix resolves with an explicit truncation flag", async () => {
  await withFakeJournal({ stdoutBytes: 8192, stderrBytes: 0, exitCode: 0 }, async () => {
    const view = await readUnitLogs("demo", "a", 60, 4096);
    assert.equal(view.truncated, true, "exceeding the requested prefix is reported, not hidden");
    assert.equal(view.text, "L".repeat(4096));
    assert.equal(Number.isSafeInteger(view.observedAtMs), true);
  });
});

test("VIEW-002: diagnostic stderr overflow does not fail a bounded read", async () => {
  await withFakeJournal({ stdoutBytes: 8192, stderrBytes: 32 * 1024, exitCode: 0 }, async () => {
    const view = await readUnitLogs("demo", "a", 60, 4096);
    assert.equal(view.truncated, true);
    assert.equal(view.text, "L".repeat(4096));
    assert.equal(view.text.includes("E"), false, "diagnostic stderr is never merged into the view");
  });
});

test("VIEW-002: a complete stdout with a failed command is an error, not an empty log", async () => {
  await withFakeJournal({ stdoutBytes: 10, stderrBytes: 64, exitCode: 3 }, async () => {
    await assert.rejects(readUnitLogs("demo", "a", 60, 4096), (error: unknown) =>
      error instanceof StoreError && error.code === "INTERNAL_ERROR" && error.message.includes("EEE"));
  });
});

test("VIEW-002: stdout within the prefix is returned verbatim and untruncated", async () => {
  await withFakeJournal({ stdoutBytes: 100, stderrBytes: 0, exitCode: 0 }, async () => {
    const view = await readUnitLogs("demo", "a", 60, 4096);
    assert.equal(view.truncated, false);
    assert.equal(view.text, "L".repeat(100));
  });
});
