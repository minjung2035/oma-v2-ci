/**
 * PDF Content Extractor
 *
 * Converts PDFs to Markdown. The `auto` provider chain runs Datalab
 * (deterministic, layout-aware) first, then Gemini API, with unpdf as the
 * deterministic local fallback; the chain can also be pinned with
 * `pdf.provider`.
 */
import { type DatalabMode } from "./datalab-pdf-extract.js";
export interface PDFExtractResult {
    title: string;
    /** The same Markdown written to outputPath, retained for page answering. */
    content: string;
    pages: number;
    chars: number;
    outputPath: string;
}
export interface PDFExtractOptions {
    maxPages?: number;
    outputDir?: string;
    filename?: string;
    signal?: AbortSignal;
    geminiTimeoutMs?: number;
}
export type PDFProvider = "auto" | "gemini" | "datalab" | "unpdf";
export declare const PDF_PROVIDER_VALUES: Set<PDFProvider>;
export interface PDFConfig {
    enabled: boolean;
    maxSizeMB: number;
    maxPages: number;
    provider: PDFProvider;
    datalabMode: DatalabMode;
    datalabTimeoutMs: number;
}
export declare const DEFAULT_PDF_MAX_SIZE_MB = 20;
export declare const MAX_PDF_MAX_SIZE_MB = 50;
export declare const MAX_DATALAB_TIMEOUT_MS = 300000;
export declare function loadPDFConfig(): PDFConfig;
/**
 * Extract text from a PDF buffer and save it to a Markdown file.
 */
export declare function extractPDFToMarkdown(buffer: ArrayBuffer, url: string, options?: PDFExtractOptions): Promise<PDFExtractResult>;
/**
 * Check if URL or content-type indicates a PDF
 */
export declare function isPDF(url: string, contentType?: string): boolean;
