export type DatalabMode = "fast" | "balanced" | "accurate";
export type DatalabProcessingLocation = "eu" | "us";
export declare const DATALAB_MODE_VALUES: Set<DatalabMode>;
export declare const DATALAB_LOCATION_VALUES: Set<DatalabProcessingLocation>;
export declare const DEFAULT_DATALAB_MODE: DatalabMode;
export declare const DEFAULT_PROCESSING_LOCATION: DatalabProcessingLocation;
export declare const DEFAULT_DATALAB_TIMEOUT_MS = 120000;
export declare function isDatalabApiAvailable(): boolean;
export declare function getDatalabApiKey(signal?: AbortSignal): Promise<string | null>;
export declare function getDatalabApiBase(): string;
/**
 * Resolve the processing region. US storage and processing is the default;
 * set `DATALAB_PROCESSING_LOCATION=eu` to use EU data residency at Datalab's
 * documented 1.25× usage rate. Only `eu` and `us` are supported by the API.
 * Config errors are thrown with a `Failed to parse` prefix so the
 * extraction fallback chain treats them as fatal, mirroring how malformed
 * web-search config is handled elsewhere.
 */
export declare function getDatalabProcessingLocation(): DatalabProcessingLocation;
export declare function normalizeDatalabMode(value: unknown): DatalabMode;
export interface DatalabPDFExtractOptions {
    maxPages: number;
    title: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    mode?: DatalabMode;
    processingLocation?: DatalabProcessingLocation;
}
export interface DatalabPDFExtractResult {
    markdown: string;
    pages: number;
    parseQualityScore?: number;
}
/**
 * Convert a PDF buffer to Markdown through the Datalab hosted API.
 *
 * Datalab converts documents with a dedicated extraction engine (Marker),
 * which preserves tables, multi-column reading order, headings, and math
 * where the local `unpdf` fallback only produces flattened text. Conversion
 * is deterministic (no LLM transcription drift), and `accurate` mode handles
 * scanned pages. Completed responses may include a `parse_quality_score` (0–5)
 * for quality gating. Billing is per processed page; the free tier includes a
 * monthly credit (see README) so light use costs nothing.
 *
 * The flow is:
 *   1. request a presigned upload URL for the selected processing region,
 *   2. PUT the PDF bytes directly to storage,
 *   3. confirm the upload to obtain a `datalab://` reference,
 *   4. submit the conversion with that reference, then
 *   5. poll the returned `request_check_url` until `complete` or `failed`.
 *
 * The processing region is fixed at the upload step (US by default; set
 * `DATALAB_PROCESSING_LOCATION=eu` for EU data residency). The convert step
 * deliberately omits `processing_location` because the API rejects multipart form data that
 * carries it; the server processes the file from the storage region it was
 * uploaded to. The uploaded file is deleted best-effort after conversion.
 * The caller's signal and a shared deadline bound the whole exchange.
 */
export declare function extractPDFViaDatalab(buffer: ArrayBuffer, options: DatalabPDFExtractOptions): Promise<DatalabPDFExtractResult>;
