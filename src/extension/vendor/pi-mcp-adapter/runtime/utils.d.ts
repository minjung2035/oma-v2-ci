import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { McpConfig, McpToolAnnotations, ServerEntry } from "./types.js";
/** OMA divergence: the MCP boundary policy the adapter installs
 * before the vendored extension factory runs. */
export interface OmaMcpPolicy {
    /** The OMA-owned directory every getAgentPath-derived path lands
     * under (OAuth legacy/encrypted dirs, metadata cache, onboarding
     * state, npx cache). */
    readonly agentDir?: string;
    /** The OMA-owned scratch root for output-guard spill files. */
    readonly tmpDir?: string;
    /** The deployment's egress pin — the loopback CONNECT forwarder URL —
     * or null when no proxy value is permitted at all. */
    readonly egressPinned?: string | null;
    /** The scrubbed ambient-env view spliced sites read instead of
     * process.env; {} under OMA. */
    readonly env?: Record<string, string>;
    /** The stdio-child env scrub: applied to inherited process.env before
     * a server's declared env merges over it. */
    readonly childEnv?: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
    /** The child-env finish: applied to the merged inherited+declared map —
     * filters declared values through the same predicate and layers the
     * scratch redirects (HOME/XDG/TMP) no other channel may supply.
     * Entries may carry an explicit `undefined` tombstone: the vendored
     * SDK's StdioClientTransport unions its own getDefaultEnvironment()
     * beneath this map, and the tombstone overrides the ambient default
     * inside that union (Node's spawn drops `undefined` values), keeping
     * denied names absent. */
    readonly childEnvFinish?: (merged: Record<string, string>) => Record<string, string | undefined>;
    /** The credential store OMA pins; absent means upstream's selector. */
    readonly authStore?: "memory" | "encrypted-file";
    /** The encrypted-file store key (canonical base64 of 32 bytes), held
     * by the policy — never read from ambient env under OMA. */
    readonly oauthFileKey?: string;
    /** Deny-by-default permits; every unset name is refused. */
    readonly permits?: {
        readonly "credential-command"?: boolean;
        readonly "browser-open"?: boolean;
        readonly "os-keyring"?: boolean;
        readonly "ui-session"?: boolean;
    };
}
export declare function omaInstallMcpPolicy(policy: OmaMcpPolicy | undefined): void;
export declare function omaPolicyActive(): boolean;
export declare function omaPermits(name: string): boolean;
export declare function omaRequirePermit(name: string, context: string): void;
export declare function omaAmbientEnv(): Record<string, string> | NodeJS.ProcessEnv;
export declare function omaAgentDir(): string | undefined;
export declare function omaTmpdir(): string;
export declare function omaChildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function omaChildEnvFinish(merged: Record<string, string>): Record<string, string | undefined>;
export declare function omaAuthStoreKind(): "memory" | "encrypted-file" | undefined;
export declare function omaOAuthFileKey(): string | undefined;
export declare function omaSecureKeyringClosed(): boolean;
export declare function omaUiSessionsRefused(): boolean;
export declare function omaPinnedFetch(input: unknown, init?: unknown): Promise<unknown>;
export declare function omaCaFetch(caFetch: { fetch: unknown; close: () => unknown } | undefined): { fetch: unknown; close: () => unknown } | undefined;
export declare function stripUtf8Bom(raw: string): string;
export declare function parseJsonWithComments(raw: string): unknown;
/** Resolve a candidate only when its real path stays within the real root. */
export declare function resolveRealContainedPath(root: string, candidate: string, allowMissing?: boolean): string | null;
export declare function resolveContainedPath(root: string, candidate: string): string | null;
export declare function stableStringify(value: unknown): string;
export declare function openUrl(pi: ExtensionAPI, url: string, browser?: string, signal?: AbortSignal): Promise<void>;
export declare function openPath(pi: ExtensionAPI, targetPath: string): Promise<void>;
export declare function parallelLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>;
export declare function getConfigPathFromArgv(): string | undefined;
export declare function interpolateEnvVars(value: string): string;
export declare function interpolateEnvVars(value: string, environment: NodeJS.ProcessEnv): string;
export declare function getMissingEnvVars(value: string, environment?: NodeJS.ProcessEnv): string[];
export declare function toStringRecord(value: unknown): Record<string, string> | undefined;
export declare function interpolateEnvRecord(values: Record<string, string> | undefined, environment?: NodeJS.ProcessEnv): Record<string, string> | undefined;
/** Resolve a secret value, executing only a single leading `!` command marker. */
export declare function resolveCommandSecret(value: string, context: string): string;
export declare function resolveCommandSecret(value: undefined, context: string): undefined;
export declare function resolveCommandSecret(value: string | undefined, context: string): string | undefined;
/** Resolve command markers in a configured record without mutating the input. */
export declare function resolveCommandSecretsRecord(values: Record<string, string> | undefined, context: (key: string) => string): Record<string, string> | undefined;
export declare function resolveServerUrl(definition: Pick<ServerEntry, "url">, environment?: NodeJS.ProcessEnv): string | undefined;
export declare function resolveConfigPath(value: string | undefined, environment?: NodeJS.ProcessEnv): string | undefined;
/** Expand a leading home-directory marker without interpolating environment variables. */
export declare function expandHomePath(value: string | undefined): string | undefined;
export declare function resolveBearerToken(definition: Pick<ServerEntry, "bearerToken" | "bearerTokenEnv">, environment?: NodeJS.ProcessEnv): string | undefined;
/** Remove OSC control strings, including payloads that have no terminator. */
export declare function stripOscSequences(text: string): string;
export declare function sanitizeTerminalText(text: string): string;
export declare function formatTerminalError(error: unknown): string;
export declare function truncateAtWord(text: string, target: number): string;
/** Request `_meta` key that lets MCP servers correlate a call with the Pi tool call that made it. */
export declare const TOOL_CALL_ID_REQUEST_META_KEY = "pi-mcp-adapter/toolCallId";
export declare function withToolCallIdMeta(meta: Record<string, unknown> | undefined, toolCallId: string | undefined): Record<string, unknown> | undefined;
export declare function normalizeDirectToolInputSchema(schema: unknown): Record<string, unknown>;
export declare function normalizeToolArguments(value: unknown, context?: string): Record<string, unknown>;
export declare function formatAuthRequiredMessage(config: Pick<McpConfig, "settings" | "mcpServers">, serverName: string, defaultMessage: string): string;
/** Servers with `auth.provider` sign in through Pi, never through MCP OAuth. */
export declare function providerSignInMessage(serverName: string, provider: string): string;
/** Why a server must not receive its `auth.provider` token at `url`, or undefined when it may. */
export declare function providerAuthUrlError(url: string): string | undefined;
export declare function formatMcpStatus(config: Pick<McpConfig, "settings">, message: string): string | undefined;
export declare function formatMcpFooterStatus(config: Pick<McpConfig, "settings">, enabledCount: number, disabledCount: number, connectedCount: number): string | undefined;
/**
 * Extract the adapter-owned UI stream mode from tool metadata.
 */
export declare function extractToolUiStreamMode(toolMeta: Record<string, unknown> | undefined): "eager" | "stream-first" | undefined;
/**
 * Keep only the spec tool annotations with the right types. Server and cache
 * input is untrusted, so a malformed field is dropped instead of failing the tool list.
 */
export declare function extractToolAnnotations(annotations: unknown): McpToolAnnotations | undefined;
