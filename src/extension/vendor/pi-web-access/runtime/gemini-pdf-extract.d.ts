export interface GeminiPDFExtractOptions {
    pages?: number;
    maxPages: number;
    title: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export declare function extractPDFViaGemini(buffer: ArrayBuffer, options: GeminiPDFExtractOptions): Promise<string>;
