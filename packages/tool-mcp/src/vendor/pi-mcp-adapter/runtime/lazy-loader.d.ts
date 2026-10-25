export declare function createRetryableLoader<T>(load: () => Promise<T>): () => Promise<T>;
