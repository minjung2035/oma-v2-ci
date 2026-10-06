import type { ProviderAvailability } from "./gemini-search.js";
export declare function generateCuratorPage(queries: string[], sessionToken: string, timeout: number, availableProviders: ProviderAvailability, defaultProvider: string, searchProvider: string, summaryModels: Array<{
    value: string;
    label: string;
}>, defaultSummaryModel: string | null): string;
