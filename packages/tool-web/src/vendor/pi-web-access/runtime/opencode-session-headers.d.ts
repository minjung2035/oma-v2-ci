import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
type SessionManager = Pick<ExtensionContext, "sessionManager">["sessionManager"];
/**
 * Pi adds OpenCode attribution headers inside the main agent loop. Extension
 * side-calls dispatch directly, so they must add the same session attribution.
 */
export declare function openCodeSessionHeaders(model: Model<Api>, sessionManager: SessionManager): Record<string, string> | undefined;
export {};
