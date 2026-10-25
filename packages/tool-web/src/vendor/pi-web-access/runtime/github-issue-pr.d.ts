import type { ExtractedContent, ExtractOptions } from "./extract.js";
type Kind = "pull" | "issue";
export interface GitHubIssuePrUrlInfo {
    owner: string;
    repo: string;
    kind: Kind;
    number: number;
    anchor?: string;
}
interface RenderData {
    url: string;
    owner: string;
    repo: string;
    kind: Kind;
    number: number;
    anchor?: string;
    view: Record<string, unknown>;
    reviewThreads: Record<string, unknown>[];
    reviewThreadsBounded?: boolean;
    reviewThreadsUnavailable?: boolean;
    fallbackNotes: string[];
}
export declare function parseGitHubIssuePrUrl(url: string): GitHubIssuePrUrlInfo | null;
export declare function renderGitHubPrIssue(data: RenderData): ExtractedContent;
export declare function extractGitHubIssuePr(url: string, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent | null>;
export {};
