/** Broker-provided locations and existing resource settings; never wire inputs. */
export interface GitPaths {
  stateRoot: string;
  projectGit: string;
  contextGit: string;
  worldDir: string;
  society: string;
  quarantineTmpBytes: number;
  /** The quarantine's own profile (`QUARANTINE_RESOURCES` in production).
   * `timeoutSeconds` bounds one bundle import start to end; it is not an
   * integration check's deadline (P0V-29). */
  quarantineResources?: { cpuSeconds: number; memoryBytes: number; tasks: number; timeoutSeconds: number };
  checkRootfs?: string;
  checkAssetsDir?: string;
  checkTmpBytes?: number;
}
export interface CheckProfile { argv: string[]; env: Record<string, string> }
