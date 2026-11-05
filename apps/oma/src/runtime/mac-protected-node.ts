/** An owned derived Node, signed in a journaled preparation scope. Its held
 * descriptor stays alive until the immutable runtime producer finishes. */
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ExecutionStaging } from "@oma/storage/execution-staging";
import { copyDescriptorToEntry, fileDigest } from "@oma/storage/file-digest";
import { openBeneath, openDirectory, openRegularBeneath } from "@oma/native/files";
import { cleanupAll, withCleanup, withAsyncCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import type { ExecutionRuntime } from "./execution-runtime.js";

export interface ProtectedMacNode { readonly fd: number; readonly bytes: number; readonly sha256: string }
const ENTITLEMENTS = '<?xml version="1.0"?><plist version="1.0"><dict>' +
  ["allow-dyld-environment-variables", "allow-jit", "allow-unsigned-executable-memory",
    "disable-executable-page-protection", "disable-library-validation"]
    .map(key => '<key>com.apple.security.cs.' + key + '</key><true/>').join("") + '</dict></plist>';

export async function withProtectedMacNode<T>(source: string, stateRoot: string, executions: ExecutionRuntime,
  signal: AbortSignal, authorize: () => void, consume: (node: ProtectedMacNode) => Promise<T>): Promise<T> {
  if (process.platform !== "darwin") throw new StoreError("UNSUPPORTED_PROFILE", "protected Node preparation requires Darwin");
  return new ExecutionStaging(stateRoot, "runtime-tools", () => executions.confirmDead("preparation")).run(async stage => {
    const parent = openDirectory(stage.workspace);
    let sourceParent: number | undefined;
    return withAsyncCleanup(async () => {
      sourceParent = openDirectory(dirname(source));
      const original = openRegularBeneath(sourceParent, basename(source));
      const copied = withCleanup(() => {
        const stat = fstatSync(original);
        if (!stat.isFile() || !(stat.mode & 0o111) || stat.size < 1 || stat.size > 268435456)
          throw new StoreError("UNSUPPORTED_PROFILE", "selected Node is not a bounded regular executable");
        return copyDescriptorToEntry(original, parent, "node");
      }, () => closeSync(original));
      const executable = openRegularBeneath(parent, "node");
      withCleanup(() => fchmodSync(executable, 0o700), () => closeSync(executable));
      const entitlements = openBeneath(parent, "node.plist", constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      withCleanup(() => {
        const bytes = Buffer.from(ENTITLEMENTS); let at = 0;
        while (at < bytes.length) { const count = writeSync(entitlements, bytes, at, bytes.length - at); if (count === 0) throw new Error("entitlement write stopped"); at += count; }
        fsyncSync(entitlements);
      }, () => closeSync(entitlements));
      const node = join(stage.workspace, "node");
      if (fileDigest(node).sha256 !== copied.sha256) throw new StoreError("UNSUPPORTED_PROFILE", "Node changed before signing");
      for (const argv of [["--force", "--sign", "-", "--options", "runtime", "--entitlements", join(stage.workspace, "node.plist"), node],
        ["--verify", "--strict", node]]) {
        const result = await executions.run("preparation", { executable: "/usr/bin/codesign", argv,
          cwd: stage.workspace, env: { HOME: stage.temporary, TMPDIR: stage.temporary, PATH: "/usr/bin:/bin" },
          timeoutMs: 30000, stdoutBytes: 8192, stderrBytes: 8192 }, signal, authorize, [stage.leaseFd]);
        if (result.kind !== "exited" || result.exitCode !== 0)
          throw new StoreError("UNSUPPORTED_PROFILE", "owned Node signing did not complete", { cause: { kind: result.kind,
            exitCode: result.exitCode, stderr: result.stderr.toString() } });
      }
      const signed = fileDigest(node), fd = openRegularBeneath(parent, "node");
      return withAsyncCleanup(async () => {
        fchmodSync(fd, 0o500); fsyncSync(fd); fsyncSync(parent);
        return consume(Object.freeze({ fd, bytes: signed.stat.size, sha256: signed.sha256 }));
      }, () => closeSync(fd));
    }, () => cleanupAll([() => { if (sourceParent !== undefined) closeSync(sourceParent); }, () => closeSync(parent)]));
  });
}
