/** DR17 / P0V-81: every catchable termination signal enters the owner's drain.
 * A leaf shared by pre-session terminals, child holders and service lifetimes. */
import { HOST_LOSS_SIGNALS } from "@oma/domain/host-signals";
export { HOST_LOSS_SIGNALS } from "@oma/domain/host-signals";
export function stopOnHostLoss(stop: () => void, target: Pick<NodeJS.Process, "once"> = process): void {
  for (const signal of HOST_LOSS_SIGNALS) target.once(signal, stop);
}
