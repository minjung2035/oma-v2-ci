/**
 * The proxy is served from a different loopback origin than the trusted host.
 * `allow-same-origin` is safe here because this document never contains the
 * host's session capability; provider HTML is loaded into the nested frame.
 */
export declare const SANDBOX_PROXY_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin";
export declare const SANDBOX_INNER_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin";
export declare const SANDBOX_PROXY_PATH = "/sandbox";
export declare const SANDBOX_RESOURCE_PATH_PREFIX = "/resource/";
export interface SandboxProxyTemplateInput {
    parentOrigin: string;
    resourcePath: string;
    allowAttribute: string;
}
/**
 * Build the static document used by the trusted, second-origin sandbox proxy.
 * The per-session values are the exact parent host origin and opaque resource path.
 */
export declare function buildSandboxProxyHtml(input: SandboxProxyTemplateInput): string;
/**
 * CSP for the proxy document itself. It contains only the inline relay script
 * and a same-origin nested frame. Provider policy is applied on the resource
 * navigation response, not inherited from this relay document.
 */
export declare function buildSandboxProxyCsp(): string;
