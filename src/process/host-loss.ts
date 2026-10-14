/** DR17 / P0V-81: every catchable termination signal enters the owner's drain.
 * A leaf shared by pre-session terminals, child holders and service lifetimes. */
export const HOST_LOSS_SIGNALS = Object.freeze(["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"] as const);
export function stopOnHostLoss(stop: () => void, target: Pick<NodeJS.Process, "once"> = process): void {
  for (const signal of HOST_LOSS_SIGNALS) target.once(signal, stop);
}
