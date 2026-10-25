export declare function servedHashesFromDiff(diff: string): string[];
export declare function buildServedMap(fileHashes: string[], fileLines: string[], wantedHashes: string[]): Array<[string, string]>;
export declare function serveRows(path: string, fileHashes: string[], fileLines: string[], wantedHashes: string[]): void;
