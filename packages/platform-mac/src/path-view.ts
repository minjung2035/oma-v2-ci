/** Pure Darwin layout selection. Seatbelt uses admitted host paths directly;
 * this map performs no effect and establishes no sandbox or scope authority. */
import type { PathView, SandboxDirectories, SandboxEndpoints, SandboxHost } from "@oma/contracts/runtime";
import { residentPathView } from "@oma/domain/resident-paths";
import { assertValidatedRunLease, trustedAbsolutePath, type ValidatedRunLease } from "@oma/protocol/run-lease";
import { StoreError } from "@oma/domain/errors";
export function macResidentPathView(host: SandboxHost, lease: ValidatedRunLease,
  directories: SandboxDirectories, endpoints: SandboxEndpoints = {}): PathView {
  if (!trustedAbsolutePath(host.runRoot)) throw new StoreError("UNSUPPORTED_PROFILE", "Mac path view requires its trusted run root");
  assertValidatedRunLease(lease, host.runRoot);
  return residentPathView(host, directories, { socket: lease.socketHostPath, ...endpoints }, "host");
}
