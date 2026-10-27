/** DR17/P0-4: the catchable signals shared by host lifetime owners. */
export const HOST_LOSS_SIGNALS = Object.freeze(["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"] as const);
