import type { UiHostContext, UiResourceContent, UiResourceCsp } from "./types.js";
export interface HostHtmlTemplateInput {
    sessionToken: string;
    serverName: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    resource: UiResourceContent;
    allowAttribute: string;
    requireToolConsent: boolean;
    cacheToolConsent: boolean;
    hostContext?: UiHostContext;
    appBridgeModuleUrl?: string;
    sandboxProxyUrl: string;
}
export declare function buildHostHtmlTemplate(input: HostHtmlTemplateInput): string;
export declare function buildCspMetaContent(csp: UiResourceCsp | undefined): string;
/** CSP for provider HTML navigated on the isolated proxy origin. */
export declare function buildSandboxResourceCsp(csp: UiResourceCsp | undefined): string;
