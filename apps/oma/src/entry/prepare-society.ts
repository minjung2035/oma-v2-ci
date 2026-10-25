/** DR35: bounded repository/rootfs preparation, owned by the broker. Keeping
 * synchronous Git in this child lets the broker observe host loss immediately. */
import { realpathSync } from "node:fs";
import { assertNativeRuntime } from "../runtime/native-support.js";
import { claimSocietyFence } from "../runtime/society-lease.js";
import { observeProjectBinding, provisionSociety } from "../runtime/provision.js";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/fence";
import { StoreError } from "@oma/domain/errors";
import { startProcess } from "@oma/process/async";
import { repositoryHealthCommand, requireHealthyRepository } from "@oma/git/repository-health";
import { TreeLease } from "@oma/storage/tree-lease";

try {
  assertNativeRuntime();
  const [stateRoot, society, projectDir, ...extra] = process.argv.slice(2);
  if (stateRoot === undefined || society === undefined || projectDir === undefined || extra.length !== 0 ||
      process.env[SOCIETY_FENCE_ENV] !== String(SOCIETY_FENCE_FD))
    throw new StoreError("INVALID_REQUEST", "society preparation requires its broker's inherited lease and bound project");
  if (claimSocietyFence(stateRoot).kind !== "inherited")
    throw new StoreError("BROKER_UNAVAILABLE", "society preparation does not own the inherited lease");
  const binding = observeProjectBinding(stateRoot);
  if (realpathSync(projectDir) !== projectDir || binding.kind !== "bound" || binding.binding.society !== society ||
      binding.binding.canonicalProjectPath !== projectDir)
    throw new StoreError("INVALID_REQUEST", "startup project does not match the society's committed binding");
  const prepared = await provisionSociety(stateRoot, { projectDir, verifyHistory: async (repository, transfer) => {
    // A new strict protocol clone has just checked all objects and links.
    // Existing mirrors still require a new full fsck; no disk receipt is read.
    if (transfer?.kind === "strict-transfer" && transfer.repository === repository) return;
    const lease = TreeLease.take(repository);
    try {
      // Stay in the preparation process group: its owner cancels and waits
      // for this verifier together with every synchronous capture child.
      const task = startProcess(repositoryHealthCommand(repository), { inheritedFds: [lease.descriptor] });
      const observation = await task.result;
      await task.closed;
      requireHealthyRepository(observation);
    } finally { lease.release(); }
  } });
  if (prepared.mirrorNote !== null) console.error(`Could not refresh project history: ${prepared.mirrorNote}`);
  if (prepared.gitlinkNote !== null) console.error(prepared.gitlinkNote);
  process.stdout.write(JSON.stringify({ verifiedMain: prepared.verifiedMain ?? null }));
} catch (error) {
  console.error(`society preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
