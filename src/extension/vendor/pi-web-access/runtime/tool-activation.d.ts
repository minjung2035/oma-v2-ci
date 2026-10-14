import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type WebCapability = "search" | "source-check" | "fetch" | "stored-content";
export interface WebActivationTool {
    name: string;
    capability: WebCapability;
}
export declare function registerWebToolActivation(pi: ExtensionAPI, tools: ReadonlyArray<WebActivationTool>, mode: "auto" | "dynamic"): void;
