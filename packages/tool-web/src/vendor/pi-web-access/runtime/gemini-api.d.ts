export declare const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export declare const DEFAULT_MODEL = "gemini-3.6-flash";
export declare function getApiKey(signal?: AbortSignal): Promise<string | null>;
export declare function getApiHost(): string;
export declare function getVersionedApiBase(): string;
export declare function getUploadBase(): string;
export declare function getCloudflareApiKey(): string | null;
export declare function isGatewayConfigured(): boolean;
export declare function buildAuthHeaders(apiKey?: string | null, cloudflareApiKey?: string | null): Record<string, string>;
export declare function redactGeminiApiResponse(response: Response, text: string, apiKey?: string | null, adcToken?: string | null): string;
export declare function fetchGeminiApi(url: string | URL, init?: RequestInit, apiKey?: string | null): Promise<Response>;
export declare function isGeminiApiAvailable(): boolean;
/**
 * Whether the Gemini Files-API paths (YouTube and local video analysis) can
 * authenticate. These use the Gemini Files API and metadata endpoints, which do
 * not support ADC, so they still require an API key or a Cloudflare gateway.
 */
export declare function isGeminiApiAvailableWithVideo(): boolean;
export interface GeminiApiOptions {
    apiKey?: string;
    model?: string;
    mimeType?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface GeminiGenerateContentResult {
    text: string;
    finishReason?: string;
    blockReason?: string;
}
export declare function queryGeminiApiWithInlineData(prompt: string, data: string, mimeType: string, options?: GeminiApiOptions): Promise<GeminiGenerateContentResult>;
export declare function queryGeminiApiWithVideo(prompt: string, videoUri: string, options?: GeminiApiOptions): Promise<string>;
