/** Native presentation has one local exception owner and a real stderr. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { exceptionText } from "@oma/domain/errors";
import { displayable } from "@oma/tui/view/text";

test("Native errors retain paths, errno names, and authored non-English text", () => {
  for (const text of ["ENOENT: open '/var/lib/oma/config.json'", "kernel permission denied", "설정 파일을 읽을 수 없습니다"])
    assert.equal(exceptionText(new Error(text)), text);
  assert.equal(exceptionText(null), "null");
  assert.equal(exceptionText("unobserved"), "unobserved");
});

test("Terminal display still removes control characters without hiding native diagnostic words", () => {
  assert.equal(displayable("ENOENT\u0000\u001b /tmp/oma"), "ENOENT /tmp/oma");
});

test("Native CLI failure reaches stderr even with the obsolete environment present", () => {
  const entry = import.meta.resolve("#oma-test/app/application/exit");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { fail } from ${JSON.stringify(entry)}; fail("ENOENT: /tmp/oma", 2);`], {
    env: { ...process.env, OMA_PRODUCT_TEXT: "1" }, encoding: "utf8",
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "oma: ENOENT: /tmp/oma\n");
});
