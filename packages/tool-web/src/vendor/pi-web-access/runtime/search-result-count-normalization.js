export function normalizeSearchResultCount(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return 5;
    return Math.max(1, Math.min(Math.floor(value), 20));
}
