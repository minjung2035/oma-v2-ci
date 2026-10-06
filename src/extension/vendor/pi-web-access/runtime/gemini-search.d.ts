import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type SearchResponse, type SearchOptions } from "./perplexity.js";
export declare const RESOLVED_SEARCH_PROVIDERS: readonly ["openai", "brave", "parallel", "parallel-mcp", "tinyfish", "search1api", "searchinfinity", "querit", "tavily", "you", "firecrawl", "jina", "searxng", "duckduckgo", "perplexity", "gemini", "kimi", "exa", "serpdive", "kagi", "ollama", "anysearch", "xai", "mistral", "brightdata", "serpbase", "serpapi", "serper", "serply", "valyu", "bocha", "xcrawl", "baizhi", "zai"];
export declare const SEARCH_PROVIDERS: readonly ["auto", "all", "openai", "brave", "parallel", "parallel-mcp", "tinyfish", "search1api", "searchinfinity", "querit", "tavily", "you", "firecrawl", "jina", "searxng", "duckduckgo", "perplexity", "gemini", "kimi", "exa", "serpdive", "kagi", "ollama", "anysearch", "xai", "mistral", "brightdata", "serpbase", "serpapi", "serper", "serply", "valyu", "bocha", "xcrawl", "baizhi", "zai"];
export type ResolvedSearchProvider = typeof RESOLVED_SEARCH_PROVIDERS[number];
export type SearchProvider = typeof SEARCH_PROVIDERS[number];
export type SearchProviderSelection = SearchProvider | ResolvedSearchProvider[];
export type ProviderAvailability = {
    all: boolean;
} & Record<ResolvedSearchProvider, boolean>;
export type SearchProviderErrorKind = "transient" | "quota" | "network" | "credential" | "config" | "auth" | "invalid-request" | "invalid-response" | "unsupported" | "aborted" | "unknown";
export interface SearchRoutingConfig {
    providers: ResolvedSearchProvider[];
    useCurrentModel?: boolean;
    fallbackOn: Array<Extract<SearchProviderErrorKind, "transient" | "quota" | "network" | "invalid-response" | "unsupported">>;
}
export declare class SearchProviderError extends Error {
    readonly provider: ResolvedSearchProvider;
    readonly kind: SearchProviderErrorKind;
    readonly status?: number;
    readonly causeError: unknown;
    constructor(provider: ResolvedSearchProvider, kind: SearchProviderErrorKind, message: string, status: number | undefined, cause: unknown);
}
export interface ProviderSearchResponse extends SearchResponse {
    provider: ResolvedSearchProvider;
}
export interface ProviderSearchFailure {
    provider: ResolvedSearchProvider;
    error: string;
}
export interface AttributedSearchResponse extends SearchResponse {
    provider: ResolvedSearchProvider | "all";
    providerResponses?: ProviderSearchResponse[];
    providerErrors?: ProviderSearchFailure[];
}
export declare const ALL_SEARCH_PROVIDERS: ResolvedSearchProvider[];
export declare function getConfiguredSearchRouting(): SearchRoutingConfig | undefined;
export declare function assertSearchProviderSelectionAllowed(selection: SearchProviderSelection, label?: string, allowedProviders?: ("gemini" | "brave" | "firecrawl" | "jina" | "tinyfish" | "search1api" | "querit" | "kagi" | "ollama" | "parallel" | "parallel-mcp" | "brightdata" | "openai" | "xai" | "zai" | "mistral" | "searchinfinity" | "tavily" | "you" | "searxng" | "duckduckgo" | "perplexity" | "kimi" | "exa" | "serpdive" | "anysearch" | "serpbase" | "serpapi" | "serper" | "serply" | "valyu" | "bocha" | "xcrawl" | "baizhi")[] | undefined): void;
export declare function getAllowedSearchProviders(): readonly ResolvedSearchProvider[];
export declare function normalizeSearchProviderSelection(value: unknown, label?: string): SearchProviderSelection;
export interface FullSearchOptions extends SearchOptions {
    provider?: SearchProviderSelection;
    includeContent?: boolean;
    extensionContext?: ExtensionContext;
}
export declare function providerLabel(provider: ResolvedSearchProvider): string;
export declare function search(query: string, options?: FullSearchOptions): Promise<AttributedSearchResponse>;
