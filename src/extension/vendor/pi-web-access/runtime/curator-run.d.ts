import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type WebSearchWorkflow = "none" | "summary-review" | "auto-summary";
export declare function resolveWebSearchWorkflow(input: unknown, hasUI: boolean): WebSearchWorkflow;
export declare class CuratorRunState {
    private autoApproveRemaining;
    approveRemainingSearches(): void;
    reset(): void;
    resolve(requestedWorkflow: unknown, configuredWorkflow: unknown, hasUI: boolean): WebSearchWorkflow;
}
export declare function registerCuratorRunLifecycle(pi: Pick<ExtensionAPI, "on">): CuratorRunState;
