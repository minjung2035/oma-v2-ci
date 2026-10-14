import { type MetadataCache } from "./metadata-cache.js";
import { type McpConfig, type ServerCacheEntry, type ServerEntry } from "./types.js";
export interface ParsedMcpReference {
    raw: string;
    server?: string;
    tool?: string;
}
export interface McpReferenceResolution {
    names: string[];
    diagnostics: string[];
}
export type DirectToolSelectorOverride = {
    servers: Set<string>;
    tools: Map<string, Set<string>>;
};
export declare function namespaceProxyName(serverName: string): string;
export declare function parseMcpReference(raw: string): ParsedMcpReference;
export declare function isMcpServerDirectlyRegistered(definition: {
    directTools?: boolean | string[] | "search";
} | undefined, settings: McpConfig["settings"], serverName: string, envOverride: DirectToolSelectorOverride | null): boolean;
export declare function hasCallableCachedTargets(entry: Pick<ServerCacheEntry, "tools" | "resources">, definition: Pick<ServerEntry, "exposeResources">): boolean;
export declare function resolveMcpToolReferences(refs: string[], config: McpConfig | null, cache: MetadataCache | null, envOverride?: string[]): McpReferenceResolution;
