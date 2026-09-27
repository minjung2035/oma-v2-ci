/** Concrete responsibilities, not a baseline of violations. A moved owner must
 * update its imports and these negative-policy tests in the same change.
 */
export const subprocessResponsibilities = Object.freeze({
  "src/process/run.ts": "bounded synchronous command mechanism and final no-await observations",
  "src/process/async.ts": "bounded asynchronous child and pipe lifecycle mechanism",
  "src/process/policies.ts": "explicit host editor with inherited terminal I/O via runProcessSync",
  "src/rpc-client.ts": "long-lived Pi JSONL session with bounded framing, writes, drain and close",
  // PI-001: the trusted extension cannot import src/process, and the engine's
  // exec cannot pass a private descriptor, so the extension owns this one child.
  "src/extension/cli-process.ts": "model-facing CLI child with an explicit environment and a private credential socket",
});
/** REC-007: the places that start a child without handing it the society
 * lease, and why each one may. An entry is a claim that this child cannot be a
 * writer of the society outliving the society's ownership -- not a note that
 * the fence has not been wired up yet. The fence rule fails when one of these
 * stops being true, in either direction.
 */
export const fenceExemptSpawnOwners = Object.freeze({
  // The bounded command mechanism. Its descriptors are the caller's to choose
  // (`inheritedFds`). Its callers run systemctl, systemd-run, resize2fs and
  // git; none of them writes a society's state itself. A society session that
  // systemd-run starts runs `oma`, which takes the society lease on its own.
  "src/process/async.ts#startProcess":
    "bounded command whose inherited descriptors are the caller's; not a society writer",
  // SB-001: a confined Resident. The fence is deliberately not handed across
  // the sandbox boundary: the lease is a listening socket, and a process
  // inside the confinement holding it could answer the probe that names the
  // society's owner. A Resident that outlives its broker is bounded by the
  // sandbox's own lifetime and by the runner's supervision, not by this lease,
  // and closing that gap properly needs a descendant-death boundary the kernel
  // enforces (a cgroup), not a wider fence.
  "src/process/async.ts#spawnSandboxed":
    "bubblewrap confinement boundary; a listening lease inside a sandbox would be answerable from inside it",
  "src/runtime/pi-adapter.ts#deliver":
    "Resident engine started through the confinement boundary above",
  // The Human's editor, run synchronously with the terminal attached: the call
  // does not return until the child has exited, so it cannot outlive anything.
  "src/process/policies.ts#runHostEditor":
    "synchronous child with an inherited terminal; the call returns only after it exits",
  // macos-platform §4.6: the guest's society session. Its program is the
  // product's own `oma`, which takes the society lease itself (HostTenure) and
  // hands it down to its engine and broker; the holder that starts it owns no
  // society and has no lease to pass.
  // macos-platform §2.1: the Mac's VM helper. It owns no society; the guest's
  // societies are bounded by the VM, which runs inside the helper and ends
  // with it, and the helper ends when omahostd's channel to it closes.
  "src/platform/host/vz-driver.ts#launch":
    "the VM helper, which holds no society; everything in the guest ends with the VM it runs",
  "src/process/async.ts#spawnInTerminal":
    "a society session's `oma`, which takes the society lease itself; its holder has none to hand down",
});
export const DEFAULT_POLICY = Object.freeze({
  capabilityOwner: "src/domain/capabilities.ts",
  resourceOwner: "src/domain/resources.ts",
  limitOwner: "src/domain/limits.ts",
  identifierOwner: "src/domain/identifiers.ts",
  methodOwner: "src/protocol/methods.ts",
  identityOwner: "src/domain/request-identity.ts",
  sqliteOwners: Object.freeze(["src/store.ts"]),
  subprocessOwners: Object.freeze(Object.keys(subprocessResponsibilities)),
  // PI-001/002: the trusted extension cannot import host runtime at all (the
  // extension-closure rule holds that), so its batch-view identity grammar is an
  // exact mirror, and the equivalence of both decoders is pinned by
  // test/id-contracts.test.ts. This is not a general permission to restate
  // identifier grammars.
  identifierMirrors: Object.freeze({
    "src/extension/batch-view.ts": "trusted Pi extension mirroring the batch-view identity grammar and, for CLI-001/INV04, the address and request-key grammar of the CLI slots it fills",
    "src/extension/principal-channel.ts": "trusted Pi extension mirroring the host channel's credential line",
    "src/extension/cli-process.ts": "trusted Pi extension mirroring the credential and society-lease descriptor numbers",
  }),
  // The framed transport is intentionally I/O, unlike the codecs next to it.
  // This does not allow fs, process, SQLite, Store or entrypoint imports here.
  protocolIoModules: Object.freeze({ "src/protocol/channel.ts": Object.freeze(["node:net"]) }),
});
export function pureBoundaryViolation(file, specifier, target, effectModules, policy = DEFAULT_POLICY) {
  if (!/^src\/(?:domain|protocol)\//.test(file)) return false;
  if (target === "src/store.ts" || target?.startsWith("src/entry/")) return true;
  if (!effectModules.has(specifier)) return false;
  return !(policy.protocolIoModules?.[file] ?? []).includes(specifier);
}
