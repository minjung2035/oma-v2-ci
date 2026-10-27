import type { SummaryGenerationContext } from "./summary-review.js";
export declare function rewriteSearchQuery(query: string, ctx: SummaryGenerationContext, signal: AbortSignal): Promise<string>;
