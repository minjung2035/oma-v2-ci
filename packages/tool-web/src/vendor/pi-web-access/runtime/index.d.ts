import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtractedContent } from "./extract.js";
import { type ProviderAvailability, type SearchProvider, type SearchProviderSelection } from "./gemini-search.js";
export type { ProviderAvailability } from "./gemini-search.js";
import { type QueryResultData } from "./storage.js";
import { type SummaryGenerationContext } from "./summary-review.js";
import { isOpenAISubscriptionModelSelected } from "./openai-search.js";
type CuratorWorkflow = "summary-review";
export type CuratorProvider = SearchProvider;
export declare function getSummaryGenerationDeadlineMs(): number;
export declare function getSummaryInstructions(): string | undefined;
export declare function resolveCuratorDefaultProvider(provider: SearchProviderSelection, available: ProviderAvailability, ctx?: Parameters<typeof isOpenAISubscriptionModelSelected>[0], options?: Pick<PendingCurate, "numResults" | "recencyFilter">): SearchProvider;
interface PendingCurate {
    phase: "searching" | "curating";
    workflow: CuratorWorkflow;
    summaryContext: SummaryGenerationContext;
    searchResults: Map<number, QueryResultData>;
    resultSlots: Map<number, number>;
    allInlineContent: ExtractedContent[];
    queryList: string[];
    includeContent: boolean;
    numResults?: number;
    recencyFilter?: "day" | "week" | "month" | "year";
    domainFilter?: string[];
    availableProviders: ProviderAvailability;
    defaultProvider: SearchProvider;
    searchProvider: SearchProviderSelection;
    summaryModels: Array<{
        value: string;
        label: string;
    }>;
    defaultSummaryModel: string | null;
    timeoutSeconds: number;
    proxy?: string;
    curatorUrl?: string;
    onUpdate: ((update: {
        content: Array<{
            type: string;
            text: string;
        }>;
        details?: Record<string, unknown>;
    }) => void) | undefined;
    signal: AbortSignal | undefined;
    abortSearches: () => void;
    finish: (value: AgentToolResult<Record<string, unknown>>) => void;
    cancel: (reason?: "user" | "stale") => void;
    browserPromise?: Promise<void>;
    browserOpenError?: string;
}
export default function (pi: ExtensionAPI): void;
