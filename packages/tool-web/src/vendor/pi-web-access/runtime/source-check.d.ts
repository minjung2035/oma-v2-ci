import type { SearchResult } from "./perplexity.js";
import type { ExtractedContent } from "./extract.js";
export type SourceQuality = "official_docs" | "vendor_docs" | "repo_issue" | "blog" | "forum" | "news" | "unknown";
export type ClaimStatus = "supported" | "contradicted" | "unclear" | "missing-evidence";
export type RecencyFilter = "day" | "week" | "month" | "year";
export interface ResearchSource {
    rank: number;
    url: string;
    title: string;
    snippet?: string;
    fetch_timestamp?: number;
    content_hash?: string;
    quality: SourceQuality;
    fetched?: boolean;
    fetch_error?: string;
}
export interface ResearchPassage {
    passage_id: string;
    source_url: string;
    source_rank: number;
    text: string;
    extraction_span?: {
        start: number;
        end: number;
    };
    content_hash?: string;
}
export interface ClaimAssessment {
    claim: string;
    status: ClaimStatus;
    supporting_passages: string[];
    contradicting_passages: string[];
    rationale: string;
    confidence: number;
}
export interface ResearchArtifact {
    id: string;
    type: "research";
    timestamp: number;
    query: string;
    sources: ResearchSource[];
    passages: ResearchPassage[];
    claims?: ClaimAssessment[];
    provider?: string;
    summary?: string;
    content_hash?: string;
    filters?: {
        recency?: RecencyFilter;
        domain_include?: string[];
        domain_exclude?: string[];
    };
    errors?: Array<{
        query: string;
        error: string;
    }>;
}
export interface ResearchSearchRequest {
    query: string;
    numResults: number;
    recencyFilter?: RecencyFilter;
    domainFilter?: string[];
}
export interface ResearchSearchResult {
    url: string;
    title: string;
    snippet: string;
    rank: number;
}
export interface ResearchSearchResponse {
    provider: string;
    results: ResearchSearchResult[];
    summary?: string;
}
export interface ResearchProvider {
    name: string;
    search(req: ResearchSearchRequest): Promise<ResearchSearchResponse>;
}
export declare function classifySource(url: string): SourceQuality;
export declare function hashContent(text: string): string;
export declare function buildPassages(sources: ResearchSource[], fetched?: ExtractedContent[], hint?: string): ResearchPassage[];
export declare function assessClaim(claim: string, passages: ResearchPassage[]): ClaimAssessment;
interface RankedSearchResult extends SearchResult {
    rank?: number;
}
export interface BuildArtifactInput {
    query: string;
    provider?: string;
    summary?: string;
    results: RankedSearchResult[];
    fetched?: ExtractedContent[];
    recency?: RecencyFilter;
    domainFilter?: string[];
}
export declare function buildResearchArtifact(input: BuildArtifactInput): ResearchArtifact;
export declare function withClaimAssessment(artifact: ResearchArtifact, claims: string[]): ResearchArtifact;
export declare function storeResearchArtifact(artifact: ResearchArtifact): void;
export declare function getResearchArtifact(id: string): ResearchArtifact | null;
export {};
