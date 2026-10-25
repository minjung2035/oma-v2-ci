export interface BraveRateLimitBucket {
    limit: number;
    windowSeconds: number | null;
    remaining: number;
    resetSeconds: number;
}
export interface BraveRateLimitCoordinatorOptions {
    now?: () => number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    safetyMarginMs?: number;
    maxWaitMs?: number;
}
/** Parse Brave's parallel rate-limit bucket headers by list position. */
export declare function parseBraveRateLimitHeaders(headers: Headers): BraveRateLimitBucket[];
export declare function parseRetryAfterMs(headers: Headers, now?: number): number | null;
export declare class BraveRateLimitCoordinator {
    private queue;
    private blockedUntil;
    private readonly now;
    private readonly sleep;
    private readonly safetyMarginMs;
    private readonly maxWaitMs;
    constructor(options?: BraveRateLimitCoordinatorOptions);
    run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    observe(headers: Headers): void;
    retryDelay(headers: Headers): number | null;
    recordRetryDelay(delayMs: number): void;
    waitForRecordedCooldown(signal?: AbortSignal): Promise<void>;
    waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void>;
    private blockFor;
    private waitForAvailability;
    private assertWaitIsBounded;
}
