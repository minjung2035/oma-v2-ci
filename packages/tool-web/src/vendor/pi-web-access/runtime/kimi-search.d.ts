import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isKimiSearchAvailable(ctx?: ExtensionContext): Promise<boolean>;
export declare function searchWithKimi(query: string, options?: SearchOptions, ctx?: ExtensionContext): Promise<SearchResponse>;
