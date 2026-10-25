export interface FetchContentParams {
    url?: unknown;
    urls?: unknown;
    forceClone?: unknown;
    prompt?: unknown;
    timestamp?: unknown;
    frames?: unknown;
    model?: unknown;
    mode?: unknown;
    answerModel?: unknown;
    auth?: unknown;
    proxy?: unknown;
}
export interface NormalizedFetchContentParams {
    urlList: string[];
    options: {
        forceClone?: boolean;
        prompt?: string;
        timestamp?: string;
        frames?: number;
        model?: string;
        mode?: "readable" | "raw" | "answer";
        answerModel?: string;
        auth?: true | string;
        proxy?: string;
    };
}
export declare function normalizeFetchContentParams(params: FetchContentParams): NormalizedFetchContentParams;
