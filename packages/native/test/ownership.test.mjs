import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBeneath, openDirectory, openRegularBeneath } from "@oma/native/files";
import { withAsyncCleanup } from "@oma/native/cleanup";

test("contained file access pins an ordinary file and refuses a link without reading its target", () => {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
    assert.throws(() => openBeneath(0, "file", 0), { code: "UNSUPPORTED_PROFILE" });
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "oma-native-files-"));
  try {
    writeFileSync(join(root, "file"), "original bytes");
    symlinkSync("file", join(root, "link"));
    const directory = openDirectory(root);
    try {
      const file = openRegularBeneath(directory, "file");
      try { assert.equal(readFileSync(file, "utf8"), "original bytes"); }
      finally { closeSync(file); }
      assert.throws(() => openRegularBeneath(directory, "link"), { code: "STORE_CORRUPT" });
      assert.equal(readFileSync(join(root, "file"), "utf8"), "original bytes");
    } finally { closeSync(directory); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an asynchronous owner waits for the effect and retains both effect and cleanup failures", async () => {
  const effect = new Error("effect outcome unknown"), cleanup = new Error("cleanup failed");
  let failEffect;
  const order = [];
  const result = withAsyncCleanup(() => new Promise((_, reject) => { failEffect = reject; }), () => {
    order.push("cleanup");
    throw cleanup;
  });
  assert.deepEqual(order, []);
  failEffect(effect);
  await assert.rejects(result, error => error instanceof AggregateError &&
    error.errors[0] === effect && error.errors[1] === cleanup);
  assert.deepEqual(order, ["cleanup"]);
});
