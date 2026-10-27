#!/usr/bin/env node
/** Explicit, pinned host dependency setup; never downloads during shutdown. */
import { RESTIC_RELEASE, resticReleaseFor } from "@oma/domain/deployment";
import { createHash } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureOwnedDurableDirectory, publishNoReplace } from "@oma/storage/durable-fs";
import { repairOwnedEntryMode } from "@oma/storage/directory";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { inheritedDescriptorPath } from "@oma/native/descriptor-path";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { digestDescriptor } from "@oma/storage/cache-trees";

const pin = resticReleaseFor(process.platform, process.arch);
if (pin === null) throw new Error("Session storage tool setup requires a pinned Linux/macOS x64 or arm64 release");
const dataHome = process.env.XDG_DATA_HOME ?? (process.env.HOME ? join(process.env.HOME, ".local/share") : null);
if (dataHome === null || !dataHome.startsWith("/")) throw new Error("An absolute HOME or XDG_DATA_HOME is required");
const boundary = join(dataHome, "oma-toolchain"), directory = join(boundary, "restic", RESTIC_RELEASE.version, `${process.platform}-${process.arch}`);
const target = join(directory, "restic");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
ensureOwnedDurableDirectory(directory, boundary, 0o700);
repairOwnedEntryMode(target);
let executable;
try { executable = withinDirectory(target, (parent, name) => openRegularBeneath(parent, name)); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (executable === undefined) {
  const url = `https://github.com/restic/restic/releases/download/v${RESTIC_RELEASE.version}/${pin.archive}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Restic download failed: ${response.status}`);
  const packed = Buffer.from(await response.arrayBuffer());
  if (sha256(packed) !== pin.archiveSha256) throw new Error("Restic archive checksum mismatch");
  const unpacked = spawnSync("/usr/bin/bzip2", ["--decompress", "--stdout"], { input: packed, maxBuffer: 64 * 1024 * 1024 });
  if (unpacked.error || unpacked.signal || unpacked.status !== 0 || sha256(unpacked.stdout) !== pin.binarySha256)
    throw new Error("Restic decompression or binary verification failed");
  if (publishNoReplace(target, unpacked.stdout, 0o755) !== "created") throw new Error("Restic installation changed concurrently; run setup again");
  executable = withinDirectory(target, (parent, name) => openRegularBeneath(parent, name));
}
await withAsyncCleanup(async () => {
  // Verify the held installed inode, including after publication. Keep it
  // through exec: the installation pathname may already name another file.
  if (await digestDescriptor(executable) !== pin.binarySha256) throw new Error("Restic differs from the pinned release; kept for inspection");
  fchmodSync(executable, 0o755); fsyncSync(executable);
  const result = spawnSync(inheritedDescriptorPath(3, "execute"), ["version"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe", executable],
    timeout: 10000, killSignal: "SIGKILL", maxBuffer: 65536,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error("Installed Restic could not run");
  console.log(result.stdout.trim());
  console.log(`Installed verified session storage tool: ${target}`);
}, () => closeSync(executable));
