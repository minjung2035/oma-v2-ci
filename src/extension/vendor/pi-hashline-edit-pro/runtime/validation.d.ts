import type { LFile } from "./file-kind.js";
import type { FileIdentity } from "./fs-write.js";
export declare function valAccess(absolutePath: string, path: string, accessMode?: number): Promise<void>;
export declare function valKind(file: LFile, path: string): asserts file is {
    kind: "text";
    text: string;
    identity?: FileIdentity;
    hadUtf8DecodeErrors?: true;
};
