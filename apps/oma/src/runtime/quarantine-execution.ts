import { residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
/** App selects one physical backend; Git owns verification and authority. */
import type { GitPaths } from "@oma/git/paths";
import type { QuarantineExecution } from "@oma/git/quarantine";
import type { CommandSpec } from "@oma/process/command";
import { gitSandbox } from "@oma/platform-linux/git-sandbox";
import { quarantineSeatbelt } from "@oma/platform-mac/git-sandbox";
import { observeMacDeveloperTools } from "@oma/platform-mac/developer-tools";
import { copyDescriptorToEntry } from "@oma/storage/file-digest";
import { mkdirAt } from "@oma/native/posix-files";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import type { ExecutionRuntime } from "./execution-runtime.js";
export function quarantineExecution(paths: GitPaths, executions: ExecutionRuntime): QuarantineExecution {
  return Object.freeze<QuarantineExecution>({ confirmDead: () => executions.confirmDead("quarantine"),
    execute: async (request, authorize) => {
      if (!paths.checkNode || !paths.checkAssetsDir)
        throw new StoreError("UNSUPPORTED_PROFILE", "quarantine installation is incomplete");
      const input = { phase: request.phase, candidate: request.candidate, exportRef: request.exportRef, prerequisites: request.prerequisites };
      let command: CommandSpec;
      if (process.platform === "darwin") {
        // The existing importer owns this lease, held root and phase order.
        // Copies are outside every writable verify/import subtree; accepted
        // source bytes/cursor stay with their existing immutable owner.
        if (request.phase === "verify") {
          mkdirAt(request.rootFd, "repo", 0o700);
          copyDescriptorToEntry(request.bundleFd, request.rootFd, "input.bundle");
        }
        const temporary = join(request.root, `${request.phase}-tmp`);
        mkdirAt(request.rootFd, `${request.phase}-tmp`, 0o700);
        const tools = await observeMacDeveloperTools(temporary,
          command => executions.run("quarantine", command, paths.ownerSignal, authorize, [request.leaseFd]));
        command = quarantineSeatbelt({ node: paths.checkNode, libdir: paths.checkAssetsDir, tools }, input,
          { git: tools.git, project: paths.projectGit, root: request.root, bundle: join(request.root, "input.bundle"), temporary }).command;
      } else command = gitSandbox({ rootfs: residentRootfsPath(paths.stateRoot), node: paths.checkNode, libdir: paths.checkAssetsDir }, input);
      return executions.run("quarantine", command, paths.ownerSignal, authorize,
        [request.bundleFd, request.leaseFd, request.rootFd, request.projectFd], request.stderrFd);
    },
  });
}
