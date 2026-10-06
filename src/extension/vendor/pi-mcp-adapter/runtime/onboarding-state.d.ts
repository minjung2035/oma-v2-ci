export interface McpOnboardingState {
    version: 1;
    sharedConfigHintShown: boolean;
    setupCompleted: boolean;
    lastDiscoveryFingerprint?: string;
    /** Servers already asked whether to import Pi's sign-in, by name and normalized URL. */
    piSignInImportsAsked?: {
        server: string;
        url: string;
    }[];
    /** Adapter version that last turned off, or found configured, Pi's built-in MCP. */
    piBuiltinMcpHandledVersion?: string;
}
export declare function getOnboardingStatePath(): string;
export declare function loadOnboardingState(): McpOnboardingState;
export declare function saveOnboardingState(state: McpOnboardingState): void;
export declare function updateOnboardingState(updater: (state: McpOnboardingState) => McpOnboardingState): McpOnboardingState;
export declare function markSharedConfigHintShown(fingerprint?: string): McpOnboardingState;
export declare function markSetupCompleted(fingerprint?: string): McpOnboardingState;
export declare function markPiSignInImportAsked(server: string, url: string): McpOnboardingState;
