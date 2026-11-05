/** Seatbelt policy composition delegates physical capture to Process. */
import { snapshotCommand, type CommandSpec } from "@oma/process/command";
import { ExecutionNotStarted, type BlockedExecution } from "@oma/process/owned-execution";
import { launchPreparedDarwinJobScope, type DarwinJobScopeOptions } from "@oma/process/darwin-execution";
import type { DarwinCoalitionIdentity } from "@oma/native/audit-session";
import { prepareSeatbelt, type SeatbeltPolicy } from "./seatbelt.js";
export { launchDarwinJobScope, inheritedDarwinJobPeer, peerFromMachReceiver,
  type DarwinJobPeer, type DarwinJobScopeOptions } from "@oma/process/darwin-execution";
export async function launchSeatbeltJobScope(source: CommandSpec, policy: SeatbeltPolicy,
  options: DarwinJobScopeOptions = {}): Promise<BlockedExecution<DarwinCoalitionIdentity>> {
  let recipe: ReturnType<typeof prepareSeatbelt>, executable: string;
  try { const command = snapshotCommand(source); executable = command.executable; recipe = prepareSeatbelt(command, { ...policy, suspendExec: true }); }
  catch (error) { throw new ExecutionNotStarted(error); }
  // The declared cwd is checked against the policy above. With a held
  // directory capability, only that descriptor selects the physical cwd;
  // never reopen the checked pathname in the final process capture.
  if (options.directoryFd !== undefined) {
    const { cwd: _declaredDirectory, ...command } = recipe.command;
    return launchPreparedDarwinJobScope(command, executable, recipe.privateInputs, options);
  }
  return launchPreparedDarwinJobScope(recipe.command, executable, recipe.privateInputs, options);
}
