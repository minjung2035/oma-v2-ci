import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
type ProviderHeaders = Record<string, string | null>;
interface XaiAuth {
    apiKey: string;
    model: string;
    headers: ProviderHeaders;
}
export declare function resolveXaiAuth(ctx?: ExtensionContext, signal?: AbortSignal): Promise<XaiAuth | undefined>;
export declare function isXaiSearchAvailable(ctx?: ExtensionContext): Promise<boolean>;
export declare function searchWithXai(query: string, options?: SearchOptions, ctx?: ExtensionContext): Promise<SearchResponse>;
export {};
