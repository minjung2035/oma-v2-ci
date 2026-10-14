export function createRetryableLoader(load) {
    let pending = null;
    return () => pending ??= load().catch((error) => {
        pending = null;
        throw error;
    });
}
