// MUST [SB-001..006]: bwrap argv builder. The recipe below matches the S-01
// experiment (userns, pid/mount/netns isolation, RW workspace, RO binds,
// tmpfs cap, host home invisible). Never mount the whole XDG_RUNTIME_DIR: only
// the per-incarnation actor socket (FS-001).
import type { RunLease, SandboxPlan } from "../implementation/contracts.js";
import type { ResourceLimits } from "../implementation/contracts.js";
import { StoreError } from "./store.js";

export interface SandboxHost {
  rootfs: string; // trusted rootfs (RO bind at /)
  node: string; // pinned node executable INSIDE the rootfs (e.g. /usr/bin/node)
  pi: string; // pinned pi executable INSIDE the rootfs (e.g. /usr/bin/pi)
  piModeArgs: string[]; // verified `--mode rpc` + trusted extension options (in-sandbox paths)
  tmpBytes: number; // /tmp cap (reference 512 MiB per SB-002)
  checkResources: ResourceLimits;
}

/** MUST [SB-002]: resident sandbox argv with the incarnation socket only. */
export function residentArgv(
  h: SandboxHost,
  lease: RunLease,
  workspaceHost: string,
  homeHost: string,
  archiveHost: string,
  selfMailHost: string,
  viewHost: string,
  worldHost: string,
  projectGitHost: string,
): string[] {
  return [
    "bwrap",
    "--unshare-all",
    "--new-session",
    "--die-with-parent",
    "--cap-drop",
    "ALL",
    "--ro-bind",
    h.rootfs,
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--size",
    String(h.tmpBytes),
    "--tmpfs",
    "/tmp",
    "--bind",
    workspaceHost,
    "/workspace",
    "--bind",
    homeHost,
    "/home/agent",
    "--ro-bind",
    archiveHost,
    "/mail/archive",
    "--ro-bind",
    selfMailHost,
    "/mail/self",
    "--ro-bind",
    viewHost,
    "/run/oma-view",
    "--ro-bind",
    worldHost,
    "/world",
    "--ro-bind",
    projectGitHost,
    "/git/project.git",
    // MUST [SB-003]/FS-001: only THIS incarnation's control socket is visible.
    "--ro-bind",
    lease.socketHostPath,
    "/run/oma/control.sock",
    "--symlink",
    "/run/oma-view/inbox.md",
    "/inbox.md",
    "--clearenv",
    "--setenv",
    "HOME",
    "/home/agent",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--chdir",
    "/workspace",
    "--",
    h.node,
    h.pi,
    ...h.piModeArgs,
  ];
}

/** MUST [SB-005]: candidate-check sandbox — staged candidate RW only, trusted assets RO. */
export function candidateArgv(
  h: SandboxHost,
  candidateDir: string,
  checkAssetsDir: string,
  checkTmpBytes: number,
): string[] {
  void h.node;
  return [
    "bwrap",
    "--unshare-all",
    "--new-session",
    "--die-with-parent",
    "--cap-drop",
    "ALL",
    "--ro-bind",
    h.rootfs,
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--size",
    String(checkTmpBytes),
    "--tmpfs",
    "/tmp",
    "--bind",
    candidateDir,
    "/candidate",
    "--ro-bind",
    checkAssetsDir,
    "/checks",
    "--clearenv",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--chdir",
    "/candidate",
    "--",
  ];
}

export function validateSandboxHost(h: SandboxHost): void {
  if (
    !h.rootfs.startsWith("/") ||
    !h.node.startsWith("/") ||
    !h.pi.startsWith("/")
  ) {
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "sandbox host paths must be absolute",
    );
  }
  if (!Number.isSafeInteger(h.tmpBytes) || h.tmpBytes <= 0) {
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "tmp bytes must be a positive safe integer",
    );
  }
}

export class SandboxModule {
  constructor(private readonly host: SandboxHost) {
    validateSandboxHost(host);
  }

  /** MUST [SB-002]/[FS-001]: mount dirs are absolute host paths from the host config. */
  resident(
    lease: RunLease,
    dirs: {
      workspace: string;
      home: string;
      archive: string;
      selfMail: string;
      view: string;
      world: string;
      projectGit: string;
    },
  ): SandboxPlan {
    const argv = residentArgv(
      this.host,
      lease,
      dirs.workspace,
      dirs.home,
      dirs.archive,
      dirs.selfMail,
      dirs.view,
      dirs.world,
      dirs.projectGit,
    );
    return { argv, env: {}, inheritedFds: [0, 1, 2] };
  }

  candidate(oid: string, checkProfile: string): SandboxPlan {
    void oid;
    void checkProfile;
    throw new StoreError(
      "SPIKE_UNRESOLVED",
      "candidate-check sandbox is gated by phase 7 integrate checks",
    );
  }
}
