/** Concrete responsibilities, not a baseline of violations. A moved owner must
 * update its imports and these negative-policy tests in the same change.
 */
export const subprocessResponsibilities = Object.freeze({
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
  "packages/tool-runtime/src/contained-search.ts#searchWorkspace":
    "read-only source traversal and engine search over a private temporary copy; the oversized answer may also be written into the caller's own workspace through the serialized contained writer -- never a society write or credential; parent pipe EOF aborts its owned copy and walker group",
  "packages/tool-runtime/src/contained-search.ts#completeSearchText":
    "the complete-rendering walker runs inside the owned search child, over the same private copy it made; the child's own pipe-EOF abort and group kill bound it, and it writes no society state",

  // The bounded command mechanism. Its descriptors are the caller's to choose
  // (`inheritedFds`). Its callers run systemctl, systemd-run, resize2fs and
  // git; none of them writes a society's state itself. A society session that
  // systemd-run starts runs `oma`, which takes the society lease on its own.
  "packages/process/src/async.ts#startProcess":
    "bounded command whose inherited descriptors are the caller's; not a society writer",
  // SB-001: a confined Resident. The fence is deliberately not handed across
  // the sandbox boundary: the lease is a listening socket, and a process
  // inside the confinement holding it could answer the probe that names the
  // society's owner. A Resident that outlives its broker is bounded by the
  // sandbox's own lifetime and by the runner's supervision, not by this lease,
  // and closing that gap properly needs a descendant-death boundary the kernel
  // enforces (a cgroup), not a wider fence.
  "packages/process/src/async.ts#spawnSandboxed":
    "bubblewrap confinement boundary; a listening lease inside a sandbox would be answerable from inside it",
  "packages/engine/src/pi-adapter.ts#deliver":
    "Resident engine started through the confinement boundary above",
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
