export type FindMode = "exact" | "case-insensitive" | "fuzzy";
export declare function findContent(text: string, queries: string[], mode: FindMode): {
    text: string;
    matchCount: number;
    returnedMatches: number;
    queryResults: Array<{
        query: string;
        matchCount: number;
    }>;
};
