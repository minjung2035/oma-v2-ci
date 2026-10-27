/** Concrete responsibilities, not a baseline of violations. A moved owner must
 * update its imports and these negative-policy tests in the same change.
 */
export const subprocessResponsibilities = Object.freeze({
  "packages/native/src/darwin-metadata.ts": "single fixed read-only directory-relative Darwin xattr/ACL/BSD flag observation; no target open or descendant",
  "packages/process/src/run.ts": "bounded synchronous command mechanism and final no-await observations",
  "packages/process/src/async.ts": "bounded asynchronous child and pipe lifecycle mechanism",
  "packages/process/src/coalesced-wake.ts": "one active callback and one pending memory hint, without activation or durable authority",
  // PI-001: the trusted extension cannot import src/process, and the engine's
  // exec cannot pass a private descriptor, so the extension owns this one child.
  // PI-001: engine grep/fd inherit global config and expose no spawn options.
  // This read-only process searches a descriptor-created copy with clean env.
  "packages/tool-runtime/src/contained-search.ts": "bounded search-only process group over private copied inputs, with abort/stall-observation/output cleanup",
});
/** REC-007: the places that start a child without handing it the society
 * lease, and why each one may. An entry is a claim that this child cannot be a
 * writer of the society outliving the society's ownership -- not a note that
 * the fence has not been wired up yet. The fence rule fails when one of these
 * stops being true, in either direction.
 */
export const fenceExemptSpawnOwners = Object.freeze({
  "packages/native/src/darwin-metadata.ts#darwinMetadata":
    "fixed native helper only changes its own cwd and lists one entry metadata; no writes, credentials, subprocesses or society authority, so retaining a read-only directory reference cannot outlive a writer fence",
  "packages/tool-runtime/src/contained-search.ts#searchWorkspace":
    "read-only source traversal and engine search over a private temporary copy; the oversized answer may also be written into the caller's own workspace through the serialized contained writer -- never a society write or credential; parent pipe EOF aborts its owned copy and walker group",
  "packages/tool-runtime/src/contained-search.ts#startSearchWalker":
    "the complete-rendering walker runs inside the owned search child over its private copy; only a failed spawn's actual close permits the next fd name, an executing walk is not retried; pipe-EOF abort and group cleanup remain with that child, which writes no society state",

  // Command launch owns the caller-selected descriptors and direct child.
  // It cannot prove arbitrary-descendant death. Society writers retain their
  // own fence or execute through the separate journaled native scope owner.
  "packages/process/src/async.ts#startProcess":
    "bounded command mechanism with caller-owned capabilities; native scope callers retain witness/namespace death and journal ownership, while host preparation uses its own inherited writer fence",
  // P0-4/NATIVE-013: a Worker must never inherit the host state-directory
  // lease capability. The actual trusted runner and all Worker descendants
  // are inside the journaled PID namespace; stop/recovery prove init death
  // before Store/tenure release. These are the same confinement boundary,
  // split into portable pipe delivery, Linux grammar and App composition.
  "packages/process/src/async.ts#spawnWithPrivateInputs":
    "portable private bootstrap pipe owner; production caller is the validated Worker adapter, never a host-state writer; outer native namespace ownership supplies descendant death",
  "packages/platform-linux/src/worker-spawn.ts#spawnSandboxed":
    "Linux Worker option grammar passes only seccomp/argv bytes to private descriptors; no Society root capability crosses containment; the trusted runner namespace owns every descendant",
  "apps/oma/src/engine/resident-effects.ts#spawn":
    "Resident-only composition calls the validated Worker adapter; the journaled native runner scope and its full completion fence Store/tenure release, not a leaked host state-directory FD",
  // MODE-003/005: Personal is a separate Human session, not a Society role.
  // It holds a history-writer lock but no Society authority or writable state.
  "packages/process/src/async.ts#spawnSessionInteractive":
    "independent Human session with its own inherited history lock and IPC; no Society role, state or lease",
});
export const DEFAULT_POLICY = Object.freeze({
  toolFilePolicyOwner: "packages/tool-files/src/index.ts",
  toolFilePrimitiveOwner: "packages/tool-files/src/descriptor-files.ts",
  capabilityOwner: "packages/domain/src/capabilities.ts",
  limitOwner: "packages/domain/src/limits.ts",
  identifierOwner: "packages/domain/src/identifiers.ts",
  methodOwner: "packages/protocol/src/methods.ts",
  identityOwner: "packages/domain/src/request-identity.ts",
  sqliteOwners: Object.freeze(["packages/storage/src/store.ts"]),
  subprocessOwners: Object.freeze(Object.keys(subprocessResponsibilities)),
  // The framed transport is intentionally I/O, unlike the codecs next to it.
  // This does not allow fs, process, SQLite, Store or entrypoint imports here.
  protocolIoModules: Object.freeze({ "packages/client/src/channel.ts": Object.freeze(["node:net"]),
    "packages/client/src/connection.ts": Object.freeze(["node:net"]) }),
});
export function pureBoundaryViolation(file, specifier, target, effectModules, policy = DEFAULT_POLICY) {
  if (!/^packages\/(?:domain|protocol)\/src\//.test(file) && !Object.hasOwn(policy.protocolIoModules ?? {}, file)) return false;
  if (target === "packages/storage/src/store.ts" || target?.startsWith("apps/oma/src/entry/")) return true;
  if (!effectModules.has(specifier)) return false;
  return !(policy.protocolIoModules?.[file] ?? []).includes(specifier);
}
