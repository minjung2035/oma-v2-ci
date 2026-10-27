/** Observe cancellation while awaiting work that cannot itself be cancelled (such as import()). */
export async function awaitWithAbort(operation, signal) {
    if (!signal)
        return operation;
    let onAbort = () => { };
    const aborted = new Promise((_resolve, reject) => {
        onAbort = () => reject(new Error("Aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted)
            onAbort();
    });
    try {
        const result = await Promise.race([operation, aborted]);
        if (signal.aborted)
            throw new Error("Aborted");
        return result;
    }
    finally {
        signal.removeEventListener("abort", onAbort);
    }
}
