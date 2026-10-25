import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare function findServedHashEcho(content: string, served: ReadonlyMap<string, string> | ReadonlySet<string>): {
    line: number;
    hash: string;
} | undefined;
export declare function servedHashEchoDenial(rawPath: string, content: string, cwd: string, signal?: AbortSignal): Promise<string | undefined>;
export declare function registerWriteHook(pi: ExtensionAPI): void;
