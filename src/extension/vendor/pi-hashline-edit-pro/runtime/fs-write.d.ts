export interface FileIdentity {
    dev: number;
    ino: number;
}
export declare function resolveTarget(path: string): Promise<string>;
export declare function resolveInCwd(path: string, cwd: string): Promise<{
    absolute: string;
    resolved: string;
}>;
/** OMA divergence: the commit channel the adapter installs -- the
 * contained re-read and the serialized quota-deciding write. The seam is
 * fail-closed: with no channel installed omaReadFileText/omaWriteCommit
 * throw, and writeAtomic itself is confined to the bundle's own state
 * directory (the config.js domain) -- a direct mutation-target caller
 * refuses closed instead of writing uncontained. */
export interface OmaCommitChannel {
    read(path: string): Promise<string>;
    write(path: string, content: string, expectedIdentity?: FileIdentity): Promise<void>;
}
export declare function omaInstallCommitChannel(channel: OmaCommitChannel | undefined): void;
export declare function omaReadFileText(path: string): Promise<string>;
export declare function omaWriteCommit(path: string, content: string, expectedIdentity?: FileIdentity): Promise<void>;
export declare function writeAtomic(path: string, content: string, expectedIdentity?: FileIdentity, restoreMode?: number): Promise<void>;
