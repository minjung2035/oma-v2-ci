/** Broker-provided locations and existing resource settings; never wire inputs. */
export interface GitPaths {
  stateRoot: string;
  projectGit: string;
  contextGit: string;
  worldDir: string;
  society: string;
  /** Legacy declaration; DR37 imports use ordinary OS tmpfs capacity. */
  quarantineTmpBytes: number;
  /** Legacy declaration; DR37 does not apply these execution caps. */
  quarantineResources?: { cpuSeconds: number; memoryBytes: number; tasks: number; timeoutSeconds: number; silenceSeconds: number };
  /** Broker lifetime cancellation, never client disconnect cancellation. */
  ownerSignal?: AbortSignal;
  checkRootfs?: string;
  checkNode?: string;
  checkAssetsDir?: string;
}
export interface CheckProfile { argv: string[]; env: Record<string, string> }
