/** App selects one physical backend; Git owns verification and authority. */
import type { GitPaths } from "@oma/git/paths";
import type { QuarantineExecution } from "@oma/git/quarantine";
import { gitSandbox } from "@oma/platform-linux/git-sandbox";
import { StoreError } from "@oma/domain/errors";
import type { ExecutionRuntime } from "./execution-runtime.js";
export function quarantineExecution(paths: GitPaths, executions: ExecutionRuntime): QuarantineExecution {
  return Object.freeze<QuarantineExecution>({ confirmDead: () => executions.confirmDead("quarantine"),
    execute: (request, authorize) => {
      if (!paths.checkRootfs || !paths.checkNode || !paths.checkAssetsDir)
        throw new StoreError("UNSUPPORTED_PROFILE", "quarantine installation is incomplete");
      const input = { phase: request.phase, candidate: request.candidate, exportRef: request.exportRef, prerequisites: request.prerequisites };
      return executions.run("quarantine", gitSandbox({ rootfs: paths.checkRootfs, node: paths.checkNode, libdir: paths.checkAssetsDir },
        input), paths.ownerSignal, authorize,
        [request.bundleFd, request.leaseFd, request.rootFd, request.projectFd], request.stderrFd);
    },
  });
}
