const completeSnapshots = new Map();
function scopeFor(sessionKey) {
    return sessionKey ?? "";
}
export function recordAutoReadAllComplete(sessionKey, absolutePath, snapshotId) {
    const scope = scopeFor(sessionKey);
    let snapshots = completeSnapshots.get(scope);
    if (!snapshots) {
        snapshots = new Map();
        completeSnapshots.set(scope, snapshots);
    }
    snapshots.set(absolutePath, snapshotId);
}
export function getAutoReadAllSnapshot(sessionKey, absolutePath) {
    return completeSnapshots.get(scopeFor(sessionKey))?.get(absolutePath);
}
export function clearAutoReadAllComplete(sessionKey) {
    completeSnapshots.delete(scopeFor(sessionKey));
}
export function clearAllAutoReadAllComplete() {
    completeSnapshots.clear();
}
