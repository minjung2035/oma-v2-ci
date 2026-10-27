/** Installed metadata primitive closure, not a G-FILES pin/repair proof. */
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDirectory } from "@oma/native/files";
import { assertNoUnpreservedMetadataAt } from "@oma/native/posix-files";
if (process.platform === "darwin") {
  const helper = statSync(new URL("./metadata/oma-file-metadata", import.meta.resolve("@oma/native/posix-files")));
  assert.ok(helper.isFile()); assert.ok((helper.mode & 0o111) !== 0);
}
const directory = realpathSync(mkdtempSync(join(tmpdir(), "oma-installed-native-")));
try {
  writeFileSync(join(directory, "empty"), "installed");
  const fd = openDirectory(directory);
  try { assertNoUnpreservedMetadataAt(fd, "empty"); }
  finally { closeSync(fd); }
} finally { rmSync(directory, { recursive: true, force: true }); }
