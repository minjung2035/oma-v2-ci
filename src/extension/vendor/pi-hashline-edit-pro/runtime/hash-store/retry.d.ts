export declare function withBusyRetry<T>(fn: () => T): T;
export declare function withBusyRetryAsync<T>(fn: () => T): Promise<T>;
export declare function retriedWrite(stmt: {
    run(...params: (string | number | null)[]): unknown;
}): (...params: (string | number | null)[]) => void;
