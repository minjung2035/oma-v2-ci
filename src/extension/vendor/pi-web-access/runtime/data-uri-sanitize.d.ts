export type DataUriEncoding = "base64" | "percent-encoded";
export type DigestBasis = "decoded" | "encoded";
export interface DataUriOmission {
    ordinal: number;
    sourcePath: string;
    mimeType: string;
    encoding: DataUriEncoding;
    encodedBytes: number;
    decodedBytes: number | null;
    decodeError?: string;
    sha256: string;
    digestBasis: DigestBasis;
    retrieval: "not-retained";
}
/** Replace every recognized RFC 2397-style inline data URI in one string. */
export declare function sanitizeInlineDataUris(text: string, sourcePath: string): {
    text: string;
    omissions: DataUriOmission[];
};
/** Sanitize every string leaf in a JSON-compatible value with one ordinal sequence. */
