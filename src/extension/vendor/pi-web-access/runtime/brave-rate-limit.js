const DEFAULT_SAFETY_MARGIN_MS = 100;
const DEFAULT_MAX_WAIT_MS = 30_000;
function parseNumberList(value) {
    if (!value)
        return [];
    return value.split(",").map(part => Number(part.trim()));
}
function parsePolicyWindows(value) {
    if (!value)
        return [];
    return value.split(",").map(part => {
        const match = /(?:^|;)\s*w=(\d+(?:\.\d+)?)\s*(?:;|$)/i.exec(part.trim());
        if (!match)
            return null;
        const seconds = Number(match[1]);
        return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
    });
}
/** Parse Brave's parallel rate-limit bucket headers by list position. */
export function parseBraveRateLimitHeaders(headers) {
    const limits = parseNumberList(headers.get("x-ratelimit-limit"));
    const remaining = parseNumberList(headers.get("x-ratelimit-remaining"));
    const resets = parseNumberList(headers.get("x-ratelimit-reset"));
    const windows = parsePolicyWindows(headers.get("x-ratelimit-policy"));
    const count = Math.max(limits.length, remaining.length, resets.length, windows.length);
    const buckets = [];
    for (let index = 0; index < count; index++) {
        const limit = limits[index];
        const left = remaining[index];
        const resetSeconds = resets[index];
        if (![limit, left, resetSeconds].every(Number.isFinite) || limit < 0 || left < 0 || resetSeconds < 0)
            continue;
        buckets.push({
            limit,
            windowSeconds: windows[index] ?? null,
            remaining: left,
            resetSeconds,
        });
    }
    return buckets;
}
export function parseRetryAfterMs(headers, now = Date.now()) {
    const value = headers.get("retry-after")?.trim();
    if (!value)
        return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1000;
    const date = Date.parse(value);
    if (!Number.isFinite(date))
        return null;
    return Math.max(0, date - now);
}
function defaultSleep(ms, signal) {
    if (signal?.aborted)
        return Promise.reject(new Error("Aborted"));
    return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(new Error("Aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
function formatWait(ms) {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    return `${hours}h`;
}
export class BraveRateLimitCoordinator {
    queue = Promise.resolve();
    blockedUntil = 0;
    now;
    sleep;
    safetyMarginMs;
    maxWaitMs;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.sleep = options.sleep ?? defaultSleep;
        this.safetyMarginMs = options.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS;
        this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    }
    run(operation, signal) {
        const scheduled = this.queue.then(async () => {
            await this.waitForAvailability(signal);
            if (signal?.aborted)
                throw new Error("Aborted");
            return operation();
        });
        this.queue = scheduled.then(() => undefined, () => undefined);
        if (!signal)
            return scheduled;
        if (signal.aborted)
            return Promise.reject(new Error("Aborted"));
        return new Promise((resolve, reject) => {
            const onAbort = () => reject(new Error("Aborted"));
            signal.addEventListener("abort", onAbort, { once: true });
            scheduled.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
        });
    }
    observe(headers) {
        const exhausted = parseBraveRateLimitHeaders(headers).filter(bucket => bucket.remaining === 0);
        if (exhausted.length === 0)
            return;
        const resetMs = Math.max(...exhausted.map(bucket => bucket.resetSeconds * 1000));
        this.blockFor(resetMs);
    }
    retryDelay(headers) {
        const advertised = parseRetryAfterMs(headers, this.now());
        const exhausted = parseBraveRateLimitHeaders(headers).filter(bucket => bucket.remaining === 0);
        const bucketDelay = exhausted.length > 0
            ? Math.max(...exhausted.map(bucket => bucket.resetSeconds * 1000))
            : null;
        if (advertised === null && bucketDelay === null)
            return null;
        return Math.max(advertised ?? 0, bucketDelay ?? 0) + this.safetyMarginMs;
    }
    recordRetryDelay(delayMs) {
        this.blockFor(delayMs, false);
    }
    async waitForRecordedCooldown(signal) {
        await this.waitForAvailability(signal);
    }
    async waitForRetry(delayMs, signal) {
        this.recordRetryDelay(delayMs);
        await this.waitForRecordedCooldown(signal);
    }
    blockFor(delayMs, addMargin = true) {
        const boundedDelay = Math.max(0, delayMs) + (addMargin ? this.safetyMarginMs : 0);
        this.blockedUntil = Math.max(this.blockedUntil, this.now() + boundedDelay);
    }
    async waitForAvailability(signal) {
        const waitMs = Math.max(0, this.blockedUntil - this.now());
        if (waitMs === 0)
            return;
        this.assertWaitIsBounded(waitMs);
        await this.sleep(waitMs, signal);
    }
    assertWaitIsBounded(waitMs) {
        if (waitMs <= this.maxWaitMs)
            return;
        throw new Error(`Brave Search quota exhausted; estimated reset in ${formatWait(waitMs)}. Refusing to wait longer than ${formatWait(this.maxWaitMs)} inside one search call.`);
    }
}
