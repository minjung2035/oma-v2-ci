/** Broker-provided locations and existing resource settings; never wire inputs. */
export interface GitPaths {
  stateRoot: string;
  projectGit: string;
  contextGit: string;
  worldDir: string;
  society: string;
  quarantineTmpBytes: number;
  quarantineResources?: { cpuSeconds: number; memoryBytes: number; tasks: number };
  checkTimeoutSeconds: number;
  checkRootfs?: string;
  checkAssetsDir?: string;
  checkTmpBytes?: number;
}
export interface CheckProfile { argv: string[]; env: Record<string, string> }
