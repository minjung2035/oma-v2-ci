export type CredentialFailureCategory = "invalid-source" | "command-failed" | "command-timeout" | "command-aborted" | "command-empty" | "command-invalid-output" | "command-output-too-large" | "environment-empty" | "oauth-credential-rejected";
export declare class CredentialResolutionError extends Error {
    readonly provider: string;
    readonly category: CredentialFailureCategory;
    constructor(provider: string, category: CredentialFailureCategory);
}
export interface CredentialCommandResult {
    stdout: string | Buffer;
}
export interface CredentialCommandOptions {
    signal?: AbortSignal;
    timeoutMs: number;
    maxOutputBytes: number;
    environment: Record<string, string>;
}
export type CredentialCommandRunner = (command: string, options: CredentialCommandOptions) => Promise<CredentialCommandResult>;
export interface CredentialOptions {
    provider: string;
    configuredValue?: unknown;
    environmentValue?: unknown;
    environment?: Record<string, string | undefined>;
    signal?: AbortSignal;
    runCommand?: CredentialCommandRunner;
}
export declare function redactCredential(text: string, credential: string | null | undefined): string;
export declare function hasCredentialSource(options: CredentialOptions): boolean;
export declare function resolveCredential(options: CredentialOptions): Promise<string | null>;
