export declare function isAdcAuthSelected(): boolean;
export declare function getAdcProject(): string | null;
export declare function getAdcLocation(): string | null;
export declare function getVertexApiBase(project: string, location: string): string;
export declare function isVertexHost(origin: string): boolean;
export declare function clearAdcTokenCache(): void;
export declare function getAdcAccessToken(signal?: AbortSignal): Promise<string>;
export declare function isGeminiAdcAvailable(): boolean;
export declare function redactAdcToken(text: string): string;
