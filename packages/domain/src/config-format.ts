/** Current development configuration format; previous versions are refused. */
export const HOST_CONFIGURATION_VERSION = 5 as const;

/** Maximum currently enabled Workers; provisioning, history and the Principal occupy no active slot. */
export const DEFAULT_MAX_WORKERS = 6;
/** Existing host-owned recovery operation identity; caller keys share its 96-byte bound. */
export const FIRST_WORKER_RECOVERY_PREFIX = "recover-first-";
