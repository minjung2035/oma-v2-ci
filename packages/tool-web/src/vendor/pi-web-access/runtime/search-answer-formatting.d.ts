interface AnswerResult {
    title: string;
    url: string;
    snippet: string;
}
export declare function formatSearchResultsAsAnswer(results: readonly AnswerResult[]): string;
export {};
