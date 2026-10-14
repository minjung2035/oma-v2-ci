import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
type ProviderHeaders = Record<string, string | null>;
export declare class OpenAIAlphaSearchUnsupportedError extends Error {
}
interface OpenAIAuth {
    provider: string;
    apiKey: string;
    model: string;
    headers: ProviderHeaders;
    responsesUrl: string;
    useCodexEndpoint?: boolean;
    useProviderBaseUrl?: boolean;
}
export declare function isOpenAISubscriptionModelSelected(ctx?: Pick<ExtensionContext, "model"> & {
    modelRegistry?: Pick<ExtensionContext["modelRegistry"], "isUsingOAuth">;
}): boolean;
export declare function isCurrentModelHostedSearchEligible(ctx?: Pick<ExtensionContext, "model">): boolean;
export declare function resolveOpenAIAuth(ctx?: ExtensionContext, signal?: AbortSignal): Promise<OpenAIAuth | undefined>;
export declare function isOpenAISearchAvailable(ctx?: ExtensionContext): Promise<boolean>;
export declare function searchWithOpenAI(query: string, options?: SearchOptions, ctx?: ExtensionContext): Promise<SearchResponse>;
export declare function searchWithCurrentModelOpenAI(query: string, options?: SearchOptions, ctx?: ExtensionContext): Promise<SearchResponse>;
export {};
