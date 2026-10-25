import type { FileIdentity } from "./fs-write.js";
export type LFile = {
    kind: "directory";
} | {
    kind: "image";
    mimeType: string;
} | {
    kind: "text";
    text: string;
    identity?: FileIdentity;
    hadUtf8DecodeErrors?: true;
} | {
    kind: "binary";
    description: string;
} | {
    kind: "too_large";
    description: string;
};
export interface LoadFileOptions {
    maxLines?: number;
    displayPath?: string;
}
/** OMA divergence: installs the contained file opener (see file-kind.js). */
export declare function omaInstallFileReader(opener: ((path: string) => Promise<import("node:fs/promises").FileHandle>) | undefined): void;
export declare function loadFileKindAndText(filePath: string, options?: LoadFileOptions): Promise<LFile>;
