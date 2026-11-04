/** Adapter entry; mechanical job ownership lives below Process capture. */
import { startDarwinJobControl as start, type DarwinJobFile } from "@oma/native/darwin-job-control";
import type { CommandSpec } from "@oma/process/command";
import type { DarwinJobPeer } from "@oma/native/darwin-job-peer";
import { darwinSetupProcess } from "./launchd-job.js";
export type { DarwinJobControl, DarwinJobFile } from "@oma/native/darwin-job-control";
export function startDarwinJobControl(source: CommandSpec, files: readonly DarwinJobFile[], images: readonly string[], signal?: AbortSignal, peer?: DarwinJobPeer) {
  return start(source, files, images, darwinSetupProcess, signal, peer);
}
