import { isBusyError } from "./validation.js";
const sleepSab = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
    Atomics.wait(sleepSab, 0, 0, ms);
}
const BUSY_RETRIES = 3;
const BUSY_RETRY_DELAY_MS = 50;
export function withBusyRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
        try {
            return fn();
        }
        catch (error) {
            lastError = error;
            if (!isBusyError(error) || attempt === BUSY_RETRIES)
                throw error;
            sleepSync(BUSY_RETRY_DELAY_MS * (1 << attempt));
        }
    }
    throw lastError;
}
export async function withBusyRetryAsync(fn) {
    let lastError;
    for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
        try {
            return fn();
        }
        catch (error) {
            lastError = error;
            if (!isBusyError(error) || attempt === BUSY_RETRIES)
                throw error;
            await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAY_MS * (1 << attempt)));
        }
    }
    throw lastError;
}
export function retriedWrite(stmt) {
    return (...params) => {
        withBusyRetry(() => { stmt.run(...params); });
    };
}
