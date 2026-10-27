/** Observe cancellation while awaiting work that cannot itself be cancelled (such as import()). */
export declare function awaitWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T>;
