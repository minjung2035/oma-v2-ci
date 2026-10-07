import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeRunLease } from "../../src/protocol/run-lease.js";
import { confinedPath, type ResidentDirectories } from "../../src/sandbox.js";
import { hostSystemLayout, prepareResidentRootfs } from "../../src/runtime/resident-rootfs.js";
import type { PiAdapterOptions } from "../../src/runtime/pi-spawn-plan.js";
import { actorSocketPathAt, agentRootPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "../../src/storage/paths.js";

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
    profile: { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "", extensions: [], workspaceBytes: 1 << 20 },
    paths: { piCommand: process.execPath, piArgs: [entry], piAgentDir: join(stateRoot, "engine"),
      coreExtension: join(libdir, "dist/src/pi-extension.js"), cli: join(libdir, "dist/src/cli.js"),
      workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home, mailArchive: join(directories.archive, "cur"),
      workerArchive: join(directories.workerArchive, "cur"), projectGit: directories.projectGit, batchView: directories.view, socket },
    confinement: { host: { rootfs: join(stateRoot, "rootfs"), libdir, node: process.execPath, pi: confinedPath({ libdir }, directories, entry),
      piModeArgs: [], tmpBytes: 64 * 1024 * 1024, stateRoot, runRoot, limits },
      directories, lease: decodeRunLease({ actor, incarnation: 1, socketHostPath: socket }, { actor, runRoot }) },
  };
}

export function prepareResident(options: PiAdapterOptions): void {
  const { host, directories } = options.confinement;
  const layout = hostSystemLayout();
  for (const path of [...Object.values(directories), options.paths.mailArchive, options.paths.workerArchive,
    join(options.paths.socket, ".."), join(directories.home, ".local/share"), join(directories.home, ".run")]) mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(options.paths.socket, "");
  Object.assign(host, { systemBinds: layout.binds, node: realpathSync(process.execPath) });
  prepareResidentRootfs(host.rootfs, layout, process.getuid!(), process.getgid!());
  // w10/E27: the confined engine's NODE_OPTIONS preloads the in-process client
  // from `dirname(coreExtension)/runtime/client-preload.js`. A fixture libdir
  // must hold every asset the spawn plan names, so the fake file is provided
  // here; a real libdir already ships it and is never replaced.
  const preload = join(dirname(options.paths.coreExtension), "runtime", "client-preload.js");
  if (!existsSync(preload)) {
    mkdirSync(dirname(preload), { recursive: true });
    writeFileSync(preload, "// test asset: fake engines do not exercise the client preload\n");
  }
}
