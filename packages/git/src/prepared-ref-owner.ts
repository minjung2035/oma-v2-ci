/** Private capabilities for one unaccepted prepared ref. */
import { closeSync } from "node:fs";
import { reopenDirectory } from "@oma/file-descriptors";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";
import { treeQuiescence } from "@oma/storage/tree-lease";
import { runProcessSync } from "@oma/process/run";
import { GIT_ENV } from "@oma/process/policies";
import { StoreError } from "@oma/domain/errors";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import { CANONICAL_SAFE_ARGS, GIT_BIN, bindCanonicalCommand, createCanonicalObserver, type CanonicalExecution } from "./canonical-command.js";

export function preparedRefOwner(repository: string, ref: string, value: string, leasePath: string,
    directoryFd?: number, execution?: CanonicalExecution): { readonly owner: PreacceptArtifactOwner; cancelUnpublished(): void } {
  const owned: number[] = [];
  let returnFailure: unknown, returned = false, phase: "preaccept" | "retained" | "discarded" = "preaccept";
  const release = () => {
    if (returnFailure !== undefined) throw returnFailure;
    if (returned) return; returned = true;
    try { cleanupAll(owned.map(fd => () => closeSync(fd))); }
    catch (error) { returnFailure = error; throw error; }
  };
  try {
    const project = execution?.directories.get(repository);
    let selected = execution;
    if (project !== undefined) {
      const pin = reopenDirectory(project); owned.push(pin);
      selected = { executable: execution!.executable, directories: new Map(execution!.directories).set(repository, pin) };
    }
    const parent = directoryFd === undefined ? undefined : reopenDirectory(directoryFd);
    if (parent !== undefined) owned.push(parent);
    const control = parent === undefined ? {} : { directoryFd: parent };
    const observations = createCanonicalObserver(GIT_BIN, selected);
    const owner: PreacceptArtifactOwner = {
      path: ref,
      retainForOperation() {
        if (returnFailure !== undefined) throw returnFailure;
        if (phase === "discarded") throw new StoreError("INTERNAL_ERROR", "discarded prepared ref cannot be retained");
        phase = "retained"; release();
      },
      discardUnaccepted() {
        if (returnFailure !== undefined) throw returnFailure;
        if (phase !== "preaccept") return;
        if (treeQuiescence(leasePath, control).kind !== "quiescent")
          throw new StoreError("REF_STATE_UNKNOWN", "prepared ref still has an active or unknown helper");
        const physical = bindCanonicalCommand({ executable: GIT_BIN,
          argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, "update-ref", "-d", ref, value],
          env: GIT_ENV, timeoutMs: 120000, stdoutBytes: 1024, stderrBytes: 8192 }, selected);
        const deleted = runProcessSync(physical.command, undefined, [], physical.directoryFd === undefined ? {} : { directoryFd: physical.directoryFd });
        if (deleted.kind !== "exited" || deleted.exitCode !== 0 || observations.ref(repository, ref).kind !== "absent")
          throw new StoreError("REF_STATE_UNKNOWN", "prepared ref deletion is unproven");
        phase = "discarded"; release();
      },
    };
    return { owner, cancelUnpublished: release };
  } catch (error) { return withCleanup(() => { throw error; }, release); }
}
