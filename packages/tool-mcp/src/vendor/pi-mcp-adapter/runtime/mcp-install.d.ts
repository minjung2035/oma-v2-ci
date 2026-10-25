export interface McpInstallRequest {
    url: string;
    serverName?: string;
}
export interface NormalizedMcpInstallRequest {
    url: string;
    serverName: string;
}
export declare function normalizeMcpInstallRequest(request: McpInstallRequest): NormalizedMcpInstallRequest;
export declare function canonicalMcpServerUrl(value: string): string | undefined;
