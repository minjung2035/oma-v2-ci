/** Current development configuration format; previous versions are refused. */
export const HOST_CONFIGURATION_VERSION = 4 as const;

/** Maximum currently enabled Workers; provisioning, history and the Principal occupy no active slot. */
export const DEFAULT_MAX_WORKERS = 6;
