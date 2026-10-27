import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeRunLease } from "@oma/protocol/run-lease";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { confinedPath } from "@oma/domain/resident-paths";
import { type SandboxDirectories as ResidentDirectories } from "@oma/contracts/runtime";
import { hostSystemLayout, prepareResidentRootfs, residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
import type { PiAdapterOptions } from "@oma/engine/pi-spawn-plan";
import { actorSocketPathAt, agentRootPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "@oma/domain/paths";

export const RESIDENT_TEST_OPTIONS = Object.freeze({
  timeout: 180_000,
  skip: process.platform !== "linux" ? "NOT_RUN: confined Residents require Linux bubblewrap" :
    spawnSync("/usr/bin/bwrap", ["--version"]).status === 0 ? false : "NOT_RUN: /usr/bin/bwrap is not installed on this host",
});

export function residentOptions(stateRoot: string, libdir = "/opt/oma", entry = join(libdir, "engine.js")): PiAdapterOptions {
  const actor = "alice", runRoot = join(stateRoot, "run");
  const directories: ResidentDirectories = {
    workspace: workspacePathAt(stateRoot, actor), home: join(agentRootPathAt(stateRoot, actor), "home"),
    archive: join(stateRoot, "mail", "archive"), workerArchive: join(stateRoot, "mail", "workers"), selfMail: join(stateRoot, "mail", "inboxes", actor),
    view: runnerViewPathAt(stateRoot, actor), world: join(stateRoot, "world"), projectGit: join(stateRoot, "repos", "project.git"),
    projectMirror: join(stateRoot, "repos", "project-mirror.git"), sessions: runnerSessionDirPathAt(stateRoot, actor),
  };
  const socket = actorSocketPathAt(runRoot, actor, 1);
  const limits = { frameBytes: 65536, idleStreamSeconds: 5, receiptWaitSeconds: 5, batchMaxMessages: 24,
    mailBodyBytes: 1 << 20, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 };
  return {
    actor, society: "demo", limits,
    profile: { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "", extensions: [] },
    paths: { piCommand: process.execPath, piArgs: [entry], piAgentDir: join(stateRoot, "engine"),
      coreExtension: join(libdir, "packages/extension/dist/index.js"), cli: join(libdir, "apps/oma/dist/cli.js"),
      workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home, mailArchive: join(directories.archive, "cur"),
      workerArchive: join(directories.workerArchive, "cur"), projectGit: directories.projectGit, batchView: directories.view, socket },
    confinement: { host: {  libdir, node: process.execPath, pi: confinedPath({ libdir }, directories, entry),
      piModeArgs: [], stateRoot, runRoot, limits },
      directories, lease: decodeRunLease({ actor, incarnation: 1, socketHostPath: socket }, { actor, runRoot }) },
  };
}

export function prepareResident(options: PiAdapterOptions): void {
  const { host, directories } = options.confinement;
  const layout = hostSystemLayout();
  for (const path of [...Object.values(directories), options.paths.mailArchive, options.paths.workerArchive,
    join(options.paths.socket, ".."), join(directories.home, ".local/share"), join(directories.home, ".run")]) mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(options.paths.socket, "");
  Object.assign(host, {  node: realpathSync(process.execPath) });
  prepareResidentRootfs(residentRootfsPath(host.stateRoot!), layout, process.getuid!(), process.getgid!());
  // Callers supply test payload bytes; their declared installation directories
  // follow each current asset path rather than the former extension layout.
  for (const path of [options.paths.coreExtension, options.paths.cli])
    mkdirSync(dirname(path), { recursive: true });
  // w10/E27: the confined engine's NODE_OPTIONS preloads the in-process client
  // from the installation layout's app-owned preload. A fixture libdir
  // must hold every asset the spawn plan names, so the fake file is provided
  // here; a real libdir already ships it and is never replaced.
  const preload = join(options.confinement.host.libdir, DEPLOYMENT_LAYOUT.clientPreload);
  if (!existsSync(preload)) {
    mkdirSync(dirname(preload), { recursive: true });
    writeFileSync(preload, "// test asset: fake engines do not exercise the client preload\n");
  }
}
