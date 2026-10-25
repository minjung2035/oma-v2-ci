export type Hasher = {
    h32(input: string, seed?: number): number;
    h64ToString(input: string, seed?: bigint): string;
};
export declare function getH(): Hasher;
export declare function initHasher(): Promise<Hasher>;
export declare function xxh32(input: string, seed?: number): number;
export declare function contentChecksum(content: string): string;
export declare function canon(line: string): string;
export declare function hashSource(line: string): string;
export declare function lineChecksum(line: string): string;
