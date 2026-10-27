/** Broker-provided locations; never wire inputs. */
export interface GitPaths {
    stateRoot: string;
    projectGit: string;
    contextGit: string;
    worldDir: string;
    society: string;
    /** Broker lifetime cancellation, never client disconnect cancellation. */
    ownerSignal?: AbortSignal;
    checkNode?: string;
    checkAssetsDir?: string;
}
