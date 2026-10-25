import type { DirectToolSpec, McpConfig, ToolPrefix } from "./types.js";
import type { MetadataCache } from "./metadata-cache.js";
export { getMissingConfiguredDirectToolServers } from "./metadata-cache.js";
export declare const DIRECT_TOOLS_ADVISORY_THRESHOLD = 75;
export declare function getLargeDirectToolsAdvisory(config: McpConfig, specs: readonly DirectToolSpec[]): string | undefined;
/**
 * Recover one model-emitted JSON layer for schema-declared object and array
 * properties, then validate the complete input against the same schema.
 */
export declare function prepareDirectToolArguments(inputSchema: unknown, args: unknown): unknown;
export declare function resolveDirectTools(config: McpConfig, cache: MetadataCache | null, prefix: ToolPrefix, envOverride?: string[], unavailableServers?: ReadonlySet<string>, reservedNames?: Set<string>): DirectToolSpec[];
/**
 * Pure function of config: the description must stay byte-stable across
 * runtime metadata changes (tool counts, instructions, connection state) so
 * re-registering the proxy tool never rewrites the cached prompt prefix.
 * Live counts/status belong to `mcp({ })`, full instructions to
 * `mcp({ instructions })`.
 */
export declare function buildProxyDescription(config: McpConfig, scriptTool?: boolean): string;
